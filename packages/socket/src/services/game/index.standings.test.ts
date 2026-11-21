import { EVENTS, LECTURE_TEXT } from "@razzia/common/constants"
import type { GameResult, Quizz } from "@razzia/common/types/game"
import type { Server, Socket } from "@razzia/common/types/game/socket"
import { STATUS } from "@razzia/common/types/game/status"
import type { PollWithId } from "@razzia/common/types/poll"
import Game from "@razzia/socket/services/game"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// After a lecture's podium a phone shows its final place only while the deck
// shows its standings (`showStandings`, from the deck's visibility): once the
// deck moves on, or a poll starts, the phones go to the quiz-over wait, so a
// poll after the podium or a reconnect never falls back to the result card.

const mocks = vi.hoisted(() => ({
  saveResult: vi.fn<(_result: GameResult) => void>(),
  getPollById: vi.fn<(_id: string) => PollWithId>(),
}))

vi.mock("@razzia/socket/services/config", () => ({
  saveResult: mocks.saveResult,
}))

vi.mock("@razzia/socket/services/poll-store", () => ({
  getPollById: mocks.getPollById,
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

const createClient = (id: string, clientId: string) => {
  const emitted: Array<Omit<Emitted, "target">> = []
  const socket = {
    id,
    handshake: { auth: { clientId } },
    join: vi.fn(),
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ event, payload })
    }),
    to: vi.fn(() => ({ emit: vi.fn() })),
  } as unknown as Socket

  return { socket, emitted }
}

const quizz: Quizz = {
  subject: "Why the Moon changes shape",
  questions: [0, 1].map(() => ({
    question: "Pick one",
    answers: ["No", "Yes"],
    solutions: [1],
    cooldown: 1,
    time: 5,
  })),
}

const definition = {
  id: "first-page-flaw",
  question: "What is wrong with this full Moon?",
  options: ["Nothing", "It sits in Earth's shadow"],
  live: true,
}

const createGame = (lecture = true) => {
  const { io, emitted } = createIo()
  const manager = createClient("manager", "manager-client")
  const game = new Game({
    io,
    socket: manager.socket,
    quizz,
    visuals: {},
    lecture,
    onPollSettled: () => true,
  })
  const alice = createClient("alice-sock", "alice-client")
  const bob = createClient("bob-sock", "bob-client")

  game.join(alice.socket, "Alice")
  game.join(bob.socket, "Bobby")

  return { game, emitted, manager, alice, bob }
}

type Setup = ReturnType<typeof createGame>

interface StatusSeen {
  name: string
  data: { text?: string; rank?: number; points?: number }
}

// The last screen the server put this phone on.
const lastStatus = (setup: Setup, target: string) =>
  setup.emitted
    .filter((e) => e.target === target && e.event === EVENTS.GAME.STATUS)
    .map((e) => e.payload as StatusSeen)
    .at(-1)

const toPodium = async (setup: Setup) => {
  expect(setup.game.playQuestion(setup.manager.socket, 0)).toBe("accepted")
  await vi.advanceTimersByTimeAsync(60_000)
  expect(setup.game.playQuestion(setup.manager.socket, 1)).toBe("accepted")
  await vi.advanceTimersByTimeAsync(60_000)

  expect(setup.game.finish(setup.manager.socket)).toBe("accepted")
  await vi.advanceTimersByTimeAsync(60_000)
}

const reconnect = (setup: Setup, clientId: string, socketId: string) => {
  const back = createClient(socketId, clientId)

  setup.game.reconnectPlayer(back.socket)

  const payload = back.emitted.find(
    ({ event }) => event === EVENTS.PLAYER.SUCCESS_RECONNECT,
  )?.payload as { status: StatusSeen } | undefined

  return payload?.status
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("a lecture's phones after the podium", () => {
  it("show their final place on the podium, the quiz-over wait once the deck moves on, and their place again on return", async () => {
    const setup = createGame()

    await toPodium(setup)
    expect(lastStatus(setup, "alice-sock")?.name).toBe(STATUS.FINISHED)

    setup.game.showStandings(setup.manager.socket, false)
    expect(lastStatus(setup, "alice-sock")).toEqual({
      name: STATUS.WAIT,
      data: { text: LECTURE_TEXT.QUIZ_OVER },
    })
    expect(lastStatus(setup, "bob-sock")?.name).toBe(STATUS.WAIT)

    setup.game.showStandings(setup.manager.socket, true)
    expect(lastStatus(setup, "alice-sock")?.name).toBe(STATUS.FINISHED)
    expect(lastStatus(setup, "alice-sock")?.data.rank).toBeDefined()
  })

  it("go to the wait when a poll starts after the podium, and stay there after it closes", async () => {
    const setup = createGame()

    await toPodium(setup)
    expect(setup.game.startInlinePoll(setup.manager.socket, definition)).toBe(
      "accepted",
    )
    expect(lastStatus(setup, "alice-sock")?.name).toBe(STATUS.WAIT)

    // The deck shows the poll: its standings are not up, and nothing changes
    setup.game.showStandings(setup.manager.socket, true)
    expect(lastStatus(setup, "alice-sock")?.name).toBe(STATUS.WAIT)

    setup.game.closePoll(setup.manager.socket, "first-page-flaw")
    setup.game.dismissPoll(setup.manager.socket, "first-page-flaw")
    expect(lastStatus(setup, "alice-sock")?.name).toBe(STATUS.WAIT)
  })

  it("land on the wait when they reconnect after the deck moved on", async () => {
    const setup = createGame()

    await toPodium(setup)
    setup.game.showStandings(setup.manager.socket, false)

    expect(reconnect(setup, "bob-client", "bob-back")?.name).toBe(STATUS.WAIT)

    // And on their place again once the standings are back
    setup.game.showStandings(setup.manager.socket, true)
    expect(lastStatus(setup, "bob-back")?.name).toBe(STATUS.FINISHED)
  })

  it("is the host's call, and only for a finished lecture room", async () => {
    const setup = createGame()

    // Before the podium nothing changes
    setup.game.showStandings(setup.manager.socket, false)
    expect(lastStatus(setup, "alice-sock")).toBeUndefined()

    await toPodium(setup)
    setup.game.showStandings(setup.alice.socket, false)
    expect(lastStatus(setup, "alice-sock")?.name).toBe(STATUS.FINISHED)
  })

  it("leaves a room the host runs by hand alone", () => {
    const setup = createGame(false)

    setup.game.showStandings(setup.manager.socket, false)
    expect(lastStatus(setup, "alice-sock")).toBeUndefined()
  })
})
