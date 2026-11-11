# V101 — Draw the links a finding is about

[Index](../PLAN.md) · [Journal](../journal/v101-links-a-finding-is-about.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v101-links-a-finding-is-about`
(the workspace's, from `main` at e0e8564); planned by the graph usability spike
(`spike/graph-usability`). Decisions 971–972; 972 differs from the plan in two parts (As built).

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
| 972 | A pick's type references outside Focus | **Carried as hidden edges between drawn symbols, in a list of their own made after placement; only the pick's reach React Flow, raised as its own edges, while the view moves too; the panel marks a neighbour neither drawn nor grouped in the pick's own summary, and says to press `f` when Focus would draw them** | The layout never depends on selection; the panel and the canvas then agree; React Flow checks a `hidden` edge every frame; a pan would blink out only the links picked for |

## As built

Decision 971 as proposed; 972 with two parts built otherwise (the moving view, what counts as on
the canvas); a layer for raised edges and the toggle's line added. Tests first: `flow.test.ts`
(5), `review.test.ts` (2) and two e2e tests in `review.spec.ts` failed on `main`'s code for the
right reasons (no `layoutView`, `hiddenEdges` or `onCanvas`; Focus on the detectors fixture's
`Shape` drew 3 of its 5 cards; a pick raised 0 type references), then passed.

- **Focus.** `layoutView` (`diff/review.ts`, pure) builds the view `App.tsx` lays out: Focus on a
  symbol gives its neighbourhood with `typeReferences: true`; otherwise the toggle, with one
  project's neighbourhood or none. The view no longer depends on the pick outside Focus: before,
  with one project shown, every pick made a new view object (the cache answered it from the same
  key).
- **Hidden edges are a list of their own**, `FlowLayout.hiddenEdges`, not React Flow's
  `hidden: true`: React Flow 12.12 runs its visibility check on every edge it is given, hidden ones
  too, on every frame of a move (`useVisibleEdgeIds`). They are made after placement, from the
  type references whose two symbols have a box, with `symbolEdge`'s classes (dotted, the side's
  colour, `edge-cross`). With the toggle on there are none: the edges hold them.
- **While the view moves, the pick's type references stay** (the plan: kept out). They are its own
  edges in every case: still, moving, on the map. Kept out, every pan of a graph under
  `MOVING_EDGE_LIMIT` (4 of the 5 walked: they draw every edge while moving) would hide exactly the
  links the person picked the symbol to see, and nothing else. The bound is today's: a moving view
  hands React Flow at most `MOVING_EDGE_LIMIT` edges, or only the pick's own. Counted below: at most
  30 more, on the refactor's `AgentKind`.
- **On the canvas means drawn, or grouped in the pick's own summary** (the plan: drawn). The first
  build also counted a member of any collapsed summary, since picking one opens it. On Bitwarden,
  5 of the constructor's 8 uses sit in groups of other symbols (a spec's `createComponent`, a
  story's `default`), with nothing on the canvas linking them to the pick: the panel marked 2 while
  the canvas drew 1 edge. `onCanvas(layout, pick)` counts only the pick's own groups, which are
  linked to it; the panel marks 7.
- **The panel.** A neighbour not on the canvas gets a quiet chip, "not on the canvas", after its
  name and outside its place's ellipsis. One line under the groups says "Press f to see the N not
  on the canvas." only when Focus would draw every one: Focus off and Context on (with Context off,
  Focus leaves unchanged neighbours out).
- **A raised edge is a layer of its own** (added). With the refactor's `AgentKind` picked on its
  zoomed-out canvas, its 30 raised type references made a 40-step drag take 1,542 ms against
  `main`'s 673: no frame over 50 ms, but each about 39 ms instead of 17. The dots were the cost:
  without `stroke-dasharray` the same drag took 672 ms, and `main`'s 97 solid raised calls of
  `startViewServer` 689–707 ms. React Flow 12 draws each edge in an `<svg>` of its own inside the
  moving viewport, so a dotted path was painted again on every frame. `will-change: transform` on
  `.edge-raised` (`canvas.css`) gives it a layer that moves with the view: 672 ms. Zooming costs
  the same, and the edges are as sharp after zooming out and back in. Focus was never slow (99
  edges in view, all short: 671 ms).
- **The Type references toggle carries the dotted line** (added): Focus now draws type references
  on every pick, and the legend named only calls. An entry of its own (123 px) wrapped the legend
  onto a second line at 1920 × 1080 with the panel open, 23 px of canvas; on the toggle it takes
  22 px, and the legend's height is `main`'s at 1280, 1440 and 1920 px.

## Results

The five walked changes, served from `main`'s `git archive` build (e0e8564) and this branch's,
the graph by `?graph=`, at 2560 × 1440, 1x. Cards and edges are counted in the page once Focus
has fitted the neighbourhood; the counts are the same in both themes.

| Measure | `main` | V101 |
|---|---|---|
| Bitwarden 737ee3f, Focus on `AssignCollectionsComponent.constructor` | 1 card, 0 edges | 9 cards, 8 edges: its 7 uses and `ConfigService`, no longer used ([dark](../images/v101-links-a-finding-is-about/bitwarden-focus-after-dark.png), [light](../images/v101-links-a-finding-is-about/bitwarden-focus-after-light.png); before: [dark](../images/v101-links-a-finding-is-about/bitwarden-focus-before-dark.png), [light](../images/v101-links-a-finding-is-about/bitwarden-focus-before-light.png)) |
| The small fix, Focus on `MergerOptions` | 2 cards, 0 edges | 9 cards, 9 edges: the one to `merger`, its 7 uses, and one between two of them ([dark](../images/v101-links-a-finding-is-about/fix-focus-after-dark.png), [light](../images/v101-links-a-finding-is-about/fix-focus-after-light.png); before: [dark](../images/v101-links-a-finding-is-about/fix-focus-before-dark.png), [light](../images/v101-links-a-finding-is-about/fix-focus-before-light.png)) |
| Qwik 65661bf49, Focus on `CursorBoundary`; the refactor, on `AgentKind` | 13 cards, 10 edges; 31 cards, 32 edges | 18 cards, 28 edges; 39 cards and a group, 105 edges |
| A pick outside Focus: type references raised; neighbours marked not on the canvas | none; none | the constructor 1 of 8, 7 marked, "Press f to see the 7 not on the canvas." ([dark](../images/v101-links-a-finding-is-about/bitwarden-panel-after-dark.png), [light](../images/v101-links-a-finding-is-about/bitwarden-panel-after-light.png)); `MergerOptions` 1, 7; `CursorBoundary` 13, 4; `AgentKind` 30, 24 |
| Every layout's nodes, edges and file edges (the five graphs) | — | identical to `main`'s |
| Type references carried; the layout's size | — | the small fix 9, 150 → 155 KB; the feature 121, 752 → 811 KB; the refactor 472, 1,674 → 1,907 KB (+14 %); Bitwarden 40, 955 → 986 KB; Qwik 41, 388 → 414 KB |
| Edges handed to React Flow while the view moves, every changed symbol picked in turn: mean; most | small fix 68.0, 68; feature 3.7, 48; refactor 4.4, 97; Bitwarden 354.0, 354; Qwik 235.0, 235 | 68.8, 72; 4.8, 50; 6.4, 107; 354.7, 362; 236.0, 248 |
| Edges in view while dragging, with the pick: Bitwarden's constructor; Qwik's `CursorBoundary`; the refactor's `AgentKind` | 55; 66; 0 | 56; 79; 30 |
| A 40-step drag at 1440 × 900 with the pick, zoomed out 4 steps (median of 3, two rounds, builds alternated): `AgentKind`; `startViewServer` (97 raised calls); `CursorBoundary`; the constructor | 675, 671 ms; 707, 689; 672, 672; 672, 672 | 672, 672 ms; 738, 707; 673, 671; 671, 671. Before the raised edges' layer: `AgentKind` 1,542–1,559 ms |
| `interactions.mjs`, 3 runs of 3 rounds per build, alternated, medians in ms: open, select a change, j ×8, context off | Bitwarden 345–360, 64, 1,065–1,086, 77–80; the refactor 894–903, 290–298, 1,086–1,185, 145–244 | Bitwarden 333–344, 65–66, 1,081–1,082, 79; the refactor 893–894, 281–298, 1,119–1,170, 245–252. Pans 520 ms, 0 ms blocked, on both; the refactor's "close it" times out on both, as in the spike |

Cost: none measured once raised edges have a layer. The layout carries 3–14 % more data across
the worker; opening is the same (333–344 ms against 345–360 on Bitwarden, 893–894 against
894–903 on the refactor).

Tests: `flow.test.ts` (5) and `review.test.ts` (2) for V101; `e2e/review.spec.ts` (2) on the
detectors fixture. `pnpm check`, `pnpm build` and `pnpm test:e2e`: see the journal's last entry.
