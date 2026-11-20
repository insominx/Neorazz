import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  fsDeny,
  parseAllowedHosts,
  runtimeConfigScript,
} from "../../vite.security"

describe("vite security", () => {
  it("denies the config volume by absolute path, whatever the separators", () => {
    expect(fsDeny(String.raw`C:\Projects\Razzia\config`)).toContain(
      "C:/Projects/Razzia/config/**",
    )
    expect(fsDeny("/srv/razzia/config/")).toContain("/srv/razzia/config/**")
  })

  it("keeps Vite's default deny patterns", () => {
    expect(fsDeny("/c")).toEqual(expect.arrayContaining([".env", "**/.git/**"]))
  })

  it("reads allowed hosts from a comma list, or all with *", () => {
    expect(parseAllowedHosts(undefined)).toEqual([])
    expect(parseAllowedHosts(" teacher-pc , class.example.edu ")).toEqual([
      "teacher-pc",
      "class.example.edu",
    ])
    expect(parseAllowedHosts("a,*")).toBe(true)
  })

  it("sends no referrer from question media requests", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8")

    expect(html).toContain('<meta name="referrer" content="no-referrer"')
  })
})

describe("runtimeConfigScript", () => {
  it("lists the deck origins, trimmed and without a trailing slash", () => {
    expect(
      runtimeConfigScript(" https://slides.example.org/ ,, http://a.test:8080"),
    ).toBe(
      'window.__NEORAZZ_CONFIG__ = {"embedOrigins":["https://slides.example.org","http://a.test:8080"]}\n',
    )
  })

  it("lists none when the variable is unset", () => {
    expect(runtimeConfigScript(undefined)).toBe(
      'window.__NEORAZZ_CONFIG__ = {"embedOrigins":[]}\n',
    )
  })
})
