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
  /** Id of the object whose detail panel is open, or null when none is selected. */
  selectedObjectId: string | null
  /** Time Machine offset in hours added to the propagation timestamp (0 = now). */
  offsetHours: number
  upsertObjects: (objs: CelestialObject[]) => void
  setObserver: (observer: ObserverLocation) => void
  setSelectedObjectId: (id: string | null) => void
  toggleZenithCone: () => void
  offsetTimeHours: (hours: number) => void
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
    selectedObjectId: null,
    offsetHours: 0,

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

    // Moving the observer doesn't touch `objects`: the refresh loop reads the
    // current observer on its next tick and re-derives every topocentric
    // Alt/Az (and the zenith set), while CelestialGlobe subscribes to `observer`
    // to redraw the cone + observer marker immediately.
    setObserver: (observer) => set({ observer }),

    setSelectedObjectId: (selectedObjectId) => set({ selectedObjectId }),

    toggleZenithCone: () =>
      set((state) => ({ showZenithCone: !state.showZenithCone })),

    // Time Machine: the refresh loop reads offsetHours each tick and shifts the
    // SGP4 propagation timestamp forward by that many hours (0 = live).
    offsetTimeHours: (hours) => set({ offsetHours: hours }),

    setDataLoading: (loading) => set({ dataLoading: loading }),

    setLastError: (message) => set({ lastError: message }),
  }))
)

/** The bound store instance type — used for dependency injection (e.g. refreshLoop). */
export type ZenithStore = typeof useZenithStore
