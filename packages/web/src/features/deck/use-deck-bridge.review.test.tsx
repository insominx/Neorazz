import { EVENTS } from "@razzia/common/constants"
import type { LectureState } from "@razzia/common/types/game"
import { STATUS } from "@razzia/common/types/game/status"
import type { ManagerConfig } from "@razzia/common/types/manager"
import type { BridgeMessage } from "@razzia/web/features/deck/protocol"
import { useDeckBridge } from "@razzia/web/features/deck/use-deck-bridge"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { usePollStore } from "@razzia/web/features/poll/stores/poll"
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const DECK = "http://localhost:8776"

type Handler = (..._args: never[]) => void
type Ack = (_error: Error | null, _outcome?: string) => void

const mocks = vi.hoisted(() => {
  const ackEmit = vi.fn()

  return {
    handlers: new Map<string, Handler>(),
    navigate: vi.fn(),
    setSuppressed: vi.fn(),
    router: { pathname: "/manager" },
    ackEmit,
    socket: { emit: vi.fn(), timeout: vi.fn(() => ({ emit: ackEmit })) },
  }
})

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
  // Read as a hook (the sound setting the deck is told) and through getState.
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

const fire = (event: string, ...args: unknown[]) => {
  act(() => {
    mocks.handlers.get(event)?.(...(args as never[]))
  })
}

const sendCommand = (
  body: Record<string, unknown>,
  { origin = DECK, source = window as Window | null } = {},
) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "cst426-deck", v: 1, ...body },
        origin,
        source,
      }),
    )
  })
}

// This page is the manager of a lecture game showing the lobby.
const attach = (lecture: LectureState | null = lectureState()) => {
  act(() => {
    useManagerStore.setState({
      gameId: "g-1",
      status: {
        name: STATUS.SHOW_ROOM,
        data: { inviteCode: "123456" },
      } as never,
      lecture,
      config,
    })
  })
  fire(EVENTS.MANAGER.SUCCESS_RECONNECT, {})
}

const postMessage = vi.fn<(_message: BridgeMessage, _origin: string) => void>()

const posted = () => postMessage.mock.calls.map(([message]) => message)

const results = () =>
  posted().flatMap((message) => (message.type === "result" ? [message] : []))

const lastState = () =>
  posted()
    .flatMap((message) =>
      message.type === "status" || message.type === "ready"
        ? [message.state]
        : [],
    )
    .at(-1)

// The ack of the command just sent, answered the way the server would.
const answer = (outcome: string | null, error: Error | null = null) => {
  const callback = mocks.ackEmit.mock.calls.at(-1)?.[2] as Ack

  act(() => {
    callback(error, outcome ?? undefined)
  })
}

const sentOf = (event: string) =>
  mocks.ackEmit.mock.calls.filter(([sent]) => sent === event)

describe("useDeckBridge showing a closed poll again, and naming its targets", () => {
  beforeEach(() => {
    mocks.handlers.clear()
    mocks.navigate.mockReset()
    mocks.setSuppressed.mockReset()
    mocks.socket.emit.mockReset()
    mocks.ackEmit.mockReset()
    mocks.router.pathname = "/manager"
    useManagerStore.getState().reset()
    usePollStore.getState().reset()
    postMessage.mockReset()
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => undefined,
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

  const closed = (id: string, counts: number[]) => ({
    id,
    question: `Question ${id}?`,
    options: ["Yes", "No"],
    anonymous: true,
    live: false,
    counts,
    total: counts.reduce((sum, count) => sum + count, 0),
  })

  it("shows a poll that closed in this room again, locally, and says so", () => {
    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach(lectureState({ pollsDone: [closed("one", [2, 1])] }))

    sendCommand({ type: "reviewPoll", id: "one" })

    expect(usePollStore.getState().review).toEqual(closed("one", [2, 1]))
    expect(lastState()).toMatchObject({ reviewingPoll: "one", poll: null })
    // Nothing goes to the room: the stage and the phones do not change.
    expect(mocks.ackEmit).not.toHaveBeenCalled()
    expect(mocks.socket.emit).not.toHaveBeenCalledWith(
      EVENTS.MANAGER.START_POLL,
      expect.anything(),
      expect.anything(),
    )

    sendCommand({ type: "reviewPoll", id: null })

    expect(usePollStore.getState().review).toBeNull()
    expect(lastState()).toMatchObject({ reviewingPoll: null })
  })

  it("reopens a closed poll by name, and lets it take the place of its result shown again", () => {
    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach(lectureState({ pollsDone: [closed("one", [2, 1])] }))
    sendCommand({ type: "reviewPoll", id: "one" })

    sendCommand({ type: "reopenPoll", pollId: "one" })
    expect(sentOf(EVENTS.MANAGER.REOPEN_POLL)).toEqual([
      [
        EVENTS.MANAGER.REOPEN_POLL,
        { gameId: "g-1", pollId: "one" },
        expect.any(Function),
      ],
    ])
    answer("busy")

    // Refused: the result stays on screen.
    expect(usePollStore.getState().review).toEqual(closed("one", [2, 1]))

    sendCommand({ type: "reopenPoll", pollId: "one" })
    answer("accepted")

    expect(usePollStore.getState().review).toBeNull()
    expect(
      postMessage.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === "result")
        .map((message) => [message.command, message.outcome]),
    ).toEqual(
      expect.arrayContaining([
        ["reopenPoll", "ignored"],
        ["reopenPoll", "accepted"],
      ]),
    )
  })

  it("tells a finished lecture room whether its standings show, from the deck's visibility, once per change", () => {
    const standings = () =>
      mocks.socket.emit.mock.calls.filter(
        ([event]) => event === EVENTS.MANAGER.SHOW_STANDINGS,
      )

    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach(lectureState({ finished: false }))
    sendCommand({ type: "visibility", visible: true })
    sendCommand({ type: "visibility", visible: false })

    // Before the podium nothing is sent
    expect(standings()).toEqual([])

    act(() => {
      useManagerStore.setState({ lecture: lectureState({ finished: true }) })
    })
    expect(standings()).toEqual([
      [EVENTS.MANAGER.SHOW_STANDINGS, { gameId: "g-1", shown: false }],
    ])

    sendCommand({ type: "visibility", visible: true })
    sendCommand({ type: "visibility", visible: true })
    sendCommand({ type: "visibility", visible: false })
    expect(standings().map((call) => call[1] as unknown)).toEqual([
      { gameId: "g-1", shown: false },
      { gameId: "g-1", shown: true },
      { gameId: "g-1", shown: false },
    ])
  })

  it("keeps finished phones on the wait when revisiting a closed poll or played question", () => {
    const standings = () =>
      mocks.socket.emit.mock.calls
        .filter(([event]) => event === EVENTS.MANAGER.SHOW_STANDINGS)
        .map(([, payload]) => payload as { gameId: string; shown: boolean })

    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach(lectureState({ finished: true, pollsDone: [closed("grades", [2, 1])] }))
    act(() => {
      useManagerStore.getState().setStatus(STATUS.SHOW_RESPONSES, {
        questionNumber: 2,
        question: "Q2",
        responses: { 0: 1 },
        solutions: [0],
        answers: ["a", "b"],
      })
      useManagerStore.getState().setStatus(STATUS.FINISHED, {
        subject: "Moon",
        top: [],
      })
    })
    mocks.socket.emit.mockClear()

    // Revisiting a closed poll makes the frame visible while pollReview is set:
    // standings are NOT showing, so phones must stay on the quiz-over wait.
    sendCommand({ type: "reviewPoll", id: "grades" })
    sendCommand({ type: "visibility", visible: true })
    expect(standings()).toEqual([])

    // Returning to the standings face clears the poll review and shows standings.
    sendCommand({ type: "reviewPoll", id: null })
    expect(standings()).toEqual([{ gameId: "g-1", shown: true }])

    // Jumping to a played question review hides standings again.
    sendCommand({ type: "review", question: 1 })
    expect(standings()).toEqual([
      { gameId: "g-1", shown: true },
      { gameId: "g-1", shown: false },
    ])

    // Ending the review while still visible brings standings back.
    sendCommand({ type: "review", question: null })
    expect(standings()).toEqual([
      { gameId: "g-1", shown: true },
      { gameId: "g-1", shown: false },
      { gameId: "g-1", shown: true },
    ])
  })

  it("shows nothing for a poll that did not close here, or before it is attached", () => {
    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    sendCommand({ type: "reviewPoll", id: "one" })

    expect(usePollStore.getState().review).toBeNull()

    attach(lectureState({ pollsDone: [closed("one", [2, 1])] }))
    sendCommand({ type: "reviewPoll", id: "two" })

    expect(usePollStore.getState().review).toBeNull()
    expect(lastState()).toMatchObject({ reviewingPoll: null })
  })

  it("drops a result shown again when the room changes", () => {
    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach(lectureState({ pollsDone: [closed("one", [2, 1])] }))
    sendCommand({ type: "reviewPoll", id: "one" })

    // Restart: the new room has run nothing.
    act(() => {
      useManagerStore.setState({ gameId: "g-2", lecture: lectureState() })
    })

    expect(usePollStore.getState().review).toBeNull()
    expect(lastState()).toMatchObject({ reviewingPoll: null })
  })

  // The poll lane holds the lobby's sound under a result shown again
  // (`pollStage`), so the deck's own silence is not needed for it.
  it("does not silence the page to show a result again", () => {
    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach(lectureState({ pollsDone: [closed("one", [2, 1])] }))
    sendCommand({ type: "visibility", visible: true })
    mocks.setSuppressed.mockReset()

    sendCommand({ type: "reviewPoll", id: "one" })

    expect(usePollStore.getState().review).toMatchObject({ id: "one" })
    expect(mocks.setSuppressed).not.toHaveBeenCalledWith(true)
  })

  it("passes the poll a close or dismiss names on to the room", () => {
    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach()

    sendCommand({ type: "closePoll", pollId: "path-pick", gameId: "g-1" })
    sendCommand({ type: "dismissPoll", pollId: "path-pick", gameId: "g-1" })

    expect(sentOf(EVENTS.MANAGER.CLOSE_POLL)).toEqual([
      [
        EVENTS.MANAGER.CLOSE_POLL,
        { gameId: "g-1", pollId: "path-pick" },
        expect.any(Function),
      ],
    ])
    expect(sentOf(EVENTS.MANAGER.DISMISS_POLL)).toEqual([
      [
        EVENTS.MANAGER.DISMISS_POLL,
        { gameId: "g-1", pollId: "path-pick" },
        expect.any(Function),
      ],
    ])
  })

  it("refuses a close or dismiss for a game it no longer hosts, sending nothing", () => {
    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach()

    sendCommand({ type: "closePoll", pollId: "path-pick", gameId: "g-old" })
    sendCommand({ type: "dismissPoll", gameId: "g-old" })

    expect(mocks.ackEmit).not.toHaveBeenCalled()
    expect(
      results().map(({ command, outcome, reason }) => [
        command,
        outcome,
        reason,
      ]),
    ).toEqual([
      ["closePoll", "ignored", "notCurrent"],
      ["dismissPoll", "ignored", "notCurrent"],
    ])
  })

  it("reports a refused named close as the room answered it", () => {
    renderHook(() => {
      useDeckBridge()
    })
    sendCommand({ type: "hello" })
    attach()

    sendCommand({ type: "closePoll", pollId: "path-pick", gameId: "g-1" })
    answer("notCurrent")

    expect(results().at(-1)).toMatchObject({
      command: "closePoll",
      outcome: "ignored",
      reason: "notCurrent",
    })
  })
})
