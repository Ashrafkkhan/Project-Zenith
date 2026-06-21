import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// City search proxied through this server route so the browser never calls
// Nominatim directly (avoids CORS, and lets us send the descriptive User-Agent
// Nominatim's usage policy requires).
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

// Geocoding results are stable; cache for an hour to stay well within
// Nominatim's 1 req/s fair-use limit when users retype.
export const revalidate = 3600

interface GeocodeResult {
  label: string
  latitude: number
  longitude: number
}

interface NominatimEntry {
  display_name: string
  lat: string
  lon: string
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim()
  if (!q) {
    return NextResponse.json({ error: 'Missing search query' }, { status: 400 })
  }

  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(q)}&format=json&limit=5`
    const res = await fetch(url, {
      next: { revalidate: 3600 },
      headers: {
        'User-Agent': 'ProjectZenith/1.0 (Aaruush celestial tracker; observer geocoding)',
      },
    })
    if (!res.ok) throw new Error(`Nominatim responded ${res.status}`)

    const raw = (await res.json()) as NominatimEntry[]
    const results: GeocodeResult[] = raw
      .map((e) => ({
        label: e.display_name,
        latitude: Number(e.lat),
        longitude: Number(e.lon),
      }))
      .filter((r) => Number.isFinite(r.latitude) && Number.isFinite(r.longitude))

    return NextResponse.json(results)
  } catch {
    return NextResponse.json({ error: 'Geocoding unavailable' }, { status: 502 })
  }
}
