import type { Socket } from "@razzia/common/types/game/socket"
import manager, { LOGIN_IDLE_MS } from "@razzia/socket/services/manager"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// `peek` is how the question inbox checks a watcher before each message: it
// must answer without keeping an idle login alive.

const socketOf = (clientId: string) =>
  ({
    id: `${clientId}-sock`,
    handshake: { auth: { clientId } },
  }) as unknown as Socket

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse("2026-11-17T18:00:00.000Z"))
})

afterEach(() => {
  vi.useRealTimers()
})

describe("Manager.peek", () => {
  it("knows a login, and no one else", () => {
    manager.login(socketOf("peek-a"))

    expect(manager.peek("peek-a")).toBe(true)
    expect(manager.peek("peek-nobody")).toBe(false)
  })

  it("forgets a login that has been idle for the whole window", () => {
    manager.login(socketOf("peek-b"))
    vi.advanceTimersByTime(LOGIN_IDLE_MS)

    expect(manager.peek("peek-b")).toBe(false)
  })

  it("does not refresh the login it looks at", () => {
    manager.login(socketOf("peek-c"))

    vi.advanceTimersByTime(LOGIN_IDLE_MS - 1_000)
    expect(manager.peek("peek-c")).toBe(true)

    // Had the peek refreshed it, the login would last another window.
    vi.advanceTimersByTime(1_000)
    expect(manager.peek("peek-c")).toBe(false)
    expect(manager.isLoggedByClientId("peek-c")).toBe(false)
  })

  it("sees a logout at once", () => {
    const socket = socketOf("peek-d")

    manager.login(socket)
    manager.logout(socket)

    expect(manager.peek("peek-d")).toBe(false)
  })
})
