import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { playerState, managerState } = vi.hoisted(() => ({
  playerState: {
    gameId: null as string | null,
    visuals: { soundTheme: undefined as string | undefined },
  },
  managerState: {
    visuals: { soundTheme: undefined as string | undefined },
    config: {
      game: { visuals: { soundTheme: undefined as string | undefined } },
    },
  },
}))

vi.mock("@razzia/web/features/game/stores/player", () => ({
  usePlayerStore: (selector: (state: typeof playerState) => unknown) =>
    selector(playerState),
}))

vi.mock("@razzia/web/features/game/stores/manager", () => ({
  useManagerStore: (selector: (state: typeof managerState) => unknown) =>
    selector(managerState),
}))

const renderTheme = async () => {
  const { useSoundTheme } =
    await import("@razzia/web/features/game/hooks/use-sfx")

  return renderHook(() => useSoundTheme())
}

describe("useSoundTheme", () => {
  beforeEach(() => {
    playerState.gameId = null
    playerState.visuals.soundTheme = undefined
    managerState.visuals.soundTheme = undefined
    managerState.config.game.visuals.soundTheme = undefined
  })

  it("uses the player session theme while joined", async () => {
    playerState.gameId = "game-1"
    playerState.visuals.soundTheme = "classic"
    managerState.visuals.soundTheme = "show"

    const { result } = await renderTheme()

    expect(result.current).toBe("classic")
  })

  it("uses the manager session theme when not a player", async () => {
    managerState.visuals.soundTheme = "classic"

    const { result } = await renderTheme()

    expect(result.current).toBe("classic")
  })

  it("uses the manager snapshot and ignores live config", async () => {
    managerState.visuals.soundTheme = "show"
    managerState.config.game.visuals.soundTheme = "classic"

    const { result } = await renderTheme()

    expect(result.current).toBe("show")
  })

  it("defaults to the show's score when the session names none", async () => {
    const { result } = await renderTheme()

    expect(result.current).toBe("show")
  })
})
