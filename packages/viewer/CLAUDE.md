# @cpr/viewer

React 19 + `@xyflow/react` 12 + dagre, bundled by Vite into `dist/`. `cpr view`/`cpr pr` serve it
with `/api/graph`, `/api/source`, `/api/state/<name>` and `/api/review` (`packages/cli/src/server.ts`);
`?graph=<url>` loads any graph JSON instead (used by `scripts/viewer/measure.mjs`).

## Where things are

- `src/flow.ts` — **pure** layout: `layoutFlow` (what is drawn and where: summaries for big
  neighbourhoods, file boxes, cluster packing) and `decorate`/`decorateEdges` (selection, reviewed
  marks, `--since` dimming). Unit-tested in `test/flow.test.ts`.
- `src/App.tsx` — state, the layout memo, the canvas (map mode, reveal/fit), toolbar.
- `src/Sidebar.tsx` (change list with search, findings, review tab), `src/DetailPanel.tsx`
  (diff, comments, users/uses), `src/ReviewTab.tsx`.
- `src/review.ts` (change list, search, j/k order, marks), `src/detail.ts` (excerpts, diff rows),
  `src/comments.ts` (draft comments and anchors), `src/store.ts` (server or browser state).
- `src/FileNode.tsx`, `SymbolNode.tsx`, `SummaryNode.tsx`; `src/styles.css`.

## Rules

- **Layout never depends on selection or review state.** Only `decorate` does; the layout memo
  depends on the graph and the view toggles. Clicking or marking must not move anything (V6:
  this took marking from 1.2 s to 72 ms on a 1,288-symbol graph).
- Big graphs: neighbourhoods over `NEIGHBOUR_LIMIT` (8) become summary nodes; below zoom 0.45 the
  canvas is a map (CSS class `map`, labels scaled by the `--cpr-zoom` variable set without
  re-rendering); React Flow draws only on-screen nodes (`onlyRenderVisibleElements`).
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
