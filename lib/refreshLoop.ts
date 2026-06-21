import { ZENITH_WINDOW, isISSName } from '@/types/celestial'
import type { CelestialObject, GeoPosition } from '@/types/celestial'
import type { ZenithStore } from '@/store/zenithStore'
import type { TLEEntry, TleMessage, TickMessage, WorkerOutMessage } from './sgp4Worker'
import { geodeticToTopocentric } from './coordTransforms'

const DEFAULT_INTERVAL_MS = 10_000

// TLE cache lives on the main thread (localStorage is unavailable in a Worker).
const TLE_CACHE_KEY = 'zenith_tle_cache'
const TLE_TTL_MS = 2 * 60 * 60 * 1000 // 2 hours — matches CelesTrak's update cadence.
const RETRY_DELAY_MS = 10_000 // Wait this long before retrying a 502.

interface TLECacheEntry {
  data: TLEEntry[]
  timestamp: number
}

// Mirror of the localStorage entry. Gives a stable array reference within the
// TTL so we only re-post TLEs to the worker when they actually change.
let memTLE: TLECacheEntry | null = null

function readLocalCache(): TLECacheEntry | null {
  try {
    const raw = localStorage.getItem(TLE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as TLECacheEntry
    if (!parsed || !Array.isArray(parsed.data) || typeof parsed.timestamp !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

function writeLocalCache(entry: TLECacheEntry): void {
  try {
    localStorage.setItem(TLE_CACHE_KEY, JSON.stringify(entry))
  } catch {
    // Quota exceeded or unavailable (e.g. SSR) — caching is best-effort.
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/** Fetch TLEs from our server route. Attaches the HTTP status so 502s can be handled. */
async function fetchTLEsOnce(): Promise<TLEEntry[]> {
  const res = await fetch('/api/tle')
  if (!res.ok) {
    const err = new Error(`TLE API responded ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  return data.satellites as TLEEntry[]
}

/**
 * Return TLEs, served from the 2-hour localStorage cache when fresh so we never
 * hit CelesTrak more than once per update cycle. On a 502 we wait 10 s and retry
 * once; if that also fails we fall back to any cached (even stale) TLEs rather
 * than failing the tick.
 */
async function getTLEs(): Promise<TLEEntry[]> {
  const now = Date.now()
  if (memTLE && now - memTLE.timestamp < TLE_TTL_MS) return memTLE.data

  const cached = readLocalCache()
  if (cached && now - cached.timestamp < TLE_TTL_MS) {
    memTLE = cached
    return cached.data
  }

  const store = (data: TLEEntry[]): TLEEntry[] => {
    const entry: TLECacheEntry = { data, timestamp: Date.now() }
    memTLE = entry
    writeLocalCache(entry)
    return data
  }

  try {
    return store(await fetchTLEsOnce())
  } catch (err) {
    if ((err as { status?: number }).status === 502) {
      console.warn(`[refreshLoop] /api/tle 502 — retrying in ${RETRY_DELAY_MS / 1000}s`)
      await delay(RETRY_DELAY_MS)
      try {
        return store(await fetchTLEsOnce())
      } catch {
        /* fall through to stale cache below */
      }
    }
    // Serve a stale cache if we have one rather than failing the whole tick.
    if (cached) {
      memTLE = cached
      return cached.data
    }
    if (memTLE) return memTLE.data
    throw err
  }
}

/** Live ISS position shape returned by our /api/iss route (OpenNotify-fed). */
interface ISSLivePosition {
  latitude: number
  longitude: number
  altitudeKm: number
  timestampMs: number
}

/**
 * Promote the ISS within a freshly-propagated catalogue: force its category to
 * 'iss' (so the marker renders at #ffcc02), then overlay the live OpenNotify
 * position from /api/iss — which is NASA-fed and more accurate than our SGP4
 * propagation. Topocentric Alt/Az and the Zenith-Window flag are recomputed from
 * the live position before the store update.
 *
 * Best-effort: if /api/iss fails (or the ISS isn't in the catalogue), the SGP4
 * position is kept and a warning logged. The ISS object is never dropped.
 *
 * Mutates `objects` in place and resolves with it for convenience.
 */
async function promoteISS(
  objects: CelestialObject[],
  observer: { latitude: number; longitude: number; altitudeM: number }
): Promise<CelestialObject[]> {
  // Same matcher the worker categorises with, so we promote exactly the object
  // it tagged 'iss' — no second ISS, no mismatch.
  const iss = objects.find((o) => isISSName(o.name))
  if (!iss) return objects

  // Promote the category regardless of whether the live overlay succeeds.
  iss.category = 'iss'

  try {
    const res = await fetch('/api/iss')
    if (!res.ok) throw new Error(`/api/iss responded ${res.status}`)
    const live = (await res.json()) as ISSLivePosition
    if (
      !Number.isFinite(live.latitude) ||
      !Number.isFinite(live.longitude) ||
      !Number.isFinite(live.altitudeKm)
    ) {
      throw new Error('/api/iss returned a malformed position')
    }

    const geo: GeoPosition = {
      latitude: live.latitude,
      longitude: live.longitude,
      heightKm: live.altitudeKm,
    }
    const observerGeo: GeoPosition = {
      latitude: observer.latitude,
      longitude: observer.longitude,
      heightKm: observer.altitudeM / 1000,
    }
    const topo = geodeticToTopocentric(observerGeo, geo)

    iss.geo = geo
    // Hold steady at the live position rather than letting Cesium interpolate
    // toward the now-inconsistent SGP4 forecast point.
    iss.geoNext = geo
    iss.topo = topo
    iss.inZenithWindow =
      topo.altitude >= ZENITH_WINDOW.minAlt && topo.altitude <= ZENITH_WINDOW.maxAlt
    iss.updatedAt = live.timestampMs || Date.now()
  } catch (err) {
    console.warn('[refreshLoop] live ISS position unavailable, keeping SGP4:', err)
  }

  return objects
}

/** Planet entry shape returned by our /api/planets route (NASA Horizons-fed). */
interface PlanetApiObject {
  id: string
  name: string
  category: 'planet'
  geoPosition: GeoPosition
}

/**
 * Fetch the current planet positions from /api/planets and turn each into a
 * CelestialObject, computing topocentric Alt/Az against `observer` and the
 * Zenith-Window flag from the API's geodetic position.
 *
 * Best-effort: a 503 (Horizons unreachable, no cache) or any other failure
 * logs a warning and returns [] so planets are simply skipped this tick — the
 * pipeline never crashes.
 */
async function fetchPlanetObjects(
  observer: { latitude: number; longitude: number; altitudeM: number },
  now: number
): Promise<CelestialObject[]> {
  try {
    const res = await fetch('/api/planets')
    if (!res.ok) {
      console.warn(`[refreshLoop] /api/planets responded ${res.status} — skipping planets this tick`)
      return []
    }
    const planets = (await res.json()) as PlanetApiObject[]
    if (!Array.isArray(planets)) return []

    const observerGeo: GeoPosition = {
      latitude: observer.latitude,
      longitude: observer.longitude,
      heightKm: observer.altitudeM / 1000,
    }

    return planets.map((p) => {
      const topo = geodeticToTopocentric(observerGeo, p.geoPosition)
      return {
        id: `planet-${p.name.toLowerCase()}`,
        name: p.name,
        category: 'planet' as const,
        geo: p.geoPosition,
        topo,
        inZenithWindow:
          topo.altitude >= ZENITH_WINDOW.minAlt && topo.altitude <= ZENITH_WINDOW.maxAlt,
        updatedAt: now,
      }
    })
  } catch (err) {
    console.warn('[refreshLoop] planet fetch failed, skipping planets this tick:', err)
    return []
  }
}

/**
 * Ask the worker to propagate its currently-loaded TLEs for `observer` and
 * resolve with the propagated CelestialObject[]. Rejects if the worker errors.
 */
function runPropagation(
  worker: Worker,
  observer: TickMessage['observer'],
  intervalMs: number,
  offsetMs: number
): Promise<CelestialObject[]> {
  return new Promise((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data
      if (msg.type === 'result') {
        detach()
        resolve(msg.objects)
      } else if (msg.type === 'error') {
        detach()
        reject(new Error(msg.message))
      }
      // 'loading' messages are ignored — the loop tracks dataLoading itself.
    }
    const onError = (e: ErrorEvent) => {
      detach()
      reject(new Error(e.message || 'Worker error'))
    }
    const detach = () => {
      worker.removeEventListener('message', onMessage)
      worker.removeEventListener('error', onError)
    }
    worker.addEventListener('message', onMessage)
    worker.addEventListener('error', onError)
    worker.postMessage({ type: 'tick', observer, intervalMs, offsetMs } satisfies TickMessage)
  })
}

/**
 * Start the real-time refresh loop. Every `intervalMs` it loads TLEs (from the
 * 2-hour localStorage cache or CelesTrak), hands them to the SGP4 worker for
 * propagation, and pushes the fresh positions into the store via `upsertObjects`.
 * A failed cycle is logged and skipped — it never crashes the loop. Returns a
 * `stopRefreshLoop` cleanup that clears the interval and terminates the worker.
 *
 * @param store      The Zustand store instance (dependency-injected).
 * @param intervalMs Refresh cadence in milliseconds (default 10 000).
 */
export function startRefreshLoop(
  store: ZenithStore,
  intervalMs: number = DEFAULT_INTERVAL_MS
): () => void {
  let worker: Worker
  try {
    worker = new Worker(new URL('./sgp4Worker.ts', import.meta.url))
  } catch (err) {
    console.error('[refreshLoop] Failed to create Web Worker:', err)
    store.getState().setLastError('Web Worker unavailable')
    return () => {}
  }

  let stopped = false
  // Guard against a slow tick (e.g. a 502 retry) overlapping the next interval.
  let inFlight = false
  // The TLE array reference last sent to the worker — only re-send on change.
  let lastSentTLE: TLEEntry[] | null = null
  // Debounce handle for Time Machine: fire immediately when offset changes
  // rather than waiting up to 10s for the next scheduled tick.
  let timeMachineDebounce: ReturnType<typeof setTimeout> | null = null

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true

    const { observer, offsetHours, upsertObjects, setDataLoading, setLastError } = store.getState()
    setDataLoading(true)
    try {
      // 1. Load TLEs (cached or freshly fetched, with 502 retry).
      const tles = await getTLEs()
      if (stopped) return

      // Push TLEs to the worker only when they change (i.e. on a fresh fetch).
      if (tles !== lastSentTLE) {
        worker.postMessage({ type: 'tle', satellites: tles } satisfies TleMessage)
        lastSentTLE = tles
      }

      // 2. Propagate in the worker → updated CelestialObject[].
      const updatedObjects = await runPropagation(
        worker,
        {
          latitude: observer.latitude,
          longitude: observer.longitude,
          altitudeM: observer.altitudeM,
        },
        intervalMs,
        offsetHours * 3_600_000
      )
      if (stopped) return

      // 2b. Overlay the ISS with its live OpenNotify position (best-effort) and
      // ensure it's categorised 'iss'. Never drops the ISS on failure.
      await promoteISS(updatedObjects, observer)
      if (stopped) return

      // 2c. Append planets from NASA Horizons (best-effort — skipped on failure).
      const planets = await fetchPlanetObjects(observer, Date.now())
      if (stopped) return
      updatedObjects.push(...planets)

      // 3. Push the new positions into the store.
      upsertObjects(updatedObjects)
      setLastError(null)
    } catch (err) {
      // Never crash the loop — log the error and skip this tick.
      console.error('[refreshLoop] tick failed, skipping:', err)
      setLastError(err instanceof Error ? err.message : String(err))
    } finally {
      inFlight = false
      if (!stopped) setDataLoading(false)
    }
  }

  void tick()
  const handle = setInterval(() => void tick(), intervalMs)

  // When the user drags the Time Machine slider, kick off a fresh propagation
  // immediately (debounced 300ms) so the globe responds without waiting up to
  // 10 s for the next scheduled tick.
  const unsubOffset = store.subscribe(
    (s) => s.offsetHours,
    () => {
      if (stopped) return
      if (timeMachineDebounce) clearTimeout(timeMachineDebounce)
      timeMachineDebounce = setTimeout(() => {
        timeMachineDebounce = null
        void tick()
      }, 300)
    }
  )

  return function stopRefreshLoop() {
    stopped = true
    clearInterval(handle)
    if (timeMachineDebounce) clearTimeout(timeMachineDebounce)
    unsubOffset()
    worker.terminate()
  }
}
