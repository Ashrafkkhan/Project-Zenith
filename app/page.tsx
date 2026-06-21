'use client'

import { useEffect, useState } from 'react'
import TopBar from '@/components/TopBar'
import ZenithWindow from '@/components/ZenithWindow'
import DevSeedButton from '@/components/DevSeedButton'
import GlobeWrapper from '@/components/GlobeWrapper'
import RadarOverlay from '@/components/RadarOverlay'
import { startPipeline } from '@/lib/pipelineWorker'

export default function Home() {
  const [showDev, setShowDev] = useState(false)

  // Real-time data pipeline: starts on mount, cleans up on unmount.
  useEffect(() => {
    const stop = startPipeline()
    return stop
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
        <ZenithWindow />
        {showDev && <DevSeedButton />}
      </div>
    </main>
  )
}
