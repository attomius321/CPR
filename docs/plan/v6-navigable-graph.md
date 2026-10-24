# V6 — A graph you can navigate

[Index](../PLAN.md) · [Journal](../journal/v6-navigable-graph.md)

**Status:** merged into main (2026-10-03, from branch `milestone/v6-navigable-graph`); results
and "as built" at the end of this section.

**Problem** (reported on a real project: "I can't navigate through it"). Measured on Bitwarden
with the Angular plugin, in Chromium:

| | `737ee3f` (1 commit) | `c72c857~15..c72c857` | `canManageScim` experiment |
|---|---|---|---|
| Changed symbols | 86 | 129 | 5 |
| Symbols drawn (default view) | 1,288 in 509 file boxes | 1,389 in 723 boxes | 69 in 58 boxes |
| Edges drawn | 1,840 | 1,640 | 69 |
| Canvas | 9,470 × 85,468 px | 12,553 × 98,871 px | 3,611 × 7,260 px |
| First paint · select a symbol · mark reviewed | 4.0 s · 1.5 s · 1.2 s | 4.0 s · 1.8 s · 1.6 s | 0.4 s · 0.2 s · 0.1 s |

Panning stays at 60 fps: drawing is not the problem. Three things are:

1. **The view is mostly not the change.** 94 % of the nodes are unchanged neighbours, and a few
   hubs bring most of them: `FeatureFlag` (one changed enum member's enum) has 390 users, a
   changed constructor 385 dependencies; the top 5 hubs bring 733 of 1,202 neighbours. 44 of the
   78 changed symbols with neighbours have 5 or fewer.
2. **One tall strip.** The outer dagre layout stacks the file boxes' disconnected clusters in a
   single column; "fit" bottoms out at `minZoom` 0.1, where nothing is readable, and zooming in
   loses the overview.
3. **Every click re-lays out the graph.** `toFlow` runs dagre on everything, and its memo
   depends on `selected` and `reviewed`: selecting or marking a symbol costs 1.2–1.8 s, so
   walking the change with j/k stutters and the canvas jumps.

**Goal**: any change opens as an overview that fits one screen at a readable zoom; walking it
(list, j/k, findings) is instant and keeps the canvas still; neighbourhoods of any size stay one
click away. Viewer only: the analysis and the graph JSON do not change.

## Design

- **Collapse big neighbourhoods** (in `toFlow`, pure). For each changed symbol, its unchanged
  neighbours on one side — users (edges into it) or uses (edges out of it) — are drawn only if
  there are at most `NEIGHBOUR_LIMIT` = 8; otherwise one **summary node** stands for them:
  "390 users · 220 files". A neighbour another changed symbol shows anyway stays drawn (and is
  not counted twice); users a `removed-still-referenced` finding names are always drawn (the
  stale call site is the point of the finding). Simulated: `737ee3f` 1,288 → 168 symbols + 29 summaries in 59
  boxes; the 15-commit range 1,389 → 282 + 24 in 119 boxes; `canManageScim` 69 → 15 + 2.
- **Expand on click**: a summary node toggles its group (`expanded` set in the app); expanded,
  it stays as "390 users · hide" and its neighbours are laid out. Focus mode (f) collapses the
  same way, so focusing a hub is no longer a wall.
- **Tiles, not a strip**: the file-box graph is split into connected clusters; each is laid out
  with dagre as now, then the clusters are packed in rows (largest first) to a ~16:10 page. The
  inside of a box keeps dagre, but symbols without an edge inside their box are wrapped into
  columns of at most 6 instead of one tall column.
- **Layout once, decorate often**: `toFlow` is split into `layoutFlow` (what is drawn and where:
  graph, type references, context, focus, expanded) and `decorate` (reviewed, settled,
  selected, findings), so selecting, marking reviewed and j/k never move a node; the canvas only
  pans to the selection.
- **Draw what is on screen**: React Flow's `onlyRenderVisibleElements`.

## Verification

1. Unit (`flow.test.ts`): a hub with 30 users collapses to one summary with the right counts;
   expanded, all 30 are laid out; shared neighbours and error-finding users stay; packing keeps
   the canvas within 2.5:1 for many small clusters; decoration never changes positions.
2. E2E: a generated large graph (`?graph=`): the summary node shows, a click expands it,
   marking reviewed and j/k leave every node where it was; the existing viewer tests unchanged.
3. Bitwarden graphs above: symbols drawn, canvas size and aspect, select/review times
   (target: under 150 ms), screenshots of the overview.

**Risks**: a collapsed neighbour the reviewer needed (mitigation: counts on the summary, one
click, stale users of a finding always shown, the detail panel still lists all callers); packing
moves clusters away from where they were (one layout per view, stable while reviewing).

## V6 results

| Bitwarden, Chromium | `737ee3f` before → after | `c72c857~15..c72c857` before → after | `canManageScim` before → after |
|---|---|---|---|
| Symbols drawn (+ summary nodes) | 1,288 → 168 (+29) | 1,389 → 282 (+24) | 69 → 15 (+2) |
| File boxes | 509 → 59 | 723 → 111 | 58 → 9 |
| Canvas | 9,470 × 85,468 → 10,904 × 7,183 px | 12,553 × 98,871 → 12,443 × 11,049 px | 3,611 × 7,260 → 3,108 × 670 px |
| Layout | 1,280 → 194 ms | 967 → 171 ms | 42 → 10 ms |
| First paint · select · mark reviewed | 4.0 s · 1.5 s · 1.2 s → 0.65 s · 0.33 s · 0.07 s | 4.0 s · 1.8 s · 1.6 s → 0.72 s · 0.42 s · 0.08 s | 0.4 · 0.2 · 0.1 s → 0.27 · 0.14 · 0.03 s |
| Elements in the page | 22,966 → 3,937 | 24,244 → 5,702 | 1,354 → 389 |

"Select" includes the 0.3 s animated pan to the symbol and drawing its detail panel; nothing is
laid out again.

**What the measurements changed in the plan**:
- Packing separates *clusters*, but on `737ee3f` 57 of 59 boxes are one connected cluster, which
  dagre lays out at 15 % fill; tighter spacing gained 5 % (fit zoom 0.087 → 0.092) and a
  top-to-bottom layout lost half. A whole-change view of a large change cannot be read at text
  size, whatever the layout. So the overview became a **map** (below 45 % zoom): each box shows
  its file name at a readable size — changed files bold, context files small and muted —
  symbols become blocks in their status colour, edges fade, and a click on a file zooms into it.
  Reading happens zoomed in, reached by the change list, j/k, findings or a click on the map.
- The selected symbol ended up half under the detail panel: the canvas was centred before it
  narrowed for the panel. It now re-centres when the canvas size changes.
- Opening a group could put its symbols off screen; showing or hiding a group now fits the view
  to it. A grouped symbol picked in the detail panel's lists opens its group.
- A changed template with many uses (34 in the A3 fixture) is collapsed like a hub's users: its
  package boxes appear when its "32 uses in 5 files or packages" node is opened.

**Tests**: 10 unit tests (collapsing at the limit, expansion, shared neighbours, stale users kept,
focus, packing aspect, wrapping, no overlaps, decoration keeps positions and object identity,
edge highlighting); 4 e2e tests on a generated 40-user hub with 30 more changes (group opens
and closes, map and click-to-zoom, walking and marking move nothing and the selection is not
under the panel, a grouped user picked in the panel is shown). Two older e2e tests counted
symbols in the page — only on-screen nodes are there now — and count the minimap's instead; the
A3 viewer test opens the template's uses first.

## V6 as built

- `flow.ts`: `layoutFlow(graph, { typeReferences, context, focus, expanded })` returns nodes,
  edges, `hidden` (grouped symbol → its summary) and `members` (summary → its symbols);
  `decorate(nodes, { reviewed, sinceOnly, selected })` and `decorateEdges(edges, selected)` add
  review state, returning untouched nodes as they were. `toFlow` = both.
- Groups: per changed symbol and side, unchanged neighbours over `NEIGHBOUR_LIMIT` (8) become a
  `summary` node (`summary:<users|uses>:<id>`) in the symbol's box, joined to it by a dashed
  edge. Drawn anyway: neighbours another side shows, and the `related` users of
  `removed-still-referenced` findings.
- Boxes: dagre (left to right) for symbols linked inside the box, columns of 6 for the rest,
  changed ones first. Clusters of boxes (union-find over edges between boxes) are laid out by
  dagre each and packed in rows, tallest first, on a page about 1.6 wide.
- App: the layout memo depends on the graph, toggles, focus set and expanded groups only;
  selection and marks only decorate. React Flow draws only on-screen nodes
  (`onlyRenderVisibleElements`); the zoom is a CSS variable (`--symbiote-zoom`) set from the store
  without re-rendering, and the `map` class flips at 45 %.
- Follow-up (branch `claude/change-search`, merged 2026-10-03): a search box on the Changes
  tab. `filterChanges(list, query)` keeps the symbols whose `file` + label hold every word,
  ignoring case; `/` focuses it, Enter opens the first match, j/k walk only the matches. The
  sidebar tab and the query live in `App` so `/` can switch tabs and j/k see the filter.
