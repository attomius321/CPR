# V101 — Draw the links a finding is about

[Index](../PLAN.md) · [Journal](../journal/v101-links-a-finding-is-about.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v101-links-a-finding-is-about` in
its own workspace; written by the graph usability spike (`spike/graph-usability`). Not started.

**Kind** feature (milestone) · **Branch** `feature/v101-links-a-finding-is-about` · **Size** S–M ·
**Depends on** none · **Rank** 3 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**: the canvas shows the links the detail panel lists. Type references are hidden
by default (the **Type references** toggle), and a symbol linked to others only by type
references is drawn alone. Two changes fix that:
1. **Focus lays out type references** inside the focused neighbourhood, whatever the toggle says.
   Focus is a view of its own, so this changes no other layout.
2. **Outside Focus, a pick raises its type-reference edges** to symbols already on the canvas, as
   it raises its other edges today. The panel marks each neighbour that is not on the canvas, with
   "press `f` to see it".

**Where to look**:
- `packages/viewer/src/graph/flow.ts:202`, the edge filter
  (`typeReferences || e.kind !== 'type-reference'`). Neighbours are built from these edges only
  (`neighboursOf`, :431), so a type-reference neighbour is never placed.
- `flow.ts`'s `decorateEdges` (:369), `edgesToDraw` (:347), `RAISED_EDGE_Z` (:362).
- `src/diff/App.tsx` (`view`, `focusSet`); `src/diff/review.ts`'s `neighbourhood` (all kinds of
  edges already).
- `src/diff/DetailPanel.tsx`: the "Used by" and "Uses" lists.
- The viewer's `CLAUDE.md`: the layout never depends on selection; React Flow checks every edge it
  is given on every frame of a move (V8c).

**Out of scope**: type references on by default. The sample holds 6,925 of them, and V8c measured
what edges cost a moving view.

**Done when**:
- Focus on Bitwarden 737ee3f's `AssignCollectionsComponent.constructor` draws its 8 linked
  symbols and their edges (7 uses, 1 no longer used).
- On the small fix, Focus on `MergerOptions` draws the edge to `merger` and its 7 uses.
- A pick outside Focus raises its type-reference edges between drawn symbols; the panel marks the
  rest.
- `edgesToDraw` hands React Flow no more edges while moving than today (`MOVING_EDGE_LIMIT`).

## Problem (the spike's G4)

- 90 of the 405 symbols with findings in the sample (22 %) are linked only by type references. For
  those, Focus draws the symbol alone. 2,290 of 6,624 changed symbols (35 %) have some links
  hidden.
- Bitwarden's warned constructor: the panel lists 7 uses and 1 no longer used (`ConfigService`,
  which is the decision this change makes). Focus draws 1 card and no edge
  ([shot](../../spikes/graph-usability/shots/p04-focus-draws-no-users-dark.png)).
- The small fix's `MergerOptions`: the panel lists 8 neighbours. Focus draws 2 cards with no edge
  between them ([shot](../../spikes/graph-usability/shots/p04-focus-users-unlinked-dark.png)).

**Goal**: what a finding says about users can be seen on the canvas, at the cost of nothing on
views that do not ask for it.

## Design

- **Focus**: `App.tsx` lays out the focused view with `typeReferences: true`. The view's key
  already holds the focus set, so the layout cache (`layouts.ts`) keeps both views apart. Focus's
  neighbourhood is small: at most a few dozen symbols in the walks.
- **Outside Focus**: the layout carries the type-reference edges between drawn symbols as hidden
  edges (`hidden: true`), which do not feed placement. `decorateEdges` shows and raises the
  picked symbol's. `edgesToDraw` keeps hidden edges out while the view moves, so a moving view
  costs what it costs today.
- **The panel**: a neighbour that is not drawn gets a muted "not on the canvas", and a hint to
  press `f`.

## Verification

1. Unit (red first, `flow.test.ts`): a focused view of a symbol linked only by a type reference
   places its neighbour and the edge; outside Focus, the same graph's layout positions equal
   today's (hidden edges do not move anything); `decorateEdges` shows only the picked symbol's.
2. e2e: Focus on a fixture's interface draws its user and the edge; the panel's undrawn mark.
3. Real graphs: `interactions.mjs` (pan, select, `j`) on Bitwarden and the refactor's merge against
   `main`, 3 rounds; the edges in view while moving, counted.
4. Shots: both Focus views above, both themes.

**Risks**

| Risk | Mitigation |
|---|---|
| Hidden edges grow the layout's data | Only between drawn symbols; counted on the five graphs |
| Focus with type references gets crowded | It is one symbol's neighbourhood; summaries still group past `NEIGHBOUR_LIMIT` |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 971 | Type references in Focus | **Focus lays out every kind of link inside its neighbourhood, type references included, whatever the toggle** | 22 % of symbols with findings are linked only by type references; Focus drew them alone |
| 972 | A pick's type references outside Focus | **Carried as hidden edges between drawn symbols, shown and raised for the pick only; the panel marks neighbours that are not drawn** | The layout never depends on selection; the panel and the canvas then agree |
