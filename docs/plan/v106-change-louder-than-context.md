# V106 — The change louder than its context

[Index](../PLAN.md) · [Journal](../journal/v106-change-louder-than-context.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v106-change-louder-than-context`
in its own workspace; written by the graph usability spike (`spike/graph-usability`). Not started.

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
