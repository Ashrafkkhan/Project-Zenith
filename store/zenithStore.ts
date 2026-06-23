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
  /** Id of the satellite currently being tracked in 3D third-person mode, or null. */
  trackingObjectId: string | null
  /** Time Machine offset in hours added to the propagation timestamp (0 = now). */
  offsetHours: number
  upsertObjects: (objs: CelestialObject[]) => void
  setObserver: (observer: ObserverLocation) => void
  setSelectedObjectId: (id: string | null) => void
  setTrackingObjectId: (id: string | null) => void
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
    trackingObjectId: null,
    offsetHours: 0,

    upsertObjects: (objs) =>
      set(() => {
        const next = new Map()
        let maxAlt = -Infinity
        const zenithObjects: CelestialObject[] = []

        for (const obj of objs) {
          next.set(obj.id, obj)
          if (obj.inZenithWindow) {
            zenithObjects.push(obj)
          }
          if (obj.topo.altitude > maxAlt) {
            maxAlt = obj.topo.altitude
          }
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

    setTrackingObjectId: (trackingObjectId) => set({ trackingObjectId }),

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
