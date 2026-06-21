'use client'

import { useZenithStore } from '@/store/zenithStore'
import { SEED_OBJECTS } from '@/lib/seedDevData'

export default function DevSeedButton() {
  const upsertObjects = useZenithStore((s) => s.upsertObjects)

  return (
    <button
      onClick={() => upsertObjects(SEED_OBJECTS)}
      className="pointer-events-auto absolute bottom-4 left-4 z-20 bg-yellow-500/15 border border-yellow-500/35 text-yellow-400 text-xs px-3 py-1.5 rounded-lg hover:bg-yellow-500/25 transition-colors font-mono"
    >
      [DEV] Seed Data
    </button>
  )
}
