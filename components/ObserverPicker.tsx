'use client'

import { useEffect, useState } from 'react'
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

  // Entry animation: mount hidden, then flip to visible on the next frame so the
  // opacity/translate transition runs each time the picker opens.
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!open) {
      setVisible(false)
      return
    }
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [open])

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
    'w-full rounded-lg bg-white/5 border border-cyan-500/20 px-3 py-2 text-sm text-white ' +
    'placeholder:text-slate-500 outline-none focus:border-cyan-400/60'

  return (
    // Mobile: bottom sheet (full-width, anchored to the bottom, rounded top).
    // sm+: floating panel anchored under the TopBar on the left.
    <div
      className={
        'fixed z-30 bg-black/30 backdrop-blur-md text-white text-sm shadow-2xl ' +
        'border-cyan-500/20 transition-all duration-200 ease-out ' +
        (visible ? 'opacity-100 translate-y-0 ' : 'opacity-0 translate-y-1 ') +
        'inset-x-0 bottom-0 w-full max-h-[85vh] overflow-y-auto rounded-t-2xl border-t ' +
        'sm:inset-x-auto sm:bottom-auto sm:left-4 sm:top-14 sm:w-80 sm:max-h-none sm:overflow-visible sm:rounded-xl sm:border'
      }
    >
      {/* Drag-handle affordance — bottom sheet only */}
      <div className="sm:hidden flex justify-center pt-2">
        <div className="h-1 w-10 rounded-full bg-white/20" />
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-cyan-500/10">
        <span className="font-semibold text-cyan-400 tracking-tight">Observer Location</span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-slate-400 hover:text-cyan-300"
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
          className="w-full rounded-lg bg-cyan-500/10 border border-cyan-500/30 px-3 py-2 text-cyan-300 font-medium hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-all duration-150 disabled:opacity-50"
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
              className="shrink-0 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 rounded-lg px-3 py-1.5 transition-all duration-150 disabled:opacity-50"
            >
              {searching ? '…' : 'Go'}
            </button>
          </div>

          {results.length > 0 && (
            <ul className="rounded-lg border border-cyan-500/10 overflow-hidden">
              {results.map((r, i) => (
                <li key={`${r.latitude},${r.longitude},${i}`}>
                  <button
                    onClick={() => apply(r.latitude, r.longitude, shortLabel(r.label))}
                    className="w-full text-left hover:bg-cyan-500/10 transition-colors duration-150 rounded-lg px-2 py-1.5 cursor-pointer"
                  >
                    <div className="text-white truncate">{shortLabel(r.label)}</div>
                    <div className="text-slate-400 text-xs truncate">{r.label}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Manual lat/lng fallback */}
        <div className="space-y-2 border-t border-cyan-500/10 pt-3">
          <label className="block text-xs text-slate-400">Or enter coordinates</label>
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
            className="w-full bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 rounded-lg px-3 py-1.5 transition-all duration-150"
          >
            Set coordinates
          </button>
        </div>

        {error && <p className="text-red-400/90 text-xs">{error}</p>}
      </div>
    </div>
  )
}
