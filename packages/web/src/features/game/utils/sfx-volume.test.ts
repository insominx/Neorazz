import { SFX, sfxVolume } from "@razzia/web/features/game/utils/game-constants"
import { describe, expect, it } from "vitest"

const CLASSIC_CUES = [
  SFX.ANSWERS.MUSIC,
  SFX.ANSWERS.SOUND,
  SFX.BOUMP_SOUND,
  SFX.SHOW_SOUND,
  SFX.RESULTS_SOUND,
  SFX.PODIUM.THREE,
  SFX.PODIUM.SECOND,
  SFX.PODIUM.SNEAR_ROOL,
  SFX.PODIUM.FIRST,
]

// The classic mix as it shipped before the table existed.
const CLASSIC_MIX = {
  [SFX.ANSWERS.MUSIC]: 0.2,
  [SFX.ANSWERS.SOUND]: 0.1,
  [SFX.BOUMP_SOUND]: 0.2,
  [SFX.SHOW_SOUND]: 0.5,
  [SFX.RESULTS_SOUND]: 0.2,
  [SFX.PODIUM.THREE]: 0.1,
  [SFX.PODIUM.SECOND]: 0.1,
  [SFX.PODIUM.SNEAR_ROOL]: 0.1,
  [SFX.PODIUM.FIRST]: 0.1,
}

describe("sfxVolume", () => {
  it("keeps the classic mix exactly", () => {
    for (const cue of CLASSIC_CUES) {
      expect(sfxVolume(cue)).toBe(CLASSIC_MIX[cue])
    }
  })

  it("keys the level on the file name", () => {
    expect(sfxVolume("/elsewhere/results.mp3")).toBe(0.2)
  })

  it("plays a file it has no level for at full volume", () => {
    expect(sfxVolume("/sounds/unknown.mp3")).toBe(1)
  })
})
