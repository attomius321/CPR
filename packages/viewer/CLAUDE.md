# @symbiote/viewer

React 19 + `@xyflow/react` 12 + dagre, bundled by Vite into `dist/`. `symbiote view`/`symbiote pr` serve it
with `/api/graph`, `/api/source`, `/api/state/<name>` and `/api/review` (`packages/cli/src/server.ts`);
`?graph=<url>` loads any graph JSON instead (used by `scripts/viewer/measure.mjs`). Under
`symbiote view` the pages live in a shell (V29a, `src/shell/Shell.tsx`): a sidenav with History
(`/history`, `/api/history…`, `POST /api/diffs`), Settings and the workspaces
(`/api/workspaces…`), each opened in place; `/` alone is History. Each diff is
served under `/diff/<base>..<head>/`: the viewer must keep calling its own API with **relative**
URLs (`./api/…`) and loading files relative to the page (`base: './'`), so every call reaches that
diff. Only the two pages' endpoints are absolute (`/api/history…`, `/api/workspaces…`, `/api/diffs`).
Pages and their addresses, and a diff's way back: `src/shell/pages.ts`. In code a workspace is a
"workspace": "feature" is only the kind of work (a guard test, `packages/cli/test/naming.test.ts`).

## Where things are

`src/` has `main.tsx` and `styles.css`, and a folder per area; each pure module sits beside the
component that uses it, and each component's CSS beside it (`HistoryPage.tsx`, `HistoryPage.css`):

| Folder | What |
|---|---|
| `graph/` | The layout (`flow.ts`, the worker), the four nodes, the canvas and the map |
| `diff/` | A diff's page: `App.tsx`, its sidebar, detail panel and review tab, opening a line |
| `history/` | History: rows, lanes, branches, checkout, the row menu, branch reviews |
| `workspaces/` | A workspace, its agent's terminal, its changes, merges, Start a workspace |
| `shell/` | The shell: sidenav, title bar, status bar and usage, pages, theme, the desktop window |
| `ui/` | Shared: the tokens and controls' CSS, `Help`, `Resizer`, icons, menus, Markdown, HTTP |
| `scout/`, `settings/` | Scout, Settings |

- `src/graph/flow.ts` — **pure** layout: `layoutFlow` (what is drawn and where: summaries for big
  neighbourhoods, file boxes, cluster packing, project frames) and `decorate`/`decorateEdges`
  (selection, reviewed marks, `--since` dimming). Unit-tested in `test/flow.test.ts`.
- `src/graph/projects.ts` — a path's project by the graph's `projects` (the longest folder
  holding it).
- `src/graph/layouts.ts`, `layout-worker.ts`, `useLayout.ts` — layouts made in a worker
  (V8e): view keys, the cache of recent layouts, numbered requests, the main-thread fallback.
  The worker is `new URL('./layout-worker.ts', import.meta.url)`: the two files move together.
- `src/diff/App.tsx` — state, the view to lay out, the canvas (map mode, reveal/fit), toolbar.
- `src/diff/Sidebar.tsx` (change list with search, findings, review tab), `DetailPanel.tsx`
  (diff, comments, users/uses), `ReviewTab.tsx`.
- `src/ui/Resizer.tsx` — the one drag handle for panels (the diff's sidebar and detail panel, the
  shell's sidenav, a workspace's changes; V34): keys, limits, double-click for the default.
  Widths are kept in the browser through `src/ui/widths.ts`, each panel merged into one entry.
- `src/diff/review.ts` (change list — by project when it spans several —, search, j/k order, one
  project and its neighbourhood, marks), `detail.ts` (excerpts, diff rows),
  `comments.ts` (draft comments and anchors), `store.ts` (server or browser state).
- `src/history/commits.ts` (**pure**: picking, which end is the base, diverged picks' fork point found from
  the shape (V10c; checked against git by `scripts/viewer/compare-check.mjs`), the label, reading `api/graph`'s
  202/502/404 while a diff is analyzed), `HistoryPage.tsx` (History, a diff's progress; never `Commits.tsx` beside `commits.ts`: macOS file systems ignore case).
- `src/graph/ProjectNode.tsx`, `FileNode.tsx`, `SymbolNode.tsx`, `SummaryNode.tsx`.
- The stylesheet: plain CSS in parts beside what they draw, **listed in cascade order by
  `src/styles.css`**, which `main.tsx` imports after React Flow's stylesheet. At equal
  specificity a later part wins, so a part is added to that list, never imported by its
  component: Vite would place it by the module graph and rules could swap order unseen
  (`test/styles.test.ts` refuses it). Two orders matter today: `ui/markdown.css` after
  `workspaces/Workspace.css`, `shell/Shell.css` after `shell/Sidenav.css` (the comments in
  `styles.css` say why). Class names are global: check a new one is not taken
  (`grep -rn '^\.name' src --include='*.css'`; the sidebar's review bar is `.progress`). Shared
  controls are in `src/ui/controls.css`.
- Colours are tokens on `:root` (dark) and `:root[data-theme='light']` in `src/ui/base.css`,
  contrast tested by `test/tokens.test.ts` (which reads every `.css` under `src/`);
  `src/shell/theme.ts` and `index.html`'s inline script set the theme. Text sizes are the
  `--size-*` scale on `:root` (V32: 14 px body, nothing under 12 px but uppercase labels), never
  a px value: the same test fails on one.

## Fonts (V29b)

Geist and Geist Mono from `@fontsource-variable`, preloaded in `index.html`. **Name no other
family**, not even `sans-serif` after Geist: on Linux each name is a fontconfig match (V29a:
850–900 ms before History's first rows; V29b: `sans-serif` after a web font, 283 ms a time).
`monospace` closes both stacks: it matches in ~1 ms and has the symbols Geist lacks (✓ ⚙ ↻); a
glyph found in no family of the stack costs ~100 ms. Prefer an icon (`src/ui/icons.tsx`) to a new
symbol glyph. Measure first paint (`/history`) and Bitwarden's graph after any font change.

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
  (`MAP_ZOOM`, `src/graph/mapzoom.ts`) the canvas is a map (CSS class `map`), React Flow draws only
  on-screen nodes (`onlyRenderVisibleElements`).
- Map labels keep fixed sizes and are scaled by `transform: scale(1 / var(--symbiote-zoom))`; the
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
- Import only **types** from `@symbiote/core`; anything else must work in a browser.
- Graphs from older Symbiote versions must still open: treat new graph fields as optional.

## Tests

- Unit: `test/flow.test.ts`, `layouts.test.ts`, `review.test.ts`, `detail.test.ts`,
  `comments.test.ts`, `commits.test.ts` (vitest from the repo root). `test/` stays one folder;
  a test imports its module from `../src/<folder>/`. The stylesheet's guards: `tokens.test.ts`
  (contrast, radii, sizes, fonts) and `styles.test.ts` (every part in `styles.css`'s list).
- E2E: `e2e/*.spec.ts` (Playwright, after `pnpm build`). `e2e/symbiote.ts` turns a fixture's base/head
  into a repo and serves `symbiote view` (`serveFixture`, which opens `/diff/<pair>/`), a fake forge
  pull request (`servePullRequest`), five commits for History (`serveCommits`), or workspaces with a fake agent (`serveWorkspaces`). Every
  spec checks there were no page errors.
- Count minimap nodes, not DOM nodes: off-screen nodes are not in the DOM.
- For layout or performance work, measure on real graphs with the `viewer-check` skill.
