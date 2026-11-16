import type { CommonStatusDataMap } from "@razzia/common/types/game/status"
import { score } from "@razzia/web/features/game/audio"
import QuestionNumber from "@razzia/web/features/game/components/QuestionNumber"
import RoundPips from "@razzia/web/features/game/components/RoundPips"
import StageMoment from "@razzia/web/features/game/components/StageMoment"
import { useRoundProgress } from "@razzia/web/features/game/hooks/use-round-progress"
import { useLaunchStore } from "@razzia/web/features/game/stores/launch"
import {
  centreOf,
  type Flare,
  rectOf,
  useFlares,
  useFloorLight,
} from "@razzia/web/features/game/stores/stage-light"
import clsx from "clsx"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"

interface Props {
  data: CommonStatusDataMap["SHOW_PREPARED"]
}

/** GO holds the card this long. */
const GO_MS = 900

/** How long GO takes to rise away as the card comes up. */
const GO_LEAVE_MS = 400

type GoPhase = "go" | "leaving" | null

/**
 * The round card: which question this is, how far through the quiz, and, on the
 * last one, that it is the last. The first card after the countdown opens with
 * GO: the word lands in brand teal, a ring of its light leaves it and the floor
 * light rises, then GO lifts away as the card comes up under it.
 */
const Prepared = ({ data: { questionNumber } }: Props) => {
  const { t } = useTranslation()
  const progress = useRoundProgress(questionNumber)
  const { total, done } = progress
  const [go, setGo] = useState<GoPhase>(null)
  const [flares, setFlares] = useState<Flare[]>([])
  const word = useRef<HTMLParagraphElement>(null)
  const known = total !== undefined && total > 1
  const final = known && progress.final

  // The whoosh of a new card; the first card's GO is the countdown's own.
  useEffect(() => {
    score.start({ scene: "roundCard" })
  }, [])

  useEffect(() => {
    if (!useLaunchStore.getState().consume()) {
      return
    }

    setGo("go")

    const leave = setTimeout(() => setGo("leaving"), GO_MS)
    const gone = setTimeout(() => setGo(null), GO_MS + GO_LEAVE_MS)

    return () => {
      clearTimeout(leave)
      clearTimeout(gone)
    }
  }, [])

  // GO's ring leaves the word itself.
  useLayoutEffect(() => {
    if (go === "go" && word.current) {
      setFlares([
        {
          id: "go",
          tone: "brand",
          rect: centreOf(rectOf(word.current)),
          rings: 1,
          round: true,
        },
      ])
    }

    if (go === null) {
      setFlares([])
    }
  }, [go])

  useFloorLight(go === "go" ? "brand" : null, 0.5)
  useFlares(flares)

  return (
    <section className="animate-rz-screen-in stage:gap-10 relative mx-auto flex w-full max-w-7xl flex-1 flex-col items-center justify-center gap-6">
      {go && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <StageMoment
            ref={word}
            tone="brand"
            leaving={go === "leaving"}
            className="stage:text-[16rem] text-[7rem] tracking-[-0.03em]"
          >
            <span data-go>{t("game:go")}</span>
          </StageMoment>
        </div>
      )}

      {go !== "go" && (
        <>
          <QuestionNumber questionNumber={questionNumber} intro />

          <p
            data-round-number
            data-final={final ? "" : undefined}
            className={clsx(
              "animate-rz-enter stage:text-[18rem] text-[9rem] leading-none font-extrabold tabular-nums",
              final ? "text-warning" : "text-text-primary",
            )}
          >
            {questionNumber}
          </p>

          {known && (
            <RoundPips current={questionNumber} total={total} done={done} />
          )}
        </>
      )}
    </section>
  )
}

export default Prepared
