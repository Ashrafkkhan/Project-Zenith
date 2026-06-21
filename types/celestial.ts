export const ZENITH_WINDOW = { minAlt: 75, maxAlt: 90 } as const

export type CelestialCategory = 'satellite' | 'iss' | 'planet'

/**
 * Matches the International Space Station by its CelesTrak catalogue name
 * ("ISS (ZARYA)"). The `\bISS\b` word boundary avoids substring false positives
 * such as SWISSCUBE / WEISS / BLITS, and ZARYA (the unique core-module name)
 * is a reliable fallback. Shared by the SGP4 worker (categorisation) and the
 * refresh loop (live-position promotion) so the two never disagree about which
 * object is the ISS — guaranteeing a single 'iss' entry.
 */
export const ISS_NAME_PATTERN = /\bISS\b|ZARYA/i

/** True if a catalogue object name belongs to the ISS. See ISS_NAME_PATTERN. */
export function isISSName(name: string): boolean {
  return ISS_NAME_PATTERN.test(name)
}

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
  /** Source TLE lines (satellites/ISS only) — used for on-demand pass prediction. */
  line1?: string
  line2?: string
  geo: GeoPosition
  /** Position at updatedAt + pipeline interval — used by the globe for smooth interpolation. */
  geoNext?: GeoPosition
  topo: TopocentricPosition
  inZenithWindow: boolean
  updatedAt: number
}
