import * as satellite from 'satellite.js'
import { parseTLE, propagate } from './tleParser'
import { eciToEcef, ecefToGeodetic, geodeticToTopocentric } from './coordTransforms'
import type { GeoPosition, ObserverLocation } from '@/types/celestial'

/** A single visible pass of an object above the observer's horizon. */
export interface PassEvent {
  riseTime: Date
  setTime: Date
  maxAltitude: number
  maxAzimuth: number
  durationSeconds: number
}

// Coarse 10 s sampling is plenty for LEO passes (which last minutes) and keeps a
// 24 h scan to ~8 640 SGP4 evaluations — fast enough for a Worker.
const STEP_SECONDS = 10
// Standard "visible above the horizon" threshold; the same 10° used by most
// pass-prediction tools (below this the object is lost in atmosphere/terrain).
const HORIZON_DEG = 10

/**
 * Predict the visible passes of a satellite over an observer for the next
 * `hoursAhead` hours by stepping the SGP4 propagation in 10 s increments and
 * detecting where the topocentric altitude rises above / falls below 10°.
 *
 * Pure compute (no DOM) so it can run in the SGP4 Worker. Reuses the same
 * propagation + coordinate helpers as the live pipeline, so the altitudes match.
 */
export async function computePassPredictions(
  tle1: string,
  tle2: string,
  observer: ObserverLocation,
  hoursAhead: number = 24
): Promise<PassEvent[]> {
  const satrec = parseTLE(tle1, tle2, '')
  const observerGeo: GeoPosition = {
    latitude: observer.latitude,
    longitude: observer.longitude,
    heightKm: observer.altitudeM / 1000,
  }

  const passes: PassEvent[] = []
  const startMs = Date.now()
  const totalSteps = Math.ceil((hoursAhead * 3600) / STEP_SECONDS)

  let inPass = false
  let riseTime: Date | null = null
  let maxAltitude = -Infinity
  let maxAzimuth = 0

  const closePass = (setTime: Date) => {
    if (!riseTime) return
    passes.push({
      riseTime,
      setTime,
      maxAltitude,
      maxAzimuth: (maxAzimuth + 360) % 360,
      durationSeconds: (setTime.getTime() - riseTime.getTime()) / 1000,
    })
    inPass = false
    riseTime = null
    maxAltitude = -Infinity
    maxAzimuth = 0
  }

  for (let i = 0; i <= totalSteps; i++) {
    const t = new Date(startMs + i * STEP_SECONDS * 1000)

    const eci = propagate(satrec, t)
    if (!eci) continue

    const gmst = satellite.gstime(t)
    const geo = ecefToGeodetic(eciToEcef(eci.positionEci, gmst))
    const topo = geodeticToTopocentric(observerGeo, geo)

    if (topo.altitude >= HORIZON_DEG) {
      if (!inPass) {
        // Rising edge — open a new pass.
        inPass = true
        riseTime = t
        maxAltitude = topo.altitude
        maxAzimuth = topo.azimuth
      } else if (topo.altitude > maxAltitude) {
        // Track the culmination (peak) within the pass.
        maxAltitude = topo.altitude
        maxAzimuth = topo.azimuth
      }
    } else if (inPass) {
      // Falling edge — close the pass at this step.
      closePass(t)
    }
  }

  // Pass still in progress at the end of the window — close it at the last step.
  if (inPass) {
    closePass(new Date(startMs + totalSteps * STEP_SECONDS * 1000))
  }

  return passes
}
