# 🌌 Project Zenith — The Celestial Eye

> Real-time celestial tracking web app built for the **AstralWeb Innovate** track, **Aaruush '26**.
> **Team Cipher** — Aryan · Ashraf Khan

![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)
![CesiumJS](https://img.shields.io/badge/CesiumJS-1.129-blue?logo=cesium)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38bdf8?logo=tailwindcss)

---

## ✨ What is Zenith?

Zenith is an interactive 3D globe application that tracks satellites, the ISS, and planets in real time. Its core innovation is the **Zenith Window** — a translucent radar cone rendered on a CesiumJS globe that highlights celestial objects at **75°–90° topocentric altitude** (nearly directly overhead from the observer's location).

### Key Features

- 🌍 **Interactive 3D Globe** — Powered by CesiumJS with full rotation, zoom, and tilt
- 📡 **Live Satellite Tracking** — TLE data from CelesTrak, propagated with SGP4 (satellite.js)
- 🛰️ **ISS Tracking** — Real-time position from OpenNotify API
- 🪐 **Planet Positions** — Ephemeris data from NASA Horizons
- 🎯 **Zenith Window** — Visual cone overlay showing objects directly overhead
- 📊 **Zustand State Management** — Reactive, real-time UI updates
- 🗺️ **Observer Location Picker** — Change your viewing position on Earth

---

## 📋 Prerequisites

Before you begin, make sure you have the following installed:

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | 18.x or later | [nodejs.org](https://nodejs.org/) |
| **npm** | 9.x or later (comes with Node.js) | — |
| **Git** | Any recent version | [git-scm.com](https://git-scm.com/) |

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/BREAD-06/Project-Zenith.git
cd Project-Zenith/zenith
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env.local` file in the `zenith/` directory:

```bash
cp .env.local.example .env.local
```

Or manually create `.env.local` with the following content:

```env
# Get your free token at https://ion.cesium.com/tokens
NEXT_PUBLIC_CESIUM_ION_TOKEN=your_cesium_token_here
```

#### How to get a Cesium Ion Token (free):

1. Go to [https://ion.cesium.com/signup](https://ion.cesium.com/signup) and create a free account
2. Navigate to **Access Tokens** in your dashboard
3. Copy your **Default Token** (or create a new one)
4. Paste it into your `.env.local` file

### 4. Run the development server

```bash
npm run dev
```

### 5. Open the app

Visit [http://localhost:3000](http://localhost:3000) in your browser. You should see a 3D globe with real-time celestial tracking!

> **💡 Tip:** Append `?dev=true` to the URL (e.g., `http://localhost:3000?dev=true`) to enable the **Dev Seed Button**, which populates the globe with sample satellite data for testing.

---

## 🔨 Recreating From Scratch (Optional)

> **You do NOT need this section if you cloned the repo.** `npm install` already handles everything via `package.json`. This is only for reference — it documents exactly how the project was originally scaffolded.

### Step 1 — Scaffold the Next.js app

```bash
npx create-next-app@latest zenith --typescript --tailwind --app --no-eslint
cd zenith
```

### Step 2 — Install project dependencies

```bash
npm install cesium copy-webpack-plugin satellite.js zustand
```

| Package | Purpose |
|---------|---------|
| `cesium` | 3D globe rendering engine |
| `copy-webpack-plugin` | Copies Cesium static assets to `public/_cesium/` at build |
| `satellite.js` | SGP4 orbital propagation for satellite tracking |
| `zustand` | Lightweight reactive state management |

### Step 3 — Fix the @zip.js compatibility issue

Cesium 1.129 depends on `@zip.js/zip.js` but uses import paths that were removed in v2.8.x. Add this override to your `package.json`:

```json
{
  "overrides": {
    "@zip.js/zip.js": "2.7.73"
  }
}
```

Then re-install:

```bash
npm install
```

### Step 4 — Configure Webpack for CesiumJS

Copy the Webpack configuration from [`next.config.ts`](next.config.ts) to your project. This handles:
- Copying Cesium assets (Workers, ThirdParty, Assets, Widgets) to `public/_cesium/`
- Setting `CESIUM_BASE_URL` to `/_cesium`
- Stripping `node:` prefix from satellite.js imports
- Setting Node.js built-in fallbacks to `false`

### Step 5 — Set up PostCSS for Tailwind CSS 4

Create `postcss.config.mjs`:

```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
export default config;
```

### Step 6 — Set up the Cesium Ion token

Create a `.env.local` file:

```env
NEXT_PUBLIC_CESIUM_ION_TOKEN=your_cesium_token_here
```

---

## 🏗️ Project Structure

```
zenith/
├── app/                    # Next.js App Router
│   ├── api/
│   │   └── tle/            # Server-side TLE proxy (avoids CORS)
│   ├── globals.css          # Global styles
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main page (globe + UI)
│
├── components/             # React components
│   ├── CelestialGlobe.tsx   # CesiumJS 3D globe (client-only)
│   ├── GlobeWrapper.tsx     # Dynamic import wrapper (SSR-safe)
│   ├── TopBar.tsx           # Navigation / status bar
│   ├── ZenithWindow.tsx     # Zenith cone radar overlay
│   └── DevSeedButton.tsx    # Dev-only: seed sample data
│
├── lib/                    # Core logic & data pipeline
│   ├── coordTransforms.ts   # ECI → ECEF → Geodetic → Topocentric
│   ├── refreshLoop.ts       # Real-time refresh loop (drives the SGP4 worker)
│   ├── sgp4Worker.ts        # Web Worker: TLE fetch + SGP4 propagation
│   ├── seedDevData.ts       # Sample satellite data for development
│   └── tleParser.ts         # TLE (Two-Line Element) parser
│
├── store/                  # State management
│   └── zenithStore.ts       # Zustand store (observer, objects, zenith filter)
│
├── types/                  # TypeScript type definitions
│   └── celestial.ts         # CelestialObject, TopocentricPosition, etc.
│
├── public/
│   └── _cesium/             # Cesium static assets (auto-copied at build)
│
├── next.config.ts          # Webpack config for Cesium + satellite.js
├── package.json
├── tsconfig.json
└── .env.local              # Environment variables (not committed)
```

---

## 🛠️ Tech Stack

| Technology | Purpose |
|------------|---------|
| [Next.js 16](https://nextjs.org/) | React framework (App Router) |
| [CesiumJS](https://cesium.com/) | 3D globe rendering |
| [satellite.js](https://github.com/shashwatak/satellite-js) | SGP4 orbital propagation |
| [Zustand](https://zustand-demo.pmnd.rs/) | Lightweight state management |
| [Tailwind CSS 4](https://tailwindcss.com/) | Utility-first CSS |
| [TypeScript](https://www.typescriptlang.org/) | Type safety |

---

## 📜 Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the development server (default: port 3000) |
| `npm run build` | Create a production build (also copies Cesium assets) |
| `npm run start` | Start the production server |
| `npx tsc --noEmit` | Run TypeScript type-checking only |

---

## 🔧 Configuration Notes

### CesiumJS Setup

CesiumJS requires static assets (Workers, ThirdParty, Assets, Widgets) to be served from a known base URL. This project handles it automatically:

- **`next.config.ts`** uses `copy-webpack-plugin` to copy Cesium assets from `node_modules` to `public/_cesium/` at build time
- **`CESIUM_BASE_URL`** is set to `/_cesium` via Webpack's `DefinePlugin`
- The globe component is loaded with `dynamic(() => import(...), { ssr: false })` to prevent server-side rendering issues

### satellite.js Compatibility

satellite.js v7 includes WASM glue code that references Node.js built-in modules (`node:fs`, `node:path`, etc.). The Webpack config in `next.config.ts` handles this by:
- Stripping the `node:` prefix via `NormalModuleReplacementPlugin`
- Setting Node built-ins to `false` in `resolve.fallback`

### @zip.js Compatibility

Cesium 1.129 imports `@zip.js/zip.js` v2.7.x paths that were removed in v2.8.x. The `package.json` includes an `overrides` field to pin `@zip.js/zip.js` to `2.7.73`.

---

## 🌐 Data Sources

| Source | Data | API |
|--------|------|-----|
| [CelesTrak](https://celestrak.org/) | Satellite TLEs | Proxied via `/api/tle` |
| [OpenNotify](http://open-notify.org/) | ISS position | Direct |
| [NASA Horizons](https://ssd.jpl.nasa.gov/horizons/) | Planet ephemeris | Direct |

> **Note:** All external API calls go through Next.js API route handlers (server-side) to avoid CORS issues.

---

## 🤝 Contributing

1. **Fork** the repository
2. **Create** your feature branch: `git checkout -b feature/my-feature`
3. **Commit** your changes: `git commit -m "Add my feature"`
4. **Push** to the branch: `git push origin feature/my-feature`
5. **Open** a Pull Request

---

## 📄 License

This project was built for the **AstralWeb Innovate** track at **Aaruush '26** by **Team Cipher**.

---

## 🙏 Acknowledgments

- [CesiumJS](https://cesium.com/) for the incredible 3D globe engine
- [CelesTrak](https://celestrak.org/) for satellite TLE data
- [satellite.js](https://github.com/shashwatak/satellite-js) for SGP4 propagation
- [NASA JPL Horizons](https://ssd.jpl.nasa.gov/horizons/) for planetary ephemeris
