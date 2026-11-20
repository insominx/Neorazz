// @ts-check
// neorazz-embed.js: puts a Neorazz host screen on your own page (a slide deck,
// a class site, any web app) and drives it from there.
//
// Every Neorazz host serves this file at /neorazz-embed.js, so the copy you
// load always speaks that host's version of the protocol. A plain script, no
// build step:
//
//   <div id="quiz" style="width: 960px; aspect-ratio: 16 / 9"></div>
//   <script src="https://quiz.example.org/neorazz-embed.js"></script>
//   <script>
//     const quiz = NeorazzEmbed.mount({
//       host: "https://quiz.example.org",
//       container: document.getElementById("quiz"),
//     })
//     quiz.ensureGame({ quiz: "my-quiz" })
//     quiz.on("status", (state) => console.log(state.screen, state.inviteCode))
//   </script>
//
// The host has to allow your page: list its origin in NEORAZZ_EMBED_ORIGINS
// (pages on localhost and 127.0.0.1 are always allowed). The guide and the full
// protocol are in docs/embedding.md in the Neorazz repository.
//
// Every command in the protocol is a method of the same name that takes the
// command's fields: quiz.play({ question: 0 }), quiz.startPoll({ poll }),
// quiz.visibility({ visible: false }). Commands are sent, not awaited: what
// happened shows in the next `status`, and a command that did not run is
// answered with a `result` or `error` that says why.

/**
 * @typedef {object} MountOptions
 * @property {string} host The host's address; only its origin is used.
 * @property {HTMLElement} [container] Where the frame goes (document.body).
 * @property {boolean} [visible] Whether the frame starts shown (true).
 * @property {"always" | "login" | "never"} [interactive] When the frame takes
 *   clicks ("always"); "login" only while the host page waits for the password.
 * @property {"own" | "slide"} [backdrop] Sent with the first `ready`.
 * @property {boolean} [controls] Sent with the first `ready`.
 * @property {string} [title] The frame's accessible name ("Neorazz").
 */

/**
 * @typedef {Record<string, unknown>} State
 * @typedef {Record<string, unknown> & { type: string }} Message
 * @typedef {(data: unknown) => void} Listener
 */

;(function neorazzEmbed() {
  "use strict"

  // What this page puts on its messages, and what the host page puts on its.
  const SOURCE = "neorazz-embed"
  const BRIDGE_SOURCE = "razzia-bridge"
  const VERSION = 1
  const HELLO_EVERY_MS = 1000
  // A host that has not answered by then may have been asleep or restarting
  // when the frame loaded: the frame is loaded again, less often each time.
  const RELOAD_FIRST_MS = 10000
  const RELOAD_MOST_MS = 60000
  // A command sent before the host page could hear it waits for it this long,
  // as the host page itself holds a question it cannot play yet. Opening and
  // closing a room wait as long as it takes.
  const HOLD_FOR_MS = 10000
  const HOLD_FOREVER = ["ensureGame", "close"]

  const COMMANDS = [
    "inbox",
    "markAsk",
    "markAllAsks",
    "askOpen",
    "ensureGame",
    "close",
    "play",
    "leaderboard",
    "finish",
    "review",
    "visibility",
    "controls",
    "backdrop",
    "sound",
    "startPoll",
    "closePoll",
    "dismissPoll",
    "reviewPoll",
    "askBox",
  ]

  // Settings the host page keeps only in memory. A reload of the frame (a
  // restart of the host, a lost connection) forgets them, so the last one of
  // each is sent again after every `ready`.
  const STICKY = [
    "visibility",
    "controls",
    "backdrop",
    "sound",
    "askBox",
    "inbox",
  ]

  /**
   * A message from the host page, read only if it has the host page's tag.
   *
   * @param {unknown} data
   * @returns {data is Message}
   */
  function isBridgeMessage(data) {
    if (typeof data !== "object" || data === null) {
      return false
    }

    const fields = Object.fromEntries(Object.entries(data))

    return (
      fields.source === BRIDGE_SOURCE &&
      fields.v === VERSION &&
      typeof fields.type === "string"
    )
  }

  /**
   * @param {unknown} value
   * @returns {value is State}
   */
  function isState(value) {
    return typeof value === "object" && value !== null
  }

  /**
   * @param {Partial<MountOptions>} [options]
   */
  function mount(options) {
    if (typeof options?.host !== "string") {
      throw new TypeError('NeorazzEmbed.mount needs { host: "https://..." }')
    }

    const { origin } = new URL(options.host)
    const container = options.container ?? document.body
    const interactive = options.interactive ?? "always"

    /** @type {Map<string, Set<Listener>>} */
    const listeners = new Map()
    /** @type {Map<string, Message>} */
    const sticky = new Map()
    /** @type {{ body: Message, at: number }[]} */
    let held = []
    /** @type {State | null} */
    let state = null
    // Whether the page in the frame now has heard this one (since its last
    // load), and whether any page ever has.
    let listening = false
    let everReady = false
    let visible = options.visible !== false
    let destroyed = false
    let warned = false
    let reloadAfter = RELOAD_FIRST_MS
    /** @type {ReturnType<typeof setInterval> | null} */
    let helloTimer = null
    /** @type {ReturnType<typeof setTimeout> | null} */
    let silentTimer = null
    /** @type {((first: State | null) => void) | null} */
    let resolveReady = null
    /** @type {Promise<State | null>} */
    const firstReady = new Promise((resolve) => {
      resolveReady = resolve
    })

    const frameUrl = `${origin}/manager?embed=deck`
    const frame = document.createElement("iframe")
    frame.src = frameUrl
    frame.title = options.title ?? "Neorazz"
    // The host page plays music and sounds.
    frame.allow = "autoplay"
    // The host page is dark. A frame whose color scheme differs from its
    // document's is painted opaque, which would hide your page behind a clear
    // backdrop ("slide").
    frame.style.cssText =
      "display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:dark;"
    container.appendChild(frame)

    /**
     * @param {string} type
     * @param {unknown} data
     */
    function emit(type, data) {
      listeners.get(type)?.forEach((listener) => {
        try {
          listener(data)
        } catch (error) {
          // One listener's mistake must not stop the others.
          setTimeout(() => {
            throw error
          })
        }
      })
    }

    /** @param {Message} body */
    function post(body) {
      if (destroyed) {
        return
      }

      frame.contentWindow?.postMessage(
        { source: SOURCE, v: VERSION, ...body },
        origin,
      )
    }

    // The frame takes clicks only while it is shown, and, with "login", only
    // while the host page waits for the presenter's password.
    function applyFrameStyle() {
      const needsLogin = state?.loggedIn === false
      const clickable =
        visible &&
        (interactive === "always" || (interactive === "login" && needsLogin))

      frame.style.opacity = visible ? "1" : "0"
      frame.style.pointerEvents = clickable ? "auto" : "none"
    }

    // Says once why the host may be silent, then loads the frame again.
    function onSilent() {
      if (!warned) {
        warned = true
        console.warn(
          `NeorazzEmbed: no answer from ${origin} yet. Check that the host is up, that it lists this page's origin (${window.location.origin}) in NEORAZZ_EMBED_ORIGINS, that this page is not opened from a file, and that it is not itself inside a frame.`,
        )
      }

      reloadAfter = Math.min(reloadAfter * 2, RELOAD_MOST_MS)
      frame.src = frameUrl
    }

    function stopHello() {
      if (helloTimer !== null) {
        clearInterval(helloTimer)
        helloTimer = null
      }

      if (silentTimer !== null) {
        clearTimeout(silentTimer)
        silentTimer = null
      }
    }

    // Keeps saying hello until the host page answers: it may still be
    // loading, or showing an error page before the server is up.
    function sayHello() {
      listening = false
      stopHello()
      post({ type: "hello" })
      helloTimer = setInterval(() => {
        post({ type: "hello" })
      }, HELLO_EVERY_MS)
      silentTimer = setTimeout(onSilent, reloadAfter)
    }

    // Commands that waited for the page: settings first, then the rest in the
    // order they were sent. One that waited too long is answered here, as the
    // host page answers one it held too long.
    function flush() {
      STICKY.forEach((type) => {
        const body = sticky.get(type)

        if (body) {
          post(body)
        }
      })

      const waiting = held
      held = []
      waiting.forEach((entry) => {
        const { type } = entry.body

        if (
          !HOLD_FOREVER.includes(type) &&
          Date.now() - entry.at > HOLD_FOR_MS
        ) {
          const answer = {
            source: BRIDGE_SOURCE,
            v: VERSION,
            type: "result",
            command: type,
            outcome: "ignored",
            reason: "expired",
            local: true,
          }
          emit("message", answer)
          emit("result", answer)

          return
        }

        post(entry.body)
      })
    }

    /** @param {State} next */
    function takeState(next) {
      state = next
      applyFrameStyle()
    }

    /** @param {MessageEvent<unknown>} event */
    function onMessage(event) {
      if (event.source !== frame.contentWindow || event.origin !== origin) {
        return
      }

      const { data } = event

      if (!isBridgeMessage(data)) {
        return
      }

      const isStateMessage = data.type === "ready" || data.type === "status"

      if (isStateMessage && isState(data.state)) {
        takeState(data.state)
      }

      if (data.type === "ready") {
        stopHello()
        listening = true
        reloadAfter = RELOAD_FIRST_MS
        flush()
      }

      emit("message", data)

      if (data.type === "inbox") {
        emit("inbox", data.room)
      } else if (isStateMessage) {
        emit(data.type, data.state)
      } else {
        emit(data.type, data)
      }

      if (data.type === "ready" && !everReady) {
        everReady = true
        resolveReady?.(state)
      }
    }

    // Each page that loads in the frame, the first one included, has not
    // heard from this one yet. Saying hello before it has loaded would only
    // reach the blank page the frame starts with.
    function onLoad() {
      if (!destroyed) {
        sayHello()
      }
    }

    window.addEventListener("message", onMessage)
    frame.addEventListener("load", onLoad)

    /**
     * @param {string} type
     * @param {Record<string, unknown>} [fields]
     */
    function send(type, fields) {
      /** @type {Message} */
      const body = { ...fields, type }
      const isSetting = STICKY.includes(type)

      if (isSetting) {
        // Kept, and sent again to every page that loads in the frame.
        sticky.set(type, body)
      }

      if (type === "visibility") {
        visible = body.visible !== false
        applyFrameStyle()
      }

      if (listening) {
        post(body)
      } else if (!isSetting) {
        held.push({ body, at: Date.now() })
      }
    }

    /**
     * @param {string} type
     * @param {Listener} listener
     */
    function off(type, listener) {
      listeners.get(type)?.delete(listener)
    }

    /**
     * @param {string} type
     * @param {Listener} listener
     * @returns {() => void} Stops listening.
     */
    function on(type, listener) {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)

      return () => {
        off(type, listener)
      }
    }

    /**
     * Resolves with the first state, now or later, that passes the test.
     *
     * @param {(state: State) => boolean} test
     * @param {{ timeout?: number }} [opts]
     * @returns {Promise<State>}
     */
    function when(test, opts) {
      return new Promise((resolve, reject) => {
        if (state !== null && test(state)) {
          resolve(state)

          return
        }

        /** @type {ReturnType<typeof setTimeout> | null} */
        let timer = null
        /** @type {(() => void)[]} */
        const stops = []
        const stop = () => {
          stops.forEach((fn) => {
            fn()
          })

          if (timer !== null) {
            clearTimeout(timer)
          }
        }
        /** @param {unknown} next */
        const check = (next) => {
          if (isState(next) && test(next)) {
            stop()
            resolve(next)
          }
        }

        stops.push(on("status", check), on("ready", check))

        if (typeof opts?.timeout === "number") {
          timer = setTimeout(() => {
            stop()
            reject(new Error("NeorazzEmbed: timed out waiting for a state"))
          }, opts.timeout)
        }
      })
    }

    function destroy() {
      destroyed = true
      stopHello()
      window.removeEventListener("message", onMessage)
      frame.removeEventListener("load", onLoad)
      frame.remove()
    }

    // Every command is a method of its own name: quiz.play({ question: 0 }).
    const commands = Object.fromEntries(
      COMMANDS.map((type) => [
        type,
        /** @param {Record<string, unknown>} [fields] */
        (fields) => {
          send(type, fields)
        },
      ]),
    )

    // The settings asked for in `mount` go out with the first ready, like any
    // other setting the host page keeps.
    sticky.set("visibility", { type: "visibility", visible })

    if (options.backdrop) {
      sticky.set("backdrop", { type: "backdrop", mode: options.backdrop })
    }

    if (typeof options.controls === "boolean") {
      sticky.set("controls", { type: "controls", shown: options.controls })
    }

    applyFrameStyle()
    // In case the frame never loads at all.
    silentTimer = setTimeout(onSilent, reloadAfter)

    return {
      ...commands,
      frame,
      origin,
      // Resolves with the state in the first `ready`.
      ready: firstReady,
      // The latest state the host page reported, or null before the first.
      get state() {
        return state
      },
      send,
      on,
      off,
      when,
      destroy,
    }
  }

  Object.assign(globalThis, {
    NeorazzEmbed: {
      mount,
      COMMANDS: [...COMMANDS],
      SOURCE,
      BRIDGE_SOURCE,
      VERSION,
    },
  })
})()
