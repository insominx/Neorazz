import {
  DEFAULT_SOUND_THEME,
  type SoundTheme,
} from "@razzia/common/types/visuals"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"

/**
 * The sound pack of the running session, from the snapshot taken at
 * `GAME.CREATE`: the player store while joined, the manager store otherwise,
 * never the live `config.game.visuals`, so switching the pack mid-game cannot
 * swap sounds under the players.
 */
export const useSoundTheme = (): SoundTheme => {
  const playerGameId = usePlayerStore((s) => s.gameId)
  const playerTheme = usePlayerStore((s) => s.visuals.soundTheme)
  const managerTheme = useManagerStore((s) => s.visuals.soundTheme)

  return (playerGameId ? playerTheme : managerTheme) ?? DEFAULT_SOUND_THEME
}
