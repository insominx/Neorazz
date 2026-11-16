import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  isHostGamePath,
  isLightRegister,
  isPlayPath,
  resolveRegister,
  STAGE_QUERY,
} from "@razzia/web/hooks/use-surface"

vi.mock("@tanstack/react-router", () => ({
  useRouterState: (opts: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => opts.select({ location: { pathname: "/manager/config" } }),
}))

vi.mock("@razzia/web/features/game/stores/manager", () => ({
  useManagerStore: (
    selector: (state: {
      config?: { game: { visuals?: { dialect?: string } } }
    }) => unknown,
  ) =>
    selector({
      config: { game: { visuals: { dialect: "stage-studio" } } },
    }),
}))

describe("resolveRegister", () => {
  it("is light only for stage-studio studio", () => {
    expect(isLightRegister("stage-studio", "studio")).toBe(true)
    expect(resolveRegister("stage-studio", "studio")).toBe("light")
    expect(resolveRegister("stage-studio", "stage")).toBe("dark")
    expect(resolveRegister("dark-everywhere", "studio")).toBe("dark")
  })
})

describe("useSurface", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.register
    delete document.documentElement.dataset.surface
    delete document.documentElement.dataset.dialect
  })

  it("writes a single data-register attr and keeps it across updates", async () => {
    const { useSurface } = await import("@razzia/web/hooks/use-surface")

    interface Props {
      dialect: "dark-everywhere" | "stage-studio"
      surface: "stage" | "studio"
    }
    const initialProps: Props = {
      dialect: "stage-studio",
      surface: "studio",
    }

    const { rerender, unmount } = renderHook(
      ({ dialect, surface }: Props) => useSurface({ dialect, surface }),
      { initialProps },
    )

    expect(document.documentElement.dataset.register).toBe("light")

    rerender({ dialect: "dark-everywhere", surface: "studio" })
    expect(document.documentElement.dataset.register).toBe("dark")

    unmount()
    expect(document.documentElement.dataset.register).toBeUndefined()
  })
})

describe("stage scale", () => {
  const originalMatchMedia = window.matchMedia

  const stubLandscapeWindow = (matches: boolean) => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === STAGE_QUERY ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }

  beforeEach(() => {
    delete document.documentElement.dataset.stage
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    delete document.documentElement.dataset.stage
  })

  it("knows the host's game page from every other page", () => {
    expect(isHostGamePath("/party/manager/123")).toBe(true)
    expect(isHostGamePath("/party/123")).toBe(false)
    expect(isHostGamePath("/manager/config")).toBe(false)
    expect(isHostGamePath("/")).toBe(false)
  })

  it("only scales a landscape window a projector could be", () => {
    expect(STAGE_QUERY).toBe("(min-width: 1024px) and (orientation: landscape)")
  })

  it("marks the page as a stage when asked, in a landscape window", async () => {
    stubLandscapeWindow(true)
    const { useSurface } = await import("@razzia/web/hooks/use-surface")

    const { unmount } = renderHook(() =>
      useSurface({ dialect: "dark-everywhere", surface: "stage", stage: true }),
    )

    expect(document.documentElement.dataset.stage).toBe("")

    unmount()
    expect(document.documentElement.dataset.stage).toBeUndefined()
  })

  it("falls back to the phone layout in a narrow or portrait window", async () => {
    stubLandscapeWindow(false)
    const { useSurface } = await import("@razzia/web/hooks/use-surface")

    renderHook(() =>
      useSurface({ dialect: "dark-everywhere", surface: "stage", stage: true }),
    )

    expect(document.documentElement.dataset.stage).toBeUndefined()
  })

  it("is off when the page does not ask for it, even in a wide window", async () => {
    stubLandscapeWindow(true)
    const { useSurface } = await import("@razzia/web/hooks/use-surface")

    renderHook(() =>
      useSurface({
        dialect: "dark-everywhere",
        surface: "stage",
        stage: false,
      }),
    )

    expect(document.documentElement.dataset.stage).toBeUndefined()
  })
})

describe("play sizing", () => {
  const originalMatchMedia = window.matchMedia

  const stubLandscapeWindow = (matches: boolean) => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: query === STAGE_QUERY ? matches : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia
  }

  beforeEach(() => {
    delete document.documentElement.dataset.play
    delete document.documentElement.dataset.stage
  })

  afterEach(() => {
    window.matchMedia = originalMatchMedia
    delete document.documentElement.dataset.play
    delete document.documentElement.dataset.stage
  })

  it("knows the pages people play on: the join page and the game pages", () => {
    expect(isPlayPath("/")).toBe(true)
    expect(isPlayPath("/party/123")).toBe(true)
    expect(isPlayPath("/party/manager/123")).toBe(true)
    expect(isPlayPath("/manager/config")).toBe(false)
    expect(isPlayPath("/manager/questions")).toBe(false)
    expect(isPlayPath("/rehearse")).toBe(false)
  })

  it("marks a play page off the stage, and clears the mark on the way out", async () => {
    stubLandscapeWindow(false)
    const { useSurface } = await import("@razzia/web/hooks/use-surface")

    const { unmount } = renderHook(() =>
      useSurface({ dialect: "dark-everywhere", surface: "stage", play: true }),
    )

    expect(document.documentElement.dataset.play).toBe("")

    unmount()
    expect(document.documentElement.dataset.play).toBeUndefined()
  })

  it("never marks the stage, whose scale is the slide's", async () => {
    stubLandscapeWindow(true)
    const { useSurface } = await import("@razzia/web/hooks/use-surface")

    renderHook(() =>
      useSurface({
        dialect: "dark-everywhere",
        surface: "stage",
        stage: true,
        play: true,
      }),
    )

    expect(document.documentElement.dataset.stage).toBe("")
    expect(document.documentElement.dataset.play).toBeUndefined()
  })

  it("leaves the studio at its own size", async () => {
    stubLandscapeWindow(false)
    const { useSurface } = await import("@razzia/web/hooks/use-surface")

    // The router mock is on /manager/config.
    renderHook(() => useSurface())

    expect(document.documentElement.dataset.play).toBeUndefined()
  })
})
