# V107 — Back after following a link

[Index](../PLAN.md) · [Journal](../journal/v107-back-in-the-panel.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v107-back-in-the-panel` in its own
workspace; written by the graph usability spike (`spike/graph-usability`). Not started.

**Kind** feature (milestone) · **Branch** `feature/v107-back-in-the-panel` · **Size** S ·
**Depends on** none · **Rank** 9 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**: the detail panel remembers the picks followed from it. A Back button in the
panel's head, and Alt+←, return to the previous pick. A pick from the sidebar (a finding, a row)
starts a new trail.

**Where to look**:
- `packages/viewer/src/diff/App.tsx` (`selected`, `setSelected`); `src/diff/DetailPanel.tsx` (its
  head, `onSelect` from the neighbour lists and a finding's related symbols).
- `src/diff/useDiffKeys.ts` (keys; Alt is ignored there today, `event.altKey` returns early).
- `src/ui/tip.ts` (`tip()`) for the button's tip, with its key.

**Out of scope**: the browser's history; Forward.

**Done when**: an e2e test picks a finding, follows a user from the panel, presses Back (button,
then Alt+←), and finds the finding's symbol picked again; a pick from the sidebar clears the
trail.

## Problem (the spike's G14)

A name in the panel's "Used by" or "Uses" picks that symbol, and nothing returns to the one before.
In 5 of 5 walks, getting back to the finding after following a user meant finding and picking it
again ([shot](../../spikes/graph-usability/shots/p13-no-way-back-dark.png)).

**Goal**: following a link costs one step there and one step back.

## Design

- A trail in `App.tsx`: picks made through the panel's `onSelect` push the current pick; a pick
  from the sidebar, `j`/`k` or the canvas clears it. Back pops it. Pure helpers (`pushTrail`,
  `backTrail`) in `src/diff/review.ts`, with a test.
- The Back button shows only with a trail, left of the panel's kind, with its tip naming the
  previous symbol and the key.
- Alt+← is read before `useDiffKeys`' early return for modifier keys.

## Verification

1. Unit (red first): the trail's push, back and clear.
2. e2e as in "Done when"; no page errors.

**Risks**

| Risk | Mitigation |
|---|---|
| Alt+← is the browser's Back in a tab | `preventDefault` only while the panel has a trail; otherwise the browser's |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 982 | Returning after following a link | **The panel keeps a trail of picks followed from it; Back (its head, Alt+←) returns; a pick from elsewhere clears it** | In 5 of 5 walks the way back was to find and pick the finding again |
