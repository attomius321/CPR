# Journal: V63 — Start a workspace drawn as the person's mockup

[Index](../JOURNAL.md) · [Plan](../plan/v63-start-page-mockup.md)

## V63 spike — the start page beside the mockup (2026-10-27, branch `feature/start-workspace-revamp`)

The start page on `main` (`3b7771c`) in Chromium, `serveWorkspaces` with the fake Claude Code, at
1641×959 (the mockup's size) and 1440×900, dark and light, from a spec outside the repository;
the mockup cropped and enlarged in the same browser to read its icons.

**Learned**:
- **The mockup is the page without the sidenav**: 1641 px wide, its cards 1,311 px (821 + 20 +
  470). In the app the main area is 1,377 px at that window, so the same cards fit with 32 px
  each side; at 1440×900 (1,176 px) they are 717 + 16 + 411.
- **Its run is seven cards, the old one eight rows**: drawn at the mockup's own spacing (40 px
  controls, 22 px padding) the run is ~920 px high, more than the 776 px a 1440×900 body has.
- **Some of its controls have nothing behind them in Symbiote**: the title's ✨ (no title is
  suggested), the goal's link and page icons; the person's answer was to leave them out. Its
  counter says 0/4000; Symbiote's limit is 20,000 characters for the whole brief.
- **`main` had moved** (V62, Settings) since the workspace was made, in files this work shares
  (`icons.tsx`, the accent's roles in `tokens.test.ts`): merged in first.

## V63 — Start a workspace as the person's mockup (2026-10-27, branch `feature/start-workspace-revamp`)

The head has the S, the title and the mockup's line, and Start workspace with its icon; the
brief is one card with the kinds as tabs with icons, a "?" by each field, the goal's tools
(preview, attach, the brief's length) and the advice; the run is seven cards with accent icons;
the mockup's arcs lie on the ground beside the cards. The stepper's words are capitalised wherever
it is. Decisions 451–457.

**Learned**:
- **The mockup's spacing does not fit 1440×900**: at its padding the run was 64 px taller than
  the body. Tighter cards (12 px padding, 28 px heads without a control) fit it with 5 px to
  spare; a model whose description shows (the fake's Opus 4.6) or a second line of Source's note
  scrolls it a little. The head stays, with Start workspace.
- **A translucent token stacks**: `--input-bg` is a 4 % white over the card, so the goal's tools
  painted with it over the field were a lighter band. They paint the composite (`--input-bg`
  over `--panel`).
- **A textarea in a plain `div` is inline**: the line's descent under it made the frame 4 px
  taller than the field, and the tools, placed from the frame's bottom, covered its bottom
  border — seen only in light, where the border is the one edge.
- **Rings placed from the page show through the cards' gaps**: at 1641 px the right ring ran
  behind the run, and the 8 px gaps between its cards showed short lines. Placed from the cards'
  edge, the mockup's way, they never pass behind a card.
- **The naming guard reads object keys**: `KIND_ICONS`'s `feature:` is an identifier with
  "feature" in it; it is the kind of work, added to the guard's list.
- **The tabs fit a phone without a smaller size**: with 8 px padding the five words and their
  "?" were 42 px too wide for 390 px. 14 px words fitted, but type is never shrunk to fit (the
  person's eyes): 6 px padding and no icons fit them at 15 px.

**Verification**: tests first, red for the right reasons (`start.spec.ts`: the mark, the counter,
Branch name and Start workspace not found; `effort.test.ts`: "xhigh"), then green. `pnpm check`
1,882 of 1,882; `pnpm build`; `pnpm test:e2e` 295 of 296 — the one, `scout.spec.ts`'s New
conversation, read the fake agent's call log mid-write ("Unterminated string in JSON") and
passed 11 of 11 on its own. Measured at six sizes (the plan's results); letter-spacing 0 on the
page's 261 elements; screenshots dark and light of every state.

Not verified: the desktop app's window (its 38 px title bar is over the page, so at 1440×900
the run would scroll a little); Firefox and Safari (`:has()`, `outline-offset` on a round box);
a real agent's start from the new page (nothing in the request changed; the fake's starts pass).
The README's `docs/images/start.png` still shows the page before V61: not retaken.
