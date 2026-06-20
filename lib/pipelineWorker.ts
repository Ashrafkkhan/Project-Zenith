import { useZenithStore } from '@/store/zenithStore'
import type { WorkerOutMessage } from './sgp4Worker'

/**
 * Start the data pipeline. All SGP4 propagation runs inside a Web Worker so
 * the main thread stays free for Cesium rendering and React reconciliation.
 * Returns a cleanup function that terminates the worker and clears the interval.
 */
export function startPipeline(intervalMs = 10_000): () => void {
  const { setDataLoading, setLastError, upsertObjects } = useZenithStore.getState()

  let worker: Worker
  try {
    worker = new Worker(new URL('./sgp4Worker.ts', import.meta.url))
  } catch (err) {
    console.error('[pipeline] Failed to create Web Worker:', err)
    setLastError('Web Worker unavailable')
    return () => {}
  }

  worker.addEventListener('message', (e: MessageEvent<WorkerOutMessage>) => {
    const msg = e.data
    if (msg.type === 'result') {
      upsertObjects(msg.objects)
      setLastError(null)
    } else if (msg.type === 'error') {
      setLastError(msg.message)
    } else if (msg.type === 'loading') {
      setDataLoading(msg.value)
    }
  })

  worker.addEventListener('error', (e) => {
    setLastError(e.message ?? 'Worker error')
    setDataLoading(false)
  })

  const sendTick = () => {
    const observer = useZenithStore.getState().observer
    worker.postMessage({ type: 'tick', observer, intervalMs })
  }

  sendTick()
  const handle = setInterval(sendTick, intervalMs)

  return () => {
    clearInterval(handle)
    worker.terminate()
  }
}
