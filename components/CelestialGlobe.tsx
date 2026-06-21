'use client'

import { useEffect, useRef } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'

const CONE_LENGTH = 2_000_000
const CONE_RADIUS = 280_000
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
    satFill:       Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.4),
    satOutline:    Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.15),
    zenFill:       Cesium.Color.fromCssColorString('#00d4ff'),
    zenOutline:    Cesium.Color.fromCssColorString('#c4b5fd').withAlpha(0.8),
    issFill:       Cesium.Color.fromCssColorString('#ffcc02'),
    issOutline:    Cesium.Color.WHITE.withAlpha(0.8),
    coneBody:      Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.18),
    coneOutline:   Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.7),
    obsRingBody:   Cesium.Color.fromCssColorString('#7c3aed').withAlpha(0.12),
    obsRingOL:     Cesium.Color.fromCssColorString('#c4b5fd').withAlpha(0.7),
    obsDotFill:    Cesium.Color.fromCssColorString('#c4b5fd'),
    labelFill:     Cesium.Color.WHITE,
    labelOutline:  Cesium.Color.BLACK,
    dotOutlineWh:  Cesium.Color.WHITE,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getPointStyle(category: string, inZenithWindow: boolean): any {
  if (category === 'iss') {
    return { color: C!.issFill, pixelSize: 14, outlineColor: C!.issOutline, outlineWidth: 3 }
  }
  if (inZenithWindow) {
    return { color: C!.zenFill, pixelSize: 9, outlineColor: C!.zenOutline, outlineWidth: 3 }
  }
  return { color: C!.satFill, pixelSize: 2, outlineColor: C!.satOutline, outlineWidth: 0 }
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
      const { observer } = useZenithStore.getState()

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
      const renderCone = (show: boolean) => {
        viewer.entities.removeById('zenith-cone')
        const apex = Cesium.Cartesian3.fromDegrees(
          observer.longitude, observer.latitude, observer.altitudeM
        )
        const center = Cesium.Cartesian3.fromDegrees(
          observer.longitude, observer.latitude, observer.altitudeM + CONE_LENGTH / 2
        )
        const enu = Cesium.Transforms.eastNorthUpToFixedFrame(apex)
        const rotation = Cesium.Matrix4.getMatrix3(enu, new Cesium.Matrix3())
        const orientation = Cesium.Quaternion.fromRotationMatrix(rotation)
        viewer.entities.add({
          id: 'zenith-cone',
          show,
          position: center,
          orientation,
          cylinder: {
            length: CONE_LENGTH,
            topRadius: 0,
            bottomRadius: CONE_RADIUS,
            material: new Cesium.ColorMaterialProperty(C!.coneBody),
            outline: true,
            outlineColor: C!.coneOutline,
            outlineWidth: 2,
          },
        })
      }

      renderCone(useZenithStore.getState().showZenithCone)

      // ── Observer marker ───────────────────────────────────────────────────────
      viewer.entities.add({
        id: '__observer_dot__',
        position: Cesium.Cartesian3.fromDegrees(observer.longitude, observer.latitude, 2000),
        point: {
          pixelSize: 12,
          color: C!.obsDotFill,
          outlineColor: C!.dotOutlineWh,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      })

      viewer.entities.add({
        id: '__observer_ring__',
        position: Cesium.Cartesian3.fromDegrees(observer.longitude, observer.latitude, 1000),
        ellipse: {
          semiMajorAxis: 250000,
          semiMinorAxis: 250000,
          material: C!.obsRingBody,
          outline: true,
          outlineColor: C!.obsRingOL,
          outlineWidth: 2,
        },
      })

      const unsubCone = useZenithStore.subscribe(
        (s) => s.showZenithCone,
        (show) => {
          const cone = viewer.entities.getById('zenith-cone')
          if (cone) cone.show = show
        }
      )
      unsubs.push(unsubCone)

      // Scratch JulianDate reused across ticks — addSample copies before we mutate it again.
      const scratchT1 = new Cesium.JulianDate()

      // ── Delta satellite entity sync ───────────────────────────────────────────
      // Deferred to the next animation frame so the Zustand notify → syncEntities
      // path never blocks the render thread mid-frame.
      const syncEntities = (objects: Map<string, CelestialObject>) => {
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
                ;(entity.point.pixelSize as any).setValue(style.pixelSize)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.outlineWidth as any).setValue(style.outlineWidth)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.color as any).setValue(style.color)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.outlineColor as any).setValue(style.outlineColor)
              }
              if (entity?.label) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.label.show as any).setValue(obj.inZenithWindow)
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
      syncEntities(useZenithStore.getState().objects)

      // Subsequent updates are deferred to the next animation frame so the
      // Zustand → syncEntities path never stalls Cesium mid-render.
      const unsubObjects = useZenithStore.subscribe(
        (s) => s.objects,
        (objects) => {
          if (pendingSyncRaf) return // already queued, skip
          pendingSyncRaf = requestAnimationFrame(() => {
            pendingSyncRaf = 0
            syncEntities(objects)
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
