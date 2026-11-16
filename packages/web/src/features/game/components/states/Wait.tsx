import { EVENTS } from "@razzia/common/constants"
import type { PlayerStatusDataMap } from "@razzia/common/types/game/status"
import AnswerTile from "@razzia/web/features/game/components/AnswerTile"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"
import { useQuestionStore } from "@razzia/web/features/game/stores/question"
import { answerVars } from "@razzia/web/features/game/utils/type-tier"
import clsx from "clsx"
import { useState } from "react"
import { useTranslation } from "react-i18next"

interface Props {
  data: PlayerStatusDataMap["WAIT"]
}

const WAITING_FOR_ANSWERS = "game:waitingForAnswers"
const WAITING_FOR_PLAYERS = "game:waitingForPlayers"

/**
 * A phone that has locked in an answer: its own pick, held, and how many of the
 * room are in. Tapping the held tile nudges it ("yes, it is locked"). Any other
 * wait (the lobby, a lecture hold) says the phone is connected and that the
 * next thing will come to it. Nothing on it moves.
 *
 * The lobby's text is "Waiting for players", which is the host's view; the
 * phone in a seat is waiting for the host, so it says that instead.
 */
const Wait = ({ data: { text, answered, total } }: Props) => {
  const { t } = useTranslation()
  const { isConnected } = useSocket()
  const lobby = text === WAITING_FOR_PLAYERS
  const lastAnswer = usePlayerStore((state) => state.lastAnswer)
  const player = usePlayerStore((state) => state.player)
  const here = usePlayerStore((state) => state.playersHere) ?? undefined
  const setHere = usePlayerStore((state) => state.setPlayersHere)
  const currentQuestion = useQuestionStore(
    (state) => state.questionStates?.current,
  )
  const [count, setCount] = useState<number | undefined>(answered)
  const [nudge, setNudge] = useState(0)

  // Everyone else's answers keep arriving while this phone waits.
  useEvent(EVENTS.GAME.PLAYER_ANSWER, setCount)

  // In the lobby, the room fills up in front of you.
  useEvent(EVENTS.GAME.TOTAL_PLAYERS, setHere)

  // Only echo a pick made for the question on screen; a reload or a stale
  // store falls back to the plain waiting state.
  const picked =
    text === WAITING_FOR_ANSWERS &&
    lastAnswer?.questionNumber === currentQuestion
      ? lastAnswer
      : null

  return (
    <section className="animate-rz-fade-in relative mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center px-4">
      {picked ? (
        <div
          data-picked-answer
          className="flex w-full max-w-md flex-col items-center gap-4"
        >
          <p
            data-locked-in
            className="bg-success-tint border-success-border text-success rounded-full border px-5 py-1.5 text-base font-bold tracking-[0.12em] uppercase"
          >
            {t("game:lockedIn")}
          </p>
          <AnswerTile
            // A new key restarts the nudge on every tap.
            key={nudge}
            index={picked.key}
            state="picked"
            className={nudge > 0 ? "rz-nudge" : undefined}
            style={answerVars([picked.text])}
            onClick={() => setNudge((previous) => previous + 1)}
          >
            {picked.text}
          </AnswerTile>
          {count !== undefined && total !== undefined && (
            <p
              data-answered-count
              className="text-text-muted text-xl font-semibold tabular-nums"
            >
              {t("game:answeredOf", {
                answered: Math.max(count, answered ?? 0),
                total,
              })}
            </p>
          )}
        </div>
      ) : (
        <>
          {lobby && player && (
            <p
              data-youre-in
              className="text-brand short:mb-3 short:text-3xl mb-6 text-center text-4xl font-extrabold"
            >
              {t("game:youreIn", { name: player.username })}
            </p>
          )}
          {/* Still on purpose: a phone in the audience sits on this screen for
              minutes, and anything that moves pulls eyes off the room. */}
          <p
            data-connection
            className={clsx(
              "flex items-center gap-2 rounded-full border px-4 py-1.5 text-base font-bold",
              isConnected
                ? "bg-success-tint border-success-border text-success"
                : "bg-warning-tint border-warning-border text-warning",
            )}
          >
            <span
              aria-hidden="true"
              className={clsx(
                "size-2.5 rounded-full",
                isConnected ? "bg-success" : "bg-warning",
              )}
            />
            {isConnected ? t("game:connectedBadge") : t("common:reconnecting")}
          </p>
          <h2 className="text-text-primary short:mt-3 short:text-2xl mt-6 text-center text-3xl font-bold">
            {t(lobby ? "game:waitingForHost" : text)}
          </h2>
          {lobby && (
            <p
              data-wait-hint
              className="text-text-muted mt-3 max-w-md text-center text-lg"
            >
              {t("game:waitNextHint")}
            </p>
          )}
          {lobby && here !== undefined && (
            <p
              data-players-here
              className="text-text-muted mt-3 text-xl font-semibold tabular-nums"
            >
              {t("game:playersHere", { count: here })}
            </p>
          )}
        </>
      )}
    </section>
  )
}

export default Wait
