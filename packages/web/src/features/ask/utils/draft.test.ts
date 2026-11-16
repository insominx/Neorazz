import { ASK_NONCE } from "@razzia/common/validators/ask"
import {
  DRAFT_KEY,
  draftForSend,
  EMPTY_DRAFT,
  loadDraft,
  saveDraft,
} from "@razzia/web/features/ask/utils/draft"
import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  window.sessionStorage.clear()
  vi.restoreAllMocks()
})

describe("the draft in session storage", () => {
  it("starts empty and unsigned", () => {
    expect(loadDraft()).toEqual(EMPTY_DRAFT)
  })

  it("keeps the text, the switch and the nonce until it is cleared", () => {
    const draft = {
      text: "Why?",
      signed: true,
      nonce: "abcd-1234",
      sentText: "Why?",
      sentSigned: true,
    }

    saveDraft(draft)
    expect(loadDraft()).toEqual(draft)

    saveDraft(EMPTY_DRAFT)
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("reads anything it did not write as an empty draft", () => {
    for (const raw of [
      "{ broken",
      "42",
      "null",
      '{"text": 7, "signed": "yes"}',
    ]) {
      window.sessionStorage.setItem(DRAFT_KEY, raw)

      expect(loadDraft()).toEqual(EMPTY_DRAFT)
    }
  })

  it("lives without storage, as in a private window", () => {
    // The storage the page really has, whatever its class.
    const proto = Object.getPrototypeOf(window.sessionStorage) as Storage

    vi.spyOn(proto, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError")
    })
    vi.spyOn(proto, "getItem").mockImplementation(() => {
      throw new Error("SecurityError")
    })

    expect(() => {
      saveDraft({ text: "Why?", signed: false })
    }).not.toThrow()
    expect(loadDraft()).toEqual(EMPTY_DRAFT)
  })
})

describe("the nonce a send carries", () => {
  it("is minted for the first send, random and in the server's shape", () => {
    const first = draftForSend({ text: "Why?", signed: false })
    const other = draftForSend({ text: "Why?", signed: false })

    expect(first.nonce).toMatch(ASK_NONCE)
    expect(first.nonce).not.toBe(other.nonce)
    expect(first).toMatchObject({ sentText: "Why?", sentSigned: false })
  })

  it("is kept for a send of the same text and switch, as after a lost reply", () => {
    const first = draftForSend({ text: "Why?", signed: false })

    expect(draftForSend(first).nonce).toBe(first.nonce)
  })

  it("is new once the text or the switch has changed", () => {
    const first = draftForSend({ text: "Why?", signed: false })

    expect(draftForSend({ ...first, text: "Why not?" }).nonce).not.toBe(
      first.nonce,
    )
    expect(draftForSend({ ...first, signed: true }).nonce).not.toBe(first.nonce)
  })
})
