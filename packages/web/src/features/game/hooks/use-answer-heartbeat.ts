import type { ShowIntensity } from "@razzia/common/types/visuals"
import { score } from "@razzia/web/features/game/audio/score"
import { useEffect, useRef } from "react"

/**
 * The answering heartbeat's pace across the window, chosen with the instructor
 * in task 0012 (concept 5, calm): slow as answering opens, quick near the end.
 */
export const ANSWER_HEARTBEAT_BPM = { from: 56, to: 120 } as const

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** The gap to the next beat, for how far through the window the clock is. */
export const answerBeatMs = (progress: number): number =>
  60_000 /
  (ANSWER_HEARTBEAT_BPM.from +
    (ANSWER_HEARTBEAT_BPM.to - ANSWER_HEARTBEAT_BPM.from) * clamp01(progress))

/**
 * Whether the heartbeat plays at this intensity: only in Calm, where nothing
 * else keeps time while the room answers (it was chosen in a prototype where it
 * beat alone). In Full the answers scene's groove keeps time, a kick on every
 * beat at 120 bpm, and this heartbeat runs on a timer of its own from 56 bpm:
 * together they sound like two tracks playing at once (CST-426 task 0116,
 * 2026-11-20). Silent plays nothing either way.
 */
export const answerHeartbeatPlays = (intensity: ShowIntensity): boolean =>
  intensity === "calm"

/**
 * While answering is open on the projector, a low heartbeat (the poll's `beat`
 * cue) that quickens as the clock runs down, and stops where the last five
 * seconds' ticks take over. It is sound only: nothing on the answering screen
 * moves for it, so nobody still reading the answers is pulled away from them.
 */
export const useAnswerHeartbeat = (active: boolean, progress: number) => {
  const latest = useRef(progress)

  useEffect(() => {
    latest.current = progress
  }, [progress])

  useEffect(() => {
    if (!active) {
      return undefined
    }

    let timer: ReturnType<typeof setTimeout> | undefined = undefined

    const beat = () => {
      const now = clamp01(latest.current)

      score.cue({ cue: "beat", strength: 0.5 + 0.5 * now })
      timer = setTimeout(beat, answerBeatMs(now))
    }

    beat()

    return () => {
      clearTimeout(timer)
    }
  }, [active])
}
