# V108 — One review progress

[Index](../PLAN.md) · [Journal](../journal/v108-one-review-progress.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v108-one-review-progress`;
planned (2026-11-10) by the graph usability spike (`spike/graph-usability`). Ranked low: the
person's records show 2 marks in 169 reviews.

**Kind** feature (milestone) · **Branch** `feature/v108-one-review-progress` · **Size** M ·
**Depends on** V105 helps (one item per stylesheet) · **Rank** 11 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**:
1. **The two marks meet.** Marking a file viewed (Files, `v`) marks its changed symbols reviewed.
   A file whose changed symbols are all reviewed (Graph, `r`) counts as viewed.
2. **One progress line on both pages**: files viewed, symbols reviewed, findings not yet opened,
   and a "next" that jumps to the first thing left.
3. **A file's symbols at once**: `R` (Shift+R) marks every changed symbol in the picked symbol's
   file.

**Where to look**:
- `packages/viewer/src/diff/useReview.ts` (`toggleReviewed` :60, `toggleViewed` :73): today two
  kinds of marks in one store, a symbol's by id and hashes, a file's as `file:<path>` by blob
  (decision 843).
- `src/diff/review.ts` (`reviewStatus` :208, `fileViewed` :175); `src/diff/Sidebar.tsx` (the
  progress line); `src/diff/FilesPage.tsx` (the viewed checks).
- `src/diff/useDiffKeys.ts` (`r`, `v`).

**Out of scope**: what a review posts (verdicts, comments); stale marks' rules (a change since
still unmarks, as today).

**Done when**:
- On the small fix, marking all 19 symbols shows every file with symbols as viewed on Files.
- Marking a file viewed marks its symbols on Graph; changing that file since unmarks both.
- Both pages show the same progress line.

## Problem (the spike's G10)

Graph counts symbols reviewed, and Files counts files viewed. On the small fix, with 19 of 19
symbols reviewed, Files showed 0 of 18 files viewed, and nothing said the review was done
([Graph](../../spikes/graph-usability/shots/p10-graph-all-reviewed-dark.png),
[Files](../../spikes/graph-usability/shots/p10-files-none-viewed-dark.png)). Marking everything
on the refactor takes 928 keys, 2 for each of its 464 symbols.

**Goal**: one answer to "what is left", whichever page the reviewer marks on.

## Design

- **Derived, not copied**: the store keeps both kinds of marks as today. A pure
  `reviewProgress(graph, files, marks)` in `review.ts` derives a symbol as reviewed if its own mark
  is current or its file's mark is, and a file as viewed if its mark is current or all its changed
  symbols are. Stale rules stay per mark (843's blob, the symbol's hashes).
- **The line**: one component on both pages, from `reviewProgress`.
- **`R`**: marks each unreviewed changed symbol of the picked symbol's file, in one store write.

## Verification

1. Unit (red first): `reviewProgress` on the small fix's graph and files, for marks by symbol, by
   file, mixed, and stale.
2. e2e: mark on Graph, see Files; mark on Files, see Graph; `R` on a file of 3 symbols.
3. Shots of both pages' progress line, both themes.

**Risks**

| Risk | Mitigation |
|---|---|
| A file viewed for its docs part marks code symbols the reviewer did not read | Only the file's changed symbols, and the file mark is per blob as today |

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 983 | A file viewed and its symbols (amends 843) | **Derived both ways when read: a file's mark at its current blob reviews its changed symbols; a file whose changed symbols all carry their own current marks reads viewed. The store keeps the person's own marks only, as before; the toggles keep the two meeting** | 19 of 19 symbols reviewed left 0 of 18 files viewed |
| 984 | The review's progress (amends 840's row) | **One line on both pages: files viewed, symbols reviewed, findings left on symbols not reviewed, a bar that fills when nothing is left, and Next to the page's next thing left** | Two counts that never met; no page said "done" |
| 985 | Marking a file's symbols | **`R` marks every changed symbol in the picked symbol's file, in one write; again, unmarks them** | 928 keys to mark the refactor one symbol at a time |

## As built

Decisions 983–985 as proposed, made precise where the plan left a choice, and built without
`App.tsx`, which V109 changes in parallel (the brief). Tests first:
`test/review-progress.test.ts`, on a fixture cut from the small fix's real graph (its 19 changed
symbols, 18 files with git's blobs and 6 findings, `test/fixtures/review-progress/flakes.json`),
failed at its first run (no `derivedMarks`, `progressLine`, toggles). `e2e/review-progress.spec.ts`
failed on its first build, 3 of 3: no line on Files, and the Graph line's old words. `R` itself was
in that build: its test failed on the words alone.

- **Derived, not copied** (`derivedMarks`, `diff/review.ts`): as planned. The store keeps the
  person's own marks in the format it had, so an older review loads as it was and reads with what
  it implies: a file it viewed reviews that file's symbols now, a file whose symbols it marked
  reads viewed. Nothing is migrated; the CLI and the review file are unchanged.
- **Where the blobs come from** (changed): the plan's `reviewProgress(graph, files, marks)` needs
  the files' blobs on both pages, and `App.tsx` passes the Graph page's sidebar none. `useReview`
  reads them itself, from the server that keeps the review (`Store.server`), through the read the
  Files page's list makes, once per graph (`readChangeFiles`, `change-files.ts`): one request, as
  before. `useReview` gives both pages the derived marks. A graph opened from a file has no blobs:
  there, and until the read arrives, a file reads viewed through its symbols only.
- **The Graph page counts files from the reviewed set**: `reviewStatus` now puts `file:<path>` for
  each file viewed beside the symbols, the marks' own keys (843), because `App.tsx` gives the
  sidebar only `reviewed` and `stale`. `derivedMarks` keeps a file's own mark only while current,
  so a `file:` key there means viewed now (`viewedIn`).
- **The toggles** (added: the plan said what is read, not what a toggle writes). `r` on a symbol
  reviewed through its file's mark drops that mark, and the file's other symbols keep their review
  as marks of their own. `v` on a file viewed through its symbols' marks unmarks them; `v` twice
  gives back the marks it found. Marking a file's last symbol stores no file mark.
- **`R`**: as planned, on Graph; again, when all are reviewed, it unmarks them all and drops the
  file's mark. The page's key help lists it.
- **The line** (`ReviewProgress.tsx`; its CSS moved from `Sidebar.css` to `ReviewProgress.css`):
  on Graph under the tabs, V90's place; on Files above the list. "10 of 18 files viewed · 19 of 19
  symbols reviewed", then the bar, "4 findings left" and **Next** on one row. Done, it says "Done:
  18 files viewed, 19 symbols reviewed", the bar green, no Next. The bar counts each item and each
  file holding none once, so it is full only when nothing is left. With stylesheets the words are
  V105's "changes reviewed" with its tip. A part that wraps starts its line without a separator.
- **"Findings not yet opened" became "findings left"** (changed): nothing records that a finding
  was opened, and a record kept for the page's life would differ after a reload. A finding the
  Findings tab lists (V100) is left while its symbol, a changed one, is not reviewed.
- **Next** (made precise): the next thing left after the current one, wrapping around. On Graph,
  the next item left after the pick, in the change list's order; on Files, the next file left
  after the one shown, in the order of risk (V102). When only files without symbols are left,
  Graph shows "Files g" in Next's place: the sidebar cannot switch pages without `App.tsx`. The
  buttons are "Next symbol left" and "Next file left": "Next file not viewed" matched
  `files.spec.ts`'s lookup of the **Viewed** button.
- **The whole change on both pages**: the line counts `changeList(graph)` on both, not the Graph
  list's `--since` filter, so the two pages always agree. The Changes tab still counts its list.
- **"j / k next"** left the line: Next and the key help say it.
- **Not changed**: `App.tsx` and `Canvas.tsx`; the graph JSON, core and the CLI; stale rules (a
  change since unmarks, per mark).

## Results

The small fix as the spike opened it, a branch review of `fix/e2e-flakes` (4cbcae0c) in a scratch
clone, served by `symbiote view` from `main`'s build (bc24845) and this branch's, at 2560 × 1440,
1x, both themes (`packages/viewer/coverage/v108/shots.mjs`, not committed: `coverage/` is
ignored). The refactor and Bitwarden from their graph JSON (`?graph=`).

| Measure | `main` | V108 |
|---|---|---|
| The small fix (18 files, 19 changed symbols in 10 of them), all 19 marked on Graph: files viewed on Files | 0 of 18 ([dark](../images/v108-one-review-progress/before-files-all-symbols-dark.png), [light](../images/v108-one-review-progress/before-files-all-symbols-light.png)) | 10 of 18 ([dark](../images/v108-one-review-progress/after-files-all-symbols-dark.png), [light](../images/v108-one-review-progress/after-files-all-symbols-light.png)) |
| Its Graph line then | "19 of 19 changed symbols reviewed", the bar full ([dark](../images/v108-one-review-progress/before-graph-all-symbols-dark.png), [light](../images/v108-one-review-progress/before-graph-all-symbols-light.png)) | "10 of 18 files viewed · 19 of 19 symbols reviewed", the bar at 19 of 27, "Files g" ([dark](../images/v108-one-review-progress/after-graph-all-symbols-dark.png), [light](../images/v108-one-review-progress/after-graph-all-symbols-light.png)) |
| Its Files page before any mark | no line | "0 of 18 files viewed · 0 of 19 symbols reviewed", "4 findings left", Next ([dark](../images/v108-one-review-progress/after-files-none-dark.png), [light](../images/v108-one-review-progress/after-files-none-light.png)) |
| Finishing it from there | no page says when it is done | Next and `v` on each of the 8 files left; then "Done: 18 files viewed, 19 symbols reviewed" on Files ([dark](../images/v108-one-review-progress/after-files-done-dark.png), [light](../images/v108-one-review-progress/after-files-done-light.png)) and on Graph ([dark](../images/v108-one-review-progress/after-graph-done-dark.png), [light](../images/v108-one-review-progress/after-graph-done-light.png)) |
| The refactor (eb807773: 122 files, 464 changed symbols in 75 of them): keys to mark everything | 928: `j` and `r` for each symbol (the spike) | 243 on Files: `v` on each file, `j` between; on Graph, `R` and Next for each of the 75 files with symbols, then the 47 others on Files |
| A mark in the page, `r` to two frames later, 12 marks, median, quiet machine: Bitwarden 737ee3f (86 changed symbols); the refactor | 17 ms; 17 ms (2 runs each) | 16–17 ms; 17–18 ms |
| `measure.mjs`, alternated, medians: Bitwarden first paint, select, mark (4 rounds) | 341 ms, 118, 52 | 348 ms, 109, 51 |
| The same on the refactor, first paint and mark (8 rounds, the machine busy with other workspaces) | 1,520 ms, 91 | 1,438 ms, 99 |

Cost: none measured. A mark's own work is the same: the CPU profiles of 12 marks list the same
functions on both builds. `measure.mjs` runs `r` straight after a select, and its numbers vary
±30 % and more on a busy machine: first paint on the refactor is bimodal on both builds (about
600 and about 886 ms on a quiet machine).

Tests: `test/review-progress.test.ts` (30, on the small fix's graph and V105's stylesheet graph),
`review.test.ts` (one expectation: `reviewStatus` names the file viewed),
`e2e/review-progress.spec.ts` (3); the words of `reviews.spec.ts` and `angular-v11.spec.ts`
follow the line. `pnpm check`,
`pnpm build` and `pnpm test:e2e`: see the journal.

