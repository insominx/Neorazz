import { STATUS, type Status } from "@razzia/common/types/game/status"
import { useAskStore } from "@razzia/web/features/ask/stores/ask"
import GameWrapper from "@razzia/web/features/game/components/GameWrapper"
import { act, cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// The question button in a phone's footer. The footer must be the same on
// every screen, so the button is always laid out and only hidden; a real
// browser measures the height (see the slice 2 evidence), this pins the
// structure that makes it so.

vi.mock("@razzia/web/components/Atmosphere", () => ({
  default: () => null,
}))

vi.mock("@razzia/web/features/game/components/VolumeControl", () => ({
  default: () => null,
}))

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  useEvent: vi.fn(),
  useSocket: () => ({ isConnected: true }),
}))

vi.mock("@razzia/web/features/game/stores/player", () => ({
  usePlayerStore: () => ({ player: { username: "Ann", points: 1200 } }),
}))

vi.mock("@razzia/web/features/game/stores/question", () => ({
  useQuestionStore: (select?: (_state: object) => unknown) => {
    const state = { questionStates: null, setQuestionStates: vi.fn() }

    return select ? select(state) : state
  },
}))

vi.mock("@razzia/web/features/game/audio/score", () => ({
  score: {
    configure: vi.fn(),
    start: vi.fn(),
    cue: vi.fn(),
    stop: vi.fn(),
    setRound: vi.fn(),
    dispose: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock("@razzia/web/features/game/hooks/use-show-intensity", () => ({
  useCalmVisuals: () => false,
  useShowIntensity: () => "full",
}))

vi.mock("@razzia/web/features/game/stores/sound", () => ({
  useSoundStore: {
    getState: () => ({ bindSurface: vi.fn() }),
  },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const PLAYER_SCREENS: Status[] = [
  STATUS.WAIT,
  STATUS.SHOW_START,
  STATUS.SHOW_PREPARED,
  STATUS.SHOW_QUESTION,
  STATUS.SELECT_ANSWER,
  STATUS.SHOW_RESULT,
  STATUS.SHOW_STANDING,
  STATUS.FINISHED,
]

const footerOf = (statusName: Status, offered: boolean) => {
  act(() => {
    useAskStore.getState().setOffered(offered)
  })

  const { container, unmount } = render(
    <GameWrapper statusName={statusName}>
      <div>screen</div>
    </GameWrapper>,
  )
  const button = container.querySelector<HTMLButtonElement>("[data-ask-button]")
  const footer = button?.parentElement
  const shape = {
    children: footer
      ? [...footer.children].map((child) => child.tagName)
      : null,
    footerClass: footer?.className ?? null,
    buttonClass: button?.className.replace(/\s*\binvisible\b/u, "") ?? null,
    hidden: button?.classList.contains("invisible") ?? null,
    disabled: button?.disabled ?? null,
    ariaHidden: button?.getAttribute("aria-hidden") ?? null,
    tabIndex: button?.getAttribute("tabindex") ?? null,
  }

  unmount()

  return shape
}

afterEach(() => {
  cleanup()
  useAskStore.getState().reset()
})

describe("the phone footer's question button", () => {
  it("is laid out on every screen, offered or not, in a footer of the same shape", () => {
    const reference = footerOf(STATUS.WAIT, true)

    expect(reference.children).toEqual(["P", "BUTTON", "DIV"])

    for (const screen of PLAYER_SCREENS) {
      for (const offered of [true, false]) {
        const shape = footerOf(screen, offered)

        expect(shape.children).toEqual(reference.children)
        expect(shape.footerClass).toBe(reference.footerClass)
        // Only the visibility differs, never the size.
        expect(shape.buttonClass).toBe(reference.buttonClass)
      }
    }
  })

  it("is hidden by visibility, out of reach, when it is not offered", () => {
    expect(footerOf(STATUS.SELECT_ANSWER, false)).toMatchObject({
      hidden: true,
      disabled: true,
      ariaHidden: "true",
      tabIndex: "-1",
    })
  })

  it("is visible and pressable when offered", () => {
    expect(footerOf(STATUS.WAIT, true)).toMatchObject({
      hidden: false,
      disabled: false,
      ariaHidden: null,
      tabIndex: null,
    })
  })

  it("is not drawn on the host's screen", () => {
    act(() => {
      useAskStore.getState().setOffered(true)
    })

    const { container } = render(
      <GameWrapper statusName={STATUS.SHOW_RESPONSES} manager>
        <div>screen</div>
      </GameWrapper>,
    )

    expect(container.querySelector("[data-ask-button]")).toBeNull()
  })
})
