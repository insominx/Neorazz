import type { AskBox, AskOutcome } from "@razzia/common/types/ask"
import {
  type AskDraft,
  EMPTY_DRAFT,
  loadDraft,
  saveDraft,
} from "@razzia/web/features/ask/utils/draft"
import { create } from "zustand"

// What a phone's own send came to: the server's outcome, or `noAck` when no
// answer came in time.
export type AskSendResult = AskOutcome | "noAck"

interface AskStore {
  // The room's box as the server last told this phone, or `null` before it
  // has (and for a phone that is not in a lecture room).
  box: AskBox | null
  // Whether the footer offers the button now (`canAsk`).
  offered: boolean
  sheetOpen: boolean
  draft: AskDraft
  sending: boolean
  // The line shown after a send, until the draft changes or the sheet is
  // closed by hand.
  result: AskSendResult | null
  // Bumped by the game page each time the server reattaches this phone, so
  // the lane asks for the box again: a pause it missed while away.
  reconnects: number

  setBox: (_box: AskBox | null) => void
  setOffered: (_offered: boolean) => void
  openSheet: () => void
  // `byHand`: the person closed it, so the last line goes too.
  closeSheet: (_byHand?: boolean) => void
  editDraft: (_change: Partial<Pick<AskDraft, "text" | "signed">>) => void
  setDraft: (_draft: AskDraft) => void
  clearDraft: () => void
  setSending: (_sending: boolean) => void
  setResult: (_result: AskSendResult | null) => void
  noteReconnect: () => void
  // Leaving the game: the box and the sheet go, the draft stays in the tab.
  reset: () => void
}

export const useAskStore = create<AskStore>((set) => ({
  box: null,
  offered: false,
  sheetOpen: false,
  draft: loadDraft(),
  sending: false,
  result: null,
  reconnects: 0,

  setBox: (box) => set({ box }),
  setOffered: (offered) => set({ offered }),
  openSheet: () => set({ sheetOpen: true }),
  closeSheet: (byHand = false) =>
    set(byHand ? { sheetOpen: false, result: null } : { sheetOpen: false }),
  editDraft: (change) =>
    set((state) => {
      const draft = { ...state.draft, ...change }

      saveDraft(draft)

      return { draft, result: null }
    }),
  setDraft: (draft) => {
    saveDraft(draft)
    set({ draft })
  },
  setSending: (sending) => set({ sending }),
  setResult: (result) => set({ result }),
  noteReconnect: () => set((state) => ({ reconnects: state.reconnects + 1 })),
  clearDraft: () => {
    saveDraft(EMPTY_DRAFT)
    set({ draft: EMPTY_DRAFT })
  },
  reset: () =>
    set({ box: null, offered: false, sheetOpen: false, sending: false }),
}))
