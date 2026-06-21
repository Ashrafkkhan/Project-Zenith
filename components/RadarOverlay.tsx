'use client'

import { useEffect, useRef } from 'react'
import { useZenithStore } from '@/store/zenithStore'

export default function RadarOverlay() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let animFrameId: number
    let angle = 0 // current sweep angle in radians
    const SWEEP_SPEED = 0.008 // radians per frame (~1 full rotation per ~3 seconds)
    const flashMap = new Map<string, number>() // id → flash intensity 0–1

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resize()
    window.addEventListener('resize', resize)

    // HUD position: bottom-left, 200px from edges.
    const getCentre = () => ({ x: 200, y: canvas.height - 200 })
    const RADIUS = 160

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const { x, y } = getCentre()
      const { zenithObjects, objects } = useZenithStore.getState()

      // ── Background circle ───────────────────────────────────────────────────
      ctx.beginPath()
      ctx.arc(x, y, RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(5, 5, 20, 0.75)'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.3)'
      ctx.lineWidth = 1
      ctx.stroke()

      // ── Concentric rings ────────────────────────────────────────────────────
      for (const r of [0.25, 0.5, 0.75, 1.0]) {
        ctx.beginPath()
        ctx.arc(x, y, RADIUS * r, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(0, 212, 255, 0.12)'
        ctx.lineWidth = 0.5
        ctx.stroke()
      }

      // ── Cross hairs ─────────────────────────────────────────────────────────
      ctx.strokeStyle = 'rgba(0, 212, 255, 0.1)'
      ctx.lineWidth = 0.5
      ctx.beginPath()
      ctx.moveTo(x - RADIUS, y); ctx.lineTo(x + RADIUS, y)
      ctx.moveTo(x, y - RADIUS); ctx.lineTo(x, y + RADIUS)
      ctx.stroke()

      // ── Cardinal labels ─────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(0, 212, 255, 0.4)'
      ctx.font = '9px monospace'
      ctx.textAlign = 'center'
      ctx.fillText('N', x, y - RADIUS - 6)
      ctx.fillText('S', x, y + RADIUS + 12)
      ctx.textAlign = 'left'
      ctx.fillText('E', x + RADIUS + 6, y + 3)
      ctx.textAlign = 'right'
      ctx.fillText('W', x - RADIUS - 6, y + 3)

      // ── Sweep trail (fan of arcs with decreasing opacity) ───────────────────
      const TRAIL_LENGTH = Math.PI * 0.5 // 90° trail
      const TRAIL_STEPS = 24
      for (let i = 0; i < TRAIL_STEPS; i++) {
        const trailAngle = angle - (TRAIL_LENGTH * i) / TRAIL_STEPS
        const alpha = (1 - i / TRAIL_STEPS) * 0.18
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.arc(x, y, RADIUS, trailAngle - TRAIL_LENGTH / TRAIL_STEPS, trailAngle)
        ctx.closePath()
        ctx.fillStyle = `rgba(0, 212, 255, ${alpha})`
        ctx.fill()
      }

      // ── Sweep line ──────────────────────────────────────────────────────────
      const sweepX = x + Math.cos(angle) * RADIUS
      const sweepY = y + Math.sin(angle) * RADIUS
      const lineGrad = ctx.createLinearGradient(x, y, sweepX, sweepY)
      lineGrad.addColorStop(0, 'rgba(0, 212, 255, 0)')
      lineGrad.addColorStop(1, 'rgba(0, 212, 255, 0.9)')
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(sweepX, sweepY)
      ctx.strokeStyle = lineGrad
      ctx.lineWidth = 1.5
      ctx.stroke()

      // ── Satellite dots ──────────────────────────────────────────────────────
      // Only above-horizon objects — altitude > 0.
      // Azimuth 0° = North = top of radar. Altitude 90° = centre.
      const allObjects = Array.from(objects.values()).filter((o) => o.topo.altitude > 0)

      for (const obj of allObjects) {
        const range = 1 - obj.topo.altitude / 90
        const azRad = (obj.topo.azimuth * Math.PI) / 180 - Math.PI / 2 // 0°=N=up
        const dotX = x + Math.cos(azRad) * RADIUS * range
        const dotY = y + Math.sin(azRad) * RADIUS * range

        // Trigger flash when the sweep line passes this dot.
        const dotAngle = Math.atan2(dotY - y, dotX - x)
        const angleDiff =
          ((angle - dotAngle) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
        if (angleDiff < 0.15) flashMap.set(obj.id, 1.0)

        // Decay flash each frame.
        const flash = flashMap.get(obj.id) ?? 0
        if (flash > 0) flashMap.set(obj.id, flash - 0.02)

        let baseColor = '0, 212, 255'
        if (obj.category === 'iss') baseColor = '255, 204, 2'
        if (obj.category === 'planet') baseColor = '255, 140, 105'

        const isZenith = obj.inZenithWindow
        const flashIntensity = flashMap.get(obj.id) ?? 0
        const alpha = isZenith ? 1.0 : 0.5 + flashIntensity * 0.5
        const size = isZenith ? 3.5 : 2 + flashIntensity * 2

        // Glow halo for zenith objects or freshly flashed dots.
        if (isZenith || flashIntensity > 0.3) {
          ctx.beginPath()
          ctx.arc(dotX, dotY, size + 4, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${baseColor}, ${isZenith ? 0.3 : flashIntensity * 0.4})`
          ctx.fill()
        }

        ctx.beginPath()
        ctx.arc(dotX, dotY, size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${baseColor}, ${alpha})`
        ctx.fill()
      }

      // ── Observer dot ────────────────────────────────────────────────────────
      ctx.beginPath()
      ctx.arc(x, y, 3, 0, Math.PI * 2)
      ctx.fillStyle = '#c4b5fd'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(x, y, 7, 0, Math.PI * 2)
      ctx.strokeStyle = 'rgba(196, 181, 253, 0.4)'
      ctx.lineWidth = 1
      ctx.stroke()

      // ── HUD labels ──────────────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(196, 181, 253, 0.6)'
      ctx.font = '9px monospace'
      ctx.textAlign = 'left'
      ctx.fillText('ZENITH RADAR', x - RADIUS, y - RADIUS - 18)
      ctx.fillStyle = 'rgba(0, 212, 255, 0.4)'
      ctx.fillText(`${zenithObjects.length} OVERHEAD`, x - RADIUS, y - RADIUS - 6)

      // ── Advance angle ────────────────────────────────────────────────────────
      angle = (angle + SWEEP_SPEED) % (Math.PI * 2)
      animFrameId = requestAnimationFrame(draw)
    }

    animFrameId = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animFrameId)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none z-10"
      style={{ mixBlendMode: 'screen' }}
    />
  )
}
