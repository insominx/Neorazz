# Neorazz design language

Authority for visual work in `packages/web`. Components consume semantic roles;
`src/index.css` is the only place a role resolves to a literal.

## Register

`document.documentElement.dataset.register` is `"dark"` or `"light"`.

It is light only when the operator dialect is `stage-studio` **and** the route
surface is studio (manager / quiz authoring). Every other combination is dark.
Players never choose a dialect. `useSurface` owns the DOM write.

## Role table

Semantic roles travel as accent / border / tint. Do not mix values across rows.

| role       | meaning                               | dark accent / border / tint                     | light accent / border / tint      |
| ---------- | ------------------------------------- | ----------------------------------------------- | --------------------------------- |
| `brand`    | Neorazz identity, primary host action | `#46d5c0` / `#2c7a52` / `rgba(70,213,192,.08)`  | `#0d9488` / `#99f6e4` / `#f0fdfa` |
| `success`  | correct, complete, healthy            | `#3ecf8e` / `#2c7a52` / `rgba(62,207,142,.12)`  | `#15803d` / `#86efac` / `#f0fdf4` |
| `danger`   | incorrect, destructive, failed        | `#f5604d` / `#6e2a22` / `rgba(245,96,77,.10)`   | `#b91c1c` / `#fca5a5` / `#fef2f2` |
| `info`     | server authority, codes               | `#5b9dff` / `#2f5fb0` / `rgba(91,157,255,.12)`  | `#2563eb` / `#93c5fd` / `#eff6ff` |
| `warning`  | time pressure, caution                | `#f08a3c` / `#b5641f` / `rgba(240,138,60,.06)`  | `#c2410c` / `#fdba74` / `#fff7ed` |
| `sequence` | ordered steps, streaks                | `#b58af5` / `#4a3a6e` / `rgba(181,138,245,.06)` | `#7c3aed` / `#ddd6fe` / `#faf5ff` |

### Neutral roles

| role                | dark                                                     | light     |
| ------------------- | -------------------------------------------------------- | --------- |
| `canvas`            | `#0a0e16`                                                | `#ffffff` |
| `surface`           | `#111827`                                                | `#ffffff` |
| `panel`             | `#0c1322`                                                | `#f8fafc` |
| `border`            | `#1f2942`                                                | `#e2e8f0` |
| `text-primary`      | `#f4f8fc`                                                | `#0f172a` |
| `text-body`         | `#e7edf5`                                                | `#334155` |
| `text-muted`        | `#9aa6bd`                                                | `#334155` |
| `text-faint`        | `#8995ad`                                                | `#475569` |
| `on-accent`         | `#06100e`                                                | `#ffffff` |
| `on-answer`         | `#06100e`                                                | `#06100e` |
| `dot`               | `#29354d`                                                | `#cbd5e1` |
| `overlay` / `scrim` | overlay `rgba(6,9,15,.72)`; photo scrim is a radial wash | same      |

## Answer identity

An answer is a **letter block**: a solid square of its accent, the letter in
`on-answer` (near black, at least 7.9:1 on every accent). Beside it sit the
words in `text-primary` on **dark glass** (`glass`, `#101623`), a solid surface.
Identity is the block and nothing else, so no tint or hairline carries it: a
lit room lifts black to grey and would wash either one away. `AnswerTile` is the
only component that draws it, reading the accent from one `--c` property.

| answer | accent    | note                                 |
| ------ | --------- | ------------------------------------ |
| A      | `#ffb020` | amber                                |
| B      | `#4aaeff` | blue                                 |
| C      | `#ff82b9` | pink. Never green: green means right |
| D      | `#d7dce6` | ice                                  |

Green and red mean only right and wrong, and urgency is orange (`warning`).
Meaning roles must never identify answers, and answers never carry meaning,
though a verdict may layer on top (the success frame and check on a correct
tile). The accents are separated by at least 15 of colour difference under
deuteranopia, and their brightness differs by 1.8x at most, so no answer pulls
the eye.

`ANSWER_IDENTITY` / `ANSWER_BAR` / `ANSWER_INK` (`accent` + `border` + `tint` +
`ink` per answer) remain for the **studio** only: the quiz editor and result
modal, where a tinted tile on the light register is fine. The game never uses
them.

### Tile states

`data-state` on the tile drives everything:

- `locked`: shown, not yet answerable. The block is unlit (dark, low chroma) and
  the words stay at `text-primary`. Never blur or dim answer copy.
- `active`: answerable. The block is lit. Bright means go. A phone's tile gives
  press feedback on `:active`, before the server replies.
- `picked` / `faded`: this phone's own pick (white frame) and the others
  stepping back. Set on the tap itself; a pick is sent once.
- `result`: a vote count, no verdict yet. The share lands in the block and runs
  along a rail under the words, so nothing crosses the copy.
- `correct`: the success frame and glow plus a check badge. `wrong`: stepped
  back to 55%.

A tile is a real `button` only where somebody can tap it (a phone with answers
open). On the projector and in results it is a plain panel, so it takes no
hover or focus ring it has no use for.

### Answer reveal

The shared answer grid reserves every 2–4 answer slot from its first paint.
After a one-second pause, slots reveal in A–D order with a two-second opacity
fade each. Each fade starts three seconds after the previous one, leaving a
one-second beat after a fade completes.
`@razzia/common/utils/answer-reveal` is the timing authority. The server owns
the answering unlock, so visibility never opens submission, the timer HUD, or
the answers music by itself. Revealed tiles are `locked` until the server opens
answering, then every block lights together as the timer begins. Reduced-motion
surfaces show every reserved slot immediately and snap between states while
still waiting for that same server unlock. Protocol (same-status payload,
`manager:unlockAnswers` vs `manager:abortQuiz`, reconnect restamp) is in
`docs/adr/0001-server-clocked-answer-reveal.md`.

### Answer grid

`ANSWER_GRID_TRACKS` + `answerSlotPlacement` lay out every A–D grid. On the
stage the grid runs four tracks and each tile spans two, so the odd last tile of
a three-answer question starts on track two and sits centred under the pair. On
a phone the tiles are one column, pinned under the prompt; a phone on its side
uses the stage's four tracks again (`short:`), so two rows leave the question
room. The editor breaks on its `@container` (`@xl`) because its tiles sit
between two side panels, and below a laptop's width (`lg`) the editor's three
panes stack (questions, the editor, its settings) and the page scrolls.

## Medals

`MEDAL` (gold / silver / bronze, `bg-medal-*` + `border-medal-*-border` +
`text-on-medal`) marks ranks 1–3 on the leaderboard badge and the podium, and
nothing else. They are physical metal colours, identical in both registers:
gold `#f5c542` / `#9a7412`, silver `#c7d0dc` / `#6b7688`, bronze `#d08a4c` /
`#7a4a22`, on-medal `#06100e`. Ranks 4+ use the neutral `border` / `surface` /
`text-muted` badge.

## Typography, motion, depth, radius

- Space Grotesk display/body; JetBrains Mono for badges, codes, numerals.
- **The stage.** The host's game page composes like a slide. `useSurface` sets
  `data-stage` on `<html>` for a landscape window 1024 px wide or more, and the
  root font size becomes `min(100vw / 120, 100vh / 67.5)`: exactly 16 px at
  1920x1080, 10.67 px at 1280x720. Every rem length scales with the frame, so
  the projector sees one composition at any size. Style it with the `stage:`
  variant, which applies only under `data-stage`. Do not use `xl:` / `2xl:` on
  a stage screen, because a viewport breakpoint would give 1280 and 1920
  different layouts. A narrow or portrait window, and every phone, fall back to
  the base (phone) styles.
- **Off the stage.** A page people play on (the join page, a player's game, a
  host page too narrow or upright for the stage) keeps the phone layout on any
  screen. `useSurface` sets `data-play` on `<html>` there, and the root font
  size grows a little with the screen (`clamp(16px, 6px + 1.6vmin, 20px)`: 16 px
  on any phone either way up, 18 to 19 px on an iPad or a laptop, 20 px at
  most), so a tablet or a laptop reads it from arm's length. The game keeps to
  one centred column (`max-w-xl`, 36 rem) instead of stretching across a wide
  screen, and the player's bar lines its name, Ask and points up with that
  column; a screen taller than the room left scrolls inside the column, never
  under the bar. A phone on its side (under 480 px tall and landscape, never the
  stage) takes `short:` styles: the sound button floats in its corner, the
  answers run two by two, and the big type and badges step down, so the
  question stays on screen above the answers.
- **Fingers get 44 px.** A control somebody taps is at least 44 px square: the
  game's own (sound, Ask, the Ask sheet's close, the inbox's buttons)
  everywhere, and the studio's small icon buttons, steppers and switches under
  `pointer-coarse:`, so a mouse keeps them compact. Where the drawn control stays
  small (a switch, the correct-answer mark), a `before:` inset carries the
  target.
- **Room-readable type.** Nothing the room has to read is under 2.6875 rem
  (43 px at 1080p, the smallest the back row can make out). Only labels
  (`text-xs`, the question label, HUD labels) may be smaller. Nothing important
  sits in the bottom 8% of the frame (heads in the front rows hide it), so the
  stage ends with a spacer of `max(5.4rem, 8vh)`: 5.4 rem is 8% of a 16:9
  frame, and a taller projector (4:3, 16:10) keeps its own bottom 8% clear
  too. The teacher's controls float over the top
  corners and take no layout room.
- **One type tier per question**, decided from its text alone
  (`utils/type-tier.ts`), so the prompt keeps its size from the question screen
  to the answers to the results and the shared-layout morph never reflows. The
  prompt is context lines (smaller, `text-body`) over the **ask**, the last
  line, which is the largest thing on screen. Answer copy steps 50 / 46 / 43 px
  by the longest answer. The tiers are an estimate; the Director's fit report
  measures the real layout of every real question and is the judge.
- **Phones keep the answers on screen.** The phone page is one screen tall
  (`h-dvh`): tiles are pinned under the prompt, which scrolls above them and
  rests on the real question at its end. The stage page instead grows, so a
  layout that does not fit shows as a page that scrolls and as a failure in the
  fit report.
- Dialogs and their overlays enter with `animate-rz-fade-in` (opacity only, so
  it composes with the centring translate). Toasts take the `surface` /
  `border` / `text-primary` roles in both registers.
- Screens fade in, they never cut: the lobby, the start, the round card, the
  leaderboard and the podium enter with `animate-rz-screen-in` (500 ms,
  linear, so no tenth of a second brightens the frame much). The question, the
  answers and the reveal need none: they morph in place.
- Calm motion: `--rz-dur-base: .5s`, `--rz-ease-calm: cubic-bezier(.16,1,.3,1)`.
  Respect `prefers-reduced-motion`.
- The question intro renders only the localized `Question #N` label. Fade it in
  over 500 ms, keep the intro beat at one second total, then reuse the
  `game-question-number` layout identity to translate it above the question
  while the question text/media fade in. Keep that label above the
  question through answers and manager responses; do not duplicate progress in
  the top bar. The shared card fills the `max-w-7xl` game column. It always
  mounts every sentence so later lines are reserved in place: one measured
  lift to that finished center, then 500 ms linear fades. Earlier sentences
  stay and do not move. The server still waits 950 ms after a one-sentence
  entrance, or `500 + max(400, chars * 80)` after each earlier sentence of a
  longer prompt (last line is only the 500 ms fade), before the
  reading bar and prompt cooldown. Reduced motion skips the lift, shows every
  sentence immediately, and still waits for that same room clock. A reconnect
  with elapsed prompt time sits at the final position and does not replay the
  lift.
- The live `SHOW_QUESTION` → `SELECT_ANSWER` boundary reuses the
  `game-question` Motion layout identity. Keep identical width and padding in
  both states and translate it into its answer-screen position over 950 ms with
  the calm easing; size-changing layout animation can reflow the title before
  Motion applies its transform. Do not add a competing `anim-show` entrance.
  Reduced motion sets the layout transition duration to zero.
- Question text and media float directly on the atmosphere. The shared layout
  wrapper must not add a panel background, border, or rounded container.
- Manager results are the answer tiles themselves, with each share in its block
  and on its rail, in the same place the grid sits while answering. The row
  between the prompt and the grid is the clock while answering and the headline
  in results, the same height in both so the screen changes in place.
- Depth: accent `shadow-bloom-*` only. New radius: `rounded-rz-sm/md/lg/xl`.

## Atmosphere / scrim

`<Atmosphere recipe="photo">` is the light behind the show, made in code: a deep
navy gradient (`rz-backdrop`), one glow per **mood** (`rz-mood-*`) that
crossfades as the game moves, and, in the full show only, beams (`rz-beam`) at
the opening and the finale and a moment's own light (below). There are no
embers: nothing drifts behind the answers while the room reads (task 0012). There is
**no photo by default**, so a phone downloads nothing for it. A teacher's
uploaded background sits above the gradient and under the glow (the image is
positioned, because an unpositioned one paints under the layer behind it and an
upload would never show); its `--rz-scrim` wash for bright photos and
`--rz-dark-photo-lift` for dark ones are unchanged. The light register (the
studio) stays a plain canvas.

Moods follow the game's status (`stores/mood.ts`): `teal` for the lobby and the
title, `cool` while playing, `gold` for the finale. A screen may hold another
with `useMoodOverride`: the room runs `warm` for the last five seconds of
answering. Photo atmosphere placement defaults to `viewport` (`fixed`) for live
game screens; use `placement="container"` (`absolute`) only inside a
positioned, overflow-clipped preview. `<Atmosphere recipe="ambient">` is the
no-photo auth/config recipe.

## Light, not paint

Big moments go brighter, but by the show's own light, never by painting the
frame (task 0015 replaced task 0008's full-frame floods, which made a dark room
19 to 43 times brighter in a tenth of a second). A screen asks for light with
`stores/stage-light.ts`, and `Atmosphere` draws it behind everything, so it
stays behind the copy and over a deck's slide:

- **Floor light** (`useFloorLight`): a glow in the moment's colour rising from
  the bottom of the frame, as a poll's room does (`rz-floor`, 900 ms).
- **Flares** (`useFlares`): a pool of light behind what the moment is about, and
  rings of the same light leaving it (`rz-flare`, `rz-flare-ring`, round ones
  for a word or a block).
- **Beam focus** (`useBeamFocus`): the beams turn in over the centre, slowly,
  and back the same way.
- **Words** (`StageMoment`, `rz-moment`): a moment's word or name lands like a
  poll's names (rises 2.75 rem and sharpens in), holds, and leaves upward, in
  brand, warning or gold with a glow. A block that keeps its own colours lands
  with `rz-land`.

Nothing fills or covers the frame: no `FrameHit`, no `data-hit`. The budget,
measured frame by frame (`razzia-workflow` task 0015, `record_moments.py`):
the frame's mean luminance never rises by more than 0.03 in any 0.1 s, under 5%
of the screen brightens by 0.25 or more in any 0.1 s, and a moment's peak is at
most 0.03 above where the screen settles. A poll's arrivals measure 0.013, 2.3%
and 0.006. A solid colour that has to appear (a podium block) fades in on its
own linear clock, never on a spring.

## The line, the clock and the count

- **The line** (`ChargeLine`) is one bar of light between the question and the
  answers. It grows dim from the centre across the prompt's cooldown and the
  answer reveal, so it is whole exactly when answering opens; it then goes
  bright and burns in from both ends toward the clock for the length of the
  window, turning hot for the last five seconds. On the stage it runs along the
  bottom of the clock row; on a phone it crosses the top of the screen. It is
  plain CSS over the server's stamps (`charge-line.ts`), so it needs no timer
  and a screen that mounts late (or after a reconnect) starts partway along.
- **The clock** counts to the answers opening ("Opens in 7"), then the time
  left. In the last five seconds the digit swells, heats to `warning` and pulses
  on every tick, and the room runs warm. **The count** is how many are in.
  Each is one large number with one small label.
- **The heartbeat** (task 0012, concept 5, calm): while answering is open in
  Calm the projector plays the poll's `beat` cue, 56 bpm at the unlock
  quickening to 120 by the end, and hands over to the last five seconds' ticks.
  Full has no heartbeat there: its answers groove keeps time, and a heartbeat on
  its own clock over the groove sounded like two tracks at once (CST-426 task
  0116, 2026-11-20). Each answer pings a step higher and the count flashes
  (`rz-hud-flash`, brand, from 1.2x). Nothing else moves: no room light and no
  rings while people are reading.
- The question screen holds the same bottom structure the answers screen has
  (the clock row, the room the tiles will fill, the bottom 8%), so the prompt
  never moves when the answers arrive.

## The reveal

The verdict is staged on one server-stamped clock (`result-reveal.ts`,
`docs/adr/0003-staged-result-reveal.md`), so the room and every phone land each
beat together. Its big moments are light, not paint (above), and nothing moves
or shakes over text.

| beat     | at     | the projector                                                                                                      | a phone                                                        |
| -------- | ------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| TIME     | 0 s    | "TIME" lands in warning where the clock was (or the poll's "Everyone's in", brand, with its check)                 | "Watch the big screen", still                                  |
| count    | 0.6 s  | rails grow from the letter blocks, smallest first; shares count up inside; TIME holds                              | holds                                                          |
| question | 2.25 s | everything but the most-picked answer dims over 0.6 s; a heartbeat. Ties stay lit                                  | holds                                                          |
| strike   | 3.0 s  | TIME rises away; the right answer lights where it is, three rings of green leave it, green light pools behind it   | the badge lands with one ring; its colour rises from the floor |
| settled  | 4.5 s  | the final grid, the green light still behind the right answer; the headline ("Only 3 of 18 got it. 8 fell for B.") | after 2 s: points, streak, rank                                |

The light always leaves the **right** tile, so the room reads whether it stayed
or jumped from what was lit during the question. A phone's colour is success
green, danger red, or grey for no answer; the phone itself stays dark. The last
five seconds' warm room holds through TIME and then eases back. Calm, Silent
and reduced motion keep the schedule and the words but drop the light, the
rings and the spotlight: the verdict happens on the tile. A client that arrives
after a beat (a reconnect, a woken phone, a lecture review) is settled: no
words, no light, no sound, no buzz.

## Phones

A phone's own game, in three screens beside the verdict (and the tap itself).

- **On the tap** (`Answers`): the tile you pressed is picked and the rest step
  back, and a "Locked in" pill appears between the clock and the count at once,
  before the server's own screen arrives.
- **Locked in** (`Wait`): the tile you picked, held, with "Locked in" over it
  and "N of M in" counting up as the room answers. Tapping it nudges it. Any
  other wait (the lobby, a lecture hold) is still: a "Connected" badge (or
  "Reconnecting…") and its line, and nothing spins. In the lobby it says
  "You're in, Ada", "Waiting for the host", that what comes next shows up on
  its own, and how many are here.
- **The verdict** (`Result`): "Watch the big screen" while the room builds up
  to it, then the badge lands on the strike (see the reveal).
- **Standing** (`Standing`, `SHOW_STANDING`): sent to every phone when the host
  shows the leaderboard, because `SHOW_LEADERBOARD` only reaches the host. Your
  place, ▲/▼ since the last question (nothing after the first one, whose
  "before" is only the join order), the leader and the players around you, and
  the gap to the next one up.
- **Ending** (`PlayerFinished`): a medal disc for ranks 1–3 with confetti that
  bursts and stops, a plain place for everyone else, and points and place among
  all who played.
- **A poll** (`PlayerPollOverlay`): the question, its options and the hint
  under them are one group, centred when the screen has room and scrolled from
  its top when it has not.

## Poll arrivals

While a poll is open the host's screen shows each vote arrive, so the room
sees and hears itself filling in (task 0011 chose this pairing from ten
prototypes).

- **The spotlight** (`ArrivalSpotlight`). The newest voter's name lands large
  (5 rem) in the room left under the options, behind a brand check whose ring
  spreads once, and slides up out of the way for the next. Earlier names run
  along a trail beneath (2.6875 rem, `text-muted`, masked at both ends). A name
  holds 700 ms, or 280 ms with another waiting; three or more waiting fold into
  one name and "+N", their names going straight onto the trail. When the vote
  count reaches the connected count it says "Everyone's in" in brand, and
  nothing more: no flood, no burst. An anonymous live poll's arrivals carry no
  name (its counts move with them), so they show as "New vote" and leave no
  trail; a named live poll's carry names, and its phones say the room may see
  their pick. The
  region is measured by height: a poll that fills the frame drops the trail,
  then the name.
- **The count.** Each arrival flashes "n votes" (brand, scaling down from 1.35)
  and sends a ring of brand light out from it, behind the text and the option
  tiles.
- **The heartbeat.** The room's light (`Atmosphere`'s `lift`) rises from the
  bottom of the frame with the share that has voted, and breathes on every
  beat. The beat starts with the first vote at 52 bpm and quickens to 122 as
  the room fills, and stops when everyone is in or the poll closes.
- **Sound.** Each name rings a `vote` cue (two plucks a fifth apart, a step up
  the pentatonic for each share of the room, so the last vote is the top), and
  each beat a `beat` cue (a soft lub-dub). While a poll covers the stage the
  quiz's own scenes and cues hold (`pollStage`); the poll's cues still play.
- **Calm, Silent, reduced motion.** The names, the trail and the light stay;
  the rings, the breath, the count flash and the slide are dropped, and names
  swap with a fade. Calm plays the heartbeat at half strength; Silent plays
  nothing.

## Board and ceremony

- **Leaderboard**: a bar race. A bar's length is a score, as a share of the
  longest new bar. It holds the old standing 1.5 s, grows the bars and rolls the
  odometers until 3 s (`BOARD_REORDER_MS`, the score's own overtake beat), swaps
  the rows, marks who moved, and then says one thing (`boardCommentary`: new
  leader, biggest climber, someone into the top five, biggest gain, a close
  race, or who leads). It works for a room of one.
- **Podium**: third, second, a roll, then first, on the score's clock
  (`podiumTimes`, pulled earlier for each place nobody holds). Blocks are solid
  medal colours risen on springs; each fades in on its own 0.6 s linear clock so
  no medal colour pops in at full brightness. During the roll the beams turn in
  over first place and stay on the winner. First place: gold light rises from
  the floor and stays, two round rings of gold leave the gold block, the
  winner's name lands in gold between the title and the podium for 2.6 s
  (`WINNER_MOMENT_MS`) and rises away, and confetti bursts and stops. Calm and
  Silent keep the sequence and the name but not the light, the beams or the
  confetti.

## First impressions

- **Lobby** (`Room`): the join address without its scheme, the PIN on split-flap
  cards that flip in left to right, a QR, and a seat for every player that flips
  solid as the name arrives. Names shrink in four steps as the room fills (to 12,
  30, 47 and then up to sixty players); up to sixty seats are drawn (empty ones
  dashed) and the rest are counted as "+N more". The steps are set by what fits
  the frame, measured at 1920×1080 where the frame is 67.5 rem tall and the bottom
  5.4 rem stays clear: the last row ends by 60.4 rem at 47 players, and sixty in
  the compact tier end by 55 rem. The Director's "Room · 30 players" and "Room ·
  60 players" show the two fullest cases; measure a change to a step there, and
  count the empty seats that fill the last row (the 48th player used to add a row
  that pushed the header to the top edge). Kicking still goes through a
  confirmation.
- **Start**: the title with a pass of light, then one lamp per second of the
  countdown; a lamp lights over 0.35 s. **GO** belongs to the first round card
  (`useLaunchStore`), because the lamps end exactly as it replaces them; a card
  nobody counted down to has no GO. GO lands in brand with one round ring and
  the floor light, holds 0.9 s, and rises away as the card comes up under it.
- **Round card** (`Prepared`): "Question 4 of 6" and "Final question" on the
  last (also on the question and answer screens, so the label never changes under
  the morph), the big number, and one pip per question; a deck of more than twelve
  draws a progress bar.
- **Join**: the PIN cell and the name field take focus on arrival, and a wrong
  PIN or a refused name shakes the field. The wordmark is seven split-flap
  cards in front of one brand ring, the same svg on both registers.

## The score

Sound is one adaptive WebAudio score (`features/game/audio/`), not per-screen
`useSound` calls. Screens ask for a scene (`score.start(...)`) or a cue
(`score.cue(...)`); they never touch a context. Scenes are stamped from the
server's clock, so the room's music and every phone's chord land together, and a
screen that arrives late finds its beats in the past and plays nothing. A
reviewed question is called with `silent: true` and cannot cut the live game's
bed. The score rises a semitone each round (capped at five) and the final
question adds a layer. The `classic` pack plays through the same calls via a
legacy adapter, loaded when it is about to play and unloaded after.
`show` is the default pack; it is a setting, so an old game keeps its own.
Volume, mute and the deck's suppression still go through Howler's master gain.

A question with its own audio or video keeps the answers bed out from under it,
as the answers loop always did.

## Rehearsal

The quiz editor's **Rehearse** button saves what is on screen (unsaved edits
included) to the browser's `localStorage` and opens `/rehearse` in a named tab.
That page plays the draft through the real screens (`FrameStage`, the same
composition the Director uses) in an iframe at the projector's true size, or a
phone's, scaled to fit: the question, the answers, the count with the room
right or wrong, and on the phone the locked-in screen and the three verdicts.
Arrow keys step screens and questions, `R` plays a screen again, `P` swaps
projector and phone; Show intensity applies. It needs no login and no game, it
warns about a question the projector may not hold (`question-fit`), and a second
Rehearse refreshes the open tab in place. Empty parts show a stand-in rather
than an empty tile. The shared builders (`features/rehearse/screens.ts`) take a
question, not a quiz id, which is what keeps the Director's real quiz text out
of the production bundle.

## Show intensity

A per-game setting in the Visuals tab, snapshotted at game creation like the
sound theme. **Full** is everything. **Calm** keeps the picture and the words
and drops a moment's light (floor light, flares and rings), the spotlight,
the beams and the confetti (the verdict happens on the tile); its music is 12 dB
lower with no groove while answering (the answering heartbeat keeps time
instead), and every heartbeat plays at half strength. **Silent** is
Calm with no audio. A device set to reduced motion gets Calm's visuals, and
also drops the count animation; audio does not follow it. Read it with
`useShowIntensity` / `useCalmVisuals`.

## Banned patterns

- Dialect-specific values or raw hex in `className`.
- `bg-white` / `bg-gray-*` / `text-gray-*` where a role exists.
- Neutral `shadow-*` / `drop-shadow*`.
- New bounce or overshoot easing.
- Encoding meaning with `answer-*`, or identity with semantic accents.
- Local background stacks outside `<Atmosphere>`.
- User-visible literal copy instead of an i18n key.

## Recorded deviations

1. Unknown persisted dialect falls back via `.catch(DEFAULT_DIALECT)` without discarding password/background.
2. The celebration is staged, not looped: the podium's roll, the winner's gold light and name, and a confetti burst that stops, and the same for a phone's top three. Confetti colours are read from the answer, brand and gold tokens instead of the library's rainbow.
3. Quizzes never persist dialect or sound theme — only `GameVisualsConfig` may.
4. Room QR modules stay black-on-white for scanner reliability.
