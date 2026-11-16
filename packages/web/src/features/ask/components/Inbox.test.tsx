import { EVENTS } from "@razzia/common/constants"
import type { AskLive, AskRecord, AskRoomView } from "@razzia/common/types/ask"
import Inbox from "@razzia/web/features/ask/components/Inbox"
import { useInboxStore } from "@razzia/web/features/ask/stores/inbox"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The presenter's inbox page, with the server's messages played in by hand.

const mocks = vi.hoisted(() => {
  const emit = vi.fn()

  return {
    emit,
    socket: { emit },
    connected: true,
    // Every listener, as Socket.IO keeps them.
    handlers: new Map<string, Set<(_payload?: unknown) => void>>(),
  }
})

vi.mock("@razzia/web/features/game/contexts/socket-context", async () => {
  const { useEffect, useRef } = await import("react")

  return {
    useEvent: (event: string, handler: (_payload?: unknown) => void) => {
      const latest = useRef(handler)

      latest.current = handler
      useEffect(() => {
        const call = (payload?: unknown) => {
          latest.current(payload)
        }
        const set = mocks.handlers.get(event) ?? new Set()

        set.add(call)
        mocks.handlers.set(event, set)

        return () => {
          set.delete(call)
        }
      }, [event])
    },
    useSocket: () => ({ socket: mocks.socket, isConnected: mocks.connected }),
  }
})

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
    i18n: { language: "en" },
  }),
}))

const TEXT = "Why does the quaternion flip?"
const SIGNED = "Is the zebra test on Friday?"
const NAME = "Zelda"

const record = (id: string, asks: AskRecord["asks"]): AskRecord => ({
  id,
  gameSubject: "Check-in",
  date: "2026-11-17T18:04:00.000Z",
  asks,
})

const roomWith = (extra: Partial<AskRoomView> = {}): AskRoomView => ({
  gameId: "game-1",
  inviteCode: "123456",
  gameSubject: "Check-in",
  open: true,
  waiting: 2,
  saved: true,
  record: record("rec-1", [
    { id: "a1", text: TEXT, at: "2026-11-17T18:04:00.000Z", state: "new" },
    {
      id: "a2",
      text: SIGNED,
      at: "2026-11-17T18:05:00.000Z",
      name: NAME,
      state: "new",
    },
  ]),
  ...extra,
})

const emptyRoom = (): AskRoomView =>
  roomWith({ gameId: "game-2", waiting: 0, record: null })

const serverSends = (event: string, payload?: unknown) => {
  act(() => {
    for (const handler of mocks.handlers.get(event) ?? []) {
      handler(payload)
    }
  })
}

const sent = (event: string): unknown[][] =>
  (mocks.emit.mock.calls as unknown[][]).filter(([name]) => name === event)

const pageText = () => document.body.textContent

// The element a selector names; a missing one fails the test there.
const required = (selector: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(selector)

  if (!found) {
    throw new Error(`No ${selector} on the page`)
  }

  return found
}

// What the browser's storage holds, as key=value lines.
const storedIn = (storage: Storage): string[] => {
  if (typeof storage.key !== "function") {
    return []
  }

  const keys = Array.from({ length: storage.length }, (_, index) =>
    storage.key(index),
  )

  return keys.map((key) => `${key ?? ""}=${storage.getItem(key ?? "") ?? ""}`)
}

const reveal = () => {
  fireEvent.click(required("[data-inbox-reveal]"))
}

const live = (extra: Partial<AskLive> = {}): AskLive => ({
  rooms: [roomWith()],
  records: [],
  ...extra,
})

beforeEach(() => {
  mocks.emit.mockClear()
  mocks.handlers.clear()
  mocks.connected = true
  useInboxStore.getState().reset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("the inbox's connection", () => {
  it("watches as soon as it is connected, and says it is live", () => {
    render(<Inbox />)

    expect(sent(EVENTS.ASKS.WATCH)).toHaveLength(1)
    expect(document.querySelector('[data-inbox-status="live"]')).not.toBeNull()
  })

  it("says it is reconnecting, and watches again once connected", () => {
    const { rerender } = render(<Inbox />)

    mocks.connected = false
    rerender(<Inbox />)
    expect(
      document.querySelector('[data-inbox-status="reconnecting"]'),
    ).not.toBeNull()

    mocks.connected = true
    rerender(<Inbox />)
    expect(sent(EVENTS.ASKS.WATCH)).toHaveLength(2)
  })

  it("stops watching and forgets everything when it is left", () => {
    const { unmount } = render(<Inbox />)

    serverSends(EVENTS.ASKS.LIVE, live())
    unmount()

    expect(sent(EVENTS.ASKS.UNWATCH)).toHaveLength(1)
    expect(useInboxStore.getState().live).toBeNull()
  })

  it("shows the login when the server no longer knows it, and watches again after", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())
    reveal()

    serverSends(EVENTS.MANAGER.UNAUTHORIZED)

    expect(pageText()).not.toContain("quaternion")
    expect(
      screen.getByPlaceholderText("manager:passwordPlaceholder"),
    ).toBeInTheDocument()

    fireEvent.change(
      screen.getByPlaceholderText("manager:passwordPlaceholder"),
      {
        target: { value: "typed-here" },
      },
    )
    fireEvent.click(screen.getByText("common:submit"))
    expect(sent(EVENTS.MANAGER.AUTH)).toEqual([
      [EVENTS.MANAGER.AUTH, "typed-here"],
    ])

    serverSends(EVENTS.MANAGER.CONFIG, {})

    expect(sent(EVENTS.ASKS.WATCH)).toHaveLength(2)
    expect(
      screen.queryByPlaceholderText("manager:passwordPlaceholder"),
    ).toBeNull()
  })
})

describe("the curtain (A1)", () => {
  it("shows counts and no question until Show questions", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())

    expect(pageText()).not.toContain("quaternion")
    expect(pageText()).not.toContain("zebra")
    expect(pageText()).not.toContain(NAME)
    expect(document.querySelector("[data-ask-item]")).toBeNull()
    expect(document.querySelector('[data-ask-room="game-1"]')).not.toBeNull()
    expect(pageText()).toContain('ask:inbox.waiting {"count":2}')

    reveal()

    expect(pageText()).toContain("quaternion")
    expect(
      document.querySelector('[data-ask-item="a2"] [data-ask-item-name]')
        ?.textContent,
    ).toBe(NAME)
    expect(
      document.querySelector('[data-ask-item="a1"] [data-ask-item-name]'),
    ).toBeNull()
  })

  it("closes again when the page is hidden", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())
    reveal()

    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden")

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })

    expect(pageText()).not.toContain("quaternion")
    expect(document.querySelector("[data-ask-item]")).toBeNull()

    visibility.mockReturnValue("visible")
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"))
    })
    // Coming back does not open it again by itself.
    expect(pageText()).not.toContain("quaternion")
  })

  it("closes again by hand with Hide questions, offered only while they show", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())

    expect(document.querySelector("[data-inbox-hide]")).toBeNull()
    reveal()
    expect(pageText()).toContain("quaternion")

    fireEvent.click(required("[data-inbox-hide]"))

    expect(pageText()).not.toContain("quaternion")
    expect(document.querySelector("[data-ask-item]")).toBeNull()
    expect(document.querySelector("[data-inbox-hide]")).toBeNull()
    expect(document.querySelector("[data-inbox-reveal]")).not.toBeNull()
  })

  it("closes again when the window loses focus", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())
    reveal()

    act(() => {
      window.dispatchEvent(new Event("blur"))
    })

    expect(pageText()).not.toContain("quaternion")
  })

  it("draws a question as text, never as markup", () => {
    render(<Inbox />)
    serverSends(
      EVENTS.ASKS.LIVE,
      live({
        rooms: [
          roomWith({
            record: record("rec-1", [
              {
                id: "a1",
                text: '<img src=x onerror="alert(1)"><b>bold</b>',
                at: "2026-11-17T18:04:00.000Z",
                state: "new",
              },
            ]),
          }),
        ],
      }),
    )
    reveal()

    const item = document.querySelector("[data-ask-item-text]")

    expect(item?.textContent).toBe('<img src=x onerror="alert(1)"><b>bold</b>')
    expect(item?.querySelector("img, b")).toBeNull()
  })

  it("writes no question to the browser's storage", () => {
    // Wherever in the chain this runner's storage keeps `setItem`. (Here
    // `localStorage` may be a bare stand-in with none; the source scan in
    // `inbox-reach.test.ts` covers every storage whatever the runner.)
    const spyOnSetItem = (storage: Storage) => {
      let owner: object | null = storage

      while (owner && !Object.hasOwn(owner, "setItem")) {
        owner = Object.getPrototypeOf(owner) as object | null
      }

      return owner ? [vi.spyOn(owner as Storage, "setItem")] : []
    }
    const writes = [
      ...spyOnSetItem(window.localStorage),
      ...spyOnSetItem(window.sessionStorage),
    ]

    expect(writes.length).toBeGreaterThan(0)

    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())
    reveal()
    serverSends(EVENTS.ASKS.ROOM, roomWith({ waiting: 1 }))

    const stored = [
      ...storedIn(window.localStorage),
      ...storedIn(window.sessionStorage),
    ]
    const written = JSON.stringify([
      ...writes.flatMap((spy) => spy.mock.calls),
      stored,
    ])

    expect(written).not.toContain("quaternion")
    expect(written).not.toContain("zebra")
    expect(written).not.toContain(NAME)
  })
})

describe("rooms and records", () => {
  it("lists a live room with no questions yet, which pauses with one tap", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live({ rooms: [emptyRoom()] }))

    const block = document.querySelector('[data-ask-room="game-2"]')

    expect(block).toHaveAttribute("data-ask-box", "open")
    fireEvent.click(required('[data-ask-room="game-2"] [data-ask-pause]'))

    expect(sent(EVENTS.ASKS.SET_OPEN)[0]?.[1]).toEqual({
      gameId: "game-2",
      open: false,
    })

    serverSends(EVENTS.ASKS.ROOM, { ...emptyRoom(), open: false })

    expect(document.querySelector('[data-ask-room="game-2"]')).toHaveAttribute(
      "data-ask-box",
      "closed",
    )
    fireEvent.click(required('[data-ask-room="game-2"] [data-ask-pause]'))
    expect(sent(EVENTS.ASKS.SET_OPEN)[1]?.[1]).toEqual({
      gameId: "game-2",
      open: true,
    })
  })

  it("offers Pause while curtained, and nothing that marks unread questions", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())

    expect(document.querySelector("[data-ask-pause]")).not.toBeNull()
    expect(document.querySelector("[data-ask-got-all]")).toBeNull()
    expect(document.querySelector("[data-ask-got-it]")).toBeNull()
  })

  it("adds a room that opens while watching", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live({ rooms: [] }))
    serverSends(EVENTS.ASKS.ROOM, emptyRoom())

    expect(document.querySelector('[data-ask-room="game-2"]')).not.toBeNull()
  })

  it("marks, answers, marks all and deletes through the server", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())
    reveal()

    fireEvent.click(required('[data-ask-item="a1"] [data-ask-got-it]'))
    fireEvent.click(required('[data-ask-item="a2"] [data-ask-answered]'))
    fireEvent.click(required("[data-ask-got-all]"))
    fireEvent.click(required('[data-ask-item="a1"] [data-ask-delete]'))
    fireEvent.click(screen.getByRole("button", { name: "ask:inbox.delete" }))

    expect(sent(EVENTS.ASKS.MARK).map(([, message]) => message)).toEqual([
      { recordId: "rec-1", askId: "a1", state: "seen" },
      { recordId: "rec-1", askId: "a2", state: "answered" },
    ])
    expect(sent(EVENTS.ASKS.MARK_ALL)[0]?.[1]).toEqual({ recordId: "rec-1" })
    expect(sent(EVENTS.ASKS.REMOVE)[0]?.[1]).toEqual({
      recordId: "rec-1",
      askId: "a1",
    })
  })

  it("marks nothing seen by showing it", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())
    reveal()

    expect(sent(EVENTS.ASKS.MARK)).toEqual([])
    expect(sent(EVENTS.ASKS.MARK_ALL)).toEqual([])
  })

  it("puts unread records before quiet live rooms", () => {
    render(<Inbox />)
    serverSends(
      EVENTS.ASKS.LIVE,
      live({
        rooms: [emptyRoom()],
        records: [
          {
            id: "rec-old",
            gameSubject: "Check-in",
            date: "2026-11-17T17:00:00.000Z",
            total: 2,
            waiting: 2,
            answered: 0,
          },
        ],
      }),
    )

    const order = [
      ...document.querySelectorAll("[data-ask-room], [data-ask-record]"),
    ].map(
      (element) =>
        element.getAttribute("data-ask-room") ??
        element.getAttribute("data-ask-record"),
    )

    expect(order).toEqual(["rec-old", "game-2"])
  })

  it("opens an earlier record in full only after Show questions, and asks the server for it", () => {
    render(<Inbox />)
    serverSends(
      EVENTS.ASKS.LIVE,
      live({
        rooms: [],
        records: [
          {
            id: "rec-old",
            gameSubject: "Check-in",
            date: "2026-11-17T17:00:00.000Z",
            total: 1,
            waiting: 1,
            answered: 0,
          },
        ],
      }),
    )

    expect(document.querySelector("[data-ask-record-open]")).toBeNull()
    reveal()
    fireEvent.click(required("[data-ask-record-open]"))

    const [, message, ack] = sent(EVENTS.ASKS.RECORD_GET)[0] as [
      string,
      unknown,
      (_reply: unknown) => void,
    ]

    expect(message).toEqual({ recordId: "rec-old" })

    act(() => {
      ack({
        outcome: "accepted",
        record: record("rec-old", [
          {
            id: "old-1",
            text: TEXT,
            at: "2026-11-17T17:01:00.000Z",
            state: "new",
          },
        ]),
      })
    })

    return vi.waitFor(() => {
      expect(
        document.querySelector(
          '[data-ask-record="rec-old"] [data-ask-item="old-1"]',
        ),
      ).not.toBeNull()
    })
  })

  it("keeps a closed room's questions open where it now lists it", () => {
    render(<Inbox />)
    serverSends(EVENTS.ASKS.LIVE, live())
    reveal()
    serverSends(EVENTS.ASKS.LIVE, {
      rooms: [],
      records: [
        {
          id: "rec-1",
          gameSubject: "Check-in",
          date: "2026-11-17T18:04:00.000Z",
          total: 2,
          waiting: 2,
          answered: 0,
        },
      ],
    })

    expect(
      document.querySelector('[data-ask-record="rec-1"] [data-ask-item="a1"]'),
    ).not.toBeNull()
  })
})
