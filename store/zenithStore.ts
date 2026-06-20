import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { CelestialObject, ObserverLocation } from '@/types/celestial'
import { ZENITH_WINDOW } from '@/types/celestial'

interface ZenithState {
  observer: ObserverLocation
  objects: Map<string, CelestialObject>
  zenithObjects: CelestialObject[]
  /** Highest topocentric altitude among all tracked objects. Computed in upsertObjects. */
  maxAltitude: number | null
  showZenithCone: boolean
  dataLoading: boolean
  lastError: string | null
  upsertObjects: (objs: CelestialObject[]) => void
  toggleZenithCone: () => void
  setDataLoading: (loading: boolean) => void
  setLastError: (message: string | null) => void
}

export const useZenithStore = create<ZenithState>()(
  subscribeWithSelector((set) => ({
    observer: {
      latitude: 12.9716,
      longitude: 80.2437,
      altitudeM: 0,
      label: 'Chennai',
    },
    objects: new Map(),
    zenithObjects: [],
    maxAltitude: null,
    showZenithCone: true,
    dataLoading: false,
    lastError: null,

    upsertObjects: (objs) =>
      set((state) => {
        const next = new Map(state.objects)
        for (const obj of objs) {
          next.set(obj.id, {
            ...obj,
            inZenithWindow:
              obj.topo.altitude >= ZENITH_WINDOW.minAlt &&
              obj.topo.altitude <= ZENITH_WINDOW.maxAlt,
          })
        }
        const zenithObjects = [...next.values()].filter((o) => o.inZenithWindow)
        // O(n) scan happens once per pipeline tick inside the setter — not in render.
        let maxAlt = -Infinity
        for (const o of next.values()) {
          if (o.topo.altitude > maxAlt) maxAlt = o.topo.altitude
        }
        return {
          objects: next,
          zenithObjects,
          maxAltitude: maxAlt > -Infinity ? maxAlt : null,
        }
      }),

    toggleZenithCone: () =>
      set((state) => ({ showZenithCone: !state.showZenithCone })),

    setDataLoading: (loading) => set({ dataLoading: loading }),

    setLastError: (message) => set({ lastError: message }),
  }))
)
