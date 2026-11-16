import type { AskBox } from "@razzia/common/types/ask"
import { STATUS, type Status } from "@razzia/common/types/game/status"

// The wait a phone sits on after it has answered: a question is still running.
export const WAITING_FOR_ANSWERS = "game:waitingForAnswers"

// The screens a phone rests on: the lobby and the lecture holds (`WAIT`), the
// verdict and the standing after a question, and the podium. Never while a
// question runs (its countdown, prompt, answers, or the wait after answering).
const RESTING = new Set<Status>([
  STATUS.WAIT,
  STATUS.SHOW_RESULT,
  STATUS.SHOW_STANDING,
  STATUS.FINISHED,
])

export interface AskView {
  status: Status | null | undefined
  // The WAIT screen's text, which tells a lobby or a hold from the wait after
  // answering.
  waitText: string | undefined
  box: AskBox | null
  pollShowing: boolean
}

/**
 * Whether this phone offers its question button: on a screen it rests on,
 * while the room's box is open and no poll is showing. Hiding it during a
 * question is the phone's job; the server takes an ask in any phase.
 */
export const canAsk = ({
  status,
  waitText,
  box,
  pollShowing,
}: AskView): boolean => {
  if (!box?.open || pollShowing || !status || !RESTING.has(status)) {
    return false
  }

  return status !== STATUS.WAIT || waitText !== WAITING_FOR_ANSWERS
}
