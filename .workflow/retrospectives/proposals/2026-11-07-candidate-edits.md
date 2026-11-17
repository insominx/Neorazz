# Candidate edits from the 2026-11-07 retrospective

Nothing here has been applied. Each entry is a complete candidate memory file for the project memory directory (`C:\Users\Michael G\.claude\projects\C--Projects-class-Razzia\memory\`), plus its index line for `MEMORY.md`.

---

## P1: running and probing Razzia locally

- Evidence: E02, E03, E12 (see `razzia-workflow/retrospectives/daily/2026-11-07.md`)
- Quick score: 7 of 9
- Type: memory, project
- Context impact: about 15 lines, loaded each session
- Rollback or review condition: delete if `pnpm` is put on PATH; re-check the commands after any change to the dev scripts

Candidate file `razzia-local-run.md`:

```markdown
---
name: razzia-local-run
description: How to start, log in to and probe Razzia on this Windows machine (pnpm is not on PATH)
metadata:
  type: reference
---

- `pnpm` is on neither Git Bash nor PowerShell PATH. Start the web app with `packages/web/node_modules/.bin/vite.cmd` (port 3000) and the socket server with `packages/socket/node_modules/.bin/tsx.cmd watch src/index.ts` (port 3001), run from each package folder in PowerShell. `npx pnpm@11 ...` also works. Per-package gates: `node_modules/.bin/vitest.cmd run`, `tsc.cmd --noEmit` (web uses `tsc.cmd -b --noEmit`), `prettier.cmd --check .`; root `node_modules/.bin/oxlint.cmd`.
- The manager password lives in gitignored `config/game.json` (`{"managerPassword": "..."}`) and is `razzia` locally. The server refuses the literal default `PASSWORD` by design (`errors:manager.passwordNotConfigured`).
- The socket path is `/ws`, and the handshake needs `auth.clientId` as a UUID-like id, or the server answers `unauthorized`. A one-off probe with a wrong password is a safe way to read the server's config state.
- Stopping a process tree: use `taskkill //PID <pid> //T //F` from Git Bash; PowerShell's `taskkill /PID` was mis-parsed once.
- Do not stop the user's running dev servers without asking; an edit under `packages/socket` restarts the socket server on its own.

**Why:** about a dozen tool calls went to finding these out on 2026-11-07.
**How to apply:** use these directly instead of rediscovering; verify the file paths still exist first.
```

Index line for `MEMORY.md`:

```markdown
- [Razzia local run](razzia-local-run.md) — start, log in to and probe the app; pnpm is not on PATH
```

---

## P2: the classroom constraint

- Evidence: E10, E11
- Quick score: 8 of 9
- Type: memory, project
- Context impact: about 8 lines, loaded each session
- Rollback or review condition: revisit if the app is used outside one shared-network room, or after the client address is available from the proxy

Candidate file `razzia-classroom-constraint.md`:

```markdown
---
name: razzia-classroom-constraint
description: Razzia is used live with the teacher and all students on one network address; no protection may be able to lock the teacher or the class out
metadata:
  type: project
---

Razzia runs in a live classroom: the teacher and every student connect from the same physical room, so they share one network address, and behind the Docker nginx proxy every visitor shows up as 127.0.0.1.

- Never key an availability-affecting protection (lockout, rate limit, ban) on the address alone.
- The teacher (host login) must never be lockable out by anyone else. Known hosts are exempt from the address tier.
- A student's typos may lock out only that student.

**Why:** the first hardening pass (2026-11-07) shipped an address-keyed brute-force lockout; the user corrected it twice: "this needs to work when all students are physically located in the same classroom", then "a teacher lockout sounds bad. these are the kind of things I want to avoid".
**How to apply:** state this constraint in any prompt for hardening, auth or rate-limit work, and check every new limiter against "60 students and a teacher behind one address". See [[razzia-local-run]] for how to probe the live server.
```

Index line for `MEMORY.md`:

```markdown
- [Razzia classroom constraint](razzia-classroom-constraint.md) — one shared address; never lock out the teacher or the class
```

---

## Not proposed (report-only)

- P3 (scratch location and untracked-files check in the workflow prompt), P4 (per-finding accounting), P5 (rule to re-run gates after fan-out): below the promotion threshold on one incident each. They are listed in the daily report with their scores.
