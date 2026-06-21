import { NextResponse } from 'next/server'
import * as satellite from 'satellite.js'
import { eciToEcef, ecefToGeodetic } from '@/lib/coordTransforms'
import type { GeoPosition } from '@/types/celestial'

// Planetary positions from NASA Horizons, proxied server-side (the Horizons API
// has no CORS headers). Geocentric apparent RA/Dec + observer range per target,
// converted to a geodetic sub-point for the globe.
const HORIZONS_URL = 'https://ssd.jpl.nasa.gov/api/horizons.api'

// Horizons body-centre target IDs (the planet centres, not barycentres).
const TARGETS: { id: string; name: string }[] = [
  { id: '199', name: 'Mercury' },
  { id: '299', name: 'Venus' },
  { id: '499', name: 'Mars' },
  { id: '599', name: 'Jupiter' },
  { id: '699', name: 'Saturn' },
]

const AU_KM = 149_597_870.7
const DEG2RAD = Math.PI / 180
const FETCH_TIMEOUT_MS = 15_000

// Planetary positions barely move minute-to-minute, so a 60 s cache is plenty.
export const revalidate = 60

interface PlanetObject {
  id: string
  name: string
  category: 'planet'
  geoPosition: GeoPosition
}

// Last good full response, kept across invocations so a Horizons outage falls
// back to the most recent positions instead of erroring.
let cache: PlanetObject[] | null = null

/** Format a Date as Horizons expects: 'YYYY-MM-DD HH:MM' in UTC. */
function fmtTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
  )
}

/** Build the Horizons OBSERVER-ephemeris query URL for one target. */
function buildUrl(targetId: string, start: string, stop: string): string {
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${targetId}'`,
    OBJ_DATA: 'NO',
    MAKE_EPHEM: 'YES',
    EPHEM_TYPE: 'OBSERVER',
    CENTER: '500@399', // geocenter
    QUANTITIES: "'2,20'", // apparent RA/Dec + observer range
    ANG_FORMAT: 'DEG', // RA/Dec as decimal degrees (single tokens, easy to parse)
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: '1m',
  })
  return `${HORIZONS_URL}?${params.toString()}`
}

/**
 * Pull RA (deg), Dec (deg) and range (AU) from the first ephemeris row in a
 * Horizons `result` text block. With QUANTITIES=2,20 and ANG_FORMAT=DEG the row
 * ends with four numeric columns: RA, Dec, delta (AU), deldot (km/s). The date,
 * time and any solar/lunar presence flags precede them, so we read from the tail
 * to stay robust against the variable-width flag columns.
 */
function parseEphemeris(
  result: string
): { ra: number; dec: number; rangeAu: number } | null {
  const soe = result.indexOf('$$SOE')
  const eoe = result.indexOf('$$EOE')
  if (soe === -1 || eoe === -1) return null

  const firstRow = result
    .slice(soe + 5, eoe)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstRow) return null

  const t = firstRow.split(/\s+/)
  if (t.length < 4) return null

  const ra = Number(t[t.length - 4])
  const dec = Number(t[t.length - 3])
  const rangeAu = Number(t[t.length - 2])
  if (![ra, dec, rangeAu].every(Number.isFinite)) return null

  return { ra, dec, rangeAu }
}

/**
 * Geocentric apparent RA/Dec + range → geodetic sub-point.
 * RA/Dec define a direction in the equatorial (ECI) frame; scaling by the range
 * gives an ECI position vector. eciToEcef (with GMST) then ecefToGeodetic yields
 * the lat/long below the planet and its height above the WGS-84 ellipsoid.
 */
function radecToGeo(ra: number, dec: number, rangeAu: number, gmst: number): GeoPosition {
  const raRad = ra * DEG2RAD
  const decRad = dec * DEG2RAD
  const rKm = rangeAu * AU_KM
  const eci: satellite.EciVec3<number> = {
    x: rKm * Math.cos(decRad) * Math.cos(raRad),
    y: rKm * Math.cos(decRad) * Math.sin(raRad),
    z: rKm * Math.sin(decRad),
  }
  return ecefToGeodetic(eciToEcef(eci, gmst))
}

/** Fetch + parse a single target, or null on any failure (so one bad planet doesn't sink the batch). */
async function fetchPlanet(
  target: { id: string; name: string },
  start: string,
  stop: string,
  gmst: number
): Promise<PlanetObject | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(buildUrl(target.id, start, stop), {
        signal: controller.signal,
        next: { revalidate: 60 },
        headers: { 'User-Agent': 'ProjectZenith/1.0 (Aaruush celestial tracker)' },
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null

    const json = (await res.json()) as { result?: string }
    if (!json.result) return null

    const eph = parseEphemeris(json.result)
    if (!eph) return null

    return {
      id: target.id,
      name: target.name,
      category: 'planet',
      geoPosition: radecToGeo(eph.ra, eph.dec, eph.rangeAu, gmst),
    }
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const now = new Date()
    const start = fmtTime(now)
    const stop = fmtTime(new Date(now.getTime() + 60_000)) // now + 1 minute
    const gmst = satellite.gstime(now)

    // Horizons throttles concurrent requests from one IP (only a couple of five
    // parallel queries return data), so fetch the targets sequentially.
    const planets: PlanetObject[] = []
    for (const target of TARGETS) {
      const planet = await fetchPlanet(target, start, stop, gmst)
      if (planet) planets.push(planet)
    }

    // A non-empty result means Horizons was reachable — refresh the cache.
    if (planets.length > 0) {
      cache = planets
      return NextResponse.json(planets)
    }

    // Everything failed: Horizons unreachable. Serve the last good response.
    if (cache) return NextResponse.json(cache)
    return NextResponse.json({ error: 'Planet positions unavailable' }, { status: 503 })
  } catch {
    if (cache) return NextResponse.json(cache)
    return NextResponse.json({ error: 'Planet positions unavailable' }, { status: 503 })
  }
}
