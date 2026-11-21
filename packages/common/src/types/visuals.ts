export interface BackgroundRef {
  kind: "config-asset"
  path: string
}

export interface VisualsConfig {
  background?: BackgroundRef
}

export type Dialect = "dark-everywhere" | "stage-studio"

export const DEFAULT_DIALECT: Dialect = "dark-everywhere"

/**
 * `classic` is the original quiz's mp3 pack; `show` is the generated, adaptive
 * score (`packages/web/src/features/game/audio`), which needs no sound files.
 * The `techno` pack was removed; a config that still names it reads as the
 * default, because the validators fall back to it.
 */
export type SoundTheme = "classic" | "show"

export const DEFAULT_SOUND_THEME: SoundTheme = "show"

export const SOUND_THEMES = ["classic", "show"] as const

/**
 * How big the show is. `full` is everything; `calm` keeps the picture but
 * drops the full-frame hits, spotlight and beams, and plays the music 12 dB
 * lower with no groove during answering; `silent` is `calm` with no audio.
 */
export type ShowIntensity = "full" | "calm" | "silent"

export const DEFAULT_SHOW_INTENSITY: ShowIntensity = "full"

export const SHOW_INTENSITIES = ["full", "calm", "silent"] as const

export interface GameVisualsConfig extends VisualsConfig {
  dialect?: Dialect
  soundTheme?: SoundTheme
  showIntensity?: ShowIntensity
}

export interface ResolvedVisuals {
  backgroundUrl?: string
  soundTheme?: SoundTheme
  showIntensity?: ShowIntensity
}
