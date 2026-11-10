# V105 — Stylesheet rules as one card per file

[Index](../PLAN.md) · [Journal](../journal/v105-stylesheet-cards.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v105-stylesheet-cards` in its own
workspace; written by the graph usability spike (`spike/graph-usability`). Not started.

**Kind** feature (milestone) · **Branch** `feature/v105-stylesheet-cards` · **Size** M ·
**Depends on** none · **Rank** 7 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**: a stylesheet's changed rules are drawn as one card per file
("IssuesPage.css · 62 rules added"), which opens like a summary. The links into its rules (a
component using a class) attach to the card. The change list folds a stylesheet's rules under one
row, and the review's progress counts that stylesheet as one item, not one per rule.

**Where to look**:
- `packages/viewer/src/graph/flow.ts`: `layoutFlow` (:193), `summarize` (:461), `fileBoxes`
  (:540), `summaryEdgesOf` (:580); `SummaryNode.tsx`. A rule is a node with `language: 'css'`
  (kinds `rule`, `variable`, `keyframes`); its links are `reference` edges.
- `src/diff/review.ts`: `changeList` (:22), `reviewStatus` (:208); `src/diff/Sidebar.tsx` (the
  list).
- The viewer's `CLAUDE.md`: layout is a view's, made in a worker; summaries open and close in
  place.

**Out of scope**: core's stylesheet symbols, which stay in the graph JSON; the Files page.

**Done when**:
- The feature's merge (11610c73) draws `IssuesPage.css` as one card, and its 62 rules when opened.
- V88's merge (98e28e23) draws at most one card per stylesheet; its first view's element count
  drops (measured).
- Layouts of graphs without stylesheet changes are identical to today's (a `flow.test.ts`
  comparison on a fixture and the small fix).

## Problem (the spike's G12, part of G10)

Each changed CSS rule is a symbol. On the last 26 merges into `main` with code, 2,487 of 5,425
changed symbols (46 %) are CSS rules, and 17 merges have some. On the 7 redesign merges (V88–V93
and the redesign's own merge), they are 33–94 % of the change, more than half on 6. They draw the
largest block on the feature's map
([shot](../../spikes/graph-usability/shots/p15-stylesheet-rules-dark.png)), and they make most of
what "212 changed symbols" counts in the progress line.

**Goal**: a stylesheet is one thing to look at and to mark, and the count of changes is the count
of code a reviewer reads as symbols.

## Design

- **The card**: in the layout, a file whose changed nodes are all stylesheet rules or variables
  becomes one summary-like node, `rules:<file>`, unless that id is in `expanded`. It shows the
  file's name and its counts by kind of change. Edges into its rules become edges into the card,
  merged per source as summary edges are.
- **Opening it**: the same `expanded` set and `toggleSummary` as a group of neighbours; the rules
  are then laid out as today.
- **The list and the progress**: `changeList` gives a stylesheet one row with its rule count;
  `reviewStatus` counts it once, reviewed when all its rules are (one mark marks them all).

## Verification

1. Unit (red first, `flow.test.ts`): a fixture with a stylesheet of 10 changed rules lays out one
   card; opened, 10 symbols; a graph with no stylesheet change lays out exactly as today.
2. e2e: the card opens and closes in place; marking it marks its rules.
3. Real graphs: `measure.mjs` and `interactions.mjs` on the feature's and V88's merges against
   `main`: first paint, elements, select.
4. Shots of the feature's map and of V88's first view, both themes.

**Risks**

| Risk | Mitigation |
|---|---|
| A risky stylesheet change hides in a card | The card shows its counts and its findings badge; findings on a rule still list in the Findings tab |
| Mixed files (styles in a component) | Only files whose changed nodes are all stylesheet symbols fold |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 979 | Changed stylesheet rules on the canvas | **One card per stylesheet, with its counts by kind of change, opened like a summary; links into its rules attach to the card** | 46 % of changed symbols on 26 merges were CSS rules; they made the largest block of the map |
| 980 | Stylesheets in the change list and the progress | **One row and one item per stylesheet; one mark marks its rules** | A rule counted as much as a function in "x of N reviewed" |
