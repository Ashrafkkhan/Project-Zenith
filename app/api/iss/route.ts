import { NextResponse } from 'next/server'

// Live ISS position proxied through this server route (never the browser) to
// avoid CORS on OpenNotify. No auth required — a plain fetch is fine.
const SOURCE = 'http://api.open-notify.org/iss-now.json'

// 3-second cache so rapid client polls don't hammer OpenNotify.
export const revalidate = 3

interface OpenNotifyResponse {
  message: string
  timestamp: number // Unix seconds
  iss_position: { latitude: string; longitude: string }
}

interface ISSPosition {
  latitude: number
  longitude: number
  altitudeKm: number
  timestampMs: number
}

// OpenNotify doesn't report altitude; the ISS holds a fairly stable ~408 km
// orbit, so we pass through a nominal mean altitude in km.
const ISS_ALTITUDE_KM = 408

export async function GET() {
  try {
    const r = await fetch(SOURCE, {
      next: { revalidate: 3 },
      headers: { 'User-Agent': 'ProjectZenith/1.0 (Aaruush celestial tracker)' },
    })
    if (!r.ok) throw new Error(`OpenNotify returned ${r.status}`)

    const json = (await r.json()) as OpenNotifyResponse
    const latitude = Number(json.iss_position.latitude)
    const longitude = Number(json.iss_position.longitude)
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('OpenNotify returned malformed position')
    }

    const data: ISSPosition = {
      latitude,
      longitude,
      altitudeKm: ISS_ALTITUDE_KM,
      timestampMs: json.timestamp * 1000,
    }
    return NextResponse.json(data)
  } catch {
    return NextResponse.json(
      { error: 'ISS position unavailable' },
      { status: 502 }
    )
  }
}
