# @symbiote/viewer

React 19 + `@xyflow/react` 12 + dagre, bundled by Vite into `dist/`. `symbiote view`/`symbiote pr`
serve it with `/api/graph`, `/api/source`, `/api/files`, `/api/file` (V60), `/api/state/<name>`
and `/api/review` (`packages/cli/src/server.ts`); `?graph=<url>` loads any graph JSON instead
(used by `scripts/viewer/measure.mjs`). Under `symbiote view` the pages live in a shell (V29a,
`src/shell/Shell.tsx`): a sidenav with Git (`/git`, History until V66: `/api/history…`,
`/api/git…`, `POST /api/diffs`), the workspaces (`/api/workspaces…`) and, at its bottom,
Settings, each opened in place; `/` alone and `/history` are Git. Each diff is served under
`/diff/<base>..<head>/`: the viewer must keep calling its own API with **relative** URLs
(`./api/…`) and loading files relative to the page (`base: './'`), so every call reaches that diff. Only the two pages' endpoints are absolute (`/api/history…`,
`/api/git…`, `/api/workspaces…`, `/api/diffs`).
Pages and their addresses, and a diff's way back: `src/shell/pages.ts`. In code a workspace is a
"workspace": "feature" is only the kind of work (a guard test, `packages/cli/test/naming.test.ts`).

## Where things are

`src/` has `main.tsx` and `styles.css`, and a folder per area; each pure module sits beside the
component that uses it, and each component's CSS beside it (`HistoryPage.tsx`, `HistoryPage.css`):

| Folder | What |
|---|---|
| `graph/` | The layout (`flow.ts`, the worker), the four nodes, the canvas and the map |
| `diff/` | A diff's page: `App.tsx`, its two pages (Files, Graph), its sidebar, detail panel and review tab, opening a line |
| `history/` | Git (History until V66): rows, lanes, branches, checkout, the row menu, branch reviews; a commit's details, the uncommitted changes, branch and tag dialogs, fetch/pull/push, search (V66) |
| `workspaces/` | A workspace, its agent's terminal, its changes, merges, Start a workspace |
| `shell/` | The shell: sidenav, title bar, status bar and usage, pages, theme, the desktop window |
| `ui/` | Shared: the tokens and controls' CSS, `Help`, `Tooltips`, `Resizer`, icons, menus, Markdown, HTTP |
| `scout/`, `settings/` | Scout, Settings; `scout/Conversation.tsx` is a page agent's conversation, Scout's page and Scribe's pane (V41) |
| `skills/` | Skills (V41): the checkout's skills, their checks (`skills.ts`, pure), Scribe's pane |
| `monitor/` | The Monitor (RM1, RM2): the folder tree, concentration and heat (`codemap.ts`), the treemap layout (`treemap.ts`), both pure; the picture `TreemapView.tsx` |
| `intro/` | The first-time intro (V39): the koi engine, its rig and images, the overlay |

- `src/graph/flow.ts` — **pure** layout: `layoutFlow` (what is drawn and where: summaries for big
  neighbourhoods, file boxes, cluster packing, project frames) and `decorate`/`decorateEdges`
  (selection, reviewed marks, `--since` dimming). Unit-tested in `test/flow.test.ts`.
- `src/graph/projects.ts` — a path's project by the graph's `projects` (the longest folder
  holding it).
- `src/graph/layouts.ts`, `layout-worker.ts`, `useLayout.ts` — layouts made in a worker
  (V8e): view keys, the cache of recent layouts, numbered requests, the main-thread fallback.
  The worker is `new URL('./layout-worker.ts', import.meta.url)`: the two files move together.
- `src/diff/App.tsx` — state, the page shown (Files first, Graph by `?view=graph`, `g` between
  them; V60), the view to lay out, toolbar; `Canvas.tsx` the canvas (map mode, reveal/fit);
  `useDiffGraph.ts` the graph's loading and polling, `useReview.ts` marks and drafts.
- `src/diff/FilesPage.tsx` (V60) — the Files page: the change's files (`./api/files`, git's lines)
  drawn with a workspace's `FileRow` (`workspaces/ChangesPanel.tsx`), the open file's diff
  (`./api/file`: git's, the whole file as context) and comments under their lines. Its pure part
  is `file-diff.ts` (reading git's diff, folding it to 3 lines of context as git's hunks, where a
  line's comment goes); a line's comment names the innermost symbol holding it
  (`comments.ts`'s `symbolAt`, `newLineDraft`), none outside every symbol. Never `files.ts`:
  `test/files.test.ts` is the file names' guard.
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
  202/502/404 while a diff is analyzed), `HistoryPage.tsx` (the Git page; never `Commits.tsx` beside `commits.ts`: macOS file systems ignore case), its calls in `api.ts` (the diff's page imports `startDiff` and `fetchGraph` from there), `CommitRow.tsx`, `CompareBar.tsx`. A diff's progress is `diff/DiffProgress.tsx`.
- `src/history/` since V66 (the Git page): `git-api.ts` (`/api/git/…`: a commit, the changes, the
  upstream, a search, git's writes), `details.ts` (**pure** but for the pane's place, kept in the
  browser as the theme is: lines, the changes' words, why Commit is off, the upstream in words, a
  search's next match; `test/details.test.ts`), `CommitDetails.tsx` and `ChangesDetails.tsx` (the
  pane), `GitDiff.tsx` (a file's diff with the Files page's `parseFileDiff`/`foldRows`),
  `RefDialog.tsx`, `SyncBar.tsx`, `FindBox.tsx`. The uncommitted row is row −1, above the list: the
  rows' math (`list.offsetTop`) already places the list under whatever is above it.
- `src/graph/ProjectNode.tsx`, `FileNode.tsx`, `SymbolNode.tsx`, `SummaryNode.tsx`.
- `src/skills/skills.ts` — **pure**: a small reader of a `SKILL.md`'s frontmatter (plain, quoted
  and block text; a value YAML refuses is `invalid`, an anchor or a tag `unknown`) and the checks
  the page shows as one types (V41, decision 274): only what the open standard, Anthropic's API or
  an agent refuses, or a limit passed. `test/skills.test.ts` runs them on this repository's own
  skills: no error. `SkillsPage.tsx` draws with its own rules (`SkillsPage.css`, V56): no
  `settings-*` class (an e2e test refuses one), the whole main area; since V64 Settings' head and
  spacing (cards 24 px in, 16 apart), a skill's checks a card beside it from 960 px of area.
  `SkillText.tsx` is a skill's text: the text area, its words transparent, over a drawn copy with
  line numbers and Markdown's colours from `markdown-lines.ts` (**pure**, its pieces joining back
  into each line). The two layers share one font, line height, padding and wrap: change one,
  change both; `skills.spec.ts` compares their heights.
- `src/skills/library.ts` — **pure**: the skill library (SK1) in words — its name, a library
  skill's full path, its git, a commit's first message, what is at a folder before it is set
  (`test/library.test.ts`). `LibraryPane.tsx` is its pane on the Skills page;
  `settings/LibraryPage.tsx` its entry in Settings (This machine), which asks
  `/api/skills/library?folder=` as the person types.
- `src/workspaces/AgentTerminal.tsx` — an agent's terminal (xterm.js and its fit add-on): a
  workspace's agent and shells, Scout, Scribe; `MergeLog.tsx` the merge log's. xterm opens in a
  box with no padding (`.agent-terminal-fit`, `.merge-terminal-fit`), the padding on the box
  around it: the fit add-on counts the rows from the height of the box xterm is in, padding
  included (border-box), and drew up to 8 px more than the box held, which made the scrolling
  Scribe pane's scrollbars come and go every frame. `e2e/terminal-fit.spec.ts` checks it with
  real scrollbars: headless Chromium hides them, and the loop needs one that takes room.
- `src/monitor/` — the Monitor (RM1), at `/monitor` (absolute `/api/monitor`, the `CodeMap` of
  `@symbiote/monitor`, whose **types** only it imports). `codemap.ts` builds the folder tree of the
  kinds turned on, says the concentration in words and gives a file's heat step by its lines
  (`HEAT`, `heatOf`, RM2); `treemap.ts` lays a folder out (squarified, frames nested while they
  have room, six levels at most, small files merged, each tile's level-1 `section`). Both pure,
  tested in `test/codemap.test.ts` and `test/treemap.test.ts`; a layout costs 0.4–2.4 ms on real
  repositories, so it runs on the main thread (unlike the graph's), again on resize, never on
  hover, selection or colour (those are classes). The component is `TreemapView.tsx`: never
  `Treemap.tsx` beside `treemap.ts` (one name on macOS; `test/files.test.ts`).
- `src/intro/` — the first-time intro (V39). `intro.ts` (main bundle): `askIntro` asks `/api/intro`
  (absolute, like `/api/history`) during `main.tsx`'s font wait, never on a `?graph=` page;
  `startIntro` puts `.intro` on `document.body` before the first render. `play.ts` and the engine
  (`koi-intro.ts`, the person's, kept as delivered: only Prettier and non-null reads differ),
  `koi-rig.json` and five WebP images are a chunk of their own. `koi-aux.webp` is a lossless data
  map: serve it byte for byte. The e2e harness runs every server with `SYMBIOTE_INTRO=off`;
  `intro.spec.ts` turns it on with a config folder of its own. The app's icon and the favicon are
  the engine's last frame (`scripts/desktop/icon.mjs`): rerun it after changing the engine or
  its assets. A WebGL context can be lost before the engine listens (Chromium's GPU process
  falling back to software: Xvfb, WSL): `play.ts` takes the loss from the canvas's start and
  plays again on a new canvas; the app turns hardware GL off on WSL (`packages/desktop/src/gpu.ts`).
- The stylesheet: plain CSS in parts beside what they draw, **listed in cascade order by
  `src/styles.css`**, which `main.tsx` imports after React Flow's stylesheet. At equal
  specificity a later part wins, so a part is added to that list, never imported by its
  component: Vite would place it by the module graph and rules could swap order unseen
  (`test/styles.test.ts` refuses it). Two orders matter today: `ui/markdown.css` after
  `workspaces/Workspace.css`, `shell/Shell.css` after `shell/Sidenav.css` (the comments in
  `styles.css` say why). Class names are global: check a new one is not taken
  (`grep -rn '^\.name' src --include='*.css'`; the sidebar's review bar is `.progress`). Shared
  controls are in `src/ui/controls.css`.
- Tooltips (V54): never a `title` (the window system draws it: square, its own font, no theme);
  an element gets `{...tip(text, { keys, side, tone, code })}` (`src/ui/tip.ts`) and the one
  `Tooltips` (`src/ui/Tooltip.tsx`, mounted in `main.tsx`) draws it: one listener on the window,
  never one per element. `test/tooltips.test.ts` fails on a `title` or an SVG `<title>`; a third
  party's (React Flow's `Controls`) is replaced (`diff/Canvas.tsx`). Explanation stays `Help`.
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
symbol glyph. Measure first paint (`/git`) and Bitwarden's graph after any font change.

## Rules

- **In the app, the page is the browser's.** Symbiote's window (`shell/TitleBar.tsx`) adds a
  38 px title bar over the page — Back, Forward, the window's title, the window's buttons — and
  changes nothing under it: no part of a page moves into the bar or is hidden for it; only what
  covers the whole window (the intro, the narrow drawer) starts under it (`e2e/title-bar.spec.ts`
  compares the two page by page). The bar had taken a workspace's tabs and History's branches out
  of their cards, and V61's restyle of those cards missed it (fix/title-bar-desktop).
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
  `comments.test.ts`, `file-diff.test.ts`, `commits.test.ts` (vitest from the repo root). `test/`
  stays one folder; a test imports its module from `../src/<folder>/`. The stylesheet's guards:
  `tokens.test.ts` (contrast, radii, sizes, fonts) and `styles.test.ts` (every part in
  `styles.css`'s list).
- E2E: `e2e/*.spec.ts` (Playwright, after `pnpm build`). `e2e/symbiote.ts` turns a fixture's base/head
  into a repo and serves `symbiote view` (`serveFixture`, which opens `/diff/<pair>/`: its Files
  page; a spec of the graph opens `?view=graph`), a fake forge pull request (`servePullRequest`),
  five commits for History (`serveCommits`), or workspaces with a fake agent (`serveWorkspaces`).
  Every spec checks there were no page errors.
- Count minimap nodes, not DOM nodes: off-screen nodes are not in the DOM.
- For layout or performance work, measure on real graphs with the `viewer-check` skill.
