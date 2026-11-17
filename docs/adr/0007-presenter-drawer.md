# 0007. The presenter's drawer: questions in the deck

Date: 2026-11-17  
Status: Accepted (the presenter, 2026-11-17)

## Context

`0006` kept every question's text off any projected page (A1): the deck showed a count, and the presenter read the questions on `/manager/questions`, on another device, after typing the password again. In use that was too much: he saw "Questions waiting: 1" and could not find the questions. He asked to read them where he is, from the deck, either on the same screen or on a second monitor, with nothing to remember and no second password.

He designed the deck's side in seven rounds of a look-and-feel lab (course repository, task 0153): a thin sliver on the slide's right edge that glows while questions wait, pulled out into a drawer with Questions, Join and Session tabs. Opening it is his own deliberate act.

## Decision

This amends `0006`'s A1 and its "The deck" bullet; everything else in `0006` (A2 to A6, the lane, the inbox) stands.

- **A1, amended.** An ask's text and any name may reach the deck page that manages the room, and only while that deck asks for them: the presenter has opened the drawer. Nothing else changes: no text in `manager:lectureState`, a status, a room broadcast or a phone event; the host page still gets the capped count; the inbox still refuses to draw inside a frame and still curtains.
- **The bridge** lists `presenterInbox` in `features` and takes four commands:
  - `inbox { open }`: while `true`, the frame watches the inbox lane with its own manager login (`asks:watch`) and posts `inbox { room }` with the room it is attached to, on every change, after every reconnect and when the room changes; `room` is `{ gameId, open, total, asks }`, the waiting (`new`) asks only, oldest first, at most 50, each `{ id, text, at, name? }`. Other rooms a watch brings in never leave the frame. `false` unwatches and posts `room: null`.
  - `markAsk { askId }` and `markAllAsks`: Got it (`asks:mark` to `seen`, `asks:markAll`) in that room's record.
  - `askOpen { open }`: Pause and Resume for this room only (`asks:setOpen`). Unlike `askBox`, nothing is held for the next room.
  Each of the last three is answered with a `result`.
- **Undo is the deck's.** Got it hides a question at once and is sent only after six seconds, or when the drawer closes, so an undo needs no server change.
- **Pop out** opens `/manager/questions` in a window of its own, from the presenter's click. `0006` rejected a link to the inbox from a projected page because the window lands on the projector; the presenter now chooses that, and moves the window where he wants it.

## Alternatives considered

- **The inbox page framed inside the drawer.** It would keep the text in Razzia's origin, but the drawer's height and look would depend on a page it cannot measure, and the inbox would have to give up its frame refusal.
- **Text in every status.** Rejected: statuses go out every second and to every deck, drawer open or not.
- **A one-time sign-in link for Pop out**, so the window needs no password. Wanted; not built in this change.

## Consequences

- A deck that opens its drawer on a mirrored projector shows the questions to the room. That is the presenter's choice each time; the drawer never opens on its own when a question arrives.
- An older deck never sends `inbox`, so it never gets text. A new deck on an older Razzia sees no `presenterInbox` and shows the count, with Pop out.
- The frame's socket becomes an inbox watcher while the drawer is open, and is dropped as one when it closes or disconnects.
