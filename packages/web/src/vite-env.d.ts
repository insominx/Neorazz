/// <reference types="vite/client" />

declare const __APP_VERSION__: string

// Written per host by /runtime-config.js (docker/runtime-config.mjs), loaded
// before the app.
interface Window {
  __NEORAZZ_CONFIG__?: { embedOrigins?: unknown }
}
