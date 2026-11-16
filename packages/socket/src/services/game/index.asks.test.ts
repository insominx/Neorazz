import { EVENTS } from "@razzia/common/constants"
import type { AskRecord } from "@razzia/common/types/ask"
import type { GameResult, LectureState, Quizz } from "@razzia/common/types/game"
import type { Server, Socket } from "@razzia/common/types/game/socket"
import { ASK_LIMITS } from "@razzia/common/validators/ask"
import Game from "@razzia/socket/services/game"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A lecture room's questions for the presenter, as the room handles them: who
// may send, what the host page and the phones are told, and that no question
// or name reaches anyone but the inbox.

const mocks = vi.hoisted(() => ({
  saveResult: vi.fn<(_result: GameResult) => void>(),
}))

vi.mock("@razzia/socket/services/config", () => ({
  saveResult: mocks.saveResult,
}))

vi.mock("@razzia/socket/services/poll-store", () => ({
  getPollById: vi.fn(),
}))

interface Emitted {
  target: string
  event: string
  payload: unknown
}

const createIo = () => {
  const emitted: Emitted[] = []
  const io = {
    to: vi.fn((target: string) => ({
      emit: (event: string, payload: unknown) => {
        emitted.push({ target, event, payload })
      },
    })),
    in: vi.fn(() => ({ socketsLeave: vi.fn() })),
  } as unknown as Server

  return { io, emitted }
}

const createClient = (id: string, clientId: string, sink: Emitted[]) => {
  const socket = {
    id,
    handshake: { auth: { clientId } },
    join: vi.fn(),
    emit: vi.fn((event: string, payload: unknown) => {
      sink.push({ target: `socket:${id}`, event, payload })
    }),
    to: vi.fn(() => ({ emit: vi.fn() })),
  } as unknown as Socket

  return socket
}

const quizz: Quizz = {
  subject: "Check-in",
  questions: [0, 1].map(() => ({
    question: "Pick one",
    answers: ["No", "Yes"],
    solutions: [1],
    cooldown: 1,
    time: 5,
  })),
}

// Distinctive words, so a search of every payload finds them only if they
// leaked.
const TEXT = "Why does the quaternion flip?"
const SIGNED_TEXT = "Is the zebra test on Friday?"
const NAME = "Zelda"

let nonceCount = 0
const nonce = () => {
  nonceCount += 1

  return `nonce-${String(nonceCount).padStart(4, "0")}`
}

const send = (text: string, extra: object = {}) => ({
  text,
  signed: false,
  nonce: nonce(),
  ...extra,
})

const createGame = ({
  lecture = true,
  saves = () => true,
}: { lecture?: boolean; saves?: (_record: AskRecord) => boolean } = {}) => {
  const { io, emitted } = createIo()
  const save = vi.fn(saves)
  const manager = createClient("manager", "manager-client", emitted)
  const game = new Game({
    io,
    socket: manager,
    quizz,
    visuals: {},
    lecture,
    onPollSettled: () => true,
    saveAsks: save,
  })
  const zelda = createClient("zelda-sock", "zelda-client", emitted)
  const bob = createClient("bob-sock", "bob-client", emitted)

  game.join(zelda, NAME)
  game.join(bob, "Bobby")

  return { game, emitted, save, manager, zelda, bob }
}

type Setup = ReturnType<typeof createGame>

const lectureStates = (setup: Setup) =>
  setup.emitted
    .filter(
      ({ target, event }) =>
        target === "manager" && event === EVENTS.MANAGER.LECTURE_STATE,
    )
    .map(({ payload }) => payload as LectureState)

const boxesTo = (setup: Setup, target: string) =>
  setup.emitted
    .filter(
      ({ target: to, event }) => to === target && event === EVENTS.ASK.BOX,
    )
    .map(({ payload }) => payload)

const reconnectManager = (setup: Setup) => {
  const sink: Emitted[] = []
  const back = createClient("manager-back", "manager-client", sink)

  setup.game.reconnectManager(back)

  return sink.find(({ event }) => event === EVENTS.MANAGER.SUCCESS_RECONNECT)
    ?.payload as { lecture?: LectureState }
}

// Every console level, silenced and recorded.
const spyOnConsole = () =>
  (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  )

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse("2026-11-17T18:04:31.250Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Game asks: who may send", () => {
  it("takes a question from a player of a lecture room", () => {
    const setup = createGame()

    expect(setup.game.sendAsk(setup.zelda, send(TEXT))).toBe("accepted")
    expect(setup.save).toHaveBeenCalledTimes(1)
  })

  it("answers notLecture in a normal game, and keeps nothing", () => {
    const setup = createGame({ lecture: false })

    expect(setup.game.sendAsk(setup.zelda, send(TEXT))).toBe("notLecture")
    expect(setup.save).not.toHaveBeenCalled()
  })

  it("answers notPlayer to the host, a stranger and a kicked player", () => {
    const setup = createGame()
    const stranger = createClient("stranger", "stranger-client", [])

    expect(setup.game.sendAsk(setup.manager, send(TEXT))).toBe("notPlayer")
    expect(setup.game.sendAsk(stranger, send(TEXT))).toBe("notPlayer")

    setup.game.kickPlayer(setup.manager, "bob-sock")

    expect(setup.game.sendAsk(setup.bob, send(TEXT))).toBe("notPlayer")
    expect(setup.save).not.toHaveBeenCalled()
  })

  it("answers notPlayer to a player's old socket after it reconnected", () => {
    const setup = createGame()
    const back = createClient("zelda-back", "zelda-client", [])

    setup.game.reconnectPlayer(back)

    expect(setup.game.sendAsk(setup.zelda, send(TEXT))).toBe("notPlayer")
    expect(setup.game.sendAsk(back, send(TEXT))).toBe("accepted")
  })

  it("takes a question in any phase: the phone, not the server, hides the button", async () => {
    const setup = createGame()

    expect(setup.game.playQuestion(setup.manager, 0)).toBe("accepted")
    await vi.advanceTimersByTimeAsync(4_000)

    expect(setup.game.inLobby).toBe(false)
    expect(setup.game.sendAsk(setup.zelda, send(TEXT))).toBe("accepted")
  })
})

describe("Game asks: what the host page is told", () => {
  it("sends a fresh lecture room's state exactly as before", () => {
    const setup = createGame()
    const created = setup.emitted.find(
      ({ event }) => event === EVENTS.MANAGER.GAME_CREATED,
    )?.payload as { lecture: LectureState }

    expect(created.lecture).not.toHaveProperty("asks")
    expect(reconnectManager(setup).lecture).not.toHaveProperty("asks")
  })

  it("pushes the count when a question arrives, and carries it on a reconnect", () => {
    const setup = createGame()

    setup.game.sendAsk(setup.zelda, send(TEXT))

    expect(lectureStates(setup).at(-1)?.asks).toEqual({
      waiting: 1,
      open: true,
    })
    expect(reconnectManager(setup).lecture?.asks).toEqual({
      waiting: 1,
      open: true,
    })
  })

  it("tells a normal game's host nothing about asks", () => {
    const setup = createGame({ lecture: false })

    setup.game.sendAsk(setup.zelda, send(TEXT))

    expect(lectureStates(setup)).toEqual([])
  })

  it("pushes nothing for a change the host cannot see", () => {
    const setup = createGame()
    const draft = send(TEXT)

    setup.game.sendAsk(setup.zelda, draft)
    const pushed = lectureStates(setup).length

    // A repeated send, and a refused one.
    expect(setup.game.sendAsk(setup.zelda, draft)).toBe("accepted")
    expect(setup.game.sendAsk(setup.zelda, send(TEXT))).toBe("tooFast")

    expect(lectureStates(setup)).toHaveLength(pushed)
  })

  it("caps the host's count at 10", () => {
    const setup = createGame()

    for (let index = 0; index < 12; index += 1) {
      const seat = createClient(`s${index}`, `seat-${index}`, [])

      setup.game.join(seat, `Seat ${index}`)
      setup.game.sendAsk(seat, send(TEXT))
    }

    expect(lectureStates(setup).at(-1)?.asks).toEqual({
      waiting: ASK_LIMITS.WAITING_CAP,
      open: true,
    })
  })
})

describe("Game asks: the box", () => {
  it("tells a player whether it can send, and anyone else null", () => {
    const setup = createGame()
    const stranger = createClient("stranger", "stranger-client", setup.emitted)

    setup.game.syncAsks(setup.zelda)
    setup.game.syncAsks(setup.manager)
    setup.game.syncAsks(stranger)

    expect(boxesTo(setup, "socket:zelda-sock")).toEqual([{ open: true }])
    expect(boxesTo(setup, "socket:manager")).toEqual([null])
    expect(boxesTo(setup, "socket:stranger")).toEqual([null])
  })

  it("tells a normal game's player null", () => {
    const setup = createGame({ lecture: false })

    setup.game.syncAsks(setup.zelda)

    expect(boxesTo(setup, "socket:zelda-sock")).toEqual([null])
  })

  it("lets only the game's manager set the box", () => {
    const setup = createGame()
    // The same login in another tab, not attached to the game.
    const otherTab = createClient("manager-tab", "manager-client", [])

    expect(setup.game.setAskBox(setup.zelda, false)).toBe("notManager")
    expect(setup.game.setAskBox(otherTab, false)).toBe("notManager")
    expect(setup.game.setAskBox(setup.manager, "no")).toBe("invalid")
    expect(boxesTo(setup, setup.game.gameId)).toEqual([])

    expect(setup.game.setAskBox(setup.manager, false)).toBe("accepted")
  })

  it("answers notLecture in a normal game", () => {
    const setup = createGame({ lecture: false })

    expect(setup.game.setAskBox(setup.manager, false)).toBe("notLecture")
  })

  it("tells the room when the box opens or closes, and only then", () => {
    const setup = createGame()

    setup.game.setAskBox(setup.manager, true)
    setup.game.setAskBox(setup.manager, false)
    setup.game.setAskBox(setup.manager, false)
    setup.game.setAskBox(setup.manager, true)

    expect(boxesTo(setup, setup.game.gameId)).toEqual([
      { open: false },
      { open: true },
    ])
    expect(lectureStates(setup).map(({ asks }) => asks)).toEqual([
      { waiting: 0, open: false },
      { waiting: 0, open: true },
    ])
  })

  it("refuses questions while it is closed, and a synced phone hears so", () => {
    const setup = createGame()

    setup.game.setAskBox(setup.manager, false)
    setup.game.syncAsks(setup.zelda)

    expect(setup.game.sendAsk(setup.zelda, send(TEXT))).toBe("closed")
    expect(boxesTo(setup, "socket:zelda-sock")).toEqual([{ open: false }])
  })

  it("does not tell a phone that was away, which learns it by asking", () => {
    const setup = createGame()

    setup.game.setPlayerDisconnected("zelda-sock")
    setup.game.setAskBox(setup.manager, false)

    const back = createClient("zelda-back", "zelda-client", setup.emitted)

    setup.game.reconnectPlayer(back)
    setup.game.syncAsks(back)

    expect(boxesTo(setup, "socket:zelda-back")).toEqual([{ open: false }])
  })
})

describe("Game asks: keeping them", () => {
  it("offers a record that was not kept again when the room closes", () => {
    const results = [false, true]
    const setup = createGame({ saves: () => results.shift() ?? true })

    setup.game.sendAsk(setup.zelda, send(TEXT))
    setup.game.close("errors:game.managerDisconnected")

    expect(setup.save).toHaveBeenCalledTimes(2)
    expect(setup.save.mock.calls[1][0].asks[0].text).toBe(TEXT)
  })

  it("offers it again when the server shuts down", () => {
    const results = [false, true]
    const setup = createGame({ saves: () => results.shift() ?? true })

    setup.game.sendAsk(setup.zelda, send(TEXT))
    setup.game.settleAsks()

    expect(setup.save).toHaveBeenCalledTimes(2)
  })

  it("writes nothing more at the close when the record is already kept", () => {
    const setup = createGame()

    setup.game.sendAsk(setup.zelda, send(TEXT))
    setup.game.close("errors:game.managerDisconnected")
    setup.game.settleAsks()

    expect(setup.save).toHaveBeenCalledTimes(1)
  })
})

describe("Game asks: privacy (A1, A3, A4, A5)", () => {
  // Every kind of send and change the room handles, from a room that already
  // has its players.
  const runEverything = (setup: Setup) => {
    const { game, zelda, bob, manager } = setup
    const repeat = send(TEXT)

    game.sendAsk(zelda, repeat)
    // A repeat after a lost reply, a refusal and a malformed send.
    game.sendAsk(zelda, repeat)
    game.sendAsk(zelda, send(TEXT))
    game.sendAsk(zelda, { text: 42, signed: true, nonce: nonce() })
    vi.advanceTimersByTime(ASK_LIMITS.SPACING_MS)
    // A signed one, with a name in the payload that must not be used.
    game.sendAsk(zelda, send(SIGNED_TEXT, { signed: true, name: "Mallory" }))
    game.sendAsk(bob, send(`${TEXT} again`))
    game.setAskBox(manager, false)
    game.sendAsk(bob, send(TEXT))
    game.setAskBox(manager, true)
    game.syncAsks(zelda)
    game.syncAsks(bob)
  }

  const leaks = (value: unknown) => {
    const json = JSON.stringify(value)

    return [
      "quaternion",
      "zebra",
      NAME,
      "Mallory",
      "zelda-client",
      "zelda-sock",
      "bob-client",
      "bob-sock",
    ].filter((word) => json.includes(word))
  }

  it("sends no question, name, client id or socket id to the room, the host or a phone", () => {
    const setup = createGame()

    setup.emitted.length = 0
    runEverything(setup)

    expect(setup.emitted.length).toBeGreaterThan(0)
    expect(
      leaks(setup.emitted.map(({ event, payload }) => [event, payload])),
    ).toEqual([])
  })

  it("keeps the signed name from the server's record, and no author on the others", () => {
    const setup = createGame()

    runEverything(setup)

    const record = setup.save.mock.calls.at(-1)?.[0]
    const bytes = JSON.stringify(record)

    expect(record?.asks.map(({ name }) => name ?? null)).toEqual([
      null,
      NAME,
      null,
    ])
    expect(bytes).not.toContain("Mallory")
    expect(bytes).not.toContain("zelda-client")
    expect(bytes).not.toContain("zelda-sock")
    expect(bytes).not.toContain("bob-client")
    expect(bytes).not.toContain("bob-sock")
    expect(bytes).not.toContain("Bobby")
  })

  // The host page is the projector in a deck. Its reconnect payload has
  // always carried the lobby's roster (every player's name and seat), which
  // says nothing about who asked; what the lane adds is `lecture.asks`.
  it("puts no question or name in what reaches the projected page, once asks exist", () => {
    const setup = createGame()
    const created = setup.emitted.find(
      ({ event }) => event === EVENTS.MANAGER.GAME_CREATED,
    )?.payload as { lecture: LectureState }

    runEverything(setup)

    const reconnected = reconnectManager(setup)
    const lectures = [
      created.lecture,
      ...lectureStates(setup),
      reconnected.lecture,
    ]
    const questionWords = (value: unknown) =>
      leaks(value).filter((word) => word === "quaternion" || word === "zebra")

    expect(lectures.length).toBeGreaterThan(2)
    expect(reconnected.lecture?.asks).toEqual({ waiting: 3, open: true })
    expect(questionWords([created, setup.emitted, reconnected])).toEqual([])
    expect(leaks(lectures)).toEqual([])

    for (const lecture of lectures) {
      expect(Object.keys(lecture ?? {}).sort()).toEqual(
        expect.arrayContaining(["inviteCode", "total", "played"]),
      )

      if (lecture?.asks) {
        expect(Object.keys(lecture.asks).sort()).toEqual(["open", "waiting"])
      }
    }
  })

  it("logs nothing about an ask, accepted, refused or failed to write", () => {
    const setup = createGame({ saves: () => false })
    const spies = spyOnConsole()

    runEverything(setup)
    setup.game.settleAsks()

    const logged = spies.flatMap((spy) => spy.mock.calls)

    expect(leaks(logged)).toEqual([])
    spies.forEach((spy) => {
      spy.mockRestore()
    })
  })
})
