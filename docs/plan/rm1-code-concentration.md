# RM1 — Code concentration: where a repository's code is

[Index](../PLAN.md) · [Journal](../journal/rm1-code-concentration.md)

**Status:** merged into `main` on 2026-10-24 (built 2026-10-24), on branch `feature/repo-monitoring` (a workspace
started in Symbiote, from `main` at `561826d`); the plan and its three choices OK'd by the person
("1. Yes 2. current checkout ed HEAD 3. Good .. at the end, for RM2, i will create another feature
that continue it. OK"). As built and results under "As built (RM1)" below.

**Problem** (asked: "I need a new feature from where i can see each files from the repo, by code
concentration. I need a good way to visualize this, do some research on how we can represent it
easy for the human. This should be in another package, like repo monitoring or something").
Symbiote shows a change, never the repository it lands in: nothing says which folders and files
hold the code, or how unevenly. Measured in the RM1 spike at each repository's `HEAD` (this one at
`561826d`; vite, Qwik and Bitwarden's clients cloned at depth 1 on 2026-10-24), with a script that
reads every file from git objects:

| | Symbiote | vite | Qwik | Bitwarden |
|---|---|---|---|---|
| Files (blobs at `HEAD`) | 1,110 | 2,904 | 4,907 | 9,583 |
| Code files (by extension) | 700 | 2,079 | 2,899 | 8,037 |
| Lines of code in them | 81,873 | 101,382 | 319,776 | 829,874 |
| … of which in tests | 42 % | 31 % | 26 % | 37 % |
| Lines in data files (JSON, YAML…) | 6,216 | 8,209 | 45,604 | 2,285,516 |
| Lines in lockfiles | 2,624 | 14,040 | 27,355 | 56,890 |
| Half the code is in | 62 files (9 %) | 67 files (3 %) | 177 files (6 %) | 783 files (10 %) |
| The largest 10 % of files hold | 53 % | 77 % | 60 % | 51 % |
| The largest code file | `packages/cli/test/workspaces.test.ts`, 2,730 | `packages/vite/src/node/plugins/css.ts`, 3,025 | `packages/qwik-dom/lib/HTMLParser.js`, 7,976 | `libs/common/src/platform/misc/wordlist.ts`, 7,778 |
| Files a 1200 × 700 px treemap of the whole repository can label (≥ 70 × 20 px) | 174 | 141 | 100 | 28 |
| … and draws smaller than 4 × 4 px | 29 | 602 | 246 | 1,964 |
| Reading every blob (`ls-tree` + one `cat-file --batch`) and counting | 103 ms | 93 ms | 207 ms | 769 ms |

So:

1. **Code is concentrated**: 3–10 % of the files hold half of it, everywhere measured. That is
   the thing to show, and it can be said in one sentence.
2. **What counts decides the picture.** Tests are a quarter to two fifths of the code; Bitwarden's
   data files (its `messages.json` translations) have 2.8× more lines than all its code; the
   largest "code" files are a test, a vendored HTML parser and a word list. Counting everything
   alike would show the wrong concentration.
3. **One picture of the whole repository cannot show files**: at Bitwarden's size a full-window
   treemap labels 28 files and draws 1,964 smaller than 4 × 4 px. The picture has to start at
   folders and let one zoom in, with a list beside it for exact numbers.
4. **Reading is cheap**: under a second for 9,583 files from git objects, no checkout and no
   TypeScript program.

**Goal**: a **Monitor** page in Symbiote's sidenav (`/monitor`, key `m`) that shows where the
code of the checkout's last commit is: a sentence or two of concentration in plain words, a
treemap of the folder in view (area = lines of code) one can zoom into folder by folder, and a
ranked list beside it with the exact numbers. Its engine is a package of its own,
`@symbiote/monitor`. Unchanged: every other page, `symbiote diff`/`pr`, the graph JSON and the
analysis (nothing in `packages/core` changes).

## How to show it: what the research says

The question a person brings is "where is the code, and how much of it is where?": a hierarchy
(folders) with one size per leaf (lines). The candidates:

| Picture | Good at | Bad at | Verdict |
|---|---|---|---|
| **Squarified treemap** (Shneiderman 1992; Bruls, Huizing, van Wijk 2000), as disk tools (WinDirStat, SequoiaView) and bundle analyzers (webpack-bundle-analyzer) draw it | Uses every pixel; "what is big" at a glance; developers know it from bundle analyzers | Deep hierarchy is hard to read in it (Woodburn et al. 2019: slower, less accurate on hierarchy tasks than icicle plots) | **The picture**, two levels at a time, with breadcrumbs carrying the hierarchy |
| Circle packing (CodeScene's and Tornhill's hotspot maps, GitHub Next's repo-visualizer) | Folders read clearly as nested circles; pretty | The gaps between circles waste area and every nesting level shrinks the files further; areas are judged poorly in general (Cleveland & McGill 1984); a write-up of repo-visualizer notes it struggles with larger repositories | No |
| Sunburst / icicle | Hierarchy and depth (Stasko et al. 2000; Woodburn et al. 2019) | Angles compare poorly; outer rings of a large tree are slivers | Not for sizes; the breadcrumb and list do the hierarchy |
| 3D city (CodeCity) | Memorable | Occlusion, navigation; nothing reads exactly | No |
| Ranked bars / list | Exact comparison: position and length are read best (Cleveland & McGill 1984) | No overview of the whole, no structure | **Beside the treemap**, linked to it |
| Lorenz curve, Gini coefficient | The economists' measure of concentration | Few people read them | No: the same fact said as a sentence |

Rules taken from it:

- **Overview first, zoom and filter, then details on demand** (Shneiderman's mantra): the folder
  in view as a treemap; click a folder to zoom in, breadcrumbs to go back; hover or select a file
  for its numbers.
- **Rectangles that are near squares, not exact squares, and never slivers** (Kong, Heer, Agrawala
  2010: area judgments are worst for extreme aspect ratios, and also for exact squares). The
  squarified layout gives that.
- **Exact numbers in a list, not in the picture**: the treemap shows proportion, the list beside
  it ranks and gives lines and shares.
- **Concentration in words**: "Half of the code is in 62 files (9 %)" reads at once; a Gini of
  0.71 does not.

Sources: [Kong, Heer, Agrawala 2010](https://idl.uw.edu/papers/perception-treemaps);
[Bruls, Huizing, van Wijk 2000](https://diglib.eg.org/handle/10.2312/VisSym.VisSym00.033-042);
[Woodburn, Yang, Marriott 2019](https://arxiv.org/abs/1908.01277);
[Stasko et al. 2000, as summarized](https://faculty.cc.gatech.edu/~stasko/7450/16/Notes/tree2.pdf);
[CodeScene hotspots](https://docs.enterprise.codescene.io/versions/4.0.1/guides/technical/hotspots.html);
[GitHub Next's repo-visualizer](https://flowingdata.com/2021/08/10/visualizing-github-repos/)
and [a write-up of it](https://dev.to/integerman/repository-visualization-with-github-next-3j33).

## The page

```
 Monitor · Code concentration                                      main · 561826d
 [■ Source 47,420] [□ Tests 34,453] [□ Docs 21,131] [□ Data 6,216] [□ Set aside 9,130]

 Symbiote / packages                                    (Backspace: up)
 47,420 lines of code in 412 files. Half of it is in 31 files (8 %);
 the largest 10 % of files hold 49 %. viewer holds 44 %.

 ┌ viewer · 44 % ──────────────────┬ cli · 34 % ─────────────┬ core · 15 % ─┐  In packages  · Largest files
 │┌ src ───────────────────────────┐│ workspaces.ts │ server.ts│ src         │  viewer    ████████  20,860  44 %
 ││ workspaces │ diff    │ history  ││   2,698       │  1,680   │             │  cli       ██████    16,120  34 %
 ││            ├─────────┼──────────┤├───────────────┼──────────┤             │  ── half of the code ──────────
 ││            │ shell   │ graph    ││ main.ts       │ merges.ts├─────────────┤  core      ███        7,110  15 %
 │└────────────┴─────────┴──────────┘│               │          │ desktop ·4 %│  desktop   ▌          1,900   4 %
 └──────────────────────────────────┴───────────────┴──────────┴─────────────┘  …
```

(The numbers in the sketch are made up for the drawing; the measured ones are in the Problem
table.)

- **Header**: the commit read (its branch and short SHA) and one chip per kind of file, each
  with its lines; Source is on, the rest off. A chip turns its kind on or off and is also the
  legend: a tile has its kind's colour.
- **Headline**, for the folder in view: lines and files; "Half of it is in N files (x %)"; "the
  largest 10 % of files hold y %"; the child folder holding the most and its share. Hovering
  "lines of code" says what counts (not blank, not only a comment).
- **Treemap** of the folder in view, two levels deep: each child folder a frame with a name band
  (name, share), its own children inside as tiles (files with their name and lines when they
  fit; sub-folders as one tile with their name). A folder with a single child folder and no files
  is shown as one name (`src/main/java`), as VS Code's compact folders. Files too small to draw
  (under 24 × 16 px) are one "N smaller files" tile per folder. A click on a frame's band or a
  folder tile zooms into it; breadcrumbs and Backspace go up; the folder is in the address
  (`/monitor?path=packages/viewer`) so back, forward and reload keep it.
- **List**, beside the treemap (resizable, V34's `Resizer`): "In this folder" ranks the folder's
  children by lines, each with a bar, its lines and its share, and a "half of the code" line
  where the running share passes 50 %; "Largest files" ranks every file under the folder (the
  top 50). Hovering a row lights its tile, and the other way round; arrows and Enter work as in
  the sidenav.
- **Details on demand**: hovering a tile or a row shows its path, language, lines of code,
  comments and blank lines, and its share of the folder and of the repository; a selected file
  has "Open in VS Code" (V12's editor, at the commit read, line 1).
- **States**: reading ("Reading 9,583 files…"), nothing of the kinds on, an error with its
  message.

Drawn with Symbiote's style (`symbiote-style` skill): tiles are DOM elements absolutely placed
(text ellipsis, focus, hover and both themes by CSS tokens), not SVG or canvas; the tile count is
bounded by the two-level rule and the small-files tile.

## The package: `@symbiote/monitor` (`packages/monitor`)

A Node package like `@symbiote/forge`: ESM, `dist/`, depending only on `@symbiote/core` (its git
runner, which takes no optional lock, and `.symbioteignore`'s matcher). No new runtime
dependency. The viewer imports only its **types**.

- **`scanCodebase(repo, rev = 'HEAD'): Promise<CodeMap>`** — resolves `rev` to a commit, lists
  the tree (`git ls-tree -r -z -l <sha>`), reads every blob in one `git cat-file --batch`, asks
  `git check-attr -z --stdin linguist-generated linguist-vendored` once for all paths, and
  returns:

  ```ts
  interface CodeMap {
    version: 1;
    commit: string; // the full SHA read
    branch?: string; // HEAD's branch, when on one
    files: CodeFile[];
  }
  interface CodeFile {
    path: string; // repo-relative POSIX
    kind: 'source' | 'test' | 'docs' | 'data' | 'other' | 'aside';
    /** Why a file is set aside. */
    aside?: 'binary' | 'lockfile' | 'generated' | 'vendored' | 'symbioteignore' | 'minified';
    language: string; // 'TypeScript', 'CSS', … or 'Text'
    lines: number;
    code: number;
    comments: number;
    blank: number;
  }
  ```

  Symlinks and submodules are left out (they are not this repository's code). The viewer builds
  the folder tree from the flat list.
- **Kinds**, first match wins, each explainable in the tooltip: set aside (binary — a NUL in the
  first 8,000 bytes, as git decides —, a known lockfile, `linguist-generated`/`linguist-vendored`
  in `.gitattributes`, `.symbioteignore` and its defaults (fixtures, examples, playgrounds,
  generated), `*.min.*`); test (`*.test.*`, `*.spec.*`, `*_test.go`, `test_*.py`, or under a
  `test`, `tests`, `__tests__`, `e2e` or `spec` folder); docs (Markdown, MDX, reStructuredText,
  AsciiDoc, plain text); data (JSON, YAML, TOML, XML, CSV, SVG); source (a programming,
  style or markup language in the table); other. A person changes the result with
  `.gitattributes` or `.symbioteignore`, the files these rules already come from.
- **Counting lines** (`count(text, language)`): a line is blank, a comment (only a comment), or
  code (anything else, a trailing comment included) — cloc's and scc's rule. Per-language comment
  and string syntax in one table: C-like (`//`, `/* */`; strings `'`, `"`, and template literals
  across lines) for TS/JS, Java, C, C#, Go, Rust, Kotlin, Swift, Dart; CSS (`/* */`) and SCSS/Less
  (`//` too); HTML, XML, Vue, Svelte (`<!-- -->`); `#` for Python (and `"""`/`'''` docstrings as
  comments when they stand alone), shell, Ruby, YAML, TOML; `--` for SQL. Strings are tracked so
  that `'src/**/*.ts'` does not open a comment. A language not in the table: every non-blank
  line is code. Text that is not UTF-8 is counted by its newlines.
- **Cache**: by commit SHA, the last 4 commits in memory: a commit's files never change. A page
  opened again on the same `HEAD` answers from memory.

## Server and CLI

- `packages/cli` depends on `@symbiote/monitor`. `RepositoryOptions.monitor?: MonitorService`
  (`{ map(): Promise<CodeMap> }`, `HEAD` of the checkout `symbiote view` serves), wired in
  `main.ts` beside Skills.
- `GET /api/monitor` — the `CodeMap` (absolute, like `/api/history`); `/monitor` serves the
  site; `POST /api/monitor/open` — a file at the commit read, opened in VS Code through the
  existing `open` option (V12).
- No new command: `symbiote view` shows the page.

## Viewer (`packages/viewer/src/monitor/`)

- `pages.ts`: the route `{ page: 'monitor'; path?: string }`, `MONITOR_PAGE = '/monitor'`;
  the sidenav's link after Skills, with `m`; the title "Monitor".
- `codemap.ts` (**pure**): the folder tree from the files and the kinds on, compact folders,
  each node's lines and share, the headline numbers (files holding half, the largest 10 %'s
  share, the leading child), the list's rows and its "half" line.
- `treemap.ts` (**pure**): the squarified layout (Bruls et al.) of a folder's two levels in a
  given rectangle, with name bands and the small-files tile; a stable order (by lines, then
  path), so a reload draws the same picture.
- `MonitorPage.tsx`, `Treemap.tsx`, `CodeList.tsx` and their CSS, listed in `styles.css`.
  The layout runs again on resize (a `ResizeObserver`); measured first, it moves to a worker only
  if it costs over 16 ms on Bitwarden.

## Verification

1. **Tests first** (red before):
   - `packages/monitor/test/count.test.ts`: each language's blank, comment and code lines on
     small texts written for it, including the traps: `/*` and `//` inside strings and URLs, a
     template literal over several lines holding `//`, a comment-only line inside a block, a
     trailing comment on code, CRLF endings, no final newline, a Python docstring, HTML comments
     in a Vue file.
   - `kinds.test.ts`: each kind and each set-aside reason, first match wins, `.gitattributes`
     and `.symbioteignore` honoured.
   - `scan.test.ts` on real git repositories made by the test: the commit read, nested paths,
     symlinks and a submodule left out, a binary file, non-UTF-8 text, the cache.
   - `packages/viewer/test/codemap.test.ts` and `treemap.test.ts`: tile areas proportional to
     lines (within 1 px²), every tile inside its frame, no overlaps, no tile under the minimum
     (merged), worst aspect ratio under 4, the same input giving the same layout, headline
     numbers on hand-checked trees.
   - `packages/cli/test`: `/api/monitor` answers the map, `/monitor` the page.
2. **Counts against an established tool**: `cloc` (run with `npx`, not a dependency) on this
   repository and vite, per file; TypeScript, CSS and Markdown expected identical; every other
   difference listed and explained in the journal.
3. **E2E** `e2e/monitor.spec.ts` (a repository the spec makes): the sidenav link and `m`, the
   headline, tiles, the tooltip, a folder zoomed into and back (breadcrumb, Backspace, the
   browser's back), the list linked to the tiles, Tests turned on, no page errors.
4. **Real repositories** (this one, vite, Qwik, Bitwarden): the page at 1440 × 900, scale 1, both
   themes, screenshots in the journal; every page and state of the shell checked for uneven
   spacing (the sidenav gains a link).
5. **Cost**: Bitwarden's map in ≤ 2 s cold and ≤ 50 ms warm; its JSON ≤ 1.5 MB; layout ≤ 16 ms
   per resize; tiles drawn ≤ 1,500; History's first paint unchanged (`viewer-check`).
6. **Nothing else changes**: `pnpm check`, `pnpm build`, every e2e spec. No analysis code is
   touched, so `regression-check` is not needed; the diff will show `packages/core` untouched.

**Risks**

| Risk | Mitigation |
|---|---|
| Our line counts differ from known tools and lose trust | The cloc comparison; the rule shown on the page; a language we cannot parse is counted as non-blank lines, said in its tooltip |
| A file in the wrong kind (a vendored parser counted as source, like Qwik's `HTMLParser.js`) | Kinds only from rules a person can read and change (`.gitattributes`, `.symbioteignore`); the reason in the tooltip; no guessing from content |
| A very large repository (100,000 files) | Measured cost is linear (Bitwarden 0.8 s for 9,583 files); the page says it is reading; the tile count is bounded |
| Tiles too small to read | Two levels at a time, the small-files tile, the list with every number |
| The treemap hides the hierarchy (Woodburn et al.) | Breadcrumbs, frames with name bands, compact folders, the address |
| Milestone ID or decision numbers taken by another workspace | Checked on every branch now (`V46` and `L1` taken; decisions to 319) and again before finishing |

**Order**: the counter and kinds first (they decide every number), then the scan and the API,
then the pure tree and layout, then the page.

## Milestones

| # | Milestone | Output |
|---|---|---|
| RM1a | The package: scan, count, kinds; `/api/monitor` | `@symbiote/monitor`, its tests, the cloc comparison, cost on four repositories |
| RM1b | The Monitor page | Route and sidenav link, headline, treemap, list, zoom, tooltip, open in VS Code; e2e; screenshots |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 320 | Where it lives | **`@symbiote/monitor` (`packages/monitor`)**: scanning, counting and kinds, depending on `@symbiote/core` only for git and `.symbioteignore`; the page in the viewer (`src/monitor/`), which imports only the package's types | The person asked for a package of its own; the viewer is one bundle whose CSS is under the tokens test, and every page lives there |
| 321 | What size is | **Lines of code** (not blank, not only a comment), counted by our own table of languages | Bytes reward data and long lines; symbols would need a TypeScript program for 9,583 files and only see TypeScript; lines are what people say |
| 322 | What is read | **The last commit (`HEAD`)**, from git objects, cached by SHA | 0.8 s for Bitwarden with no checkout; a commit never changes, so the cache is always right; the working tree would change under the person's eyes |
| 323 | What counts | **Every file gets one kind** (source, tests, docs, data, other, set aside with its reason); **Source only** by default; chips add the rest | Tests are 26–42 % of the code, Bitwarden's data 2.8× its code: counted alike they hide where the product code is |
| 324 | The picture | **A squarified treemap, two levels at a time, zoomed by click with breadcrumbs, and a ranked list beside it** | The research above; Bitwarden's whole-repository treemap labels 28 files |
| 325 | Saying concentration | **In words**: half of the code is in N files (x %), the largest 10 % hold y %, the leading folder's share | Measured 3–10 % / 51–77 % everywhere; a Gini number or a Lorenz curve asks the reader to know them |
| 326 | Colour | **The file's kind** (the chips are the legend); with Source alone, one tint and the frames carry the structure | Symbiote's style keeps colour for state; a palette per language or folder is a legend to learn; heat is kept for change frequency (later) |
| 327 | Small files | **One "N smaller files" tile per folder** under 24 × 16 px | 1,964 of Bitwarden's tiles would be under 4 × 4 px |
| 328 | The page | **"Monitor"** at `/monitor`, key `m`, after Skills in the sidenav; this view titled "Code concentration" | "Repo monitoring" in the person's words; later views (below) go on the same page |

**Not in RM1 (later)**:

- **Hotspots** (RM3; RM2 became the Monitor's look): colour by how often each file changed in
  the last months, Tornhill's and CodeScene's "size × change frequency" — where the code is *and*
  where the work is.
- **Over time**: how the concentration moved between two commits or releases (History's row menu
  could open the page at a commit: `scanCodebase` already takes the commit to read).
- Uncommitted changes, ownership (who wrote what), symbols per file from the analysis, a
  `symbiote monitor` command for CI.

## As built (RM1)

- **Frames nest while they have room, six levels at most** (decision 324 changed): two levels, as
  planned, drew Symbiote's own root as one `packages` frame (96 % of the code) holding seven
  empty folder boxes. Four levels left Bitwarden's `apps/web/src/app` (82,475 lines) an empty box;
  a 64 × 56 px frame made the edges busy with unlabeled tiles. A folder becomes a frame from
  96 × 72 px (`MIN_FRAME_W`, `MIN_FRAME_H` in `treemap.ts`), else it is drawn whole, dashed, and a
  click goes in. Six levels (`MAX_DEPTH`) are reached only in large views.
- **Labels by the room they need**: a name and its lines need 44 px of height, a name 26 px. With
  36 px, flexbox squeezed a 37 px tile's name to 9 px (found zooming at 3×). A share is written
  with a no-break space (`96 %`): an 820 px page wrapped the sign from its number.
- **Colours** (decision 326): Source tiles take the chrome's `--raised`; Tests, Docs and Data a
  30 % wash of a History lane's hue (`--lane-2`, `--lane-3`, `--lane-1`) into the panel; Other and
  Set aside `--context`'s. The accent marks only the picked file (its `.selected` role).
- **Core** gains `gitInput` (git with stdin, for `cat-file --batch` and `check-attr --stdin`) and
  exports its runner (`git`, `GitError`); nothing in the analysis changes, so `regression-check`
  was not run.
- **Counting** follows cloc in two places the plan did not say: a shebang is code, and JSON
  allows comments (tsconfig files have them). A set-aside reason is `ignored` for
  `.symbioteignore`, not `symbioteignore`.
- **Not built as planned**: no hover card near the pointer; the details sit under the list
  (pointing shows them, a click keeps a file's). The treemap's tiles are not keyboard stops; the
  list is the keyboard's way (arrows, Enter).

**Results.**

| | Symbiote | vite | Qwik | Bitwarden |
|---|---|---|---|---|
| Map, first read / again | 277 ms / 10 ms | 313 ms / 10 ms | 376 ms / 10 ms | 1.32–1.49 s / 13–34 ms |
| Map's JSON | 165 KB | 435 KB | 708 KB | 1,499 KB |
| Tree of the Source files / one layout at 1000 × 640 | 2.0 / 2.4 ms | 1.3 / 0.4 ms | 5.3 / 1.4 ms | 8.4 / 1.1 ms |
| Tiles at the root / labeled | 218 / 133 | 130 / 103 | 232 / 130 | 239 / 125 |

- **Counts against cloc 2.10**, per file: identical for every Markdown, JSON, CSS, HTML, YAML, MDX
  and shell file of Symbiote (`0e81ebb`) and every CSS, HTML, Markdown, SVG, SCSS, YAML, TSX,
  Less, Stylus, Svelte, Sass and TOML file of vite; TypeScript 450 of 457 and 542 of 569 files
  identical, JavaScript 22/23 and 882/885. Every difference read is cloc's: a `/*` inside a
  string or glob opens a comment for it (Symbiote's `workspaces.test.ts`, `'fix/*'`: cloc 534
  comment lines, ours 141; vite's `importMetaGlob.ts`: 395 against 14), `//` in a regex literal
  (`/^\/\//`), JSON comments, Vue's `<script>` comments, a JSX `*/}` line, `//` inside a template
  literal (the intro's shaders), patches read as diffs. The comparison found two of ours, fixed
  with tests: a shebang is code, and a line that only opens a template literal is code.
- The first counter took 2.4 s on Bitwarden (a `startsWith` per character); jumping between a
  syntax's special characters with one sticky regex, and `indexOf` for closers, 1.3–1.5 s.
- `pnpm check`: 1,451 tests (monitor 26, the CLI's routes 3, the viewer's tree and layout 20).
  E2E: `monitor.spec.ts`, 4 tests; the whole suite 223 of 225 at first (`shell.spec.ts` counted
  four pages, fixed; `intro.spec.ts`'s reduced-motion test timed out under load and passes alone).
- History's first rows, `main`'s build against this one on this repository, alternated, 6 rounds
  each: median 221 ms and 205 ms; the main bundle 701,812 → 716,817 bytes (+2.1 %).
