import { LECTURE_TEXT } from "@razzia/common/constants"
import { STATUS, type Status } from "@razzia/common/types/game/status"
import { canAsk } from "@razzia/web/features/ask/utils/can-ask"
import { describe, expect, it } from "vitest"

const OPEN = { open: true }

describe("canAsk", () => {
  // Every status a phone can be on, and the WAIT texts the server and the join
  // page use: pinned, so a new wait text has to be placed here on purpose.
  it.each<[Status, string | undefined, boolean]>([
    [STATUS.WAIT, "game:waitingForPlayers", true],
    [STATUS.WAIT, LECTURE_TEXT.NEXT_QUESTION, true],
    [STATUS.WAIT, LECTURE_TEXT.FINAL_STANDINGS, true],
    [STATUS.WAIT, LECTURE_TEXT.QUIZ_OVER, true],
    [STATUS.WAIT, "game:waitingForAnswers", false],
    [STATUS.SHOW_RESULT, undefined, true],
    [STATUS.SHOW_STANDING, undefined, true],
    [STATUS.FINISHED, undefined, true],
    [STATUS.SHOW_START, undefined, false],
    [STATUS.SHOW_PREPARED, undefined, false],
    [STATUS.SHOW_QUESTION, undefined, false],
    [STATUS.SELECT_ANSWER, undefined, false],
    [STATUS.SHOW_ROOM, undefined, false],
    [STATUS.SHOW_RESPONSES, undefined, false],
    [STATUS.SHOW_LEADERBOARD, undefined, false],
  ])("%s %s: %s with the box open", (status, waitText, expected) => {
    expect(canAsk({ status, waitText, box: OPEN, pollShowing: false })).toBe(
      expected,
    )
  })

  it("pins the lecture wait texts the table names", () => {
    expect(LECTURE_TEXT).toEqual({
      NEXT_QUESTION: "game:lectureNextQuestion",
      FINAL_STANDINGS: "game:lectureFinalStandings",
      QUIZ_OVER: "game:lectureQuizOver",
    })
  })

  it("covers every status there is", () => {
    const listed = new Set<string>([
      STATUS.WAIT,
      STATUS.SHOW_RESULT,
      STATUS.SHOW_STANDING,
      STATUS.FINISHED,
      STATUS.SHOW_START,
      STATUS.SHOW_PREPARED,
      STATUS.SHOW_QUESTION,
      STATUS.SELECT_ANSWER,
      STATUS.SHOW_ROOM,
      STATUS.SHOW_RESPONSES,
      STATUS.SHOW_LEADERBOARD,
    ])

    expect(new Set(Object.values(STATUS))).toEqual(listed)
  })

  it("is never offered while the box is closed or unknown", () => {
    expect(
      canAsk({
        status: STATUS.FINISHED,
        waitText: undefined,
        box: { open: false },
        pollShowing: false,
      }),
    ).toBe(false)
    expect(
      canAsk({
        status: STATUS.FINISHED,
        waitText: undefined,
        box: null,
        pollShowing: false,
      }),
    ).toBe(false)
  })

  it("is never offered while a poll shows", () => {
    expect(
      canAsk({
        status: STATUS.FINISHED,
        waitText: undefined,
        box: OPEN,
        pollShowing: true,
      }),
    ).toBe(false)
  })

  it("is never offered before the phone has a screen", () => {
    expect(
      canAsk({
        status: null,
        waitText: undefined,
        box: OPEN,
        pollShowing: false,
      }),
    ).toBe(false)
    expect(
      canAsk({
        status: undefined,
        waitText: undefined,
        box: OPEN,
        pollShowing: false,
      }),
    ).toBe(false)
  })
})
