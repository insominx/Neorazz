import {
  createRuntimeDeps,
  legacySource,
} from "@razzia/web/features/game/audio/runtime"
import { SFX, sfxVolume } from "@razzia/web/features/game/utils/game-constants"
import { describe, expect, it, vi } from "vitest"

const { Howl, Howler } = vi.hoisted(() => ({
  Howl: vi.fn(),
  Howler: {
    ctx: null,
    masterGain: null,
    autoSuspend: true,
    volume: vi.fn(),
    mute: vi.fn(),
  },
}))

vi.mock("howler", () => ({ Howl, Howler }))

describe("legacySource: the classic files at the levels the game tuned", () => {
  it("resolves the classic files with sfxVolume", () => {
    expect(legacySource("music")).toEqual({
      src: SFX.ANSWERS.MUSIC,
      volume: sfxVolume(SFX.ANSWERS.MUSIC),
    })
    expect(legacySource("pop").volume).toBe(0.1)
    expect(legacySource("show").volume).toBe(0.5)
  })

  it("covers every sound the adapter plays", () => {
    const paths = [
      "show",
      "music",
      "pop",
      "tick",
      "results",
      "three",
      "second",
      "roll",
      "first",
    ] as const

    expect(paths.map((sfx) => legacySource(sfx).src)).toEqual([
      SFX.SHOW_SOUND,
      SFX.ANSWERS.MUSIC,
      SFX.ANSWERS.SOUND,
      SFX.BOUMP_SOUND,
      SFX.RESULTS_SOUND,
      SFX.PODIUM.THREE,
      SFX.PODIUM.SECOND,
      SFX.PODIUM.SNEAR_ROOL,
      SFX.PODIUM.FIRST,
    ])
  })
})

describe("createRuntimeDeps", () => {
  it("hands the controller Howler itself, so it always sees the live context", () => {
    const deps = createRuntimeDeps()

    expect(deps.howler).toBe(Howler)
  })

  it("listens for gestures on the page, to unlock the context on iOS", () => {
    expect(createRuntimeDeps().gestures).toBe(document)
  })

  it("creates a Howl only when asked, never at construction", () => {
    Howl.mockClear()

    createRuntimeDeps()
    expect(Howl).not.toHaveBeenCalled()
  })
})
