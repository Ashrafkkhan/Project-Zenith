'use client'

import { useEffect, useRef, useState } from 'react'
import { useZenithStore } from '@/store/zenithStore'

// SVG radar geometry (viewBox units == pixels at the rendered size).
const SIZE = 200
const CENTER = SIZE / 2
const RADIUS = 96 // outer ring radius
// Zenith altitude band: 75°–90° maps to the inner 0%–16.7% of the radar radius.
const ZENITH_BAND_RADIUS = RADIUS * 0.167

/** Project an above-horizon object onto the radar: az 0°=N=up, alt 90°=centre. */
function project(azimuthDeg: number, altitudeDeg: number) {
  const azRad = (azimuthDeg * Math.PI) / 180 - Math.PI / 2 // 0°=N=up
  const range = 1 - altitudeDeg / 90 // 90° (overhead) → centre
  return {
    x: CENTER + Math.cos(azRad) * RADIUS * range,
    y: CENTER + Math.sin(azRad) * RADIUS * range,
  }
}

export default function RadarOverlay() {
  // Only zenith-window objects are plotted (Change 7). Re-renders when the set
  // changes — no rAF loop needed for a handful of dots.
  const zenithObjects = useZenithStore((s) => s.zenithObjects)

  // Sonar pulse driven by requestAnimationFrame (native frame rate) instead of a
  // 50 ms interval. A single batched setState per frame avoids two re-renders,
  // and rAF auto-pauses when the tab is backgrounded.
  const [pulse, setPulse] = useState({ r: 40, opacity: 0.5 })
  const rafRef = useRef<number | undefined>(undefined)
  const startTimeRef = useRef<number>(Date.now())
  useEffect(() => {
    const animate = () => {
      const elapsed = (Date.now() - startTimeRef.current) % 2500
      const progress = elapsed / 2500 // 0 → 1 over 2.5 s
      setPulse({ r: 40 + progress * 10, opacity: 0.5 * (1 - progress) })
      rafRef.current = requestAnimationFrame(animate)
    }
    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [])

  return (
    <div
      className="absolute bottom-4 left-4 z-10 pointer-events-none"
      style={{ width: SIZE, height: SIZE }}
    >
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        style={{ mixBlendMode: 'screen' }}
      >
        {/* Background disc */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={RADIUS}
          fill="rgba(5,5,20,0.55)"
          stroke="rgba(6,182,212,0.3)"
          strokeWidth={1}
        />

        {/* Concentric range rings */}
        {[0.25, 0.5, 0.75].map((f) => (
          <circle
            key={f}
            cx={CENTER}
            cy={CENTER}
            r={RADIUS * f}
            fill="none"
            stroke="rgba(6,182,212,0.12)"
            strokeWidth={0.5}
          />
        ))}

        {/* Cross hairs */}
        <line
          x1={CENTER - RADIUS}
          y1={CENTER}
          x2={CENTER + RADIUS}
          y2={CENTER}
          stroke="rgba(6,182,212,0.1)"
          strokeWidth={0.5}
        />
        <line
          x1={CENTER}
          y1={CENTER - RADIUS}
          x2={CENTER}
          y2={CENTER + RADIUS}
          stroke="rgba(6,182,212,0.1)"
          strokeWidth={0.5}
        />

        {/* Zenith altitude band (75°–90°) */}
        <circle
          cx={CENTER}
          cy={CENTER}
          r={ZENITH_BAND_RADIUS}
          fill="rgba(6,182,212,0.06)"
          stroke="rgba(6,182,212,0.25)"
          strokeWidth={0.5}
        />

        {/* Pulsing sonar ring (JS-driven r + opacity) */}
        <circle
          cx="50%"
          cy="50%"
          r={`${pulse.r}%`}
          fill="none"
          stroke="rgba(6,182,212,0.4)"
          strokeWidth={1}
          opacity={pulse.opacity}
        />

        {/* Rotating sweep line */}
        <g
          className="animate-spin"
          style={{ transformOrigin: '50% 50%', animationDuration: '4s' }}
        >
          <line
            x1={CENTER}
            y1={CENTER}
            x2={CENTER}
            y2={CENTER - RADIUS}
            stroke="rgba(6,182,212,0.7)"
            strokeWidth={1.5}
          />
        </g>

        {/* Cardinal labels */}
        <text
          x={CENTER}
          y={14}
          textAnchor="middle"
          fill="currentColor"
          className="text-cyan-400/60 text-[10px] font-mono"
        >
          N
        </text>
        <text
          x={CENTER}
          y={SIZE - 6}
          textAnchor="middle"
          fill="currentColor"
          className="text-cyan-400/60 text-[10px] font-mono"
        >
          S
        </text>
        <text
          x={SIZE - 8}
          y={CENTER + 4}
          textAnchor="middle"
          fill="currentColor"
          className="text-cyan-400/60 text-[10px] font-mono"
        >
          E
        </text>
        <text
          x={10}
          y={CENTER + 4}
          textAnchor="middle"
          fill="currentColor"
          className="text-cyan-400/60 text-[10px] font-mono"
        >
          W
        </text>

        {/* Observer at centre */}
        <circle cx={CENTER} cy={CENTER} r={2.5} fill="#c4b5fd" />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={6}
          fill="none"
          stroke="rgba(196,181,253,0.4)"
          strokeWidth={1}
        />

        {/* Zenith-window object dots: ISS gold (r=4), others cyan (r=3) */}
        {zenithObjects.map((o) => {
          const { x, y } = project(o.topo.azimuth, o.topo.altitude)
          const isISS = o.category === 'iss'
          return (
            <circle
              key={o.id}
              cx={x}
              cy={y}
              r={isISS ? 4 : 3}
              fill={isISS ? '#ffcc02' : '#4fc3f7'}
            />
          )
        })}
      </svg>
    </div>
  )
}
