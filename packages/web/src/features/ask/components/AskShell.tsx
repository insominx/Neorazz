import AskSheet from "@razzia/web/features/ask/components/AskSheet"
import { useAskLane } from "@razzia/web/features/ask/hooks/use-ask-lane"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"

/**
 * A phone's question lane: it follows the room's box and draws the fold-out
 * while it is open. The game page mounts it beside `PollShell`, not inside,
 * so a poll's inert wrapper never covers it; it closes itself under a poll
 * instead. The button itself is in `GameWrapper`'s footer.
 */
const AskShell = () => {
  const gameId = usePlayerStore((state) => state.gameId)

  useAskLane(gameId)

  return <AskSheet />
}

export default AskShell
