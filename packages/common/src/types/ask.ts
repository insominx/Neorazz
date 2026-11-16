// An ask is a question someone in the room types on their phone for the
// presenter alone. It runs beside the quiz and the polls in a lecture room and
// never touches either. The code says "ask" because "question" already means a
// quiz question; the people in the room read "question".
//
// The text and any name go only to the presenter's inbox. The room, the host
// page and the deck learn a capped count and whether the box is open.

export type AskState = "new" | "seen" | "answered"

export interface Ask {
  // Random, made by the server, never time-ordered: an id must not say when
  // the ask arrived more precisely than `at` does.
  id: string
  // 1 to 500 characters after cleaning.
  text: string
  // When it arrived, rounded down to the minute (ISO).
  at: string
  // Signed asks only: the seat's join name, from the server's player record.
  name?: string
  state: AskState
}

// One room's asks: `config/asks/<id>.json`, created on the room's first ask.
export interface AskRecord {
  // Random, made by the server, never the game id.
  id: string
  gameSubject: string
  // The first ask's `at`.
  date: string
  // In the order they arrived.
  asks: Ask[]
}

export type AskOutcome =
  | "accepted"
  | "notLecture"
  | "notPlayer"
  | "closed"
  | "invalid"
  | "tooFast"
  | "tooMany"
  | "full"

// What a phone learns: whether it can send.
export interface AskBox {
  open: boolean
}

// What the host page and the deck learn. `waiting` is the room's new asks,
// capped at 10, which a screen draws as "9+".
export interface AskCount {
  waiting: number
  open: boolean
}

export type AskBoxOutcome = "accepted" | "notLecture" | "notManager" | "invalid"

// ── The presenter's inbox: only for sockets with a manager login ────────────

// A live lecture room, as the inbox sees it.
export interface AskRoomView {
  gameId: string
  inviteCode: string
  gameSubject: string
  open: boolean
  // The true number of new asks, not capped.
  waiting: number
  // False while the room's latest change is not on disk.
  saved: boolean
  // Null until the room's first ask.
  record: AskRecord | null
}

// An earlier record (its room is gone), without any text.
export interface AskRecordMeta {
  id: string
  gameSubject: string
  date: string
  total: number
  waiting: number
  answered: number
}

export interface AskLive {
  rooms: AskRoomView[]
  records: AskRecordMeta[]
}

export type AskActionOutcome =
  | "accepted"
  | "unauthorized"
  | "invalid"
  | "notFound"
  | "live"
  | "failed"

export type AskRecordReply =
  | { outcome: "accepted"; record: AskRecord }
  | { outcome: "unauthorized" | "invalid" | "notFound" }
