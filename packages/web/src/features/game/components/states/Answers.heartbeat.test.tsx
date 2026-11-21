import { act, cleanup, render } from "@testing-library/react"
import type { CommonStatusDataMap } from "@razzia/common/types/game/status"
import type { ShowIntensity } from "@razzia/common/types/visuals"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import Answers from "@razzia/web/features/game/components/states/Answers"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  cue: vi.fn(),
}))

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  useSocket: () => ({ socket: { emit: vi.fn() } }),
  useEvent: vi.fn(),
}))

// The projector: no seat, so no player and no game of its own.
vi.mock("@razzia/web/features/game/stores/player", () => {
  const state = {
    player: null,
    gameId: null,
    visuals: {},
    setLastAnswer: vi.fn(),
  }

  return {
    usePlayerStore: (select?: (s: typeof state) => unknown) =>
      select ? select(state) : state,
  }
})

vi.mock("@razzia/web/features/game/audio/score", () => ({
  score: { start: mocks.start, cue: mocks.cue },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const open = (): CommonStatusDataMap["SELECT_ANSWER"] => ({
  question: "Question",
  questionNumber: 1,
  answers: ["First", "Second", "Third", "Fourth"],
  time: 20,
  totalPlayer: 4,
  revealStartedAt: 1_000,
  unlockAt: 5_000,
  serverNow: 5_000,
  answeringOpen: true,
})

const beats = () =>
  mocks.cue.mock.calls.filter(
    ([cue]) => (cue as { cue: string }).cue === "beat",
  )

const answerOnTheProjector = async (showIntensity: ShowIntensity) => {
  useManagerStore.setState({ visuals: { showIntensity }, review: null })
  render(<Answers data={open()} />)
  await act(() => vi.advanceTimersByTimeAsync(3_000))
}

describe("the projector's answering heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2040-01-01T00:00:00.000Z"))
    vi.clearAllMocks()
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        media: "(prefers-reduced-motion: reduce)",
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    )
  })

  afterEach(() => {
    cleanup()
    useManagerStore.setState({ visuals: {}, review: null })
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  // Full's answers scene grooves at 120 bpm with a kick on every beat; a
  // heartbeat on a timer of its own over it sounds like a second track.
  it("stays out of Full: the groove keeps time alone", async () => {
    await answerOnTheProjector("full")

    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({ scene: "answers" }),
      { silent: false },
    )
    expect(beats()).toHaveLength(0)
  })

  it("beats in Calm, where no groove plays under it", async () => {
    await answerOnTheProjector("calm")

    expect(beats().length).toBeGreaterThanOrEqual(2)
  })
})
