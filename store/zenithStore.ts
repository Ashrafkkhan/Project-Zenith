import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { CelestialObject, ObserverLocation } from '@/types/celestial'
import { ZENITH_WINDOW } from '@/types/celestial'

interface ZenithState {
  observer: ObserverLocation
  objects: Map<string, CelestialObject>
  /**
   * Solar-system bodies (Sun + planets). Held separately because the pipeline
   * replaces `objects` wholesale each tick; these are re-merged into `objects`
   * on every upsert so selection/search/panel keep finding them.
   */
  solarObjects: CelestialObject[]
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
  /** Register the solar-system bodies once; merged into `objects` immediately and on every tick. */
  setSolarObjects: (bodies: CelestialObject[]) => void
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
    solarObjects: [],
    zenithObjects: [],
    maxAltitude: null,
    showZenithCone: true,
    dataLoading: false,
    lastError: null,
    selectedObjectId: null,
    trackingObjectId: null,
    offsetHours: 0,

    upsertObjects: (objs) =>
      set((state) => {
        const next = new Map<string, CelestialObject>()
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

        // Re-merge the solar bodies after the pipeline objects (they don't count
        // toward zenithObjects / maxAltitude — those were derived from `objs` only).
        for (const body of state.solarObjects) {
          next.set(body.id, body)
        }

        return {
          objects: next,
          zenithObjects,
          maxAltitude: maxAlt > -Infinity ? maxAlt : null,
        }
      }),

    setSolarObjects: (bodies) =>
      set((state) => {
        // Store them, and merge into the live `objects` map immediately so they're
        // selectable/searchable before the next pipeline tick.
        const next = new Map(state.objects)
        for (const body of bodies) next.set(body.id, body)
        return { solarObjects: bodies, objects: next }
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
