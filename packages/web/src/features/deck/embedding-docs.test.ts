import { buildBridgeState } from "@razzia/web/features/deck/plan"
import {
  BRIDGE_ERROR_CODES,
  type BridgeMessageBody,
  COMMAND_TYPES,
  FEATURES,
  MESSAGE_TYPES,
} from "@razzia/web/features/deck/protocol"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, expectTypeOf, it } from "vitest"

// The guide, docs/embedding.md, is the public contract for pages that embed
// the host page. Each reference table there must list exactly what this build
// has.
const repo = (path: string) =>
  readFileSync(resolve(process.cwd(), "../..", path), "utf8")

const GUIDE = repo("docs/embedding.md")

// The names in the first column of the table under `### heading`.
const tableNames = (heading: string): string[] => {
  const marker = `\n### ${heading}\n`
  const start = GUIDE.indexOf(marker)

  if (start < 0) {
    throw new Error(`docs/embedding.md has no "### ${heading}" section`)
  }

  const rest = GUIDE.slice(start + marker.length)
  const end = rest.search(/\n#{2,3} /u)
  const section = end < 0 ? rest : rest.slice(0, end)

  return [...section.matchAll(/^\| `([^`]+)` +\|/gmu)].map((match) => match[1])
}

const sorted = (names: readonly string[]) => [...names].sort()

describe("docs/embedding.md", () => {
  it("lists every command, and only those", () => {
    expect(sorted(tableNames("Commands"))).toEqual(sorted(COMMAND_TYPES))
  })

  it("lists every message the host page sends, and only those", () => {
    expectTypeOf<(typeof MESSAGE_TYPES)[number]>().toEqualTypeOf<
      BridgeMessageBody["type"]
    >()
    expect(sorted(tableNames("Messages"))).toEqual(sorted(MESSAGE_TYPES))
  })

  it("lists every state field, and only those", () => {
    const state = buildBridgeState({
      connected: true,
      loggedIn: true,
      pending: null,
      reattaching: false,
      attached: true,
      gameId: "game",
      lecture: null,
      status: null,
      players: 0,
      // Optional in the state; present here so the table must name it.
      connectedPlayers: 0,
      visible: true,
      review: null,
      reviewable: [],
    })

    expect(sorted(tableNames("State"))).toEqual(sorted(Object.keys(state)))
  })

  it("lists every error code, and only those", () => {
    expect(sorted(tableNames("Error codes"))).toEqual(
      sorted(BRIDGE_ERROR_CODES),
    )
  })

  it("lists every feature, and only those", () => {
    expect(sorted(tableNames("Features"))).toEqual(sorted(FEATURES))
  })

  it("is where the README and the agent notes send people", () => {
    expect(repo("README.md")).toContain("docs/embedding.md")
    expect(repo("AGENTS.md")).toContain("docs/embedding.md")
  })
})
