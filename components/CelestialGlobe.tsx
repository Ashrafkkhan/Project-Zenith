'use client'

import { useEffect, useRef } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'

const CONE_LENGTH = 2_000_000
// Half-angle of 15° represents the 75°–90° zenith shell: an object at 75°
// elevation sits 15° off the local vertical. radius = length · tan(15°).
const CONE_RADIUS = Math.round(CONE_LENGTH * Math.tan((15 * Math.PI) / 180))
// ── Orbital trail ring buffer ─────────────────────────────────────────────────
// Max samples kept per trail object for its glow polyline (oldest shifted off).
const TRAIL_LENGTH = 8

// ── Pre-built Color cache ─────────────────────────────────────────────────────
// Populated once after Cesium loads so getPointStyle never parses CSS strings
// in the hot per-entity loop (fromCssColorString is surprisingly expensive at
// 10 000 calls per tick).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let C: Record<string, any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildColorCache(Cesium: any) {
  if (C) return
  C = {
    // Category fill colours (CLAUDE.md convention).
    satFill: Cesium.Color.fromCssColorString('#4fc3f7'),
    issFill: Cesium.Color.fromCssColorString('#ffcc02'),
    planetFill: Cesium.Color.fromCssColorString('#ff8c69'),
    // Declutter palette — faint cyan for the non-zenith satellite swarm.
    cyan: Cesium.Color.CYAN,
    cyanFaint: Cesium.Color.CYAN.withAlpha(0.2),
    satZenOutline: Cesium.Color.CYAN.withAlpha(0.8),
    issOutline: Cesium.Color.fromCssColorString('#ffcc02').withAlpha(0.6),
    planetOutline: Cesium.Color.fromCssColorString('#ff8c69').withAlpha(0.6),
    // Label offsets: nudge the label off its dot and pull it toward the camera
    // so it never z-fights the point primitive.
    eyeLabel: new Cesium.Cartesian3(0, 0, -10000),
    eyeZero: Cesium.Cartesian3.ZERO,
    labelPixelOffset: new Cesium.Cartesian2(10, -10),
    // Subtle white edge so in-zenith points pop against the globe.
    zenOutline: Cesium.Color.WHITE.withAlpha(0.85),
    // Zenith cone.
    coneBody: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.15),
    coneOutline: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.6),
    // Observer marker.
    obsRingBody: Cesium.Color.fromCssColorString('#7c3aed').withAlpha(0.12),
    obsRingOL: Cesium.Color.fromCssColorString('#c4b5fd').withAlpha(0.7),
    obsDotFill: Cesium.Color.fromCssColorString('#c4b5fd'),
    dotOutlineWh: Cesium.Color.WHITE,
    // Labels.
    labelFill: Cesium.Color.WHITE,
    labelOutline: Cesium.Color.BLACK,
  }
}

// Per-category styling. ISS and planets are always full-size + labelled; the
// satellite swarm is decluttered (tiny faint dots) unless it enters the zenith
// window, where it gets a bright, outlined, labelled treatment.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPointStyle(category: string, inZenithWindow: boolean): any {
  if (category === 'iss') {
    return {
      pixelSize: 10,
      color: C!.issFill,
      outlineColor: C!.issOutline,
      outlineWidth: 2,
      showLabel: true,
      labelFont: '11px Space Mono',
      labelFill: C!.issFill,
      eyeOffset: C!.eyeZero,
    }
  }
  if (category === 'planet') {
    return {
      pixelSize: 8,
      color: C!.planetFill,
      outlineColor: C!.planetOutline,
      outlineWidth: 1,
      showLabel: true,
      labelFont: '11px monospace',
      labelFill: C!.planetFill,
      eyeOffset: C!.eyeZero,
    }
  }
  // satellite
  if (inZenithWindow) {
    return {
      pixelSize: 7,
      color: C!.satFill,
      outlineColor: C!.satZenOutline,
      outlineWidth: 1,
      showLabel: true,
      labelFont: '11px Space Mono',
      labelFill: C!.cyan,
      eyeOffset: C!.eyeLabel,
    }
  }
  return {
    pixelSize: 2,
    color: C!.cyanFaint,
    outlineColor: C!.cyanFaint,
    outlineWidth: 0,
    showLabel: false,
    labelFont: '11px Space Mono',
    labelFill: C!.cyan,
    eyeOffset: C!.eyeLabel,
  }
}

function injectCesiumCSS() {
  const id = 'cesium-widgets-css'
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = '/_cesium/Widgets/widgets.css'
  document.head.appendChild(link)
}

async function getCesium() {
  injectCesiumCSS()
  const Cesium = await import('cesium')
  return Cesium
}

export default function CelestialGlobe() {
  const containerRef = useRef<HTMLDivElement>(null)
  // Shared phase for the zenith cone's breathing pulse (driven by CallbackProperty).
  const conePulseRef = useRef<{ phase: number }>({ phase: 0 })

  useEffect(() => {
    if (!containerRef.current) return

    const unsubs: Array<() => void> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null
    let cancelled = false
    // rAF handle so we never queue more than one sync per frame.
    let pendingSyncRaf = 0

    // Batched render primitives (created once after viewer init). One collection
    // each for all points / labels / trails instead of ~750 individual entities.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let pointCollection: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let labelCollection: any = null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let trailCollection: any = null
    // Per-object primitive handles + trail position history.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pointCache = new Map<string, any>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labelCache = new Map<string, any>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trailCache = new Map<string, any>()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trailHistory = new Map<string, any[]>()

    getCesium().then(async (Cesium) => {
      if (cancelled || !containerRef.current) return

      buildColorCache(Cesium)

      // ── Viewer ───────────────────────────────────────────────────────────────
      const ionToken = process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN
      if (ionToken) Cesium.Ion.defaultAccessToken = ionToken

      try {
        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: false,
          baseLayerPicker: false,
          animation: false,
          fullscreenButton: false,
          geocoder: false,
          homeButton: false,
          infoBox: false,
          sceneModePicker: false,
          selectionIndicator: false,
          timeline: false,
          navigationHelpButton: false,
          navigationInstructionsInitiallyVisible: false,
        })
      } catch (err) {
        console.error('[CelestialGlobe] Viewer init failed:', err)
        return
      }

      if (cancelled) { viewer.isDestroyed() || viewer.destroy(); return }

      // Cap at 1.0× to significantly reduce pixel rendering load on high-DPI / 4K displays.
      viewer.resolutionScale = Math.min(window.devicePixelRatio ?? 1, 1.0)

      if (process.env.NODE_ENV === 'development') {
        viewer.scene.debugShowFramesPerSecond = true
      }

      // Positions are written manually each 10 s tick, so Cesium's clock never
      // needs to advance — stop it to avoid per-frame property re-evaluation.
      viewer.clock.shouldAnimate = false

      // Render on demand: the scene only redraws when something actually changes
      // (camera move, tile load, or our explicit requestRender after a data tick)
      // instead of running a continuous 60 fps loop.
      viewer.scene.requestRenderMode = true
      viewer.scene.maximumRenderTimeChange = Infinity

      // ── Imagery ──────────────────────────────────────────────────────────────
      try {
        const bingProvider = await Cesium.IonImageryProvider.fromAssetId(2)
        if (!cancelled) viewer.imageryLayers.addImageryProvider(bingProvider)
      } catch {
        console.warn('[CelestialGlobe] Ion unavailable, falling back to NaturalEarth II')
        try {
          const fp = await Cesium.TileMapServiceImageryProvider.fromUrl(
            Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
          )
          if (!cancelled) viewer.imageryLayers.addImageryProvider(fp)
        } catch (err) {
          console.error('[CelestialGlobe] All imagery failed:', err)
        }
      }

      if (cancelled || viewer.isDestroyed()) return

      pointCollection = new Cesium.PointPrimitiveCollection()
      viewer.scene.primitives.add(pointCollection)

      // ── Globe ────────────────────────────────────────────────────────────────
      viewer.scene.globe.show = true
      viewer.scene.globe.baseColor = Cesium.Color.BLACK
      // Increase from 2.0 to 4.0 to reduce the number of terrain/imagery tiles loaded,
      // dramatically improving panning and rotation performance.
      viewer.scene.globe.maximumScreenSpaceError = 4.0
      viewer.scene.globe.depthTestAgainstTerrain = false

      // ── Atmosphere & lighting ─────────────────────────────────────────────────
      viewer.scene.globe.showGroundAtmosphere = true
      viewer.scene.skyAtmosphere.show = true
      viewer.scene.skyBox.show = true
      viewer.scene.globe.enableLighting = true
      viewer.scene.sun = new Cesium.Sun()
      viewer.scene.moon = new Cesium.Moon()

      try {
        viewer.scene.globe.dynamicAtmosphereLighting = true
        viewer.scene.globe.dynamicAtmosphereLightingFromSun = true
      } catch { /* not available on this build */ }

      try {
        viewer.scene.globe.atmosphereLightIntensity = 10.0
        viewer.scene.globe.atmosphereMieScaleHeight = 20000
        viewer.scene.globe.atmosphereRayleighCoefficient = new Cesium.Cartesian3(
          5.5e-6, 13.0e-6, 28.4e-6
        )
      } catch { /* Cesium < 1.100 */ }

      // Distance fog softens the limb and adds depth toward the horizon.
      viewer.scene.fog.enabled = true
      viewer.scene.fog.density = 0.0002

      // ── Post-processing ───────────────────────────────────────────────────────
      // FXAA only — bloom over 10 k glowing dots costs ~15 ms/frame on a mid-range GPU.
      try { viewer.scene.postProcessStages.fxaa.enabled = true } catch { /* ignore */ }
      // Bloom is intentionally disabled for performance.
      try { viewer.scene.postProcessStages.bloom.enabled = false } catch { /* ignore */ }

      // ── Camera intro ───────────────────────────────────────────────────────────
      // Start from a high orbit looking straight down…
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(80.2437, 12.9716, 15_000_000),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      })

      // …then fly down to the default observer (Chennai) for a cinematic intro.
      // Small delay so Cesium finishes initial tile loading before the flight.
      const introTimeout = setTimeout(() => {
        if (cancelled || !viewer || viewer.isDestroyed()) return
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(80.2437, 12.9716, 2_500_000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-45),
            roll: 0,
          },
          duration: 3.5,
          easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        })
      }, 500)
      unsubs.push(() => clearTimeout(introTimeout))

      // ── Entity selection ──────────────────────────────────────────────────────
      // Click a tracked object → open its detail panel via the store. Clicking
      // empty space (or a non-object entity like the cone/observer marker)
      // deselects. selectedObjectId is the single source of truth for the panel.
      const clickHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)
      clickHandler.setInputAction(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (movement: any) => {
          const picked = viewer.scene.pick(movement.position)
          // PointPrimitives/Labels carry our object id directly in `.id` (a
          // string); remaining Entities (cone, observer) expose it as `.id.id`.
          let id: unknown = picked?.id
          if (id && typeof id === 'object') id = (id as { id?: unknown }).id
          const objects = useZenithStore.getState().objects
          useZenithStore
            .getState()
            .setSelectedObjectId(
              typeof id === 'string' && objects.has(id) ? id : null
            )
        },
        Cesium.ScreenSpaceEventType.LEFT_CLICK
      )
      unsubs.push(() => clickHandler.destroy())

      // ── Zenith cone ───────────────────────────────────────────────────────────
      // A CylinderGraphics approximating the 75°–90° shell, apex on the observer's
      // surface point, opening straight up. Positions read fresh from the store.
      const renderZenithCone = () => {
        const obs = useZenithStore.getState().observer
        const showCone = useZenithStore.getState().showZenithCone

        viewer.entities.removeById('zenith-cone')
        const surface = Cesium.Cartesian3.fromDegrees(
          obs.longitude, obs.latitude, obs.altitudeM
        )
        // Cylinder geometry is centred on its position, so lift the centre by half
        // a cone-length to place the apex exactly on the observer's surface point.
        const center = Cesium.Cartesian3.fromDegrees(
          obs.longitude, obs.latitude, obs.altitudeM + CONE_LENGTH / 2
        )
        // Point straight up: heading/pitch/roll all zero aligns the cylinder's +z
        // axis with the local east-north-up "up" (zenith) vector.
        const orientation = Cesium.Transforms.headingPitchRollQuaternion(
          surface, new Cesium.HeadingPitchRoll(0, 0, 0)
        )
        // Breathing pulse: fill alpha oscillates ~0.03→0.17, outline ~0.1→0.7.
        // Only the fill callback advances the shared phase so both stay in sync.
        const coneMaterial = new Cesium.ColorMaterialProperty(
          new Cesium.CallbackProperty(() => {
            conePulseRef.current.phase += 0.03
            const alpha = 0.10 + Math.sin(conePulseRef.current.phase) * 0.07
            return Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(alpha)
          }, false)
        )
        // CylinderGraphics.outlineColor takes a Property<Color> directly (there is
        // no outlineMaterial), so the outline pulse is a CallbackProperty<Color>.
        const coneOutlineColor = new Cesium.CallbackProperty(() => {
          const alpha = 0.4 + Math.sin(conePulseRef.current.phase) * 0.3
          return Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(alpha)
        }, false)

        viewer.entities.add({
          id: 'zenith-cone',
          show: showCone,
          position: center,
          orientation,
          cylinder: {
            length: CONE_LENGTH,
            topRadius: CONE_RADIUS, // wide end — up in the sky
            bottomRadius: 0, // apex — at the observer
            material: coneMaterial,
            outline: true,
            outlineColor: coneOutlineColor,
            outlineWidth: 2,
          },
        })
        viewer.scene.requestRender()
      }

      // ── Observer marker ───────────────────────────────────────────────────────
      // Dot + range ring at the observer's surface position.
      const renderObserverMarker = () => {
        const obs = useZenithStore.getState().observer

        viewer.entities.removeById('__observer_dot__')
        viewer.entities.add({
          id: '__observer_dot__',
          position: Cesium.Cartesian3.fromDegrees(obs.longitude, obs.latitude, 2000),
          point: {
            pixelSize: 12,
            color: C!.obsDotFill,
            outlineColor: C!.dotOutlineWh,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        })

        viewer.entities.removeById('__observer_ring__')
        viewer.entities.add({
          id: '__observer_ring__',
          position: Cesium.Cartesian3.fromDegrees(obs.longitude, obs.latitude, 1000),
          ellipse: {
            semiMajorAxis: 250000,
            semiMinorAxis: 250000,
            material: C!.obsRingBody,
            outline: true,
            outlineColor: C!.obsRingOL,
            outlineWidth: 2,
          },
        })
        viewer.scene.requestRender()
      }

      renderZenithCone()
      renderObserverMarker()

      // Toggle cone visibility without rebuilding the entity.
      const unsubCone = useZenithStore.subscribe(
        (s) => s.showZenithCone,
        (show) => {
          const cone = viewer.entities.getById('zenith-cone')
          if (cone) cone.show = show
          viewer.scene.requestRender()
        }
      )
      unsubs.push(unsubCone)

      // Rebuild observer-anchored entities (cone + marker) when the observer moves.
      const unsubObserver = useZenithStore.subscribe(
        (s) => s.observer,
        (observer) => {
          renderZenithCone()
          renderObserverMarker()
          // Cinematic fly-to the new observer — fires for city search,
          // geolocation, and manual coords (all route through setObserver).
          viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(
              observer.longitude,
              observer.latitude,
              2_500_000 // 2500 km — see the city, still see the cone
            ),
            orientation: {
              heading: Cesium.Math.toRadians(0),
              pitch: Cesium.Math.toRadians(-45),
              roll: 0,
            },
            duration: 2.5,
            easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
          })
          viewer.scene.requestRender()
        }
      )
      unsubs.push(unsubObserver)

      // CallbackProperty materials don't self-trigger renders under
      // requestRenderMode, so pump a lightweight 20 fps render request to keep the
      // cone's breathing pulse smooth while the rest stays render-on-demand.
      const pulseInterval = setInterval(() => {
        if (viewer && !viewer.isDestroyed()) viewer.scene.requestRender()
      }, 50)
      unsubs.push(() => clearInterval(pulseInterval))

      // ── Batched render primitives ──────────────────────────────────────────────
      // One PointPrimitiveCollection / LabelCollection / PolylineCollection holds
      // every marker, so the whole catalogue draws in a handful of GPU calls.
      pointCollection = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection())
      labelCollection = viewer.scene.primitives.add(new Cesium.LabelCollection())
      trailCollection = viewer.scene.primitives.add(new Cesium.PolylineCollection())

      // ── Per-object teardown ─────────────────────────────────────────────────────
      const removeTrail = (id: string) => {
        const trail = trailCache.get(id)
        if (trail) { trailCollection.remove(trail); trailCache.delete(id) }
        trailHistory.delete(id)
      }
      const removeObject = (id: string) => {
        const point = pointCache.get(id)
        if (point) { pointCollection.remove(point); pointCache.delete(id) }
        const label = labelCache.get(id)
        if (label) { labelCollection.remove(label); labelCache.delete(id) }
        removeTrail(id)
      }

      // Push the current position into the object's ring buffer (cap TRAIL_LENGTH)
      // and create/update its glow polyline. ISS glows gold, zenith sats cyan.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateTrail = (obj: CelestialObject, position: any) => {
        let hist = trailHistory.get(obj.id)
        if (!hist) { hist = []; trailHistory.set(obj.id, hist) }
        hist.push(position)
        if (hist.length > TRAIL_LENGTH) hist.shift()
        if (hist.length < 2) return // need two points to draw a line

        const positions = hist.slice()
        const existing = trailCache.get(obj.id)
        if (existing) {
          existing.positions = positions
        } else {
          const trail = trailCollection.add({
            positions,
            width: 1.5,
            material: Cesium.Material.fromType('Color', {
              color: obj.category === 'iss'
                ? Cesium.Color.fromCssColorString('#ffcc02').withAlpha(0.4)
                : Cesium.Color.CYAN.withAlpha(0.25),
            }),
          })
          trailCache.set(obj.id, trail)
        }
      }

      // ── Batched marker sync ─────────────────────────────────────────────────────
      // Static positions written once per data tick (no SampledPositionProperty),
      // so Cesium does zero per-frame interpolation. One pass updates points,
      // labels (zenith/ISS/planet only), and trails.
      const syncObjectMarkers = (objects: Map<string, CelestialObject>) => {
        if (!viewer || viewer.isDestroyed()) return

        // Remove primitives for objects that dropped out of the store.
        for (const id of pointCache.keys()) {
          if (!objects.has(id)) removeObject(id)
        }
        for (const [id, pt] of pointCache.entries()) {
          if (!objects.has(id)) {
            pointCollection.remove(pt)
            pointCache.delete(id)
          }
        }

        for (const obj of objects.values()) {
          const position = Cesium.Cartesian3.fromDegrees(
            obj.geo.longitude, obj.geo.latitude, obj.geo.heightKm * 1000
          )
          const style = getPointStyle(obj.category, obj.inZenithWindow)

          // ── Point ──
          const point = pointCache.get(obj.id)
          if (point) {
            point.position = position
            point.color = style.color
            point.pixelSize = style.pixelSize
            point.outlineColor = style.outlineColor
            point.outlineWidth = style.outlineWidth
          } else {
            pointCache.set(obj.id, pointCollection.add({
              id: obj.id,
              position,
              color: style.color,
              pixelSize: style.pixelSize,
              outlineColor: style.outlineColor,
              outlineWidth: style.outlineWidth,
            }))
          }

          // ── Label (zenith / ISS / planet only — ~740 sat labels eliminated) ──
          const needsLabel =
            obj.inZenithWindow || obj.category === 'iss' || obj.category === 'planet'
          if (needsLabel) {
            const fill = obj.category === 'iss' ? C!.issFill
              : obj.category === 'planet' ? C!.planetFill
                : C!.cyan
            const label = labelCache.get(obj.id)
            if (label) {
              label.position = position
              label.text = obj.name
              label.fillColor = fill
            } else {
              labelCache.set(obj.id, labelCollection.add({
                id: obj.id,
                position,
                text: obj.name,
                font: '11px Space Mono, monospace',
                fillColor: fill,
                outlineColor: C!.labelOutline,
                outlineWidth: 1,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                pixelOffset: C!.labelPixelOffset,
                eyeOffset: C!.eyeLabel,
              }))
            }
          } else {
            const label = labelCache.get(obj.id)
            if (label) { labelCollection.remove(label); labelCache.delete(obj.id) }
          }

          // ── Trail (zenith + ISS, never planets) ──
          if ((obj.inZenithWindow || obj.category === 'iss') && obj.category !== 'planet') {
            updateTrail(obj, position)
          } else {
            removeTrail(obj.id)
          }
        }

        // Render-on-demand: redraw once now that the scene has changed.
        viewer.scene.requestRender()
      }

      // Initial sync runs immediately (no RAF — viewer just initialised, nothing to block).
      syncObjectMarkers(useZenithStore.getState().objects)

      // Subsequent updates are deferred to the next animation frame so the
      // Zustand → syncObjectMarkers path never stalls Cesium mid-render.
      const unsubObjects = useZenithStore.subscribe(
        (s) => s.objects,
        (objects) => {
          if (pendingSyncRaf) return // already queued, skip
          pendingSyncRaf = requestAnimationFrame(() => {
            pendingSyncRaf = 0
            syncObjectMarkers(objects)
          })
        }
      )
      unsubs.push(unsubObjects)

      // Selection only opens the detail panel + upgrades the marker to an Entity.
      // The camera is owned exclusively by the tracking subscription below, so
      // selection never touches trackedEntity (otherwise the two would fight when
      // a click sets both selectedObjectId and trackingObjectId in the same frame).
      const unsubSelectedObject = useZenithStore.subscribe(
        (s) => s.selectedObjectId,
        () => {
          syncObjectMarkers(useZenithStore.getState().objects)
        }
      )
      unsubs.push(unsubSelectedObject)

      // ── 3D satellite tracking ──────────────────────────────────────────────────
      // Uses Cesium's native trackedEntity: the camera locks onto the satellite
      // and follows it across ticks, while the user keeps full mouse control to
      // orbit / zoom around it. Escape exits tracking (→ flies back to home view).
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') useZenithStore.getState().setTrackingObjectId(null)
      }
      window.addEventListener('keydown', onKeyDown)
      unsubs.push(() => window.removeEventListener('keydown', onKeyDown))

      // Tear down the tracking model + camera lock. Order matters: clear
      // trackedEntity BEFORE removing the model so Cesium releases the camera
      // transform cleanly — a dangling trackedEntity leaves the camera locked.
      const clearTrackingView = () => {
        if (viewer.isDestroyed()) return
        viewer.trackedEntity = undefined
        // Canonical "stop tracking" release: resets the camera reference frame to
        // world space while preserving its current position (no jump), so a later
        // flyTo / free navigation isn't interpreted in the satellite-locked frame.
        try { viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY) } catch { /* ignore */ }
        viewer.entities.removeById('tracking-satellite-model')
      }

      const unsubTracking = useZenithStore.subscribe(
        (s) => s.trackingObjectId,
        (trackingId) => {
          clearTrackingView()

          if (!trackingId || viewer.isDestroyed()) {
            // Restore the previously-tracked satellite's normal marker, then fly
            // back to the opening view of the globe (how it looked on first load).
            syncObjectMarkers(useZenithStore.getState().objects)
            if (!viewer.isDestroyed()) {
              viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(
                  HOME_VIEW_LON, HOME_VIEW_LAT, HOME_VIEW_HEIGHT
                ),
                orientation: {
                  heading: Cesium.Math.toRadians(0),
                  pitch: Cesium.Math.toRadians(-90),
                  roll: 0,
                },
                duration: 1.5,
                easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
              })
            }
            return
          }

          const objects = useZenithStore.getState().objects
          const obj = objects.get(trackingId)
          if (!obj) return

          // Promote the satellite to an Entity and hide its normal marker (the
          // tracking model replaces it). syncObjectMarkers reads trackingId from
          // the store, so the matched entity's `show` is set false inside it.
          syncObjectMarkers(objects)

          // Share the satellite's SampledPositionProperty so the model moves with
          // it. Recycling is skipped for the tracked id (see syncObjectMarkers),
          // so this reference keeps receiving samples and never goes stale.
          const cacheEntry = entityCache.get(trackingId)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const posProp: any = cacheEntry?.posProp ?? new Cesium.ConstantPositionProperty(
            Cesium.Cartesian3.fromDegrees(obj.geo.longitude, obj.geo.latitude, obj.geo.heightKm * 1000)
          )
          const isISS = obj.category === 'iss'

          // ── 3D GLB model entity ──────────────────────────────────────────
          const trackedModel = viewer.entities.add({
            id: 'tracking-satellite-model',
            position: posProp,
            orientation: new Cesium.VelocityOrientationProperty(posProp),
            // Initial camera offset in the satellite's local east-north-up frame
            // (south + above). Cesium frames the camera here when tracking begins;
            // the user can then orbit/zoom freely around the satellite.
            viewFrom: new Cesium.Cartesian3(
              0,
              isISS ? -280_000 : -220_000,
              isISS ? 150_000 : 120_000
            ),
            model: {
              uri: '/models/satellite.glb',
              minimumPixelSize: 128, // keep the model large + always on screen
              maximumScale: 60000,
              silhouetteColor: isISS
                ? Cesium.Color.fromCssColorString('#ffcc02')
                : Cesium.Color.CYAN,
              silhouetteSize: 3.0, // bright glowing outline around the model
              color: isISS
                ? Cesium.Color.fromCssColorString('#ffcc02').withAlpha(0.95)
                : Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.95),
              colorBlendMode: Cesium.ColorBlendMode.MIX,
              colorBlendAmount: 0.4, // mix model texture with category colour
              runAnimations: true,
              heightReference: Cesium.HeightReference.NONE,
            },
          })

          // Lock the camera onto the satellite. trackedEntity follows it across
          // ticks and lets the user drag to orbit / scroll to zoom around it.
          viewer.trackedEntity = trackedModel
        }
      )
      unsubs.push(unsubTracking)
      unsubs.push(clearTrackingView)

      // ── Solar system (built around the untouched Earth) ───────────────────────
      // Adds the Sun + planets + Moon as sibling entities orbiting the fixed Earth.
      // It only reads the viewer/store and adds its own entities — Earth, satellites,
      // the cone, the observer marker, and the camera defaults are all left intact.
      const disposeSolarSystem = initSolarSystem(Cesium, viewer, useZenithStore)
      unsubs.push(disposeSolarSystem)
    })

    return () => {
      cancelled = true
      if (pendingSyncRaf) { cancelAnimationFrame(pendingSyncRaf); pendingSyncRaf = 0 }
      unsubs.forEach((u) => u())
      pointCache.clear()
      labelCache.clear()
      trailCache.clear()
      trailHistory.clear()
      if (viewer && !viewer.isDestroyed()) {
        if (pointCollection) viewer.scene.primitives.remove(pointCollection)
        if (labelCollection) viewer.scene.primitives.remove(labelCollection)
        if (trailCollection) viewer.scene.primitives.remove(trailCollection)
        viewer.destroy()
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{ background: '#050510', willChange: 'transform', transform: 'translateZ(0)' }}
    />
  )
}
