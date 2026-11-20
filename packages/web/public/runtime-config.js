// Per-host settings, read before the app starts. This copy is the default for
// a plain build; the Docker image writes its own from NEORAZZ_EMBED_ORIGINS
// when the container starts, and the dev server serves one from the same
// variable.
window.__NEORAZZ_CONFIG__ = { embedOrigins: [] }
