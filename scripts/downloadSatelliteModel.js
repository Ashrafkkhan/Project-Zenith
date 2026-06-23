/**
 * Downloads a satellite GLB model used by the 3D third-person tracking view
 * into public/models/satellite.glb.
 *
 * Run with: node scripts/downloadSatelliteModel.js
 *
 * Uses Cesium's always-available CesiumAir sample glTF as the model. Follows
 * HTTP redirects (GitHub raw can 302 to a CDN) and validates the GLB magic
 * header so a partial / HTML error page is never written silently.
 */

const https = require('https')
const fs = require('fs')
const path = require('path')

const modelUrl =
  'https://raw.githubusercontent.com/CesiumGS/cesium/main/Apps/SampleData/models/CesiumAir/Cesium_Air.glb'

const dest = path.join(__dirname, '../public/models/satellite.glb')
fs.mkdirSync(path.dirname(dest), { recursive: true })

function download(url, redirectsLeft = 5) {
  https
    .get(url, (res) => {
      // Follow redirects.
      if (
        res.statusCode &&
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        if (redirectsLeft === 0) {
          console.error('Too many redirects')
          process.exit(1)
        }
        res.resume()
        download(res.headers.location, redirectsLeft - 1)
        return
      }

      if (res.statusCode !== 200) {
        console.error(`Download failed: HTTP ${res.statusCode}`)
        process.exit(1)
      }

      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        // GLB magic header is the ASCII "glTF" (0x46546C67 little-endian).
        if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'glTF') {
          console.error('Downloaded file is not a valid GLB (bad magic header)')
          process.exit(1)
        }
        fs.writeFileSync(dest, buf)
        console.log(`OK: wrote ${buf.length} bytes to ${dest}`)
      })
    })
    .on('error', (err) => {
      console.error('Request error:', err.message)
      process.exit(1)
    })
}

download(modelUrl)
