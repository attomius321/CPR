# Journal: Phase 2, the viewer (V1–V5)

[Index](../JOURNAL.md) · [Plan](../plan/roadmap.md#phase-2-milestones-viewer)

## V1 — Viewer app (2026-10-01)

**What landed**
- `packages/viewer`: Vite 8 + React 19 + `@xyflow/react` 12 + `@dagrejs/dagre` 3. Loads a graph
  from `?graph=<url>`, from `./api/graph` (for `symbiote view`), or a dropped/chosen JSON file.
- `toFlow(graph, { typeReferences, context })` (pure, unit-tested on the engine's golden graphs):
  symbols colored by tone (added, removed, modified, moved, context, external, unknown), delta
  tags, finding badges, edges styled by side (added green, removed dashed red, kept gray) and
  kind (type references and unknown calls dotted). Type references hidden by default
  (decision #3); context can be hidden.
- Symbols are boxed by file (packages and dynamic calls get their own boxes).
- Root `pnpm build` now also builds the viewer.

**Discoveries**
- dagre's compound-graph layout let clusters overlap (nodes of other files inside a file's
  box). Replaced with a **two-level layout**: each file's symbols laid out alone, then the boxes
  as nodes connected by cross-file edges. Boxes can't overlap by construction.
- React Flow 12: `colorMode="system"` themes controls/minimap for dark mode; children of a
  parent node are positioned relative to it and must come after it in the nodes array.
- dagre node labels are `any` after layout; a small typed `placement()` helper keeps lint clean.
- Edge labels made big graphs unreadable; kind is encoded by line style instead.
- Screenshots via Playwright with the preinstalled Chromium
  (`executablePath: '/opt/pw-browsers/chromium'`; the bundled revision doesn't match
  `@playwright/test` 1.63).

**Observed**
- A real ky commit (25 changed symbols, 58 context) is readable when zoomed, but the overview
  is dense → V4 adds focus (jump to finding, neighbourhood only).

## V2 — `symbiote view` (2026-10-01)

**What landed**
- `symbiote view <base> [head] [--port] [--no-open]`: runs the same analysis as `diff`, serves the
  built viewer + `/api/graph` + `/api/source` on `127.0.0.1`, opens the browser, stops on
  Ctrl+C. Startup line: `15 files · 25 symbols changed · 3 findings` + URL.
- `startViewServer` (testable without a CLI process): static files confined to the viewer
  folder (`..` and `%2e%2e` refused), sources only for files the graph mentions, read with
  `git show <sha>:<path>` (`readFileAtRevision` in core).
- `CliContext` gained `openUrl` and `waitForExit` so tests drive the long-running command;
  `SYMBIOTE_VIEWER_DIR` points at another viewer build (tests, development).
- `diff` and `view` share option parsing and the analysis call.

**Decisions**
- Bind to `127.0.0.1` only and never serve arbitrary files: the server holds the repository's
  source.
- Context nodes carry only their head side, so base sources are served only for files that
  changed (or base-side symbols).

**Verified**: `symbiote view` on a ky commit served the viewer, the graph and the head/base sources.

**Gotcha**: `pkill -f "bin.js view"` also matches the shell running the command; kill by PID.

## V3 — Symbol detail panel (2026-10-01)

**What landed**
- Clicking a symbol opens a side panel: kind, status and delta tags, file (and where it moved
  from), findings about it and findings that mention it, old/new signature, a **line diff of
  just that symbol** (both line numbers, common indentation removed, tabs at width 2), and its
  users and callees as links that select and center the other symbol. Esc or a click on the
  canvas closes it.
- Pure helpers with tests: `symbolDetail` (neighbours by edge side, findings, mentions),
  `excerpt` (range → whole lines, dedented), `diffRows` (unified rows via the `diff` package).
- Sources come from `symbiote view`'s `/api/source`, fetched once per side and file; a graph opened
  from a file shows a hint instead.

**Verified end to end** (Playwright + Chromium against a real `symbiote view` on ky): an added method
shows its code as all-added rows; a modified method (`Ky.#retry`) shows the removed type
parameter in the signature and the exact changed lines.

**Gotcha**: Prettier collapses short import lists to one line, so scripted string edits of
`App.tsx` stopped matching; rewriting the file whole was simpler and clearer.

## V4 — Review flow (2026-10-01)

**What landed**
- Sidebar with two tabs: **Changes** (changed symbols in reading order, grouped by file, each
  with a "reviewed" checkbox and a progress bar `2/25`) and **Findings** (by severity; a click
  selects the symbol). Opens on Findings when there are any.
- Reviewed marks persist in `localStorage` per revision pair (`symbiote:reviewed:<base>..<head>`), so
  a new push starts fresh; storage failures (private windows) degrade to session-only.
- **Focus** mode (toggle or `f`): only the selected symbol and its 1-hop neighbourhood.
- Keyboard: `j`/`k` next/previous change, `r` toggle reviewed, `f` focus, `Esc` close. Ignored
  while typing in inputs.
- Detail panel: "Mark reviewed" button; classes and namespaces list their **changed members**
  instead of dumping their whole body; diffs longer than 300 lines collapse behind "Show all".
- Reviewed symbols are dimmed with a ✓ in the graph.

**Bugs caught by end-to-end screenshots**
- Focus left the canvas empty: React Flow's `fitView` prop only applies on mount. Re-fit after
  the node set changes, one animation frame later (nodes must be measured first).
- Selecting a class showed its entire body (1,000+ lines in ky's `Ky`); its members are
  separate symbols, so the class shows its changed members instead.

## V5 — Viewer dogfood (2026-10-01)

**What landed**
- Playwright end-to-end suite (`pnpm test:e2e`, `packages/viewer/e2e`): builds a git repo from
  the detectors fixture (base and head commits), starts the built `symbiote view`, and checks the
  summary badges, node tones, finding → panel → code diff → neighbour navigation, `j`/`k`/`r`
  with reviewed marks surviving a reload, and focus mode. Any page error fails a test.
- CI runs it on the Linux / Node 24 job (`playwright install --with-deps chromium`); locally the
  preinstalled `/opt/pw-browsers/chromium` is used when present.
- File box labels truncate from the start (`…/v4/mini/index.ts`), keeping the file name.

**Viewer performance on real commits** (headless Chromium, 4 cores)

| Commit | Symbol nodes | First render | Click → panel | Focus toggle |
|---|---|---|---|---|
| zod 413cce9a | 212 | 510 ms | 309 ms | 88 ms |
| vite 744269e5 | 192 | 432 ms | 214 ms | 111 ms |

The analysis (~7 s) dominates `symbiote view` startup; the UI itself is fast at this size.

**Observed while reviewing**
- Test files often show up as `… (top level)` users of a changed signature (describe/it blocks
  are module-level code). Informative, but they inflate "untouched" counts; a later option
  could separate test users.
- Closing the panel keeps the zoomed viewport; the fit-view button returns to the overview.
