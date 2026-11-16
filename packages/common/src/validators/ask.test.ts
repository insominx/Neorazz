import {
  ASK_LIMITS,
  askRecordValidator,
  capWaiting,
  cleanAskText,
  isAskNonce,
  minuteOf,
} from "@razzia/common/validators/ask"
import { describe, expect, it } from "vitest"

// Invisible marks, built from their code points so none sits raw in this file.
const RLO = String.fromCodePoint(0x202e)
const LRI = String.fromCodePoint(0x2066)
const PDI = String.fromCodePoint(0x2069)
const LRM = String.fromCodePoint(0x200e)

describe("cleanAskText", () => {
  it("keeps a question as it was typed, trimmed at the ends", () => {
    expect(cleanAskText("  Why is the sky blue?  ")).toBe(
      "Why is the sky blue?",
    )
  })

  it("keeps line breaks and turns every kind into one", () => {
    expect(cleanAskText("First line\r\nSecond\rThird\nFourth")).toBe(
      "First line\nSecond\nThird\nFourth",
    )
  })

  it("turns a tab into a space", () => {
    expect(cleanAskText("a\tb")).toBe("a b")
  })

  it("strips control characters and the marks that reorder text", () => {
    expect(
      cleanAskText(
        `a\u0000b\u0007c\u001Bd\u007Fe\u0085f${RLO}g${LRI}h${PDI}i${LRM}j`,
      ),
    ).toBe(`abcdefghi${LRM}j`)
  })

  it("keeps letters from any script and emoji", () => {
    expect(cleanAskText("¿Qué pasa? 何ですか 🙂")).toBe(
      "¿Qué pasa? 何ですか 🙂",
    )
  })

  it("takes 500 characters and refuses 501", () => {
    expect(cleanAskText("x".repeat(ASK_LIMITS.TEXT))).toHaveLength(500)
    expect(cleanAskText("x".repeat(ASK_LIMITS.TEXT + 1))).toBeNull()
  })

  it("counts the length after cleaning", () => {
    expect(cleanAskText(`  ${"x".repeat(500)}\u0000\u0000  `)).toHaveLength(500)
  })

  it("refuses an empty question, or one that is only spaces and controls", () => {
    expect(cleanAskText("")).toBeNull()
    expect(cleanAskText("   \n\t ")).toBeNull()
    expect(cleanAskText(`\u0000${RLO}`)).toBeNull()
  })

  it("refuses anything that is not text, and text too long to read", () => {
    for (const value of [undefined, null, 42, true, {}, ["a"]]) {
      expect(cleanAskText(value)).toBeNull()
    }

    expect(cleanAskText(" ".repeat(ASK_LIMITS.RAW_TEXT + 1))).toBeNull()
  })
})

describe("isAskNonce", () => {
  it("takes 8 to 64 letters, digits, dashes and underscores", () => {
    expect(isAskNonce("abcd1234")).toBe(true)
    expect(isAskNonce("A_b-".repeat(16))).toBe(true)
    expect(isAskNonce("abc1234")).toBe(false)
    expect(isAskNonce("a".repeat(65))).toBe(false)
    expect(isAskNonce("abcd 1234")).toBe(false)
    expect(isAskNonce(12_345_678)).toBe(false)
    expect(isAskNonce(undefined)).toBe(false)
  })
})

describe("capWaiting", () => {
  it("tells the room at most 10, which a screen draws as 9+", () => {
    expect(capWaiting(0)).toBe(0)
    expect(capWaiting(9)).toBe(9)
    expect(capWaiting(10)).toBe(10)
    expect(capWaiting(37)).toBe(ASK_LIMITS.WAITING_CAP)
  })
})

describe("minuteOf", () => {
  it("rounds a time down to its minute", () => {
    expect(minuteOf(Date.parse("2026-11-17T18:04:59.999Z"))).toBe(
      "2026-11-17T18:04:00.000Z",
    )
    expect(minuteOf(Date.parse("2026-11-17T18:05:00.000Z"))).toBe(
      "2026-11-17T18:05:00.000Z",
    )
  })
})

describe("askRecordValidator", () => {
  const record = {
    id: "rec1",
    gameSubject: "Check-in",
    date: "2026-11-17T18:00:00.000Z",
    asks: [
      {
        id: "a1",
        text: "Why?",
        at: "2026-11-17T18:00:00.000Z",
        state: "new",
      },
    ],
  }

  it("reads a record", () => {
    expect(askRecordValidator.parse(record)).toEqual(record)
  })

  it("drops any field it does not know, so a hand-edited file carries nothing else", () => {
    const parsed = askRecordValidator.parse({
      ...record,
      clientId: "someone",
      asks: [{ ...record.asks[0], clientId: "someone", socketId: "s1" }],
    })

    expect(JSON.stringify(parsed)).not.toContain("someone")
    expect(JSON.stringify(parsed)).not.toContain("s1")
  })

  it("refuses a state it does not know", () => {
    expect(
      askRecordValidator.safeParse({
        ...record,
        asks: [{ ...record.asks[0], state: "hidden" }],
      }).success,
    ).toBe(false)
  })
})
