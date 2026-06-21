# Project Zenith — The Celestial Eye
# CLAUDE.md — Claude Code project context

## What this is
Real-time celestial tracking web app for AstralWeb Innovate track, Aaruush '26.
Team: Cipher (Aryan + Ashraf Khan).

Core innovation: **Zenith Window** — objects at 75°–90° topocentric altitude
(nearly directly overhead) surfaced via a translucent radar cone on a 3D globe.

## Tech stack
- **Framework:** Next.js 14 (App Router), TypeScript, Tailwind CSS
- **3D Globe:** CesiumJS (loaded with `dynamic({ ssr: false })`)
- **State:** Zustand with `subscribeWithSelector`
- **Orbital math:** satellite.js (SGP4 propagation)
- **Data sources:** CelesTrak (TLEs) · OpenNotify (ISS) · NASA Horizons (planets)

## Project structure
/app             → Next.js App Router pages + layout
/app/api         → route handlers: tle/ · iss/ · planets/ · geocode/
/components      → React components (CelestialGlobe, ZenithWindow, TopBar,
                   ObserverPicker, ObjectDetailPanel, PassPredictionPanel, etc.)
/store           → zenithStore.ts (Zustand)
/types           → celestial.ts (TypeScript types)
/lib             → data pipeline, orbital math, API clients
                   (refreshLoop, sgp4Worker, coordTransforms, tleParser,
                    passPredictions, seedDevData)
/public/_cesium  → Cesium static assets (auto-copied by webpack at build)

## Key types (types/celestial.ts)
- CelestialObject — unified type for satellites, ISS, planets
  (includes optional line1/line2 TLE strings for on-demand pass prediction)
- TopocentricPosition — { altitude, azimuth, rangekm }
- GeoPosition — { latitude, longitude, heightKm } (WGS-84 for Cesium)
- ObserverLocation — { latitude, longitude, altitudeM, label }
- ISS_NAME_PATTERN / isISSName(name) — shared ISS matcher (worker + refreshLoop)
  so categorisation and live-position promotion never disagree → single ISS

## Store shape (store/zenithStore.ts)
- observer — current user location
- objects — Map<id, CelestialObject> (full catalogue)
- zenithObjects — filtered array where inZenithWindow === true
- selectedObjectId — id of object whose ObjectDetailPanel is open (null = none)
- upsertObjects(objs[]) — bulk update + auto-recomputes zenithObjects
- setObserver(loc) — move observer (cone redraws via subscription; topo Alt/Az
  re-derive on the next pipeline tick)
- setSelectedObjectId(id) — drives ObjectDetailPanel (set by globe click handler)
- showZenithCone / toggleZenithCone — cone visibility

## Zenith Window constants
export const ZENITH_WINDOW = { minAlt: 75, maxAlt: 90 }
inZenithWindow = topo.altitude >= 75 && topo.altitude <= 90

## CesiumJS setup rules (important)
- Always dynamic(() => import("@/components/CelestialGlobe"), { ssr: false })
- CESIUM_BASE_URL is set via DefinePlugin in next.config.ts → /_cesium
- Cesium assets are copied to public/_cesium/ by copy-webpack-plugin at build
- Token in .env.local as NEXT_PUBLIC_CESIUM_ION_TOKEN
- Cesium widgets CSS: import inside async getCesium() helper, not at module level

## Data pipeline (Day 2 target — lib/)
1. Fetch TLE from CelesTrak
2. Propagate with satellite.js sgp4() → ECI position vector
3. ECI → ECEF via eciToEcef() with current GMST
4. ECEF → geodetic (lat/lng/height) via eciToGeodetic()
5. Compute topocentric Alt/Az via ecfToLookAngles()
6. Flag inZenithWindow if altitude ∈ [75°, 90°]
7. upsertObjects() into Zustand store → Cesium entities auto-sync

NASA Horizons fallback: if Horizons API is unreachable, use cached ephemeris
from last successful fetch stored in a module-level cache object in lib/

## D4/D5 additions
- ISS: refreshLoop.promoteISS() finds the ISS in the propagated catalogue,
  forces category 'iss', and overlays the live /api/iss (OpenNotify) position;
  on failure keeps the SGP4 position (never dropped).
- Planets: refreshLoop.fetchPlanetObjects() appends /api/planets (NASA Horizons)
  objects each tick; a 503 is skipped (best-effort), satellites keep running.
- API routes: /api/iss (OpenNotify, revalidate 3) · /api/planets (Horizons,
  revalidate 60, sequential per-target to avoid throttling) · /api/geocode
  (Nominatim proxy for the observer city search).
- Pass predictions: lib/passPredictions.ts computePassPredictions() steps SGP4
  in 10s increments, detecting altitude crossings of 10°. Runs in sgp4Worker via
  the PREDICT_PASSES message → PASS_PREDICTIONS response.
- UI: ObserverPicker (city search + geolocation + manual lat/lng; bottom sheet on
  mobile), ObjectDetailPanel (slide-in on globe entity click, live readouts,
  embeds PassPredictionPanel for satellites/ISS only), TopBar observer toggle.
- Globe selection: CelestialGlobe LEFT_CLICK ScreenSpaceEventHandler sets
  selectedObjectId (null on background click → panel slides out).

NOTE: CelesTrak is currently unreachable from the dev environment, so /api/tle
502s and the live pipeline stays empty — verify object features via ?dev=true
seed (lib/seedDevData.ts). OpenNotify / Horizons / Nominatim are reachable.

## Dev conventions
- All API calls go through /app/api/ route handlers (server-side), never
  directly from the browser (avoids CORS on CelesTrak/Horizons)
- Colour per category: satellite=#4fc3f7  iss=#ffcc02  planet=#ff8c69
- Entities in Zenith Window get pixelSize=8, label shown; others pixelSize=4
- Observer default: Chennai 12.9716°N, 80.2437°E (near Vellore/VIT)
- Dev seed: lib/seedDevData.ts + <DevSeedButton /> (dev only, never ships)

## Day-by-day sprint
- D1 ✓ Scaffold + CesiumJS globe + Zustand store + dev seed
- D2 ✓ Data pipeline (CelesTrak TLEs + satellite.js + Alt/Az; SGP4 in a Web Worker)
- D3 ✓ Zenith Window cone + real-time object markers (category colours, in-place
       marker diffing, observer-reactive cone, 2h localStorage TLE cache)
- D4 ✓ ISS (OpenNotify live position) + Planets (NASA Horizons) integration
       (shared ISS matcher, /api/iss + /api/planets routes)
- D5 ✓ UI panels: ObserverPicker (search/geolocation/manual + mobile bottom
       sheet) · PassPredictionPanel (SGP4 pass engine in worker) · ObjectDetailPanel
       (globe-click selection, live readouts) · /api/geocode
- D6 → Polish: animations, loading states, mobile layout
- D7 → Hardening: fallbacks, error boundaries, demo script

## Commands
npm run dev      — start dev server on :3000
npm run build    — production build (also copies Cesium assets)
npx tsc --noEmit — type-check only