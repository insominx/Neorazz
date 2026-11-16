import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { EVENTS } from "@razzia/common/constants"
import type {
  AskLive,
  AskRecordReply,
  AskRoomView,
} from "@razzia/common/types/ask"
import type { Quizz } from "@razzia/common/types/game"
import type { Server, Socket } from "@razzia/common/types/game/socket"
import { asksSocketHandlers } from "@razzia/socket/handlers/asks"
import { gameSocketHandlers } from "@razzia/socket/handlers/game"
import { managerSocketHandlers } from "@razzia/socket/handlers/manager"
import { askWatchers } from "@razzia/socket/services/ask-watchers"
import Game from "@razzia/socket/services/game"
import manager, { LOGIN_IDLE_MS } from "@razzia/socket/services/manager"
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

// The presenter's inbox through its real handlers, rooms and store, on a
// scratch config folder: who may watch, what watchers are sent and when, and
// that nobody else is sent a question.

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

let clientCount = 0

const connect = (name: string) => {
  clientCount += 1

  const id = `${name}-sock-${clientCount}`
  const clientId = `${name}-client-${clientCount}`
  const handlers = new Map<string, Handler[]>()
  const socket = {
    id,
    handshake: { auth: { clientId }, address: "127.0.0.1" },
    emit: vi.fn((event: string, payload: unknown) => {
      emitted.push({ target: id, event, payload })
    }),
    join: vi.fn(),
    to: vi.fn(() => ({ emit: vi.fn() })),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler])

      return socket
    }),
  } as unknown as Socket

  for (const register of [
    managerSocketHandlers,
    gameSocketHandlers,
    asksSocketHandlers,
  ]) {
    register({ io, socket })
  }

  // Like Socket.IO, every listener for the event runs.
  const call = (event: string, ...args: unknown[]) => {
    for (const handler of handlers.get(event) ?? []) {
      handler(...args)
    }
  }

  const ack = (event: string, message?: unknown): unknown => {
    const reply = vi.fn()

    call(event, message, reply)

    return reply.mock.calls[0]?.[0] as unknown
  }

  const received = (event?: string) =>
    emitted.filter(
      (entry) => entry.target === id && (!event || entry.event === event),
    )

  return { socket, id, clientId, call, ack, received }
}

type Client = ReturnType<typeof connect>

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
const NAME = "Zelda"

const registry = Registry.getInstance()
let root = ""
let nonceCount = 0

const room = ({ lecture = true }: { lecture?: boolean } = {}) => {
  const host = connect("host")

  manager.login(host.socket)

  const game = new Game({
    io,
    socket: host.socket,
    quizz,
    visuals: {},
    lecture,
    onPollSettled: () => true,
  })
  const zelda = connect("zelda")

  registry.addGame(game)
  game.join(zelda.socket, NAME)

  return { game, host, zelda }
}

const ask = (
  from: Client,
  gameId: string,
  { text = TEXT, signed = false }: { text?: string; signed?: boolean } = {},
) => {
  nonceCount += 1

  return from.ack(EVENTS.ASK.SEND, {
    gameId,
    text,
    signed,
    nonce: `nonce-${String(nonceCount).padStart(4, "0")}`,
  })
}

const watcher = () => {
  const client = connect("inbox")

  manager.login(client.socket)
  client.call(EVENTS.ASKS.WATCH)

  return client
}

const lastLive = (client: Client) =>
  client.received(EVENTS.ASKS.LIVE).at(-1)?.payload as AskLive | undefined

const lastRoom = (client: Client) =>
  client.received(EVENTS.ASKS.ROOM).at(-1)?.payload as AskRoomView | undefined

const unauthorizedTo = (client: Client) =>
  client.received(EVENTS.MANAGER.UNAUTHORIZED).length

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse("2026-11-17T18:04:31.250Z"))
  root = mkdtempSync(join(tmpdir(), "razzia-asks-inbox-"))
  process.env.CONFIG_PATH = root
  vi.spyOn(console, "log").mockImplementation(() => undefined)
})

afterEach(() => {
  registry.getAllGames().forEach(({ gameId }) => {
    registry.removeGame(gameId)
  })
  askWatchers.clear()
  emitted.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
  rmSync(root, { recursive: true, force: true })
})

afterAll(() => {
  registry.stopCleanupTask()
})

describe("who may watch", () => {
  it("sends a socket with no manager login nothing but unauthorized", () => {
    const { game, zelda } = room()
    const stranger = connect("stranger")

    stranger.call(EVENTS.ASKS.WATCH)
    ask(zelda, game.gameId)
    game.setAskOpen(false)

    expect(stranger.received().map(({ event }) => event)).toEqual([
      EVENTS.MANAGER.UNAUTHORIZED,
    ])
    expect(askWatchers.has(stranger.socket)).toBe(false)
  })

  it("answers every inbox action from a socket with no login unauthorized, and changes nothing", () => {
    const { game, zelda } = room()
    const stranger = connect("stranger")

    ask(zelda, game.gameId)
    const recordId = game.askRecordId() ?? ""
    const askId = game.getAskRecord()?.asks[0].id ?? ""

    expect([
      stranger.ack(EVENTS.ASKS.MARK, { recordId, askId, state: "seen" }),
      stranger.ack(EVENTS.ASKS.MARK_ALL, { recordId }),
      stranger.ack(EVENTS.ASKS.REMOVE, { recordId, askId }),
      stranger.ack(EVENTS.ASKS.SET_OPEN, { gameId: game.gameId, open: false }),
      stranger.ack(EVENTS.ASKS.RECORD_DELETE, { recordId }),
    ]).toEqual(Array(5).fill("unauthorized"))
    expect(stranger.ack(EVENTS.ASKS.RECORD_GET, { recordId })).toEqual({
      outcome: "unauthorized",
    })
    expect(game.getAskRecord()?.asks[0].state).toBe("new")
    expect(game.askView()?.open).toBe(true)
    expect(JSON.stringify(stranger.received())).not.toContain("quaternion")
  })

  it("tells a watcher whose login lapsed, and drops it", () => {
    const { game, zelda } = room()
    const inbox = watcher()

    vi.advanceTimersByTime(LOGIN_IDLE_MS)
    ask(zelda, game.gameId)

    expect(unauthorizedTo(inbox)).toBe(1)
    expect(inbox.received(EVENTS.ASKS.ROOM)).toEqual([])
    expect(askWatchers.has(inbox.socket)).toBe(false)

    ask(zelda, game.gameId)
    expect(unauthorizedTo(inbox)).toBe(1)
  })

  it("tells a watcher logged out from another tab of the same login", () => {
    const { game, zelda } = room()
    const inbox = watcher()

    manager.logout(inbox.socket)
    ask(zelda, game.gameId)

    expect(unauthorizedTo(inbox)).toBe(1)
    expect(JSON.stringify(inbox.received())).not.toContain("quaternion")
  })

  it("drops a watcher that logs out, a watcher that stops watching, and one that disconnects", () => {
    const { game, zelda } = room()
    const loggedOut = watcher()
    const stopped = watcher()
    const gone = watcher()

    loggedOut.call(EVENTS.MANAGER.LOGOUT)
    stopped.call(EVENTS.ASKS.UNWATCH)
    gone.call("disconnect")
    ask(zelda, game.gameId)

    expect(unauthorizedTo(loggedOut)).toBe(1)
    expect(askWatchers.count()).toBe(0)

    for (const client of [loggedOut, stopped, gone]) {
      expect(client.received(EVENTS.ASKS.ROOM)).toEqual([])
    }
  })

  it("never makes a watcher a game's manager", () => {
    const { game, host, zelda } = room()
    const inbox = watcher()
    const hostId = game.manager.id

    expect(
      inbox.ack(EVENTS.MANAGER.SET_ASK_BOX, {
        gameId: game.gameId,
        open: false,
      }),
    ).toBe("notManager")
    expect(
      inbox.ack(EVENTS.MANAGER.PLAY_QUESTION, {
        gameId: game.gameId,
        index: 0,
      }),
    ).toBe("notManager")
    expect(game.manager.id).toBe(hostId)
    expect(game.manager.id).toBe(host.id)

    // The host still hears its room's count; the watcher hears only the
    // inbox.
    ask(zelda, game.gameId)
    expect(
      host.received(EVENTS.MANAGER.LECTURE_STATE).at(-1)?.payload,
    ).toMatchObject({ asks: { waiting: 1, open: true } })
    expect(
      inbox
        .received()
        .some(({ event }) => event === EVENTS.MANAGER.LECTURE_STATE),
    ).toBe(false)
  })
})

describe("what a watcher is sent", () => {
  it("lists a live lecture room with no questions yet, and no normal game", () => {
    const { game } = room()
    room({ lecture: false })
    const inbox = watcher()

    expect(lastLive(inbox)).toEqual({
      rooms: [
        {
          gameId: game.gameId,
          inviteCode: game.inviteCode,
          gameSubject: "Check-in",
          open: true,
          waiting: 0,
          saved: true,
          record: null,
        },
      ],
      records: [],
    })
  })

  it("pauses a room with no questions in one call, and the room and its phones hear it", () => {
    const { game, zelda } = room()
    const inbox = watcher()

    expect(
      inbox.ack(EVENTS.ASKS.SET_OPEN, { gameId: game.gameId, open: false }),
    ).toBe("accepted")

    expect(lastRoom(inbox)).toMatchObject({ open: false, record: null })
    expect(
      emitted.filter(
        ({ target, event }) =>
          target === game.gameId && event === EVENTS.ASK.BOX,
      ),
    ).toEqual([
      { target: game.gameId, event: EVENTS.ASK.BOX, payload: { open: false } },
    ])
    expect(ask(zelda, game.gameId)).toBe("closed")

    expect(
      inbox.ack(EVENTS.ASKS.SET_OPEN, { gameId: game.gameId, open: true }),
    ).toBe("accepted")
    expect(ask(zelda, game.gameId)).toBe("accepted")
  })

  it("refuses to set the box of a room that is not a live lecture room", () => {
    const normal = room({ lecture: false })
    const inbox = watcher()

    expect(
      inbox.ack(EVENTS.ASKS.SET_OPEN, { gameId: "gone", open: false }),
    ).toBe("notFound")
    expect(
      inbox.ack(EVENTS.ASKS.SET_OPEN, {
        gameId: normal.game.gameId,
        open: false,
      }),
    ).toBe("notFound")
    expect(
      inbox.ack(EVENTS.ASKS.SET_OPEN, {
        gameId: normal.game.gameId,
        open: "no",
      }),
    ).toBe("invalid")
  })

  it("sends a new lecture room as it opens", () => {
    const inbox = watcher()
    const { game } = room()

    expect(lastRoom(inbox)).toMatchObject({
      gameId: game.gameId,
      record: null,
      open: true,
    })
  })

  it("sends each question to every watcher at once, and to nobody else", () => {
    const { game, zelda, host } = room()
    const first = watcher()
    const second = watcher()
    // Logged in, but not watching: a manager page that is not the inbox.
    const config = connect("config")

    manager.login(config.socket)
    emitted.length = 0
    ask(zelda, game.gameId, { text: TEXT, signed: true })

    for (const inbox of [first, second]) {
      expect(lastRoom(inbox)?.record?.asks).toMatchObject([
        { text: TEXT, name: NAME, state: "new" },
      ])
      expect(lastRoom(inbox)?.waiting).toBe(1)
    }

    const toOthers = emitted.filter(
      ({ target }) => target !== first.id && target !== second.id,
    )

    expect(toOthers.length).toBeGreaterThan(0)
    expect(JSON.stringify(toOthers)).not.toContain("quaternion")
    expect(JSON.stringify(toOthers)).not.toContain(NAME)
    expect(config.received()).toEqual([])
    expect(host.received(EVENTS.MANAGER.LECTURE_STATE)).toHaveLength(1)
  })

  it("marks, marks all and deletes in a live room, which every watcher and the host's count follow", () => {
    const { game, zelda } = room()
    const inbox = watcher()
    const other = connect("bobby")

    game.join(other.socket, "Bobby")
    ask(zelda, game.gameId, { text: "One" })
    ask(other, game.gameId, { text: "Two" })
    vi.advanceTimersByTime(15_000)
    ask(zelda, game.gameId, { text: "Three" })

    const recordId = game.askRecordId() ?? ""
    const [one, two, three] = game.getAskRecord()?.asks ?? []

    expect(
      inbox.ack(EVENTS.ASKS.MARK, { recordId, askId: one.id, state: "seen" }),
    ).toBe("accepted")
    expect(lastRoom(inbox)?.waiting).toBe(2)
    expect(
      inbox.ack(EVENTS.ASKS.MARK, {
        recordId,
        askId: two.id,
        state: "answered",
      }),
    ).toBe("accepted")
    expect(inbox.ack(EVENTS.ASKS.REMOVE, { recordId, askId: three.id })).toBe(
      "accepted",
    )
    expect(lastRoom(inbox)?.record?.asks.map((a) => [a.text, a.state])).toEqual(
      [
        ["One", "seen"],
        ["Two", "answered"],
      ],
    )
    expect(
      emitted
        .filter(({ event }) => event === EVENTS.MANAGER.LECTURE_STATE)
        .at(-1)?.payload,
    ).toMatchObject({ asks: { waiting: 0, open: true } })
    expect(
      inbox.ack(EVENTS.ASKS.MARK, { recordId, askId: "nope", state: "seen" }),
    ).toBe("notFound")
    expect(
      inbox.ack(EVENTS.ASKS.MARK, { recordId, askId: one.id, state: "new" }),
    ).toBe("invalid")
  })

  it("marks every new question seen with one call", () => {
    const { game, zelda } = room()
    const inbox = watcher()

    ask(zelda, game.gameId)

    expect(
      inbox.ack(EVENTS.ASKS.MARK_ALL, { recordId: game.askRecordId() }),
    ).toBe("accepted")
    expect(lastRoom(inbox)?.waiting).toBe(0)
  })

  it("refuses a live room's record for deletion, and gives it whole on request", () => {
    const { game, zelda } = room()
    const inbox = watcher()

    ask(zelda, game.gameId)
    const recordId = game.askRecordId() ?? ""

    expect(inbox.ack(EVENTS.ASKS.RECORD_DELETE, { recordId })).toBe("live")
    expect(inbox.ack(EVENTS.ASKS.RECORD_GET, { recordId })).toMatchObject({
      outcome: "accepted",
      record: { asks: [{ text: TEXT }] },
    })
  })
})

describe("earlier records", () => {
  const closedRoom = () => {
    const { game, zelda } = room()

    ask(zelda, game.gameId, { text: TEXT, signed: true })
    vi.advanceTimersByTime(15_000)
    ask(zelda, game.gameId, { text: "Second one" })
    const recordId = game.askRecordId() ?? ""

    registry.closeGame(game, "errors:game.managerDisconnected")

    return recordId
  }

  it("lists a closed room's record by its counts, without text, beside the live rooms", () => {
    const recordId = closedRoom()
    const live = room()
    const inbox = watcher()

    expect(lastLive(inbox)?.rooms.map(({ gameId }) => gameId)).toEqual([
      live.game.gameId,
    ])
    expect(lastLive(inbox)?.records).toEqual([
      {
        id: recordId,
        gameSubject: "Check-in",
        date: "2026-11-17T18:04:00.000Z",
        total: 2,
        waiting: 2,
        answered: 0,
      },
    ])
    expect(JSON.stringify(lastLive(inbox)?.records)).not.toContain("quaternion")
    expect(JSON.stringify(lastLive(inbox)?.records)).not.toContain(NAME)
  })

  it("tells every watcher when a room closes", () => {
    const inbox = watcher()
    const recordId = closedRoom()

    expect(lastLive(inbox)?.rooms).toEqual([])
    expect(lastLive(inbox)?.records.map(({ id }) => id)).toEqual([recordId])
  })

  it("does not list a live room's record among the earlier ones", () => {
    const { game, zelda } = room()

    ask(zelda, game.gameId)
    const inbox = watcher()

    expect(lastLive(inbox)?.records).toEqual([])
    expect(lastLive(inbox)?.rooms[0].record?.asks).toHaveLength(1)
  })

  it("opens one in full, marks it on disk, and re-sends the list", () => {
    const recordId = closedRoom()
    const inbox = watcher()
    const reply = inbox.ack(EVENTS.ASKS.RECORD_GET, {
      recordId,
    }) as AskRecordReply | undefined

    expect(reply).toMatchObject({
      outcome: "accepted",
      record: { asks: [{ text: TEXT, name: NAME }, { text: "Second one" }] },
    })

    const askId =
      reply?.outcome === "accepted" ? reply.record.asks[0].id : "missing"
    const lists = inbox.received(EVENTS.ASKS.LIVE).length

    expect(
      inbox.ack(EVENTS.ASKS.MARK, { recordId, askId, state: "answered" }),
    ).toBe("accepted")
    expect(inbox.received(EVENTS.ASKS.LIVE)).toHaveLength(lists + 1)
    expect(lastLive(inbox)?.records[0]).toMatchObject({
      waiting: 1,
      answered: 1,
    })

    expect(inbox.ack(EVENTS.ASKS.MARK_ALL, { recordId })).toBe("accepted")
    expect(lastLive(inbox)?.records[0].waiting).toBe(0)
    expect(inbox.ack(EVENTS.ASKS.REMOVE, { recordId, askId })).toBe("accepted")
    expect(lastLive(inbox)?.records[0].total).toBe(1)
  })

  it("deletes one, which leaves the list", () => {
    const recordId = closedRoom()
    const inbox = watcher()

    expect(inbox.ack(EVENTS.ASKS.RECORD_DELETE, { recordId })).toBe("accepted")
    expect(lastLive(inbox)?.records).toEqual([])
    expect(inbox.ack(EVENTS.ASKS.RECORD_DELETE, { recordId })).toBe("notFound")
    expect(inbox.ack(EVENTS.ASKS.RECORD_GET, { recordId })).toEqual({
      outcome: "notFound",
    })
  })

  it("refuses an id that is not a plain file name before touching the disk", () => {
    closedRoom()
    const inbox = watcher()

    for (const recordId of ["../game", "a/b", "a\\b", "c:x", "", 42, null]) {
      expect(inbox.ack(EVENTS.ASKS.RECORD_GET, { recordId })).toEqual({
        outcome: "invalid",
      })
      expect(inbox.ack(EVENTS.ASKS.RECORD_DELETE, { recordId })).toBe("invalid")
      expect(inbox.ack(EVENTS.ASKS.MARK_ALL, { recordId })).toBe("invalid")
      expect(
        inbox.ack(EVENTS.ASKS.MARK, {
          recordId,
          askId: "x",
          state: "seen",
        }),
      ).toBe("invalid")
    }
  })
})
