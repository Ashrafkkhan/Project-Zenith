/**
 * Web Worker — all SGP4 orbital propagation runs here, off the main thread.
 * Instantiated by refreshLoop.ts via:
 *   new Worker(new URL('./sgp4Worker.ts', import.meta.url))
 *
 * Uses relative imports (not @/ aliases) because webpack bundles this
 * as a separate worker chunk that must be self-contained.
 */

import * as satellite from 'satellite.js'
import { parseTLE, propagate } from './tleParser'
import { eciToEcef, ecefToGeodetic, geodeticToTopocentric } from './coordTransforms'
import { ZENITH_WINDOW } from '../types/celestial'
import type { CelestialCategory, CelestialObject, GeoPosition } from '../types/celestial'

interface TLEEntry {
  name: string
  line1: string
  line2: string
}

export interface TickMessage {
  type: 'tick'
  observer: { latitude: number; longitude: number; altitudeM: number }
  /** Pipeline cadence in ms — used to compute geoNext for smooth interpolation. */
  intervalMs: number
}

export type WorkerOutMessage =
  | { type: 'result'; objects: CelestialObject[] }
  | { type: 'error'; message: string }
  | { type: 'loading'; value: boolean }

// Stale-while-revalidate TLE cache inside the worker.
let cachedSatellites: TLEEntry[] = []
let cacheExpiry = 0

async function fetchTLEs(): Promise<TLEEntry[]> {
  const now = Date.now()
  if (cachedSatellites.length > 0 && now < cacheExpiry) return cachedSatellites
  const res = await fetch('/api/tle')
  if (!res.ok) throw new Error(`TLE API responded ${res.status}`)
  const data = await res.json()
  if (data.error) throw new Error(data.error)
  cachedSatellites = data.satellites as TLEEntry[]
  cacheExpiry = now + 5 * 60 * 1000
  return cachedSatellites
}

function categorize(name: string): CelestialCategory {
  const upper = name.toUpperCase()
  return upper.includes('ISS') || upper.includes('ZARYA') ? 'iss' : 'satellite'
}

async function processTick(
  observer: { latitude: number; longitude: number; altitudeM: number },
  intervalMs: number
): Promise<void> {
  self.postMessage({ type: 'loading', value: true } satisfies WorkerOutMessage)
  try {
    const tles = await fetchTLEs()
    const now = new Date()
    const nowNext = new Date(now.getTime() + intervalMs)
    const gmst = satellite.gstime(now)
    const gmstNext = satellite.gstime(nowNext)

    const observerGeo: GeoPosition = {
      latitude: observer.latitude,
      longitude: observer.longitude,
      heightKm: observer.altitudeM / 1000,
    }

    const objects: CelestialObject[] = []
    for (const sat of tles) {
      const satrec = parseTLE(sat.line1, sat.line2, sat.name)

      const eci = propagate(satrec, now)
      if (!eci) continue

      const ecef = eciToEcef(eci.positionEci, gmst)
      const geo = ecefToGeodetic(ecef)
      const topo = geodeticToTopocentric(observerGeo, geo)

      // Propagate one interval ahead for smooth Cesium interpolation.
      let geoNext: GeoPosition | undefined
      const eciNext = propagate(satrec, nowNext)
      if (eciNext) {
        const ecefNext = eciToEcef(eciNext.positionEci, gmstNext)
        geoNext = ecefToGeodetic(ecefNext)
      }

      objects.push({
        id: satrec.satnum,
        name: sat.name,
        category: categorize(sat.name),
        geo,
        geoNext,
        topo,
        inZenithWindow:
          topo.altitude >= ZENITH_WINDOW.minAlt && topo.altitude <= ZENITH_WINDOW.maxAlt,
        updatedAt: now.getTime(),
      })
    }

    self.postMessage({ type: 'result', objects } satisfies WorkerOutMessage)
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOutMessage)
  } finally {
    self.postMessage({ type: 'loading', value: false } satisfies WorkerOutMessage)
  }
}

self.addEventListener('message', (e: MessageEvent<TickMessage>) => {
  if (e.data.type === 'tick') {
    void processTick(e.data.observer, e.data.intervalMs)
  }
})
