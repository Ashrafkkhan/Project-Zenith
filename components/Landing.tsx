'use client'

import React, { useEffect, useState } from 'react'
import { useZenithStore } from '@/store/zenithStore'

// <model-viewer> is a custom element registered at runtime by @google/model-viewer.
// Aliasing the tag name through `as` lets us use it in JSX with arbitrary attributes
// without fighting the type system; at runtime this is just the string 'model-viewer'.
const ModelViewer = 'model-viewer' as unknown as React.ComponentType<Record<string, unknown>>

// Texture-optimised copy (~11 MB vs ~32 MB original) for fast load + smooth playback.
const ASTRONAUT_SRC = '/models/astronaut-opt.glb'
const FACT_INTERVAL_MS = 5_500

const FACTS: { emoji: string; title: string; body: string }[] = [
  {
    emoji: '🚀',
    title: 'Earth is travelling insanely fast',
    body:
      "Earth spins at ~1,670 km/h at the equator, orbits the Sun at ~107,000 km/h, and rides through the Milky Way at ~828,000 km/h — yet you feel none of it, because everything around you is moving with you.",
  },
  {
    emoji: '🌌',
    title: 'Every atom in you came from a star',
    body:
      'The carbon in your body, the oxygen you breathe, and the iron in your blood were forged inside ancient stars that exploded billions of years ago. You are literally made of stardust.',
  },
  {
    emoji: '🌍',
    title: 'Earth was hit by a Mars-sized world',
    body:
      'A Mars-sized object called Theia is thought to have slammed into the young Earth — and the debris from that colossal impact eventually formed the Moon.',
  },
  {
    emoji: '🌙',
    title: 'The Moon is slowly leaving us',
    body:
      'The Moon drifts ~3.8 cm farther from Earth every year. Hundreds of millions of years from now, total solar eclipses will no longer be possible.',
  },
]

export default function Landing() {
  // The globe app is mounted behind this overlay; it flips globeReady once loaded.
  const globeReady = useZenithStore((s) => s.globeReady)
  const setGlobeLowPower = useZenithStore((s) => s.setGlobeLowPower)
  const [factIndex, setFactIndex] = useState(0)
  const [dismissing, setDismissing] = useState(false)
  const [gone, setGone] = useState(false)

  // Load the model-viewer web component (client-only).
  useEffect(() => {
    import('@google/model-viewer').catch(() => {})
  }, [])

  // While the landing is up, throttle the globe behind it so the astronaut gets
  // the GPU (smoother load + playback). Restored when the overlay goes away.
  useEffect(() => {
    setGlobeLowPower(true)
    return () => setGlobeLowPower(false)
  }, [setGlobeLowPower])

  // Cycle the facts.
  useEffect(() => {
    const id = setInterval(() => setFactIndex((i) => (i + 1) % FACTS.length), FACT_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  const launch = () => {
    if (!globeReady) return
    setGlobeLowPower(false) // let the globe run full-speed as it's revealed
    setDismissing(true) // fade the overlay out → reveals the already-rendered globe
  }

  if (gone) return null

  const fact = FACTS[factIndex]

  return (
    <div
      role="dialog"
      aria-label="Project Zenith intro"
      aria-hidden={dismissing}
      onTransitionEnd={() => {
        if (dismissing) setGone(true)
      }}
      className={`landing-stars fixed inset-0 z-50 overflow-hidden text-white transition-opacity duration-700 ease-out ${
        dismissing ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Ambient glow accents */}
      <div
        className="pointer-events-none absolute -top-1/4 right-0 h-[60vh] w-[60vh] rounded-full opacity-40 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(56,189,248,0.25), transparent 60%)' }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/3 h-[40vh] w-[40vh] rounded-full opacity-30 blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(124,58,237,0.25), transparent 60%)' }}
      />

      <div className="relative flex min-h-[100dvh] flex-col lg:flex-row">
        {/* Content column. pointer-events-none on the wrapper lets drags pass through
            to the astronaut; only the inner block re-enables pointer events. */}
        <div className="pointer-events-none relative z-10 flex min-h-[100dvh] w-full flex-col justify-center px-6 py-10 sm:px-10 lg:w-[42%] lg:px-14">
          <div className="pointer-events-auto max-w-xl">
            <p className="mb-3 font-mono text-xs tracking-[0.35em] text-cyan-400/80 sm:text-sm">
              ✦ PROJECT ZENITH
            </p>

            <h1 className="font-black leading-[0.86] tracking-tight">
              <span className="block text-5xl sm:text-7xl lg:text-8xl">CELESTIAL</span>
              <span className="text-outline block text-5xl sm:text-7xl lg:text-8xl">EYE.</span>
            </h1>

            <p className="mt-5 max-w-md text-sm text-slate-300 sm:text-base">
              Track every satellite, the ISS, and a living solar system — in real time,
              directly above you.
            </p>

            {/* Rotating space fact */}
            <div className="mt-8 max-w-md rounded-2xl border border-cyan-500/20 bg-black/30 p-4 backdrop-blur-md">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-widest text-cyan-400/70">
                Did you know?
              </div>
              <div key={factIndex} className="landing-fact">
                <div className="text-base font-semibold text-white sm:text-lg">
                  <span className="mr-1.5">{fact.emoji}</span>
                  {fact.title}
                </div>
                <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{fact.body}</p>
              </div>
              <div className="mt-3 flex gap-1.5">
                {FACTS.map((_, i) => (
                  <span
                    key={i}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      i === factIndex ? 'w-5 bg-cyan-400' : 'w-2 bg-white/20'
                    }`}
                  />
                ))}
              </div>
            </div>

            {/* Launch — enabled only once the globe behind is fully loaded */}
            <div className="mt-8">
              <button
                onClick={launch}
                disabled={!globeReady}
                aria-busy={!globeReady}
                className={`rounded-full px-7 py-3 text-sm font-bold uppercase tracking-wider transition-transform duration-150 ${
                  globeReady
                    ? 'launch-glow cursor-pointer bg-[#ff5a1f] text-white hover:scale-[1.03] active:scale-95'
                    : 'cursor-not-allowed bg-white/10 text-slate-400'
                }`}
              >
                {globeReady ? (
                  'Launch ✦'
                ) : (
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-cyan-400" />
                    Preparing your sky…
                  </span>
                )}
              </button>
              <p className="mt-2 font-mono text-[11px] text-slate-500">
                {globeReady
                  ? 'Your live sky is ready — launch when you are.'
                  : 'Loading the real-time globe in the background…'}
              </p>
            </div>
          </div>
        </div>

        {/* Astronaut — its own column on desktop (fully interactive: drag to rotate,
            scroll to zoom); a faded auto-rotating backdrop on mobile. */}
        <div className="astro-float pointer-events-none absolute inset-0 z-0 lg:static lg:flex-1 lg:pointer-events-auto">
          <ModelViewer
            {...{
              src: ASTRONAUT_SRC,
              alt: 'Astronaut in a space suit — drag to rotate',
              loading: 'eager', // start fetching the model immediately (no lazy wait)
              // Empty-string = a present boolean attribute (robust across React versions).
              'camera-controls': '',
              'auto-rotate': '',
              autoplay: '',
              'touch-action': 'pan-y',
              'rotation-per-second': '16deg',
              'shadow-intensity': '0',
              exposure: '1.05',
              'camera-orbit': '0deg 85deg 105%',
              style: { width: '100%', height: '100%', backgroundColor: 'transparent' },
            }}
          />
        </div>

        {/* Mobile legibility wash (astronaut is a backdrop there) */}
        <div className="pointer-events-none absolute inset-0 z-[1] bg-gradient-to-b from-[#04040c]/60 via-transparent to-[#04040c]/85 lg:hidden" />
      </div>
    </div>
  )
}
