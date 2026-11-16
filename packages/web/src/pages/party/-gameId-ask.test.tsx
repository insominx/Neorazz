import { EVENTS } from "@razzia/common/constants"
import type { PollSnapshot } from "@razzia/common/types/poll"
import { useAskStore } from "@razzia/web/features/ask/stores/ask"
import { DRAFT_KEY } from "@razzia/web/features/ask/utils/draft"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"
import { useQuestionStore } from "@razzia/web/features/game/stores/question"
import { usePollStore } from "@razzia/web/features/poll/stores/poll"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A phone's game page with its question lane: the real poll shell, the real
// footer button and the real fold-out, with the server's events played in by
// hand.

const mocks = vi.hoisted(() => {
  const emit = vi.fn()

  return {
    navigate: vi.fn(),
    emit,
    // One socket, as the app's is: a page that re-renders keeps it.
    socket: { emit },
    connected: true,
    handlers: new Map<string, (_payload?: unknown) => void>(),
  }
})

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  socketClient: { emit: mocks.emit, connected: false },
  useEvent: (event: string, handler: (_payload?: unknown) => void) => {
    mocks.handlers.set(event, handler)
  },
  useSocket: () => ({
    socket: mocks.socket,
    isConnected: mocks.connected,
  }),
}))

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
  useNavigate: () => mocks.navigate,
  useParams: () => ({ gameId: "g1" }),
}))

// The quiz's own frame is left out; its footer's button is kept.
vi.mock("@razzia/web/features/game/components/GameWrapper", async () => {
  const { default: AskButton } =
    await import("@razzia/web/features/ask/components/AskButton")

  return {
    default: ({ children }: { children: ReactNode }) => (
      <div data-testid="game">
        {children}
        <footer>
          <AskButton />
        </footer>
      </div>
    ),
  }
})

vi.mock("@razzia/web/features/game/components/GameScreenBoundary", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@razzia/web/features/game/utils/constants", () => ({
  GAME_STATE_COMPONENTS: { WAIT: () => <p>the quiz screen</p> },
  isKeyOf: (obj: object, key: string) => key in obj,
}))

vi.mock("@razzia/web/components/Atmosphere", () => ({ default: () => null }))

vi.mock("@razzia/web/features/game/hooks/use-show-intensity", () => ({
  useCalmVisuals: () => false,
}))

vi.mock("react-hot-toast", () => ({
  default: { success: vi.fn(), error: vi.fn() },
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

interface RouteOptions {
  component: () => ReactNode
}

const mount = async () => {
  const { Route } = await import("@razzia/web/pages/party/$gameId")
  const { component: Page } = (Route as unknown as { options: RouteOptions })
    .options

  return render(<Page />)
}

const serverSends = (event: string, payload?: unknown) => {
  act(() => {
    mocks.handlers.get(event)?.(payload)
  })
}

// The element a selector names; a missing one fails the test there.
const required = (selector: string): Element => {
  const found = document.querySelector(selector)

  if (!found) {
    throw new Error(`No ${selector} on the page`)
  }

  return found
}

const syncs = () =>
  mocks.emit.mock.calls.filter(([event]) => event === EVENTS.ASK.SYNC)

const button = () =>
  document.querySelector<HTMLButtonElement>("[data-ask-button]")

const sheet = () => document.querySelector("[data-ask-sheet]")

const offered = () => {
  const element = button()

  return (
    element !== null &&
    !element.disabled &&
    !element.classList.contains("invisible")
  )
}

const openSheet = () => {
  const element = button()

  if (element) {
    fireEvent.click(element)
  }
}

const typeQuestion = (text: string) => {
  const area = document.querySelector("[data-ask-text]")

  if (area) {
    fireEvent.change(area, { target: { value: text } })
  }
}

const lunch: PollSnapshot = {
  pollId: "lunch",
  question: "Lunch?",
  options: ["Pizza", "Soup"],
  anonymous: true,
  phase: "open",
  mine: null,
}

const reconnectPayload = {
  gameId: "g1",
  status: { name: "WAIT", data: { text: "game:waitingForPlayers" } },
  player: { username: "Ann", points: 0 },
  currentQuestion: { current: 1, total: 2 },
  visuals: {},
}

beforeEach(() => {
  mocks.navigate.mockClear()
  mocks.emit.mockClear()
  mocks.handlers.clear()
  mocks.connected = true
  window.sessionStorage.clear()
  usePollStore.getState().reset()
  usePlayerStore.getState().reset()
  useAskStore.getState().reset()
  useAskStore.getState().clearDraft()
  useAskStore.getState().setResult(null)
  useQuestionStore.setState({ questionStates: null })
  usePlayerStore.setState({
    gameId: "g1",
    status: {
      name: "WAIT",
      data: { text: "game:waitingForPlayers" },
    } as never,
  })
})

afterEach(() => {
  cleanup()
})

describe("player game page and the question lane", () => {
  it("asks whether it can send as soon as it has opened on a game", async () => {
    await mount()

    expect(syncs()).toEqual([[EVENTS.ASK.SYNC, { gameId: "g1" }]])
    expect(button()).not.toBeNull()
    expect(offered()).toBe(false)
  })

  it("offers the button once the server says the box is open", async () => {
    await mount()

    serverSends(EVENTS.ASK.BOX, { open: true })

    expect(offered()).toBe(true)
  })

  it("asks again after every reconnect", async () => {
    await mount()

    serverSends(EVENTS.PLAYER.SUCCESS_RECONNECT, reconnectPayload)
    serverSends(EVENTS.PLAYER.SUCCESS_RECONNECT, reconnectPayload)

    expect(syncs()).toHaveLength(3)
  })

  it("shows no button after a reconnect when the box was paused while it was away", async () => {
    await mount()
    serverSends(EVENTS.ASK.BOX, { open: true })
    expect(offered()).toBe(true)

    // Away: the room's `ask:box { open: false }` never reached this phone.
    // Back: the page asks, and the server answers what it holds now.
    serverSends(EVENTS.PLAYER.SUCCESS_RECONNECT, reconnectPayload)
    expect(syncs()).toHaveLength(2)
    serverSends(EVENTS.ASK.BOX, { open: false })

    expect(offered()).toBe(false)
    expect(button()?.classList.contains("invisible")).toBe(true)
  })

  it("closes the fold-out when a poll arrives over it, and keeps the draft", async () => {
    await mount()
    serverSends(EVENTS.ASK.BOX, { open: true })
    openSheet()
    typeQuestion("Why is the sky blue?")

    serverSends(EVENTS.POLL.STATE, lunch)

    expect(sheet()).toBeNull()
    expect(offered()).toBe(false)
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Lunch?")
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toContain(
      "Why is the sky blue?",
    )

    serverSends(EVENTS.POLL.STATE, null)
    expect(offered()).toBe(true)
    openSheet()

    expect(
      document.querySelector<HTMLTextAreaElement>("[data-ask-text]")?.value,
    ).toBe("Why is the sky blue?")
  })

  it("closes the fold-out when a question starts under it, and keeps the draft", async () => {
    await mount()
    serverSends(EVENTS.ASK.BOX, { open: true })
    openSheet()
    typeQuestion("Can you go back one slide?")

    act(() => {
      usePlayerStore.getState().setStatus("SHOW_PREPARED", {
        totalAnswers: 4,
        questionNumber: 1,
      })
    })

    expect(sheet()).toBeNull()
    expect(offered()).toBe(false)
    expect(useAskStore.getState().draft.text).toBe("Can you go back one slide?")
  })

  it("closes the fold-out when the box is paused, and keeps the draft", async () => {
    await mount()
    serverSends(EVENTS.ASK.BOX, { open: true })
    openSheet()
    typeQuestion("One more thing")

    serverSends(EVENTS.ASK.BOX, { open: false })

    expect(sheet()).toBeNull()
    expect(useAskStore.getState().draft.text).toBe("One more thing")
  })

  it("draws the fold-out outside the wrapper a poll makes inert", async () => {
    await mount()

    serverSends(EVENTS.ASK.BOX, { open: true })
    openSheet()

    // `PollShell` wraps the quiz page in the element it makes inert.
    const pollWrapper = screen.getByTestId("game").parentElement

    expect(sheet()).not.toBeNull()
    expect(pollWrapper?.contains(sheet())).toBe(false)
  })

  it("sends the question for this game and says it was sent", async () => {
    await mount()
    serverSends(EVENTS.ASK.BOX, { open: true })
    openSheet()
    typeQuestion("  Why is the sky blue?  ")

    fireEvent.click(required("[data-ask-send]"))

    const call = mocks.emit.mock.calls.find(
      ([event]) => event === EVENTS.ASK.SEND,
    )
    const [, message, ack] = call as [
      string,
      { gameId: string; text: string; signed: boolean; nonce: string },
      (_outcome: string) => void,
    ]

    expect(message).toMatchObject({
      gameId: "g1",
      text: "  Why is the sky blue?  ",
      signed: false,
    })
    expect(message.nonce).toMatch(/^[\w-]{8,64}$/u)

    await act(async () => {
      ack("accepted")
      await Promise.resolve()
    })

    expect(
      document.querySelector('[data-ask-outcome="accepted"]'),
    ).not.toBeNull()
    expect(
      document.querySelector<HTMLTextAreaElement>("[data-ask-text]")?.value,
    ).toBe("")
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("forgets the box, but not the draft, when the game is gone", async () => {
    await mount()
    serverSends(EVENTS.ASK.BOX, { open: true })
    openSheet()
    typeQuestion("Kept for later")

    serverSends(EVENTS.GAME.RESET, "errors:game.managerDisconnected")

    expect(useAskStore.getState().box).toBeNull()
    expect(useAskStore.getState().sheetOpen).toBe(false)
    expect(useAskStore.getState().draft.text).toBe("Kept for later")
  })
})
