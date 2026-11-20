# 0009. Embedding is a supported integration

Date: 2026-11-19  
Status: Accepted. Amends the deck bridge in `0002` (allowed parents, the message tag, where the deck's side lives).

## Context

The deck bridge (`0002`, `0005`, `0006`, `0007`) was built for one instructor's lecture decks. Underneath it is general: any page can frame `/manager?embed=deck` and drive a lecture room with `postMessage`. But someone who cloned the repository could not use it:

- The only site allowed to drive the host page, besides localhost, was that course's site, written into the code (`embed.ts`). Any other site meant editing the source.
- Commands had to carry `source: "cst426-deck"`, the course's own tag.
- The deck's side of the contract, the code that frames the page and speaks the protocol, lived only in the course repository. The ADRs pointed to it there.
- There was no guide: the protocol was spread across four ADRs and `protocol.ts`.

The maintainer asked (2026-11-19) for embedding to be supported for other teachers and their tools, documented so that a person or a coding agent with only this repository can integrate it, and not special-cased for his slides.

## Decision

- **Each host lists the sites that may drive it.** `NEORAZZ_EMBED_ORIGINS` is a comma-separated list of exact origins. No site is built in; pages on `localhost` and `127.0.0.1` stay allowed, as before. The list is read when the host starts, not when it is built: `docker/entrypoint.sh` writes it into `/runtime-config.js`, which `index.html` loads before the app, and the dev and preview servers serve the same file from the same variable. The entrypoint keeps only the characters an origin uses, and the page drops any entry that is not an exact `http` or `https` origin, so a bad value cannot inject script or widen the list.
- **A neutral tag.** Commands carry `source: "neorazz-embed"`. `"cst426-deck"` is still read, so existing decks keep working. Messages back keep `source: "razzia-bridge"`, like the other identifiers `0008` kept.
- **A client in the product.** `packages/web/public/neorazz-embed.js` is a plain script with no dependencies that every host serves at `/neorazz-embed.js`, so a page that loads it from its host always speaks that host's protocol. It frames the page, says `hello` until it is answered, holds early commands, sends kept settings again after a reload, reads only its own frame's messages, and makes every command a method of the same name. It does not wrap answers in promises: answers carry no request id, so pages wait for the state they expect (`when`).
- **One guide, kept honest by a test.** `docs/embedding.md` is the public contract: a quick start, the client, a slide-deck recipe, and reference tables for commands, messages, state, error codes and features. `embedding-docs.test.ts` fails when a table and the code disagree. `examples/embed/` is a page that runs against any host.
- **Protocol version 1 is unchanged.** No command or state field changed meaning. `needsLogin`, an error code that was declared but never sent, is gone from the type; a login shows as `pending: "login"`.

## Alternatives considered

- **A build-time setting (a Vite variable).** Rejected: a Docker or hosted deploy would have to rebuild to change a list, and a prebuilt image could not be configured.
- **Allow every site by default.** Rejected: a page that drives the host page could start questions and polls in a room it does not own the moment a presenter logs in inside its frame. The list costs one line of configuration.
- **Request ids on commands, so the client could return a promise per command.** Deferred: every answer path in `use-deck-bridge.ts` (held, queued, reattaching) would need to carry it. Waiting for the state works today.
- **Publish the client to npm.** Deferred: serving it from the host keeps the client and the protocol in step without a release process.

## Consequences

- A host whose decks were on the one site that used to be built in must now list that site in `NEORAZZ_EMBED_ORIGINS`, or those decks stop driving it after its next deploy.
- Hosts built before this change read only `cst426-deck`, so a copy of the new client does not work with them. The client a host serves always does.
- A change to the bridge's protocol now also changes `docs/embedding.md` and `neorazz-embed.js` (see `AGENTS.md`).
