import type { AskRecordMeta, AskRoomView } from "@razzia/common/types/ask"
import { inboxOrder } from "@razzia/web/features/ask/utils/inbox-order"
import { describe, expect, it } from "vitest"

const room = (gameId: string, waiting: number): AskRoomView => ({
  gameId,
  inviteCode: "123456",
  gameSubject: "Check-in",
  open: true,
  waiting,
  saved: true,
  record: null,
})

const record = (id: string, date: string, waiting: number): AskRecordMeta => ({
  id,
  gameSubject: "Check-in",
  date,
  total: waiting + 1,
  waiting,
  answered: 0,
})

const ids = (entries: ReturnType<typeof inboxOrder>) =>
  entries.map((entry) =>
    entry.kind === "room" ? entry.room.gameId : entry.meta.id,
  )

describe("inboxOrder", () => {
  it("puts unread first, then live rooms, then earlier records", () => {
    expect(
      ids(
        inboxOrder({
          rooms: [room("quiet-room", 0), room("busy-room", 2)],
          records: [
            record("old-read", "2026-11-10T18:00:00.000Z", 0),
            record("restarted-unread", "2026-11-17T18:00:00.000Z", 3),
          ],
        }),
      ),
    ).toEqual(["busy-room", "restarted-unread", "quiet-room", "old-read"])
  })

  it("keeps the unread questions of a restarted room at the top", () => {
    expect(
      ids(
        inboxOrder({
          rooms: [room("new-room", 0)],
          records: [record("before-restart", "2026-11-17T18:00:00.000Z", 2)],
        }),
      ),
    ).toEqual(["before-restart", "new-room"])
  })

  it("lists the newest first within each group", () => {
    expect(
      ids(
        inboxOrder({
          // The server lists live rooms oldest first.
          rooms: [room("held-room", 0), room("current-room", 0)],
          records: [
            record("monday", "2026-11-16T18:00:00.000Z", 0),
            record("tuesday", "2026-11-17T18:00:00.000Z", 0),
          ],
        }),
      ),
    ).toEqual(["current-room", "held-room", "tuesday", "monday"])
  })
})
