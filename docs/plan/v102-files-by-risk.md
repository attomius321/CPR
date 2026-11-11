# V102 — Files in order of risk

[Index](../PLAN.md) · [Journal](../journal/v102-files-by-risk.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v102-files-by-risk` (the
workspace's, from `main` at e0e8564); planned by the graph usability spike
(`spike/graph-usability`).

**Kind** feature (milestone) · **Branch** `feature/v102-files-by-risk` · **Size** M ·
**Depends on** none · **Rank** 4 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**: the Files page lists the change's files by risk, in four groups:
1. files holding findings, worst severity first, then most findings;
2. other code;
3. tests;
4. docs and every other file.

Inside a group, files keep their path order. Each row shows its findings count in the worst
severity's colour. The page opens on the first file. While the change is analyzed, the list keeps
git's order (decision 847). When the graph arrives, it reorders without changing the open file.

**Where to look**:
- `packages/viewer/src/diff/FilesPage.tsx`: `useReviewFiles` (:71, the files from `./api/files`),
  the list (about :195–240), `stepFile` for `j`/`k` (`src/diff/file-diff.ts`).
- `src/workspaces/ChangesPanel.tsx`: `FileRow` and its `after` slot (where the comments count
  sits).
- `src/graph/flow.ts`: `fileOf` and `countFindings` (:1128) for findings per file.
- Decisions 431 (a review opens on Files), 432 (a row's counts are git's), 847 (git's files while
  analyzing). A new pure module must not be named `files.ts` (`test/files.test.ts`).

**Out of scope**: the diff of a file; the Graph page's change list (already by project).

**Done when**:
- feature/issues-page's review opens on `packages/viewer/src/shell/pages.ts`, the file of its only
  warning, with `CLAUDE.md`, `README.md` and `docs/` last.
- On the small fix, the first file is one with a finding, not `docs/JOURNAL.md`.
- `j`/`k` walk the new order; the order does not change while a file is open.

## Problem (the spike's G7)

On all 30 of the last 30 merges into `main`, Files opens on a file that is not code
(`docs/JOURNAL.md`, `README.md`, a skill). Path order puts `.claude/`, `CLAUDE.md`, `README.md`
and `docs/` first. The file of the top finding sits at a median position of 28 (5 to 111), and no
finding is shown on Files
([shot](../../spikes/graph-usability/shots/p07-files-opens-on-docs-dark.png)). Files is where a
review opens (decision 431), so every review starts on the least risky file.

**Goal**: a review opens on its riskiest file, and Files says where the findings are.

## Design

- **The order**: a pure `riskOrder(files, graph)` in a new `src/diff/file-order.ts`. For each file,
  it takes the findings of the symbols in that file (by `fileOf`), its group (findings, code,
  tests, other), and its path. Code and tests use the same patterns the spike used to count them
  (`.ts`, `.tsx`, `.js`, `.mjs`, `.css`, `.scss`, `.html`; `.test.`, `.spec.`, `/e2e/`, `/test/`).
  If V100 is built first, the findings it folds as settled rank a file below one with an unsettled
  finding.
- **Where it applies**: `FilesPage` sorts with `riskOrder` once the graph is there. Before that it
  shows git's order. The open file stays open across the reorder (`openFile` is kept by path).
- **The row**: `FileRow`'s `after` gets a findings count beside the comments count.

## Verification

1. Unit (red first, `test/file-order.test.ts`): the groups and their order on the small fix's and
   the feature's files and findings (the spike's graphs); paths keep their order inside a group.
2. e2e: a fixture with a finding in a file whose path sorts last opens on that file; `j` follows
   the new order.
3. Shots of the feature's Files, both themes.

**Risks**

| Risk | Mitigation |
|---|---|
| A reviewer who reads files in path order loses it | Path order is kept inside each group; docs last, not hidden |
| The list jumps when the graph arrives | The open file stays; the reorder happens once |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 973 | The Files page's order (amends 431's first file) | **Files with findings (worst severity, then most), other code, tests, then other files; path order inside each group; git's order until the graph arrives** | 30 of 30 merges opened on a docs file; the top finding's file sat at position 28 |
| 974 | A file's findings on Files | **A count on its row, in the worst severity's colour** | Files showed no finding at all |

## As built

Built as planned, decisions 973–974, with three changes the code asked for (below). Tests
first: on a stub that kept git's order, 9 of the 10 unit tests in `test/file-order.test.ts`
failed (the tenth checks that nothing moves when nothing should). The 3 tests of
`e2e/files-order.spec.ts` failed on `main`'s build for the right reasons: the list in git's
order, and no count once the graph arrived. All pass now.

- **A finding's file is not `fileOf`.** In `graph/flow.ts`, `fileOf` is a node's last line, its
  signature. `countFindings` is private there and counts every finding. So
  `fileFindings` (`diff/file-order.ts`) puts a finding in its symbol's file, the head's or, for
  a removed symbol, the base's, as `changeList` reads it. A renamed file's row takes its old
  path too. It skips a settled signature change with V100's `settled`, the rule the Findings
  tab folds by. A file whose only findings are settled is other code. A finding in a file the
  change did not touch has no row.
- **The groups' patterns.** Code is `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.mts`, `.cts`,
  `.css`, `.scss`, `.less` and `.html`: the spike's patterns and their kin. A test is a name with
  `.test.` or `.spec.`, or any file in a `test/`, `tests/`, `__tests__/` or `e2e/` folder at any
  depth, the root's too. The plan's `/test/` missed a `test/` at the root. A test's fixtures
  are tests: the feature's six JSON fixtures sit with its tests, not with the docs.
- **"Worst severity, then most"** is the most of each severity in turn: errors, then warnings,
  then infos. A file with 2 warnings comes before one with a warning and 3 infos.
- **Where the order applies.** `useReviewFiles` (in `FilesPage.tsx`) returns the files in order
  of risk once the graph is there, so the list, `j`/`k` (`useDiffKeys`), the arrows and the
  position ("3 of 5") all follow it. `App.tsx` is not changed, because V101 works in it.
- **The open file across the reorder needed more than "kept by path".** On a new graph,
  `App.tsx` sets the open file to none, which means the first file. Its effect runs after the
  page's, so the file the person read while the change was analyzed jumped to the riskiest one.
  In the e2e test without the fix, it jumped to `src/zoo.ts`. `useKeptOpen` in `FilesPage.tsx`
  now holds the file shown, by path, while the change is analyzed. After the graph's first run,
  when App has set no file, it opens that file again, and it draws it meanwhile.
- **The row (974)** gets the graph card's own count, `.symbol-count count-<severity>`
  (decision 835), as `.files-findings`. It comes after the comments count, so the counts make
  one column at the rows' end. Its tooltip names the severities ("1 warning", "1 warning, 2
  info"), as the card's does. The head says "notes" for infos (968). The row's accessible name
  adds them: "Show the changes to src/zoo.ts (2 warnings)".
- **No group headings**: the plan names none. The counts mark the first group, and the names
  and folders show the rest.
- A workspace's **Changes** panel is unchanged: `FileRow` is not edited, only the Files page's
  `after`.
- `e2e/files.spec.ts` follows the new order: the agent's `src/math.ts` (code) now comes before
  its `docs/notes.md`.

## Results

`main` (e0e8564) against this branch, as a real `symbiote view` serves each change. Each runs
in a scratch clone with its own cache, 2560 × 1440, 1x, both themes. The feature is the branch
review the spike walked; the small fix is its pair `3f45ca4..0c87309`.

| Change | `main`: opens on; the worst finding's file | V102: opens on; counts on rows |
|---|---|---|
| feature/issues-page, 55 files, 1 warning, 3 listed notes | `CLAUDE.md`, 1 of 55; `pages.ts` 49th | `packages/viewer/src/shell/pages.ts`, 1 of 55; 4 (1 amber, 3 cyan) |
| fix/e2e-flakes, 18 files, 4 listed notes | `docs/JOURNAL.md`; the first file with a finding 8th | `packages/cli/src/workspace-agent.ts`; 4 (cyan) |

On the feature, the 11 docs and other files are 45th to 55th: `CLAUDE.md`, `README.md`, 7 under
`docs/`, `packages/forge/package.json` and `packages/viewer/CLAUDE.md`. Code is 5th to 23rd, and
the tests and their fixtures 24th to 44th.

The spike's 30 merges (G7), each made again with this branch's CLI as base and second parent
from their merge base:

| Measure | `main` | V102 |
|---|---|---|
| Opens on code, or on a file with a finding | 0 of 30 | 26 of 30 |
| 18 merges with a listed finding: where the file V102 opens on sits | median 33rd, 8th to 90th | 1st, holding the change's worst severity, on 18 of 18 |
| 19 merges with any finding: the top finding's file (the spike's measure, 1-based) | median 29th, 6th to 112th | |

The 4 merges that still open on a docs file change no code: two of 2 files (`docs/JOURNAL.md`'s
index, a spike's write-up), an audit of 68 files and the README's remake of 24.

Shots of the feature's Files page, 2560 × 1440, 1x
([before](../images/v102-files-by-risk/feature-before-dark.png),
[after](../images/v102-files-by-risk/feature-after-dark.png); light:
[before](../images/v102-files-by-risk/feature-before-light.png),
[after](../images/v102-files-by-risk/feature-after-light.png)), and the small fix's list
([before](../images/v102-files-by-risk/fix-before-list-dark.png),
[after](../images/v102-files-by-risk/fix-after-list-dark.png); light:
[before](../images/v102-files-by-risk/fix-before-list-light.png),
[after](../images/v102-files-by-risk/fix-after-list-light.png)).

Cost: one pass over the files and the findings when the list or the graph changes. The order
and the counts take 0.4 ms on the largest of the 30 merges (137 files, 76 findings, 1,509
symbols).
