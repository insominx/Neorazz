import { v4 as randomId } from "uuid"

// A question being written, kept in this tab's session storage until it is
// sent: a phone that sleeps, reloads or loses its connection keeps it. It is
// the writer's own text on their own phone; nothing else is kept.
export interface AskDraft {
  text: string
  // "Add my name": off for a new draft, kept with the draft until it is sent.
  signed: boolean
  // The nonce of the last send of this draft, and what that send carried. A
  // send of the same text and switch reuses it, so the server can tell a
  // repeat after a lost reply from a new question; an edit after a send gets
  // a new one, so the edit is never taken for a repeat.
  nonce?: string
  sentText?: string
  sentSigned?: boolean
}

export const DRAFT_KEY = "razzia_ask_draft"

export const EMPTY_DRAFT: AskDraft = { text: "", signed: false }

const storage = (): Storage | null => {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export const loadDraft = (): AskDraft => {
  try {
    const raw = storage()?.getItem(DRAFT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null

    if (typeof parsed !== "object" || parsed === null) {
      return EMPTY_DRAFT
    }

    const { text, signed, nonce, sentText, sentSigned } = parsed as Record<
      string,
      unknown
    >

    return {
      text: typeof text === "string" ? text : "",
      signed: signed === true,
      ...(typeof nonce === "string" ? { nonce } : {}),
      ...(typeof sentText === "string" ? { sentText } : {}),
      ...(typeof sentSigned === "boolean" ? { sentSigned } : {}),
    }
  } catch {
    return EMPTY_DRAFT
  }
}

// Refused storage (a private window) only loses the draft on a reload.
export const saveDraft = (draft: AskDraft): void => {
  try {
    if (draft.text === "" && !draft.signed && !draft.nonce) {
      storage()?.removeItem(DRAFT_KEY)
    } else {
      storage()?.setItem(DRAFT_KEY, JSON.stringify(draft))
    }
  } catch {
    // Nothing to do: the draft still lives in memory.
  }
}

// A random id (never time-ordered), in the shape the server takes.
export const newNonce = (): string => randomId()

/** The draft as it goes out: with the nonce its text and switch call for. */
export const draftForSend = (draft: AskDraft): AskDraft & { nonce: string } =>
  draft.nonce &&
  draft.sentText === draft.text &&
  draft.sentSigned === draft.signed
    ? { ...draft, nonce: draft.nonce }
    : {
        ...draft,
        nonce: newNonce(),
        sentText: draft.text,
        sentSigned: draft.signed,
      }
