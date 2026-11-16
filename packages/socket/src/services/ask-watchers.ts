import { EVENTS } from "@razzia/common/constants"
import type { AskLive } from "@razzia/common/types/ask"
import type { Socket } from "@razzia/common/types/game/socket"
import { listAskRecordMeta } from "@razzia/socket/services/ask-store"
import type Game from "@razzia/socket/services/game"
import { setAskRoomListener } from "@razzia/socket/services/game/ask-signal"
import manager from "@razzia/socket/services/manager"
import Registry from "@razzia/socket/services/registry"

const clientIdOf = (socket: Socket) => socket.handshake.auth.clientId as string

// Every live lecture room, with or without a record, and the records whose
// rooms are gone. `closing` is a room on its way out of the registry.
const liveNow = (closing?: string): AskLive => {
  const rooms = Registry.getInstance()
    .getAllGames()
    .filter((game) => game.gameId !== closing)
    .flatMap((game) => {
      const view = game.askView()

      return view ? [view] : []
    })
  const live = new Set(rooms.flatMap(({ record }) => record?.id ?? []))

  return { rooms, records: listAskRecordMeta(live) }
}

/**
 * The sockets watching the presenter's inbox: the only ones a question's text
 * or a name is ever sent to. A set rather than a Socket.IO room, because each
 * is checked before every message: a login that lapsed (or was logged out
 * elsewhere) is told `manager:unauthorized` and dropped, and a room cannot do
 * that. Checking does not refresh the login (`Manager.peek`).
 *
 * Watching never makes a socket a game's manager, and touches no game.
 */
class AskWatchers {
  private readonly sockets = new Map<string, Socket>()

  add(socket: Socket) {
    this.sockets.set(socket.id, socket)
  }

  drop(socket: Socket) {
    this.sockets.delete(socket.id)
  }

  has(socket: Socket): boolean {
    return this.sockets.has(socket.id)
  }

  count(): number {
    return this.sockets.size
  }

  private allowed(socket: Socket): boolean {
    if (manager.peek(clientIdOf(socket))) {
      return true
    }

    this.sockets.delete(socket.id)
    socket.emit(EVENTS.MANAGER.UNAUTHORIZED)

    return false
  }

  // The watchers still logged in; the others are told and dropped.
  private current(): Socket[] {
    return [...this.sockets.values()].filter((socket) => this.allowed(socket))
  }

  sendLive(socket: Socket) {
    if (this.allowed(socket)) {
      socket.emit(EVENTS.ASKS.LIVE, liveNow())
    }
  }

  // Nothing is read from the disk while nobody watches.
  sendLiveToAll(closing?: string) {
    const sockets = this.current()

    if (sockets.length === 0) {
      return
    }

    const live = liveNow(closing)

    for (const socket of sockets) {
      socket.emit(EVENTS.ASKS.LIVE, live)
    }
  }

  sendRoom(game: Game) {
    const sockets = this.current()
    const view = sockets.length ? game.askView() : null

    if (!view) {
      return
    }

    for (const socket of sockets) {
      socket.emit(EVENTS.ASKS.ROOM, view)
    }
  }

  // For tests.
  clear() {
    this.sockets.clear()
  }
}

export const askWatchers = new AskWatchers()

// A room opening or changing is sent as that room alone (an opening room is
// not in the registry yet); a room closing changes the list, so every watcher
// gets it whole.
setAskRoomListener({
  opened: (game) => {
    askWatchers.sendRoom(game)
  },
  changed: (game) => {
    askWatchers.sendRoom(game)
  },
  closed: (game) => {
    askWatchers.sendLiveToAll(game.gameId)
  },
})
