'use client'

import { useEffect, useState } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'
import PassPredictionPanel from '@/components/PassPredictionPanel'

const CATEGORY_STYLE: Record<string, { label: string; badge: string }> = {
  satellite: {
    label: 'SATELLITE',
    badge: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30',
  },
  iss: {
    label: 'ISS',
    badge: 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/30',
  },
  planet: {
    label: 'PLANET',
    badge: 'bg-orange-500/10 text-orange-300 border border-orange-500/30',
  },
}

/** Age in days of a TLE, parsed from the epoch field (cols 19–32 of line 1). */
function tleEpochAgeDays(line1?: string): number | null {
  if (!line1 || line1.length < 32) return null
  const epoch = line1.substring(18, 32).trim() // "YYDDD.DDDDDDDD"
  const yy = parseInt(epoch.substring(0, 2), 10)
  const doy = parseFloat(epoch.substring(2))
  if (Number.isNaN(yy) || Number.isNaN(doy)) return null
  const year = yy < 57 ? 2000 + yy : 1900 + yy
  const epochMs = Date.UTC(year, 0, 1) + (doy - 1) * 86_400_000
  return (Date.now() - epochMs) / 86_400_000
}

function formatHeight(km: number): string {
  return km >= 100_000 ? `${(km / 1000).toFixed(0)} Mm` : `${km.toFixed(1)} km`
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="text-slate-400 text-xs font-mono mt-0.5">{value}</dd>
    </div>
  )
}

export default function ObjectDetailPanel() {
  const selectedObjectId = useZenithStore((s) => s.selectedObjectId)
  const obj = useZenithStore((s) =>
    selectedObjectId ? s.objects.get(selectedObjectId) : undefined
  )
  const setSelectedObjectId = useZenithStore((s) => s.setSelectedObjectId)

  // Retain the last shown object so its content stays visible during slide-out.
  const [shown, setShown] = useState<CelestialObject | undefined>(undefined)
  useEffect(() => {
    if (obj) setShown(obj)
  }, [obj])

  // Re-render every second so live values reflect the freshest store data.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!selectedObjectId) return
    const h = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(h)
  }, [selectedObjectId])

  const open = selectedObjectId !== null && obj !== undefined
  const data = obj ?? shown
  const cat = data
    ? CATEGORY_STYLE[data.category] ?? {
        label: data.category.toUpperCase(),
        badge: 'bg-slate-500/10 text-slate-300 border border-slate-500/30',
      }
    : null

  const close = () => setSelectedObjectId(null)

  return (
    <div
      aria-hidden={!open}
      className={`fixed top-14 right-0 bottom-0 w-[22rem] max-w-[90vw] z-40 transition-all duration-300 ease-out ${
        open ? 'translate-x-0' : 'translate-x-[110%] pointer-events-none'
      }`}
    >
      <div
        className="m-3 h-[calc(100%-1.5rem)] flex flex-col rounded-2xl bg-black/30 backdrop-blur-md border border-cyan-500/20 text-white text-sm shadow-2xl overflow-hidden"
        style={
          open
            ? { boxShadow: '0 0 40px rgba(6,182,212,0.08), inset 0 1px 0 rgba(6,182,212,0.1)' }
            : undefined
        }
      >
        {data && cat && (
          <>
            {/* Header */}
            <div className="relative px-5 pt-5 pb-4 border-b border-cyan-500/10 shrink-0">
              <button
                onClick={close}
                aria-label="Close"
                className="absolute top-4 right-4 text-slate-400 hover:text-white text-lg leading-none"
                style={{ transition: 'color 0.15s ease' }}
              >
                ✕
              </button>

              <h2
                className="text-white font-semibold text-2xl tracking-tight pr-8 leading-tight"
                style={{ fontFamily: 'var(--font-space-grotesk)' }}
              >
                {data.name}
              </h2>

              <div className="mt-2.5 flex items-center gap-2 flex-wrap">
                <span
                  className={`text-xs rounded-full px-2 py-0.5 uppercase tracking-wider ${cat.badge}`}
                >
                  {cat.label}
                </span>

                {data.inZenithWindow && (
                  <span
                    className="zenith-badge-glow text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider text-cyan-200"
                    style={{
                      background: 'rgba(34,211,238,0.15)',
                      border: '1px solid rgba(34,211,238,0.6)',
                    }}
                  >
                    ✦ In Zenith Window
                  </span>
                )}
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto">
              {/* Live topocentric + geodetic readouts */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 py-4">
                <Field label="Altitude" value={`${data.topo.altitude.toFixed(2)}°`} />
                <Field label="Azimuth" value={`${data.topo.azimuth.toFixed(2)}°`} />
                <Field label="Latitude" value={`${data.geo.latitude.toFixed(4)}°`} />
                <Field label="Longitude" value={`${data.geo.longitude.toFixed(4)}°`} />
                <Field label="Height" value={formatHeight(data.geo.heightKm)} />
                <Field label="Range" value={formatHeight(data.topo.rangekm)} />
              </dl>

              {/* Category-specific data source */}
              <div className="px-5 pb-4 text-xs text-slate-400 font-mono">
                {data.category === 'satellite' &&
                  (() => {
                    const age = tleEpochAgeDays(data.line1)
                    return age === null
                      ? 'TLE epoch unavailable'
                      : `TLE epoch age: ${age.toFixed(1)} days`
                  })()}
                {data.category === 'iss' && 'Live position via OpenNotify'}
                {data.category === 'planet' && 'Ephemeris via NASA Horizons'}
              </div>

              {/* Pass predictions — satellites & ISS only (not planets) */}
              {(data.category === 'satellite' || data.category === 'iss') && (
                <div className="border-t border-cyan-500/10">
                  <PassPredictionPanel selectedObjectId={selectedObjectId} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
