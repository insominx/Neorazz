# Embedding Neorazz in your own page

The host screen of Neorazz (the screen the room sees: the lobby with its PIN, each question, its results, the standings, polls) can sit inside another page and be driven from it. That page can be a slide deck, a class website or any web app. Players still join on their phones at the host's address, as usual.

Typical uses:

- A slide deck opens a room on its title slide, plays each question from the slide that asks it, and shows the podium on its last slide.
- A slide or a page starts a poll with its own question and options, then shows the result.
- A teaching app shows the room's PIN and live state next to its own content.

This guide is for teachers who want to try it and for developers (or coding agents) who are building an integration. The contract it describes is version 1 of the protocol in [`packages/web/src/features/deck/protocol.ts`](../packages/web/src/features/deck/protocol.ts). [ADR 0009](adr/0009-embedding-is-supported.md) records why it works this way.

## How it works

1. Your page puts the host page (`/manager?embed=deck`) in an `<iframe>`.
2. The two pages talk with [`postMessage`](https://developer.mozilla.org/docs/Web/API/Window/postMessage). Your page sends commands, such as "open a room for this quiz", "play question 3" or "start this poll". The host page answers with its state (what is on screen, the PIN, which questions have run), and with a result or an error when a command did not run.
3. The presenter types the manager password inside the frame once. Your page never sees it.
4. Your page decides what happens and when. The host page runs the room, the timers, the scoring and the sound.

The room an embedded page opens is a _lecture room_ ([ADR 0002](adr/0002-lecture-mode-and-deck-bridge.md)). It is built to last a whole session:

- It stays open between questions for as long as you need. Players who join late are let in between questions.
- You play the questions you want, by number, and each one runs once.
- The frame remembers its room for each quiz. If your page reloads, the frame takes the same room back, with the same PIN.
- If the host page's connection drops, the room waits 30 minutes for it to come back.

The host only lets a page drive it if the page's site is on its list (see [Allow your site](#2-allow-your-site)).

## Quick start on your own computer

You need Node.js 22 or later and pnpm 11, as for any work on Neorazz.

1. Clone the repository and install it:

   ```bash
   git clone https://github.com/insominx/Neorazz.git
   cd Neorazz
   pnpm install
   ```

2. Start it once with `pnpm run dev`, then stop it. The first start creates `config/game.json` with the placeholder password `PASSWORD`, and the placeholder refuses every login. Set your own `managerPassword` in that file and start it again with `pnpm run dev`. The host is now at http://localhost:3000.

3. In a second terminal, serve the example page. Any static file server will do, for example:

   ```bash
   python -m http.server 8080 --directory examples/embed
   ```

4. Open http://localhost:8080/?host=http://localhost:3000. In the frame, type your manager password. Type a quiz id (a file name in `config/quizz/`, without `.json`) and press **Open room**. The PIN appears.

5. Join as a player with that PIN, from another browser window at http://localhost:3000, or from a phone on the same network at your computer's network address (for example http://192.168.1.20:3000; `pnpm run dev` listens on the network). Then press **Play** to run the first question.

Pages on `localhost` and `127.0.0.1` are always allowed, so this needs no setup. The example's buttons call the same client you will use on your own page; open the browser console and use `quiz` (for example `quiz.state`) to try commands by hand.

## Put it on your own page

### 1. Run a host

Run Neorazz where the room can reach it: Docker on a school server, a cloud service, or your own computer on the class network. The [README](../README.md#-getting-started) has the steps. Students join at the host's address.

### 2. Allow your site

List the origin of each page that may drive the host in the `NEORAZZ_EMBED_ORIGINS` environment variable, separated by commas. An origin is the scheme, the host name and the port, with no path: `https://slides.example.org`, or `http://192.168.1.20:8080`.

```bash
docker run -d -p 3000:3000 -v ./config:/app/config \
  -e NEORAZZ_EMBED_ORIGINS=https://slides.example.org,https://class.example.edu \
  neorazz:local
```

With Docker Compose, add it under `environment:`. On a hosting service, set it as a service variable. The host reads the list each time it starts, so a change needs a restart, not a rebuild. With no list, only pages on `localhost` and `127.0.0.1` are allowed. Neorazz allows no site by default.

`pnpm run dev` and `vite preview` read the same variable. In development, the simplest place for it is a `.env` file in the repository root (it is not committed), with a line such as `NEORAZZ_EMBED_ORIGINS=http://192.168.1.20:8080`.

### 3. Add the client and mount it

Every host serves the client at `/neorazz-embed.js`. Loading it from your host means it always matches that host's version.

```html
<div id="quiz" style="width: 100%; aspect-ratio: 16 / 9"></div>

<script src="https://quiz.example.org/neorazz-embed.js"></script>
<script>
  const quiz = NeorazzEmbed.mount({
    host: "https://quiz.example.org",
    container: document.getElementById("quiz"),
  })

  // Opens a room for the quiz in config/quizz/my-quiz.json, or takes back the
  // one this frame already has for it.
  quiz.ensureGame({ quiz: "my-quiz" })

  quiz.on("status", (state) => {
    console.log(state.screen, state.inviteCode, state.players)
  })
</script>
```

Then call commands from your own buttons, slide changes or app events: `quiz.play({ question: 0 })`, `quiz.leaderboard()`, `quiz.finish()`.

If you would rather not load a script from the host, copy [`packages/web/public/neorazz-embed.js`](../packages/web/public/neorazz-embed.js) into your project. It has no dependencies and no build step. A copy does not update with the host, so check `state.features` before using a newer command.

## The client: `neorazz-embed.js`

### `NeorazzEmbed.mount(options)`

Creates the frame inside `container`, starts the handshake and returns the object below.

| Option        | Default         | Meaning                                                                                                                                                               |
| ------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`        | required        | The host's address. Only its origin is used.                                                                                                                          |
| `container`   | `document.body` | The element the frame fills (100% of its width and height).                                                                                                           |
| `visible`     | `true`          | Whether the frame starts shown. See `visibility` below.                                                                                                               |
| `interactive` | `"always"`      | When the frame takes clicks: `"always"`, `"login"` (only while the host page waits for the password, so clicks and keys otherwise stay with your page), or `"never"`. |
| `backdrop`    | none            | `"own"` or `"slide"`, sent with the first `ready`. See `backdrop` below.                                                                                              |
| `controls`    | none            | `true` or `false`, sent with the first `ready`. See `controls` below.                                                                                                 |
| `title`       | `"Neorazz"`     | The frame's accessible name.                                                                                                                                          |

### The object `mount` returns

| Member                    | Meaning                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `state`                   | The latest state the host page reported (see [State](#state)), or `null` before the first.                                                           |
| `ready`                   | A promise that resolves with the state in the first `ready`.                                                                                         |
| `on(type, listener)`      | Listens for `ready`, `status`, `result`, `error`, `key`, `inbox`, or `message` (every message). Returns a function that stops listening.             |
| `off(type, listener)`     | Stops a listener.                                                                                                                                    |
| `when(test, { timeout })` | A promise that resolves with the first state, now or later, for which `test(state)` is true. With `timeout` (in ms) it rejects after that long.      |
| `send(type, fields)`      | Sends any command by name.                                                                                                                           |
| a method per command      | `quiz.play({ question: 0 })` is `send("play", { question: 0 })`. Every command in [Commands](#commands) except `hello` has one. They return nothing. |
| `frame`, `origin`         | The `<iframe>` element and the host's origin.                                                                                                        |
| `destroy()`               | Stops listening and removes the frame.                                                                                                               |

Commands are sent, not awaited. What a command did shows in the next `status`, and a command that did not run is answered with a `result` or an `error` that says why. To wait for an outcome, wait for the state you expect:

```js
quiz.ensureGame({ quiz: "my-quiz" })
const lobby = await quiz.when((state) => state.inviteCode !== null)
showPin(lobby.inviteCode)
```

What the client does for you:

- Once the frame has loaded, it says `hello` every second until the host page answers, and again after every reload of the frame.
- It holds commands you send before the host page has answered, and sends them once it has. Opening and closing a room wait as long as that takes. Any other command that waited more than 10 seconds is dropped and answered with a `result` whose `reason` is `expired` and `local: true`, because a question started late would land on the wrong slide.
- It sends the settings the host page keeps only in memory (`visibility`, `controls`, `backdrop`, `sound`, `askBox`, `inbox`) again after every `ready`, so a reloaded frame gets them back.
- It reads only messages from its own frame and from the host's origin.
- If the host has not answered after 10 seconds, it prints one warning in the browser console that names the likely causes, then loads the frame again, less and less often (at most once a minute).
- It sets the frame's opacity and `pointer-events` from `visibility` and `interactive`, and gives the frame `allow="autoplay"` and `color-scheme: dark`.

## Recipe: a slide deck

- **Mount once for the whole talk.** Put one frame over the slides (fixed, full screen) and keep it for the session, rather than one frame per slide. The frame's connection is the room's host, so destroying it drops the room's host.
- **Use `interactive: "login"`**, so that clicks and keys stay with the deck except while the presenter types the password.
- **Show it only on quiz slides.** Send `visibility({ visible: true })` when a quiz slide comes up and `visibility({ visible: false })` when it goes. The host page is silent while it is hidden.
- **Join slide:** `ensureGame({ quiz, restart: "ifFinished" })`. A room that already finished is replaced with a fresh lobby. One that is still open is kept.
- **Question slide N:** `play({ question: N })`, where N counts from 0 in the quiz file's order. Going back to a slide whose question already ran: `review({ question: N })` shows its results again without touching the room, and `review({ question: null })` ends that.
- **Standings and the end:** `leaderboard()` after a question's results; `finish()` on the last slide shows the podium and saves the result.
- **Keys:** while the frame has focus, the host page sends navigation keys back as `key` messages (see [Keys](#keys)). Pass them to your deck's navigation, so a clicker keeps working after someone clicks in the frame.
- **Let the slide show through:** `backdrop({ mode: "slide" })` clears the host page's own background, so your slide's picture shows behind the quiz.
- **Sound button:** draw it on your slide and send `sound({ muted })`. The host's current setting is in `state.sound`.
- **Size:** the host screen is designed for a 16:9 projector. For a pixel-exact look, give the container 1920×1080 pixels and scale it with a CSS `transform`, as slide decks scale their slides.

## Protocol reference

Read this if you are writing your own client instead of using `neorazz-embed.js`.

### Messages and the handshake

Every message your page sends to the frame's window has this envelope, and is posted with the host's origin as the target:

```js
frame.contentWindow.postMessage(
  { source: "neorazz-embed", v: 1, type: "play", question: 0 },
  "https://quiz.example.org",
)
```

Every message the host page sends back has `source: "razzia-bridge"` and `v: 1`. The word `razzia` remains from the project Neorazz grew out of ([ADR 0008](adr/0008-the-name-neorazz.md)). Accept a message only if `event.origin` is the host's origin and `event.source` is the frame's window.

The host page also reads `source: "cst426-deck"`, the tag the first lecture decks used before embedding was documented. Use `neorazz-embed` in new pages. Hosts from before November 2026 read only `cst426-deck`.

The host page says nothing until it hears from your page. Send `hello` about once a second until it answers with `ready`; it may still be loading. From then on it sends `status` whenever its state changes and every 5 seconds, so a page that stops hearing it can tell. After the frame reloads, say `hello` again.

### Commands

The `question` fields count from 0 in the quiz file's order.

| Command       | Fields                                                                 | What it does                                                                                                                                                                                                                                                                                                                      | Answer                                                                                                                              |
| ------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `hello`       | none                                                                   | Asks the host page to start talking to this page.                                                                                                                                                                                                                                                                                 | `ready`                                                                                                                             |
| `ensureGame`  | `quiz` (a quiz id), `restart` (`"ifFinished"` or `"always"`, optional) | Opens a lecture room for the quiz, or takes back the one this frame remembers for it. Without a login it shows the password form first (`pending: "login"`), and carries on by itself once the presenter has logged in. `"ifFinished"` replaces a finished room with a new lobby; `"always"` closes the room and opens a new one. | `result` `accepted` once the room is this page's; `error` `quizNotFound`; `result` `queued` while the page is getting its room back |
| `close`       | `quiz`                                                                 | Closes the room. Nothing opens again until the next `ensureGame`.                                                                                                                                                                                                                                                                 | `result`                                                                                                                            |
| `play`        | `question`                                                             | Plays that question, once. From the lobby it starts with the countdown.                                                                                                                                                                                                                                                           | `result`; `error` `noPlayers`, `notLectureGame` or `noAck`                                                                          |
| `leaderboard` | none                                                                   | Shows the standings. Only right after a question's results.                                                                                                                                                                                                                                                                       | `result`                                                                                                                            |
| `finish`      | none                                                                   | Ends the room on its podium and saves the result. Needs at least one played question, and no poll on screen (`busy`).                                                                                                                                                                                                             | `result`; `error` `noAck`                                                                                                           |
| `review`      | `question` (or `null`)                                                 | Shows a played question's results again in place of the room's own screen, silently; `null` goes back. Only this page changes, never the room or the phones.                                                                                                                                                                      | none                                                                                                                                |
| `visibility`  | `visible`                                                              | Tells the host page whether your page is showing it. It stays silent while it is not shown, and counts itself not shown until told. After a room's podium, the phones show their final place only while your page shows the host page; otherwise they wait with "The quiz is over".                                               | none                                                                                                                                |
| `controls`    | `shown`                                                                | Shows or hides Neorazz's own host buttons (Next, Skip, end the quiz). They start hidden in a frame, since your page drives the room.                                                                                                                                                                                              | none                                                                                                                                |
| `backdrop`    | `mode` (`"own"` or `"slide"`)                                          | `"slide"` clears the host page's own background so your page shows through; `"own"` (the default) brings it back.                                                                                                                                                                                                                 | none                                                                                                                                |
| `sound`       | `muted` and `volume` (0 to 1), either optional                         | Sets the host's sound. A volume also unmutes.                                                                                                                                                                                                                                                                                     | none; read `state.sound`                                                                                                            |
| `startPoll`   | `poll`: `{ id, question, options, anonymous?, live? }`                 | Starts a poll in the lobby or between questions. See [Polls](#polls).                                                                                                                                                                                                                                                             | `result`; `error` `pollInvalid` or `noAck`                                                                                          |
| `closePoll`   | `pollId`, `gameId` (both optional)                                     | Ends the voting and shows the result. `pollId` is the `id` you started the poll with (also `state.poll.id`); `gameId` is `state.gameId`. Naming them makes a late command harmless: if either does not match, nothing changes (`notCurrent`).                                                                                     | `result`                                                                                                                            |
| `dismissPoll` | `pollId`, `gameId` (both optional)                                     | Takes the result away and gives the room back to the quiz.                                                                                                                                                                                                                                                                        | `result`                                                                                                                            |
| `reopenPoll`  | `pollId`, `gameId` (optional)                                          | Opens a poll that closed in this room again, with the votes it had: in place while its result is on screen, or back onto the screen. Players who left the room since lose their votes. Its next close replaces the result the last one saved.                                                                                     | `result`                                                                                                                            |
| `reviewPoll`  | `id` (or `null`)                                                       | Shows a poll that closed in this room again, as it was left; `null` stops. Only this page changes.                                                                                                                                                                                                                                | none                                                                                                                                |
| `askBox`      | `open`                                                                 | The room's question box (see [Questions from the room](#questions-from-the-room)). `false` closes it in every room this page hosts until the frame reloads; `true` opens it once and drops that.                                                                                                                                  | none; read `state.asks.open`                                                                                                        |
| `askOpen`     | `open`                                                                 | Pauses or resumes the question box of this room only.                                                                                                                                                                                                                                                                             | `result`                                                                                                                            |
| `inbox`       | `open`                                                                 | `true` asks for the room's waiting questions, sent as `inbox` messages until `false`. For the presenter's own screen only.                                                                                                                                                                                                        | `inbox`                                                                                                                             |
| `markAsk`     | `askId`                                                                | Marks one waiting question as seen.                                                                                                                                                                                                                                                                                               | `result`                                                                                                                            |
| `markAllAsks` | none                                                                   | Marks every waiting question as seen.                                                                                                                                                                                                                                                                                             | `result`                                                                                                                            |

A command the host page cannot read (an unknown type, a missing field, a field of the wrong type) is ignored without an answer. The one exception is a malformed `startPoll`, which is answered with `error` `pollInvalid`.

**Commands that arrive early.** A `play` or `finish` sent before the host page is the room's host (while the room opens or comes back) is answered `queued`, then runs when it can. After 10 seconds it is dropped instead (`ignored`, `expired`), and a newer one replaces it (`superseded`). `leaderboard` and the poll commands are never held: they are answered `ignored`, `notAttached`, so your page can decide what to do.

### Messages

| Message  | Fields                                                           | When                                                                                        |
| -------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ready`  | `state`                                                          | In answer to `hello`.                                                                       |
| `status` | `state`                                                          | Whenever the state changes, and every 5 seconds.                                            |
| `result` | `command`, `outcome` (`accepted`, `queued`, `ignored`), `reason` | For a command that has an answer. `queued` is followed by a final `accepted` or `ignored`.  |
| `error`  | `code`, `command` (when one caused it)                           | See [Error codes](#error-codes). Some come right after a `result` that says the same thing. |
| `key`    | `key`, `code`, `repeat`                                          | A navigation key pressed while the frame had focus. See [Keys](#keys).                      |
| `inbox`  | `room`                                                           | While your page asks (`inbox { open: true }`): the room's waiting questions, or `null`.     |

Answers carry the command's type, not an id. Send one command of a kind at a time, and wait for its answer or for the state it leads to before sending the next.

### State

`ready` and `status` carry the host page's state:

| Field              | Meaning                                                                                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `connected`        | Whether the host page is connected to the server.                                                                                                                                                                                                                                                  |
| `loggedIn`         | `true`, `false` (the presenter has to type the password in the frame), or `null` (not known yet).                                                                                                                                                                                                  |
| `pending`          | What an `ensureGame` is waiting for: `"login"`, `"create"` (a new room), `"resume"` (the remembered room), or `null`.                                                                                                                                                                              |
| `reattaching`      | The connection dropped and the page is getting its room back (for up to 90 seconds).                                                                                                                                                                                                               |
| `gameId`           | The room this page hosts, or `null`.                                                                                                                                                                                                                                                               |
| `inviteCode`       | The room's PIN, or `null`.                                                                                                                                                                                                                                                                         |
| `lecture`          | Whether the room is a lecture room, the kind your page can drive.                                                                                                                                                                                                                                  |
| `screen`           | The host's screen: `SHOW_ROOM` (the lobby), `SHOW_START`, `SHOW_PREPARED`, `SHOW_QUESTION` and `SELECT_ANSWER` (a question running), `SHOW_RESPONSES` (its results), `SHOW_LEADERBOARD`, `FINISHED` (the podium), or `null`.                                                                       |
| `answeringOpen`    | Whether players can answer right now.                                                                                                                                                                                                                                                              |
| `question`         | The question that is starting, running or was played last, counted from 0. It is set from the countdown on; `null` before the first.                                                                                                                                                               |
| `total`            | How many questions the quiz has (a number).                                                                                                                                                                                                                                                        |
| `played`           | The questions that have started, as an array of numbers from 0, in order. A question joins it when its prompt appears, after the countdown.                                                                                                                                                        |
| `finished`         | Whether the room has finished.                                                                                                                                                                                                                                                                     |
| `players`          | How many players are in the room (a number).                                                                                                                                                                                                                                                       |
| `connectedPlayers` | How many of them are connected right now. Present once the host knows.                                                                                                                                                                                                                             |
| `visible`          | The last `visibility` your page sent.                                                                                                                                                                                                                                                              |
| `reviewing`        | The question whose results a `review` is showing, or `null`.                                                                                                                                                                                                                                       |
| `reviewable`       | The questions whose results this page can show again.                                                                                                                                                                                                                                              |
| `reviewingPoll`    | The closed poll a `reviewPoll` is showing, or `null`.                                                                                                                                                                                                                                              |
| `features`         | An array of names: what this host can do. See [Features](#features).                                                                                                                                                                                                                               |
| `poll`             | The poll on screen: `{ id, phase, anonymous, live, voted, counts? }`, or `null`. `phase` is `"open"`, then `"closed"`, and the poll stays here until `dismissPoll`. `counts` is an array of numbers in the order of the options; it comes with the close, or while the poll is open if it is live. |
| `pollsDone`        | The polls that closed in this room, oldest first (at most 50): `{ id, counts, total, partial? }`, with `counts` in the order of the options. A poll appears here a moment after its close shows in `poll`.                                                                                         |
| `sound`            | The host's sound setting: `{ muted, volume }`.                                                                                                                                                                                                                                                     |
| `asks`             | The room's question box: `{ waiting, open }`, where `waiting` is 0 to 10 (10 means "9 or more"), or `null`.                                                                                                                                                                                        |

The state never holds a player's name next to a choice, or the text of a question someone sent. It does not carry the quiz's own text either: your page knows its questions.

### Result reasons

An `ignored` result has a `reason`. The common ones:

- `notAttached`: the page is not the host of a room yet (open one with `ensureGame`, or wait for it).
- `questionLive`: a question is running; wait for its results.
- `busy`: a poll holds the room; dismiss it first.
- `alreadyPlayed`, `alreadyShown`: that question has run, or the standings are already on screen.
- `notInResults`: the standings come only right after a question's results.
- `nothingPlayed`: `finish` needs at least one played question.
- `finished`: the room has finished; `ensureGame` with `restart` opens a new one.
- `noPlayers`: nobody has joined yet.
- `expired`, `superseded`, `closed`: a held command was dropped (too old, replaced by a newer one, or the room closed).
- `notCurrent`: `closePoll` or `dismissPoll` named a poll or room that is not the current one.
- `notFound`: `reopenPoll` named a poll that has not closed in this room.
- `invalid`, `alreadyRan`, `full`: a poll that breaks the rules, one that already ran in this room, or a room that has run its maximum number of polls.

Other codes can appear (for example `invalidIndex` for a question the quiz does not have). Treat any `ignored` as "this did not happen".

### Error codes

| Code             | Meaning                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| `notLectureGame` | The room this page hosts was not opened by an embedding page (someone started it by hand), so it cannot be driven. |
| `quizNotFound`   | No quiz has that id.                                                                                               |
| `noPlayers`      | A question was asked for with nobody in the room.                                                                  |
| `gameExpired`    | The room is gone (closed, timed out, or the server restarted). The next `ensureGame` opens a new one.              |
| `reattachFailed` | After a dropped connection, the page could not get its room back within 90 seconds.                                |
| `pollInvalid`    | A poll definition broke the rules (see [Polls](#polls)) or was not shaped like one.                                |
| `noAck`          | The server did not answer within 5 seconds.                                                                        |

### Features

`state.features` lists what the host can do, so a page can tell an older host by what is missing.

| Feature           | Meaning                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| `poll`            | Polls: `startPoll`, `closePoll`, `dismissPoll` and `state.poll`.                                 |
| `pollInline`      | `startPoll` takes the poll's definition in the command, with nothing stored on the server first. |
| `pollReview`      | `reviewPoll`, `closePoll` and `dismissPoll` that name their poll, and `state.pollsDone`.         |
| `sound`           | The `sound` command and `state.sound`.                                                           |
| `pollAfterPodium` | A room still runs polls, and lets newcomers in, after its podium.                                |
| `asks`            | The question box: `askBox` and `state.asks`.                                                     |
| `presenterInbox`  | The presenter's inbox: `inbox`, `markAsk`, `markAllAsks`, `askOpen` and the `inbox` message.     |
| `pollReopen`      | `reopenPoll`: a closed poll opens again with its votes.                                          |

### Keys

While the frame has focus, these keys are sent to your page as `key` messages instead of acting in the frame: PageDown, PageUp, the four arrow keys, Space, Home, End, Escape and Q. Keys typed in a text field, keys with Ctrl, Alt or Meta, and keys inside a dialog stay in the frame. A deck usually maps them to its own navigation, and Q to `controls`.

## Polls

A poll is defined in the command, so its question can be the text already on your slide.

- `id`: your name for the poll, saved with its result: 1 to 64 lowercase letters, digits and hyphens, starting with a letter or digit. A poll runs once per room: starting the same `id` again after it closed is answered `alreadyRan`, and `reviewPoll` shows its result instead; `reopenPoll` opens it again with its votes (`pollReopen`). To ask the same question again in the same room, give it a new `id`.
- `question`: up to 500 characters.
- `options`: 2 to 6, each up to 200 characters.
- `anonymous` (default `true`): when `false`, the result saved on the server records who voted for what. The projected screen never shows a name next to a choice either way.
- `live` (default `false`): shows the counts as the votes arrive, instead of only after the close.

A poll can start in the lobby or between questions, not while a question runs. It holds the room until `dismissPoll`.

## Questions from the room

Players can send the presenter a question from their phones, anonymously unless they add their name ([ADR 0006](adr/0006-asks-a-private-question-lane.md)). The room's screen shows only how many are waiting (`state.asks`). Pause the box with `askOpen` or `askBox`.

The `inbox` message carries the questions' text, and the sender's name when they added it. It is meant for the presenter's own screen ([ADR 0007](adr/0007-presenter-drawer.md)). Never show it on the screen the room sees.

## Security and limits

- **Who can drive the host.** Only pages on `localhost`, `127.0.0.1`, or an origin in `NEORAZZ_EMBED_ORIGINS`. Any site can put the host page in a frame, but the host page ignores the commands of a site that is not allowed.
- **Only a top-level page.** The frame must be a direct child of the browser tab's top page. A page that is itself inside another frame cannot drive it.
- **The password stays in the frame.** The presenter types it into the host page; your page never sees it.
- **One login per site.** Browsers keep a framed page's storage separate for each site that embeds it, so the presenter logs in once for each embedding site. Logins live in the server's memory, so they also end when the host restarts, or after 12 hours without use.
- **A restart ends rooms.** Rooms are in the server's memory too. After a restart the next `ensureGame` opens a new lobby with a new PIN, and players join again.
- **Your page's own policy.** If your page sends a `Content-Security-Policy`, allow the host in `frame-src` and in `script-src`.

## Troubleshooting

- **Nothing answers, and the console warns.** The host is not running or not reachable from this computer; or your page's origin is not in `NEORAZZ_EMBED_ORIGINS` (check the exact scheme and port); or the page was opened as a file (`file://`), which has no origin, so serve it over http; or your page is inside another frame; or the host is older than embedding support.
- **The frame shows the login form and stays there.** Type the manager password in the frame. With `interactive: "login"`, the frame takes clicks only while that form is up. The placeholder password `PASSWORD` refuses every login: set your own in `config/game.json`.
- **`quizNotFound`.** The id is the quiz file's name without `.json`, as it is on the host.
- **`noPlayers`.** Nobody has joined. Players join at the host's address with the PIN in `state.inviteCode`.
- **Phones cannot reach the host.** On a phone, `localhost` means the phone itself. Give players an address they can reach: the host's public address, or your computer's network address (for example `http://192.168.1.20:3000`). The frame on your page can keep using `localhost`.
- **`ignored` with `questionLive` or `busy`.** A question or a poll holds the room. Wait for the question's results, or dismiss the poll.
- **No sound.** Browsers play sound only after someone has clicked or pressed a key on the page. Check also that your page sent `visibility({ visible: true })` (the client does unless you mounted with `visible: false`), and `state.sound`.
- **A clear backdrop is not clear.** The frame needs `color-scheme: dark` and a transparent background. The client sets both; a custom frame must set them too.

## Changing the contract

The contract is [`protocol.ts`](../packages/web/src/features/deck/protocol.ts) (commands, messages, error codes, features), [`plan.ts`](../packages/web/src/features/deck/plan.ts) (the state) and [`use-deck-bridge.ts`](../packages/web/src/features/deck/use-deck-bridge.ts) (what the host page does with each command). A change to it also changes this guide and [`neorazz-embed.js`](../packages/web/public/neorazz-embed.js). `packages/web/src/features/deck/embedding-docs.test.ts` fails when the tables above and the code disagree, and `packages/web/src/test/neorazz-embed.test.ts` checks the client against the protocol.

Keep version 1 compatible: add fields and commands, list new abilities in `FEATURES`, and keep reading the old tag. A change that breaks existing pages needs a new `v`.
