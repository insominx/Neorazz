import { STATUS } from "@razzia/common/types/game/status"

// The game's plain data: answer colours and labels, medals, the answer grid, the
// classic sound files. Kept apart from `constants.ts`, which imports every screen to build
// the registry of them: a screen (or the audio it uses) importing this file instead
// of that one is what keeps the import graph free of cycles.

/**
 * A–D tile recipe: accent stroke, tinted fill, accent ink. The ink role is
 * separate from the accent so the light register (studio surface) can darken
 * the letter without losing the vivid stroke.
 */
export const ANSWER_IDENTITY = [
  "border-answer-a bg-answer-a-tint text-answer-a-ink",
  "border-answer-b bg-answer-b-tint text-answer-b-ink",
  "border-answer-c bg-answer-c-tint text-answer-c-ink",
  "border-answer-d bg-answer-d-tint text-answer-d-ink",
] as const

/**
 * Solid A–D bar fill, no stroke and no tint. Only for marks whose *length*
 * carries the quantity — the reveal chart's bars — where a tint reads as empty
 * and a stroke reads as a frame around a track only a few pixels tall.
 */
export const ANSWER_BAR = [
  "bg-answer-a",
  "bg-answer-b",
  "bg-answer-c",
  "bg-answer-d",
] as const

/**
 * A–D numeral ink with no fill or stroke — for marks that sit *beside* the
 * swatch (the reveal chart's letter, percentage and count) and have to carry
 * identity through type alone.
 */
export const ANSWER_INK = [
  "text-answer-a-ink",
  "text-answer-b-ink",
  "text-answer-c-ink",
  "text-answer-d-ink",
] as const

export const ANSWERS_LABELS = ["A", "B", "C", "D"]

/**
 * The accent of each answer as a custom property. A tile sets `--c` from this
 * once, and its letter block, rail, glow and flood all read `var(--c)`, so a
 * tile is one identity however many layers carry it.
 */
export const ANSWER_COLOR_VARS = [
  "--rz-answer-a",
  "--rz-answer-b",
  "--rz-answer-c",
  "--rz-answer-d",
] as const

/**
 * Gold, silver and bronze for ranks 1–3 (index = rank − 1). Rank is the only
 * thing these colours mean; they never mark answers or correctness.
 */
export const MEDAL = [
  "bg-medal-gold border-medal-gold-border text-on-medal",
  "bg-medal-silver border-medal-silver-border text-on-medal",
  "bg-medal-bronze border-medal-bronze-border text-on-medal",
] as const

/**
 * Tracks for an A–D tile grid. Past the breakpoint the grid runs on four
 * tracks and every tile spans two, so an odd last tile (C of a three-answer
 * question) can start on track two and sit centred under the pair above it
 * instead of hanging off the left edge. Pair with `answerSlotPlacement`.
 *
 * `stage` is the projector's 2x2, a phone's single column, and a phone on its
 * side's 2x2 again (`short:`, so the tiles leave room for the question);
 * `container` breaks on the nearest `@container` for tiles squeezed between
 * editor panels.
 */
export const ANSWER_GRID_TRACKS = {
  stage: "grid-cols-1 stage:grid-cols-4 short:grid-cols-4",
  container: "grid-cols-1 @xl:grid-cols-4",
} as const

type AnswerGridScope = keyof typeof ANSWER_GRID_TRACKS

const ANSWER_SLOT_PLACEMENT = {
  stage: {
    pair: "stage:col-span-2 short:col-span-2",
    odd: "stage:col-span-2 stage:col-start-2 short:col-span-2 short:col-start-2",
  },
  container: { pair: "@xl:col-span-2", odd: "@xl:col-span-2 @xl:col-start-2" },
} as const

export const answerSlotPlacement = (
  index: number,
  count: number,
  scope: AnswerGridScope = "stage",
): string =>
  count % 2 === 1 && index === count - 1
    ? ANSWER_SLOT_PLACEMENT[scope].odd
    : ANSWER_SLOT_PLACEMENT[scope].pair

export const GAME_STATES = {
  status: {
    name: STATUS.WAIT,
    data: { text: "Waiting for the players" },
  },
  question: {
    current: 1,
    total: null,
  },
}

export const SFX = {
  ANSWERS: {
    MUSIC: "/sounds/answersMusic.mp3",
    SOUND: "/sounds/answersSound.mp3",
  },
  PODIUM: {
    THREE: "/sounds/three.mp3",
    SECOND: "/sounds/second.mp3",
    FIRST: "/sounds/first.mp3",
    SNEAR_ROOL: "/sounds/snearRoll.mp3",
  },
  RESULTS_SOUND: "/sounds/results.mp3",
  SHOW_SOUND: "/sounds/show.mp3",
  BOUMP_SOUND: "/sounds/boump.mp3",
} as const

/**
 * Classic-pack gain per cue, as tuned by ear. It multiplies Howler's master
 * gain (see `stores/sound`).
 */
const SFX_BASE_VOLUME: Partial<Record<string, number>> = {
  "answersMusic.mp3": 0.2,
  "answersSound.mp3": 0.1,
  "boump.mp3": 0.2,
  "show.mp3": 0.5,
  "results.mp3": 0.2,
  "three.mp3": 0.1,
  "second.mp3": 0.1,
  "snearRoll.mp3": 0.1,
  "first.mp3": 0.1,
}

/** Playback volume for a classic cue path. */
export const sfxVolume = (src: string): number => {
  const basename = src.slice(src.lastIndexOf("/") + 1)

  return Math.min(1, SFX_BASE_VOLUME[basename] ?? 1)
}

/** Seconds left at which the answering countdown starts ticking. */
export const FINAL_COUNTDOWN_SECONDS = 5
