/**
 * 3D solar system built AROUND the existing Cesium Earth — without touching it.
 *
 * Architecture (the "Earth as fixed anchor" model):
 *   - Earth is Cesium's globe, immovable at the world origin. We never touch it,
 *     its satellites, the cone, the observer marker, or the camera defaults.
 *   - The Sun orbits the fixed Earth at one scene-AU (this is the Earth–Sun
 *     revolution expressed in Earth's reference frame — relative motion identical
 *     to a heliocentric model, but Earth stays the still point).
 *   - Each planet orbits the (moving) Sun at its own scaled radius + period, so the
 *     Sun visibly carries its whole planetary retinue around Earth.
 *   - The Moon orbits Earth directly.
 *   - Every body self-rotates; the Sun rotates slowly.
 *
 * All positions are CallbackProperties driven by viewer.clock time, so they animate
 * smoothly every frame with zero per-tick store churn. Bodies are revealed
 * progressively as the camera zooms out (so the opening view is byte-for-byte the
 * current Earth view). Bodies are registered in the Zustand store so clicking /
 * searching / the detail panel all reuse the existing satellite machinery.
 *
 * Receives `Cesium` + `viewer` as `any` to match CelestialGlobe's dynamic-import
 * style and avoid wrestling Cesium's types through the dynamic boundary.
 */

import type { ZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'

// ── Scene scale (tunable) ─────────────────────────────────────────────────────
// 1 AU in scene metres. Real GEO sits at ~4.2e7 m from Earth's centre, so placing
// Earth's orbit at 8e8 m keeps the whole solar system well clear of the satellite
// swarm — you must zoom out past every satellite before the Sun appears.
const SCENE_AU = 8e8
// One Earth year takes this many real seconds (demo speed). Inner planets visibly
// zip around; outer planets crawl, exactly as in reality.
const SCENE_YEAR_SEC = 90
// Moon orbit around Earth — compressed inward of the planetary system but still
// clear of the satellites, so it reads as "the Moon going around Earth".
const MOON_DIST = 1.2e8
const MOON_PERIOD_SEC = 14
const MOON_RADIUS = 2.6e6

const TWO_PI = Math.PI * 2

interface BodyConfig {
  id: string
  name: string
  uri: string
  /** Semi-major axis in AU (0 for the Sun, which instead orbits Earth). */
  auFromSun: number
  /** Orbital period in years (0 for the Sun → uses Earth's 1-year period). */
  periodYears: number
  /** Self-rotation period in real seconds. */
  spinSec: number
  /** Fixed starting angle so the planets aren't initially collinear. */
  phase0: number
  /** minimumPixelSize — keeps the body visible as a dot when zoomed far out. */
  minPx: number
  /** Tint for the label + selection silhouette. */
  color: string
  facts: { label: string; value: string }[]
}

// Real relative orbital radii (AU) and periods (years). Diameters etc. are shown
// in the detail panel. The Sun's auFromSun=0 → it orbits Earth at 1 AU instead.
const BODIES: BodyConfig[] = [
  {
    id: 'sol-sun', name: 'Sun', uri: '/models/sun.glb',
    auFromSun: 0, periodYears: 0, spinSec: 50, phase0: 0, minPx: 90, color: '#ffcf5c',
    facts: [
      { label: 'Type', value: 'G-type main-sequence star' },
      { label: 'Diameter', value: '1,392,700 km' },
      { label: 'Surface temp', value: '5,505 °C' },
      { label: 'Mass', value: '99.86% of the solar system' },
    ],
  },
  {
    id: 'sol-mercury', name: 'Mercury', uri: '/models/mercury.glb',
    auFromSun: 0.39, periodYears: 0.24, spinSec: 18, phase0: 0.6, minPx: 16, color: '#b9b2a6',
    facts: [
      { label: 'Distance from Sun', value: '0.39 AU' },
      { label: 'Orbital period', value: '88 days' },
      { label: 'Diameter', value: '4,879 km' },
      { label: 'Moons', value: '0' },
    ],
  },
  {
    id: 'sol-venus', name: 'Venus', uri: '/models/venus.glb',
    auFromSun: 0.72, periodYears: 0.62, spinSec: 24, phase0: 2.1, minPx: 24, color: '#e6c9a0',
    facts: [
      { label: 'Distance from Sun', value: '0.72 AU' },
      { label: 'Orbital period', value: '225 days' },
      { label: 'Diameter', value: '12,104 km' },
      { label: 'Moons', value: '0' },
    ],
  },
  {
    id: 'sol-mars', name: 'Mars', uri: '/models/mars.glb',
    auFromSun: 1.52, periodYears: 1.88, spinSec: 13, phase0: 3.7, minPx: 20, color: '#e27b58',
    facts: [
      { label: 'Distance from Sun', value: '1.52 AU' },
      { label: 'Orbital period', value: '687 days' },
      { label: 'Diameter', value: '6,779 km' },
      { label: 'Moons', value: '2 (Phobos, Deimos)' },
    ],
  },
  {
    id: 'sol-jupiter', name: 'Jupiter', uri: '/models/realistic_jupiter.glb',
    auFromSun: 5.20, periodYears: 11.86, spinSec: 10, phase0: 5.0, minPx: 50, color: '#d8b88f',
    facts: [
      { label: 'Distance from Sun', value: '5.20 AU' },
      { label: 'Orbital period', value: '11.9 years' },
      { label: 'Diameter', value: '139,820 km' },
      { label: 'Moons', value: '95+' },
    ],
  },
  {
    id: 'sol-saturn', name: 'Saturn', uri: '/models/saturn_planet.glb',
    auFromSun: 9.58, periodYears: 29.46, spinSec: 11, phase0: 0.9, minPx: 46, color: '#e3d4a3',
    facts: [
      { label: 'Distance from Sun', value: '9.58 AU' },
      { label: 'Orbital period', value: '29.5 years' },
      { label: 'Diameter', value: '116,460 km' },
      { label: 'Moons', value: '146+' },
    ],
  },
  {
    id: 'sol-uranus', name: 'Uranus', uri: '/models/uranus.glb',
    auFromSun: 19.2, periodYears: 84.0, spinSec: 14, phase0: 2.8, minPx: 32, color: '#9fd8e0',
    facts: [
      { label: 'Distance from Sun', value: '19.2 AU' },
      { label: 'Orbital period', value: '84 years' },
      { label: 'Diameter', value: '50,724 km' },
      { label: 'Moons', value: '28' },
    ],
  },
  {
    id: 'sol-neptune', name: 'Neptune', uri: '/models/neptune.glb',
    auFromSun: 30.05, periodYears: 164.8, spinSec: 15, phase0: 4.4, minPx: 30, color: '#5b7cfa',
    facts: [
      { label: 'Distance from Sun', value: '30.05 AU' },
      { label: 'Orbital period', value: '164.8 years' },
      { label: 'Diameter', value: '49,244 km' },
      { label: 'Moons', value: '16' },
    ],
  },
]

/** Camera distance from Earth's centre at which a body becomes visible (staggered
 *  so zooming out reveals the inner planets first, then the giants). */
function revealDistance(b: BodyConfig): number {
  // Just beyond GEO for the Sun + inner planets; proportional to orbit for the rest.
  return Math.max(5e7, b.auFromSun * SCENE_AU * 0.08)
}

/**
 * Build the solar system inside an existing Cesium viewer. Returns a cleanup
 * function that removes everything it added (entities, listeners, subscriptions).
 */
export function initSolarSystem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Cesium: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  viewer: any,
  store: ZenithStore
): () => void {
  if (!viewer || viewer.isDestroyed?.()) return () => {}

  // Let the camera zoom out far enough to see the whole system, and push the far
  // plane out so distant planets aren't culled. Additive — the opening view (a
  // close top-down over the observer) is unchanged.
  try {
    viewer.scene.logarithmicDepthBuffer = true
    viewer.scene.screenSpaceCameraController.maximumZoomDistance = 6e10
    viewer.camera.frustum.far = 1e11
  } catch { /* older Cesium — best effort */ }

  const t0 = Cesium.JulianDate.now()
  const elapsedSec = (time: unknown): number =>
    Cesium.JulianDate.secondsDifference(time, t0)

  // Sun position: orbits Earth (origin) at one scene-AU with Earth's period.
  const SUN_OMEGA = TWO_PI / SCENE_YEAR_SEC
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sunPositionAt = (tSec: number, result: any) => {
    const a = SUN_OMEGA * tSec
    return Cesium.Cartesian3.fromElements(
      SCENE_AU * Math.cos(a),
      SCENE_AU * Math.sin(a),
      0,
      result
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const created: any[] = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const revealList: { entity: any; at: number }[] = []
  const solarStoreObjects: CelestialObject[] = []

  for (const b of BODIES) {
    const omega = b.periodYears > 0 ? TWO_PI / (b.periodYears * SCENE_YEAR_SEC) : 0

    // Position: Sun = its own orbit around Earth; planet = Sun + heliocentric offset.
    const positionProp = new Cesium.CallbackProperty(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (time: unknown, result: any) => {
        const tSec = elapsedSec(time)
        if (b.auFromSun === 0) return sunPositionAt(tSec, result)
        const sun = sunPositionAt(tSec, new Cesium.Cartesian3())
        const ang = b.phase0 + omega * tSec
        const r = b.auFromSun * SCENE_AU
        return Cesium.Cartesian3.fromElements(
          sun.x + r * Math.cos(ang),
          sun.y + r * Math.sin(ang),
          sun.z,
          result
        )
      },
      false
    )

    // Self-rotation about the body's own vertical (Z) axis.
    const spinOmega = TWO_PI / b.spinSec
    const orientationProp = new Cesium.CallbackProperty(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (time: unknown, result: any) =>
        Cesium.Quaternion.fromAxisAngle(
          Cesium.Cartesian3.UNIT_Z,
          spinOmega * elapsedSec(time),
          result
        ),
      false
    )

    const color = Cesium.Color.fromCssColorString(b.color)
    const entity = viewer.entities.add({
      id: b.id,
      name: b.name,
      position: positionProp,
      orientation: orientationProp,
      model: {
        uri: b.uri,
        // Keep each body at least this many pixels at any zoom, so the wide
        // "orrery" view shows them as visible dots; flying close reveals the full
        // model. No maximumScale — that would cap the dot size when zoomed out.
        minimumPixelSize: b.minPx,
      },
      label: {
        text: b.name,
        font: '12px Space Mono, monospace',
        fillColor: color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14),
        // Fade the label out when extremely far so the wide view isn't cluttered.
        translucencyByDistance: new Cesium.NearFarScalar(1e8, 1.0, 8e10, 0.0),
      },
    })
    created.push(entity)
    revealList.push({ entity, at: revealDistance(b) })

    // Register in the store (metadata only — geo/topo are unused placeholders) so
    // clicking, searching, and the detail panel reuse the existing machinery.
    solarStoreObjects.push({
      id: b.id,
      name: b.name,
      category: 'planet',
      geo: { latitude: 0, longitude: 0, heightKm: 0 },
      topo: { altitude: 0, azimuth: 0, rangekm: 0 },
      inZenithWindow: false,
      updatedAt: Date.now(),
      solarBody: true,
      facts: b.facts,
    })
  }

  // ── Moon — orbits Earth (origin). No moon.glb provided, so a shaded sphere. ──
  const moonOmega = TWO_PI / MOON_PERIOD_SEC
  const moonEntity = viewer.entities.add({
    id: 'sol-moon',
    name: 'Moon',
    position: new Cesium.CallbackProperty(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (time: unknown, result: any) => {
        const a = moonOmega * elapsedSec(time)
        return Cesium.Cartesian3.fromElements(
          MOON_DIST * Math.cos(a),
          MOON_DIST * Math.sin(a),
          0,
          result
        )
      },
      false
    ),
    ellipsoid: {
      radii: new Cesium.Cartesian3(MOON_RADIUS, MOON_RADIUS, MOON_RADIUS),
      material: Cesium.Color.fromCssColorString('#c8c8d0'),
    },
    label: {
      text: 'Moon',
      font: '11px Space Mono, monospace',
      fillColor: Cesium.Color.fromCssColorString('#d6d6e0'),
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 2,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE,
      verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
      pixelOffset: new Cesium.Cartesian2(0, -10),
      translucencyByDistance: new Cesium.NearFarScalar(5e7, 1.0, 2e10, 0.0),
    },
  })
  created.push(moonEntity)
  revealList.push({ entity: moonEntity, at: 4.5e7 })

  // Push all solar bodies into the store (selection / search / panel).
  store.getState().setSolarObjects(solarStoreObjects)

  // ── Progressive reveal ──────────────────────────────────────────────────────
  // Each frame, show a body only once the camera has zoomed out past its reveal
  // distance. At the opening zoom (~28,000 km out) nothing solar is shown, so the
  // initial view is identical to the current Earth-only app.
  const onPreRender = () => {
    if (viewer.isDestroyed()) return
    const camDist = Cesium.Cartesian3.magnitude(viewer.camera.positionWC)
    for (const r of revealList) r.entity.show = camDist > r.at
  }
  viewer.scene.preRender.addEventListener(onPreRender)

  // ── Click-to-fly (reuses selectedObjectId) ──────────────────────────────────
  // The existing globe click handler already sets selectedObjectId for any object
  // in the store (planets included). Here we add the camera move: when a solar
  // body is selected, smoothly fly to it — the same kind of fly used elsewhere.
  let lastFlown: string | null = null
  const unsubSelect = store.subscribe(
    (s) => s.selectedObjectId,
    (id) => {
      if (!id || viewer.isDestroyed()) { lastFlown = null; return }
      // ONLY act on solar bodies. Satellites/ISS are also entities and drive their
      // own camera (tracking lock) — flying to them here would fight that.
      const obj = store.getState().objects.get(id)
      if (!obj?.solarBody) { lastFlown = null; return }
      if (id === lastFlown) return
      const entity = viewer.entities.getById(id)
      if (!entity) return
      lastFlown = id
      // flyTo frames the body's bounding sphere with a gentle top-down-ish angle.
      viewer.flyTo(entity, {
        duration: 2.0,
        offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-20), 0),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).catch(() => { /* flight cancelled by a newer interaction — fine */ })
    }
  )

  // ── Cleanup ───────────────────────────────────────────────────────────────
  return () => {
    unsubSelect()
    if (viewer.isDestroyed()) return
    try { viewer.scene.preRender.removeEventListener(onPreRender) } catch { /* ignore */ }
    for (const e of created) {
      try { viewer.entities.remove(e) } catch { /* ignore */ }
    }
  }
}
