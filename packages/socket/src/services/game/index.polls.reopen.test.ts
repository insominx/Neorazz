import { EVENTS } from "@razzia/common/constants"
import type { GameResult, LectureState, Quizz } from "@razzia/common/types/game"
import type { Server, Socket } from "@razzia/common/types/game/socket"
import type { PollResultRecord } from "@razzia/common/types/poll"
import Game from "@razzia/socket/services/game"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A deck's poll closed by mistake (the presenter stepped off its slide) opens
// again with the votes it had (`reopenPoll`, feature `pollReopen`): in place
// while its result is on the stage, or back onto the stage once it has left.
// Its next close replaces the result the first one saved.

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
  subject: "Lecture",
  questions: [0, 1].map(() => ({
    question: "Pick one",
    answers: ["No", "Yes"],
    solutions: [1],
    cooldown: 1,
    time: 5,
  })),
}

const poll = (id: string, extra: object = {}) => ({
  id,
  question: `Question ${id}?`,
  options: ["Yes", "No", "Maybe"],
  live: true,
  ...extra,
})

const createGame = () => {
  const { io, emitted } = createIo()
  const manager = createClient("manager", "manager-client")
  const records: PollResultRecord[] = []
  const game = new Game({
    io,
    socket: manager.socket,
    quizz,
    visuals: {},
    lecture: true,
    onPollSettled: (record) => {
      records.push(record)

      return true
    },
  })
  const alice = createClient("alice-sock", "alice-client")
  const bob = createClient("bob-sock", "bob-client")

  game.join(alice.socket, "Alice")
  game.join(bob.socket, "Bob")
  emitted.length = 0

  return { game, emitted, manager, alice, bob, records }
}

type Setup = ReturnType<typeof createGame>

interface StateSeen {
  pollId: string
  phase: string
  counts?: number[]
  total?: number
  mine?: number | null
}

const lastPollState = (setup: Setup, target: string) =>
  setup.emitted
    .filter((e) => e.target === target && e.event === EVENTS.POLL.STATE)
    .map((e) => e.payload as StateSeen | null)
    .at(-1)

// What the host was last told had closed here.
const pollsDone = (setup: Setup) => {
  const state = setup.emitted
    .filter((e) => e.event === EVENTS.MANAGER.LECTURE_STATE)
    .map((e) => e.payload as LectureState)
    .at(-1)

  return (state?.pollsDone ?? []).map((done) => done.id)
}

// Alice votes Yes, Bob votes Maybe, and the poll closes.
const closedWithTwoVotes = (setup: Setup, id = "agents") => {
  setup.game.startInlinePoll(setup.manager.socket, poll(id))
  setup.game.votePoll(setup.alice.socket, id, 0)
  setup.game.votePoll(setup.bob.socket, id, 2)
  setup.game.closePoll(setup.manager.socket, id)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("reopening a deck poll while its result is on the stage", () => {
  it("opens it again with its votes, for the host and each phone", () => {
    const setup = createGame()

    closedWithTwoVotes(setup)

    expect(setup.game.reopenInlinePoll(setup.manager.socket, "agents")).toBe(
      "accepted",
    )
    expect(lastPollState(setup, "manager")).toMatchObject({
      pollId: "agents",
      phase: "open",
      counts: [1, 0, 1],
      total: 2,
    })
    expect(lastPollState(setup, "alice-sock")).toMatchObject({
      phase: "open",
      mine: 0,
    })
    expect(lastPollState(setup, "bob-sock")).toMatchObject({ mine: 2 })
  })

  it("takes new votes and changes, then closes over the same saved result", () => {
    const setup = createGame()

    closedWithTwoVotes(setup)
    setup.game.reopenInlinePoll(setup.manager.socket, "agents")

    expect(setup.game.votePoll(setup.bob.socket, "agents", 1)).toBe("accepted")
    setup.game.closePoll(setup.manager.socket, "agents")

    expect(setup.records).toHaveLength(2)
    expect(setup.records[1].id).toBe(setup.records[0].id)
    expect(setup.records[1].counts).toEqual([1, 1, 0])
  })

  it("counts as not run until it closes again", () => {
    const setup = createGame()

    closedWithTwoVotes(setup)
    expect(pollsDone(setup)).toEqual(["agents"])

    setup.game.reopenInlinePoll(setup.manager.socket, "agents")
    expect(pollsDone(setup)).toEqual([])

    setup.game.closePoll(setup.manager.socket, "agents")
    expect(pollsDone(setup)).toEqual(["agents"])
  })
})

describe("reopening a deck poll that has left the stage", () => {
  it("brings it back from the room at rest with its votes", () => {
    const setup = createGame()

    closedWithTwoVotes(setup)
    setup.game.dismissPoll(setup.manager.socket, "agents")

    expect(setup.game.reopenInlinePoll(setup.manager.socket, "agents")).toBe(
      "accepted",
    )
    expect(lastPollState(setup, "manager")).toMatchObject({
      phase: "open",
      counts: [1, 0, 1],
    })
  })

  it("takes the stage from another poll's result, which can then come back too", () => {
    const setup = createGame()

    closedWithTwoVotes(setup)
    setup.game.startInlinePoll(setup.manager.socket, poll("grades"))
    setup.game.votePoll(setup.alice.socket, "grades", 1)
    setup.game.closePoll(setup.manager.socket, "grades")

    expect(setup.game.reopenInlinePoll(setup.manager.socket, "agents")).toBe(
      "accepted",
    )
    expect(lastPollState(setup, "manager")).toMatchObject({
      pollId: "agents",
      counts: [1, 0, 1],
    })

    setup.game.closePoll(setup.manager.socket, "agents")
    expect(setup.game.reopenInlinePoll(setup.manager.socket, "grades")).toBe(
      "accepted",
    )
    expect(lastPollState(setup, "manager")).toMatchObject({
      pollId: "grades",
      counts: [0, 1, 0],
    })
  })

  it("drops the vote of a player who has left the room since", () => {
    const setup = createGame()

    closedWithTwoVotes(setup)
    setup.game.dismissPoll(setup.manager.socket, "agents")
    setup.game.kickPlayer(setup.manager.socket, "bob-sock")
    setup.game.reopenInlinePoll(setup.manager.socket, "agents")

    expect(lastPollState(setup, "manager")).toMatchObject({
      counts: [1, 0, 0],
      total: 1,
    })
  })
})

describe("what reopen refuses", () => {
  it("a poll that never closed here", () => {
    const setup = createGame()

    expect(setup.game.reopenInlinePoll(setup.manager.socket, "agents")).toBe(
      "notFound",
    )
  })

  it("while another poll is open", () => {
    const setup = createGame()

    closedWithTwoVotes(setup)
    setup.game.startInlinePoll(setup.manager.socket, poll("grades"))

    expect(setup.game.reopenInlinePoll(setup.manager.socket, "agents")).toBe(
      "busy",
    )
  })

  it("anyone but the room's host", () => {
    const setup = createGame()

    closedWithTwoVotes(setup)

    expect(setup.game.reopenInlinePoll(setup.alice.socket, "agents")).toBe(
      "notManager",
    )
  })
})
