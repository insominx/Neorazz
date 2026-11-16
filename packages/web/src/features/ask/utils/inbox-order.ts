import type {
  AskLive,
  AskRecordMeta,
  AskRoomView,
} from "@razzia/common/types/ask"

export type InboxEntry =
  | { kind: "room"; room: AskRoomView }
  | { kind: "record"; meta: AskRecordMeta }

const timeOf = (date: string): number => {
  const time = new Date(date).getTime()

  return Number.isNaN(time) ? 0 : time
}

// Unread first, then live rooms, then earlier records.
const rank = (entry: InboxEntry): number => {
  const waiting =
    entry.kind === "room" ? entry.room.waiting : entry.meta.waiting

  if (waiting > 0) {
    return 0
  }

  return entry.kind === "room" ? 1 : 2
}

/**
 * The inbox's order: rooms and records with unread questions first, then the
 * live rooms, then the earlier records. Newest first within each: a live room
 * is newer than any record, and the server lists live rooms oldest first. So
 * unread questions from a room that was restarted stay at the top.
 */
export const inboxOrder = (live: AskLive): InboxEntry[] => {
  const rooms = live.rooms.map((room, index) => ({
    entry: { kind: "room", room } as InboxEntry,
    newness: Number.MAX_SAFE_INTEGER - live.rooms.length + index,
  }))
  const records = live.records.map((meta) => ({
    entry: { kind: "record", meta } as InboxEntry,
    newness: timeOf(meta.date),
  }))

  return [...rooms, ...records]
    .sort((a, b) => rank(a.entry) - rank(b.entry) || b.newness - a.newness)
    .map(({ entry }) => entry)
}
