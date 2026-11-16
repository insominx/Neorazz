import HudModule from "@razzia/web/features/game/components/HudModule"
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"

describe("HudModule", () => {
  afterEach(cleanup)

  it("shows one number with a small label", () => {
    render(<HudModule label="ANSWERED" value="3/18" role="sequence" />)

    expect(screen.getByText("ANSWERED")).toBeInTheDocument()
    expect(screen.getByText("3/18")).toBeInTheDocument()
  })

  it("draws no ring or box around the number", () => {
    const { container } = render(
      <HudModule label="TIME" value="17" role="info" />,
    )

    expect(container.querySelector("svg")).toBeNull()
    expect(container.querySelector("[data-hud-value]")).toHaveTextContent("17")
  })

  it("sets the number big on the stage and plain off it", () => {
    render(<HudModule label="TIME" value="17" role="info" />)

    const value = screen.getByText("17")

    expect(value).toHaveClass("text-[2.25rem]")
    expect(value).toHaveClass("stage:text-[5rem]")
    expect(value).toHaveClass("tabular-nums")
  })

  it("heats the number up when time is short", () => {
    const { rerender } = render(
      <HudModule label="TIME" value="4" role="info" urgent />,
    )

    expect(screen.getByText("4")).toHaveClass("text-warning")

    rerender(<HudModule label="TIME" value="14" role="info" />)

    expect(screen.getByText("14")).toHaveClass("text-text-primary")
    expect(screen.getByText("14")).not.toHaveClass("text-warning")
  })

  it("flashes the count on each arrival, like a poll's count", () => {
    const { rerender } = render(
      <HudModule label="ANSWERED" value="0/18" role="sequence" flash={0} />,
    )

    expect(screen.getByText("0/18")).not.toHaveClass("rz-hud-flash")

    rerender(
      <HudModule label="ANSWERED" value="1/18" role="sequence" flash={1} />,
    )
    const first = screen.getByText("1/18")

    expect(first).toHaveClass("rz-hud-flash")

    rerender(
      <HudModule label="ANSWERED" value="2/18" role="sequence" flash={2} />,
    )

    // A new element each time, so the flash plays again.
    expect(screen.getByText("2/18")).not.toBe(first)
  })

  it("keeps the label in its role colour", () => {
    render(<HudModule label="TIME" value="17" role="info" />)

    expect(screen.getByText("TIME")).toHaveClass("text-info")
  })
})
