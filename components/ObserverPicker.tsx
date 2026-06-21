'use client'

import { useState } from 'react'
import { useZenithStore } from '@/store/zenithStore'

interface GeocodeResult {
  label: string
  latitude: number
  longitude: number
}

interface ObserverPickerProps {
  open: boolean
  onClose: () => void
}

/** First comma-separated segment of a Nominatim display_name, for a compact label. */
function shortLabel(displayName: string): string {
  return displayName.split(',')[0].trim() || displayName
}

export default function ObserverPicker({ open, onClose }: ObserverPickerProps) {
  const setObserver = useZenithStore((s) => s.setObserver)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [geoLoading, setGeoLoading] = useState(false)

  const [manualLat, setManualLat] = useState('')
  const [manualLng, setManualLng] = useState('')

  if (!open) return null

  const apply = (latitude: number, longitude: number, label: string) => {
    setObserver({ latitude, longitude, altitudeM: 0, label })
    onClose()
  }

  const runSearch = async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    setError(null)
    setResults([])
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`)
      if (!res.ok) throw new Error('search failed')
      const data = (await res.json()) as GeocodeResult[]
      if (!Array.isArray(data) || data.length === 0) {
        setError('No matching places found')
      } else {
        setResults(data)
      }
    } catch {
      setError('City search is unavailable right now')
    } finally {
      setSearching(false)
    }
  }

  const useMyLocation = () => {
    if (!('geolocation' in navigator)) {
      setError('Geolocation is not supported by this browser')
      return
    }
    setGeoLoading(true)
    setError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoLoading(false)
        apply(pos.coords.latitude, pos.coords.longitude, 'My Location')
      },
      (err) => {
        setGeoLoading(false)
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission denied'
            : 'Could not get your location'
        )
      },
      { enableHighAccuracy: true, timeout: 10_000 }
    )
  }

  const applyManual = () => {
    const lat = Number(manualLat)
    const lng = Number(manualLng)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setError('Latitude must be between -90 and 90')
      return
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setError('Longitude must be between -180 and 180')
      return
    }
    apply(lat, lng, `${lat.toFixed(4)}, ${lng.toFixed(4)}`)
  }

  const inputClass =
    'w-full rounded-lg bg-white/5 border border-sky-400/20 px-3 py-2 text-sm text-white ' +
    'placeholder:text-zinc-600 outline-none focus:border-sky-400/60'

  return (
    <div className="fixed left-4 top-14 w-80 rounded-xl bg-black/70 backdrop-blur-md border border-sky-400/20 text-white text-sm shadow-2xl z-30">
      <div className="flex items-center justify-between px-4 py-3 border-b border-sky-400/15">
        <span className="font-semibold text-sky-400 tracking-tight">Observer Location</span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-zinc-400 hover:text-sky-300"
          style={{ transition: 'color 0.15s ease' }}
        >
          ✕
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Use my location */}
        <button
          onClick={useMyLocation}
          disabled={geoLoading}
          className="w-full rounded-lg bg-sky-400/15 border border-sky-400/30 px-3 py-2 text-sky-300 font-medium hover:bg-sky-400/25 disabled:opacity-50"
          style={{ transition: 'background-color 0.15s ease' }}
        >
          {geoLoading ? 'Locating…' : '📍 Use my location'}
        </button>

        {/* City search */}
        <div className="space-y-2">
          <label className="block text-xs text-zinc-500">Search for a city</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runSearch()
              }}
              placeholder="e.g. Chennai"
              className={inputClass}
            />
            <button
              onClick={runSearch}
              disabled={searching || query.trim() === ''}
              className="shrink-0 rounded-lg bg-white/5 border border-sky-400/20 px-3 text-zinc-300 hover:text-sky-300 hover:border-sky-400/40 disabled:opacity-50"
              style={{ transition: 'color 0.15s ease, border-color 0.15s ease' }}
            >
              {searching ? '…' : 'Go'}
            </button>
          </div>

          {results.length > 0 && (
            <ul className="rounded-lg border border-white/10 divide-y divide-white/5 overflow-hidden">
              {results.map((r, i) => (
                <li key={`${r.latitude},${r.longitude},${i}`}>
                  <button
                    onClick={() => apply(r.latitude, r.longitude, shortLabel(r.label))}
                    className="w-full text-left px-3 py-2 hover:bg-white/5"
                    style={{ transition: 'background-color 0.1s ease' }}
                  >
                    <div className="text-white truncate">{shortLabel(r.label)}</div>
                    <div className="text-zinc-500 text-xs truncate">{r.label}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Manual lat/lng fallback */}
        <div className="space-y-2 border-t border-white/5 pt-3">
          <label className="block text-xs text-zinc-500">Or enter coordinates</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              placeholder="Latitude"
              step="any"
              className={inputClass}
            />
            <input
              type="number"
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              placeholder="Longitude"
              step="any"
              className={inputClass}
            />
          </div>
          <button
            onClick={applyManual}
            className="w-full rounded-lg bg-white/5 border border-sky-400/20 px-3 py-2 text-zinc-300 hover:text-sky-300 hover:border-sky-400/40"
            style={{ transition: 'color 0.15s ease, border-color 0.15s ease' }}
          >
            Set coordinates
          </button>
        </div>

        {error && <p className="text-red-400/90 text-xs">{error}</p>}
      </div>
    </div>
  )
}
