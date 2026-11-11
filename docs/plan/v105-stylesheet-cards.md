# V105 — Stylesheet rules as one card per file

[Index](../PLAN.md) · [Journal](../journal/v105-stylesheet-cards.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v105-stylesheet-cards`;
planned (2026-11-10) by the graph usability spike (`spike/graph-usability`).

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

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 979 | Changed stylesheet rules on the canvas | **One card per stylesheet with two or more changed symbols, all stylesheet symbols, with its counts by kind of change, opened like a summary; links into its rules attach to the card. A pick inside a closed card rings the card and leaves it closed; Focus on one opens it** | 46 % of changed symbols on 26 merges were CSS rules; they made the largest block of the map. Opening the card on a pick would put the block back with the first `j` |
| 980 | Stylesheets in the change list and the progress | **One row and one item per stylesheet: one stop of `j`/`k` (its first rule), one mark for all its rules from its row, `r` or the panel** | A rule counted as much as a function in "x of N reviewed"; a stylesheet marked in part would read as not reviewed, with no way to see which rules were |

## As built

Decisions 979 and 980 as proposed, made precise where the plan left a choice: which files fold,
what a pick inside a card does, what `j`/`k` and `r` do. Tests first: `flow.test.ts` (8 V105 cases)
and `review.test.ts` (4) failed for the right reasons (no card, no `stylesheet` entry, `j` stopping
on every rule, a mark marking one rule), then passed; the three new e2e tests in
`stylesheets.spec.ts` fail on `main`'s build and pass on this one.

- **Which files fold** (`stylesheetFiles`, `graph/flow.ts`): a file whose changed symbols are all
  stylesheet symbols (`language` `css` or `scss`: rules, custom properties, keyframes, SCSS
  members), **two or more**. A stylesheet with one changed rule is that rule: a card would say less
  and cost a click. The same set makes the change list's rows and the marks, from the graph alone
  (not the `--since` filter), so the card, the row and the item are always one thing.
- **The card takes the whole file** (`foldStylesheets`, before neighbours are counted): every
  symbol of the file in view, changed or not, leaves the layout and a node of its own, changed,
  takes the place of the file's first symbol (boxes keep their order). Links to and from them
  become the card's, one per neighbour and direction, with the number they stand for
  (`data.count`; the map's file pairs count them too); links between its own symbols are gone. So
  its neighbours are grouped as a changed symbol's: IssuesPage.css's 79 tokens are one "79 uses"
  box. With no such file in view, the nodes and edges are the ones `main` lays out.
- **The card** (`StylesheetNode.tsx`, `StylesheetNode.css`): a symbol's neutral card on a second
  edge, "STYLESHEET", the file's name, "62 rules", and one mark per kind of change with its count
  (`+62`; `+2 ~20 −19`). It counts `rules` or `variables` when all are one kind, else `symbols`.
  Its rules' findings are one count on it, and on the map at its corner, the box's name in the
  worst one's colour. On the map it is a block of its kind's colour; a minimap node too. The
  legend adds "a stylesheet's rules, as one card" when the canvas draws one.
- **Opening it** is a group's: the same `expanded` set and `toggleSummary`, so `App.tsx` was not
  changed. Opened, the rules are laid out as without the card, and the card stays in the box,
  dashed, to hide them.
- **A pick inside a closed card rings the card** (added: the plan did not say). A rule picked from
  the list, the panel or `j` leaves the card closed: the card is ringed (`decorate`) and brought
  into view (`drawnAs` in `Canvas.tsx`). A group of neighbours opens instead (its members are in
  `hidden`); a card's symbols are not, or the first `j` into a stylesheet would put its block back
  and leave it there. Focus on such a pick opens its card (`layoutView`): Focus shows the pick.
  The panel counts a closed card's symbols, and for a pick inside it the card's groups, as on the
  canvas (`onCanvas`).
- **The change list** (`Sidebar.tsx`): the file's name, then one row: a box that marks all its
  rules, a caret that shows them, "62 rules" (a click picks its first rule) and its marks. Shown,
  its rules have no box of their own. While searching, a stylesheet shows the rules that match.
- **One item** (`reviewItems`, `diff/review.ts`): the progress and the Changes tab count a
  stylesheet once, reviewed when all its rules are ("0 of 151 changes reviewed", with a tip
  "92 symbols and 1 stylesheet"; without stylesheets the words are `main`'s). `j`/`k` stop on it
  once, at its first rule (added). Marking any of its rules marks them all, from its row's box,
  `r` or the panel (`toggleMark`; the plan said one mark marks them all, and `r` at the stop `j`
  makes must mark the item). One of them changed since keeps the item unreviewed and the next mark
  reviews them all again.
- **Not changed**: the graph JSON and core; the Files page; `App.tsx`, `DetailPanel.tsx` and
  `useDiffKeys.ts` (V104's files in this round). The panel's button still says "Mark it
  reviewed" for a rule whose mark marks its stylesheet: a follow-up for `DetailPanel.tsx`.
- **`scripts/viewer/layout-compare.mjs`** (added): two builds' layout workers, run in Node on the
  same graphs and views, compared whole. `main` against itself: 0 differences.

