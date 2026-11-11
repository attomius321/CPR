# Journal: V106 — The change louder than its context

[Index](../JOURNAL.md) · [Plan](../plan/v106-change-louder-than-context.md)

## V106 spike — context louder than the change (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

At zoom 1, a summary card's count is 14 px bold; a changed symbol's name is 12 px. A median merge
draws 0.72 unchanged symbols per changed one, and 24 summary cards
([shot](../../spikes/graph-usability/shots/p11-context-louder-than-change-dark.png)).

## V106 — the change louder than its context (2026-11-11, branch `feature/v106-change-louder-than-context`)

A summary card's text is now no larger or bolder than a changed symbol's name. Its count is drawn
as an unchanged symbol's name: 12 px, weight 500, muted. The line under it is 12 px too, and its
"show" keeps the text's ink. The two lines are centred in the card, and a shown summary steps back
to 0.9 opacity. Decision 981.

**Learned**:
- **The count was 15 px, not the spike's 14.** The summary card sets no size of its own, so it
  took the page's body size, 15 px since V87. The graph re-declares its 14/13/12 scale on
  `.react-flow` (decision 438), but a size only applies where a rule names it.
- **The plan's change alone would not meet its Done when.** The line under the count was 13 px,
  larger than a changed name. It takes the caption's 12 px too.
- **Smaller text leaves the card bottom-heavy.** At 12 px the two lines fill 39 of the layout's
  58 px: left at the top, 7 px from the card's top and 12 px from its bottom. Centred, they sit
  9.6 px from each edge. It costs nothing: the card's height and width are the layout's.
- **Muted text under an opacity falls below 4.5:1.** A shown summary was at 0.8 opacity. With the
  count in `--muted`, that put it at 4.08:1 in light. `tokens.test.ts` checks tokens, not
  opacities, so the numbers were worked out by hand: 0.9 gives 5.13:1, and 5.36:1 in Hive's light.
- **Shots of one build differ run to run** by 71 to 121 px on the map, all edge pixels. The map's
  shots before and after differ by less (49 and 80): the map is unchanged.

**Verification**: tests first. `e2e/context.spec.ts` (a generated graph: a summary card, two
unchanged users and a package's export beside two changed symbols) reads every text of the
context's cards in both themes. On `main`'s build it failed: the count at 15 px and weight 600,
the line under it at 13 px. It passes now, and so does `large-graph.spec.ts`, the other spec that
draws a summary.
The small fix (`3f45ca4..0c87309`), its graph served by `main`'s and this branch's viewer, at
2560 × 1440, 1x, both themes: at the first fit, at zoom 1 on the first finding and with a summary
shown. Every text in its 38 context cards (10 summaries, 22 unchanged symbols, 6 package
exports) is now at most 12 px and weight 500. Its 19 changed names are 12 px and weight 600.
Shots: `docs/images/v106-change-louder-than-context/`. `pnpm check`: 3,509 unit tests, with
`tokens.test.ts` in both themes. `pnpm build`. `pnpm test:e2e`: the viewer's 459 and the nexus's
32, none failed or flaky. `measure.mjs`, `main`'s build and this one alternated, 8 rounds on
Bitwarden 737ee3f (Angular plugin): first paint median 321 ms on `main` and 323 ms here; select
103 ms, mark 33–34 ms and pan 63 fps on both. The small fix: first paint 188 and 192 ms. The 17 ms
the first 3 rounds showed was their order: run first, this build was the faster.

Not verified: the app's window (Electron); every shot is headless Chromium. Settings' Compact and
Large text sizes were not shot: the graph keeps its own sizes at every text size (decision 438).
