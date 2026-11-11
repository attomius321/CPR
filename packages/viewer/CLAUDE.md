# @symbiote/viewer

React 19 + `@xyflow/react` 12 + dagre, bundled by Vite into `dist/`. `symbiote view`/`symbiote pr`
serve it with `/api/graph`, `/api/source`, `/api/files`, `/api/file` (V60), `/api/state/<name>`
and `/api/review` (`packages/cli/src/server.ts`); `?graph=<url>` loads any graph JSON instead
(used by `scripts/viewer/measure.mjs`). Both commands serve `dist/` as it was when they
started, read into memory (fix/suggest-settings-models): restart a running `symbiote view` after `pnpm build`
to see a viewer change. Under `symbiote view` the pages live in a shell (V29a,
`src/shell/Shell.tsx`): a sidenav with the Overview first (`/overview`, V91; `/` alone opens
it), Git (`/git`, History until V66: `/api/history…`, `/api/git…`, `POST /api/diffs`), the
workspaces (`/api/workspaces…`) and, at its bottom, Settings, each opened in place; `/history` is
Git. Each diff is served under
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
| `history/` | Git (History until V66): rows, lanes, branches, checkout, the row menu, branch reviews; a commit's details, the uncommitted changes, branch and tag dialogs, fetch/pull/push, search (V66); a file shown in the rows' place (V70) |
| `overview/` | The Overview (V91), both modes: its pure derivations, the day read, the two bodies |
| `workspaces/` | A workspace, its agent's terminal, its changes, merges, Start a workspace |
| `shell/` | The shell: sidenav, title bar, status bar and usage, pages, theme, the desktop window |
| `ui/` | Shared: the tokens and controls' CSS, `Help`, `Tooltips`, `Resizer`, icons, menus, Markdown, HTTP; a choice kept in this browser (`stored.ts`: storage may be blocked or absent); a count and its word (`plural.ts`); `Loading` (anything under way: the turning arc and its words, never words alone, `test/loading.test.ts`) |
| `nucleus/`, `settings/` | Nucleus (Scout until NU1), Settings; `nucleus/Conversation.tsx` is a page agent's conversation, Nucleus's page and Scribe's pane (V41); Settings' list is `settingsNav` (`settings.ts`, pure: sections, folding prompt groups, the filter), its Checks page `ChecksPage.tsx` (`checks.ts`, pure; `/api/settings/checks`) |
| `skills/` | Skills (V41): the checkout's skills, their checks (`skills.ts`, pure), Scribe's pane |
| `monitor/` | The Monitor (RM1, RM2): the folder tree, concentration and heat (`codemap.ts`), the treemap layout (`treemap.ts`), both pure; the picture `TreemapView.tsx` |
| `issues/` | Issues (IS1): origin's GitHub or GitLab issues, read only; the words and addresses (`issues.ts`) and an issue's HTML made safe (`issue-text.ts`), both pure |
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
  them; V60; `g` and the page switch follow the pick, `follow`, V104), the view to lay out,
  toolbar; `Canvas.tsx` the canvas (map mode, reveal/fit; a
  pick's move, `pickView`, and every fit's cap, the reading zoom from Settings' text size,
  `readingZoom` in `graph/mapzoom.ts`, V99),
  `CanvasCard.tsx` its card (the legend and the view's toggles), `DiffHead.tsx` the head's parts;
  `useDiffGraph.ts` the graph's loading and polling, `useReview.ts` marks and drafts,
  `useDiffKeys.ts` the keys.
- `src/diff/FilesPage.tsx` (V60) — the Files page: the change's files (`./api/files`, git's lines)
  drawn with a workspace's `FileRow` (`workspaces/ChangesPanel.tsx`), the open file's diff
  (`./api/file`: git's, the whole file as context) and comments under their lines. Its pure part
  is `file-diff.ts` (reading git's diff, folding it to 3 lines of context as git's hunks, where a
  line's comment goes); a line's comment names the innermost symbol holding it
  (`comments.ts`'s `symbolAt`, `newLineDraft`), none outside every symbol. A picked symbol's
  lines there (V104) are `symbolFocus` (its file and lines) and `firstChangedRow` (the row, once
  the file's rows are read), in `file-diff.ts`. Its order (V102) is
  `file-order.ts` (pure: files with listed findings, code, tests, the rest), applied in
  `useReviewFiles` so `j`/`k` walk it. Never `files.ts`: `test/files.test.ts` is the file
  names' guard.
- `src/diff/Sidebar.tsx` (change list with search, findings, review tab), `DetailPanel.tsx`
  (diff, comments, users/uses), `ReviewTab.tsx`.
- `src/ui/Resizer.tsx` — the one drag handle for panels (the diff's sidebar and detail panel, the
  shell's sidenav, a workspace's changes; V34): keys, limits, double-click for the default.
  Widths are kept in the browser through `src/ui/widths.ts`, each panel merged into one entry.
- `src/diff/review.ts` (change list — by project when it spans several —, search, j/k order, one
  project and its neighbourhood, marks; V105: a stylesheet of changed rules is one item,
  `reviewItems`, for the progress, j/k and one mark), `detail.ts` (excerpts, diff rows; V103: a signature's
  word diff and its fold, a wrapped line's indent; the panel's code wraps under `.symbol-code`,
  because `.code` and `.row` are the Files page's and Git's too),
  `comments.ts` (draft comments and anchors), `store.ts` (server or browser state).
- `src/history/commits.ts` (**pure**: picking, which end is the base, diverged picks' fork point found from
  the shape (V10c; checked against git by `scripts/viewer/compare-check.mjs`), the label, reading `api/graph`'s
  202/502/404 while a diff is analyzed), `HistoryPage.tsx` (the Git page; never `Commits.tsx` beside `commits.ts`: macOS file systems ignore case; its sections `GitHead`, `CommitsHead`, `CommitList`, `GitDetailsPane`, its menus and dialogs `GitMenus.tsx`, a hook per unit of its state, `use*.ts`), its calls in `api.ts` (the diff's page imports `startDiff` and `fetchGraph` from there), `CommitRow.tsx`, `CompareBar.tsx`. A diff's progress is `diff/DiffProgress.tsx` (V90: the steps as a timeline with their times as the page saw them, `analysis-steps.ts`, pure, the clock kept by `useDiffGraph`; the files from the pair and a workspace's report, commits and brief beside them).
- `src/history/` since V66 (the Git page): `git-api.ts` (`/api/git/…`: a commit, the changes, the
  upstream, a search, git's writes), `details.ts` (**pure** but for the pane's place, kept in the
  browser as the theme is: lines, the changes' words, why Commit is off, the upstream in words, a
  search's next match; `test/details.test.ts`), `CommitDetails.tsx` and `ChangesDetails.tsx` (the
  pane), `GitDiff.tsx` (a file's diff with the Files page's `parseFileDiff`/`foldRows`),
  `RefDialog.tsx`, `SyncBar.tsx`, `FindBox.tsx`. The uncommitted row is row −1, above the list: the
  rows' math (`list.offsetTop`) already places the list under whatever is above it. A file clicked
  in the pane shows in the rows' place (V70, `GitFile.tsx`, `.git-shown`): a layer over the rows'
  card, the rows mounted and `inert` under it, so their scroll and cursor are kept; the commit's
  read and the uncommitted lines are the page's (`useCommitRead`, `useChangesRead`), shared by the
  pane and the layer. Its Open in VS Code is `POST /api/git/open` (VS Code's diff editor).
- `src/graph/ProjectNode.tsx`, `FileNode.tsx`, `SymbolNode.tsx`, `SummaryNode.tsx`,
  `StylesheetNode.tsx` (V105: a stylesheet's changed rules as one card).
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
  workspace's agent and shells, Nucleus, Scribe; `MergeLog.tsx` the merge log's. xterm opens in a
  box with no padding (`.agent-terminal-fit`, `.merge-terminal-fit`), the padding on the box
  around it: the fit add-on counts the rows from the height of the box xterm is in, padding
  included (border-box), and drew up to 8 px more than the box held, which made the scrolling
  Scribe pane's scrollbars come and go every frame. `e2e/terminal-fit.spec.ts` checks it with
  real scrollbars: headless Chromium hides them, and the loop needs one that takes room.
- A workspace's page (`src/workspaces/Workspace.tsx`, V89; its head `WorkspaceHead.tsx`, steps card
  `WorkspacePipeline.tsx`, terminals `TermPanes.tsx`, side card `SideCard.tsx`; its shells, answers
  and actions the hooks `useShells`, `useRespond`, `useWorkspaceActions`): its steps in the head
  (`HeadSteps.tsx`) and the bar under the terminal (`TerminalBar.tsx`) are derived by pure modules,
  `workspace-steps.ts` and `terminal-bar.ts` (tested per state, both modes): what Symbiote records,
  never guessed; the bar shows only keys measured on a real session (Enter and Esc for Claude
  Code's permission prompt) and never a button that answers the agent's prompt. The terminals sit
  in `.term-panes`, the agent's pane first at one place in the tree, so Split (`&split=<n>`) and
  Focus only resize it: a remount would attach the agent again (a Claude Code process each).
  Focus folds the sidenav through the shell's `setFocused`, the person's fold untouched; it is
  kept in the browser. Approve plan and Send reply with a terminal go through
  `OpenedTerminal.submit` (typed once its input is drawn, Enter its own write): typed before, the
  Enter is lost.
- `src/overview/` — the Overview (V91, decisions 848–859), at `/overview`, the page `/` opens,
  key `t`: `OverviewPage.tsx` draws `NormalOverview.tsx` or `HiveOverview.tsx` by `useHive()`.
  Everything shown is derived by **pure** modules from what is recorded, tested per state:
  `day.ts` (today is the browser's local calendar day; a week's days stepped by the calendar, never
  24 hours: tested in two time zones and over a 25-hour day), `normal-overview.ts` (the inbox and
  its one action a workspace, the figures, merges this week), `hive-overview.ts` (in flight,
  stopped, landed today, the five figures, spend since midnight), `feed.ts` (today's events). The
  list's read is `useWorkspaces`' as everywhere; `useDay.ts` reads `/api/workspaces/day?since=`
  (local midnight six days back) on mount, when the list's read shows something moved, and at
  midnight, never on a timer of its own. An inbox row's action is the existing one: `respondTo`,
  `openReview` (`workspaces/review-open.ts`, the head's too), `MergeControl`; Turn off Hive is
  `settings/HiveOff.tsx`, Settings' too. The usage is one reader for the page and the status bar
  (`shell/useUsage.ts`). The kits' figure, table, feed, facts and gauge are shared parts
  (`ui/Figures.tsx`, `ui/figures.css`). `e2e/overview-data.ts` holds the proofs' records for
  `page.route` (`manyRows`: each list longer than its card), used by `overview.spec.ts` and
  `page-frame.spec.ts`. The page never scrolls (fix/overview-fits-the-page, `Overview.css`'s
  head says how): each list scrolls in its `OverviewCard`'s body; a list card of two rows or more
  is cut to a head and 1.5 rows before the inbox (Hive: in flight) loses one, the last card of a
  column takes the rest, and only a column whose minimums do not fit scrolls. A column's minimum
  cannot be said in CSS (a flex column's is its content's): a grid row cut under it drew its cards
  over the next.
- Hive mode's own pages (V92, decisions 860–874), each from what Hive records, the derivations
  pure and tested: a Hive workspace's **Run** tab (`workspaces/HiveRunTab.tsx`, `View` `'run'`,
  `&run`; `&review` still opens it, `tab-address.ts`) draws `run-timeline.ts`'s rounds (the
  writer's commits split at each check's commit, from the changes read the side card shares) and
  puts `RunFacts` first in the side card; the sidenav's In flight, Stopped, Landed today, Earlier
  (`shell/HiveSidenav.tsx`, `hiveGroups`/`hiveRowWords` in `workspace-groups.ts`); Settings' Hive mode
  page as grouped rows (`settings/HivePage.tsx`; the reviewer's model and effort are set there, not
  on its Reviewer page); Start's New goal (`workspaces/StartHive.tsx`); the question
  (`settings/HiveQuestion.tsx`, its readiness `hiveReadiness` in `hive-switch.ts`). The arrival
  (`shell/hive-arrival.ts`, `ui/hive.css`) is one View Transition: the new root revealed through
  one clip-path, the question, its dim, the Mind, its glow and the ring layers of their own moved by
  opacity and transform only; `e2e/hive-pages.spec.ts` refuses a `filter` or `width` among its
  keyframes. The transition and its layers end at 1.18 s, the arrival at 1.54 s: each live
  element goes out where its layer ends (`hive-folded`), or it is drawn again until `close()`
  (fix/hive-question-reappears; the same spec samples every 50 ms from 550 to 1700 ms). Keep the ring a small layer scaled up (480 px): one the window's size dropped 3–5
  frames of the reveal in the app's software compositing.
- `src/monitor/` — the Monitor (RM1), at `/monitor` (absolute `/api/monitor`, the `CodeMap` of
  `@symbiote/monitor`, whose **types** only it imports). `codemap.ts` builds the folder tree of the
  kinds turned on, says the concentration in words and gives a file's heat step by its lines
  (`HEAT`, `heatOf`, RM2); `treemap.ts` lays a folder out (squarified, frames nested while they
  have room, six levels at most, small files merged, each tile's level-1 `section`). Both pure,
  tested in `test/codemap.test.ts` and `test/treemap.test.ts`; a layout costs 0.4–2.4 ms on real
  repositories, so it runs on the main thread (unlike the graph's), again on resize, never on
  hover, selection or colour (those are classes). The component is `TreemapView.tsx`: never
  `Treemap.tsx` beside `treemap.ts` (one name on macOS; `test/files.test.ts`).
- `src/issues/` — Issues (IS1, decisions 944–952), at `/issues` (absolute `/api/issues`,
  `/api/issues/<n>`; the issue read in `?number=`), key `u`. The types are core's (`IssueSummary`,
  `IssueListAnswer`…); the forge package reads them. An issue's text is anyone's: `issue-text.ts`
  turns the HTML marked finds into text, links and breaks before `ui/markdown.ts` draws it (no
  HTML string, images never loaded); `test/issue-text.test.ts` and `e2e/issues.spec.ts` feed it
  hostile text. The e2e serves the fake forge of `packages/forge/test/fake-forge.ts`, with issues.
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
- The page frame (V72): `src/ui/PageHead.tsx` is every page's head (its icon, title, the line
  under it, its actions; an `end` after them that stays on the title's line at every width, V76c: a
  diff's Files and Graph) and `src/ui/page.css` its rules and a card's head (`.card-head`,
  `--card-head`).
  A page's margins, gutters, card insets and form rhythm come from the layout tokens on `:root`
  (`--page-pad`, `--page-gap`, `--card-pad`, `--card-head`, `--field-label-gap`, `--field-gap`),
  not from px values of its own; a `Resizer` between two cards takes `gutter`. `e2e/page-frame.spec.ts` measures every page: a new
  page uses `PageHead` and the tokens, and joins that spec.
- The redesign's shared parts (V88): a state is `ui/StatusLabel.tsx` (an icon and a word, tinted:
  never colour alone), a workspace's steps `ui/StageTrack.tsx` (hexagons on a line), both styled
  in `ui/status.css`; every card's head takes `.card-head` with its own class beside it. A card's
  ground is `--panel`, the chrome's `--side`; amber (`--run`) is the agent's turn, violet (`--you`)
  the person's, `--warning` a real warning only (guards in `test/tokens.test.ts`).
- Tooltips (V54): never a `title` (the window system draws it: square, its own font, no theme);
  an element gets `{...tip(text, { keys, side, tone, code })}` (`src/ui/tip.ts`) and the one
  `Tooltips` (`src/ui/Tooltip.tsx`, mounted in `main.tsx`) draws it: one listener on the window,
  never one per element. `test/tooltips.test.ts` fails on a `title` or an SVG `<title>`; a third
  party's (React Flow's `Controls`) is replaced (`diff/Canvas.tsx`). Explanation stays `Help`.
- Colours are tokens on `:root` (dark) and `:root[data-theme='light']` in `src/ui/base.css`,
  contrast tested by `test/tokens.test.ts` (which reads every `.css` under `src/`);
  `src/shell/theme.ts` and `index.html`'s inline script set the theme. Text sizes are the
  `--size-*` scale on `:root` (V87: 15 px body, nothing under 12 px), never a px value, and a line
  height is its size and a leading, never px: the same test fails on either. Settings' text size
  (`src/shell/text-size.ts`, `data-text-size` set by the same inline script) moves the scale a
  step. Targets are 24 px or spaced (WCAG 2.2's 2.5.8): `e2e/targets.spec.ts` checks every page.

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
- **Every page fills the main area** (V72, decision 507): no `max-width` or centring of a page,
  nothing added above it on a tall window. A text that would read too wide fills its card.
- **A page in parts** (refactor/viewer-pages, decisions 955–957): the page's component keeps the
  state its parts share and draws them; a section is a component named after what it draws, a unit
  of state with the effects only it uses a hook (`use*.ts`) called where its code was, so effects
  keep their order; pure derivations go to pure modules by topic, with a test. Pure modules import
  one way, types included: no cycle (`workspaces.ts`' names at the bottom).
- **Layout never depends on selection or review state.** Only `decorate` does; the view to lay
  out depends on the graph and the view toggles. Clicking or marking must not move anything (V6:
  this took marking from 1.2 s to 72 ms on a 1,288-symbol graph).
- Layouts are made off the main thread (V8e, `useLayout`): never call `layoutFlow` from a
  component. A layout arrives later: the last one stays drawn (`pending`), and anything that
  moves the view for a new layout (fitting a project, the focus, a group) waits until it is
  drawn. What crosses to the worker is structured-cloned: options and layouts stay plain data
  (Maps, Sets, no functions).
- Stylesheets (V105, decisions 979–980): a file whose changed symbols are all stylesheet symbols,
  two or more (`stylesheetFiles`), is one card, `rules:<file>`, unless `expanded` holds it. Its
  symbols leave the layout before anything else is decided (`foldStylesheets`): their links
  become the card's, one per neighbour and direction with the `count` they stand for, and its
  neighbours are grouped as a changed symbol's. Opened, the card stays beside its rules to close
  them. A pick inside a closed card rings it (`decorate`) and the canvas brings the card into view
  (`drawnAs`); it never opens it (no `hidden` entry), but Focus on it does (`layoutView`). With no
  such file the layout is exactly main's: `test/__snapshots__/layouts-without-stylesheets.json`,
  and `scripts/viewer/layout-compare.mjs` on real graphs against another build.
- Big graphs: neighbourhoods over `NEIGHBOUR_LIMIT` (8) become summary nodes; below zoom 0.45
  (`MAP_ZOOM`, `src/graph/mapzoom.ts`) the canvas is a map (CSS class `map`), React Flow draws only
  on-screen nodes (`onlyRenderVisibleElements`).
- Map labels keep fixed sizes and are scaled by `transform: scale(1 / var(--symbiote-zoom))`; the
  variable is written by `mapZoomStyle` into a one-rule stylesheet for the labels only, and only
  on the map (V8a). Never set it on the page root or change a font size with the zoom: either
  restyles or re-lays out thousands of elements on every zoom frame. A file name is cut to its
  box at `--symbiote-cut`, the zoom once it rests (`CUT_REST_MS`): a cut is laid out, so never
  on every frame (1.1 ms a frame on Bitwarden's map; fix/hive-turn-end-flaky-tests-verdict).
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
  `onMoveStart` (which comes with every click). The selected symbol's edges are drawn above every
  node (V90, `decorateEdges`: `RAISED_EDGE_Z`, `.edge-raised` with no pointer, so a node under one
  keeps its click), each a layer of its own (`will-change`, V101: a dotted path was painted again
  on every frame of a move, 0.67 → 1.54 s for a drag); only they change identity on a selection.
  The type references the toggle hides are carried between drawn symbols in a list of their own
  (V101, `hiddenEdges`), made after placement so they move nothing; only the selected symbol's
  reach React Flow, as its own edges (never React Flow's `hidden: true`: it still checks those
  every frame). Focus lays out type references whatever the toggle (`layoutView` in
  `diff/review.ts`); the panel's "not on the canvas" is `onCanvas`: drawn, or in the pick's own
  summary.
- A graph node (V90, `SymbolNode`) is a neutral card: the kind of change is a mark (`kindMark`),
  findings one count (`findingCount`), never a tinted ground or coloured name; `--tone` stays for
  the map's blocks and the marks.
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
