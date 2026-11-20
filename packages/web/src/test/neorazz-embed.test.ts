import {
  BRIDGE_SOURCE,
  COMMAND_TYPES,
  EMBED_SOURCE,
  PROTOCOL_VERSION,
} from "@razzia/web/features/deck/protocol"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { runInThisContext } from "node:vm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The client every host serves at /neorazz-embed.js, loaded as a page would.
const CLIENT = readFileSync(
  resolve(process.cwd(), "public/neorazz-embed.js"),
  "utf8",
)

const HOST = "https://quiz.example.org"

interface Embed {
  frame: HTMLIFrameElement
  origin: string
  ready: Promise<unknown>
  state: Record<string, unknown> | null
  send: (type: string, fields?: Record<string, unknown>) => void
  on: (type: string, listener: (data: unknown) => void) => () => void
  when: (
    test: (state: Record<string, unknown>) => boolean,
    opts?: { timeout?: number },
  ) => Promise<unknown>
  destroy: () => void
  [command: string]: unknown
}

interface Client {
  mount: (options: Record<string, unknown>) => Embed
  COMMANDS: string[]
  SOURCE: string
  BRIDGE_SOURCE: string
  VERSION: number
}

const client = (): Client =>
  (globalThis as unknown as { NeorazzEmbed: Client }).NeorazzEmbed

const state = (fields: Record<string, unknown> = {}) => ({
  connected: true,
  loggedIn: true,
  gameId: null,
  ...fields,
})

const fromFrame = (
  embed: Embed,
  body: Record<string, unknown>,
  { origin = HOST, source = embed.frame.contentWindow } = {},
) => {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { source: BRIDGE_SOURCE, v: PROTOCOL_VERSION, ...body },
      origin,
      source,
    }),
  )
}

let posted = vi.fn()
let embed: Embed | null = null

// Catches what the client posts to the window now in its frame. Loading the
// frame again brings a new window, which needs catching again.
const catchPosts = (frame: HTMLIFrameElement) => {
  Object.defineProperty(frame.contentWindow, "postMessage", {
    value: posted,
    configurable: true,
  })
}

// Mounts with what the client posts caught. The client says hello once the
// frame has loaded; call `loaded` to play that part.
const mount = (options: Record<string, unknown> = {}): Embed => {
  const container = document.createElement("div")
  document.body.append(container)
  const mounted = client().mount({ host: HOST, container, ...options })
  posted = vi.fn()
  catchPosts(mounted.frame)
  embed = mounted

  return mounted
}

const loaded = (quiz: Embed) => {
  quiz.frame.dispatchEvent(new Event("load"))
}

const sentTypes = () =>
  posted.mock.calls.map(([body]) => (body as { type: string }).type)

beforeEach(() => {
  vi.useFakeTimers()
  // Run as the page would run it: a plain script in the global scope.
  runInThisContext(CLIENT)
})

afterEach(() => {
  embed?.destroy()
  embed = null
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ""
})

describe("neorazz-embed.js", () => {
  it("speaks the protocol this build reads", () => {
    expect(client().SOURCE).toBe(EMBED_SOURCE)
    expect(client().BRIDGE_SOURCE).toBe(BRIDGE_SOURCE)
    expect(client().VERSION).toBe(PROTOCOL_VERSION)
    // Every command but the handshake, which the client says itself.
    expect([...client().COMMANDS].sort()).toEqual(
      COMMAND_TYPES.filter((type) => type !== "hello").sort(),
    )
  })

  it("frames the host page in embed mode, allowed to play sound", () => {
    const { frame, origin } = mount({ host: `${HOST}/some/path` })

    expect(origin).toBe(HOST)
    expect(frame.src).toBe(`${HOST}/manager?embed=deck`)
    expect(frame.allow).toBe("autoplay")
    expect(frame.title).toBe("Neorazz")
  })

  it("says hello once the frame has loaded, then every second until it answers", () => {
    const quiz = mount()

    vi.advanceTimersByTime(3_000)

    expect(sentTypes()).toEqual([])

    loaded(quiz)
    vi.advanceTimersByTime(3_000)

    expect(sentTypes()).toEqual(["hello", "hello", "hello", "hello"])
    expect(posted).toHaveBeenLastCalledWith(
      { source: EMBED_SOURCE, v: PROTOCOL_VERSION, type: "hello" },
      HOST,
    )

    fromFrame(quiz, { type: "ready", state: state() })
    posted.mockClear()
    vi.advanceTimersByTime(3_000)

    expect(sentTypes()).not.toContain("hello")
  })

  it("resolves ready with the first state and then sends its settings", async () => {
    const quiz = mount({ backdrop: "slide", controls: false })
    const first = state({ gameId: null })

    fromFrame(quiz, { type: "ready", state: first })

    await expect(quiz.ready).resolves.toEqual(first)
    expect(quiz.state).toEqual(first)
    expect(posted.mock.calls.map((call) => call[0] as unknown)).toEqual([
      { source: EMBED_SOURCE, v: 1, type: "visibility", visible: true },
      { source: EMBED_SOURCE, v: 1, type: "controls", shown: false },
      { source: EMBED_SOURCE, v: 1, type: "backdrop", mode: "slide" },
    ])
  })

  it("holds commands sent before the host page answers, then sends them in order", () => {
    const quiz = mount()
    const send = quiz as unknown as Record<
      string,
      (fields?: Record<string, unknown>) => void
    >

    send.ensureGame({ quiz: "my-quiz" })
    send.play({ question: 0 })

    expect(sentTypes()).toEqual([])

    fromFrame(quiz, { type: "ready", state: state() })

    expect(sentTypes()).toEqual(["visibility", "ensureGame", "play"])
    expect(posted).toHaveBeenCalledWith(
      { source: EMBED_SOURCE, v: 1, type: "play", question: 0 },
      HOST,
    )
  })

  it("answers a question it held too long, as the host page would, but still opens the room", () => {
    const quiz = mount()
    const results: unknown[] = []
    quiz.on("result", (message) => results.push(message))

    vi.spyOn(console, "warn").mockImplementation(() => undefined)
    quiz.send("ensureGame", { quiz: "my-quiz" })
    quiz.send("play", { question: 2 })
    // Silent this long, the frame is loaded again; the new page answers.
    vi.advanceTimersByTime(10_001)
    catchPosts(quiz.frame)
    fromFrame(quiz, { type: "ready", state: state() })

    expect(sentTypes()).toContain("ensureGame")
    expect(sentTypes()).not.toContain("play")
    expect(results).toEqual([
      expect.objectContaining({
        type: "result",
        command: "play",
        outcome: "ignored",
        reason: "expired",
        local: true,
      }),
    ])
  })

  it("reads only the host page's own messages", () => {
    const quiz = mount()
    const seen: unknown[] = []
    quiz.on("message", (message) => seen.push(message))
    const other = document.createElement("iframe")
    document.body.append(other)

    fromFrame(
      quiz,
      { type: "status", state: state() },
      { origin: "https://evil.example" },
    )
    fromFrame(
      quiz,
      { type: "status", state: state() },
      { source: other.contentWindow },
    )
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "someone", v: 1, type: "status", state: state() },
        origin: HOST,
        source: quiz.frame.contentWindow,
      }),
    )
    fromFrame(quiz, { type: "status", state: state(), v: 2 })

    expect(seen).toEqual([])
    expect(quiz.state).toBeNull()
  })

  it("passes on statuses, results, errors, keys and the inbox", () => {
    const quiz = mount()
    const got: Array<[string, unknown]> = []

    for (const type of ["status", "result", "error", "key", "inbox"]) {
      quiz.on(type, (data) => got.push([type, data]))
    }

    fromFrame(quiz, { type: "status", state: state({ screen: "SHOW_ROOM" }) })
    fromFrame(quiz, { type: "result", command: "play", outcome: "accepted" })
    fromFrame(quiz, {
      type: "error",
      code: "quizNotFound",
      command: "ensureGame",
    })
    fromFrame(quiz, {
      type: "key",
      key: "ArrowRight",
      code: "ArrowRight",
      repeat: false,
    })
    fromFrame(quiz, { type: "inbox", room: null })

    expect(got.map(([type]) => type)).toEqual([
      "status",
      "result",
      "error",
      "key",
      "inbox",
    ])
    expect(got[0][1]).toEqual(state({ screen: "SHOW_ROOM" }))
    expect(got[2][1]).toEqual(
      expect.objectContaining({ code: "quizNotFound", command: "ensureGame" }),
    )
    expect(got[4][1]).toBeNull()
  })

  it("waits for a state that passes a test, or gives up after a timeout", async () => {
    const quiz = mount()
    const lobby = quiz.when(
      (next) => next.inviteCode !== null && next.inviteCode !== undefined,
    )

    fromFrame(quiz, { type: "ready", state: state({ inviteCode: null }) })
    fromFrame(quiz, { type: "status", state: state({ inviteCode: "123456" }) })

    await expect(lobby).resolves.toEqual(state({ inviteCode: "123456" }))

    const never = quiz.when(() => false, { timeout: 500 })
    vi.advanceTimersByTime(501)

    await expect(never).rejects.toThrow("timed out")
  })

  it("makes every protocol command a method that sends its fields", () => {
    const quiz = mount()
    fromFrame(quiz, { type: "ready", state: state() })
    posted.mockClear()

    for (const type of COMMAND_TYPES.filter((name) => name !== "hello")) {
      ;(quiz[type] as (fields: Record<string, unknown>) => void)({
        probe: type,
      })

      expect(posted).toHaveBeenLastCalledWith(
        { source: EMBED_SOURCE, v: 1, probe: type, type },
        HOST,
      )
    }
  })

  it("hides the frame from sight and clicks while it is not shown", () => {
    const quiz = mount()
    fromFrame(quiz, { type: "ready", state: state() })

    expect(quiz.frame.style.opacity).toBe("1")
    expect(quiz.frame.style.pointerEvents).toBe("auto")

    quiz.send("visibility", { visible: false })

    expect(quiz.frame.style.opacity).toBe("0")
    expect(quiz.frame.style.pointerEvents).toBe("none")
  })

  it("with interactive: login, takes clicks only while the password is needed", () => {
    const quiz = mount({ interactive: "login" })

    fromFrame(quiz, { type: "ready", state: state({ loggedIn: false }) })

    expect(quiz.frame.style.pointerEvents).toBe("auto")

    fromFrame(quiz, { type: "status", state: state({ loggedIn: true }) })

    expect(quiz.frame.style.pointerEvents).toBe("none")
  })

  it("gives a reloaded frame its settings again, but not its one-off commands", () => {
    const quiz = mount()
    loaded(quiz)
    fromFrame(quiz, { type: "ready", state: state() })
    quiz.send("backdrop", { mode: "slide" })
    quiz.send("play", { question: 0 })
    posted.mockClear()

    loaded(quiz)

    expect(sentTypes()).toEqual(["hello"])

    fromFrame(quiz, { type: "ready", state: state() })

    expect(sentTypes()).toEqual(["hello", "visibility", "backdrop"])
  })

  it("warns once and reloads the frame when the host stays silent", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined)
    const quiz = mount()
    const src = vi.spyOn(quiz.frame, "src", "set")

    vi.advanceTimersByTime(10_000)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain("NEORAZZ_EMBED_ORIGINS")
    expect(src).toHaveBeenCalledWith(`${HOST}/manager?embed=deck`)

    loaded(quiz)
    vi.advanceTimersByTime(60_000)

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("stops listening and takes its frame away when destroyed", () => {
    const quiz = mount()
    const { frame } = quiz

    quiz.destroy()
    embed = null
    vi.advanceTimersByTime(5_000)

    expect(frame.isConnected).toBe(false)
    expect(posted).not.toHaveBeenCalled()
  })
})
