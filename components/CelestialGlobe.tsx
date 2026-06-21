'use client'

import { useEffect, useRef } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'

const CONE_LENGTH = 2_000_000
// Half-angle of 15° represents the 75°–90° zenith shell: an object at 75°
// elevation sits 15° off the local vertical. radius = length · tan(15°).
const CONE_RADIUS = Math.round(CONE_LENGTH * Math.tan((15 * Math.PI) / 180))
const MAX_SAMPLES_PER_TICK = 6

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

// Colour strictly by category; size + label strictly by zenith-window state.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPointStyle(category: string, inZenithWindow: boolean): any {
  const color =
    category === 'iss' ? C!.issFill :
      category === 'planet' ? C!.planetFill :
        C!.satFill
  return {
    color,
    pixelSize: inZenithWindow ? 8 : 4,
    outlineColor: C!.zenOutline,
    outlineWidth: inZenithWindow ? 1 : 0,
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

interface EntityCacheEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  posProp: any
  inZenithWindow: boolean
  tickCount: number
}

export default function CelestialGlobe() {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const unsubs: Array<() => void> = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let viewer: any = null
    let cancelled = false
    const entityCache = new Map<string, EntityCacheEntry>()
    // rAF handle so we never queue more than one sync per frame.
    let pendingSyncRaf = 0

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

      // Cap at 1.5× — a 2× retina device would otherwise render at 4× the pixels.
      viewer.resolutionScale = Math.min(window.devicePixelRatio ?? 1, 1.5)

      if (process.env.NODE_ENV === 'development') {
        viewer.scene.debugShowFramesPerSecond = true
      }

      viewer.clock.shouldAnimate = true
      viewer.clock.multiplier = 1.0

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

      // ── Globe ────────────────────────────────────────────────────────────────
      viewer.scene.globe.show = true
      viewer.scene.globe.baseColor = Cesium.Color.BLACK
      // Back to default 2.0 — 1.5 loads noticeably more tiles without a visible quality gain
      // at 22 Mm altitude.
      viewer.scene.globe.maximumScreenSpaceError = 2.0
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
        viewer.scene.globe.atmosphereRayleighCoefficient = new Cesium.Cartesian3(
          5.5e-6, 13.0e-6, 28.4e-6
        )
      } catch { /* Cesium < 1.100 */ }

      // ── Post-processing ───────────────────────────────────────────────────────
      // FXAA only — bloom over 10 k glowing dots costs ~15 ms/frame on a mid-range GPU.
      try { viewer.scene.postProcessStages.fxaa.enabled = true } catch { /* ignore */ }
      // Bloom is intentionally disabled for performance.
      try { viewer.scene.postProcessStages.bloom.enabled = false } catch { /* ignore */ }

      // ── Camera ───────────────────────────────────────────────────────────────
      viewer.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(80.24, 12.97, 22_000_000),
        orientation: {
          heading: Cesium.Math.toRadians(0),
          pitch: Cesium.Math.toRadians(-90),
          roll: 0,
        },
      })

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
        viewer.entities.add({
          id: 'zenith-cone',
          show: showCone,
          position: center,
          orientation,
          cylinder: {
            length: CONE_LENGTH,
            topRadius: CONE_RADIUS, // wide end — up in the sky
            bottomRadius: 0, // apex — at the observer
            material: new Cesium.ColorMaterialProperty(C!.coneBody),
            outline: true,
            outlineColor: C!.coneOutline,
            outlineWidth: 2,
          },
        })
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
      }

      renderZenithCone()
      renderObserverMarker()

      // Toggle cone visibility without rebuilding the entity.
      const unsubCone = useZenithStore.subscribe(
        (s) => s.showZenithCone,
        (show) => {
          const cone = viewer.entities.getById('zenith-cone')
          if (cone) cone.show = show
        }
      )
      unsubs.push(unsubCone)

      // Rebuild observer-anchored entities (cone + marker) when the observer moves.
      const unsubObserver = useZenithStore.subscribe(
        (s) => s.observer,
        () => {
          renderZenithCone()
          renderObserverMarker()
        }
      )
      unsubs.push(unsubObserver)

      // Scratch JulianDate reused across ticks — addSample copies before we mutate it again.
      const scratchT1 = new Cesium.JulianDate()

      // ── Delta satellite entity sync ───────────────────────────────────────────
      // Deferred to the next animation frame so the Zustand notify → syncObjectMarkers
      // path never blocks the render thread mid-frame.
      const syncObjectMarkers = (objects: Map<string, CelestialObject>) => {
        if (!viewer || viewer.isDestroyed()) return

        // Remove stale entities using entityCache (O(cache size)) instead of
        // iterating viewer.entities.values (O(Cesium entity count)).
        for (const id of entityCache.keys()) {
          if (!objects.has(id)) {
            viewer.entities.removeById(id)
            entityCache.delete(id)
          }
        }

        const nowDate = new Date()
        const t0 = Cesium.JulianDate.fromDate(nowDate)

        for (const obj of objects.values()) {
          const pos0 = Cesium.Cartesian3.fromDegrees(
            obj.geo.longitude, obj.geo.latitude, obj.geo.heightKm * 1000
          )

          if (entityCache.has(obj.id)) {
            const cache = entityCache.get(obj.id)!
            cache.tickCount++

            let posProp = cache.posProp
            // Recycle SampledPositionProperty every N ticks to bound memory.
            if (cache.tickCount % MAX_SAMPLES_PER_TICK === 0) {
              posProp = new Cesium.SampledPositionProperty()
              posProp.setInterpolationOptions({
                interpolationDegree: 1,
                interpolationAlgorithm: Cesium.LinearApproximation,
              })
              posProp.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD
              posProp.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD
              const entity = viewer.entities.getById(obj.id)
              if (entity) entity.position = posProp
              cache.posProp = posProp
            }

            posProp.addSample(t0, pos0)

            if (obj.geoNext) {
              const intervalSec = (obj.updatedAt
                ? new Date(obj.updatedAt + 10_000).getTime() - nowDate.getTime()
                : 10_000) / 1000
              // scratchT1 is mutated in place; addSample copies it before we reuse it.
              Cesium.JulianDate.addSeconds(t0, intervalSec, scratchT1)
              posProp.addSample(
                scratchT1,
                Cesium.Cartesian3.fromDegrees(
                  obj.geoNext.longitude, obj.geoNext.latitude, obj.geoNext.heightKm * 1000
                )
              )
            }

            if (cache.inZenithWindow !== obj.inZenithWindow) {
              cache.inZenithWindow = obj.inZenithWindow
              const entity = viewer.entities.getById(obj.id)
              if (entity?.point) {
                const style = getPointStyle(obj.category, obj.inZenithWindow)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ; (entity.point.pixelSize as any).setValue(style.pixelSize)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ; (entity.point.outlineWidth as any).setValue(style.outlineWidth)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ; (entity.point.color as any).setValue(style.color)
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ; (entity.point.outlineColor as any).setValue(style.outlineColor)
              }
              if (entity?.label) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ; (entity.label.show as any).setValue(obj.inZenithWindow)
              }
            }
          } else {
            const posProp = new Cesium.SampledPositionProperty()
            posProp.setInterpolationOptions({
              interpolationDegree: 1,
              interpolationAlgorithm: Cesium.LinearApproximation,
            })
            posProp.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD
            posProp.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD
            posProp.addSample(t0, pos0)

            if (obj.geoNext) {
              Cesium.JulianDate.addSeconds(t0, 10, scratchT1)
              posProp.addSample(
                scratchT1,
                Cesium.Cartesian3.fromDegrees(
                  obj.geoNext.longitude, obj.geoNext.latitude, obj.geoNext.heightKm * 1000
                )
              )
            }

            const style = getPointStyle(obj.category, obj.inZenithWindow)
            viewer.entities.add({
              id: obj.id,
              name: obj.name,
              position: posProp,
              point: {
                pixelSize: style.pixelSize,
                color: style.color,
                outlineColor: style.outlineColor,
                outlineWidth: style.outlineWidth,
              },
              label: {
                text: obj.name,
                show: obj.inZenithWindow,
                font: '11px monospace',
                fillColor: C!.labelFill,
                outlineColor: C!.labelOutline,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -10),
              },
            })

            entityCache.set(obj.id, { posProp, inZenithWindow: obj.inZenithWindow, tickCount: 0 })
          }
        }
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
    })

    return () => {
      cancelled = true
      if (pendingSyncRaf) { cancelAnimationFrame(pendingSyncRaf); pendingSyncRaf = 0 }
      unsubs.forEach((u) => u())
      entityCache.clear()
      if (viewer && !viewer.isDestroyed()) viewer.destroy()
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
