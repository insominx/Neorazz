import { z } from "zod"

export const ASK_LIMITS = {
  // Characters of text, after cleaning.
  TEXT: 500,
  // Anything longer is refused before it is cleaned, to bound the work.
  RAW_TEXT: 4_000,
  // One accepted ask per seat this often.
  SPACING_MS: 15_000,
  // Accepted asks per seat in one room.
  PER_SEAT: 10,
  // Asks a room holds: a memory bound. A seat costs nothing to invent, so the
  // seat limits are a speed bump and the presenter's pause is the defence.
  PER_ROOM: 500,
  // How long a draft's nonce is remembered once its ask was accepted.
  NONCE_TTL_MS: 30 * 60_000,
  // The most the room is ever told is waiting: 10 means ten or more, "9+".
  WAITING_CAP: 10,
} as const

// A draft's nonce: random, made by the phone, kept until the draft is sent.
export const ASK_NONCE = /^[A-Za-z0-9_-]{8,64}$/u

// Control characters other than the line break, and the marks that reorder
// how text reads (bidirectional embeddings, overrides and isolates), so a
// question cannot hide or rearrange itself in the inbox. The controls are
// matched on purpose, written as escapes.
const UNWANTED =
  // oxlint-disable-next-line no-control-regex
  /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/gu

/**
 * An ask's text as it is kept, or `null` when it cannot be one: not a string,
 * too long to read, empty or over 500 characters once cleaned. Line breaks are
 * kept; a tab becomes a space.
 */
export const cleanAskText = (raw: unknown): string | null => {
  if (typeof raw !== "string" || raw.length > ASK_LIMITS.RAW_TEXT) {
    return null
  }

  const text = raw
    .replace(/\r\n?/gu, "\n")
    .replace(/\t/gu, " ")
    .replace(UNWANTED, "")
    .trim()

  return text.length > 0 && text.length <= ASK_LIMITS.TEXT ? text : null
}

export const isAskNonce = (value: unknown): value is string =>
  typeof value === "string" && ASK_NONCE.test(value)

/** What the room is told is waiting: at most 10, drawn as "9+". */
export const capWaiting = (waiting: number): number =>
  Math.min(Math.max(0, waiting), ASK_LIMITS.WAITING_CAP)

/** An ask's time: the minute it arrived in, so a log cannot pin it closer. */
export const minuteOf = (time: number): string =>
  new Date(Math.floor(time / 60_000) * 60_000).toISOString()

const askValidator = z.object({
  id: z.string().min(1),
  text: z.string(),
  at: z.string(),
  name: z.string().optional(),
  state: z.enum(["new", "seen", "answered"]),
})

/**
 * A record as read from disk. Only the known fields survive, so a file that
 * was edited by hand cannot carry anything else to the inbox.
 */
export const askRecordValidator = z.object({
  id: z.string().min(1),
  gameSubject: z.string(),
  date: z.string(),
  asks: z.array(askValidator),
})
