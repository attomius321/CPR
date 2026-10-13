# @cpr/viewer

React 19 + `@xyflow/react` 12 + dagre, bundled by Vite into `dist/`. `cpr view`/`cpr pr` serve it
with `/api/graph`, `/api/source`, `/api/state/<name>` and `/api/review` (`packages/cli/src/server.ts`);
`?graph=<url>` loads any graph JSON instead (used by `scripts/viewer/measure.mjs`).

## Where things are

- `src/flow.ts` — **pure** layout: `layoutFlow` (what is drawn and where: summaries for big
  neighbourhoods, file boxes, cluster packing, project frames) and `decorate`/`decorateEdges`
  (selection, reviewed marks, `--since` dimming). Unit-tested in `test/flow.test.ts`.
- `src/projects.ts` — a path's project by the graph's `projects` (the longest folder holding it).
- `src/App.tsx` — state, the layout memo, the canvas (map mode, reveal/fit), toolbar.
- `src/Sidebar.tsx` (change list with search, findings, review tab), `src/DetailPanel.tsx`
  (diff, comments, users/uses), `src/ReviewTab.tsx`.
- `src/review.ts` (change list — by project when it spans several —, search, j/k order, one
  project and its neighbourhood, marks), `src/detail.ts` (excerpts, diff rows),
  `src/comments.ts` (draft comments and anchors), `src/store.ts` (server or browser state).
- `src/ProjectNode.tsx`, `FileNode.tsx`, `SymbolNode.tsx`, `SummaryNode.tsx`; `src/styles.css`.

## Rules

- **Layout never depends on selection or review state.** Only `decorate` does; the layout memo
  depends on the graph and the view toggles. Clicking or marking must not move anything (V6:
  this took marking from 1.2 s to 72 ms on a 1,288-symbol graph).
- Big graphs: neighbourhoods over `NEIGHBOUR_LIMIT` (8) become summary nodes; below zoom 0.45
  (`MAP_ZOOM`, `src/mapzoom.ts`) the canvas is a map (CSS class `map`), React Flow draws only
  on-screen nodes (`onlyRenderVisibleElements`).
- Map labels keep fixed sizes and are scaled by `transform: scale(1 / var(--cpr-zoom))`; the
  variable is written by `mapZoomStyle` into a one-rule stylesheet for the labels only, and only
  on the map (V8a). Never set it on the page root or change a font size with the zoom: either
  restyles or re-lays out thousands of elements on every zoom frame.
- Frames (V7b): only when the files drawn span two or more projects; otherwise the layout must
  equal one without `projects` (a unit test compares them). Nodes nest three deep — frame → file
  box → symbol — and parents come first in `nodes`. A frame takes the pointer only on its name
  band, and not at all on the map (V8b): there its name covers files, which must get their
  clicks; a canvas click inside a frame zooms into it (`projectAt`). Frames are placed in
  rows in dagre's rank order (`packFrames`): dagre's own columns ran 3–8× wider than high. A
  package or the dynamic calls box is drawn in the frame it has most links with (it stays in no
  project: no `edge-cross`): beside the frames, a package with hundreds of users made long fans
  of edges, and React Flow draws every edge whose bounding box meets the view (Qwik panned at
  3 fps). Measure edges in view, not only canvas size, when changing placement.
- Import only **types** from `@cpr/core`; anything else must work in a browser.
- Graphs from older CPR versions must still open: treat new graph fields as optional.

## Tests

- Unit: `test/flow.test.ts`, `review.test.ts`, `detail.test.ts`, `comments.test.ts` (vitest from the
  repo root).
- E2E: `e2e/*.spec.ts` (Playwright, after `pnpm build`). `e2e/cpr.ts` turns a fixture's base/head
  into a repo and serves `cpr view` (`serveFixture`) or a fake forge pull request
  (`servePullRequest`). Every spec checks there were no page errors.
- Count minimap nodes, not DOM nodes: off-screen nodes are not in the DOM.
- For layout or performance work, measure on real graphs with the `viewer-check` skill.
