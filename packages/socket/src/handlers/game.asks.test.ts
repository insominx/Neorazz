import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EVENTS } from "@razzia/common/constants"
import type { Quizz } from "@razzia/common/types/game"
import type { Server, Socket } from "@razzia/common/types/game/socket"
import { gameSocketHandlers } from "@razzia/socket/handlers/game"
import Game from "@razzia/socket/services/game"
import Registry from "@razzia/socket/services/registry"
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

// The ask events as a client reaches them: the real handler, room and store,
// writing to a scratch config folder.

type Handler = (...args: unknown[]) => unknown

interface Emitted {
  target: string
  event: string
  payload: unknown
}

const emitted: Emitted[] = []

const io = {
  to: vi.fn((target: string) => ({
    emit: (event: string, payload: unknown) => {
      emitted.push({ target, event, payload })
    },
  })),
  in: vi.fn(() => ({ socketsLeave: vi.fn() })),
} as unknown as Server

const connect = (id: string, clientId: string) => {
  const handlers = new Map<string, Handler>()
  const socket = {
    id,
    handshake: { auth: { clientId } },
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ target: `socket:${id}`, event, payload })
    }),
    join: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler)

      return socket
    }),
  } as unknown as Socket

  gameSocketHandlers({ io, socket })

  return {
    socket,
    call: (event: string, ...args: unknown[]) => handlers.get(event)?.(...args),
  }
}

const quizz: Quizz = {
  subject: "Check-in",
  questions: [
    {
      question: "Pick one",
      answers: ["No", "Yes"],
      solutions: [1],
      cooldown: 1,
      time: 5,
    },
  ],
}

const TEXT = "Why does the quaternion flip?"
const SIGNED_TEXT = "Is the zebra test on Friday?"
const NAME = "Zelda"

const registry = Registry.getInstance()
let root = ""
let nonceCount = 0

const nonce = () => {
  nonceCount += 1

  return `nonce-${String(nonceCount).padStart(4, "0")}`
}

const room = ({ lecture = true }: { lecture?: boolean } = {}) => {
  const host = connect("host-sock", "host-client")
  const game = new Game({
    io,
    socket: host.socket,
    quizz,
    visuals: {},
    lecture,
    onPollSettled: () => true,
  })
  const zelda = connect("zelda-sock", "zelda-client")
  const bob = connect("bob-sock", "bob-client")

  registry.addGame(game)
  game.join(zelda.socket, NAME)
  game.join(bob.socket, "Bobby")
  emitted.length = 0

  return { game, host, zelda, bob }
}

// Sends `{ gameId, text, ... }` with a fresh nonce, unsigned unless it says
// otherwise, and answers the ack's outcome.
const sendFrom = (
  client: ReturnType<typeof connect>,
  message: { gameId: unknown; text: string; signed?: boolean },
) => {
  const ack = vi.fn()

  client.call(
    EVENTS.ASK.SEND,
    { signed: false, nonce: nonce(), ...message },
    ack,
  )

  return ack.mock.calls[0]?.[0] as unknown
}

const savedFiles = () =>
  existsSync(join(root, "asks"))
    ? readdirSync(join(root, "asks")).map((file) =>
        readFileSync(join(root, "asks", file), "utf-8"),
      )
    : []

// Every console level, silenced and recorded.
const spyOnConsole = () =>
  (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => undefined),
  )

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse("2026-11-17T18:04:31.250Z"))
  root = mkdtempSync(join(tmpdir(), "razzia-asks-handler-"))
  process.env.CONFIG_PATH = root
  vi.spyOn(console, "log").mockImplementation(() => undefined)
})

afterEach(() => {
  registry.getAllGames().forEach(({ gameId }) => {
    registry.removeGame(gameId)
  })
  emitted.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

afterAll(() => {
  registry.stopCleanupTask()
})

describe("ask:send", () => {
  it("keeps a player's question on disk and answers accepted", () => {
    const { game, zelda } = room()

    expect(sendFrom(zelda, { gameId: game.gameId, text: TEXT })).toBe(
      "accepted",
    )

    const [file] = savedFiles()

    expect(JSON.parse(file)).toMatchObject({
      gameSubject: "Check-in",
      asks: [{ text: TEXT, state: "new", at: "2026-11-17T18:04:00.000Z" }],
    })
  })

  it("answers notPlayer for a room that is not there, with no error toast", () => {
    const { zelda } = room()

    expect(sendFrom(zelda, { gameId: "no-such-room", text: TEXT })).toBe(
      "notPlayer",
    )
    expect(sendFrom(zelda, { gameId: undefined, text: TEXT })).toBe("notPlayer")
    expect(sendFrom(zelda, { gameId: 42, text: TEXT })).toBe("notPlayer")
    expect(
      emitted.filter(({ event }) => event === EVENTS.GAME.ERROR_MESSAGE),
    ).toEqual([])
    expect(savedFiles()).toEqual([])
  })

  it("answers notLecture in a normal game", () => {
    const { game, zelda } = room({ lecture: false })

    expect(sendFrom(zelda, { gameId: game.gameId, text: TEXT })).toBe(
      "notLecture",
    )
  })

  it("still keeps the question when the client leaves out the ack", () => {
    const { game, zelda } = room()

    zelda.call(EVENTS.ASK.SEND, {
      gameId: game.gameId,
      text: TEXT,
      signed: false,
      nonce: nonce(),
    })

    expect(savedFiles()).toHaveLength(1)
  })

  it("keeps no client id, socket id or name in the file but a signed ask's own", () => {
    const { game, zelda, bob } = room()

    sendFrom(zelda, { gameId: game.gameId, text: TEXT })
    vi.advanceTimersByTime(15_000)
    sendFrom(zelda, { gameId: game.gameId, text: SIGNED_TEXT, signed: true })
    sendFrom(bob, { gameId: game.gameId, text: `${TEXT} too` })

    const [file] = savedFiles()
    const record = JSON.parse(file) as { asks: Array<{ name?: string }> }

    expect(record.asks.map(({ name }) => name ?? null)).toEqual([
      null,
      NAME,
      null,
    ])
    expect(file.match(new RegExp(NAME, "gu"))).toHaveLength(1)

    for (const word of [
      "zelda-client",
      "zelda-sock",
      "bob-client",
      "bob-sock",
      "Bobby",
      "host-client",
    ]) {
      expect(file).not.toContain(word)
    }
  })
})

describe("ask:sync", () => {
  it("answers the box to a player, and null for a room that is gone", () => {
    const { game, zelda } = room()

    zelda.call(EVENTS.ASK.SYNC, { gameId: game.gameId })
    zelda.call(EVENTS.ASK.SYNC, { gameId: "gone" })
    zelda.call(EVENTS.ASK.SYNC, null)

    expect(
      emitted
        .filter(({ event }) => event === EVENTS.ASK.BOX)
        .map(({ target, payload }) => [target, payload]),
    ).toEqual([
      ["socket:zelda-sock", { open: true }],
      ["socket:zelda-sock", null],
      ["socket:zelda-sock", null],
    ])
  })
})

describe("manager:setAskBox", () => {
  it("lets the game's manager close the box, and tells the room", () => {
    const { game, host, zelda } = room()
    const ack = vi.fn()

    host.call(
      EVENTS.MANAGER.SET_ASK_BOX,
      { gameId: game.gameId, open: false },
      ack,
    )

    expect(ack).toHaveBeenCalledWith("accepted")
    expect(
      emitted.filter(
        ({ target, event }) =>
          target === game.gameId && event === EVENTS.ASK.BOX,
      ),
    ).toEqual([
      { target: game.gameId, event: EVENTS.ASK.BOX, payload: { open: false } },
    ])
    expect(sendFrom(zelda, { gameId: game.gameId, text: TEXT })).toBe("closed")
  })

  it("answers notManager to a player", () => {
    const { game, zelda } = room()
    const ack = vi.fn()

    zelda.call(
      EVENTS.MANAGER.SET_ASK_BOX,
      { gameId: game.gameId, open: false },
      ack,
    )

    expect(ack).toHaveBeenCalledWith("notManager")
  })

  it("answers a room that is not there like every game command", () => {
    const { host } = room()
    const ack = vi.fn()

    host.call(EVENTS.MANAGER.SET_ASK_BOX, { gameId: "gone", open: false }, ack)

    expect(ack).not.toHaveBeenCalled()
    expect(
      emitted.filter(({ event }) => event === EVENTS.GAME.ERROR_MESSAGE),
    ).toHaveLength(1)
  })
})

describe("ask:send logs (A3)", () => {
  it("logs no question, name, client id or socket id, accepted, refused or failed to write", () => {
    const spies = spyOnConsole()
    const { game, host, zelda, bob } = room()

    // Accepted and written.
    sendFrom(zelda, { gameId: game.gameId, text: TEXT })
    // Refused: too soon, malformed, a stranger's room, closed.
    sendFrom(zelda, { gameId: game.gameId, text: TEXT })
    sendFrom(zelda, { gameId: game.gameId, text: "" })
    sendFrom(zelda, { gameId: "gone", text: TEXT })
    // A write that fails: a file where the folder should be.
    rmSync(join(root, "asks"), { recursive: true, force: true })
    writeFileSync(join(root, "asks"), "not a folder")
    expect(
      sendFrom(bob, { gameId: game.gameId, text: SIGNED_TEXT, signed: true }),
    ).toBe("accepted")
    vi.advanceTimersByTime(15_000)
    sendFrom(zelda, {
      gameId: game.gameId,
      text: `${TEXT} again`,
      signed: true,
    })
    host.call(EVENTS.MANAGER.SET_ASK_BOX, { gameId: game.gameId, open: false })
    sendFrom(bob, { gameId: game.gameId, text: TEXT })
    game.settleAsks()

    const calls = spies.flatMap((spy) => spy.mock.calls)
    const logged = JSON.stringify(calls)
    const failures = spies[3].mock.calls.length

    // The failed writes were reported: one per change and one at the settle.
    expect(failures).toBeGreaterThan(0)

    for (const word of [
      "quaternion",
      "zebra",
      NAME,
      "Bobby",
      "zelda-client",
      "zelda-sock",
      "bob-client",
      "bob-sock",
    ]) {
      expect(logged).not.toContain(word)
    }
  })
})
