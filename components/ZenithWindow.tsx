'use client'

import { useZenithStore } from '@/store/zenithStore'
import { ZENITH_WINDOW } from '@/types/celestial'

// Category badge pill styling (Change 1 glassmorphism spec).
const CATEGORY_BADGE: Record<string, string> = {
  satellite: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30',
  iss: 'bg-yellow-500/10 text-yellow-300 border border-yellow-500/30',
  planet: 'bg-orange-500/10 text-orange-300 border border-orange-500/30',
}

// Time Machine slider index → hours-ahead mapping.
const TIME_OFFSETS = [0, 1, 6, 24]

/**
 * Circular "Zenith Score" gauge + animated waveform. Score is derived from the
 * average altitude of objects currently in the zenith window (75°–90° → 0–100).
 */
function ZenithScoreWidget() {
  const zenithObjects = useZenithStore((s) => s.zenithObjects)
  const avgAlt =
    zenithObjects.length > 0
      ? zenithObjects.reduce((sum, o) => sum + o.topo.altitude, 0) / zenithObjects.length
      : 0
  // Clamp to [0, 100]; zenith objects sit in [75°, 90°] so this maps cleanly.
  const score = Math.max(0, Math.min(100, Math.round((avgAlt - 75) * 6.67)))

  return (
    <div
      className="bg-black/40 backdrop-blur-md border border-cyan-400/30 rounded-2xl p-4 mb-3"
      style={{ filter: 'drop-shadow(0 0 12px rgba(6,182,212,0.4))' }}
    >
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center shrink-0">
          <svg viewBox="0 0 100 100" width={80} height={80}>
            {/* Background ring */}
            <circle cx={50} cy={50} r={40} fill="none" stroke="#0e2a35" strokeWidth={8} />
            {/* Score arc */}
            <circle
              cx={50}
              cy={50}
              r={40}
              fill="none"
              stroke="#06b6d4"
              strokeWidth={8}
              strokeDasharray={`${(score / 100) * 251.2} 251.2`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
              style={{ transition: 'stroke-dasharray 1s ease-out' }}
            />
            <text
              x={50}
              y={54}
              textAnchor="middle"
              fill="white"
              fontSize={22}
              fontWeight="bold"
              fontFamily="monospace"
            >
              {score}
            </text>
          </svg>
          <span className="text-[10px] text-cyan-400 font-mono tracking-widest mt-1">
            ZENITH SCORE
          </span>
        </div>

        {/* Animated waveform */}
        <div className="flex items-end gap-[2px] h-[18px] flex-1">
          {Array.from({ length: 20 }).map((_, i) => (
            <div
              key={i}
              className="zenith-wave-bar w-[2px] bg-cyan-400/50 rounded-full"
              style={{ animationDelay: `${i * 0.06}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Time Machine: shift the SGP4 propagation timestamp 0/+1/+6/+24 hours ahead. */
function TimeMachine() {
  const offsetHours = useZenithStore((s) => s.offsetHours)
  const offsetTimeHours = useZenithStore((s) => s.offsetTimeHours)
  const dataLoading = useZenithStore((s) => s.dataLoading)
  // Map the stored hours back to a slider index (defaults to 0/"Now").
  const index = Math.max(0, TIME_OFFSETS.indexOf(offsetHours))

  return (
    <div className="bg-black/20 border border-cyan-500/10 rounded-xl p-3 mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-cyan-400 font-mono tracking-widest uppercase">
          Time Machine
        </span>
        <span className="flex items-center gap-1.5">
          {dataLoading && (
            <span
              className="inline-block h-2 w-2 rounded-full border border-cyan-400/40 border-t-cyan-400 animate-spin"
              aria-label="Computing"
            />
          )}
          {offsetHours !== 0 && (
            <span className="bg-cyan-500/10 text-cyan-400 text-xs rounded-full px-2">
              +{offsetHours}h
            </span>
          )}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={3}
        step={1}
        value={index}
        onChange={(e) => offsetTimeHours(TIME_OFFSETS[Number(e.target.value)])}
        className="w-full cursor-pointer accent-cyan-400"
        style={{ transition: 'opacity 0.15s ease', opacity: dataLoading ? 0.6 : 1 }}
      />
      <div className="flex justify-between text-[10px] text-slate-500 font-mono mt-1">
        <span>Now</span>
        <span>+1h</span>
        <span>+6h</span>
        <span>+24h</span>
      </div>
    </div>
  )
}

export default function ZenithWindow() {
  const zenithObjects = useZenithStore((s) => s.zenithObjects)
  const showCone = useZenithStore((s) => s.showZenithCone)
  const toggleCone = useZenithStore((s) => s.toggleZenithCone)
  // Selection is global (the globe click handler also writes it), so a clicked
  // row opens the same ObjectDetailPanel as clicking the marker.
  const selectedObjectId = useZenithStore((s) => s.selectedObjectId)
  const onSelectObject = useZenithStore((s) => s.setSelectedObjectId)

  return (
    <div className="pointer-events-auto absolute right-4 top-4 w-64 rounded-xl bg-black/30 backdrop-blur-md border border-cyan-500/20 text-white text-sm shadow-2xl z-20 p-3">
      <ZenithScoreWidget />

      <div className="flex items-center justify-between pb-2.5">
        <div>
          <span className="font-semibold text-cyan-400 tracking-tight">Zenith Window</span>
          <span className="text-slate-400 text-xs font-mono ml-1.5">
            {ZENITH_WINDOW.minAlt}°–{ZENITH_WINDOW.maxAlt}°
          </span>
        </div>
        <button
          onClick={toggleCone}
          // Use specific property transitions — `transition: all` forces the browser
          // to check every property on every frame.
          className="text-xs text-slate-400 hover:text-cyan-300"
          style={{ transition: 'color 0.15s ease' }}
        >
          {showCone ? 'Hide' : 'Show'} cone
        </button>
      </div>

      {/* content-visibility: auto skips rendering off-screen list items
          entirely, which helps when the list is long. */}
      <div
        className="max-h-72 overflow-y-auto border-t border-cyan-500/10 pt-2 space-y-1"
        style={{ contentVisibility: 'auto' }}
      >
        {zenithObjects.length === 0 ? (
          <p className="px-3 py-5 text-slate-500 text-center text-xs">
            No objects overhead
            <br />
            <span className="text-slate-600">Click [DEV] Seed Data to populate</span>
          </p>
        ) : (
          zenithObjects.map((obj) => (
            <div
              key={obj.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelectObject?.(obj.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSelectObject?.(obj.id)
              }}
              className={`zenith-list-item transition-all duration-200 hover:bg-cyan-500/5 hover:border-cyan-500/20 border rounded-lg px-2 py-1.5 cursor-pointer ${
                selectedObjectId === obj.id
                  ? 'bg-cyan-500/10 border-cyan-500/20'
                  : 'border-transparent'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-white font-semibold text-sm truncate">{obj.name}</span>
                <span
                  className={`shrink-0 text-xs rounded-full px-2 py-0.5 uppercase ${
                    CATEGORY_BADGE[obj.category] ??
                    'bg-slate-500/10 text-slate-300 border border-slate-500/30'
                  }`}
                >
                  {obj.category}
                </span>
              </div>
              <div className="text-slate-400 text-xs font-mono mt-1">
                Alt {obj.topo.altitude.toFixed(1)}° · Az {obj.topo.azimuth.toFixed(1)}°
                <span className="ml-2 text-slate-500">
                  {obj.topo.rangekm < 10_000
                    ? `${obj.topo.rangekm.toFixed(0)} km`
                    : `${(obj.topo.rangekm / 1000).toFixed(0)} Mm`}
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {zenithObjects.length > 0 && (
        <div className="pt-2 text-slate-500 text-[10px] text-right font-mono">
          {zenithObjects.length} object{zenithObjects.length !== 1 ? 's' : ''} overhead
        </div>
      )}

      <TimeMachine />
    </div>
  )
}
