'use client'

import { useEffect, useRef, useState } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { PassEvent } from '@/lib/passPredictions'
import type { PredictPassesMessage, WorkerOutMessage } from '@/lib/sgp4Worker'

interface PassPredictionPanelProps {
  selectedObjectId: string | null
}

function formatRise(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function PassPredictionPanel({ selectedObjectId }: PassPredictionPanelProps) {
  // Primitive selectors so the panel doesn't re-render every pipeline tick
  // (the object reference changes each tick, but these strings are stable).
  const name = useZenithStore((s) =>
    selectedObjectId ? s.objects.get(selectedObjectId)?.name : undefined
  )
  const line1 = useZenithStore((s) =>
    selectedObjectId ? s.objects.get(selectedObjectId)?.line1 : undefined
  )
  const line2 = useZenithStore((s) =>
    selectedObjectId ? s.objects.get(selectedObjectId)?.line2 : undefined
  )
  const observer = useZenithStore((s) => s.observer)

  const workerRef = useRef<Worker | null>(null)
  const currentReqId = useRef<string | null>(null)

  const [passes, setPasses] = useState<PassEvent[] | null>(null)
  const [loading, setLoading] = useState(false)

  // One dedicated worker for predictions, kept off the live propagation worker
  // so a 24 h scan never delays a pipeline tick.
  useEffect(() => {
    const worker = new Worker(new URL('../lib/sgp4Worker.ts', import.meta.url))
    workerRef.current = worker

    const onMessage = (e: MessageEvent<WorkerOutMessage>) => {
      const msg = e.data
      if (msg.type === 'PASS_PREDICTIONS' && msg.id === currentReqId.current) {
        setPasses(msg.passes)
        setLoading(false)
      }
    }
    worker.addEventListener('message', onMessage)

    return () => {
      worker.removeEventListener('message', onMessage)
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  // Recompute whenever the selection, its TLE, or the observer changes.
  useEffect(() => {
    if (!selectedObjectId || !line1 || !line2) {
      currentReqId.current = null
      setPasses(null)
      setLoading(false)
      return
    }
    const worker = workerRef.current
    if (!worker) return

    const reqId = `${selectedObjectId}:${Date.now()}`
    currentReqId.current = reqId
    setLoading(true)
    setPasses(null)

    worker.postMessage({
      type: 'PREDICT_PASSES',
      id: reqId,
      tle1: line1,
      tle2: line2,
      observerLat: observer.latitude,
      observerLng: observer.longitude,
      observerAltM: observer.altitudeM,
      hoursAhead: 24,
    } satisfies PredictPassesMessage)
  }, [selectedObjectId, line1, line2, observer])

  if (!selectedObjectId) return null

  const hasTle = Boolean(line1 && line2)

  return (
    <div className="fixed right-4 bottom-4 w-72 rounded-xl bg-black/70 backdrop-blur-md border border-sky-400/20 text-white text-sm shadow-2xl z-30">
      <div className="px-4 py-3 border-b border-sky-400/15">
        <div className="font-semibold text-sky-400 tracking-tight truncate">
          {name ?? 'Object'}
        </div>
        <div className="text-zinc-500 text-xs">Passes · next 24 h</div>
      </div>

      <div className="max-h-72 overflow-y-auto" style={{ contentVisibility: 'auto' }}>
        {!hasTle ? (
          <p className="px-4 py-5 text-zinc-600 text-center text-xs">
            Pass predictions aren’t available for this object.
          </p>
        ) : loading ? (
          <div className="flex items-center justify-center gap-2 px-4 py-6 text-zinc-400 text-xs">
            <span
              className="inline-block h-4 w-4 rounded-full border-2 border-sky-400/30 border-t-sky-400 animate-spin"
              aria-hidden
            />
            Computing passes…
          </div>
        ) : passes && passes.length === 0 ? (
          <p className="px-4 py-5 text-zinc-500 text-center text-xs">
            No visible passes in the next 24 hours
          </p>
        ) : (
          passes?.map((pass, i) => (
            <div
              key={`${pass.riseTime.getTime()}-${i}`}
              className="px-4 py-2.5 border-b border-white/5"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-white tabular-nums">
                  {formatRise(pass.riseTime)}
                </span>
                <span className="text-sky-300 text-xs font-semibold tabular-nums">
                  ↑ {pass.maxAltitude.toFixed(0)}°
                </span>
              </div>
              <div className="text-zinc-500 text-xs mt-1 tabular-nums">
                Duration {formatDuration(pass.durationSeconds)}
                <span className="ml-2 text-zinc-600">
                  peak az {pass.maxAzimuth.toFixed(0)}°
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {hasTle && passes && passes.length > 0 && (
        <div className="px-4 py-2 text-zinc-600 text-[10px] text-right">
          {passes.length} pass{passes.length !== 1 ? 'es' : ''} in 24 h
        </div>
      )}
    </div>
  )
}
