import { EVENTS, LECTURE_TEXT } from "@razzia/common/constants"
import type {
  AskBoxOutcome,
  AskOutcome,
  AskRecord,
  AskRoomView,
  AskState,
} from "@razzia/common/types/ask"
import type {
  GameResult,
  LectureOutcome,
  LectureState,
  Player,
  Quizz,
} from "@razzia/common/types/game"
import type { Server, Socket } from "@razzia/common/types/game/socket"
import {
  STATUS,
  type Status,
  type StatusDataMap,
} from "@razzia/common/types/game/status"
import type {
  PollDone,
  PollOutcome,
  PollResultRecord,
  PollVoteOutcome,
} from "@razzia/common/types/poll"
import type { ResolvedVisuals } from "@razzia/common/types/visuals"
import { saveAskRecord } from "@razzia/socket/services/ask-store"
import { saveResult } from "@razzia/socket/services/config"
import {
  type AskChange,
  AskManager,
  type AskMarkOutcome,
} from "@razzia/socket/services/game/ask-manager"
import { askRoomSignal } from "@razzia/socket/services/game/ask-signal"
import { CooldownTimer } from "@razzia/socket/services/game/cooldown-timer"
import {
  DROP_GRACE_MS,
  PlayerManager,
  toPublicPlayer,
} from "@razzia/socket/services/game/player-manager"
import { inlinePollOf } from "@razzia/socket/services/game/inline-poll"
import { PollManager } from "@razzia/socket/services/game/poll-manager"
import { RoundManager } from "@razzia/socket/services/game/round-manager"
import { getPollById, savePollResult } from "@razzia/socket/services/poll-store"
import Registry from "@razzia/socket/services/registry"
import { createInviteCode } from "@razzia/socket/utils/game"
import { logSafe } from "@razzia/socket/utils/safe"
import { v7 as uuid } from "uuid"

const registry = Registry.getInstance()

// How many closed polls a lecture room reports to its host. A lecture runs a
// handful, so this only bounds a runaway client. None is ever dropped: a
// deck's poll that ran must stay known, or it could run again. A room that has
// closed this many refuses another poll (`full`).
const MAX_POLLS_DONE = 50

interface GameOptions {
  io: Server
  socket: Socket
  quizz: Quizz
  visuals: ResolvedVisuals
  // Played from a lecture deck: one question at a time, with the room
  // holding between them.
  lecture?: boolean
  // Keeps what a poll leaves behind; `false` says it could not be kept. By
  // default it goes to `config/poll-results/`; tests hand in their own.
  onPollSettled?: (_record: PollResultRecord) => boolean
  // Keeps a lecture room's questions; `false` says it could not. By default
  // it goes to `config/asks/`; tests hand in their own.
  saveAsks?: (_record: AskRecord) => boolean
}

interface StatusSnapshot {
  name: Status
  data: StatusDataMap[Status]
}

export const restampReconnectStatus = <T extends StatusSnapshot>(
  status: T,
  serverNow = Date.now(),
): T => {
  if (
    status.name !== STATUS.SELECT_ANSWER &&
    status.name !== STATUS.SHOW_QUESTION &&
    status.name !== STATUS.SHOW_RESULT &&
    status.name !== STATUS.SHOW_RESPONSES
  ) {
    return status
  }

  return {
    ...status,
    data: { ...status.data, serverNow },
  } as T
}

export const selectReconnectStatus = (
  targetStatus: StatusSnapshot | null | undefined,
  roomStatus: StatusSnapshot | null | undefined,
): StatusSnapshot =>
  targetStatus ??
  roomStatus ?? {
    name: STATUS.WAIT,
    data: { text: "game:waitingForPlayers" },
  }

// A poll rides on the reconnect payload only while one is showing, so a room
// without a poll sends exactly what it always did.
const pollPayload = <T extends object>(snapshot: T | null): { poll?: T } =>
  snapshot ? { poll: snapshot } : {}

class Game {
  readonly gameId: string
  readonly inviteCode: string
  readonly visuals: ResolvedVisuals
  readonly lecture: boolean

  private readonly io: Server
  private readonly _manager: {
    id: string
    clientId: string
    connected: boolean
  }
  private readonly playerManager: PlayerManager
  private readonly round: RoundManager
  private readonly poll: PollManager
  // A lecture room's question box; a normal game has none.
  private readonly asks: AskManager | null
  private readonly cooldown: CooldownTimer

  private lastBroadcastStatus: {
    name: Status
    data: StatusDataMap[Status]
  } | null = null
  private managerStatus: {
    name: Status
    data: StatusDataMap[Status]
  } | null = null
  private playerStatus = new Map<
    string,
    { name: Status; data: StatusDataMap[Status] }
  >()
  private resultSaved = false
  // After a lecture's podium: whether the phones have been sent back from their
  // final place to the quiz-over wait (`showStandings`), and each final place
  // by client, to show again when the deck comes back to its standings.
  private standingsResting = false
  private readonly finalPlaces = new Map<
    string,
    { name: Status; data: StatusDataMap[Status] }
  >()
  // The polls that closed in this room, for a deck that asks what already ran.
  private pollsDone: PollDone[] = []
  // The deck polls (sent inline) that closed here: each runs once per room.
  private readonly inlineDone = new Set<string>()
  // Whether the poll on the stage was sent inline.
  private activeInline = false

  constructor({
    io,
    socket,
    quizz,
    visuals,
    lecture = false,
    onPollSettled = savePollResult,
    saveAsks = saveAskRecord,
  }: GameOptions) {
    const clientId = socket.handshake.auth.clientId as string

    this.io = io
    this.gameId = uuid()
    this.inviteCode = createInviteCode(
      (code) => registry.getGameByInviteCode(code) !== undefined,
    )
    this.visuals = visuals
    this.lecture = lecture
    this._manager = {
      id: socket.id,
      clientId,
      connected: true,
    }

    this.cooldown = new CooldownTimer(io, this.gameId)

    this.playerManager = new PlayerManager({
      io,
      gameId: this.gameId,
      isManager: this.isManager.bind(this),
      getVisuals: () => this.visuals,
    })

    this.round = new RoundManager({
      quizz,
      players: this.playerManager,
      cooldown: this.cooldown,
      io,
      gameId: this.gameId,
      getManagerId: () => this._manager.id,
      isManager: this.isManager.bind(this),
      broadcast: this.broadcastStatus.bind(this),
      send: this.sendStatus.bind(this),
      onNewQuestion: () => {
        this.playerStatus.clear()
        this.emitLectureState()
      },
      onGameFinished: (result) => {
        this.recordResult(result)
        this.emitLectureState()
      },
      lecture,
    })

    this.poll = new PollManager({
      io,
      players: this.playerManager,
      gameSubject: quizz.subject,
      getManagerId: () => this._manager.id,
      isManager: this.isManager.bind(this),
      onSettled: onPollSettled,
    })

    this.asks = lecture
      ? new AskManager({
          gameSubject: quizz.subject,
          save: saveAsks,
          onChanged: (change) => {
            this.onAsksChanged(change)
          },
        })
      : null

    // What a resyncing manager gets back while the game is still a lobby.
    this.managerStatus = {
      name: STATUS.SHOW_ROOM,
      data: { text: "game:waitingForPlayers", inviteCode: this.inviteCode },
    }

    socket.join(this.gameId)
    socket.emit(EVENTS.MANAGER.GAME_CREATED, {
      gameId: this.gameId,
      inviteCode: this.inviteCode,
      visuals: this.visuals,
      ...this.lecturePayload(),
    })

    console.log(
      `New game created: ${this.inviteCode} subject: ${quizz.subject}`,
    )

    // The inbox lists a lecture room from the start, so a room without
    // questions can still be paused.
    if (this.asks) {
      askRoomSignal.opened(this)
    }
  }

  get manager() {
    return this._manager
  }

  // Only the socket attached as manager may run the game; one that left
  // must reconnect first.
  private isManager(socket: Socket): boolean {
    return this._manager.connected && this._manager.id === socket.id
  }

  get players(): Player[] {
    return this.playerManager.getAll()
  }

  get started(): boolean {
    return this.round.isStarted()
  }

  // Players can only join before the start; afterwards only those already
  // in the game can come back, through a reconnect.
  get inLobby(): boolean {
    return this.round.isLobby()
  }

  // A lecture game also takes newcomers between questions.
  get acceptsNewPlayers(): boolean {
    return this.round.acceptsNewPlayers()
  }

  // ── Lecture state ────────────────────────────────────────────────────────

  private lectureState(): LectureState {
    const asks = this.asks?.count()

    return {
      inviteCode: this.inviteCode,
      ...this.round.getLectureProgress(),
      ...(this.pollsDone.length ? { pollsDone: [...this.pollsDone] } : {}),
      ...(asks ? { asks } : {}),
    }
  }

  // Only a lecture game tells its host which questions have run.
  private lecturePayload(): { lecture?: LectureState } {
    return this.lecture ? { lecture: this.lectureState() } : {}
  }

  private emitLectureState() {
    if (!this.lecture || !this._manager.connected) {
      return
    }

    this.io
      .to(this._manager.id)
      .emit(EVENTS.MANAGER.LECTURE_STATE, this.lectureState())
  }

  private emitPlayerPresence() {
    if (this._manager.connected) {
      this.io.to(this._manager.id).emit(EVENTS.MANAGER.PLAYER_PRESENCE, {
        gameId: this.gameId,
        players: this.playerManager.getAll().map(toPublicPlayer),
      })
    }
  }

  // A game's result is written once, however it ends.
  private recordResult(result: GameResult) {
    if (this.resultSaved) {
      return
    }

    // A failed write leaves the latch open so a later call (a SIGTERM save)
    // can still try; `false` is the only failure signal.
    this.resultSaved = saveResult(result)
  }

  // Keeps the questions a lecture game played when it closes before its
  // final standings.
  saveUnfinishedLecture() {
    const result = this.round.getUnfinishedResult()

    if (result) {
      this.recordResult(result)
    }
  }

  // ── Status broadcasting ──────────────────────────────────────────────────

  private broadcastStatus<T extends Status>(status: T, data: StatusDataMap[T]) {
    const statusData = { name: status, data }
    this.lastBroadcastStatus = statusData
    // A room-wide status supersedes the manager's own (e.g. the lobby).
    this.managerStatus = null
    this.io.to(this.gameId).emit(EVENTS.GAME.STATUS, statusData)
  }

  private sendStatus<T extends Status>(
    target: string,
    status: T,
    data: StatusDataMap[T],
  ) {
    const statusData = { name: status, data }

    if (this._manager.id === target) {
      this.managerStatus = statusData

      // Kept for reconnect; the old socket may be hosting another game now.
      if (!this._manager.connected) {
        return
      }
    } else {
      this.playerStatus.set(target, statusData)

      if (!this.playerManager.findById(target)?.connected) {
        return
      }
    }

    this.io.to(target).emit(EVENTS.GAME.STATUS, statusData)
  }

  // Player actions

  join(socket: Socket, username: string) {
    const lateToLecture = this.lecture && this.started

    if (!this.acceptsNewPlayers) {
      socket.emit(
        EVENTS.GAME.ERROR_MESSAGE,
        lateToLecture
          ? "errors:game.questionInProgress"
          : "errors:game.alreadyStarted",
      )

      return
    }

    // A latecomer waits for what the lecture brings next, not for players.
    const waitText = this.inLobby ? undefined : this.round.latecomerNote()
    const player = this.playerManager.join(socket, username, waitText)

    if (!player) {
      return
    }

    // Stored too, so a reconnect does not replay the last question's screen.
    if (waitText) {
      this.sendStatus(player.id, STATUS.WAIT, { text: waitText })
    }

    if (this._manager.connected) {
      this.io
        .to(this._manager.id)
        .emit(EVENTS.MANAGER.NEW_PLAYER, toPublicPlayer(player))
    }

    this.emitPlayerPresence()
  }

  // A kicked client may not come back in through the lobby or a lecture's
  // between-question window.
  isKicked(clientId: string): boolean {
    return this.playerManager.isKicked(clientId)
  }

  kickPlayer(socket: Socket, playerId: string) {
    const player = this.playerManager.findById(playerId)

    if (player && this.playerManager.kick(socket, playerId)) {
      this.emitPlayerPresence()
      this.playerStatus.delete(playerId)
      this.round.forgetPlayer(player.clientId)
      this.poll.forgetPlayer(player.clientId)

      // The host's "N answered" counter would still count a kicked answer.
      const answered = this.round.getAnswerCount()

      if (answered !== null) {
        this.io.to(this.gameId).emit(EVENTS.GAME.PLAYER_ANSWER, answered)
      }

      this.round.endIfEveryoneAnswered()
    }
  }

  // Reconnect

  reconnectManager(socket: Socket) {
    // The attached socket asking again just resyncs. Another socket with the
    // same clientId is the host back before the server noticed the old
    // connection died (a network change, a laptop waking), so the newest
    // connection wins.
    if (this._manager.connected && this._manager.id !== socket.id) {
      this.io
        .to(this._manager.id)
        .emit(EVENTS.GAME.RESET, "errors:game.openedElsewhere")
      this.io.in(this._manager.id).socketsLeave(this.gameId)
    }

    socket.join(this.gameId)
    this._manager.id = socket.id
    this._manager.connected = true

    const selectedStatus = selectReconnectStatus(
      this.managerStatus,
      this.lastBroadcastStatus,
    )
    const status = restampReconnectStatus(selectedStatus)

    socket.emit(EVENTS.MANAGER.SUCCESS_RECONNECT, {
      gameId: this.gameId,
      currentQuestion: this.round.getReconnectInfo(),
      status,
      players: this.playerManager.getAll().map(toPublicPlayer),
      visuals: this.visuals,
      ...this.lecturePayload(),
      ...pollPayload(this.poll.snapshotForHost()),
    })
    socket.emit(EVENTS.GAME.TOTAL_PLAYERS, this.playerManager.count())

    // The answer count only arrives as answers come in; a host back mid-
    // question would otherwise read 0 until the next one.
    const answered = this.round.getAnswerCount()

    if (answered !== null) {
      socket.emit(EVENTS.GAME.PLAYER_ANSWER, answered)
    }

    registry.reactivateGame(this.gameId)
    console.log(`Manager reconnected to game ${this.inviteCode}`)
  }

  // Routed by the event, not the clientId: a host may also play in the game
  // from another tab of the same browser.
  reconnectPlayer(socket: Socket) {
    const clientId = socket.handshake.auth.clientId as string
    const player = this.playerManager.findByClientId(clientId)

    if (!player) {
      return
    }

    if (player.connected && player.id !== socket.id) {
      // A phone that changed networks is back before the server has noticed
      // its old connection died. The newest connection wins.
      this.io
        .to(player.id)
        .emit(EVENTS.GAME.RESET, "errors:game.openedElsewhere")
      this.io.in(player.id).socketsLeave(this.gameId)
    }

    socket.join(this.gameId)

    const oldSocketId = player.id
    this.playerManager.updateSocketId(oldSocketId, socket.id)
    player.connected = true

    const selectedStatus = selectReconnectStatus(
      this.playerStatus.get(oldSocketId),
      this.lastBroadcastStatus,
    )
    const status = restampReconnectStatus(selectedStatus)

    const oldStatus = this.playerStatus.get(oldSocketId)

    if (oldStatus) {
      this.playerStatus.delete(oldSocketId)
      this.playerStatus.set(socket.id, oldStatus)
    }

    socket.emit(EVENTS.PLAYER.SUCCESS_RECONNECT, {
      gameId: this.gameId,
      currentQuestion: this.round.getReconnectInfo(),
      status,
      player: { username: player.username, points: player.points },
      visuals: this.visuals,
      ...pollPayload(this.poll.snapshotForPlayer(clientId)),
    })
    socket.emit(EVENTS.GAME.TOTAL_PLAYERS, this.playerManager.count())

    // The host's lobby names a seat by socket id, and this phone has a new
    // one: without this a Kick aims at the dead id and a later leave misses.
    // The host's seat for the same name takes the new id in place.
    if (this._manager.connected) {
      this.io
        .to(this._manager.id)
        .emit(EVENTS.MANAGER.NEW_PLAYER, toPublicPlayer(player))
    }

    console.log(
      `Player ${player.username} reconnected to game ${this.inviteCode}`,
    )
    this.emitPlayerPresence()
  }

  // Disconnect helpers

  setManagerDisconnected() {
    this._manager.connected = false
    this.io.in(this._manager.id).socketsLeave(this.gameId)
  }

  removePlayer(socketId: string): Player | undefined {
    const player = this.playerManager.remove(socketId)

    if (player) {
      this.poll.forgetPlayer(player.clientId)
      this.io.in(socketId).socketsLeave(this.gameId)

      if (this._manager.connected) {
        this.io
          .to(this._manager.id)
          .emit(EVENTS.MANAGER.REMOVE_PLAYER, player.id)
      }

      this.playerManager.broadcastCount()
      this.emitPlayerPresence()
    }

    return player
  }

  setPlayerDisconnected(socketId: string) {
    // No player holds that id (a stale socket): nothing to mark, announce or
    // wait out.
    if (!this.playerManager.findById(socketId)?.connected) {
      return
    }

    this.playerManager.setDisconnected(socketId)
    this.io.in(socketId).socketsLeave(this.gameId)
    this.playerManager.broadcastCount()
    this.emitPlayerPresence()

    // Unless they are back by then, stop holding the answers open for them.
    setTimeout(() => {
      this.round.endIfEveryoneAnswered()
    }, DROP_GRACE_MS)
  }

  // Game flow

  // Ends the game for everyone still in it, once the registry has dropped it.
  close(message: string) {
    // Before stop(): a stopped round no longer reports what was played.
    this.saveUnfinishedLecture()
    this.settlePoll()
    this.settleAsks()
    this.poll.stop()
    this.round.stop()
    this.io.to(this.gameId).emit(EVENTS.GAME.RESET, message)
    this.io.in(this.gameId).socketsLeave(this.gameId)

    if (this.asks) {
      askRoomSignal.closed(this)
    }
  }

  // A poll that is open or showing its result owns the room: no quiz step
  // starts or advances until the host has dismissed it.
  async start(socket: Socket) {
    if (this.poll.isActive()) {
      return
    }

    await this.round.start(socket)
  }

  selectAnswer(socket: Socket, answerId: number) {
    this.round.selectAnswer(socket, answerId)
  }

  nextRound(socket: Socket) {
    if (this.poll.isActive()) {
      return
    }

    this.round.nextQuestion(socket)
  }

  abortRound(socket: Socket) {
    this.round.abortQuestion(socket)
  }

  unlockAnswers(socket: Socket) {
    this.round.unlockAnswers(socket)
  }

  showLeaderboard(socket: Socket) {
    if (this.poll.isActive()) {
      return
    }

    this.round.showLeaderboard(socket)
  }

  playQuestion(socket: Socket, index: number): LectureOutcome {
    if (this.poll.isActive()) {
      return "busy"
    }

    const outcome = this.round.playQuestion(socket, index)

    // From the lobby the countdown runs first; the host learns the question
    // now rather than when it appears.
    if (outcome === "accepted") {
      this.emitLectureState()
    }

    return outcome
  }

  finish(socket: Socket): LectureOutcome {
    if (this.poll.isActive()) {
      return "busy"
    }

    return this.round.finish(socket)
  }

  // ── Polls ────────────────────────────────────────────────────────────────

  // Only a lecture room runs polls, and only for its host.
  private pollRefusal(socket: Socket): PollOutcome | null {
    if (!this.lecture) {
      return "notLecture"
    }

    return this.isManager(socket) ? null : "notManager"
  }

  // The moments a lecture room rests on, when a poll may take it: the lobby,
  // the results between questions, and after the podium.
  private roomAtRest(): boolean {
    return (
      this.round.isLobby() ||
      this.round.isBetweenQuestions() ||
      this.round.isFinished()
    )
  }

  // A poll may take the room while it rests, and only when no other poll is
  // showing.
  private laneIsBusy(): boolean {
    return this.poll.isActive() || !this.roomAtRest()
  }

  // Starts a stored poll. Any trouble reading it answers `notFound`, so the
  // host's reply always arrives.
  startPoll(socket: Socket, pollId: string): PollOutcome {
    const refusal = this.pollRefusal(socket)

    if (refusal) {
      return refusal
    }

    if (this.laneIsBusy()) {
      return "busy"
    }

    if (this.pollsDone.length >= MAX_POLLS_DONE) {
      return "full"
    }

    try {
      return this.markStarted(
        this.poll.start(socket, getPollById(pollId)),
        false,
      )
    } catch (error) {
      console.error(`Failed to start poll ${logSafe(pollId)}:`, error)

      return "notFound"
    }
  }

  // Starts a poll sent with the command, as a deck's slide text is. It passes
  // the same rules as a stored one, plus a slug for its id, and nothing is
  // written to the stored polls: the open poll holds the copy, and the result
  // it leaves keeps the text that was asked. Anything that does not pass
  // answers `invalid`, to the host only: a stranger is told nothing of it.
  //
  // A deck's poll runs once per room (`alreadyRan`), and it may take the stage
  // from a closed result in one step, so a deck going from one poll's result
  // to the next poll never shows the lobby in between. An open poll still
  // answers `busy`.
  startInlinePoll(socket: Socket, definition: unknown): PollOutcome {
    const refusal = this.pollRefusal(socket)

    if (refusal) {
      return refusal
    }

    const poll = inlinePollOf(definition)

    if (!poll) {
      return "invalid"
    }

    if (this.poll.isOpen() || !this.roomAtRest()) {
      return "busy"
    }

    if (this.inlineDone.has(poll.id)) {
      return "alreadyRan"
    }

    if (this.pollsDone.length >= MAX_POLLS_DONE) {
      return "full"
    }

    return this.markStarted(
      this.poll.start(socket, poll, { replaceClosed: true }),
      true,
    )
  }

  private markStarted(outcome: PollOutcome, inline: boolean): PollOutcome {
    if (outcome === "accepted") {
      this.activeInline = inline
      // A poll after the podium closes onto the quiz-over wait, never back
      // onto a phone's final place.
      this.restStandings()
    }

    return outcome
  }

  /**
   * A deck's lecture room after its podium: each phone shows its final place
   * only while the deck shows the host page (its standings face); once the
   * deck moves on, the quiz-over wait a latecomer gets. So a poll after the
   * podium, a reconnect or the rest of the lecture never falls back to the
   * result card (CST-426 task 0170). The bridge sends it from the deck's
   * `visibility`. Only the room's host, only a finished lecture room.
   */
  showStandings(socket: Socket, shown: boolean): void {
    if (!this.lecture || !this.isManager(socket) || !this.round.isFinished()) {
      return
    }

    if (!shown) {
      this.restStandings()

      return
    }

    // Under a poll the phones stay on the wait; the poll's own screen is up.
    if (!this.standingsResting || this.poll.isActive()) {
      return
    }

    this.standingsResting = false

    for (const player of this.playerManager.getAll()) {
      const place = this.finalPlaces.get(player.clientId)

      if (place) {
        this.sendStatus(player.id, place.name, place.data)
      }
    }
  }

  private restStandings(): void {
    if (!this.lecture || !this.round.isFinished() || this.standingsResting) {
      return
    }

    this.standingsResting = true

    for (const player of this.playerManager.getAll()) {
      const status = this.playerStatus.get(player.id)

      if (status?.name === STATUS.FINISHED) {
        this.finalPlaces.set(player.clientId, status)
        this.sendStatus(player.id, STATUS.WAIT, {
          text: LECTURE_TEXT.QUIZ_OVER,
        })
      }
    }
  }

  // A close or dismiss may name the poll it means (`pollId`). A deck does, so
  // a late command for a poll it has left cannot touch the one after it: a
  // name that is not the poll on the stage changes nothing (`notCurrent`).
  private targetRefusal(socket: Socket, pollId?: string): PollOutcome | null {
    if (pollId === undefined) {
      return null
    }

    if (!this.isManager(socket)) {
      return "notManager"
    }

    const current = this.poll.currentId()

    if (current === null) {
      return "none"
    }

    return current === pollId ? null : "notCurrent"
  }

  closePoll(socket: Socket, pollId?: string): PollOutcome {
    const refusal = this.targetRefusal(socket, pollId)

    if (refusal) {
      return refusal
    }

    const outcome = this.poll.close(socket)
    const done = outcome === "accepted" ? this.poll.closedSummary() : null

    // A deck learns what ran from the lecture state, so a reloaded frame knows
    // too, and the host's frame can show the result again.
    if (done) {
      this.pollsDone = [...this.pollsDone, done]

      if (this.activeInline) {
        this.inlineDone.add(done.id)
      }

      this.emitLectureState()
    }

    return outcome
  }

  // A deck's poll that closed here opens again with its votes (`pollReopen`):
  // in place while its result is on the stage, or back onto the stage from the
  // room at rest or from another poll's result. It then counts as not run until
  // it closes again, and that close replaces the result it saved.
  reopenInlinePoll(socket: Socket, pollId: string): PollOutcome {
    const refusal = this.pollRefusal(socket)

    if (refusal) {
      return refusal
    }

    if (!this.inlineDone.has(pollId)) {
      return "notFound"
    }

    if (this.poll.isOpen() || !this.roomAtRest()) {
      return "busy"
    }

    const outcome = this.poll.reopen(socket, pollId, { replaceClosed: true })

    if (outcome === "accepted") {
      this.activeInline = true
      this.restStandings()
      this.inlineDone.delete(pollId)
      this.pollsDone = this.pollsDone.filter((done) => done.id !== pollId)
      this.emitLectureState()
    }

    return outcome
  }

  dismissPoll(socket: Socket, pollId?: string): PollOutcome {
    return this.targetRefusal(socket, pollId) ?? this.poll.dismiss(socket)
  }

  votePoll(socket: Socket, pollId: string, option: number): PollVoteOutcome {
    return this.poll.vote(socket, pollId, option)
  }

  // A screen that has just opened (a phone arriving after it joined, a host
  // page) has no other way to learn of a poll that began before it listened.
  // Nothing showing answers `null`, so a stale overlay clears as well.
  syncPoll(socket: Socket) {
    const snapshot = this.poll.snapshotForSocket(socket)

    if (snapshot !== undefined) {
      socket.emit(EVENTS.POLL.STATE, snapshot)
    }
  }

  // Keeps an open poll as a partial result when the room closes on it, and
  // offers a result that could not be saved once more.
  settlePoll() {
    this.poll.settlePending()
  }

  // ── Questions for the presenter (asks) ───────────────────────────────────

  // The host page and the deck hear of the count and the box; the phones hear
  // only of the box; the inbox hears of everything. No question's text or
  // name goes to the room or the host here.
  private onAsksChanged(change: AskChange) {
    if (change.count) {
      this.emitLectureState()
    }

    if (change.box && this.asks) {
      this.io.to(this.gameId).emit(EVENTS.ASK.BOX, { open: this.asks.isOpen() })
    }

    askRoomSignal.changed(this)
  }

  // Any phone in a lecture room may send, in any phase: the phone hides its
  // button while a question runs. The order of the checks is the contract's.
  sendAsk(
    socket: Socket,
    message: { text: unknown; signed: unknown; nonce: unknown },
  ): AskOutcome {
    if (!this.asks) {
      return "notLecture"
    }

    const player = this.playerManager.findById(socket.id)

    if (!player) {
      return "notPlayer"
    }

    return this.asks.send(
      { clientId: player.clientId, username: player.username },
      message,
    )
  }

  // A phone that has just opened or come back asks whether it can send.
  // Anyone who is not a player of a lecture room is told `null`.
  syncAsks(socket: Socket) {
    const player = this.playerManager.findById(socket.id)

    socket.emit(
      EVENTS.ASK.BOX,
      this.asks && player ? { open: this.asks.isOpen() } : null,
    )
  }

  // The game's manager (the presenter's deck frame or host page) opens or
  // closes the box. The inbox has its own way in.
  setAskBox(socket: Socket, open: unknown): AskBoxOutcome {
    if (!this.asks) {
      return "notLecture"
    }

    if (!this.isManager(socket)) {
      return "notManager"
    }

    if (typeof open !== "boolean") {
      return "invalid"
    }

    this.asks.setOpen(open)

    return "accepted"
  }

  // Offers a record that could not be kept once more: at the room's close,
  // and when the server shuts down.
  settleAsks() {
    this.asks?.settle()
  }

  // ── What the presenter's inbox may do (its handler checks the login) ─────

  // The room as the inbox sees it, text included; a normal game has none.
  // Only the inbox's watchers are ever sent this.
  askView(): AskRoomView | null {
    if (!this.asks) {
      return null
    }

    return {
      gameId: this.gameId,
      inviteCode: this.inviteCode,
      gameSubject: this.asks.gameSubject,
      open: this.asks.isOpen(),
      waiting: this.asks.waiting(),
      saved: this.asks.isSaved(),
      record: this.asks.getRecord(),
    }
  }

  askRecordId(): string | null {
    return this.asks?.recordId() ?? null
  }

  getAskRecord(): AskRecord | null {
    return this.asks?.getRecord() ?? null
  }

  // The inbox's pause: any authorized watcher, not only the game's manager.
  // `false` for a normal game.
  setAskOpen(open: boolean): boolean {
    if (!this.asks) {
      return false
    }

    this.asks.setOpen(open)

    return true
  }

  markAsk(askId: string, state: AskState): AskMarkOutcome {
    return this.asks?.mark(askId, state) ?? "notFound"
  }

  markAllAsks() {
    this.asks?.markAll()
  }

  removeAsk(askId: string): AskMarkOutcome {
    return this.asks?.remove(askId) ?? "notFound"
  }
}

export default Game
