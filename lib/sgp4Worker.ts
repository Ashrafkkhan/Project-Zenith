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
import type { NamedSatRec } from './tleParser'
import { eciToEcef, ecefToGeodetic, geodeticToTopocentric } from './coordTransforms'
import { computePassPredictions } from './passPredictions'
import type { PassEvent } from './passPredictions'
import { ZENITH_WINDOW, isISSName } from '../types/celestial'
import type { CelestialCategory, CelestialObject, GeoPosition } from '../types/celestial'

export interface TLEEntry {
  name: string
  line1: string
  line2: string
}

/** Push fresh TLEs into the worker (sent by refreshLoop when its cache refreshes). */
export interface TleMessage {
  type: 'tle'
  satellites: TLEEntry[]
}

/** Ask the worker to propagate its stored TLEs for `observer` at the current time. */
export interface TickMessage {
  type: 'tick'
  observer: { latitude: number; longitude: number; altitudeM: number }
  /** Pipeline cadence in ms — used to compute geoNext for smooth interpolation. */
  intervalMs: number
  /** Time Machine offset in ms added to the propagation timestamp (0 = now). */
  offsetMs?: number
}

/** Ask the worker to predict visible passes for one object over the observer. */
export interface PredictPassesMessage {
  type: 'PREDICT_PASSES'
  /** Caller-supplied request id, echoed back so stale responses can be ignored. */
  id: string
  tle1: string
  tle2: string
  observerLat: number
  observerLng: number
  observerAltM: number
  hoursAhead: number
}

export type WorkerInMessage = TleMessage | TickMessage | PredictPassesMessage

export type WorkerOutMessage =
  | { type: 'result'; objects: CelestialObject[] }
  | { type: 'error'; message: string }
  | { type: 'loading'; value: boolean }
  | { type: 'PASS_PREDICTIONS'; id: string; passes: PassEvent[] }

// TLEs are fetched + cached on the main thread (refreshLoop owns that so it can
// use localStorage and survive CelesTrak rate limits). They're pushed in here via
// a 'tle' message and held so each 'tick' only propagates — the worker performs
// no network I/O, so the 502 path never reaches it.
let satellites: { entry: TLEEntry; satrec: NamedSatRec }[] = []

function categorize(name: string): CelestialCategory {
  // Narrow ISS match (shared with the refresh loop) so substring names like
  // SWISSCUBE aren't miscoloured as the station — see ISS_NAME_PATTERN.
  return isISSName(name) ? 'iss' : 'satellite'
}

function processTick(
  observer: { latitude: number; longitude: number; altitudeM: number },
  intervalMs: number,
  offsetMs: number
): void {
  self.postMessage({ type: 'loading', value: true } satisfies WorkerOutMessage)
  try {
    const records = satellites
    if (records.length === 0) throw new Error('No TLE data loaded yet')
    // Time Machine: shift the propagation epoch forward by offsetMs.
    const now = new Date(Date.now() + offsetMs)
    const nowNext = new Date(now.getTime() + intervalMs)
    const gmst = satellite.gstime(now)
    const gmstNext = satellite.gstime(nowNext)

    const observerGeo: GeoPosition = {
      latitude: observer.latitude,
      longitude: observer.longitude,
      heightKm: observer.altitudeM / 1000,
    }

    const objects: CelestialObject[] = []
    for (const record of records) {
      const { entry, satrec } = record

      const eci = propagate(satrec, now)
      if (!eci) continue

      const ecef = eciToEcef(eci.positionEci, gmst)
      const geo = ecefToGeodetic(ecef)
      const topo = geodeticToTopocentric(observerGeo, geo)

      const category = categorize(entry.name)
      const inZenithWindow =
        topo.altitude >= ZENITH_WINDOW.minAlt && topo.altitude <= ZENITH_WINDOW.maxAlt

      // Propagate one interval ahead for smooth Cesium interpolation ONLY if the
      // object is in the zenith window or is the ISS. For other background satellites,
      // we save propagation cycles since we don't interpolate them sub-second.
      let geoNext: GeoPosition | undefined
      if (inZenithWindow || category === 'iss') {
        const eciNext = propagate(satrec, nowNext)
        if (eciNext) {
          const ecefNext = eciToEcef(eciNext.positionEci, gmstNext)
          geoNext = ecefToGeodetic(ecefNext)
        }
      }

      objects.push({
        id: satrec.satnum,
        name: entry.name,
        category,
        line1: entry.line1,
        line2: entry.line2,
        geo,
        geoNext,
        topo,
        inZenithWindow,
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

async function processPredictPasses(msg: PredictPassesMessage): Promise<void> {
  try {
    const passes = await computePassPredictions(
      msg.tle1,
      msg.tle2,
      {
        latitude: msg.observerLat,
        longitude: msg.observerLng,
        altitudeM: msg.observerAltM,
        label: '',
      },
      msg.hoursAhead
    )
    self.postMessage({
      type: 'PASS_PREDICTIONS',
      id: msg.id,
      passes,
    } satisfies WorkerOutMessage)
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerOutMessage)
  }
}

self.addEventListener('message', (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data
  if (msg.type === 'tle') {
    satellites = msg.satellites.map((sat) => ({
      entry: sat,
      satrec: parseTLE(sat.line1, sat.line2, sat.name),
    }))
  } else if (msg.type === 'tick') {
    processTick(msg.observer, msg.intervalMs, msg.offsetMs ?? 0)
  } else if (msg.type === 'PREDICT_PASSES') {
    void processPredictPasses(msg)
  }
})
