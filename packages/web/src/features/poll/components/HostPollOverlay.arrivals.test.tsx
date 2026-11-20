import type { PollSnapshot } from "@razzia/common/types/poll"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import HostPollOverlay from "@razzia/web/features/poll/components/HostPollOverlay"
import { usePollStore } from "@razzia/web/features/poll/stores/poll"
import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// While a poll is open the host's screen shows each vote arriving: the name
// under the options, a ring from the count, the room's light rising and a
// heartbeat that stops when everyone is in.

const mocks = vi.hoisted(() => ({
  cue: vi.fn<(_cue: { cue: string }) => void>(),
  frame: vi.fn(),
  calm: false,
}))

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  useSocket: () => ({ socket: { emit: vi.fn() }, isConnected: true }),
  useEvent: vi.fn(),
}))

vi.mock("@razzia/web/features/game/audio/score", () => ({
  score: { cue: mocks.cue },
}))

// The frame's own light is the atmosphere's; here only what it is handed.
vi.mock("@razzia/web/features/poll/components/PollFrame", () => ({
  default: (props: { lift?: number; breath?: number; children: unknown }) => {
    mocks.frame({ lift: props.lift, breath: props.breath })

    return <div>{props.children as never}</div>
  },
}))

vi.mock("@razzia/web/features/game/hooks/use-show-intensity", () => ({
  useCalmVisuals: () => mocks.calm,
}))

vi.mock("react-hot-toast", () => ({ default: { error: vi.fn() } }))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}))

const open = (extra: Partial<PollSnapshot> = {}): PollSnapshot => ({
  pollId: "lunch",
  question: "What should we eat?",
  options: ["Pizza", "Soup"],
  anonymous: true,
  phase: "open",
  total: 0,
  ...extra,
})

const connected = (count: number) => {
  useManagerStore.setState({
    gameId: "g1",
    presenceKnown: true,
    players: Array.from({ length: count }, (_, index) => ({
      id: `p${index}`,
      connected: true,
    })) as never,
  })
}

const show = (snapshot: PollSnapshot | null) => {
  act(() => {
    usePollStore.getState().apply(snapshot)
  })
}

const vote = (total: number, arrived?: string) => {
  act(() => {
    usePollStore.getState().applyTally({
      pollId: "lunch",
      total,
      ...(arrived ? { arrived } : {}),
    })
  })
}

const beats = () =>
  mocks.cue.mock.calls.filter(([cue]) => cue.cue === "beat").length

describe("HostPollOverlay arrivals", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.cue.mockClear()
    mocks.frame.mockClear()
    mocks.calm = false
    usePollStore.getState().reset()
    useManagerStore.getState().reset()
    connected(3)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("names the voter under the options and sends a ring from the count", () => {
    render(<HostPollOverlay />)
    show(open())
    vote(1, "Ada")

    expect(document.querySelector("[data-poll-arrivals]")).toHaveTextContent(
      "Ada",
    )
    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(1)
    expect(document.querySelector("[data-poll-voted]")).toHaveTextContent(
      'poll:votes:{"count":1}',
    )
    expect(document.querySelector(".rz-arrival-count")).toHaveTextContent(/^1$/)
  })

  // The mocked line reads `poll:votes:{"count":N}`, so its number is mid-line,
  // as in a language that does not put it first.
  it("sends the ring from the number itself, wherever the line puts it", () => {
    render(<HostPollOverlay />)
    show(open())
    vote(1, "Ada")
    vote(12, "Grace")

    const source = document.querySelector(".rz-arrival-number")

    expect(source).toHaveTextContent(/^12$/)
    // One ring from the first vote, and three, not eleven, from the jump.
    expect(source?.querySelectorAll("[data-poll-pulse]")).toHaveLength(4)
    expect(document.querySelector("[data-poll-voted]")).toHaveTextContent(
      'poll:votes:{"count":12}',
    )
  })

  it("keeps a ring that is still spreading when the next vote lands", () => {
    render(<HostPollOverlay />)
    show(open())
    vote(1, "Ada")
    const first = document.querySelector("[data-poll-pulse]")

    vote(2, "Grace")

    const rings = document.querySelectorAll("[data-poll-pulse]")

    expect(rings).toHaveLength(2)
    expect(rings[0]).toBe(first)
  })

  it("lets each ring finish instead of cutting the oldest when more votes land", () => {
    render(<HostPollOverlay />)
    show(open())
    vote(1, "Ada")
    const first = document.querySelector("[data-poll-pulse]")

    for (let total = 2; total <= 8; total += 1) {
      vote(total)
    }

    const rings = document.querySelectorAll("[data-poll-pulse]")

    expect(rings).toHaveLength(8)
    expect(rings[0]).toBe(first)

    // With eight spreading, a ninth vote sends no ring rather than cut one.
    vote(9)
    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(8)
    expect(document.querySelector("[data-poll-pulse]")).toBe(first)
  })

  it("sends no late rings for votes that came while calm", () => {
    mocks.calm = true
    const { rerender } = render(<HostPollOverlay />)
    show(open())
    vote(1, "Ada")
    vote(2, "Grace")

    mocks.calm = false
    rerender(<HostPollOverlay />)
    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(0)

    vote(3, "Linus")
    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(1)
  })

  it("removes a ring when its animation ends, or after its time if it never runs", () => {
    render(<HostPollOverlay />)
    show(open())
    vote(1, "Ada")
    vote(2, "Grace")

    const [first] = document.querySelectorAll("[data-poll-pulse]")

    act(() => {
      fireEvent.animationEnd(first)
    })
    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(1)
    expect(first.isConnected).toBe(false)

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(0)

    vote(3, "Linus")
    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(1)
  })

  it("raises the room's light with the share that has voted", () => {
    render(<HostPollOverlay />)
    show(open())

    expect(mocks.frame).toHaveBeenLastCalledWith(
      expect.objectContaining({ lift: 0 }),
    )

    vote(1, "Ada")

    expect(mocks.frame).toHaveBeenLastCalledWith(
      expect.objectContaining({ lift: 1 / 3 }),
    )
  })

  it("starts a heartbeat with the first vote and stops it when everyone is in", () => {
    render(<HostPollOverlay />)
    show(open())

    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(beats()).toBe(0)

    vote(1, "Ada")
    expect(beats()).toBe(1)

    vote(2, "Grace")
    vote(3, "Linus")
    const atAllIn = beats()

    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(beats()).toBe(atAllIn)
    expect(document.querySelector('[data-arrival="all"]')).not.toBeNull()
  })

  it("shows no arrivals, rings or heartbeat once the poll has closed", () => {
    render(<HostPollOverlay />)
    show(open())
    vote(1, "Ada")
    show(open({ phase: "closed", counts: [1, 0], total: 1 }))
    mocks.cue.mockClear()

    expect(document.querySelector("[data-poll-arrivals]")).toBeNull()
    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(0)

    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(beats()).toBe(0)
  })

  it("draws no rings and no count flash in calm, but still names the voter", () => {
    mocks.calm = true
    render(<HostPollOverlay />)
    show(open())
    vote(1, "Ada")

    expect(document.querySelectorAll("[data-poll-pulse]")).toHaveLength(0)
    expect(document.querySelector(".rz-arrival-count")).toBeNull()
    expect(document.querySelector("[data-poll-arrivals]")).toHaveTextContent(
      "Ada",
    )
  })
})
