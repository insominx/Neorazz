import { afterEach, describe, expect, it, vi } from "vitest"

// The server's shutdown (a redeploy sends SIGTERM) keeps what each live room
// still holds: a lecture's played questions, an open poll, and a record of
// questions for the presenter whose last write failed.

const fakeGame = () => ({
  visuals: {},
  saveUnfinishedLecture: vi.fn(),
  settlePoll: vi.fn(),
  settleAsks: vi.fn(),
})

const mocks = vi.hoisted(() => ({
  games: [] as Array<ReturnType<typeof fakeGame>>,
  cleanup: vi.fn(),
}))

vi.mock("http", () => ({
  createServer: vi.fn(() => ({ on: vi.fn(), listen: vi.fn() })),
}))

vi.mock("socket.io", () => ({
  Server: class {
    use = vi.fn()
    on = vi.fn()
  },
}))

vi.mock("@razzia/socket/services/config", () => ({
  initConfig: vi.fn(),
}))

vi.mock("@razzia/socket/services/visuals", () => ({
  backgroundPathFromUrl: vi.fn(),
  cleanupBackgroundAssetsOnStartup: vi.fn(),
  ensureBackgroundAssetsDirectory: vi.fn(),
  serveBackgroundUpload: vi.fn(),
  serveConfigAsset: vi.fn(),
  setLiveBackgroundPathsProvider: vi.fn(),
}))

vi.mock("@razzia/socket/services/registry", () => ({
  default: {
    getInstance: () => ({
      getAllGames: () => mocks.games,
      cleanup: mocks.cleanup,
    }),
  },
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe("server shutdown", () => {
  it("settles every room's questions, poll and lecture before it exits", async () => {
    const listeners = new Map<string, () => void>()

    vi.spyOn(process, "on").mockImplementation(((
      event: string,
      listener: () => void,
    ) => {
      listeners.set(event, listener)

      return process
    }) as typeof process.on)
    const exit = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as typeof process.exit)
    vi.spyOn(console, "log").mockImplementation(() => undefined)

    mocks.games = [fakeGame(), fakeGame()]
    await import("@razzia/socket/index")

    for (const signal of ["SIGTERM", "SIGINT"]) {
      mocks.games.forEach((game) => {
        game.settleAsks.mockClear()
      })

      listeners.get(signal)?.()

      for (const game of mocks.games) {
        expect(game.saveUnfinishedLecture).toHaveBeenCalled()
        expect(game.settlePoll).toHaveBeenCalled()
        expect(game.settleAsks).toHaveBeenCalledTimes(1)
      }
    }

    expect(mocks.cleanup).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(0)
  })
})
