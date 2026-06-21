export const ZENITH_WINDOW = { minAlt: 75, maxAlt: 90 } as const

export type CelestialCategory = 'satellite' | 'iss' | 'planet'

export interface TopocentricPosition {
  altitude: number
  azimuth: number
  rangekm: number
}

export interface GeoPosition {
  latitude: number
  longitude: number
  heightKm: number
}

export interface ObserverLocation {
  latitude: number
  longitude: number
  altitudeM: number
  label: string
}

export interface CelestialObject {
  id: string
  name: string
  category: CelestialCategory
  geo: GeoPosition
  /** Position at updatedAt + pipeline interval — used by the globe for smooth interpolation. */
  geoNext?: GeoPosition
  topo: TopocentricPosition
  inZenithWindow: boolean
  updatedAt: number
}
