import type { AskLive, AskRecord, AskRoomView } from "@razzia/common/types/ask"
import { create } from "zustand"

// The presenter's inbox, in memory only: nothing here is ever written to the
// browser's storage, and a lost login or a closed page takes it all away.

interface InboxStore {
  // What the server last sent, or `null` before the first word.
  live: AskLive | null
  // The server does not know this login (`manager:unauthorized`).
  needsLogin: boolean
  // **Show questions** was pressed and the page has not been left since.
  revealed: boolean
  // Earlier records opened in full, by id.
  opened: Partial<Record<string, AskRecord>>

  setLive: (_live: AskLive) => void
  upsertRoom: (_room: AskRoomView) => void
  setOpened: (_id: string, _record: AskRecord | null) => void
  reveal: () => void
  curtain: () => void
  loggedOut: () => void
  loggedIn: () => void
  reset: () => void
}

const empty = {
  live: null,
  needsLogin: false,
  revealed: false,
  opened: {} as Partial<Record<string, AskRecord>>,
}

export const useInboxStore = create<InboxStore>((set) => ({
  ...empty,

  // A room that has closed becomes an earlier record. If this page had its
  // questions, they stay open there, so the list does not fold up under the
  // presenter's hands (a Restart quiz, for one).
  setLive: (live) =>
    set((state) => {
      const listed = new Set(live.records.map(({ id }) => id))
      const opened: Partial<Record<string, AskRecord>> = {}

      for (const [id, record] of Object.entries(state.opened)) {
        if (record && listed.has(id)) {
          opened[id] = record
        }
      }

      for (const room of state.live?.rooms ?? []) {
        if (room.record && listed.has(room.record.id)) {
          opened[room.record.id] ??= room.record
        }
      }

      return { live, opened }
    }),

  upsertRoom: (room) =>
    set((state) => {
      const rooms = state.live?.rooms ?? []
      const others = rooms.filter(({ gameId }) => gameId !== room.gameId)
      const at = rooms.findIndex(({ gameId }) => gameId === room.gameId)
      const next =
        at < 0
          ? [...rooms, room]
          : [...others.slice(0, at), room, ...others.slice(at)]

      return {
        live: { rooms: next, records: state.live?.records ?? [] },
      }
    }),

  setOpened: (id, record) =>
    set((state) => {
      const { [id]: _dropped, ...rest } = state.opened

      return { opened: record ? { ...rest, [id]: record } : rest }
    }),

  reveal: () => set({ revealed: true }),
  curtain: () => set({ revealed: false }),
  loggedOut: () => set({ ...empty, needsLogin: true }),
  loggedIn: () => set({ needsLogin: false }),
  reset: () => set(empty),
}))
