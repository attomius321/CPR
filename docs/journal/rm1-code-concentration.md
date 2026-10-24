# Journal: RM1 — Code concentration: where a repository's code is

[Index](../JOURNAL.md) · [Plan](../plan/rm1-code-concentration.md)

## RM1 spike — how concentrated real repositories' code is, and what a picture of it can show (2026-10-24, branch `feature/repo-monitoring`)

Asked: "I need a new feature from where i can see each files from the repo, by code
concentration. I need a good way to visualize this, do some research on how we can represent it
easy for the human. This should be in another package, like repo monitoring or something".
Measured with a script outside the repository on four repositories at `HEAD`: this one
(`561826d`), and vite, Qwik and Bitwarden's clients cloned at depth 1 on 2026-10-24. The script
lists the tree (`git ls-tree -r -z -l HEAD`), reads every blob through one `git cat-file
--batch`, sorts files into kinds by extension and counts non-blank lines that do not start a
comment (a rough rule, enough to size the problem; the plan's counter tracks strings). Read the
literature on hierarchy and size pictures (treemaps, circle packing, sunbursts, icicles) and
what code-analysis tools draw (CodeScene, GitHub Next's repo-visualizer).

**Learned**:
- **Code is concentrated everywhere measured**: half of it is in 3–10 % of the files (vite 67 of
  2,079 files; Bitwarden 783 of 8,037), and the largest 10 % of files hold 51–77 %. This is the
  fact to show, and a sentence says it.
- **What counts changes the answer**: tests are 26–42 % of the code lines; Bitwarden's data files
  have 2,285,516 lines against 829,874 of code; lockfiles 2,624–56,890. The largest "code" files
  include a test (`packages/cli/test/workspaces.test.ts`, 2,730), a vendored parser (Qwik's
  `packages/qwik-dom/lib/HTMLParser.js`, 7,976) and a word list (Bitwarden's `wordlist.ts`,
  7,778). Kinds, with Source alone by default, are needed before any picture is honest; Qwik's
  parser is not marked vendored anywhere, so it stays source unless the repository says
  otherwise (no guessing from content).
- **A whole-repository treemap cannot show files at Bitwarden's size**: at 1200 × 700 px it gives
  0.91 px² per line, labels 28 files (≥ 70 × 20 px) and draws 1,964 smaller than 4 × 4 px. Hence
  two levels at a time, zoom by folder, a small-files tile, and a list for exact numbers.
- **Reading is cheap**: listing, reading and counting every blob took 103 ms (Symbiote), 93 ms
  (vite), 207 ms (Qwik) and 769 ms (Bitwarden, 9,583 files, 153 MB). No checkout and no
  TypeScript program are needed; a cache by commit makes a second open free.
- **The literature**: squarified treemaps use the space best and are read fast for "what is big"
  (Kong, Heer, Agrawala 2010 also found area judgments worst at extreme aspect ratios and at exact
  squares); treemaps are weaker than icicle plots on hierarchy tasks (Woodburn, Yang, Marriott
  2019), so the breadcrumb, the frames and the list carry the hierarchy. Circle packing (CodeScene,
  repo-visualizer) wastes area between circles; sunbursts compare angles.

Not verified: the counts were taken with the rough rule above, not yet against `cloc`; the
clones were at each project's current `HEAD`, not pinned commits.

## RM1a — @symbiote/monitor: a commit's files, their kinds and lines of code (2026-10-24, branch `feature/repo-monitoring`)

The plan OK'd ("1. Yes 2. current checkout ed HEAD 3. Good .. at the end, for RM2, i will create
another feature that continue it. OK"). A package of its own, `packages/monitor` (decision 320):
`scanCodebase` lists the commit's tree, reads every blob through `git cat-file --batch` in 16 MB
batches, asks `git check-attr` once for `linguist-generated`/`linguist-vendored`, and gives each
file a kind and its blank, comment and code lines; `codeMaps` keeps the last four commits.
`GET /api/monitor` serves the checkout's map, `POST /api/monitor/open` opens one of its files in
VS Code. Core gains `gitInput` (git with stdin) and exports its runner. Decisions 320–323.

**Learned**:
- **cloc is not the truth for TypeScript**: it opens a block comment at a `/*` inside a string or
  a glob and keeps it open to the next `*/`. Symbiote's `packages/cli/test/workspaces.test.ts`
  holds `'fix/*'`: cloc counts 534 comment lines, ours 141; vite's `importMetaGlob.ts` 395 against
  14, `optimizer/scan.ts` 492 against 77. The comparison was still worth it: every file of the
  languages without that trap matched exactly, and it found two bugs of ours.
- **Two bugs the comparison found**: a shebang counted as a comment (cloc counts it as code: it
  says how the file runs), and a line holding only the backtick that opens a template literal
  counted as a comment (the string's lines after it were code). vite's `entry-worker.jsx` and
  `matrixTestResultPlugin.ts` showed the second. Both have tests now.
- **A counter per character is slow on data**: Bitwarden's 2,285,516 JSON lines took the first
  counter to 2.4 s (a `startsWith` and a closure per character). Jumping from one of the syntax's
  special characters to the next with one sticky regex, and `indexOf` for a string's or
  comment's end, brought it to 1.3–1.5 s. The batch size does not matter: 16, 8, 4 and 1 MB gave
  1.3–2.4 s and a peak of 276–350 MB, which follows the garbage collector more than the batch.
- **`npm install` in a folder without `package.json` walks up**: in the job's scratch folder it
  installed cloc into `~/.claude/node_modules` (that folder has a `package.json`). Install into
  a folder with its own `package.json`.

**Verification**: tests first, run red on assertions (stubs returning zeros), then green:
`count.test.ts` (15, a case per trap), `kinds.test.ts` (4), `scan.test.ts` (7, real repositories:
the commit not the working tree, symlinks and a submodule left out, binary, `.gitattributes` and
`.symbioteignore`, Latin-1, a detached `HEAD`, the cache); the CLI's three route tests red (404,
405) then green. Counts against cloc 2.10 on Symbiote (`0e81ebb`) and vite: identical for every
Markdown, JSON, CSS, HTML, YAML, MDX, SVG, SCSS, Less, Stylus, Svelte, Sass, TOML and shell file;
TypeScript 450/457 and 542/569, JavaScript 22/23 and 882/885, each difference read and cloc's.
Cost, first read / again: Symbiote 277 / 10 ms, vite 313 / 10, Qwik 376 / 10, Bitwarden
1.32–1.49 s / 13–34 ms; Bitwarden's map 1,499 KB.

Not verified: repositories over 10,000 files (cost measured linear up to Bitwarden's 9,583);
Windows; a repository with LFS pointers (counted as the pointer's text).

## RM1b — the Monitor page (2026-10-24, branch `feature/repo-monitoring`)

A page of the shell at `/monitor` (m, after Skills in the sidenav): the concentration in words,
a squarified treemap of the folder in view (area = lines of code, colour = kind), the ranked list
beside it with a "half of the code" line, kind chips that are the legend, details on hover or for
a picked file, Open in VS Code. `codemap.ts` and `treemap.ts` are pure. Decisions 324–328.

**Learned**:
- **Two levels are too few** (decision 324 changed): Symbiote's root drew as one `packages`
  frame (96 %) of seven empty folder boxes. Frames now nest while a folder has 96 × 72 px, six
  levels at most: four left Bitwarden's `apps/web/src/app` (82,475 lines) an empty box, and a
  64 × 56 px minimum filled the edges with unlabeled tiles. At the root the four repositories
  draw 130–239 tiles, 103–133 labeled.
- **A label needs its height, not more**: with a 36 px threshold, flexbox squeezed a 37 px tile's
  name to 9 px (found zooming at 3× on `core/src/pipeline.ts`). Two lines need 44 px, one 26.
- **"96 %" wrapped at 820 px** between the number and its sign: shares carry a no-break space.
  At that width the list also collapsed to one row (a flex child with `min-height: 0` in a
  column that scrolls): narrow, it takes its own height under the treemap.

**Verification**: the route, widths, tree and layout tests (`pages`, `widths`, `codemap`,
`treemap`: 21 new cases); the layout's tests were written before the modules but first run
against them, and the nesting change was made test first (red: the fixture's folder drawn whole).
`e2e/monitor.spec.ts`, 4 tests: m opens it, the words, tiles, list and hover linked both ways; a
folder gone into and back by click, breadcrumbs, Backspace and the browser; Tests and Source
toggled; a picked file kept, ranked by keyboard, opened in a stand-in VS Code at line 1.
`pnpm check` (1,451 tests). Screenshots at 1440 × 900 and 820 × 900, scale 1, both themes: the
Monitor on Symbiote and Bitwarden, a picked file, Tests on with a row hovered, History's sidenav
with the new link. Layout 0.4–2.4 ms, the tree 1.3–8.4 ms on the four repositories.
