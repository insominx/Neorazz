import { EVENTS } from "@razzia/common/constants"
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

// The inbox route: in a frame it draws a notice and watches nothing.

const mocks = vi.hoisted(() => ({ emit: vi.fn() }))

vi.mock("@razzia/web/features/game/contexts/socket-context", () => ({
  useEvent: vi.fn(),
  useSocket: () => ({ socket: { emit: mocks.emit }, isConnected: true }),
}))

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: unknown) => ({ options }),
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))

afterEach(() => {
  cleanup()
  mocks.emit.mockClear()
})

describe("the inbox route", () => {
  it("knows when it is framed, including by a parent that will not say", async () => {
    const { isFramed } = await import("@razzia/web/pages/manager/questions")
    const top = {}
    const refusing = {
      self: {},
      get top(): unknown {
        throw new Error("SecurityError")
      },
    }

    expect(isFramed({ self: top, top })).toBe(false)
    expect(isFramed({ self: {}, top })).toBe(true)
    expect(isFramed(refusing)).toBe(true)
    // This test page is not framed.
    expect(isFramed(window)).toBe(false)
  })

  it("draws a notice in a frame, and neither watches nor shows the inbox", async () => {
    const { QuestionsView } =
      await import("@razzia/web/pages/manager/questions")

    render(<QuestionsView framed />)

    expect(document.querySelector("[data-inbox-framed]")?.textContent).toBe(
      "ask:inbox.framed",
    )
    expect(document.querySelector("[data-inbox-status]")).toBeNull()
    expect(mocks.emit).not.toHaveBeenCalled()
  })

  it("is the inbox on its own", async () => {
    const { QuestionsView } =
      await import("@razzia/web/pages/manager/questions")

    render(<QuestionsView framed={false} />)

    expect(document.querySelector("[data-inbox-status]")).not.toBeNull()
    expect(mocks.emit).toHaveBeenCalledWith(EVENTS.ASKS.WATCH)
  })
})
