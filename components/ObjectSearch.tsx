'use client'

import { useMemo, useRef, useState } from 'react'
import { useZenithStore } from '@/store/zenithStore'

const CATEGORY_BADGE: Record<string, string> = {
  satellite: 'text-cyan-400',
  iss: 'text-yellow-300',
  planet: 'text-orange-300',
}

/**
 * Unified object search — satellites, the ISS, and solar-system planets all live
 * in the same store `objects` map, so one box searches them all. Selecting a
 * result drives the existing `selectedObjectId` flow: the detail panel opens, and
 * (for planets) the solar-system module flies the camera to it.
 */
export default function ObjectSearch() {
  const objects = useZenithStore((s) => s.objects)
  const setSelectedObjectId = useZenithStore((s) => s.setSelectedObjectId)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: { id: string; name: string; category: string }[] = []
    for (const o of objects.values()) {
      if (o.name.toLowerCase().includes(q)) {
        out.push({ id: o.id, name: o.name, category: o.category })
        if (out.length >= 8) break
      }
    }
    // Planets + ISS first (fewer, more "interesting"), then satellites, then A–Z.
    const rank = (c: string) => (c === 'planet' ? 0 : c === 'iss' ? 1 : 2)
    return out.sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name))
  }, [query, objects])

  const select = (id: string) => {
    setSelectedObjectId(id)
    setQuery('')
    inputRef.current?.blur()
  }

  const open = focused && query.trim() !== ''

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm border border-cyan-500/30 rounded-full px-3 py-1 focus-within:border-cyan-400/60 transition-colors duration-150">
        <span className="text-slate-400 text-xs">🔍</span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          // Delay so a result's onMouseDown registers before the dropdown unmounts.
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          placeholder="Search…"
          className="bg-transparent text-white text-sm placeholder:text-slate-500 outline-none w-24 sm:w-40"
        />
        {query && (
          <button
            onClick={() => { setQuery(''); inputRef.current?.focus() }}
            aria-label="Clear search"
            className="text-slate-500 hover:text-white text-xs leading-none"
          >
            ✕
          </button>
        )}
      </div>

      {open && (
        <div className="absolute right-0 sm:right-auto sm:left-0 mt-1.5 w-64 max-w-[calc(100vw-1.5rem)] max-h-72 overflow-y-auto rounded-xl bg-black/80 backdrop-blur-md border border-cyan-500/20 shadow-2xl z-50 py-1">
          {matches.length === 0 ? (
            <p className="px-3 py-2 text-slate-500 text-xs">No matches</p>
          ) : (
            matches.map((m) => (
              <button
                key={m.id}
                // onMouseDown beats the input's onBlur so the selection lands.
                onMouseDown={(e) => { e.preventDefault(); select(m.id) }}
                className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-cyan-500/10 transition-colors duration-100"
              >
                <span className="text-white text-sm truncate">{m.name}</span>
                <span
                  className={`shrink-0 text-[10px] font-mono uppercase ${
                    CATEGORY_BADGE[m.category] ?? 'text-slate-400'
                  }`}
                >
                  {m.category}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
