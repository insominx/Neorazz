import type { ManagerStatusDataMap } from "@razzia/common/types/game/status"
import {
  getRailOrder,
  getRailStartMs,
  RESULT_FASTEST_MS,
  RESULT_HEADLINE_MS,
  RESULT_RAIL_GROW_MS,
  RESULT_STRIKE_MS,
} from "@razzia/common/utils/result-reveal"
import { score, verdictSpec } from "@razzia/web/features/game/audio"
import AnswerTile from "@razzia/web/features/game/components/AnswerTile"
import QuestionCard from "@razzia/web/features/game/components/QuestionCard"
import QuestionNumber from "@razzia/web/features/game/components/QuestionNumber"
import StageMoment from "@razzia/web/features/game/components/StageMoment"
import { useResultClock } from "@razzia/web/features/game/hooks/use-result-clock"
import { useSceneArrival } from "@razzia/web/features/game/hooks/use-scene-arrival"
import { useCalmVisuals } from "@razzia/web/features/game/hooks/use-show-intensity"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import { useMoodOverride } from "@razzia/web/features/game/stores/mood"
import {
  type Flare,
  rectOf,
  useFlares,
} from "@razzia/web/features/game/stores/stage-light"
import {
  ANSWER_GRID_TRACKS,
  answerSlotPlacement,
} from "@razzia/web/features/game/utils/game-constants"
import {
  analyzeCrowd,
  headlineFor,
  listLetters,
} from "@razzia/web/features/game/utils/reveal-copy"
import { voteShares } from "@razzia/web/features/game/utils/score"
import { answerVars } from "@razzia/web/features/game/utils/type-tier"
import clsx from "clsx"
import { Check } from "lucide-react"
import { useReducedMotion } from "motion/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

interface Props {
  data: ManagerStatusDataMap["SHOW_RESPONSES"]
}

const easeOut = (progress: number) => 1 - (1 - progress) ** 3

/**
 * The results, staged on one clock. TIME lands where the clock was (or the
 * poll's "Everyone's in" if the whole room answered) and holds; the rails grow
 * from the letter blocks, smallest first, and the shares count up inside them;
 * everything but the most-picked answer dims; then the right answer lights
 * where it is, rings of green light leave it and a pool of green light rises
 * behind it, and the headline names who was fooled. Nothing paints the frame
 * (STYLE.md, "Light, not paint"). A screen that arrives after all that (a
 * reconnect, a lecture review) is simply the final grid, with no light and no
 * sound.
 */
const Responses = ({
  data: {
    questionNumber,
    question,
    answers,
    media,
    responses,
    solutions,
    totalPlayers,
    fastest,
    resultsAt,
    serverNow,
  },
}: Props) => {
  const { t, i18n } = useTranslation()
  const calm = useCalmVisuals()
  const reducedMotion = useReducedMotion()
  const clock = useResultClock({ resultsAt, serverNow })
  const { elapsedMs, phase } = clock
  const grid = useRef<HTMLDivElement>(null)
  const [flares, setFlares] = useState<Flare[]>([])
  // Decided once: the light and its rings are for a room that is there to see
  // the strike, not for a reconnect or a review that lands after it.
  const [live] = useState(elapsedMs < RESULT_STRIKE_MS)

  const shares = voteShares(responses, answers.length)
  const crowd = analyzeCrowd(responses, solutions, {
    answerCount: answers.length,
    totalPlayers,
  })
  const headline = headlineFor(crowd)
  const railOrder = getRailOrder(shares.map((share) => share.count))
  const verdict = phase === "strike" || phase === "settled"

  // A reviewed question must not cut the live game's bed.
  const reviewing = useManagerStore((state) => state.review !== null)
  const arrived = useSceneArrival(serverNow)

  // TIME, the count's ticks, the spotlight's heartbeat and the strike are one
  // scene, scheduled from the server's stamps: a screen that arrives after them
  // (a reconnect) finds them in the past and plays nothing. So does this screen
  // asking again when a review over it ends.
  useEffect(() => {
    // A saved result with no stamps has no verdict to stage.
    if (resultsAt === undefined || serverNow === undefined) {
      return
    }

    score.start(
      arrived(
        verdictSpec({
          resultsAt,
          serverNow,
          responses,
          solutions,
          answerCount: answers.length,
        }),
      ),
      { silent: reviewing },
    )
  }, [
    resultsAt,
    serverNow,
    responses,
    solutions,
    answers.length,
    reviewing,
    arrived,
  ])

  // The light leaves the right tiles, so it needs to know where they are. They
  // have just been marked correct in this same commit.
  useLayoutEffect(() => {
    if (!verdict || !live || flares.length > 0 || !grid.current) {
      return
    }

    const tiles = grid.current.querySelectorAll<HTMLElement>(
      '[data-state="correct"]',
    )

    setFlares(
      Array.from(tiles, (tile, index) => ({
        id: `strike-${resultsAt ?? 0}-${index}`,
        tone: "success",
        rect: rectOf(tile),
        rings: 3,
      })),
    )
  }, [verdict, live, flares.length, resultsAt])

  useFlares(flares)

  // The last five seconds' warm light holds through TIME, then eases back.
  useMoodOverride(phase === "time" && live ? "warm" : null)

  const shareFor = (slot: number) => {
    const { count, percent } = shares[slot]

    if (phase === "time") {
      return undefined
    }

    if (reducedMotion || phase !== "count") {
      return { count, percent }
    }

    const start = getRailStartMs(railOrder.indexOf(slot))
    const progress = Math.min(
      1,
      Math.max(0, (elapsedMs - start) / RESULT_RAIL_GROW_MS),
    )

    return { count, percent: Math.round(percent * easeOut(progress)) }
  }

  const tileState = (slot: number) => {
    if (!verdict) {
      return "result"
    }

    return solutions.includes(slot) ? "correct" : "wrong"
  }

  const headlineText = t(`game:reveal.headline.${headline.kind}`, {
    right: headline.right,
    of: headline.of,
    wrong: headline.wrong,
    letters: listLetters(headline.letters, i18n.language),
  })
  const timeText = t(crowd.allIn ? "game:reveal.allIn" : "game:reveal.time")
  // TIME holds in the row until the strike, then rises away for the headline.
  const timeShown =
    live && (phase === "time" || phase === "count" || phase === "spotlight")
  const timeLeaving = live && phase === "strike"

  return (
    <section
      data-response-screen
      data-reveal=""
      data-phase={phase}
      data-calm={calm ? "" : undefined}
      className="relative flex min-h-0 w-full flex-1 flex-col"
    >
      <div className="stage:max-w-[105rem] mx-auto flex min-h-0 w-full flex-1 flex-col">
        <div
          data-fit-box
          className="stage:overflow-visible stage:px-0 flex min-h-0 flex-1 flex-col overflow-y-auto px-4"
        >
          <div className="stage:gap-3 stage:py-0 my-auto flex w-full flex-col items-center gap-2 py-2">
            <QuestionNumber questionNumber={questionNumber} />
            <QuestionCard question={question} media={media} />
          </div>
        </div>

        {/* Where the clock and the count were: TIME, then the headline. */}
        <div className="stage:h-28 stage:px-0 relative flex h-14 items-center justify-center px-4">
          {(timeShown || timeLeaving) && (
            <div className="absolute inset-0 grid place-items-center">
              {crowd.allIn ? (
                <StageMoment
                  tone="brand"
                  leaving={timeLeaving}
                  className="stage:gap-5 stage:text-[4rem] flex items-center gap-2 text-[2rem]"
                >
                  <span className="rz-arrival-tick bg-brand text-on-accent stage:size-[4.5rem] grid size-9 shrink-0 place-items-center rounded-full">
                    <Check
                      aria-hidden="true"
                      className="stage:size-11 size-5 stroke-3"
                    />
                  </span>
                  <span data-time-label>{timeText}</span>
                </StageMoment>
              ) : (
                <StageMoment
                  tone="warning"
                  leaving={timeLeaving}
                  className="stage:text-[5rem] text-[2.25rem] tracking-[0.12em]"
                >
                  <span data-time-label>{timeText}</span>
                </StageMoment>
              )}
            </div>
          )}
          <p
            data-headline
            data-shown={elapsedMs >= RESULT_HEADLINE_MS ? "" : undefined}
            className="rz-headline text-text-primary stage:text-[2.75rem] text-center text-lg leading-tight font-bold text-balance"
          >
            {headlineText}
          </p>
          {fastest && (
            <p
              data-fastest
              data-shown={elapsedMs >= RESULT_FASTEST_MS ? "" : undefined}
              className="rz-headline text-text-muted stage:right-0 stage:text-[1.375rem] absolute right-4 bottom-0 text-sm font-semibold"
            >
              {t("game:reveal.fastest", {
                name: fastest.username,
                seconds: fastest.seconds,
              })}
            </p>
          )}
        </div>

        <div
          ref={grid}
          data-response-grid
          className={clsx(
            "stage:gap-4 stage:px-0 stage:pb-0 grid gap-2 px-4 pb-3",
            ANSWER_GRID_TRACKS.stage,
          )}
          style={answerVars(answers)}
        >
          {answers.map((answer, key) => (
            <AnswerTile
              key={key}
              index={key}
              state={tileState(key)}
              share={shareFor(key)}
              spot={phase === "spotlight" && crowd.top.includes(key)}
              className={answerSlotPlacement(key, answers.length)}
            >
              {answer}
            </AnswerTile>
          ))}
        </div>

        <div
          aria-hidden="true"
          className="stage:block stage:h-[max(5.4rem,8vh)] hidden"
        />
      </div>
    </section>
  )
}

export default Responses
