import type { PollDone, PollSnapshot } from "@razzia/common/types/poll"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import HostPollOverlay from "@razzia/web/features/poll/components/HostPollOverlay"
import { usePollStore } from "@razzia/web/features/poll/stores/poll"
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A deck stepping from one poll to another on the projected screen: the new
// poll's bars are new elements, so none slides from the last poll's widths
// (a reused bar would run its width transition down to 0, and look as if the
// new poll already had votes).

const mocks = vi.hoisted(() => ({ embed: true }))

vi.mock("@razzia/web/features/deck/embed", () => ({
  get IS_DECK_EMBED() {
    return mocks.embed
  },
}))

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  useSocket: () => ({ socket: { emit: vi.fn() }, isConnected: true }),
  useEvent: vi.fn(),
}))

vi.mock("@razzia/web/components/Atmosphere", () => ({ default: () => null }))

vi.mock("@razzia/web/features/game/hooks/use-show-intensity", () => ({
  useCalmVisuals: () => false,
}))

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}))

const grades: PollSnapshot = {
  pollId: "grade-band",
  question: "What grade band do you teach?",
  options: ["K-5", "6-8", "9-12"],
  anonymous: true,
  phase: "open",
  counts: [2, 1, 0],
  total: 3,
  live: true,
}

const agents: PollSnapshot = {
  pollId: "agent-experience",
  question: "Have you used a coding agent?",
  options: ["Never", "Tried", "Weekly", "Daily"],
  anonymous: true,
  phase: "open",
  counts: [0, 0, 0, 0],
  total: 0,
  live: true,
}

const gradesDone: PollDone = {
  id: "grade-band",
  question: grades.question,
  options: grades.options,
  anonymous: true,
  live: true,
  counts: [2, 1, 0],
  total: 3,
}

const apply = (snapshot: PollSnapshot | null) => {
  act(() => {
    usePollStore.getState().apply(snapshot)
  })
}

const review = (entry: PollDone | null) => {
  act(() => {
    usePollStore.getState().setReview(entry)
  })
}

const bars = () => [
  ...screen
    .getByRole("dialog")
    .querySelectorAll<HTMLElement>("[data-poll-option] [aria-hidden] > div"),
]

const widths = () => bars().map((bar) => bar.style.width)

describe("the host's bars across a switch to another poll", () => {
  beforeEach(() => {
    mocks.embed = true
    usePollStore.getState().reset()
    useManagerStore.getState().reset()
    useManagerStore.setState({ gameId: "g1", hostControls: false })
  })

  afterEach(cleanup)

  it("draws the new poll's bars as new elements at 0", () => {
    render(<HostPollOverlay />)
    apply(grades)

    const before = bars()

    expect(widths()).toEqual(["67%", "33%", "0%"])

    apply(agents)

    expect(widths()).toEqual(["0%", "0%", "0%", "0%"])
    for (const bar of before) {
      expect(bar.isConnected).toBe(false)
    }
  })

  it("keeps the same bars while one poll's votes come in", () => {
    render(<HostPollOverlay />)
    apply(agents)

    const before = bars()

    act(() => {
      usePollStore.getState().applyTally({
        pollId: "agent-experience",
        counts: [0, 0, 1, 0],
        total: 1,
      })
    })

    expect(widths()).toEqual(["0%", "0%", "100%", "0%"])
    expect(bars()).toEqual(before)
  })

  it("keeps the same bars when the poll closes in place", () => {
    render(<HostPollOverlay />)
    apply(grades)

    const before = bars()

    apply({ ...grades, phase: "closed" })

    expect(bars()).toEqual(before)
  })

  it("shows an earlier poll again on new bars, at its own widths", () => {
    render(<HostPollOverlay />)
    apply({ ...agents, counts: [0, 0, 3, 0], total: 3 })

    const before = bars()

    review(gradesDone)

    expect(widths()).toEqual(["67%", "33%", "0%"])
    for (const bar of before) {
      expect(bar.isConnected).toBe(false)
    }
  })
})
