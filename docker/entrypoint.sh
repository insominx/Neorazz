#!/bin/sh
# Runs as root only long enough to hand the (possibly bind-mounted) config dir to the
# unprivileged user the socket server runs as, then starts supervisord.
mkdir -p /app/config
chown -R node:node /app/config 2>/dev/null || true

# Per-host page settings, written fresh on every start so a host changes them with a
# restart, not a rebuild. NEORAZZ_EMBED_ORIGINS is a comma-separated list of origins
# (https://slides.example.org) whose pages may frame /manager?embed=deck and drive
# it; decks on localhost or 127.0.0.1 are always allowed. Only characters an origin
# uses are kept, so nothing else can reach the script, and the page drops any entry
# that is not an exact origin. packages/web/vite.security.ts does the same for dev.
embed_origins=$(printf '%s' "${NEORAZZ_EMBED_ORIGINS:-}" | tr -cd 'A-Za-z0-9:/._,-' |
  sed -e 's#/*,#,#g' -e 's#/*$##' -e 's/,,*/,/g' -e 's/^,//' -e 's/,$//' -e 's/[^,][^,]*/"&"/g')
printf 'window.__NEORAZZ_CONFIG__ = {"embedOrigins":[%s]}\n' "$embed_origins" > /app/web/runtime-config.js
exec supervisord -c /etc/supervisord.conf
