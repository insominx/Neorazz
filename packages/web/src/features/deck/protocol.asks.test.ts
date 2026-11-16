import { FEATURES, parseDeckCommand } from "@razzia/web/features/deck/protocol"
import { describe, expect, it } from "vitest"

const envelope = { source: "cst426-deck", v: 1 }

describe("the askBox command", () => {
  it("reads open: false and open: true", () => {
    for (const open of [false, true]) {
      expect(parseDeckCommand({ ...envelope, type: "askBox", open })).toEqual({
        ...envelope,
        type: "askBox",
        open,
      })
    }
  })

  it("drops one without a boolean open, as any malformed message", () => {
    for (const body of [{}, { open: "false" }, { open: 0 }, { open: null }]) {
      expect(parseDeckCommand({ ...envelope, type: "askBox", ...body })).toBe(
        null,
      )
    }
  })

  it("keeps protocol version 1", () => {
    expect(
      parseDeckCommand({
        source: "cst426-deck",
        v: 2,
        type: "askBox",
        open: false,
      }),
    ).toBeNull()
  })

  it("is listed as a feature", () => {
    expect(FEATURES).toContain("asks")
  })
})
