# V106 — The change louder than its context

[Index](../PLAN.md) · [Journal](../journal/v106-change-louder-than-context.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v106-change-louder-than-context`
(the workspace's, from `main` at f790c0c); planned by the graph usability spike
(`spike/graph-usability`).

**Kind** feature (milestone) · **Branch** `feature/v106-change-louder-than-context` · **Size** S ·
**Depends on** none · **Rank** 8 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**: on the canvas, the changed symbols are the strongest text, and the context is
quieter. A summary card ("92 uses … show") draws its count as an unchanged symbol's name is drawn:
12 px, regular weight, muted ink. Changed symbols' names keep weight 600 and full ink.

**Where to look**:
- `packages/viewer/src/graph/SummaryNode.css:21` (`.summary-count`, weight 600 at the node's
  14 px).
- `src/graph/SymbolNode.css:152–166` (names: changed 600 at full ink; unchanged 500, muted).
- `src/ui/base.css:526` (`.react-flow`'s own scale); `test/tokens.test.ts` (contrast, sizes).
- The `symbiote-style` skill: the weights, the ink tokens, the traps of a restyle.

**Out of scope**: what is drawn (context on or off, summaries' limit); the map's blocks.

**Done when**:
- At zoom 1, no context text is larger or bolder than a changed symbol's name (measured in the
  page on the small fix: computed size and weight).
- `tokens.test.ts` passes in both themes.
- Before and after shots of the small fix at zoom 1, both themes.

## Problem (the spike's G11)

At zoom 1, a summary's count ("92 uses", "13 users") is 14 px bold, the loudest text on the canvas.
A changed symbol's name is 12 px
([shot](../../spikes/graph-usability/shots/p11-context-louder-than-change-dark.png)). Context is
drawn by default: on the last 26 merges, a median graph draws 0.72 unchanged symbols per changed
one, and 24 summary cards. The eye goes first to what did not change.

**Goal**: at any zoom where text is drawn, the change reads before its context.

## Design

- `.summary-count` takes the unchanged name's look: `--size-caption`, weight 500, `--muted`. The
  "show" link keeps its colour, so the card stays clickable at a glance.
- The summary card's dashed edge stays, as the mark of a group.
- No size of a changed symbol changes (the layout estimates widths from them, decision 438).

## Verification

1. e2e or a page measure: computed font size and weight of `.summary-count` against a changed
   `.symbol-name` on the small fix's fixture.
2. `pnpm check` (`tokens.test.ts`: contrast and sizes, both themes).
3. Shots before and after, both themes, as the `symbiote-style` skill asks.

**Risks**

| Risk | Mitigation |
|---|---|
| A quiet summary is missed | Its dashed edge and "show" stay; its count stays readable at 12 px |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 981 | A summary card's count | **Drawn as an unchanged symbol's name (caption size, weight 500, muted); changed names stay the strongest text on the canvas** | At zoom 1 the summaries' 14 px bold counts outweighed the change's 12 px names |

## As built

Built as planned, decision 981, with three changes the page asked for (below). Tests first:
`e2e/context.spec.ts` draws a generated graph with a summary card, two unchanged users and a
package's export beside two changed symbols. It reads every text of the context's cards in both
themes. On `main`'s build it failed for the right reason: the count was 15 px at weight 600, and
the line under it was 13 px. It passes now.

- **"Context" is the cards of what the change did not touch**: summary cards, unchanged symbols,
  a package's exports and dynamic calls. File and frame names label the layout's boxes. They are
  not context, and they are unchanged.
- **The count was 15 px, not 14.** The summary card sets no size of its own: it inherits the
  page's 15 px body (V87), not the graph's 14. It now takes the graph's `--size-caption` (12 px),
  weight 500 and `--muted`, as an unchanged name does. Its font stays the text's: a count is words,
  not code. It no longer follows Settings' text size (16 px at Large), as no other text on the
  graph does.
- **The line under the count, too.** "in 21 files or packages … show" was `--size-small`, 13 px,
  larger than a changed name. The Done when needs it at the caption's 12 px. "show" keeps the
  text's ink, at weight 400.
- **The two lines are centred.** At 12 px they no longer fill the layout's 58 px. Left at the
  top, they would sit 7 px from the card's top and 12 px from its bottom (`main`: 7 and 6). The
  card is now a column with its lines centred, 9.6 px from each edge (measured in the page).
- **A shown summary steps back to 0.9 opacity, not 0.8.** At 0.8 the muted count fell to 4.08:1 on
  its file box in light (4.23:1 in Hive's light), under the 4.5:1 for text. At 0.9 it is 5.13:1
  (5.36:1). On `main` the line under it already sat at 4.08:1 when shown.
- **Nothing moves.** A summary's width is the layout's (`SUMMARY_WIDTH`, 190 px; 250 across
  projects), not estimated from its text, and no changed symbol's size changed (decision 438).
  No token changed, so `tokens.test.ts` is unchanged and passes.

## Results

The small fix as the spike opened it, `fix/e2e-flakes` (`3f45ca4..0c87309`, 18 files, 19 changed
symbols): its graph made by this branch's CLI, served by `main`'s and this branch's viewer
(`?graph=`), 2560 × 1440, 1x. The first finding is picked and the canvas zoomed to 1 at it.

| Text at zoom 1 | `main` | V106 |
|---|---|---|
| A summary's count ("53 uses") | 15 px, 600, `--text` | 12 px, 500, `--muted` |
| The line under it ("in 21 files or packages …") | 13 px, 400, `--muted` | 12 px, 400, `--muted` |
| Its "show" | 13 px, 400, `--text` | 12 px, 400, `--text` |
| An unchanged symbol's name | 12 px, 500, `--muted` | the same |
| A changed symbol's name | 12 px, 600, `--text` | the same |

The first fit (zoom 0.53) draws 38 context cards beside the 19 changed symbols: 10 summaries,
22 unchanged symbols and 6 package exports. In every one, no text is now larger than 12 px or
bolder than 500, in both themes and with a summary shown.

The count's contrast on its file box (the canvas under 70 % of `--panel`):

| Theme | At rest | Shown, 0.8 (`main`'s) | Shown, 0.9 |
|---|---|---|---|
| Dark | 8.28 | 5.64 | 6.88 |
| Light | 6.53 | 4.08 | 5.13 |
| Hive dark | 7.88 | 5.38 | 6.55 |
| Hive light | 6.87 | 4.23 | 5.36 |

Nothing costs more. `measure.mjs` alternated `main`'s build and this one, 8 rounds on Bitwarden
737ee3f: first paint median 321 ms and 323 ms, select 103 ms, mark 33–34 ms and pan 63 fps on
both.

The map is unchanged: a summary is a block there, with its text hidden. Its shots differ from
`main`'s by 49 px (dark) and 80 px (light), all edge pixels. Two runs of `main`'s own build differ
by 71 and 121.

Shots at zoom 1, cropped at 1x: the pick
([before](../images/v106-change-louder-than-context/zoom1-before-dark.png),
[after](../images/v106-change-louder-than-context/zoom1-after-dark.png); light:
[before](../images/v106-change-louder-than-context/zoom1-before-light.png),
[after](../images/v106-change-louder-than-context/zoom1-after-light.png)), and a summary shown
beside its 13 users
([before](../images/v106-change-louder-than-context/shown-before-dark.png),
[after](../images/v106-change-louder-than-context/shown-after-dark.png); light:
[before](../images/v106-change-louder-than-context/shown-before-light.png),
[after](../images/v106-change-louder-than-context/shown-after-light.png)).
