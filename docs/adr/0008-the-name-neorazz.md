# 0008. The name Neorazz

Date: 2026-11-18  
Status: Accepted

## Context

This fork of [Ralex91/Razzia](https://github.com/Ralex91/Razzia) now has lecture rooms, a deck bridge, polls, a private question box and a staged show. The owner decided on 2026-11-16 that it deserves its own name and chose **Neorazz**. The logo came from five rounds of image concepts; the owner's picks were seven dark split-flap cards spelling the name in front of one teal ring, and for the icon a teal card with a navy N.

The word `razzia` is also an identifier in more than 450 files: the `@razzia/*` package scope, browser storage keys (`razzia_deck_games`, `razzia_embed`, `razzia_ask_draft`, `razzia:rehearsal`), the deck bridge's message source (`razzia-bridge`), and the `RAZZIA_ALLOWED_HOSTS` variable that the live hosts set.

## Decision

Rename what people see; keep the identifiers.

- **Renamed.** The page title, the wordmark and its alt text, the favicon, the footer link and version line, the README, the contributing guide, `STYLE.md`'s heading, the Compose service, and the GitHub repository (`insominx/Neorazz`).
- **Kept.** Every identifier listed above, the root package name, test fixture prefixes, and comments that name the original project. The folder a checkout lives in is the owner's choice.
- **The logo is outlined svg.** The letters are Space Grotesk at weight 700, converted to paths, so the file needs no font and draws the same in the app, on GitHub and as a favicon. The cards carry their own fill and edge, so one file serves the dark and light registers; it is an `<img>`, no longer a mask filled with the brand colour.
- **Credit stays.** The README says where the project came from, and `LICENSE` keeps Ralex's MIT notice.

## Alternatives considered

- **Rename every identifier.** Rejected for now: decks already taught post to `razzia-bridge` and check its features, saved games and drafts sit under the old storage keys, and the hosts' environment names the old variable. Each would need a migration with both names for a while, which buys nothing anyone sees.
- **Keep the raster concept art.** Rejected: generated images are not exact, and a mark must stay sharp from 16 px to a projector.

## Consequences

- Old links to `github.com/insominx/Razzia` redirect to the new name, and so do existing git remotes.
- Docker builds from the checkout: `compose.yml` no longer pulls `ralex91/razzia`, which is the original project and lacks everything above.
- A later identifier rename is a separate decision and must keep the old names working for decks and saved data.
