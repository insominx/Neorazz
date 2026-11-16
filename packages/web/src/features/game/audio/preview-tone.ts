import { Howler } from "howler"

const TONE_HZ = 660
const TONE_SECONDS = 0.12
const MIN_GAP_MS = 90

let lastPlayed = -Infinity

/**
 * A short beep through Howler's master gain, so it plays at the level the
 * volume slider just set. Rate-limited so a drag gives a run of ticks rather
 * than a buzz. Silent when Howler fell back to HTML5 Audio (no context).
 */
export const playPreviewTone = () => {
  // `@types/howler` declares these always present; they are null without Web Audio.
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const ctx = Howler.ctx as AudioContext | null
  // oxlint-disable-next-line typescript/no-unnecessary-condition
  const master = Howler.masterGain as GainNode | null

  if (!ctx || !master || ctx.state === "closed") {
    return
  }

  const now = performance.now()

  if (now - lastPlayed < MIN_GAP_MS) {
    return
  }

  lastPlayed = now

  const start = ctx.currentTime
  const end = start + TONE_SECONDS
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()

  osc.type = "sine"
  osc.frequency.value = TONE_HZ
  // Quick attack and decay so the beep does not click.
  gain.gain.setValueAtTime(0, start)
  gain.gain.linearRampToValueAtTime(0.5, start + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.001, end)

  osc.connect(gain)
  gain.connect(master)
  osc.start(start)
  osc.stop(end)
  osc.onended = () => gain.disconnect()
}
