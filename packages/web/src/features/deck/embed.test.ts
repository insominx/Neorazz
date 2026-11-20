import {
  detectDeckEmbed,
  isAllowedDeckOrigin,
  parseEmbedOrigins,
} from "@razzia/web/features/deck/embed"
import { describe, expect, it } from "vitest"

const memoryStorage = () => {
  const entries = new Map<string, string>()

  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value)
    },
  }
}

const blockedStorage = {
  getItem: (): string | null => {
    throw new Error("blocked")
  },
  setItem: () => {
    throw new Error("blocked")
  },
}

describe("detectDeckEmbed", () => {
  it("turns on in a frame the deck opened with ?embed=deck, and keeps it", () => {
    const storage = memoryStorage()

    expect(
      detectDeckEmbed({
        search: "?embed=deck",
        framed: true,
        parentIsTop: true,
        storage,
      }),
    ).toBe(true)
    expect(
      detectDeckEmbed({ search: "", framed: true, parentIsTop: true, storage }),
    ).toBe(true)
  })

  it("stays off outside a frame, even with the flag", () => {
    expect(
      detectDeckEmbed({
        search: "?embed=deck",
        framed: false,
        parentIsTop: true,
        storage: memoryStorage(),
      }),
    ).toBe(false)
  })

  it("stays off below another frame, as in a presenter thumbnail", () => {
    expect(
      detectDeckEmbed({
        search: "?embed=deck",
        framed: true,
        parentIsTop: false,
        storage: memoryStorage(),
      }),
    ).toBe(false)
  })

  it("stays off in a frame that never asked for it", () => {
    expect(
      detectDeckEmbed({
        search: "?pin=123456",
        framed: true,
        parentIsTop: true,
        storage: memoryStorage(),
      }),
    ).toBe(false)
  })

  it("still trusts the query when storage is blocked", () => {
    expect(
      detectDeckEmbed({
        search: "?embed=deck",
        framed: true,
        parentIsTop: true,
        storage: blockedStorage,
      }),
    ).toBe(true)
    expect(
      detectDeckEmbed({
        search: "",
        framed: true,
        parentIsTop: true,
        storage: blockedStorage,
      }),
    ).toBe(false)
  })
})

describe("isAllowedDeckOrigin", () => {
  const listed = new Set(["https://slides.example.org"])

  it.each([
    "https://slides.example.org",
    "http://localhost:8776",
    "http://127.0.0.1:5500",
    "http://localhost",
  ])("accepts %s when the host lists slides.example.org", (origin) => {
    expect(isAllowedDeckOrigin(origin, listed)).toBe(true)
  })

  it.each([
    "http://slides.example.org",
    "https://slides.example.org.evil.com",
    "https://evil.example.org",
    "https://localhost:8776",
    "http://localhost:8776/deck",
    "null",
    "",
  ])("refuses %s", (origin) => {
    expect(isAllowedDeckOrigin(origin, listed)).toBe(false)
  })

  it("allows only this machine when the host lists nothing", () => {
    expect(isAllowedDeckOrigin("http://localhost:8776", new Set())).toBe(true)
    expect(isAllowedDeckOrigin("https://slides.example.org", new Set())).toBe(
      false,
    )
    // No site is built in: a page that is not given a list allows none.
    expect(isAllowedDeckOrigin("https://slides.example.org")).toBe(false)
  })
})

describe("parseEmbedOrigins", () => {
  it("keeps exact http(s) origins and drops the rest", () => {
    expect([
      ...parseEmbedOrigins([
        "https://slides.example.org",
        "http://192.168.0.12:8080",
        "https://slides.example.org/",
        "https://slides.example.org/deck",
        "ftp://slides.example.org",
        "slides.example.org",
        "*",
        7,
      ]),
    ]).toEqual(["https://slides.example.org", "http://192.168.0.12:8080"])
  })

  it("treats anything but a list as no origins", () => {
    expect(parseEmbedOrigins(undefined).size).toBe(0)
    expect(parseEmbedOrigins("https://slides.example.org").size).toBe(0)
  })
})
