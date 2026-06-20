'use client'

import { useEffect, useRef } from 'react'
import { useZenithStore } from '@/store/zenithStore'
import type { CelestialObject } from '@/types/celestial'

const CATEGORY_COLORS: Record<string, string> = {
  satellite: '#4fc3f7',
  iss: '#ffcc02',
  planet: '#ff8c69',
}

const CONE_LENGTH = 2_000_000
const CONE_RADIUS = 280_000

/**
 * How many position samples to accumulate per entity before recycling the
 * SampledPositionProperty. Each tick adds 2 samples (now + now+interval), so
 * this caps memory at ~(MAX_SAMPLES × 2 × 32B) per satellite.
 */
const MAX_SAMPLES_PER_TICK = 6

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
    // Guard against React StrictMode double-mount.
    let cancelled = false
    // Tracks which entities exist in Cesium and their current state.
    const entityCache = new Map<string, EntityCacheEntry>()

    getCesium().then((Cesium) => {
      if (cancelled || !containerRef.current) return

      const { observer } = useZenithStore.getState()

      try {
        viewer = new Cesium.Viewer(containerRef.current, {
          baseLayer: Cesium.ImageryLayer.fromProviderAsync(
            Cesium.TileMapServiceImageryProvider.fromUrl(
              Cesium.buildModuleUrl('Assets/Textures/NaturalEarthII')
            )
          ),
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

        // Crisp rendering on HiDPI (retina) screens.
        viewer.resolutionScale = window.devicePixelRatio ?? 1

        // Show FPS counter during development.
        if (process.env.NODE_ENV === 'development') {
          viewer.scene.debugShowFramesPerSecond = true
        }

        viewer.scene.globe.show = true

        // Clock must animate so SampledPositionProperty interpolates in real-time.
        viewer.clock.shouldAnimate = true
        viewer.clock.multiplier = 1.0

        viewer.camera.setView({
          destination: Cesium.Cartesian3.fromDegrees(80.2437, 12.9716, 20_000_000),
          orientation: {
            heading: Cesium.Math.toRadians(0),
            pitch: Cesium.Math.toRadians(-90),
            roll: 0,
          },
        })
      } catch (err) {
        console.error('[CelestialGlobe] Cesium viewer init failed:', err)
        return
      }

      // ── Zenith cone ────────────────────────────────────────────────────────
      const renderCone = (show: boolean) => {
        viewer.entities.removeById('zenith-cone')
        const apex = Cesium.Cartesian3.fromDegrees(
          observer.longitude,
          observer.latitude,
          observer.altitudeM
        )
        const center = Cesium.Cartesian3.fromDegrees(
          observer.longitude,
          observer.latitude,
          observer.altitudeM + CONE_LENGTH / 2
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
            topRadius: CONE_RADIUS,
            bottomRadius: 0,
            material: Cesium.Color.fromCssColorString('#7c3aed').withAlpha(0.25),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString('#c4b5fd').withAlpha(0.9),
            outlineWidth: 2,
          },
        })
      }

      renderCone(useZenithStore.getState().showZenithCone)

      const unsubCone = useZenithStore.subscribe(
        (s) => s.showZenithCone,
        (show) => {
          const cone = viewer.entities.getById('zenith-cone')
          // Toggle via .show — avoids removing/re-adding the cone entity.
          if (cone) cone.show = show
        }
      )
      unsubs.push(unsubCone)

      // ── Delta satellite entity sync ────────────────────────────────────────
      //
      // Strategy: maintain a Map<id, EntityCacheEntry> that mirrors what's in
      // Cesium. On each store update:
      //  • New objects  → add entity with SampledPositionProperty
      //  • Existing objects → addSample() on their existing position property
      //    so Cesium linearly interpolates the satellite's path between ticks
      //  • Removed objects → remove from Cesium and the cache
      //
      // This replaces the previous O(n) delete-all + re-create-all approach,
      // which caused a visible frame stutter every 10 seconds.
      const syncEntities = (objects: Map<string, CelestialObject>) => {
        if (!viewer || viewer.isDestroyed()) return

        // Remove entities that are no longer in the catalogue.
        const cesiumEntities: string[] = []
        const vals = viewer.entities.values
        for (let i = 0; i < vals.length; i++) cesiumEntities.push(vals[i].id as string)
        for (const id of cesiumEntities) {
          if (id === 'zenith-cone') continue
          if (!objects.has(id)) {
            viewer.entities.removeById(id)
            entityCache.delete(id)
          }
        }

        const nowDate = new Date()
        // t0 = current Julian date, t1 = one pipeline interval ahead.
        // Satellites get two samples per tick so Cesium can interpolate
        // their position smoothly instead of snapping to a new location.
        const t0 = Cesium.JulianDate.fromDate(nowDate)

        for (const obj of objects.values()) {
          const pos0 = Cesium.Cartesian3.fromDegrees(
            obj.geo.longitude,
            obj.geo.latitude,
            obj.geo.heightKm * 1000
          )
          const color = Cesium.Color.fromCssColorString(
            CATEGORY_COLORS[obj.category] ?? '#ffffff'
          )

          if (entityCache.has(obj.id)) {
            // ── Update existing entity ─────────────────────────────────────
            const cache = entityCache.get(obj.id)!
            cache.tickCount++

            // Periodically recycle the SampledPositionProperty to prevent
            // unbounded memory growth from accumulated samples.
            let posProp = cache.posProp
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
              // geoNext is the propagated position at t0 + pipeline interval.
              // Cesium interpolates smoothly between these two anchor points.
              const intervalSec =
                (obj.updatedAt
                  ? new Date(obj.updatedAt + 10_000).getTime() - nowDate.getTime()
                  : 10_000) / 1000
              const t1 = Cesium.JulianDate.addSeconds(t0, intervalSec, new Cesium.JulianDate())
              posProp.addSample(
                t1,
                Cesium.Cartesian3.fromDegrees(
                  obj.geoNext.longitude,
                  obj.geoNext.latitude,
                  obj.geoNext.heightKm * 1000
                )
              )
            }

            // Only mutate Cesium graphics when zenith membership actually changes.
            if (cache.inZenithWindow !== obj.inZenithWindow) {
              cache.inZenithWindow = obj.inZenithWindow
              const entity = viewer.entities.getById(obj.id)
              if (entity?.point) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.pixelSize as any).setValue(obj.inZenithWindow ? 8 : 4)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.point.outlineWidth as any).setValue(obj.inZenithWindow ? 1 : 0)
              }
              if (entity?.label) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(entity.label.show as any).setValue(obj.inZenithWindow)
              }
            }
          } else {
            // ── Add new entity ─────────────────────────────────────────────
            const posProp = new Cesium.SampledPositionProperty()
            posProp.setInterpolationOptions({
              interpolationDegree: 1,
              interpolationAlgorithm: Cesium.LinearApproximation,
            })
            // HOLD: between updates show last known position, never extrapolate.
            posProp.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD
            posProp.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD
            posProp.addSample(t0, pos0)

            if (obj.geoNext) {
              const t1 = Cesium.JulianDate.addSeconds(t0, 10, new Cesium.JulianDate())
              posProp.addSample(
                t1,
                Cesium.Cartesian3.fromDegrees(
                  obj.geoNext.longitude,
                  obj.geoNext.latitude,
                  obj.geoNext.heightKm * 1000
                )
              )
            }

            viewer.entities.add({
              id: obj.id,
              name: obj.name,
              position: posProp,
              point: {
                pixelSize: obj.inZenithWindow ? 8 : 4,
                color,
                outlineColor: Cesium.Color.WHITE.withAlpha(0.6),
                outlineWidth: obj.inZenithWindow ? 1 : 0,
              },
              label: {
                text: obj.name,
                show: obj.inZenithWindow,
                font: '11px monospace',
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -10),
              },
            })

            entityCache.set(obj.id, {
              posProp,
              inZenithWindow: obj.inZenithWindow,
              tickCount: 0,
            })
          }
        }
      }

      syncEntities(useZenithStore.getState().objects)
      const unsubObjects = useZenithStore.subscribe((s) => s.objects, syncEntities)
      unsubs.push(unsubObjects)
    })

    return () => {
      cancelled = true
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
