import type {
  Ask,
  AskCount,
  AskOutcome,
  AskRecord,
  AskState,
} from "@razzia/common/types/ask"
import {
  ASK_LIMITS,
  capWaiting,
  cleanAskText,
  isAskNonce,
  minuteOf,
} from "@razzia/common/validators/ask"
import { nanoid } from "nanoid"

// Who is sending, as the room knows them. Only the name of a signed ask is
// ever kept with it; the client id keys the seat's counters, in memory.
export interface AskSender {
  clientId: string
  username: string
}

// What a change moved: `count` when what the host page is told
// (`{ waiting, open }`, capped) is different, `box` when the box opened or
// closed. Every change also changes what the inbox sees.
export interface AskChange {
  count: boolean
  box: boolean
}

export interface AskManagerOptions {
  gameSubject: string
  // Keeps the record; `false` says it could not, and the record is offered
  // again on the next change, the room's close or the server's shutdown.
  save: (_record: AskRecord) => boolean
  onChanged: (_change: AskChange) => void
  now?: () => number
  newId?: () => string
}

export type AskMarkOutcome = "accepted" | "notFound" | "invalid"

interface Seat {
  count: number
  lastAt: number
}

const copyRecord = (record: AskRecord): AskRecord => ({
  ...record,
  asks: record.asks.map((ask) => ({ ...ask })),
})

/**
 * One lecture room's question box: its record, whether it is open, and the
 * limits on each seat. It knows nothing of the quiz, the polls or storage;
 * the room hands it a save function and hears of every change.
 *
 * Nothing about an ask is logged here, and nothing links an ask to its
 * sender: the seat counters and the nonces are kept apart from the record,
 * in memory, and are never saved.
 */
export class AskManager {
  private readonly opts: AskManagerOptions
  private readonly now: () => number
  private readonly newId: () => string
  private open = true
  private record: AskRecord | null = null
  private saved = true
  // Whether the box has changed since the room opened: until then the host is
  // told nothing about it, so a room without asks sends what it always did.
  private touched = false
  private readonly seats = new Map<string, Seat>()
  // Nonce to the time its ask was accepted, oldest first.
  private readonly nonces = new Map<string, number>()

  constructor(opts: AskManagerOptions) {
    this.opts = opts
    this.now = opts.now ?? Date.now
    this.newId = opts.newId ?? (() => nanoid(12))
  }

  isOpen(): boolean {
    return this.open
  }

  get gameSubject(): string {
    return this.opts.gameSubject
  }

  // The true number of new asks, for the inbox.
  waiting(): number {
    return this.record?.asks.filter((ask) => ask.state === "new").length ?? 0
  }

  // What the host page and the deck are told, or nothing while the box is as
  // it started (open, none waiting).
  count(): AskCount | undefined {
    return this.touched
      ? { waiting: capWaiting(this.waiting()), open: this.open }
      : undefined
  }

  isSaved(): boolean {
    return this.saved
  }

  recordId(): string | null {
    return this.record?.id ?? null
  }

  // A copy, so nothing outside can change the room's record.
  getRecord(): AskRecord | null {
    return this.record ? copyRecord(this.record) : null
  }

  // The payload's fields are read here, as the client sent them: anything may
  // be anything. The order of the checks is the contract's (section 4).
  send(
    sender: AskSender,
    { text, signed, nonce }: { text: unknown; signed: unknown; nonce: unknown },
  ): AskOutcome {
    const time = this.now()

    if (
      typeof text !== "string" ||
      text.length > ASK_LIMITS.RAW_TEXT ||
      !isAskNonce(nonce) ||
      (signed !== undefined && typeof signed !== "boolean")
    ) {
      return "invalid"
    }

    this.forgetOldNonces(time)

    // A send repeated after a lost reply: the first one was kept.
    if (this.nonces.has(nonce)) {
      return "accepted"
    }

    if (!this.open) {
      return "closed"
    }

    const cleaned = cleanAskText(text)

    if (cleaned === null) {
      return "invalid"
    }

    const seat = this.seats.get(sender.clientId)

    if (seat && time - seat.lastAt < ASK_LIMITS.SPACING_MS) {
      return "tooFast"
    }

    if (seat && seat.count >= ASK_LIMITS.PER_SEAT) {
      return "tooMany"
    }

    if ((this.record?.asks.length ?? 0) >= ASK_LIMITS.PER_ROOM) {
      return "full"
    }

    const at = minuteOf(time)
    const ask: Ask = {
      id: this.newId(),
      text: cleaned,
      at,
      ...(signed === true ? { name: sender.username } : {}),
      state: "new",
    }

    this.seats.set(sender.clientId, {
      count: (seat?.count ?? 0) + 1,
      lastAt: time,
    })
    this.nonces.set(nonce, time)
    this.changed(() => {
      this.record ??= {
        id: this.newId(),
        gameSubject: this.opts.gameSubject,
        date: at,
        asks: [],
      }
      this.record.asks.push(ask)
    })

    return "accepted"
  }

  // `false` when the box was already that way: nothing changes, nothing is
  // sent.
  setOpen(open: boolean): boolean {
    if (this.open === open) {
      return false
    }

    this.changed(() => {
      this.open = open
    })

    return true
  }

  // An ask is marked seen or answered, never new again: that would raise the
  // room's count as if a question had just arrived.
  mark(askId: string, state: AskState): AskMarkOutcome {
    if (state !== "seen" && state !== "answered") {
      return "invalid"
    }

    const ask = this.record?.asks.find((entry) => entry.id === askId)

    if (!ask) {
      return "notFound"
    }

    if (ask.state !== state) {
      this.changed(() => {
        ask.state = state
      })
    }

    return "accepted"
  }

  // "Got it, all": every new ask is seen.
  markAll(): void {
    const fresh = this.record?.asks.filter((ask) => ask.state === "new") ?? []

    if (fresh.length === 0) {
      return
    }

    this.changed(() => {
      for (const ask of fresh) {
        ask.state = "seen"
      }
    })
  }

  remove(askId: string): AskMarkOutcome {
    const { record } = this
    const index = record?.asks.findIndex((ask) => ask.id === askId) ?? -1

    if (!record || index < 0) {
      return "notFound"
    }

    this.changed(() => {
      record.asks.splice(index, 1)
    })

    return "accepted"
  }

  // The room is closing, or the server is going down: a record that could
  // not be kept is offered once more.
  settle(): void {
    if (this.record && !this.saved) {
      this.saved = this.opts.save(copyRecord(this.record))
    }
  }

  // Applies a change, keeps the record, and says what moved.
  private changed(apply: () => void) {
    const before = this.count()
    const wasOpen = this.open

    apply()
    this.touched = true

    // Every change writes the whole record, so it is also the retry of a
    // write that failed before.
    if (this.record) {
      this.saved = this.opts.save(copyRecord(this.record))
    }

    const after = this.count()

    this.opts.onChanged({
      // The first change always counts: the host has been told nothing yet.
      count: before?.waiting !== after?.waiting || before?.open !== after?.open,
      box: wasOpen !== this.open,
    })
  }

  private forgetOldNonces(time: number) {
    for (const [nonce, acceptedAt] of this.nonces) {
      if (time - acceptedAt < ASK_LIMITS.NONCE_TTL_MS) {
        return
      }

      this.nonces.delete(nonce)
    }
  }
}
