import type { ManagerStatusDataMap } from "@razzia/common/types/game/status"
import { score } from "@razzia/web/features/game/audio"
import StageMoment from "@razzia/web/features/game/components/StageMoment"
import { useCalmVisuals } from "@razzia/web/features/game/hooks/use-show-intensity"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import {
  centreOf,
  type Flare,
  rectOf,
  useBeamFocus,
  useFlares,
  useFloorLight,
} from "@razzia/web/features/game/stores/stage-light"
import { MEDAL } from "@razzia/web/features/game/utils/game-constants"
import {
  CONFETTI_MS,
  podiumTimes,
  WINNER_MOMENT_MS,
} from "@razzia/web/features/game/utils/board"
import useScreenSize from "@razzia/web/hooks/useScreenSize"
import clsx from "clsx"
import { motion, useReducedMotion } from "motion/react"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import ReactConfetti from "react-confetti"

interface Props {
  data: ManagerStatusDataMap["FINISHED"]
}

interface Stage {
  third: boolean
  second: boolean
  /** The roll: first place is about to be named. */
  rolling: boolean
  first: boolean
  /** The winner's name holds over the podium. */
  moment: boolean
  confetti: boolean
}

const START: Stage = {
  third: false,
  second: false,
  rolling: false,
  first: false,
  moment: false,
  confetti: false,
}

/**
 * Third, then second, then a roll, then first: on the same clock as the score
 * (`podiumTimes`), pulled earlier for each place nobody holds so a room of one
 * or two does not sit through the silence.
 */
const usePodiumStage = (players: number): Stage => {
  const [stage, setStage] = useState<Stage>(START)

  useEffect(() => {
    const times = podiumTimes(players)
    const at = (seconds: number, patch: Partial<Stage>) =>
      setTimeout(
        () => setStage((current) => ({ ...current, ...patch })),
        seconds * 1_000,
      )

    setStage(START)

    const timers = [
      ...(times.third === null ? [] : [at(times.third, { third: true })]),
      ...(times.second === null ? [] : [at(times.second, { second: true })]),
      at(times.roll, { rolling: true }),
      at(times.first, {
        first: true,
        rolling: false,
        moment: true,
        confetti: true,
      }),
      at(times.first + WINNER_MOMENT_MS / 1_000, { moment: false }),
      at(times.first + CONFETTI_MS / 1_000, { confetti: false }),
    ]

    return () => {
      timers.forEach(clearTimeout)
    }
  }, [players])

  return stage
}

// Confetti draws from the same palette as the rest of the stage instead of
// the library's rainbow. The canvas needs literal colours, so the tokens are
// resolved once from the root; an empty read falls back to the default set.
const CONFETTI_TOKENS = [
  "--rz-answer-a",
  "--rz-answer-b",
  "--rz-answer-c",
  "--rz-answer-d",
  "--rz-brand",
  "--rz-medal-gold",
]

const readConfettiColors = (): string[] | undefined => {
  const styles = getComputedStyle(document.documentElement)
  const colors = CONFETTI_TOKENS.map((token) =>
    styles.getPropertyValue(token).trim(),
  ).filter(Boolean)

  return colors.length > 0 ? colors : undefined
}

// Names wrap to two lines and clip inside their column rather than widening
// it; `shrink-0` so the block below gives way instead of the name.
const PODIUM_NAME =
  "text-text-primary line-clamp-2 w-full shrink-0 px-2 text-center text-5xl font-bold text-balance wrap-break-word"

/** Block heights, in rem: the stage scales them with the projector. */
const BLOCK_REM = { 1: 30, 2: 23, 3: 17 } as const

const SPRING = { type: "spring", stiffness: 170, damping: 17, mass: 1 } as const

/**
 * A block rises on the spring but fades in on its own, linear and slower, so a
 * solid medal colour never pops in at full brightness (STYLE.md, "Light, not
 * paint").
 */
const RISE = { ...SPRING, opacity: { duration: 0.6, ease: "linear" } } as const

type PodiumPlace = 1 | 2 | 3

interface PlaceProps {
  /** Which block this is: the order the podium rises in. */
  rank: PodiumPlace
  /** The place it shows, shared by players level on points (1, 1, 3). */
  place: PodiumPlace
  name: string
  points: number
  up: boolean
  instant: boolean
}

/**
 * The place a podium player holds. Players level on points share one, as on
 * their phones and in the saved result: two tied for first both stand on gold.
 */
const placeOf = (
  top: Array<{ points: number }>,
  player: { points: number },
): PodiumPlace =>
  Math.max(
    1,
    top.findIndex((other) => other.points === player.points) + 1,
  ) as PodiumPlace

/** One solid block, risen from below the floor on a spring. */
const Place = ({ rank, place, name, points, up, instant }: PlaceProps) => (
  <motion.div
    data-podium-place={rank}
    data-shown-place={place}
    data-up={up}
    initial={false}
    animate={{ y: up ? 0 : "115%", opacity: up ? 1 : 0 }}
    transition={instant ? { duration: 0 } : RISE}
    className="flex w-full flex-col items-center gap-4"
  >
    <p className={PODIUM_NAME}>{name}</p>
    <div
      style={{ height: `${BLOCK_REM[place]}rem` }}
      className={clsx(
        "rounded-t-rz-lg flex w-full flex-col items-center justify-start gap-2 border-x-4 border-t-4 pt-6",
        MEDAL[place - 1],
      )}
    >
      <p className="font-mono text-[8rem] leading-none font-extrabold">
        {place}
      </p>
      <p className="font-mono text-5xl font-bold tabular-nums">
        {points.toLocaleString("en-US")}
      </p>
    </div>
  </motion.div>
)

/** The winner's name, landing in gold over the podium. */
const WINNER_NAME =
  "stage:text-[7rem] line-clamp-1 max-w-full px-6 text-center text-6xl wrap-break-word"

const Podium = ({ data: { subject, top } }: Props) => {
  const stage = usePodiumStage(top.length)
  const firstColumn = useRef<HTMLDivElement>(null)
  const [flares, setFlares] = useState<Flare[]>([])
  // A reviewed podium must not cut the live game's bed.
  const reviewing = useManagerStore((state) => state.review !== null)

  // When the podium first showed. Its scene has no server stamp, so the score
  // places it from when it is asked for.
  const [shownAt] = useState(() => Date.now())

  // Third, second, the roll and first, on the clock the stage follows. Asking
  // again while it plays is a no-op, so the reveals never restart it. Asking
  // again later (a lecture review over the hidden podium ends) passes how long
  // it has been up, so the ceremony is not played a second time.
  useEffect(() => {
    score.start(
      { scene: "podium", places: top.length },
      { silent: reviewing, offsetMs: Date.now() - shownAt },
    )
  }, [top.length, reviewing, shownAt])

  const calm = useCalmVisuals()
  const reduced = useReducedMotion() ?? false
  const { width, height } = useScreenSize()
  const [confettiColors] = useState(readConfettiColors)
  const first = top.at(0)
  const second = top.at(1)
  const third = top.at(2)

  // The roll: the beams turn in over first place, and stay on the winner for
  // the moment. First place: gold light rises from the floor and stays, and a
  // ring of gold leaves the block as it rises (STYLE.md, "Light, not paint").
  useBeamFocus(stage.rolling || stage.moment)
  useFloorLight(stage.first ? "gold" : null, 1)

  useLayoutEffect(() => {
    if (stage.first && firstColumn.current) {
      setFlares([
        {
          id: "winner",
          tone: "gold",
          rect: centreOf(rectOf(firstColumn.current)),
          rings: 2,
          round: true,
        },
      ])
    }
  }, [stage.first])

  useFlares(flares)

  return (
    <>
      {stage.confetti && !calm && (
        <ReactConfetti
          width={width}
          height={height}
          colors={confettiColors}
          recycle={false}
          numberOfPieces={420}
          className="h-full w-full"
        />
      )}

      <section className="animate-rz-screen-in relative mx-auto flex w-full max-w-[100rem] flex-1 flex-col items-center justify-between overflow-x-clip pb-[5.4rem]">
        <h2 className="text-text-primary mt-6 text-center text-6xl font-bold">
          {subject}
        </h2>

        {/* The winner's name lands here, between the title and the podium, and
            holds for the moment. The room is reserved so nothing moves. */}
        <div className="stage:h-[9rem] grid h-24 w-full place-items-center">
          {first && stage.first && (
            <StageMoment
              tone="gold"
              leaving={!stage.moment}
              className={WINNER_NAME}
            >
              <span data-podium-winner>{first.username}</span>
            </StageMoment>
          )}
        </div>

        {/* The floor: places stand on it, and a place that has not risen yet
            is below it and clipped. */}
        <div
          style={{
            gridTemplateColumns: `repeat(${top.length}, 22rem)`,
          }}
          className="grid w-full items-end justify-center gap-8 overflow-y-clip"
        >
          {second && (
            <div className="z-20 self-end">
              <Place
                rank={2}
                place={placeOf(top, second)}
                name={second.username}
                points={second.points}
                up={stage.second}
                instant={reduced}
              />
            </div>
          )}

          {first && (
            <div ref={firstColumn} className="relative z-30 self-end">
              {stage.rolling && (
                <div
                  data-podium-envelope
                  style={{ height: `${BLOCK_REM[1]}rem` }}
                  className="border-medal-gold-border text-medal-gold rounded-t-rz-lg absolute inset-x-0 bottom-0 grid animate-pulse place-items-center border-4 border-dashed font-mono text-[8rem] font-extrabold"
                >
                  ?
                </div>
              )}
              <Place
                rank={1}
                place={1}
                name={first.username}
                points={first.points}
                up={stage.first}
                instant={reduced}
              />
            </div>
          )}

          {third && (
            <div className="z-10 self-end">
              <Place
                rank={3}
                place={placeOf(top, third)}
                name={third.username}
                points={third.points}
                up={stage.third}
                instant={reduced}
              />
            </div>
          )}
        </div>
      </section>
    </>
  )
}

export default Podium
