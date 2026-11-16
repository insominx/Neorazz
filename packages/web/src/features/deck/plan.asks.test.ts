import type { LectureState } from "@razzia/common/types/game"
import { STATUS } from "@razzia/common/types/game/status"
import {
  buildBridgeState,
  type StateInputs,
} from "@razzia/web/features/deck/plan"
import { describe, expect, it } from "vitest"

const lecture = (extra: Partial<LectureState> = {}): LectureState => ({
  inviteCode: "123456",
  total: 2,
  played: [],
  current: null,
  finished: false,
  ...extra,
})

const inputs = (extra: Partial<StateInputs> = {}): StateInputs => ({
  connected: true,
  loggedIn: true,
  pending: null,
  reattaching: false,
  attached: true,
  gameId: "g-1",
  lecture: lecture(),
  status: { name: STATUS.SHOW_ROOM, data: {} },
  players: 3,
  visible: true,
  review: null,
  reviewable: [],
  ...extra,
})

describe("buildBridgeState and the question box", () => {
  it("reports a fresh lecture room as none waiting and open", () => {
    expect(buildBridgeState(inputs()).asks).toEqual({ waiting: 0, open: true })
  })

  it("reports the room's count and box", () => {
    expect(
      buildBridgeState(
        inputs({ lecture: lecture({ asks: { waiting: 4, open: false } }) }),
      ).asks,
    ).toEqual({ waiting: 4, open: false })
  })

  it("is null while not attached, and for a game that is not a lecture room", () => {
    const busy = lecture({ asks: { waiting: 4, open: true } })

    expect(
      buildBridgeState(inputs({ attached: false, lecture: busy })).asks,
    ).toBeNull()
    expect(buildBridgeState(inputs({ lecture: null })).asks).toBeNull()
  })

  it("copies the two numbers and nothing else, and never more than 10", () => {
    const { asks } = buildBridgeState(
      inputs({
        lecture: lecture({
          asks: {
            waiting: 99,
            open: true,
            text: "Why?",
            name: "Zelda",
          } as unknown as LectureState["asks"],
        }),
      }),
    )

    expect(asks).toEqual({ waiting: 10, open: true })
    expect(Object.keys(asks ?? {}).sort()).toEqual(["open", "waiting"])
  })
})
