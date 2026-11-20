# Agent notes

The product is **Neorazz** (since 2026-11-18; GitHub `insominx/Neorazz`), a fork of Ralex91/Razzia. Only what people see was renamed: `@razzia/*`, storage keys, `razzia-bridge` and `RAZZIA_ALLOWED_HOSTS` keep the old word on purpose (`docs/adr/0008-the-name-neorazz.md`). Do not rename them without a migration.

## Embedding is a public contract

Other people's slide decks, class sites and web apps frame the host page and drive it. Treat that interface like an API.

- The guide for teachers and integrators is `docs/embedding.md`. The client every host serves is `packages/web/public/neorazz-embed.js`. The runnable example is `examples/embed/`. The decision is ADR 0009.
- The source of truth is `packages/web/src/features/deck/protocol.ts` (commands, messages, error codes, features), with the state in `plan.ts` and the behavior in `use-deck-bridge.ts`. Change the guide and the client in the same commit as the protocol: `embedding-docs.test.ts` fails when the guide's tables and the code disagree, and `src/test/neorazz-embed.test.ts` checks the client against the protocol.
- No deployment is special. A host lists the sites that may drive it in `NEORAZZ_EMBED_ORIGINS`; `docker/entrypoint.sh` writes them into `/runtime-config.js` when the container starts, and the dev server serves the same file. Never put a deployment's address in the product.
- Keep protocol version 1 compatible: add commands and fields, list new abilities in `FEATURES`, and keep reading the first decks' tag (`cst426-deck`).
- To try an integration: run `pnpm run dev`, serve `examples/embed/` with any static server, and open it with `?host=http://localhost:3000`.

## Task dossiers live in `razzia-workflow/tasks/`

Task dossiers (plans, deep dives, progress, evidence) go in **`razzia-workflow/tasks/<NNNN-slug>/`**, not in `.workflow/tasks/`.

- `razzia-workflow/` is the private repo `insominx/razzia-workflow`, cloned into the project root and ignored by this repo (`.gitignore`). Its tasks continue one sequence; let the tool below pick the next number.
- The g-skills `create-task-folder` tool defaults to `.workflow/tasks/`, where it restarts at `0001`. Point it at the right place:

  ```
  node <g-skills>/bin/create-task-folder.js <slug> --tasks-dir razzia-workflow/tasks --path
  ```

  The tool may also leave a generated `.workflow/distillations/README.md`; delete it. Distillations belong in `razzia-workflow/distillations/`.

- Leave `.workflow/` as it is. It holds only the tracked `README.md`, which both repos share.
- Commit and push dossier changes from inside `razzia-workflow/`, not from this repo.

## Workflow artifacts live in `razzia-workflow/`

Every artifact that is not product code or product docs goes in `razzia-workflow/`, never in this repo's tree: task dossiers in `tasks/`, distillations in `distillations/`, retrospectives in `retrospectives/` (`daily/`, `proposals/`). If a tool or skill defaults to a folder in this repo (for example `retrospectives/` at the root), point it at `razzia-workflow/` instead, and commit from inside `razzia-workflow/`.

## Source of truth

- Decisions: `docs/adr/`.
- Design language: `packages/web/STYLE.md`.
- Contribution rules: `.github/CONTRIBUTING.md`.
