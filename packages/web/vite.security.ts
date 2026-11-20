/**
 * Dev and preview servers listen on every interface so phones on the class
 * network can reach them. That makes whatever Vite may serve readable by the
 * whole room, so the workspace's config volume (it holds the manager
 * password) is denied by absolute path.
 */
export const fsDeny = (configDir: string): string[] => [
  // Vite's own defaults, which setting `deny` replaces.
  ".env",
  ".env.*",
  "*.{crt,pem}",
  "**/.git/**",
  `${configDir.replaceAll("\\", "/").replace(/\/+$/u, "")}/**`,
  "**/config/game.json",
]

/**
 * Vite rejects any Host header that is not localhost or an IP address. A
 * teacher serving under a machine name or domain lists it here, or "*".
 */
export const parseAllowedHosts = (raw: string | undefined): true | string[] => {
  const hosts = (raw ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)

  return hosts.includes("*") ? true : hosts
}

/**
 * The dev server's /runtime-config.js, from the same NEORAZZ_EMBED_ORIGINS the
 * Docker image reads when it starts (docker/entrypoint.sh).
 */
export const runtimeConfigScript = (raw: string | undefined): string => {
  const embedOrigins = (raw ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/u, ""))
    .filter(Boolean)

  return `window.__NEORAZZ_CONFIG__ = ${JSON.stringify({ embedOrigins })}\n`
}
