import { EVENTS } from "@razzia/common/constants"
import type { AskRecordReply } from "@razzia/common/types/ask"
import { useInboxStore } from "@razzia/web/features/ask/stores/inbox"
import {
  useEvent,
  useSocket,
} from "@razzia/web/features/game/contexts/socket-context"
import { emitWithAck } from "@razzia/web/features/poll/utils/emit-with-ack"
import { useEffect } from "react"

/**
 * Keeps the inbox in step with the server. It watches on every connection
 * (a phone that locked and woke is a new socket, which the server does not
 * know as a watcher), shows the login when the server no longer knows this
 * one, and watches again once it is back. Leaving the page stops the watch
 * and forgets everything it held.
 */
export const useInbox = () => {
  const { socket, isConnected } = useSocket()

  const refetch = async (id: string) => {
    const reply = await emitWithAck<AskRecordReply>((ack) => {
      socket.emit(EVENTS.ASKS.RECORD_GET, { recordId: id }, ack)
    })

    if (reply !== "noAck" && reply.outcome === "accepted") {
      useInboxStore.getState().setOpened(id, reply.record)
    } else if (reply !== "noAck" && reply.outcome === "notFound") {
      useInboxStore.getState().setOpened(id, null)
    }
  }

  useEvent(EVENTS.ASKS.LIVE, (live) => {
    useInboxStore.getState().setLive(live)

    // Earlier records opened on this page may have changed elsewhere (a
    // second device): fetch each again.
    for (const id of Object.keys(useInboxStore.getState().opened)) {
      void refetch(id)
    }
  })

  useEvent(EVENTS.ASKS.ROOM, (room) => {
    useInboxStore.getState().upsertRoom(room)
  })

  useEvent(EVENTS.MANAGER.UNAUTHORIZED, () => {
    useInboxStore.getState().loggedOut()
  })

  // The answer to a login typed on this page.
  useEvent(EVENTS.MANAGER.CONFIG, () => {
    useInboxStore.getState().loggedIn()
    socket.emit(EVENTS.ASKS.WATCH)
  })

  useEffect(() => {
    if (isConnected) {
      socket.emit(EVENTS.ASKS.WATCH)
    }
  }, [isConnected, socket])

  useEffect(
    () => () => {
      socket.emit(EVENTS.ASKS.UNWATCH)
      useInboxStore.getState().reset()
    },
    [socket],
  )

  return { refetch }
}

/**
 * The curtain: the inbox shows counts only until **Show questions**, and goes
 * back to counts whenever the page is hidden (another tab, the phone locked,
 * the app switched) or the window loses focus (another window over it on a
 * laptop that is projecting). Nothing times out on its own: a phone on the
 * podium must stay readable.
 */
export const useCurtain = () => {
  useEffect(() => {
    const curtain = () => {
      useInboxStore.getState().curtain()
    }
    const onVisibility = () => {
      if (document.visibilityState !== "visible") {
        curtain()
      }
    }

    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("blur", curtain)
    window.addEventListener("pagehide", curtain)

    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("blur", curtain)
      window.removeEventListener("pagehide", curtain)
    }
  }, [])
}
