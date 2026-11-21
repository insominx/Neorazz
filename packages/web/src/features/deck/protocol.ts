import type { Status } from "@razzia/common/types/game/status"
import type { AskRoomView } from "@razzia/common/types/ask"

import { z } from "zod"

// The messages a page that embeds this one (a slide deck, a class site, any
// web app) and this page exchange with postMessage. This file is the source of
// the public contract: docs/embedding.md documents it and
// public/neorazz-embed.js speaks it, so change all three together
// (embedding-docs.test.ts checks the docs against this file).

// The `source` an embedding page puts on every message.
export const EMBED_SOURCE = "neorazz-embed"

// The tag the first lecture decks used, before embedding was documented. Still
// read, so those decks keep working; new pages use EMBED_SOURCE.
export const DECK_SOURCE = "cst426-deck"

export const EMBED_SOURCES = [EMBED_SOURCE, DECK_SOURCE] as const

// The `source` on every message this page sends back. The old name stays, as
// the other identifiers do (ADR 0008), so pages that check it keep working.
export const BRIDGE_SOURCE = "razzia-bridge"

export const PROTOCOL_VERSION = 1

const envelope = {
  source: z.enum(EMBED_SOURCES),
  v: z.literal(PROTOCOL_VERSION),
}

const pollTarget = {
  pollId: z.string().max(64).optional(),
  gameId: z.string().max(200).optional(),
}

const deckCommandSchema = z.discriminatedUnion("type", [
  z.object({ ...envelope, type: z.literal("hello") }),
  // The presenter's drawer (`presenterInbox`, ADR 0007). `open: true` asks for
  // the attached room's waiting questions, sent as `inbox` messages until
  // `open: false`; the wish outlives reconnects and room changes.
  z.object({ ...envelope, type: z.literal("inbox"), open: z.boolean() }),
  // Got it: one waiting question, or all of them, become seen.
  z.object({
    ...envelope,
    type: z.literal("markAsk"),
    askId: z.string().min(1).max(64),
  }),
  z.object({ ...envelope, type: z.literal("markAllAsks") }),
  // Pause or resume this room's question box only. Unlike `askBox`, nothing
  // is held for the next room.
  z.object({ ...envelope, type: z.literal("askOpen"), open: z.boolean() }),
  z.object({
    ...envelope,
    type: z.literal("ensureGame"),
    quiz: z.string().min(1).max(200),
    // "always" closes the game it hosts and opens a fresh lobby.
    restart: z.enum(["ifFinished", "always"]).optional(),
  }),
  // Closes the lecture game; nothing opens again until the next ensureGame.
  z.object({
    ...envelope,
    type: z.literal("close"),
    quiz: z.string().min(1).max(200),
  }),
  z.object({
    ...envelope,
    type: z.literal("play"),
    question: z.number().int().min(0),
  }),
  z.object({ ...envelope, type: z.literal("leaderboard") }),
  z.object({ ...envelope, type: z.literal("finish") }),
  // Shows a played question's results again in place of the game's own
  // screen, or (null) goes back to it. The game itself does not change.
  z.object({
    ...envelope,
    type: z.literal("review"),
    question: z.number().int().min(0).nullable(),
  }),
  z.object({
    ...envelope,
    type: z.literal("visibility"),
    visible: z.boolean(),
  }),
  // The deck drives the game, so Razzia's own buttons show only when the
  // presenter asks for them (the deck's Q key).
  z.object({
    ...envelope,
    type: z.literal("controls"),
    shown: z.boolean(),
  }),
  // What is behind the quiz: its own night-sky backdrop ("own", the default),
  // or nothing, so the slide the page sits on shows through ("slide").
  z.object({
    ...envelope,
    type: z.literal("backdrop"),
    mode: z.enum(["own", "slide"]),
  }),
  // The deck draws the sound button, since the frame takes no clicks while the
  // deck drives it. Either field may come alone; a volume also unmutes, as the
  // slider does.
  z.object({
    ...envelope,
    type: z.literal("sound"),
    muted: z.boolean().optional(),
    volume: z.number().min(0).max(1).optional(),
  }),
  // A poll typed on the slide, started in the lobby or between questions. The
  // server holds the rules (limits, a slug for the id) and answers `invalid`
  // to a definition that fails them; this is only the shape a message needs
  // to be read at all. Poll commands are never queued.
  z.object({
    ...envelope,
    type: z.literal("startPoll"),
    poll: z.object({
      id: z.string(),
      question: z.string(),
      options: z.array(z.string()).max(20),
      anonymous: z.boolean().optional(),
      live: z.boolean().optional(),
    }),
  }),
  // Ends voting and shows the result. A deck names the poll it means
  // (`pollId`) and the game it saw (`gameId`), so a late one cannot touch the
  // next poll or the next room; either one that does not match answers
  // `notCurrent` and changes nothing.
  z.object({ ...envelope, type: z.literal("closePoll"), ...pollTarget }),
  // Takes the result away and gives the room back to the quiz.
  z.object({ ...envelope, type: z.literal("dismissPoll"), ...pollTarget }),
  // Opens a deck poll that closed in this room again, with its votes: in
  // place while its result is on the stage, or back onto the stage. The next
  // close replaces the result the last one saved (`pollReopen`).
  z.object({
    ...envelope,
    type: z.literal("reopenPoll"),
    pollId: z.string().max(64),
    gameId: z.string().max(200).optional(),
  }),
  // Shows a poll that closed in this room again, as it was left, in place of
  // the stage, or (null) stops. Only this page changes: the room, its stage and
  // the phones do not.
  z.object({
    ...envelope,
    type: z.literal("reviewPoll"),
    id: z.string().max(64).nullable(),
  }),
  // The room's question box. `false` is held by this page and applied to every
  // room it becomes the manager of; `true` opens it once and drops the hold.
  // There is no reply: the deck reads `asks.open` in a later status.
  z.object({
    ...envelope,
    type: z.literal("askBox"),
    open: z.boolean(),
  }),
])

export type DeckCommand = z.infer<typeof deckCommandSchema>

// Every command this build reads, in the order above.
export const COMMAND_TYPES: ReadonlyArray<DeckCommand["type"]> =
  deckCommandSchema.options.map((option) => option.shape.type.value)

export type RoundCommand = Extract<
  DeckCommand,
  { type: "play" | "leaderboard" | "finish" }
>

export type PollCommand = Extract<
  DeckCommand,
  { type: "startPoll" | "closePoll" | "dismissPoll" | "reopenPoll" }
>

export const parseDeckCommand = (data: unknown): DeckCommand | null => {
  const result = deckCommandSchema.safeParse(data)

  return result.success ? result.data : null
}

export const isRoundCommand = (command: DeckCommand): command is RoundCommand =>
  command.type === "play" ||
  command.type === "leaderboard" ||
  command.type === "finish"

// A start that is not even shaped like one (a field of the wrong type, a list
// that is far too long) is dropped by `parseDeckCommand`. The deck still gets an
// answer, so it can say why nothing opened; other malformed messages stay
// unanswered, as before.
export const isPollStart = (data: unknown): boolean => {
  const fields =
    typeof data === "object" ? (data as Record<string, unknown> | null) : null

  return (
    (EMBED_SOURCES as readonly unknown[]).includes(fields?.source) &&
    fields?.v === PROTOCOL_VERSION &&
    fields.type === "startPoll"
  )
}

export const isPollCommand = (command: DeckCommand): command is PollCommand =>
  command.type === "startPoll" ||
  command.type === "closePoll" ||
  command.type === "dismissPoll" ||
  command.type === "reopenPoll"

// What this build can do, so a deck can tell an older Razzia by its absence.
// A name is listed only once it is built.
// `pollReview`: reviewPoll, named close and dismiss, a deck poll that runs
// once per room and takes the stage straight from a closed result.
// `sound`: the `sound` command and `BridgeState.sound`; Razzia's own sound
// button then shows only with its other controls (the deck's Q key).
// `pollAfterPodium`: a lecture room still runs polls, and lets newcomers in,
// once its final standings have shown.
// `asks`: the room's private question box: `BridgeState.asks` (a count and
// whether phones can send, never a question or a name) and the `askBox`
// command.
export const FEATURES: readonly string[] = [
  "poll",
  "pollInline",
  "pollReview",
  "sound",
  "pollAfterPodium",
  "asks",
  // `presenterInbox`: the `inbox`, `markAsk`, `markAllAsks` and `askOpen`
  // commands and the `inbox` message: the attached room's waiting questions,
  // only while the deck asks (ADR 0007).
  "presenterInbox",
  // `pollReopen`: the `reopenPoll` command. A closed deck poll opens again
  // with its votes, and its next close replaces the saved result.
  "pollReopen",
]

// One waiting question, as the presenter's drawer draws it.
export interface BridgeAsk {
  id: string
  text: string
  // The minute it arrived (ISO).
  at: string
  name?: string
}

// The attached room's waiting questions, oldest first, at most 50; `total` is
// how many are waiting in all.
export interface BridgeInbox {
  gameId: string
  open: boolean
  total: number
  asks: BridgeAsk[]
}

export const INBOX_LIMIT = 50

export const toBridgeInbox = (room: AskRoomView): BridgeInbox => {
  const waiting = (room.record?.asks ?? []).filter((ask) => ask.state === "new")

  return {
    gameId: room.gameId,
    open: room.open,
    total: waiting.length,
    asks: waiting.slice(0, INBOX_LIMIT).map((ask) => ({
      id: ask.id,
      text: ask.text,
      at: ask.at,
      ...(ask.name ? { name: ask.name } : {}),
    })),
  }
}

// The poll showing on the stage. Never a name, whatever the poll.
export interface BridgePoll {
  id: string
  phase: "open" | "closed"
  anonymous: boolean
  live: boolean
  // Votes cast. Players are already in `BridgeState.players`.
  voted: number
  // Present once the poll has closed, or while it is open if it is live.
  counts?: number[]
}

// A poll that closed in this room.
export interface BridgePollDone {
  id: string
  counts: number[]
  total: number
  partial?: boolean
}

export interface BridgeState {
  connected: boolean
  loggedIn: boolean | null
  pending: "resume" | "create" | "login" | null
  reattaching: boolean
  gameId: string | null
  inviteCode: string | null
  lecture: boolean
  screen: Status | null
  answeringOpen: boolean
  question: number | null
  total: number | null
  played: number[]
  finished: boolean
  players: number
  // Current-room presence; absent until the host has an authoritative roster.
  connectedPlayers?: number
  visible: boolean
  // The question whose results are on screen for a review, and the questions
  // whose results this page has seen and can show again.
  reviewing: number | null
  reviewable: number[]
  // The closed poll whose result is shown again (`reviewPoll`), or null.
  reviewingPoll: string | null
  // Always sent by this build; an older one sends none of the three, which is
  // how a deck tells them apart.
  features: string[]
  // Null when polls are supported and none is showing.
  poll: BridgePoll | null
  // Polls that closed in this room, oldest first, at most 50.
  pollsDone: BridgePollDone[]
  // The host's sound setting, for the deck's own button. Not the silence the
  // deck asks for while it hides this page.
  sound: { muted: boolean; volume: number }
  // The room's question box while this page is attached to a lecture room:
  // how many new questions (0 to 10, where 10 is "9+") and whether phones can
  // send. Null otherwise. Never a question's text, a name or a record.
  asks: BridgeAsks | null
}

export interface BridgeAsks {
  waiting: number
  open: boolean
}

// A login the page needs shows as `pending: "login"` in the state, not as an
// error.
export const BRIDGE_ERROR_CODES = [
  "notLectureGame",
  "quizNotFound",
  "noPlayers",
  "gameExpired",
  "reattachFailed",
  "pollInvalid",
  "noAck",
] as const

export type BridgeErrorCode = (typeof BRIDGE_ERROR_CODES)[number]

// Every message type this page sends (`BridgeMessageBody["type"]`).
export const MESSAGE_TYPES = [
  "ready",
  "status",
  "result",
  "error",
  "key",
  "inbox",
] as const

export type BridgeMessageBody =
  | { type: "inbox"; room: BridgeInbox | null }
  | { type: "ready" | "status"; state: BridgeState }
  | {
      type: "result"
      command: DeckCommand["type"]
      outcome: "accepted" | "queued" | "ignored"
      reason?: string
    }
  | { type: "error"; code: BridgeErrorCode; command?: DeckCommand["type"] }
  | { type: "key"; key: string; code: string; repeat: boolean }

export type BridgeMessage = BridgeMessageBody & {
  source: typeof BRIDGE_SOURCE
  v: typeof PROTOCOL_VERSION
}

// Keys that move the deck. Sent on to the deck while this frame has focus,
// so a clicker keeps working after a click into the host page.
export const FORWARDED_KEYS: ReadonlySet<string> = new Set([
  "PageDown",
  "PageUp",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  " ",
  "Home",
  "End",
  "Escape",
  "q",
  "Q",
])

const TEXT_ENTRY_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"])

interface KeyLike {
  key: string
  code: string
  repeat: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing: boolean
  target: EventTarget | null
}

const isTextEntry = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || TEXT_ENTRY_TAGS.has(target.tagName))

// A dialog (the kick confirmation) owns the keys while it is open: Escape
// closes it and Space presses its buttons. The poll frame is a dialog too, but
// it has no keys of its own and the deck drives it, so it hands them back
// (`data-deck-keys`); otherwise Q and the forward keys would stop reaching the
// deck after a click in the frame.
const isInDialog = (target: EventTarget | null): boolean => {
  const dialog =
    target instanceof Element
      ? target.closest('[role="dialog"],[role="alertdialog"]')
      : null

  return dialog !== null && !dialog.hasAttribute("data-deck-keys")
}

export const toForwardedKey = (
  event: KeyLike,
): { key: string; code: string; repeat: boolean } | null => {
  if (
    !FORWARDED_KEYS.has(event.key) ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.isComposing ||
    isTextEntry(event.target) ||
    isInDialog(event.target)
  ) {
    return null
  }

  return { key: event.key, code: event.code, repeat: event.repeat }
}
