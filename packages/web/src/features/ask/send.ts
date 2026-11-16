import { EVENTS } from "@razzia/common/constants"
import type { AskOutcome } from "@razzia/common/types/ask"
import type { SocketContextValue } from "@razzia/web/features/game/contexts/socket-context"
import { useAskStore } from "@razzia/web/features/ask/stores/ask"
import { draftForSend } from "@razzia/web/features/ask/utils/draft"
import { emitWithAck } from "@razzia/web/features/poll/utils/emit-with-ack"

/** How long "Sent." shows before the fold-out puts the phone back on its screen. */
export const SENT_CLOSE_MS = 1_500

/**
 * Sends the draft once and records what came of it. The nonce goes into the
 * draft before the send leaves, so a reload in between still sends it again
 * as a repeat. Only `accepted` clears the draft; anything else keeps it for
 * another try, with the fold-out open.
 *
 * After `accepted` the fold-out shows "Sent." for a moment and closes itself,
 * unless the person has started a new question or closed it meanwhile (both
 * clear the line). Reopened, it is empty.
 */
export const sendDraft = async (
  socket: SocketContextValue["socket"],
  gameId: string,
): Promise<void> => {
  const store = useAskStore.getState()

  if (store.sending) {
    return
  }

  const outgoing = draftForSend(store.draft)

  store.setDraft(outgoing)
  store.setResult(null)
  store.setSending(true)

  const outcome = await emitWithAck<AskOutcome>((ack) => {
    socket.emit(
      EVENTS.ASK.SEND,
      {
        gameId,
        text: outgoing.text,
        signed: outgoing.signed,
        nonce: outgoing.nonce,
      },
      ack,
    )
  })
  const after = useAskStore.getState()

  after.setSending(false)

  if (outcome === "accepted") {
    after.clearDraft()
  }

  after.setResult(outcome)

  if (outcome === "accepted" && after.sheetOpen) {
    setTimeout(() => {
      const now = useAskStore.getState()

      if (now.sheetOpen && now.result === "accepted") {
        now.closeSheet(true)
      }
    }, SENT_CLOSE_MS)
  }
}
