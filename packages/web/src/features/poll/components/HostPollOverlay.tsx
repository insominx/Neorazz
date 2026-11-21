import { EVENTS } from "@razzia/common/constants"
import type { PollOutcome } from "@razzia/common/types/poll"
import Button from "@razzia/web/components/Button"
import { IS_DECK_EMBED } from "@razzia/web/features/deck/embed"
import { useSocket } from "@razzia/web/features/game/contexts/socket-context"
import { useCalmVisuals } from "@razzia/web/features/game/hooks/use-show-intensity"
import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import ArrivalSpotlight from "@razzia/web/features/poll/components/ArrivalSpotlight"
import PollBars from "@razzia/web/features/poll/components/PollBars"
import PollFrame from "@razzia/web/features/poll/components/PollFrame"
import { useHeartbeat } from "@razzia/web/features/poll/hooks/use-heartbeat"
import {
  type PollArrival,
  usePollStore,
} from "@razzia/web/features/poll/stores/poll"
import { emitWithAck } from "@razzia/web/features/poll/utils/emit-with-ack"
import { splitVotes } from "@razzia/web/features/poll/utils/split-votes"
import {
  QUESTION_CLASSES,
  questionTier,
} from "@razzia/web/features/poll/utils/type-tier"
import clsx from "clsx"
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import toast from "react-hot-toast"
import { useTranslation } from "react-i18next"

const QUESTION_ID = "poll-question"

// The rings of light from the vote number: at most this many born from one
// tally (a jump of several votes), and at most this many spreading at once.
// A ring lives out its whole animation; when too many are spreading, a new one
// is not born, rather than an old one cut off part-way.
const RINGS_PER_TALLY = 3
const RINGS_SPREADING = 8
// How long a ring may stay if its animation never ends (reduced motion turns
// it off): longer than the 1400ms ring.
const RING_LIFE_MS = 3_000

/**
 * The rings spreading now, by arrival `seq`, and how a ring says it is done.
 * `newest` is the open poll's newest arrival (0 when none, or not open). A
 * ring is born only for an arrival that comes while `ringing` (not calm); none
 * is kept or drawn while it is off, and none is born late for an arrival that
 * came while it was off.
 */
const useArrivalRings = (
  arrivals: PollArrival[],
  newest: number,
  ringing: boolean,
) => {
  const [rings, setRings] = useState<number[]>([])
  const [seen, setSeen] = useState(newest)

  // Adjusted while rendering (React's pattern for state that follows props),
  // so a ring is drawn in the same frame as the vote that sends it.
  if (newest !== seen) {
    setSeen(newest)

    // Fewer than seen: the poll closed, or a new one began again from 1.
    const kept = newest > seen ? rings : []
    const room = Math.max(0, RINGS_SPREADING - kept.length)
    const born =
      ringing && newest > seen
        ? arrivals
            .filter(({ seq }) => seq > seen)
            .slice(-RINGS_PER_TALLY)
            .map(({ seq }) => seq)
        : []

    setRings([
      ...kept,
      ...born.slice(born.length - Math.min(room, born.length)),
    ])
  } else if (!ringing && rings.length > 0) {
    setRings([])
  }

  const done = useCallback((seq: number) => {
    setRings((spreading) => spreading.filter((ring) => ring !== seq))
  }, [])

  return { rings: ringing ? rings : [], done }
}

// What the line above the question says about who can see the votes. On the
// manager's own screen the host sees names beside the votes of a named poll.
// In a deck's frame this screen is the projector and draws no name, so it says
// where the names are instead of claiming the host sees them here.
const privacyKey = (anonymous: boolean) => {
  if (anonymous) {
    return "poll:privacy.anonymous"
  }

  return IS_DECK_EMBED ? "poll:privacy.namedStage" : "poll:privacy.named"
}

/**
 * One ring of light from the vote number. It is born where the number's box
 * centres it, then stays on that spot for its whole life: the line re-centres
 * as its text changes ("1 vote" to "2 votes", 9 to 10), and a ring that moved
 * with it would jump. It is pinned before the first paint, from its own
 * layout offsets (whole pixels) trued up against where it was drawn, so
 * pinning it moves nothing.
 */
const ArrivalPulse = ({ onDone }: { onDone: () => void }) => {
  const ref = useRef<HTMLSpanElement>(null)

  // The latest callback, so the ring's one timer is not reset by a render.
  const done = useRef(onDone)

  useLayoutEffect(() => {
    done.current = onDone
  })

  // Done when its animation ends, or after its time if it never runs.
  useEffect(() => {
    const ring = ref.current
    const finish = (event: AnimationEvent) => {
      if (event.target === ring) {
        done.current()
      }
    }
    const timer = setTimeout(() => {
      done.current()
    }, RING_LIFE_MS)

    ring?.addEventListener("animationend", finish)

    return () => {
      clearTimeout(timer)
      ring?.removeEventListener("animationend", finish)
    }
  }, [])

  useLayoutEffect(() => {
    const ring = ref.current

    if (!ring?.offsetParent) {
      return
    }

    const born = ring.getBoundingClientRect()
    let left = ring.offsetLeft + ring.offsetWidth / 2
    let top = ring.offsetTop + ring.offsetHeight / 2
    const pin = () => {
      ring.style.left = `${left}px`
      ring.style.top = `${top}px`
    }

    ring.style.translate = "-50% -50%"
    pin()

    // The screen may be drawn scaled; offsets are in the ring's own pixels.
    const pinned = ring.getBoundingClientRect()
    const scale = ring.offsetWidth ? pinned.width / ring.offsetWidth : 1

    if (scale > 0) {
      left += (born.left - pinned.left) / scale
      top += (born.top - pinned.top) / scale
      pin()
    }

    // Unpinned again on unmount, so a second run (React's strict mode)
    // measures the ring where the number's box puts it.
    return () => {
      ring.style.removeProperty("left")
      ring.style.removeProperty("top")
      ring.style.removeProperty("translate")
    }
  }, [])

  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-poll-pulse
      className="rz-arrival-pulse"
    />
  )
}

/**
 * The room's poll, on the host's screen: the question and how many have voted
 * while it is open (and, when the poll is live, the votes as they come in),
 * then, when the host closes it, the result, until the host says Done. The quiz
 * screen under it is untouched.
 *
 * It draws what the server sent. A sealed poll is sent without counts until
 * the close, so an open poll with none is shown as the options alone.
 *
 * While it is open the room hears and sees each vote arrive: the voter's name
 * lands under the options (`ArrivalSpotlight`; an anonymous live poll shows
 * no name), a ring of light leaves the vote number, the room's light rises
 * with the share that has voted, and a heartbeat quickens until everyone is in.
 *
 * In a deck's frame this screen is the projector. Who voted for what is never
 * drawn there, even for a named poll (it is saved in the result and shown on
 * the manager page afterwards); a sealed or named poll's arrivals name who has
 * voted, never their pick. Close and Done show only while the presenter has
 * Razzia's own controls up (the deck's Q key): the deck closes and dismisses
 * the poll from the clicker.
 */
const HostPollOverlay = () => {
  const live = usePollStore((state) => state.snapshot)
  // A closed poll's result shown again (a deck's frame only) covers the stage:
  // the same screen as at its close, settled, with no button.
  const review = usePollStore((state) => (IS_DECK_EMBED ? state.review : null))
  const snapshot = review
    ? {
        question: review.question,
        options: review.options,
        anonymous: review.anonymous,
        phase: "closed" as const,
        counts: review.counts,
        total: review.total,
        voters: undefined,
      }
    : live
  const gameId = useManagerStore((state) => state.gameId)
  const backgroundUrl = useManagerStore((state) => state.visuals.backgroundUrl)
  const hostControls = useManagerStore((state) => state.hostControls)
  const connectedPlayers = useManagerStore((state) =>
    state.presenceKnown
      ? state.players.filter((player) => player.connected).length
      : null,
  )
  const playerTotal = usePollStore((state) => state.playerTotal)
  const arrivals = usePollStore((state) => state.arrivals)
  const calm = useCalmVisuals()
  const { socket, isConnected } = useSocket()
  const { t } = useTranslation()
  // A click is answered once; a second one while it waits would only repeat it.
  const [pending, setPending] = useState(false)

  const closed = snapshot?.phase === "closed"
  const total = snapshot?.total ?? 0
  const open = snapshot !== null && !closed && review === null
  // How many are here, for the room's light and the heartbeat's pace. The
  // membership count stands in only while presence is unknown, and only for
  // these; the line on screen and "everyone's in" use the connected count.
  const room = connectedPlayers ?? playerTotal
  const share = room ? Math.min(1, total / room) : 0
  const allIn =
    open && connectedPlayers !== null && connectedPlayers > 0
      ? total >= connectedPlayers
      : false
  const beats = useHeartbeat(open && total > 0 && !allIn, share)
  const lastArrival = open ? (arrivals.at(-1)?.seq ?? 0) : 0
  const { rings, done } = useArrivalRings(arrivals, lastArrival, open && !calm)

  if (!snapshot) {
    return null
  }

  const { question, options, anonymous } = snapshot
  const sealed = !closed && snapshot.counts === undefined
  const counts = snapshot.counts ?? options.map(() => 0)
  const flash = lastArrival > 0 && !calm ? "rz-arrival-flash" : undefined
  const {
    before: votesBefore,
    number: votesNumber,
    after: votesAfter,
  } = splitVotes(t, total)
  // The room's light: the share that has voted while open, back to its rest
  // once closed, and none for a result shown again.
  let lift: number | undefined = undefined

  if (review === null) {
    lift = open ? share : 0
  }

  const send = async (
    event:
      | typeof EVENTS.MANAGER.CLOSE_POLL
      | typeof EVENTS.MANAGER.DISMISS_POLL,
  ) => {
    if (pending || !gameId) {
      return
    }

    setPending(true)

    const outcome = await emitWithAck<PollOutcome>((ack) => {
      socket.emit(event, { gameId }, ack)
    })

    setPending(false)

    // The room's own state change is what closes or clears the screen; a
    // refusal or a silence leaves it up, and the host is told why.
    if (outcome !== "accepted") {
      toast.error(t(`poll:outcome.${outcome}`), { id: "poll-command" })
      socket.emit(EVENTS.POLL.SYNC, { gameId })
    }
  }

  return (
    <PollFrame
      backgroundUrl={backgroundUrl}
      labelledBy={QUESTION_ID}
      deckKeys={IS_DECK_EMBED}
      settled={review !== null}
      lift={lift}
      breath={beats}
    >
      {hostControls && !review && (
        <div className="absolute top-4 left-4 z-10">
          <Button
            className="bg-surface border-border text-text-primary hover:bg-panel border px-4 pointer-coarse:min-h-[44px]"
            disabled={pending}
            onClick={() => {
              void send(
                closed
                  ? EVENTS.MANAGER.DISMISS_POLL
                  : EVENTS.MANAGER.CLOSE_POLL,
              )
            }}
          >
            {closed ? t("poll:host.done") : t("poll:host.close")}
          </Button>
        </div>
      )}

      <main className="stage:max-w-[105rem] stage:gap-6 stage:px-0 stage:pb-[max(5.4rem,8vh)] stage:pt-[5.5rem] mx-auto flex min-h-0 w-full flex-1 flex-col items-center gap-4 overflow-y-auto px-4 pt-20 pb-6">
        <header className="stage:gap-3 flex w-full flex-col items-center gap-2 text-center">
          <p className="text-brand stage:text-[1.5rem] text-xs font-bold tracking-[0.12em] uppercase">
            {closed ? t("poll:host.closedNote") : t("poll:label")}
            {" · "}
            <span className="text-text-muted">{t(privacyKey(anonymous))}</span>
          </p>
          <h2
            id={QUESTION_ID}
            className={clsx(
              "text-text-primary leading-tight font-bold text-balance break-words",
              QUESTION_CLASSES[questionTier(question)],
            )}
          >
            {question}
          </h2>
          <p
            data-poll-voted
            className="text-text-muted stage:text-[2.6875rem] text-lg font-semibold"
          >
            {total === 0 && closed ? (
              t("poll:noOneVoted")
            ) : (
              <>
                {/* Each arrival flashes the line and pops its number. Only
                    the words and the number are keyed to the arrival; the
                    rings beside the number are not, so a new vote never
                    restarts a ring already spreading, and no ring sits
                    inside the number's scaling. */}
                {votesBefore && (
                  <span key={`before-${lastArrival}`} className={flash}>
                    {votesBefore}
                  </span>
                )}
                <span className="rz-arrival-number">
                  {rings.map((seq) => (
                    <ArrivalPulse key={seq} onDone={() => done(seq)} />
                  ))}
                  <span
                    key={lastArrival}
                    className={clsx(flash && "rz-arrival-count")}
                  >
                    {votesNumber}
                  </span>
                </span>
                {votesAfter && (
                  <span key={`after-${lastArrival}`} className={flash}>
                    {votesAfter}
                  </span>
                )}
                {!closed && isConnected && connectedPlayers !== null && (
                  <> · {t("game:connected", { count: connectedPlayers })}</>
                )}
              </>
            )}
          </p>
          {/* A label, like the one above the question: it tells the presenter
              what the screen is doing. The room does not have to read it, so
              it is not held to the room-readable size (STYLE.md). */}
          {sealed && (
            <p
              data-poll-sealed
              className="text-text-muted stage:text-[1.5rem] text-xs font-bold tracking-[0.12em] uppercase"
            >
              {t("poll:host.sealedNote")}
            </p>
          )}
        </header>

        {/* Keyed by the poll: another poll gets new bars, drawn from 0 or
            settled where it was left, never slid from this one's widths. */}
        <PollBars
          key={review ? review.id : live?.pollId}
          options={options}
          counts={counts}
          total={total}
          voters={IS_DECK_EMBED ? undefined : snapshot.voters}
          sealed={sealed}
          settled={review !== null}
        />

        {/* Keyed by the poll: a direct switch to another open poll resets
            the spotlight, its trail and its seen sequence number. Prefixed so
            it never shares a React key with sibling PollBars. */}
        {open && (
          <ArrivalSpotlight
            key={live ? `arrivals:${live.pollId}` : undefined}
            allIn={allIn}
            room={room}
          />
        )}
      </main>
    </PollFrame>
  )
}

export default HostPollOverlay
