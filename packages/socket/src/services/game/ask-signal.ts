import type Game from "@razzia/socket/services/game"

// How a lecture room tells the presenter's inbox that its questions changed,
// without the room importing the inbox's watchers (which need the manager's
// logins and the disk, and which many room tests replace or leave out). The
// watchers register here when they load; with none registered, nothing
// happens.
//
// A room announces itself when it opens: it is not in the registry yet at that
// moment, so the watchers cannot find it there.

export interface AskRoomListener {
  opened: (_game: Game) => void
  changed: (_game: Game) => void
  closed: (_game: Game) => void
}

let listener: AskRoomListener | null = null

export const setAskRoomListener = (next: AskRoomListener | null): void => {
  listener = next
}

// The inbox is told after the change has happened; a failure there must not
// undo it or reach the sender. The log names no question and no person.
const tell = (call: (_listener: AskRoomListener) => void) => {
  if (!listener) {
    return
  }

  try {
    call(listener)
  } catch (error) {
    console.error(
      "Failed to tell the question inbox:",
      error instanceof Error ? error.name : "unknown error",
    )
  }
}

export const askRoomSignal = {
  opened: (game: Game) => {
    tell((l) => l.opened(game))
  },
  changed: (game: Game) => {
    tell((l) => l.changed(game))
  },
  closed: (game: Game) => {
    tell((l) => l.closed(game))
  },
}
