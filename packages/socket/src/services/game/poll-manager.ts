import { EVENTS } from "@razzia/common/constants"
import type { Server, Socket } from "@razzia/common/types/game/socket"
import type {
  PollDone,
  PollOutcome,
  PollResultRecord,
  PollSnapshot,
  PollTally,
  PollVoteOutcome,
  PollVoter,
  PollWithId,
} from "@razzia/common/types/poll"
import type { PlayerManager } from "@razzia/socket/services/game/player-manager"
import { nanoid } from "nanoid"

// Changing a vote is allowed until the host closes the poll; this only stops a
// stuck or scripted client from flooding the host with updates. It is counted
// per client, never per address: a whole class shares one.
export const MAX_VOTE_CHANGES = 30

type Phase = "idle" | "open" | "closed"

// How many closed polls a room keeps for a reopen. A lecture runs a handful;
// past this the oldest is forgotten (it can no longer be reopened).
export const MAX_PARKED_POLLS = 50

interface ParkedPoll {
  poll: PollWithId
  votes: Map<string, number>
  changes: Map<string, number>
  recordId: string | null
}

export interface PollManagerOptions {
  io: Server
  players: Pick<PlayerManager, "getAll" | "findById" | "findByClientId">
  gameSubject: string
  getManagerId: () => string
  isManager: (_socket: Socket) => boolean
  // Called with every record the poll leaves behind. `false` says it could not
  // be kept, and the record is offered again later.
  onSettled: (_record: PollResultRecord) => boolean
}

/**
 * One poll at a time in a room: who has voted for what, and what each screen
 * is told about it. It knows nothing of the quiz round or of the room's
 * statuses; the room decides when a poll may start.
 */
export class PollManager {
  private readonly opts: PollManagerOptions
  private phase: Phase = "idle"
  private poll: PollWithId | null = null
  // The one record of who voted for what. In an anonymous poll it never leaves
  // this object.
  private readonly votes = new Map<string, number>()
  private readonly changes = new Map<string, number>()
  // Fixed when the poll closes, so nothing afterwards (a kick) moves it.
  private closedCounts: number[] | null = null
  private closedVoters: PollVoter[] | undefined = undefined
  private unsaved: PollResultRecord[] = []
  // The saved result this poll writes: set at its first close, and kept by a
  // reopen, so the next close replaces that result instead of adding one.
  private recordId: string | null = null
  // Closed polls that have left the stage (dismissed, or replaced by the next
  // poll) with who voted for what, so a deck can reopen one with its votes
  // (`reopen`). Never sent anywhere; dropped with the room.
  private readonly parked = new Map<string, ParkedPoll>()

  constructor(opts: PollManagerOptions) {
    this.opts = opts
  }

  isActive(): boolean {
    return this.phase !== "idle"
  }

  isOpen(): boolean {
    return this.phase === "open"
  }

  // The poll on the stage, open or showing its result.
  currentId(): string | null {
    return this.phase === "idle" || !this.poll ? null : this.poll.id
  }

  // `replaceClosed`: a closed result on the stage gives way to the new poll in
  // one step, so the screens go from the result straight to the next question.
  start(
    socket: Socket,
    poll: PollWithId,
    { replaceClosed = false }: { replaceClosed?: boolean } = {},
  ): PollOutcome {
    if (!this.opts.isManager(socket)) {
      return "notManager"
    }

    if (this.phase === "open" || (this.phase === "closed" && !replaceClosed)) {
      return "busy"
    }

    this.putAway()
    this.reset()
    this.phase = "open"
    this.poll = { ...poll, options: [...poll.options] }
    this.emitState()

    return "accepted"
  }

  /**
   * Opens a closed poll again with the votes it had: in place while its result
   * is on the stage, or back onto the stage once it has left it (from the room
   * at rest, or, with `replaceClosed`, from another poll's result). Players who
   * have left the room since lose their votes, as they would have while it was
   * open. The next close replaces the result the last one saved.
   */
  reopen(
    socket: Socket,
    pollId: string,
    { replaceClosed = false }: { replaceClosed?: boolean } = {},
  ): PollOutcome {
    if (!this.opts.isManager(socket)) {
      return "notManager"
    }

    if (this.phase === "open") {
      return this.poll?.id === pollId ? "none" : "busy"
    }

    if (this.phase === "closed" && this.poll?.id === pollId) {
      this.phase = "open"
      this.closedCounts = null
      this.closedVoters = undefined
      this.dropLeavers()
      this.emitState()

      return "accepted"
    }

    const kept = this.parked.get(pollId)

    if (!kept) {
      return "notFound"
    }

    if (this.phase === "closed" && !replaceClosed) {
      return "busy"
    }

    this.putAway()
    this.reset()
    this.parked.delete(pollId)
    this.phase = "open"
    this.poll = kept.poll
    this.recordId = kept.recordId

    for (const [clientId, option] of kept.votes) {
      this.votes.set(clientId, option)
    }

    for (const [clientId, count] of kept.changes) {
      this.changes.set(clientId, count)
    }

    this.dropLeavers()
    this.emitState()

    return "accepted"
  }

  vote(socket: Socket, pollId: string, option: number): PollVoteOutcome {
    const player = this.opts.players.findById(socket.id)

    if (!player) {
      return "notPlayer"
    }

    if (this.phase !== "open" || !this.poll) {
      return "closed"
    }

    if (
      pollId !== this.poll.id ||
      !Number.isInteger(option) ||
      option < 0 ||
      option >= this.poll.options.length
    ) {
      return "invalid"
    }

    const before = this.votes.get(player.clientId)

    if (before === option) {
      return "unchanged"
    }

    if (before !== undefined) {
      const changes = (this.changes.get(player.clientId) ?? 0) + 1

      if (changes > MAX_VOTE_CHANGES) {
        return "tooManyChanges"
      }

      this.changes.set(player.clientId, changes)
    }

    this.votes.set(player.clientId, option)
    // A first vote tells a sealed poll's host who has just voted; a change
    // moves no total and names nobody.
    this.emitTally(before === undefined ? player.username : undefined)

    return "accepted"
  }

  close(socket: Socket): PollOutcome {
    if (!this.opts.isManager(socket)) {
      return "notManager"
    }

    if (this.phase !== "open") {
      return "none"
    }

    this.freeze()
    this.keep(this.buildRecord(false))
    this.emitState()

    return "accepted"
  }

  dismiss(socket: Socket): PollOutcome {
    if (!this.opts.isManager(socket)) {
      return "notManager"
    }

    if (this.phase !== "closed") {
      return "none"
    }

    this.putAway()
    this.reset()
    this.emitState()

    return "accepted"
  }

  // A vote leaves with its voter, but only while the poll is open: a closed
  // poll's result stays as the host saw it.
  forgetPlayer(clientId: string): void {
    if (this.phase !== "open") {
      return
    }

    this.changes.delete(clientId)

    if (this.votes.delete(clientId)) {
      this.emitTally()
    }
  }

  /**
   * The room is closing. A poll still open is kept as a partial result, and a
   * result whose save failed is offered again; nothing is ever written twice.
   */
  settlePending(): void {
    if (this.phase === "open" && this.poll) {
      this.freeze()
      this.keep(this.buildRecord(true))
    }

    this.flush()
  }

  /** The room is gone: drop who voted for what. */
  stop(): void {
    this.reset()
    this.parked.clear()
  }

  /**
   * The poll that has just closed, as its room remembers it: the wording it
   * was asked in and the final counts. Built field by field, so a name can
   * never ride along.
   */
  closedSummary(): PollDone | null {
    if (this.phase !== "closed" || !this.poll || !this.closedCounts) {
      return null
    }

    return {
      id: this.poll.id,
      question: this.poll.question,
      options: [...this.poll.options],
      anonymous: this.poll.anonymous,
      live: this.poll.live === true,
      counts: [...this.closedCounts],
      total: sum(this.closedCounts),
    }
  }

  snapshotForHost(): PollSnapshot | null {
    if (this.phase === "idle" || !this.poll) {
      return null
    }

    const base = {
      ...baseOf(this.poll, this.phase),
      ...(this.poll.live ? { live: true as const } : {}),
    }

    // Sealed: the host is told how many have voted and nothing else, no
    // counts and no names, until the close. Every way the host's screen learns
    // of an open poll (start, sync, reconnect) comes through here.
    if (this.isSealed()) {
      return { ...base, total: this.votes.size }
    }

    const counts = this.currentCounts()
    const voters = this.currentVoters()

    return {
      ...base,
      counts,
      total: sum(counts),
      ...(voters ? { voters } : {}),
    }
  }

  /**
   * What a screen that has just opened should show: the host's view for the
   * host, a player's own for a player, and `undefined` for a socket that is
   * neither in this room.
   */
  snapshotForSocket(socket: Socket): PollSnapshot | null | undefined {
    if (this.opts.isManager(socket)) {
      return this.snapshotForHost()
    }

    const player = this.opts.players.findById(socket.id)

    return player ? this.snapshotForPlayer(player.clientId) : undefined
  }

  snapshotForPlayer(clientId: string): PollSnapshot | null {
    if (this.phase === "idle" || !this.poll) {
      return null
    }

    const counts = this.phase === "closed" ? this.currentCounts() : undefined

    return {
      ...baseOf(this.poll, this.phase),
      // Only so the phone can say whether its name shows as it votes.
      ...(this.poll.live ? { live: true as const } : {}),
      mine: this.votes.get(clientId) ?? null,
      ...(counts ? { counts, total: sum(counts) } : {}),
    }
  }

  // Open and not live. The counts exist only in this object until the close.
  private isSealed(): boolean {
    return this.phase === "open" && this.poll?.live !== true
  }

  private currentCounts(): number[] {
    if (this.closedCounts) {
      return this.closedCounts
    }

    const counts = (this.poll?.options ?? []).map(() => 0)

    for (const option of this.votes.values()) {
      counts[option] += 1
    }

    return counts
  }

  // Names only ever for a named poll.
  private currentVoters(): PollVoter[] | undefined {
    if (this.phase === "closed") {
      return this.closedVoters
    }

    if (!this.poll || this.poll.anonymous) {
      return undefined
    }

    return [...this.votes]
      .flatMap(([clientId, option]) => {
        const player = this.opts.players.findByClientId(clientId)

        return player ? [{ username: player.username, option }] : []
      })
      .sort(
        (a, b) => a.option - b.option || a.username.localeCompare(b.username),
      )
  }

  private freeze(): void {
    this.closedCounts = this.currentCounts()
    this.closedVoters = this.currentVoters()
    this.phase = "closed"
  }

  private reset(): void {
    this.phase = "idle"
    this.poll = null
    this.votes.clear()
    this.changes.clear()
    this.closedCounts = null
    this.closedVoters = undefined
    this.recordId = null
  }

  // A closed poll leaving the stage is kept, with its votes, for a reopen.
  private putAway(): void {
    if (this.phase !== "closed" || !this.poll) {
      return
    }

    this.parked.delete(this.poll.id)
    this.parked.set(this.poll.id, {
      poll: this.poll,
      votes: new Map(this.votes),
      changes: new Map(this.changes),
      recordId: this.recordId,
    })

    while (this.parked.size > MAX_PARKED_POLLS) {
      const oldest = this.parked.keys().next().value

      if (oldest === undefined) {
        break
      }

      this.parked.delete(oldest)
    }
  }

  // A reopened poll keeps only the votes of players still in the room.
  private dropLeavers(): void {
    for (const clientId of [...this.votes.keys()]) {
      if (!this.opts.players.findByClientId(clientId)) {
        this.votes.delete(clientId)
        this.changes.delete(clientId)
      }
    }
  }

  private buildRecord(partial: boolean): PollResultRecord {
    const { poll } = this
    const counts = this.currentCounts()
    const voters = this.currentVoters()

    if (!poll) {
      throw new Error("No poll to record")
    }

    this.recordId ??= `${Date.now()}-${nanoid(8)}`

    return {
      id: this.recordId,
      pollId: poll.id,
      question: poll.question,
      options: [...poll.options],
      anonymous: poll.anonymous,
      date: new Date().toISOString(),
      gameSubject: this.opts.gameSubject,
      counts,
      total: sum(counts),
      ...(voters ? { voters } : {}),
      ...(partial ? { partial: true } : {}),
    }
  }

  private keep(record: PollResultRecord): void {
    this.unsaved.push(record)
    this.flush()
  }

  // A saver that throws is a save that failed: the poll still closes for
  // everyone, and the record is offered again when the room closes.
  private flush(): void {
    this.unsaved = this.unsaved.filter((record) => {
      try {
        return !this.opts.onSettled(record)
      } catch (error) {
        console.error("Failed to save a poll result:", error)

        return true
      }
    })
  }

  // Each connected player gets their own view, and the host theirs; nothing is
  // broadcast, so no screen ever sees another screen's view.
  private emitState(): void {
    for (const player of this.opts.players.getAll()) {
      if (player.connected) {
        this.opts.io
          .to(player.id)
          .emit(EVENTS.POLL.STATE, this.snapshotForPlayer(player.clientId))
      }
    }

    this.opts.io
      .to(this.opts.getManagerId())
      .emit(EVENTS.POLL.STATE, this.snapshotForHost())
  }

  // `arrived` is the name of a first vote. A sealed tally carries it, and so
  // does a named poll's live one. An anonymous live tally never does: its
  // counts move in the same message and would show what that person picked.
  private emitTally(arrived?: string): void {
    if (!this.poll) {
      return
    }

    const sealed = this.isSealed()
    const base: PollTally = sealed
      ? { pollId: this.poll.id, total: this.votes.size }
      : this.fullTally(this.poll.id)
    const named = sealed || !this.poll.anonymous
    const tally: PollTally =
      arrived !== undefined && named ? { ...base, arrived } : base

    this.opts.io.to(this.opts.getManagerId()).emit(EVENTS.POLL.TALLY, tally)
  }

  private fullTally(pollId: string): PollTally {
    const counts = this.currentCounts()
    const voters = this.currentVoters()

    return {
      pollId,
      counts,
      total: sum(counts),
      ...(voters ? { voters } : {}),
    }
  }
}

const sum = (counts: number[]): number =>
  counts.reduce((total, count) => total + count, 0)

const baseOf = (poll: PollWithId, phase: "open" | "closed") => ({
  pollId: poll.id,
  question: poll.question,
  options: poll.options,
  anonymous: poll.anonymous,
  phase,
})
