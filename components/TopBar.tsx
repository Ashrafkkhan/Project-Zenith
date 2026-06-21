'use client'

import { useZenithStore } from '@/store/zenithStore'

export default function TopBar() {
  const observer = useZenithStore((s) => s.observer)
  const zenithCount = useZenithStore((s) => s.zenithObjects.length)
  const trackedCount = useZenithStore((s) => s.objects.size)
  // maxAltitude is computed once per pipeline tick inside upsertObjects —
  // no O(n) work here in the render path.
  const maxAltitude = useZenithStore((s) => s.maxAltitude)
  const dataLoading = useZenithStore((s) => s.dataLoading)
  const lastError = useZenithStore((s) => s.lastError)

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-black/80 backdrop-blur border-b border-sky-400/10 text-white shrink-0 z-10">
      <div className="flex items-center gap-3">
        <span className="text-sky-400 font-bold text-lg tracking-tight">✦ Zenith</span>
        <span className="text-zinc-500 text-sm hidden sm:inline">The Celestial Eye</span>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <span className="text-zinc-400">
          <span className="text-zinc-500">Observer: </span>
          <span className="text-white font-medium">{observer.label}</span>
          <span className="text-zinc-600 ml-1.5">
            {observer.latitude.toFixed(4)}°N {observer.longitude.toFixed(4)}°E
          </span>
        </span>

        {zenithCount > 0 && (
          <span className="bg-sky-400/15 text-sky-400 border border-sky-400/30 px-2 py-0.5 rounded text-xs font-medium">
            {zenithCount} in Zenith Window
          </span>
        )}

        {maxAltitude !== null && (
          <span className="bg-violet-500/15 text-violet-300 border border-violet-400/30 px-2 py-0.5 rounded text-xs font-medium tabular-nums">
            ↑ {maxAltitude.toFixed(1)}° max
          </span>
        )}

        {lastError ? (
          <span
            className="text-red-400/90 text-xs max-w-[14rem] truncate"
            title={lastError}
          >
            ⚠ {lastError}
          </span>
        ) : (
          <span className="text-zinc-500 text-xs tabular-nums flex items-center gap-1.5">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                dataLoading ? 'bg-sky-400 animate-pulse' : 'bg-emerald-500/70'
              }`}
            />
            {trackedCount} tracked
          </span>
        )}
      </div>
    </div>
  )
}
