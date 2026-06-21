'use client'

import { useZenithStore } from '@/store/zenithStore'
import { ZENITH_WINDOW } from '@/types/celestial'

const CATEGORY_COLOR: Record<string, string> = {
  satellite: '#4fc3f7',
  iss: '#ffcc02',
  planet: '#ff8c69',
}

export default function ZenithWindow() {
  const zenithObjects = useZenithStore((s) => s.zenithObjects)
  const showCone = useZenithStore((s) => s.showZenithCone)
  const toggleCone = useZenithStore((s) => s.toggleZenithCone)

  return (
    <div className="absolute right-4 top-4 w-64 rounded-xl bg-black/70 backdrop-blur-md border border-sky-400/20 text-white text-sm shadow-2xl z-20">
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-sky-400/15">
        <div>
          <span className="font-semibold text-sky-400 tracking-tight">Zenith Window</span>
          <span className="text-zinc-500 text-xs ml-1.5">
            {ZENITH_WINDOW.minAlt}°–{ZENITH_WINDOW.maxAlt}°
          </span>
        </div>
        <button
          onClick={toggleCone}
          // Use specific property transitions — `transition: all` forces the browser
          // to check every property on every frame.
          className="text-xs text-zinc-400 hover:text-sky-300"
          style={{ transition: 'color 0.15s ease' }}
        >
          {showCone ? 'Hide' : 'Show'} cone
        </button>
      </div>

      {/* content-visibility: auto skips rendering off-screen list items
          entirely, which helps when the list is long. */}
      <div className="max-h-72 overflow-y-auto" style={{ contentVisibility: 'auto' }}>
        {zenithObjects.length === 0 ? (
          <p className="px-3 py-5 text-zinc-600 text-center text-xs">
            No objects overhead
            <br />
            <span className="text-zinc-700">Click [DEV] Seed Data to populate</span>
          </p>
        ) : (
          zenithObjects.map((obj) => (
            <div
              key={obj.id}
              className="px-3 py-2.5 border-b border-white/5"
              // Specific transitions instead of `transition: all` to avoid
              // the browser checking every property on mouse events.
              style={{ transition: 'background-color 0.1s ease' }}
              onMouseEnter={(e) => {
                ;(e.currentTarget as HTMLElement).style.backgroundColor =
                  'rgba(255,255,255,0.05)'
              }}
              onMouseLeave={(e) => {
                ;(e.currentTarget as HTMLElement).style.backgroundColor = ''
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-white">{obj.name}</span>
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider"
                  style={{
                    color: CATEGORY_COLOR[obj.category] ?? '#fff',
                    background: (CATEGORY_COLOR[obj.category] ?? '#fff') + '22',
                  }}
                >
                  {obj.category}
                </span>
              </div>
              <div className="text-zinc-500 text-xs mt-1 tabular-nums">
                Alt {obj.topo.altitude.toFixed(1)}° · Az {obj.topo.azimuth.toFixed(1)}°
                <span className="ml-2 text-zinc-600">
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
        <div className="px-3 py-2 text-zinc-600 text-[10px] text-right">
          {zenithObjects.length} object{zenithObjects.length !== 1 ? 's' : ''} overhead
        </div>
      )}
    </div>
  )
}
