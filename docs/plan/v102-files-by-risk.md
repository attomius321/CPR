# V102 — Files in order of risk

[Index](../PLAN.md) · [Journal](../journal/v102-files-by-risk.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v102-files-by-risk` in its own
workspace; written by the graph usability spike (`spike/graph-usability`). Not started.

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
