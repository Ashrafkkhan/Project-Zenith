'use client'

import { useEffect, useState } from 'react'
import TopBar from '@/components/TopBar'
import ZenithWindow from '@/components/ZenithWindow'
import DevSeedButton from '@/components/DevSeedButton'
import GlobeWrapper from '@/components/GlobeWrapper'
import RadarOverlay from '@/components/RadarOverlay'
import PassPredictionPanel from '@/components/PassPredictionPanel'
import { startRefreshLoop } from '@/lib/refreshLoop'
import { useZenithStore } from '@/store/zenithStore'

export default function Home() {
  const [showDev, setShowDev] = useState(false)
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null)

  // Real-time data pipeline: starts on mount, cleans up on unmount.
  useEffect(() => {
    const stopRefreshLoop = startRefreshLoop(useZenithStore)
    return stopRefreshLoop
  }, [])

  // DevSeedButton is no longer auto-shown — opt in with ?dev=true.
  useEffect(() => {
    setShowDev(new URLSearchParams(window.location.search).get('dev') === 'true')
  }, [])

  return (
    <main className="flex flex-col h-screen bg-[#050510] overflow-hidden">
      <TopBar />
      <div className="relative flex-1 overflow-hidden">
        <GlobeWrapper />
        <RadarOverlay />
        <ZenithWindow
          selectedObjectId={selectedObjectId}
          onSelectObject={setSelectedObjectId}
        />
        <PassPredictionPanel selectedObjectId={selectedObjectId} />
        {showDev && <DevSeedButton />}
      </div>
    </main>
  )
}
