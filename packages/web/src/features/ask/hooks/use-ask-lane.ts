import { EVENTS } from "@razzia/common/constants"
import { STATUS } from "@razzia/common/types/game/status"
import { useAskStore } from "@razzia/web/features/ask/stores/ask"
import { canAsk } from "@razzia/web/features/ask/utils/can-ask"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"
import { usePollStore } from "@razzia/web/features/poll/stores/poll"
import { useEffect } from "react"

/**
 * Keeps a phone's question button in step with the room. The server tells a
 * phone only whether the box is open; this decides whether the button is
 * offered, and closes the fold-out the moment it is not (a poll or a question
 * arriving over it), keeping the draft.
 *
 * No player payload carries the box, so the phone asks: when its game
 * changes, and each time the server reattaches it (`player:successReconnect`,
 * which the game page reports by bumping `reconnects`), so a pause it missed
 * while away is caught.
 */
export const useAskLane = (gameId: string | null) => {
  const { socket } = useSocket()
  const reconnects = useAskStore((state) => state.reconnects)
  const box = useAskStore((state) => state.box)
  const status = usePlayerStore((state) => state.status)
  const pollShowing = usePollStore(
    (state) => state.snapshot !== null || state.review !== null,
  )

  useEvent(EVENTS.ASK.BOX, (next) => {
    useAskStore.getState().setBox(next)
  })

  // Another game's box says nothing about this one.
  useEffect(() => {
    useAskStore.getState().setBox(null)
  }, [gameId])

  useEffect(() => {
    if (gameId) {
      socket.emit(EVENTS.ASK.SYNC, { gameId })
    }
  }, [socket, gameId, reconnects])

  const waitText =
    status?.name === STATUS.WAIT
      ? (status.data as { text?: string }).text
      : undefined
  const offered = canAsk({
    status: status?.name,
    waitText,
    box,
    pollShowing,
  })

  useEffect(() => {
    const store = useAskStore.getState()

    store.setOffered(offered)

    if (!offered) {
      store.closeSheet()
    }
  }, [offered])
}
