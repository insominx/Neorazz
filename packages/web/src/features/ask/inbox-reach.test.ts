import { describe, expect, it } from "vitest"

// The inbox shows questions' text, so how it can be reached is part of A1:
// nothing on another page links to it (a manager page can be on the
// projector in a deck's frame), and nothing of it is kept in the browser.
// These read the source itself, so they hold whatever the test runner's
// browser does.

const sources = import.meta.glob<string>(["../../**/*.{ts,tsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
})

const isTest = (path: string) => /\.test\.tsx?$/u.test(path)

// The only files that may name the inbox's address.
const MAY_NAME_THE_INBOX = new Set([
  "../../pages/manager/questions.tsx",
  "../../route.gen.ts",
])

const INBOX_FILES = [
  "../../pages/manager/questions.tsx",
  "./components/Inbox.tsx",
  "./hooks/use-inbox.ts",
  "./stores/inbox.ts",
  "./utils/inbox-order.ts",
]

const own = import.meta.glob<string>(
  [
    "./components/Inbox.tsx",
    "./hooks/use-inbox.ts",
    "./stores/inbox.ts",
    "./utils/inbox-order.ts",
    "../../pages/manager/questions.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
)

describe("how the inbox is reached", () => {
  it("found the app's source", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100)
    expect(Object.keys(own).sort()).toEqual([...INBOX_FILES].sort())
  })

  it("is named by no page but its own: no tab, link or navigation to it", () => {
    const naming = Object.entries(sources)
      .filter(([path]) => !isTest(path) && !MAY_NAME_THE_INBOX.has(path))
      .filter(([, source]) => /manager\/questions|\/questions\b/u.test(source))
      .map(([path]) => path)

    expect(naming).toEqual([])
  })

  it("keeps nothing in the browser's storage", () => {
    for (const [path, source] of Object.entries(own)) {
      expect({
        path,
        hits: source.match(
          /localStorage|sessionStorage|indexedDB|persist\(|document\.cookie|caches\./gu,
        ),
      }).toEqual({ path, hits: null })
    }
  })

  it("draws no markup from a question", () => {
    for (const [path, source] of Object.entries(own)) {
      expect({
        path,
        html: source.includes("dangerouslySetInnerHTML"),
      }).toEqual({ path, html: false })
    }
  })
})
