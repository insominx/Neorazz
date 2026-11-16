import { useManagerStore } from "@razzia/web/features/game/stores/manager"
import HostPollOverlay from "@razzia/web/features/poll/components/HostPollOverlay"
import { usePollStore } from "@razzia/web/features/poll/stores/poll"
import { useEffect } from "react"

const POLL_ID = "dev-poll"

// When each vote lands, in seconds from the start: a trickle, a burst, then
// the stragglers, so the screen shows a single name, a fold and "Everyone's in".
const ARRIVALS_S = [
  1.2, 2.4, 3.1, 4.0, 4.3, 4.5, 4.6, 5.8, 6.9, 7.4, 8.6, 9.0, 9.9, 11.2, 12.0,
  13.1, 14.3, 15.6,
]

/**
 * Dev only: a sealed, named poll on the host's screen with a simulated room
 * voting into it, so the Director can show (and measure) the poll's arrivals
 * the way it shows the quiz's live fixtures.
 */
const DevPollRun = () => {
  useEffect(() => {
    const manager = useManagerStore.getState()
    const { players } = manager

    manager.setGameId("dev-frame")
    manager.applyPresence({ gameId: "dev-frame", players })
    usePollStore.getState().apply({
      pollId: POLL_ID,
      question: "Which part of the quiz should feel more like the poll?",
      options: ["The reveal", "The podium", "The phones", "All of it"],
      anonymous: false,
      phase: "open",
      total: 0,
    })

    const timers = ARRIVALS_S.slice(0, players.length).map((seconds, index) =>
      setTimeout(() => {
        usePollStore.getState().applyTally({
          pollId: POLL_ID,
          total: index + 1,
          arrived: players[index]?.username,
        })
      }, seconds * 1_000),
    )

    return () => {
      timers.forEach(clearTimeout)
      usePollStore.getState().reset()
    }
  }, [])

  return <HostPollOverlay />
}

export default DevPollRun
