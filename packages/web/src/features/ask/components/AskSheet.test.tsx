import { EVENTS } from "@razzia/common/constants"
import AskSheet from "@razzia/web/features/ask/components/AskSheet"
import { SENT_CLOSE_MS } from "@razzia/web/features/ask/send"
import { useAskStore } from "@razzia/web/features/ask/stores/ask"
import { usePlayerStore } from "@razzia/web/features/game/stores/player"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The fold-out on its own: what it says, when Send works, and what each answer
// from the server leaves behind.

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  connected: true,
}))

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  useSocket: () => ({
    socket: { emit: mocks.emit },
    isConnected: mocks.connected,
  }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

type Ack = (_outcome: string) => void

// The element a selector names; a missing one fails the test there.
const required = (selector: string): Element => {
  const found = document.querySelector(selector)

  if (!found) {
    throw new Error(`No ${selector} on the page`)
  }

  return found
}

const sendButton = () =>
  document.querySelector<HTMLButtonElement>("[data-ask-send]")

const typeQuestion = (text: string) => {
  fireEvent.change(required("[data-ask-text]"), {
    target: { value: text },
  })
}

const sends = () =>
  mocks.emit.mock.calls.filter(([event]) => event === EVENTS.ASK.SEND) as Array<
    [string, { text: string; signed: boolean; nonce: string }, Ack]
  >

const answer = async (outcome: string) => {
  await act(async () => {
    sends().at(-1)?.[2](outcome)
    await Promise.resolve()
  })
}

// The line under the text: an outcome after a send, or why Send waits.
const outcomeLine = () =>
  document.querySelector('[data-ask-sheet] [role="status"]')

const open = () => {
  act(() => {
    useAskStore.getState().openSheet()
  })
}

beforeEach(() => {
  mocks.emit.mockClear()
  mocks.connected = true
  window.sessionStorage.clear()
  useAskStore.getState().reset()
  useAskStore.getState().clearDraft()
  useAskStore.getState().setResult(null)
  usePlayerStore.setState({ gameId: "g1" })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("AskSheet", () => {
  it("draws nothing while closed", () => {
    render(<AskSheet />)

    expect(document.querySelector("[data-ask-sheet]")).toBeNull()
  })

  it("is a dialog with the three plain lines, the text area, the switch and Send", () => {
    render(<AskSheet />)
    open()

    expect(screen.getByRole("dialog")).toHaveAccessibleName("ask:title")
    expect(screen.getByText("ask:privacy.private")).toBeInTheDocument()
    expect(screen.getByText("ask:privacy.count")).toBeInTheDocument()
    expect(screen.getByText("ask:privacy.kept")).toBeInTheDocument()
    expect(document.querySelector("[data-ask-text]")).toHaveFocus()
    expect(document.querySelector("[data-ask-sign]")).toHaveAttribute(
      "aria-checked",
      "false",
    )
    expect(sendButton()).toBeDisabled()
  })

  it("enables Send only for a question that will be taken", () => {
    render(<AskSheet />)
    open()

    typeQuestion("   ")
    expect(sendButton()).toBeDisabled()
    typeQuestion("Why?")
    expect(sendButton()).toBeEnabled()
  })

  it("disables Send while disconnected, and says why", () => {
    mocks.connected = false
    render(<AskSheet />)
    open()
    typeQuestion("Why?")

    expect(sendButton()).toBeDisabled()
    expect(outcomeLine()?.textContent).toBe("common:reconnecting")
  })

  it("stops the text at 500 characters", () => {
    render(<AskSheet />)
    open()

    expect(document.querySelector("[data-ask-text]")).toHaveAttribute(
      "maxLength",
      "500",
    )
  })

  it("sends a signed question when the switch is on", () => {
    render(<AskSheet />)
    open()
    typeQuestion("Why?")
    fireEvent.click(required("[data-ask-sign]"))
    fireEvent.click(required("[data-ask-send]"))

    expect(sends()[0][1]).toMatchObject({ text: "Why?", signed: true })
  })

  it("holds Send while one is on its way", () => {
    render(<AskSheet />)
    open()
    typeQuestion("Why?")
    fireEvent.click(required("[data-ask-send]"))

    expect(sendButton()).toBeDisabled()
    fireEvent.click(required("[data-ask-send]"))
    expect(sends()).toHaveLength(1)
  })

  it.each([
    "tooFast",
    "tooMany",
    "closed",
    "full",
    "invalid",
    "notPlayer",
    "notLecture",
  ])("keeps the draft and says so on %s", async (outcome) => {
    render(<AskSheet />)
    open()
    typeQuestion("Why?")
    fireEvent.click(required("[data-ask-send]"))
    await answer(outcome)

    expect(outcomeLine()).toHaveAttribute("data-ask-outcome", outcome)
    expect(outcomeLine()?.textContent).toBe(`ask:outcome.${outcome}`)
    expect(useAskStore.getState().draft.text).toBe("Why?")
  })

  it("says a send may not have arrived when no answer comes, and a resend is a repeat", async () => {
    vi.useFakeTimers()
    render(<AskSheet />)
    open()
    typeQuestion("Why?")
    fireEvent.click(required("[data-ask-send]"))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })

    expect(outcomeLine()).toHaveAttribute("data-ask-outcome", "noAck")
    expect(outcomeLine()?.textContent).toBe("ask:outcome.noAck")
    expect(useAskStore.getState().draft.text).toBe("Why?")

    fireEvent.click(required("[data-ask-send]"))

    expect(sends()).toHaveLength(2)
    expect(sends()[1][1].nonce).toBe(sends()[0][1].nonce)
  })

  it("gives an edited question a new nonce, so the edit is not taken for a repeat", async () => {
    render(<AskSheet />)
    open()
    typeQuestion("Why?")
    fireEvent.click(required("[data-ask-send]"))
    await answer("tooFast")
    typeQuestion("Why not?")
    fireEvent.click(required("[data-ask-send]"))

    expect(sends()[1][1].nonce).not.toBe(sends()[0][1].nonce)
  })

  it("clears the draft and the switch once sent", async () => {
    render(<AskSheet />)
    open()
    typeQuestion("Why?")
    fireEvent.click(required("[data-ask-sign]"))
    fireEvent.click(required("[data-ask-send]"))
    await answer("accepted")

    expect(outcomeLine()).toHaveAttribute("data-ask-outcome", "accepted")
    expect(useAskStore.getState().draft).toEqual({ text: "", signed: false })
    expect(document.querySelector("[data-ask-sign]")).toHaveAttribute(
      "aria-checked",
      "false",
    )
  })

  it("drops the last line when the person starts a new question", async () => {
    render(<AskSheet />)
    open()
    typeQuestion("Why?")
    fireEvent.click(required("[data-ask-send]"))
    await answer("accepted")
    typeQuestion("And")

    expect(outcomeLine()).not.toHaveAttribute("data-ask-outcome")
  })

  it("closes on its close button and on Escape", () => {
    render(<AskSheet />)
    open()

    fireEvent.click(screen.getByRole("button", { name: "ask:close" }))
    expect(document.querySelector("[data-ask-sheet]")).toBeNull()

    open()
    fireEvent.keyDown(required("[data-ask-text]"), {
      key: "Escape",
    })
    expect(document.querySelector("[data-ask-sheet]")).toBeNull()
  })
})

// QA, after C2: "Sent." for a moment, then back to the phone's own screen.
describe("AskSheet after an accepted send", () => {
  const sendAccepted = async () => {
    render(<AskSheet />)
    open()
    typeQuestion("Why?")
    fireEvent.click(required("[data-ask-send]"))
    await answer("accepted")
  }

  const sheetIsOpen = () => document.querySelector("[data-ask-sheet]") !== null

  it("shows Sent., then closes itself after 1.5 s and opens empty again", async () => {
    vi.useFakeTimers()
    await sendAccepted()

    expect(
      document.querySelector('[data-ask-outcome="accepted"]'),
    ).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(SENT_CLOSE_MS - 1)
    })
    expect(sheetIsOpen()).toBe(true)
    expect(
      document.querySelector('[data-ask-outcome="accepted"]'),
    ).not.toBeNull()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(sheetIsOpen()).toBe(false)

    open()
    expect(
      document.querySelector<HTMLTextAreaElement>("[data-ask-text]")?.value,
    ).toBe("")
    expect(document.querySelector("[data-ask-outcome]")).toBeNull()
  })

  it("stays open when the person has started another question", async () => {
    vi.useFakeTimers()
    await sendAccepted()
    typeQuestion("And another")

    act(() => {
      vi.advanceTimersByTime(SENT_CLOSE_MS * 2)
    })

    expect(sheetIsOpen()).toBe(true)
    expect(useAskStore.getState().draft.text).toBe("And another")
  })

  it.each(["noAck", "tooFast", "tooMany", "closed", "full", "invalid"])(
    "does not close on %s",
    async (outcome) => {
      vi.useFakeTimers()
      render(<AskSheet />)
      open()
      typeQuestion("Why?")
      fireEvent.click(required("[data-ask-send]"))

      if (outcome === "noAck") {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(5_000)
        })
      } else {
        await answer(outcome)
      }

      act(() => {
        vi.advanceTimersByTime(SENT_CLOSE_MS * 2)
      })

      expect(sheetIsOpen()).toBe(true)
      expect(
        document.querySelector(`[data-ask-outcome="${outcome}"]`),
      ).not.toBeNull()
    },
  )
})
