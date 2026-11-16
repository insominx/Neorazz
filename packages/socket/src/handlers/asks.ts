import { EVENTS } from "@razzia/common/constants"
import type {
  AskActionOutcome,
  AskRecord,
  AskRecordReply,
} from "@razzia/common/types/ask"
import { ackOf, fieldsOf, textOf } from "@razzia/socket/handlers/payload"
import type { SocketContext } from "@razzia/socket/handlers/types"
import {
  type AskFileOutcome,
  deleteAskRecord,
  editAskRecord,
  getAskRecordById,
} from "@razzia/socket/services/ask-store"
import { askWatchers } from "@razzia/socket/services/ask-watchers"
import manager from "@razzia/socket/services/manager"
import Registry from "@razzia/socket/services/registry"
import { isSafeId } from "@razzia/socket/utils/safe"

type Mark = "seen" | "answered"

// An id from the client names a file or an ask: a plain name, or nothing.
const idOf = (value: unknown): string | undefined => {
  const id = textOf(value)

  return id !== undefined && isSafeId(id) && id.length <= 64 ? id : undefined
}

const markOf = (value: unknown): Mark | undefined =>
  value === "seen" || value === "answered" ? value : undefined

// The edits the inbox makes to an earlier record, read from its file.
const marked =
  (askId: string, state: Mark) =>
  (record: AskRecord): AskRecord | AskFileOutcome => {
    if (!record.asks.some((ask) => ask.id === askId)) {
      return "notFound"
    }

    return {
      ...record,
      asks: record.asks.map((ask) =>
        ask.id === askId ? { ...ask, state } : ask,
      ),
    }
  }

const allSeen = (record: AskRecord): AskRecord => ({
  ...record,
  asks: record.asks.map((ask) =>
    ask.state === "new" ? { ...ask, state: "seen" } : ask,
  ),
})

const without =
  (askId: string) =>
  (record: AskRecord): AskRecord | AskFileOutcome =>
    record.asks.some((ask) => ask.id === askId)
      ? { ...record, asks: record.asks.filter((ask) => ask.id !== askId) }
      : "notFound"

/**
 * The presenter's question inbox. Every event needs the manager login; an
 * action is an ordinary authorized call, so it refreshes the login like any
 * other. Watching is checked again before each message (`askWatchers`).
 *
 * A record id that belongs to a live room acts on the room's own record in
 * memory, which writes through; any other acts on the file.
 */
export const asksSocketHandlers = ({ socket }: SocketContext) => {
  const registry = Registry.getInstance()

  const authorized = (reply?: (_outcome: "unauthorized") => void) => {
    if (manager.isLogged(socket)) {
      return true
    }

    socket.emit(EVENTS.MANAGER.UNAUTHORIZED)
    reply?.("unauthorized")

    return false
  }

  const liveRoomOf = (recordId: string) =>
    registry.getAllGames().find((game) => game.askRecordId() === recordId)

  // An earlier record changed: every watcher gets the list again.
  const fileChanged = (outcome: AskFileOutcome): AskActionOutcome => {
    if (outcome === "accepted") {
      askWatchers.sendLiveToAll()
    }

    return outcome
  }

  socket.on(EVENTS.ASKS.WATCH, () => {
    if (!authorized()) {
      return
    }

    askWatchers.add(socket)
    askWatchers.sendLive(socket)
  })

  socket.on(EVENTS.ASKS.UNWATCH, () => {
    askWatchers.drop(socket)
  })

  // Logging out on this socket ends its watch; a logout elsewhere is caught
  // before the next message.
  socket.on(EVENTS.MANAGER.LOGOUT, () => {
    if (askWatchers.has(socket)) {
      askWatchers.drop(socket)
      socket.emit(EVENTS.MANAGER.UNAUTHORIZED)
    }
  })

  socket.on("disconnect", () => {
    askWatchers.drop(socket)
  })

  socket.on(EVENTS.ASKS.MARK, (message, ack) => {
    const reply = ackOf(ack)

    if (!authorized(reply)) {
      return
    }

    const fields = fieldsOf(message)
    const recordId = idOf(fields.recordId)
    const askId = idOf(fields.askId)
    const state = markOf(fields.state)

    if (!recordId || !askId || !state) {
      reply?.("invalid")

      return
    }

    const room = liveRoomOf(recordId)

    reply?.(
      room
        ? room.markAsk(askId, state)
        : fileChanged(editAskRecord(recordId, marked(askId, state))),
    )
  })

  socket.on(EVENTS.ASKS.MARK_ALL, (message, ack) => {
    const reply = ackOf(ack)

    if (!authorized(reply)) {
      return
    }

    const recordId = idOf(fieldsOf(message).recordId)

    if (!recordId) {
      reply?.("invalid")

      return
    }

    const room = liveRoomOf(recordId)

    if (room) {
      room.markAllAsks()
      reply?.("accepted")

      return
    }

    reply?.(fileChanged(editAskRecord(recordId, allSeen)))
  })

  socket.on(EVENTS.ASKS.REMOVE, (message, ack) => {
    const reply = ackOf(ack)

    if (!authorized(reply)) {
      return
    }

    const fields = fieldsOf(message)
    const recordId = idOf(fields.recordId)
    const askId = idOf(fields.askId)

    if (!recordId || !askId) {
      reply?.("invalid")

      return
    }

    const room = liveRoomOf(recordId)

    reply?.(
      room
        ? room.removeAsk(askId)
        : fileChanged(editAskRecord(recordId, without(askId))),
    )
  })

  socket.on(EVENTS.ASKS.SET_OPEN, (message, ack) => {
    const reply = ackOf(ack)

    if (!authorized(reply)) {
      return
    }

    const fields = fieldsOf(message)
    const gameId = textOf(fields.gameId)

    if (gameId === undefined || typeof fields.open !== "boolean") {
      reply?.("invalid")

      return
    }

    const game = registry.getGameById(gameId)

    reply?.(game?.setAskOpen(fields.open) ? "accepted" : "notFound")
  })

  socket.on(EVENTS.ASKS.RECORD_GET, (message, ack) => {
    const reply = ackOf(ack) as ((_reply: AskRecordReply) => void) | undefined

    if (!authorized(() => reply?.({ outcome: "unauthorized" }))) {
      return
    }

    const recordId = idOf(fieldsOf(message).recordId)

    if (!recordId) {
      reply?.({ outcome: "invalid" })

      return
    }

    const live = liveRoomOf(recordId)?.getAskRecord()

    if (live) {
      reply?.({ outcome: "accepted", record: live })

      return
    }

    try {
      reply?.({ outcome: "accepted", record: getAskRecordById(recordId) })
    } catch {
      reply?.({ outcome: "notFound" })
    }
  })

  // A live room's record cannot be deleted: its next change would write it
  // back.
  socket.on(EVENTS.ASKS.RECORD_DELETE, (message, ack) => {
    const reply = ackOf(ack)

    if (!authorized(reply)) {
      return
    }

    const recordId = idOf(fieldsOf(message).recordId)

    if (!recordId) {
      reply?.("invalid")

      return
    }

    if (liveRoomOf(recordId)) {
      reply?.("live")

      return
    }

    reply?.(fileChanged(deleteAskRecord(recordId)))
  })
}
