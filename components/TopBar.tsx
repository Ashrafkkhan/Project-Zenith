'use client'

import { useState } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import ObserverPicker from '@/components/ObserverPicker'
import ObjectSearch from '@/components/ObjectSearch'

export default function TopBar() {
  const [pickerOpen, setPickerOpen] = useState(false)
  const observer = useZenithStore((s) => s.observer)
  const zenithCount = useZenithStore((s) => s.zenithObjects.length)
  const trackedCount = useZenithStore((s) => s.objects.size)
  // maxAltitude is computed once per pipeline tick inside upsertObjects —
  // no O(n) work here in the render path.
  const maxAltitude = useZenithStore((s) => s.maxAltitude)
  const dataLoading = useZenithStore((s) => s.dataLoading)
  const lastError = useZenithStore((s) => s.lastError)

  return (
    <>
    <div
      className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 bg-black/20 backdrop-blur-md border-b border-cyan-500/10 text-white shrink-0 z-10"
      style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
    >
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-cyan-400 font-bold text-lg tracking-tight">✦ Zenith</span>
        <span className="text-slate-500 hidden sm:inline">|</span>
        <span className="text-slate-500 text-sm hidden sm:inline">The Celestial Eye</span>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3 text-sm min-w-0">
        <ObjectSearch />

        <button
          onClick={() => setPickerOpen((o) => !o)}
          aria-expanded={pickerOpen}
          title="Change observer location"
          className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm border border-cyan-500/30 rounded-full px-3 py-1 hover:border-cyan-400/60 hover:bg-cyan-500/10 transition-all duration-150"
        >
          <span className="text-white font-medium">📍 {observer.label}</span>
          <span className="text-slate-400 font-mono hidden sm:inline">
            {observer.latitude.toFixed(4)}°N {observer.longitude.toFixed(4)}°E
          </span>
        </button>

        {/* Informational badges — hidden on phones to keep the bar to one row
            (the zenith count is also shown in the Zenith Window panel header). */}
        {zenithCount > 0 && (
          <span className="hidden sm:inline-block bg-black/40 backdrop-blur-sm border border-cyan-500/30 rounded-full px-3 py-1 text-cyan-400 text-xs font-medium">
            {zenithCount} in Zenith Window
          </span>
        )}

        {maxAltitude !== null && (
          <span className="hidden sm:inline-block bg-black/40 backdrop-blur-sm border border-cyan-500/30 rounded-full px-3 py-1 text-violet-300 text-xs font-medium font-mono">
            ↑ {maxAltitude.toFixed(1)}° max
          </span>
        )}

        {lastError ? (
          <span
            className="bg-red-500/10 text-red-400 border border-red-500/30 rounded-full px-2 sm:px-3 py-1 text-xs max-w-[8rem] sm:max-w-[14rem] truncate shrink-0"
            title={lastError}
          >
            ⚠ {lastError}
          </span>
        ) : (
          <span className="bg-black/40 backdrop-blur-sm border border-cyan-500/30 rounded-full px-2 sm:px-3 py-1 text-slate-400 text-xs font-mono flex items-center gap-1.5 shrink-0">
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${
                dataLoading ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-500/70'
              }`}
            />
            <span className="hidden sm:inline">{trackedCount} tracked</span>
          </span>
        )}
      </div>
    </div>

    <ObserverPicker open={pickerOpen} onClose={() => setPickerOpen(false)} />
    </>
  )
}
