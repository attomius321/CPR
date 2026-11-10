# V108 — One review progress

[Index](../PLAN.md) · [Journal](../journal/v108-one-review-progress.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v108-one-review-progress` in its
own workspace; written by the graph usability spike (`spike/graph-usability`). Not started.
Ranked low: the person's records show 2 marks in 169 reviews.

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

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 983 | A file viewed and its symbols | **Derived both ways: a file's current mark reviews its changed symbols; all its symbols reviewed make it viewed; the store keeps both kinds of marks** | 19 of 19 symbols reviewed left 0 of 18 files viewed |
| 984 | The review's progress | **One line on both pages: files viewed, symbols reviewed, findings not yet opened, and a "next"** | Two counts that never met; no page said "done" |
| 985 | Marking a file's symbols | **`R` marks every changed symbol in the picked symbol's file** | 928 keys to mark the refactor one symbol at a time |
