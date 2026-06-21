import type { CelestialObject } from '@/types/celestial'
import type { ZenithStore } from '@/store/zenithStore'
import type { TickMessage, WorkerOutMessage } from './sgp4Worker'

const DEFAULT_INTERVAL_MS = 10_000

/**
 * Run one pass of the existing TLE-fetch + SGP4-propagation pipeline (which lives
 * in the sgp4Worker Web Worker) and resolve with the propagated CelestialObject[].
 * Rejects if the worker reports an error, so the caller can skip that tick.
 */
function runPipeline(
  worker: Worker,
  observer: TickMessage['observer'],
  intervalMs: number
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
    worker.postMessage({ type: 'tick', observer, intervalMs } satisfies TickMessage)
  })
}

/**
 * Start the real-time refresh loop. Every `intervalMs` it runs the TLE fetch +
 * SGP4 propagation pipeline and pushes the fresh positions into the store via
 * `upsertObjects`. A failed cycle is logged and skipped — it never crashes the
 * loop. Returns a `stopRefreshLoop` cleanup that clears the interval (and
 * terminates the worker).
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
  // Guard against a slow tick overlapping the next interval fire.
  let inFlight = false

  const tick = async () => {
    if (stopped || inFlight) return
    inFlight = true

    const { observer, upsertObjects, setDataLoading, setLastError } = store.getState()
    setDataLoading(true)
    try {
      // 1. Run the existing fetch + propagation pipeline → updated CelestialObject[].
      const updatedObjects = await runPipeline(
        worker,
        {
          latitude: observer.latitude,
          longitude: observer.longitude,
          altitudeM: observer.altitudeM,
        },
        intervalMs
      )
      if (stopped) return
      // 2. Push the new positions into the store.
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

  return function stopRefreshLoop() {
    stopped = true
    clearInterval(handle)
    worker.terminate()
  }
}
