import { EVENTS } from "@razzia/common/constants"
import type { LectureState, PublicPlayer } from "@razzia/common/types/game"
import { STATUS } from "@razzia/common/types/game/status"
import type { ManagerConfig } from "@razzia/common/types/manager"
import type { BridgeMessage } from "@razzia/web/features/deck/protocol"
import { useDeckBridge } from "@razzia/web/features/deck/use-deck-bridge"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { usePollStore } from "@razzia/web/features/poll/stores/poll"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The bridge and the room's question box (contract section 7): what the deck
// is told, the `askBox` command held and applied to every room, no reply, and
// no question or name in any message.

const DECK = "http://localhost:8776"

type Handler = (..._args: never[]) => void

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  navigate: vi.fn(),
  setSuppressed: vi.fn(),
  router: { pathname: "/manager" },
  socket: { emit: vi.fn(), timeout: vi.fn(() => ({ emit: vi.fn() })) },
}))

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  useSocket: () => ({ socket: mocks.socket, isConnected: true }),
  useEvent: (event: string, callback: Handler) => {
    mocks.handlers.set(event, callback)
  },
}))

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useRouterState: ({
    select,
  }: {
    select: (_state: { location: { pathname: string } }) => string
  }) => select({ location: { pathname: mocks.router.pathname } }),
}))

vi.mock("@razzia/web/features/game/stores/sound", () => ({
  useSoundStore: Object.assign(
    (select: (_state: { muted: boolean; volume: number }) => unknown) =>
      select({ muted: false, volume: 1 }),
    { getState: () => ({ setSuppressed: mocks.setSuppressed }) },
  ),
}))

const config = {
  quizz: [],
  results: [],
  game: { visuals: {}, resolvedVisuals: {} },
} as unknown as ManagerConfig

const lectureState = (overrides: Partial<LectureState> = {}): LectureState => ({
  inviteCode: "123456",
  total: 6,
  played: [],
  current: null,
  finished: false,
  ...overrides,
})

// Words that must never reach the deck, whatever the page is handed.
const TEXT = "Why does the quaternion flip?"
const NAME = "Zelda"
const RECORD_ID = "rec-Xy12ab34Cd"

const fire = (event: string, ...args: unknown[]) => {
  act(() => {
    mocks.handlers.get(event)?.(...(args as never[]))
  })
}

const sendCommand = (body: Record<string, unknown>) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "cst426-deck", v: 1, ...body },
        origin: DECK,
        source: window,
      }),
    )
  })
}

const setLecture = (lecture: LectureState | null) => {
  act(() => {
    useManagerStore.setState({ lecture })
  })
}

// This page becomes the manager of `gameId`, as after a resume or a reattach.
const attach = (
  gameId = "g-1",
  lecture: LectureState | null = lectureState(),
) => {
  act(() => {
    useManagerStore.setState({
      gameId,
      status: {
        name: STATUS.SHOW_ROOM,
        data: { inviteCode: "123456" },
      } as never,
      lecture,
      config,
    })
  })
  fire(EVENTS.MANAGER.SUCCESS_RECONNECT, {
    gameId,
    ...(lecture ? { lecture } : {}),
  })
}

const postMessage = vi.fn<(_message: BridgeMessage, _origin: string) => void>()

const posted = () => postMessage.mock.calls.map(([message]) => message)

const lastState = () =>
  posted()
    .flatMap((message) =>
      message.type === "status" || message.type === "ready"
        ? [message.state]
        : [],
    )
    .at(-1)

const replies = () =>
  posted().filter(
    (message) => message.type === "result" || message.type === "error",
  )

const askBoxSent = () =>
  mocks.socket.emit.mock.calls
    .filter(([event]) => event === EVENTS.MANAGER.SET_ASK_BOX)
    .map(([, message]) => message as { gameId: string; open: boolean })

// A lecture state with more in it than the server sends, as a check that the
// bridge copies only the two numbers.
const leaky = (asks: { waiting: number; open: boolean }) =>
  lectureState({
    asks: { ...asks, text: TEXT, name: NAME, recordId: RECORD_ID },
    lastAsk: { text: TEXT, name: NAME },
  } as unknown as Partial<LectureState>)

const postedStates = () =>
  posted().flatMap((message) =>
    message.type === "status" || message.type === "ready"
      ? [message.state]
      : [],
  )

const askKeys = () =>
  postedStates().flatMap(({ asks }) =>
    asks ? [Object.keys(asks).sort().join(",")] : [],
  )

const mount = () => {
  renderHook(() => {
    useDeckBridge()
  })
  sendCommand({ type: "hello" })
}

beforeEach(() => {
  mocks.handlers.clear()
  mocks.navigate.mockReset()
  mocks.setSuppressed.mockReset()
  mocks.socket.emit.mockReset()
  mocks.router.pathname = "/manager"
  useManagerStore.getState().reset()
  usePollStore.getState().reset()
  postMessage.mockReset()
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
  vi.spyOn(window, "postMessage").mockImplementation(
    (message: unknown, origin: unknown) => {
      postMessage(message as BridgeMessage, origin as string)
    },
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("state.asks (7.2)", () => {
  it("lists asks in features", () => {
    mount()

    expect(lastState()?.features).toContain("asks")
  })

  it("is null before this page is attached", () => {
    mount()

    expect(lastState()?.asks).toBeNull()
  })

  it("is { waiting: 0, open: true } for a fresh lecture room", () => {
    mount()
    attach()

    expect(lastState()?.asks).toEqual({ waiting: 0, open: true })
  })

  it("follows the room's count and box, posting a status on each change", () => {
    mount()
    attach()
    setLecture(lectureState({ asks: { waiting: 1, open: true } }))
    expect(lastState()?.asks).toEqual({ waiting: 1, open: true })

    setLecture(lectureState({ asks: { waiting: 0, open: false } }))
    expect(lastState()?.asks).toEqual({ waiting: 0, open: false })
  })

  it("never tells more than 10", () => {
    mount()
    attach()
    setLecture(lectureState({ asks: { waiting: 37, open: true } }))

    expect(lastState()?.asks).toEqual({ waiting: 10, open: true })
  })

  it("is null for a game that is not a lecture room", () => {
    mount()
    attach("g-1", null)

    expect(lastState()?.gameId).toBe("g-1")
    expect(lastState()?.asks).toBeNull()
  })

  it("is null again once the page is no longer attached", () => {
    mount()
    attach()
    setLecture(lectureState({ asks: { waiting: 2, open: true } }))
    fire("connect")

    expect(lastState()?.asks).toBeNull()
  })
})

describe("askBox (7.3)", () => {
  it("closes the box at once when attached, and posts no reply", () => {
    mount()
    attach()
    sendCommand({ type: "askBox", open: false })

    expect(askBoxSent()).toEqual([{ gameId: "g-1", open: false }])
    expect(replies()).toEqual([])
  })

  it("holds a closed box until a room comes, and closes it there", () => {
    mount()
    sendCommand({ type: "askBox", open: false })
    expect(askBoxSent()).toEqual([])

    fire(EVENTS.MANAGER.GAME_CREATED, {
      gameId: "g-new",
      inviteCode: "654321",
      visuals: {},
      lecture: lectureState(),
    })

    expect(askBoxSent()).toEqual([{ gameId: "g-new", open: false }])
    expect(replies()).toEqual([])
  })

  it("closes it again each time the page becomes a room's manager: a reattach, a resumed room, a Restart quiz", () => {
    mount()
    attach()
    sendCommand({ type: "askBox", open: false })

    // A reattach after a drop.
    attach("g-1")
    // Restart quiz: the deck closes this room and a new one is made.
    sendCommand({ type: "ensureGame", quiz: "checkin", restart: "always" })
    fire(EVENTS.MANAGER.GAME_CREATED, {
      gameId: "g-2",
      inviteCode: "222222",
      visuals: {},
      lecture: lectureState(),
    })
    // A room resumed after the frame lost it.
    attach("g-3")

    expect(askBoxSent()).toEqual([
      { gameId: "g-1", open: false },
      { gameId: "g-1", open: false },
      { gameId: "g-2", open: false },
      { gameId: "g-3", open: false },
    ])
  })

  it("keeps the hold across close and the next room", () => {
    mount()
    sendCommand({ type: "askBox", open: false })
    sendCommand({ type: "close", quiz: "checkin" })
    fire(EVENTS.MANAGER.GAME_CREATED, {
      gameId: "g-after-close",
      inviteCode: "333333",
      visuals: {},
      lecture: lectureState(),
    })

    expect(askBoxSent()).toEqual([{ gameId: "g-after-close", open: false }])
  })

  it("does not set the box of a game that is not a lecture room", () => {
    mount()
    sendCommand({ type: "askBox", open: false })
    attach("g-plain", null)

    expect(askBoxSent()).toEqual([])
  })

  it("opens it once with open: true, and drops the hold so a reattach never undoes the inbox's pause", () => {
    mount()
    attach()
    sendCommand({ type: "askBox", open: false })
    sendCommand({ type: "askBox", open: true })

    expect(askBoxSent()).toEqual([
      { gameId: "g-1", open: false },
      { gameId: "g-1", open: true },
    ])

    attach("g-1")
    fire(EVENTS.MANAGER.GAME_CREATED, {
      gameId: "g-2",
      inviteCode: "222222",
      visuals: {},
      lecture: lectureState(),
    })

    expect(askBoxSent()).toHaveLength(2)
    expect(replies()).toEqual([])
  })

  it("sends nothing for open: true before a room, and holds nothing", () => {
    mount()
    sendCommand({ type: "askBox", open: true })
    attach()

    expect(askBoxSent()).toEqual([])
  })

  it("drops a malformed askBox without a reply", () => {
    mount()
    attach()
    sendCommand({ type: "askBox" })
    sendCommand({ type: "askBox", open: "no" })
    sendCommand({ type: "askBox", open: null })

    expect(askBoxSent()).toEqual([])
    expect(replies()).toEqual([])
  })
})

describe("what the deck is told (7.2, A1)", () => {
  it("carries no question, name or record id in any message, across arrivals, marks, a pause and a Restart quiz", () => {
    const roster: PublicPlayer[] = [
      { id: "s1", username: NAME, points: 0, streak: 0, connected: true },
    ]
    mount()
    attach()
    act(() => {
      useManagerStore
        .getState()
        .applyPresence({ gameId: "g-1", players: roster })
    })
    sendCommand({ type: "askBox", open: false })
    sendCommand({ type: "askBox", open: true })

    // Questions arrive, one is marked, the box is paused and resumed.
    setLecture(leaky({ waiting: 1, open: true }))
    setLecture(leaky({ waiting: 2, open: true }))
    setLecture(leaky({ waiting: 1, open: true }))
    setLecture(leaky({ waiting: 1, open: false }))
    setLecture(leaky({ waiting: 1, open: true }))

    // Restart quiz: a new room, which starts fresh.
    sendCommand({ type: "ensureGame", quiz: "checkin", restart: "always" })
    fire(EVENTS.MANAGER.GAME_CREATED, {
      gameId: "g-2",
      inviteCode: "222222",
      visuals: {},
      lecture: lectureState(),
    })
    attach("g-2", leaky({ waiting: 0, open: true }))
    sendCommand({ type: "hello" })

    const asks = postedStates().map((state) => state.asks)
    const everything = JSON.stringify(postMessage.mock.calls)

    expect(asks).toContainEqual({ waiting: 2, open: true })
    expect(asks).toContainEqual({ waiting: 1, open: false })
    expect(everything).not.toContain("quaternion")
    expect(everything).not.toContain(NAME)
    expect(everything).not.toContain(RECORD_ID)
    expect(everything).not.toContain("lastAsk")
    expect(everything).not.toContain("questions")

    expect(new Set(askKeys())).toEqual(new Set(["open,waiting"]))
  })
})

// ADR 0007: the presenter's drawer asks for the attached room's waiting
// questions; nothing is sent until it asks, and only that room ever is.
describe("the presenter's drawer (inbox, ADR 0007)", () => {
  const ask = (id: string, state: "new" | "seen", name?: string) => ({
    id,
    text: `${TEXT} ${id}`,
    at: "2026-11-17T10:00:00.000Z",
    state,
    ...(name ? { name } : {}),
  })
  const room = (gameId: string, open = true) => ({
    gameId,
    inviteCode: "123456",
    gameSubject: "Talk",
    open,
    waiting: 2,
    saved: true,
    record: {
      id: RECORD_ID,
      gameSubject: "Talk",
      date: "2026-11-17T10:00:00.000Z",
      asks: [ask("a1", "new", NAME), ask("a2", "seen"), ask("a3", "new")],
    },
  })
  const inboxes = () => posted().filter((message) => message.type === "inbox")
  const emitted = (event: string) =>
    mocks.socket.emit.mock.calls.filter(([name]) => name === event)
  const ready = () => {
    mount()
    fire(EVENTS.MANAGER.CONFIG, config)
    attach()
  }

  it("lists presenterInbox in features", () => {
    mount()

    expect(lastState()?.features).toContain("presenterInbox")
  })

  it("watches only once the deck asks, and sends only this room's new questions", () => {
    ready()
    fire(EVENTS.ASKS.LIVE, { rooms: [room("g-1")], records: [] })
    expect(inboxes()).toEqual([])
    expect(emitted(EVENTS.ASKS.WATCH)).toEqual([])

    sendCommand({ type: "inbox", open: true })
    expect(emitted(EVENTS.ASKS.WATCH).length).toBeGreaterThan(0)
    fire(EVENTS.ASKS.LIVE, { rooms: [room("g-2"), room("g-1")], records: [] })

    const last = inboxes().at(-1)
    expect(last?.type === "inbox" ? last.room : undefined).toEqual({
      gameId: "g-1",
      open: true,
      total: 2,
      asks: [
        {
          id: "a1",
          text: `${TEXT} a1`,
          at: "2026-11-17T10:00:00.000Z",
          name: NAME,
        },
        { id: "a3", text: `${TEXT} a3`, at: "2026-11-17T10:00:00.000Z" },
      ],
    })

    const before = inboxes().length
    fire(EVENTS.ASKS.ROOM, room("g-2"))
    expect(inboxes().length).toBe(before)
  })

  it("marks one or all as seen in this room's record, and pauses only this room", () => {
    ready()
    sendCommand({ type: "inbox", open: true })
    fire(EVENTS.ASKS.LIVE, { rooms: [room("g-1")], records: [] })

    sendCommand({ type: "markAsk", askId: "a1" })
    sendCommand({ type: "markAllAsks" })
    sendCommand({ type: "askOpen", open: false })

    expect(emitted(EVENTS.ASKS.MARK)[0]?.[1]).toEqual({
      recordId: RECORD_ID,
      askId: "a1",
      state: "seen",
    })
    expect(emitted(EVENTS.ASKS.MARK_ALL)[0]?.[1]).toEqual({
      recordId: RECORD_ID,
    })
    expect(emitted(EVENTS.ASKS.SET_OPEN)[0]?.[1]).toEqual({
      gameId: "g-1",
      open: false,
    })
    expect(askBoxSent()).toEqual([])
  })

  it("stops sending questions once the deck closes the drawer", () => {
    ready()
    sendCommand({ type: "inbox", open: true })
    sendCommand({ type: "inbox", open: false })
    const before = inboxes().length
    fire(EVENTS.ASKS.LIVE, { rooms: [room("g-1")], records: [] })

    expect(inboxes().length).toBe(before)
    expect(emitted(EVENTS.ASKS.UNWATCH).length).toBeGreaterThan(0)
  })
})
