// A lecture deck frames the host page and drives its game. The page knows it
// is embedded only when the deck frames it directly and asked for it with
// `?embed=deck`; in-app navigation drops the query, so the flag is kept for
// the frame's session.

const EMBED_KEY = "razzia_embed"
const EMBED_VALUE = "deck"

// Decks served on the presenter's own machine, on any port, are always
// allowed. Any other site that may frame and drive this page is listed by the
// host in NEORAZZ_EMBED_ORIGINS, which `/runtime-config.js` hands to the page.
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"])

// Exact origins only (scheme, host and port, nothing after); anything else in
// the list is ignored.
export const parseEmbedOrigins = (raw: unknown): Set<string> => {
  const origins = new Set<string>()

  if (!Array.isArray(raw)) {
    return origins
  }

  for (const entry of raw) {
    if (typeof entry !== "string") {
      continue
    }

    try {
      const url = new URL(entry)

      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        url.origin === entry
      ) {
        origins.add(entry)
      }
    } catch {
      // Not an address.
    }
  }

  return origins
}

const configuredEmbedOrigins = (): Set<string> => {
  try {
    return parseEmbedOrigins(window.__NEORAZZ_CONFIG__?.embedOrigins)
  } catch {
    return new Set()
  }
}

const DECK_ORIGINS = configuredEmbedOrigins()

type FlagStorage = Pick<Storage, "getItem" | "setItem">

interface EmbedContext {
  search: string
  framed: boolean
  parentIsTop: boolean
  storage: FlagStorage | null
}

export const detectDeckEmbed = ({
  search,
  framed,
  parentIsTop,
  storage,
}: EmbedContext): boolean => {
  if (!framed || !parentIsTop) {
    return false
  }

  if (new URLSearchParams(search).get("embed") === EMBED_VALUE) {
    try {
      storage?.setItem(EMBED_KEY, EMBED_VALUE)
    } catch {
      // Refused storage only loses the flag after a later navigation.
    }

    return true
  }

  try {
    return storage?.getItem(EMBED_KEY) === EMBED_VALUE
  } catch {
    return false
  }
}

export const isAllowedDeckOrigin = (
  origin: string,
  allowed: ReadonlySet<string> = DECK_ORIGINS,
): boolean => {
  if (allowed.has(origin)) {
    return true
  }

  try {
    const url = new URL(origin)

    return (
      url.protocol === "http:" &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      url.origin === origin
    )
  } catch {
    return false
  }
}

const sessionStorageOrNull = (): FlagStorage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

// Read once, before the router runs and rewrites the URL.
export const IS_DECK_EMBED = detectDeckEmbed({
  search: window.location.search,
  framed: window.parent !== window,
  parentIsTop: window.parent === window.top,
  storage: sessionStorageOrNull(),
})
