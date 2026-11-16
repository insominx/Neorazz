import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { AskRecord } from "@razzia/common/types/ask"
import {
  getAskRecordById,
  saveAskRecord,
} from "@razzia/socket/services/ask-store"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

let root = ""

const record = (id: string, extra: Partial<AskRecord> = {}): AskRecord => ({
  id,
  gameSubject: "Check-in",
  date: "2026-11-17T18:04:00.000Z",
  asks: [
    {
      id: "ask-0001",
      text: "Why is the sky blue?",
      at: "2026-11-17T18:04:00.000Z",
      state: "new",
    },
    {
      id: "ask-0002",
      text: "Can you repeat the last part?",
      at: "2026-11-17T18:06:00.000Z",
      name: "Alice",
      state: "seen",
    },
  ],
  ...extra,
})

const onDisk = (id: string): unknown =>
  JSON.parse(readFileSync(join(root, "asks", `${id}.json`), "utf-8"))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "razzia-asks-"))
  process.env.CONFIG_PATH = root
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe("saveAskRecord", () => {
  it("makes the folder on the first save and keeps the record under its id", () => {
    expect(existsSync(join(root, "asks"))).toBe(false)

    expect(saveAskRecord(record("rec-aaaa1111"))).toBe(true)

    expect(onDisk("rec-aaaa1111")).toEqual(record("rec-aaaa1111"))
  })

  it("replaces the file on each save", () => {
    saveAskRecord(record("rec-aaaa1111"))
    saveAskRecord(record("rec-aaaa1111", { asks: [] }))

    expect(onDisk("rec-aaaa1111")).toMatchObject({ asks: [] })
  })

  it("writes only the known fields, whatever it is handed", () => {
    const sneaky = {
      ...record("rec-aaaa1111"),
      clientId: "alice-client",
      asks: [{ ...record("x").asks[0], socketId: "alice-sock" }],
    } as unknown as AskRecord

    saveAskRecord(sneaky)

    const bytes = readFileSync(join(root, "asks", "rec-aaaa1111.json"), "utf-8")

    expect(bytes).not.toContain("alice-client")
    expect(bytes).not.toContain("alice-sock")
  })

  it("refuses an id that is not a plain file name, and writes nothing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    for (const id of ["../game", "a/b", "a\\b", "c:x", ""]) {
      expect(saveAskRecord(record(id))).toBe(false)
    }

    expect(existsSync(join(root, "asks"))).toBe(false)
    expect(existsSync(join(root, "game.json"))).toBe(false)
    expect(error).toHaveBeenCalled()
  })

  it("answers false on a failed write and logs no question and no name", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined)

    // A file where the folder should be makes every write fail.
    writeFileSync(join(root, "asks"), "not a folder")

    expect(saveAskRecord(record("rec-aaaa1111"))).toBe(false)

    const logged = JSON.stringify(error.mock.calls)

    expect(error).toHaveBeenCalledTimes(1)
    expect(logged).toContain("rec-aaaa1111")
    expect(logged).not.toContain("sky blue")
    expect(logged).not.toContain("repeat the last part")
    expect(logged).not.toContain("Alice")
  })
})

describe("getAskRecordById", () => {
  it("reads a record back, named by its file", () => {
    saveAskRecord(record("rec-aaaa1111"))

    expect(getAskRecordById("rec-aaaa1111")).toEqual(record("rec-aaaa1111"))
  })

  it("throws for an unsafe id, a missing file and an invalid one", () => {
    mkdirSync(join(root, "asks"), { recursive: true })
    writeFileSync(join(root, "asks", "bad.json"), "{ not json")
    writeFileSync(
      join(root, "asks", "odd.json"),
      JSON.stringify({ id: "odd", asks: "no" }),
    )

    expect(() => getAskRecordById("../game")).toThrow()
    expect(() => getAskRecordById("missing")).toThrow()
    expect(() => getAskRecordById("bad")).toThrow()
    expect(() => getAskRecordById("odd")).toThrow()
  })
})
