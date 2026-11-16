import type { AskRecord } from "@razzia/common/types/ask"
import { ASK_LIMITS } from "@razzia/common/validators/ask"
import {
  type AskChange,
  AskManager,
  type AskSender,
} from "@razzia/socket/services/game/ask-manager"
import { describe, expect, it, vi } from "vitest"

const START = Date.parse("2026-11-17T18:04:31.250Z")

const alice: AskSender = { clientId: "alice-client", username: "Alice" }
const bob: AskSender = { clientId: "bob-client", username: "Bobby" }

let nonceCount = 0
const nonce = () => {
  nonceCount += 1

  return `nonce-${String(nonceCount).padStart(4, "0")}`
}

const ask = (text = "Why is the sky blue?", extra: object = {}) => ({
  text,
  signed: false,
  nonce: nonce(),
  ...extra,
})

const statesOf = (record: AskRecord) => record.asks.map((a) => a.state)

const setup = ({ saves = true }: { saves?: boolean | boolean[] } = {}) => {
  let time = START
  const saved: AskRecord[] = []
  const changes: AskChange[] = []
  const results = Array.isArray(saves) ? [...saves] : null
  const save = vi.fn((record: AskRecord) => {
    saved.push(record)

    return results ? (results.shift() ?? true) : saves === true
  })
  const asks = new AskManager({
    gameSubject: "Check-in",
    save,
    onChanged: (change) => {
      changes.push(change)
    },
    now: () => time,
  })

  return {
    asks,
    save,
    saved,
    changes,
    advance: (ms: number) => {
      time += ms
    },
  }
}

describe("AskManager sending", () => {
  it("keeps an unsigned ask with no author, its time to the minute", () => {
    const { asks } = setup()

    expect(asks.send(alice, ask(" Why? "))).toBe("accepted")

    const record = asks.getRecord()

    expect(record).toMatchObject({
      gameSubject: "Check-in",
      date: "2026-11-17T18:04:00.000Z",
      asks: [{ text: "Why?", at: "2026-11-17T18:04:00.000Z", state: "new" }],
    })
    expect(record?.asks[0]).not.toHaveProperty("name")
    expect(JSON.stringify(record)).not.toContain("alice")
    expect(JSON.stringify(record)).not.toContain("Alice")
  })

  it("keeps the seat's own name on a signed ask, whatever the payload says", () => {
    const { asks } = setup()

    asks.send(alice, ask("Why?", { signed: true, name: "Mallory" }))

    expect(asks.getRecord()?.asks[0].name).toBe("Alice")
    expect(JSON.stringify(asks.getRecord())).not.toContain("Mallory")
  })

  it("refuses a payload that is not shaped like an ask", () => {
    const { asks, save } = setup()

    expect(asks.send(alice, { text: 42, signed: false, nonce: nonce() })).toBe(
      "invalid",
    )
    expect(asks.send(alice, { text: "Why?", signed: false, nonce: "x" })).toBe(
      "invalid",
    )
    expect(
      asks.send(alice, { text: "Why?", signed: "yes", nonce: nonce() }),
    ).toBe("invalid")
    expect(
      asks.send(alice, {
        text: "x".repeat(ASK_LIMITS.RAW_TEXT + 1),
        signed: false,
        nonce: nonce(),
      }),
    ).toBe("invalid")
    expect(save).not.toHaveBeenCalled()
  })

  it("reads a missing `signed` as unsigned", () => {
    const { asks } = setup()

    expect(
      asks.send(alice, { text: "Why?", signed: undefined, nonce: nonce() }),
    ).toBe("accepted")
    expect(asks.getRecord()?.asks[0]).not.toHaveProperty("name")
  })

  it("refuses an empty question and one over 500 characters", () => {
    const { asks } = setup()

    expect(asks.send(alice, ask("   "))).toBe("invalid")
    expect(asks.send(alice, ask("x".repeat(501)))).toBe("invalid")
    expect(asks.send(alice, ask("x".repeat(500)))).toBe("accepted")
  })

  it("refuses everything while the box is closed", () => {
    const { asks } = setup()

    asks.setOpen(false)

    expect(asks.send(alice, ask())).toBe("closed")
    expect(asks.getRecord()).toBeNull()
  })

  it("takes one ask per seat every 15 seconds", () => {
    const { asks, advance } = setup()

    expect(asks.send(alice, ask())).toBe("accepted")
    advance(ASK_LIMITS.SPACING_MS - 1)
    expect(asks.send(alice, ask())).toBe("tooFast")
    // Another seat is not held up.
    expect(asks.send(bob, ask())).toBe("accepted")
    advance(1)
    expect(asks.send(alice, ask())).toBe("accepted")
  })

  it("does not let a refused send restart the 15 seconds", () => {
    const { asks, advance } = setup()

    asks.send(alice, ask())
    advance(10_000)
    expect(asks.send(alice, ask())).toBe("tooFast")
    advance(5_000)
    expect(asks.send(alice, ask())).toBe("accepted")
  })

  it("takes 10 asks per seat in a room", () => {
    const { asks, advance } = setup()

    for (let index = 0; index < ASK_LIMITS.PER_SEAT; index += 1) {
      expect(asks.send(alice, ask())).toBe("accepted")
      advance(ASK_LIMITS.SPACING_MS)
    }

    expect(asks.send(alice, ask())).toBe("tooMany")
    expect(asks.send(bob, ask())).toBe("accepted")
  })

  it("holds 500 asks in a room, then answers full", () => {
    const { asks } = setup()

    for (let index = 0; index < ASK_LIMITS.PER_ROOM; index += 1) {
      const seat = { clientId: `seat-${index}`, username: `S${index}` }

      expect(asks.send(seat, ask())).toBe("accepted")
    }

    expect(asks.send(alice, ask())).toBe("full")
    expect(asks.getRecord()?.asks).toHaveLength(ASK_LIMITS.PER_ROOM)
  })

  it("checks in the contract's order: shape, repeat, box, text, spacing, seat, room", () => {
    const { asks, advance } = setup()
    const first = ask()

    asks.send(alice, first)
    asks.setOpen(false)
    // A repeat is answered before the box: it was kept before the pause.
    expect(asks.send(alice, first)).toBe("accepted")
    // The box before the text, the text before the spacing.
    expect(asks.send(alice, ask(""))).toBe("closed")
    asks.setOpen(true)
    expect(asks.send(alice, ask(""))).toBe("invalid")
    expect(asks.send(alice, ask())).toBe("tooFast")
    advance(ASK_LIMITS.SPACING_MS)
    expect(asks.send(alice, ask())).toBe("accepted")
  })
})

describe("AskManager repeated sends", () => {
  it("answers a nonce it has kept with accepted and stores nothing", () => {
    const { asks, save, changes } = setup()
    const draft = ask()

    expect(asks.send(alice, draft)).toBe("accepted")
    save.mockClear()
    changes.length = 0

    expect(asks.send(alice, draft)).toBe("accepted")
    expect(asks.getRecord()?.asks).toHaveLength(1)
    expect(save).not.toHaveBeenCalled()
    expect(changes).toEqual([])
  })

  it("is not held up by the 15 seconds, so a resend after a lost reply is never tooFast", () => {
    const { asks, advance } = setup()
    const draft = ask()

    asks.send(alice, draft)
    advance(2_000)

    expect(asks.send(alice, draft)).toBe("accepted")
  })

  it("forgets a nonce after 30 minutes", () => {
    const { asks, advance } = setup()
    const draft = ask()

    asks.send(alice, draft)
    advance(ASK_LIMITS.NONCE_TTL_MS - 1)
    expect(asks.send(alice, draft)).toBe("accepted")
    expect(asks.getRecord()?.asks).toHaveLength(1)

    advance(1)
    expect(asks.send(alice, draft)).toBe("accepted")
    expect(asks.getRecord()?.asks).toHaveLength(2)
  })

  it("keeps no nonce for a refused send, so the same draft can go later", () => {
    const { asks, advance } = setup()
    const draft = ask()

    asks.send(alice, ask())
    expect(asks.send(alice, draft)).toBe("tooFast")
    advance(ASK_LIMITS.SPACING_MS)
    expect(asks.send(alice, draft)).toBe("accepted")
    expect(asks.getRecord()?.asks).toHaveLength(2)
  })
})

describe("AskManager count", () => {
  it("says nothing to the host until the box first changes", () => {
    const { asks } = setup()

    expect(asks.count()).toBeUndefined()
    asks.send(alice, ask())
    expect(asks.count()).toEqual({ waiting: 1, open: true })
  })

  it("says so when the box closes before any ask", () => {
    const { asks, changes } = setup()

    asks.setOpen(false)

    expect(asks.count()).toEqual({ waiting: 0, open: false })
    expect(changes).toEqual([{ count: true, box: true }])
  })

  it("counts new asks up on arrival and down on Got it, Answered, Got it all and removal", () => {
    const { asks, advance } = setup()

    for (const seat of [alice, bob]) {
      asks.send(seat, ask())
    }

    advance(ASK_LIMITS.SPACING_MS)
    asks.send(alice, ask())
    asks.send(bob, ask())
    expect(asks.count()?.waiting).toBe(4)

    const [first, second, third] = asks.getRecord()?.asks ?? []

    expect(asks.mark(first.id, "seen")).toBe("accepted")
    expect(asks.count()?.waiting).toBe(3)
    expect(asks.mark(second.id, "answered")).toBe("accepted")
    expect(asks.count()?.waiting).toBe(2)
    expect(asks.remove(third.id)).toBe("accepted")
    expect(asks.count()?.waiting).toBe(1)
    asks.markAll()
    expect(asks.count()?.waiting).toBe(0)
    expect(asks.waiting()).toBe(0)
  })

  it("tells the room at most 10, and the inbox the true count", () => {
    const { asks } = setup()

    for (let index = 0; index < 12; index += 1) {
      asks.send({ clientId: `seat-${index}`, username: `S${index}` }, ask())
    }

    expect(asks.count()).toEqual({ waiting: 10, open: true })
    expect(asks.waiting()).toBe(12)
  })

  it("reports a count change only when what the host is told changes", () => {
    const { asks, changes } = setup()

    for (let index = 0; index < 11; index += 1) {
      asks.send({ clientId: `seat-${index}`, username: `S${index}` }, ask())
    }

    // 10 to 11 is still "9+".
    expect(changes.at(-1)).toEqual({ count: false, box: false })

    const [first] = asks.getRecord()?.asks ?? []

    asks.mark(first.id, "seen")
    // 11 to 10 is still "9+".
    expect(changes.at(-1)).toEqual({ count: false, box: false })
    asks.mark(first.id, "answered")
    // Seen to answered moves no count.
    expect(changes.at(-1)).toEqual({ count: false, box: false })
  })

  it("reports the box only when it really opens or closes", () => {
    const { asks, changes } = setup()

    expect(asks.setOpen(true)).toBe(false)
    expect(changes).toEqual([])
    expect(asks.setOpen(false)).toBe(true)
    expect(asks.setOpen(false)).toBe(false)
    expect(asks.setOpen(true)).toBe(true)
    expect(changes).toEqual([
      { count: true, box: true },
      { count: true, box: true },
    ])
  })
})

describe("AskManager marking", () => {
  it("marks seen or answered, never back to new", () => {
    const { asks } = setup()

    asks.send(alice, ask())
    const [first] = asks.getRecord()?.asks ?? []

    expect(asks.mark(first.id, "answered")).toBe("accepted")
    expect(asks.mark(first.id, "new")).toBe("invalid")
    expect(asks.getRecord()?.asks[0].state).toBe("answered")
  })

  it("answers notFound for an ask it does not hold", () => {
    const { asks } = setup()

    expect(asks.mark("nope", "seen")).toBe("notFound")
    expect(asks.remove("nope")).toBe("notFound")
    asks.send(alice, ask())
    expect(asks.mark("nope", "seen")).toBe("notFound")
    expect(asks.remove("nope")).toBe("notFound")
  })

  it("writes nothing when nothing changes", () => {
    const { asks, save } = setup()

    asks.send(alice, ask())
    const [first] = asks.getRecord()?.asks ?? []

    asks.mark(first.id, "seen")
    save.mockClear()
    asks.mark(first.id, "seen")
    asks.markAll()

    expect(save).not.toHaveBeenCalled()
  })
})

describe("AskManager storage", () => {
  it("writes the record through on every change", () => {
    const { asks, saved, advance } = setup()

    asks.send(alice, ask("One"))
    advance(ASK_LIMITS.SPACING_MS)
    asks.send(alice, ask("Two"))
    const [first] = asks.getRecord()?.asks ?? []
    asks.mark(first.id, "seen")

    expect(saved.map(statesOf)).toEqual([
      ["new"],
      ["new", "new"],
      ["seen", "new"],
    ])
    expect(new Set(saved.map((record) => record.id)).size).toBe(1)
  })

  it("hands the store a copy, which cannot change the room's record", () => {
    const { asks, saved } = setup()

    asks.send(alice, ask())
    saved[0].asks[0].text = "changed"

    expect(asks.getRecord()?.asks[0].text).toBe("Why is the sky blue?")
  })

  it("keeps an ask whose write failed, and writes it on the next change", () => {
    const { asks, saved } = setup({ saves: [false, true] })

    expect(asks.send(alice, ask("One"))).toBe("accepted")
    expect(asks.isSaved()).toBe(false)

    asks.send(bob, ask("Two"))

    expect(asks.isSaved()).toBe(true)
    expect(saved.at(-1)?.asks.map((a) => a.text)).toEqual(["One", "Two"])
  })

  it("offers a record that was not kept once more when settled, and nothing otherwise", () => {
    const { asks, save } = setup({ saves: [false, true] })

    asks.settle()
    expect(save).not.toHaveBeenCalled()

    asks.send(alice, ask())
    asks.settle()

    expect(save).toHaveBeenCalledTimes(2)
    expect(asks.isSaved()).toBe(true)

    asks.settle()
    expect(save).toHaveBeenCalledTimes(2)
  })

  it("makes random ids, never time-ordered ones", () => {
    const { asks } = setup()

    asks.send(alice, ask())
    const record = asks.getRecord()
    const uuidV7 =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

    expect(record?.id).toMatch(/^[\w-]{12}$/u)
    expect(record?.asks[0].id).toMatch(/^[\w-]{12}$/u)
    expect(record?.id).not.toMatch(uuidV7)
    expect(record?.id).not.toBe(record?.asks[0].id)
  })
})
