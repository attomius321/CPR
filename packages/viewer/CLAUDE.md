# @cpr/viewer

React 19 + `@xyflow/react` 12 + dagre, bundled by Vite into `dist/`. `cpr view`/`cpr pr` serve it
with `/api/graph`, `/api/source`, `/api/state/<name>` and `/api/review` (`packages/cli/src/server.ts`);
`?graph=<url>` loads any graph JSON instead (used by `scripts/viewer/measure.mjs`). Under
`cpr view` (V9) the root is the commits page (`/api/commits`, `POST /api/diffs`) and each diff is
served under `/diff/<base>..<head>/`: the viewer must keep calling its own API with **relative**
URLs (`./api/…`) and loading files relative to the page (`base: './'`), so every call reaches that
diff. Only the commits page's endpoints are absolute (`/api/commits`, `/api/diffs`).

## Where things are

- `src/flow.ts` — **pure** layout: `layoutFlow` (what is drawn and where: summaries for big
  neighbourhoods, file boxes, cluster packing, project frames) and `decorate`/`decorateEdges`
  (selection, reviewed marks, `--since` dimming). Unit-tested in `test/flow.test.ts`.
- `src/projects.ts` — a path's project by the graph's `projects` (the longest folder holding it).
- `src/layouts.ts`, `src/layout-worker.ts`, `src/useLayout.ts` — layouts made in a worker
  (V8e): view keys, the cache of recent layouts, numbered requests, the main-thread fallback.
- `src/App.tsx` — state, the view to lay out, the canvas (map mode, reveal/fit), toolbar.
- `src/Sidebar.tsx` (change list with search, findings, review tab), `src/DetailPanel.tsx`
  (diff, comments, users/uses), `src/ReviewTab.tsx`.
- `src/review.ts` (change list — by project when it spans several —, search, j/k order, one
  project and its neighbourhood, marks), `src/detail.ts` (excerpts, diff rows),
  `src/comments.ts` (draft comments and anchors), `src/store.ts` (server or browser state).
- `src/commits.ts` (**pure**: picking, which end is the base, the label, reading `api/graph`'s
  202/502/404 while a diff is analyzed), `src/Commits.tsx` (the commits page, a diff's progress).
- `src/ProjectNode.tsx`, `FileNode.tsx`, `SymbolNode.tsx`, `SummaryNode.tsx`; `src/styles.css`
  (one flat stylesheet: check a new class name is not taken — the sidebar's review bar is
  `.progress`).

## Rules

- **Layout never depends on selection or review state.** Only `decorate` does; the view to lay
  out depends on the graph and the view toggles. Clicking or marking must not move anything (V6:
  this took marking from 1.2 s to 72 ms on a 1,288-symbol graph).
- Layouts are made off the main thread (V8e, `useLayout`): never call `layoutFlow` from a
  component. A layout arrives later: the last one stays drawn (`pending`), and anything that
  moves the view for a new layout (fitting a project, the focus, a group) waits until it is
  drawn. What crosses to the worker is structured-cloned: options and layouts stay plain data
  (Maps, Sets, no functions).
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
- Edges (V8c): React Flow checks every edge it is given on every frame of a move. `edgesToDraw`
  decides what it gets: on the map one edge per pair of linked file boxes (`fileEdges`; file
  boxes carry unseen handles for them), while the view of a large graph moves (over
  `MOVING_EDGE_LIMIT` edges) only the selected symbol's. A move starts at `onMove`, not
  `onMoveStart` (which comes with every click).
- Anything `<ReactFlow>` hands to every node (`onNodeClick`, the minimap's `nodeClassName`) keeps
  its identity across renders (`useCallback`, module-level): a new function re-renders every node.
- Import only **types** from `@cpr/core`; anything else must work in a browser.
- Graphs from older CPR versions must still open: treat new graph fields as optional.

## Tests

- Unit: `test/flow.test.ts`, `layouts.test.ts`, `review.test.ts`, `detail.test.ts`,
  `comments.test.ts`, `commits.test.ts` (vitest from the repo root).
- E2E: `e2e/*.spec.ts` (Playwright, after `pnpm build`). `e2e/cpr.ts` turns a fixture's base/head
  into a repo and serves `cpr view` (`serveFixture`, which opens `/diff/<pair>/`), a fake forge
  pull request (`servePullRequest`), or five commits for the commits page (`serveCommits`). Every
  spec checks there were no page errors.
- Count minimap nodes, not DOM nodes: off-screen nodes are not in the DOM.
- For layout or performance work, measure on real graphs with the `viewer-check` skill.
