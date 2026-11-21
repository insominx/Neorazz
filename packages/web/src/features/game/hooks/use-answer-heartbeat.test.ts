import { renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { cue } = vi.hoisted(() => ({ cue: vi.fn() }))

vi.mock("@razzia/web/features/game/audio/score", () => ({
  score: { cue },
}))

const { answerBeatMs, answerHeartbeatPlays, useAnswerHeartbeat } =
  await import("@razzia/web/features/game/hooks/use-answer-heartbeat")

describe("the answering heartbeat", () => {
  beforeEach(() => {
    cue.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("runs from 56 to 120 beats a minute across the window", () => {
    expect(answerBeatMs(0)).toBeCloseTo(60_000 / 56)
    expect(answerBeatMs(1)).toBeCloseTo(500)
    expect(answerBeatMs(2)).toBeCloseTo(500)
  })

  it("beats while active, stronger and sooner as the clock runs down", () => {
    const { rerender } = renderHook(
      ({ active, progress }) => {
        useAnswerHeartbeat(active, progress)
      },
      { initialProps: { active: true, progress: 0 } },
    )

    expect(cue).toHaveBeenCalledTimes(1)
    expect(cue).toHaveBeenLastCalledWith({ cue: "beat", strength: 0.5 })

    rerender({ active: true, progress: 1 })
    vi.advanceTimersByTime(answerBeatMs(0))

    expect(cue).toHaveBeenCalledTimes(2)
    expect(cue).toHaveBeenLastCalledWith({ cue: "beat", strength: 1 })

    vi.advanceTimersByTime(answerBeatMs(1))
    expect(cue).toHaveBeenCalledTimes(3)
  })

  it("stops when it is no longer active (the last five seconds)", () => {
    const { rerender } = renderHook(
      ({ active }) => {
        useAnswerHeartbeat(active, 0.5)
      },
      { initialProps: { active: true } },
    )

    rerender({ active: false })
    vi.advanceTimersByTime(10_000)

    expect(cue).toHaveBeenCalledTimes(1)
  })

  it("never beats when inactive", () => {
    renderHook(() => {
      useAnswerHeartbeat(false, 0.5)
    })
    vi.advanceTimersByTime(10_000)

    expect(cue).not.toHaveBeenCalled()
  })

  // In Full the answers groove keeps time; a heartbeat on its own clock over
  // it sounds like a second track (CST-426 task 0116).
  it("plays only in Calm, where no groove keeps time under it", () => {
    expect(answerHeartbeatPlays("calm")).toBe(true)
    expect(answerHeartbeatPlays("full")).toBe(false)
    expect(answerHeartbeatPlays("silent")).toBe(false)
  })
})
