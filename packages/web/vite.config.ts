import tailwindcss from "@tailwindcss/vite"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "url"
import { defineConfig, type Connect, type Plugin } from "vite"
import { version } from "../../package.json"
import { fsDeny, parseAllowedHosts, runtimeConfigScript } from "./vite.security"

const configDir = fileURLToPath(new URL("../../config", import.meta.url))
// Comma-separated host names the dev and preview servers answer to, or "*".
const allowedHosts = parseAllowedHosts(process.env.RAZZIA_ALLOWED_HOSTS)

// Serves /runtime-config.js from NEORAZZ_EMBED_ORIGINS in dev and preview, as
// the Docker image does at start.
const runtimeConfig = (): Plugin => {
  const serve = (middlewares: Connect.Server) => {
    middlewares.use("/runtime-config.js", (_req, res) => {
      res.setHeader("Content-Type", "text/javascript")
      res.setHeader("Cache-Control", "no-cache")
      res.end(runtimeConfigScript(process.env.NEORAZZ_EMBED_ORIGINS))
    })
  }

  return {
    name: "neorazz-runtime-config",
    configureServer: (server) => serve(server.middlewares),
    configurePreviewServer: (server) => serve(server.middlewares),
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  plugins: [
    tanstackRouter({
      target: "react",
      routeToken: "layout",
      routesDirectory: "./src/pages",
      generatedRouteTree: "./src/route.gen.ts",
    }),
    react(),
    tailwindcss(),
    runtimeConfig(),
  ],
  resolve: {
    alias: {
      "@razzia/web": fileURLToPath(new URL("./src", import.meta.url)),
      "@razzia/common": fileURLToPath(
        new URL("../common/src", import.meta.url),
      ),
      "@razzia/socket": fileURLToPath(
        new URL("../socket/src", import.meta.url),
      ),
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    allowedHosts,
    fs: { deny: fsDeny(configDir) },
    proxy: {
      "/ws": {
        target: "http://localhost:3001",
        ws: true,
      },
      "/config-assets": {
        target: "http://localhost:3001",
      },
    },
  },
  preview: {
    port: 3000,
    host: "0.0.0.0",
    allowedHosts,
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
})
