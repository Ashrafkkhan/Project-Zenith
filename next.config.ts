import type { NextConfig } from 'next'
import path from 'path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const CopyPlugin = require('copy-webpack-plugin')

const cesiumSource = path.join(process.cwd(), 'node_modules/cesium/Build/Cesium')
const cesiumDest = path.join(process.cwd(), 'public/_cesium')

const nextConfig: NextConfig = {
  transpilePackages: ['cesium'],
    
  webpack(config, { isServer, webpack }) {
    config.experiments = { ...config.experiments, topLevelAwait: true }
    if (!isServer) {
      config.plugins.push(
        new webpack.DefinePlugin({
          CESIUM_BASE_URL: JSON.stringify('/_cesium'),
        }),
        new CopyPlugin({
          patterns: [
            { from: path.join(cesiumSource, 'Workers'), to: path.join(cesiumDest, 'Workers') },
            { from: path.join(cesiumSource, 'ThirdParty'), to: path.join(cesiumDest, 'ThirdParty') },
            { from: path.join(cesiumSource, 'Assets'), to: path.join(cesiumDest, 'Assets') },
            { from: path.join(cesiumSource, 'Widgets'), to: path.join(cesiumDest, 'Widgets') },
          ],
        }),
        // satellite.js@7 re-exports Emscripten WASM glue that imports node:fs /
        // node:module / node:path / node:url behind dead ENVIRONMENT_IS_NODE
        // branches. In the browser bundle webpack chokes on the "node:" scheme,
        // so strip the prefix; the bare names then resolve to the empty-module
        // fallbacks below (the Node code path never runs in the browser).
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, '')
        })
      )

      // NOTE: The @zip.js/zip.js/lib/zip-no-worker.js import in Cesium's
      // KmlDataSource is fixed by the "overrides" pin in package.json (2.8.x
      // dropped that file). We do NOT alias @zip.js here — the override hoists
      // it under @cesium/engine/node_modules, so require.resolve('@zip.js/zip.js')
      // from the project root would throw at config-load time.

      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        module: false,
        url: false,
        util: false,
        worker_threads: false,
      }
    }
    return config
  },
}

export default nextConfig
