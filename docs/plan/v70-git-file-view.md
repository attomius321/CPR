# V70 — Git: a commit's file on screen, and Open in VS Code

[Index](../PLAN.md) · [Journal](../journal/v70-git-file-view.md)

**Status:** planned (2026-10-27), on branch `feature/history-commit-details` (a Symbiote
workspace, from `main` at `2ee21cd`). The plan OK'd by the person ("OK, do it"), with their two
choices: Open in VS Code opens VS Code's diff editor ("Yes, the diff"), and the file shows in the
rows' place ("Where you say would fit perfectly").

**Problem** (asked: "Is inconvinient to open a file from commit details, and it is displayed at
the bottom. Should be on the screen, i should not scroll to it. Also, Open in VS Code classic
option -- where is it?"). V66b put a file's diff at the end of the details pane, under the
message, the facts and every file. The pane is 360 px wide and scrolls as one. Measured on
`main` (`2ee21cd`) with this repository, the last file of a commit clicked, the diff lines in view
without scrolling:

| Commit | Files | 1,440 × 900, pane on the right | 1,280 × 800 (the pane goes below) |
|---|---|---|---|
| `bd927dd` | 1 | 5 of 24 | 0 |
| `da547af` | 3 | 1 of 11 | 0 |
| `3d480c7` | 5 | 0 of 97 | 0 |
| `507487f` | 8 | 0 | 0 |
| `961ec4f` | 12 | 0 | 0 |
| `7fa440d` | 27 | 0: the diff starts at y = 1,170 | 0 |

Of the last 300 commits (no merges), 150 change 5 files or more: their diff never shows without
scrolling. Under 1,040 px of page body, none does. In the pane the code has about 230 px: 29
characters before a line wraps (Prettier's width here is 100).

Open in VS Code: V66's plan promised it from the pane, "as V43" (VS Code's diff editor); its
"As built" says "Not built". A workspace's changes panel has it (V43: a click opens the file's
diff in VS Code); the Files page has its button and `o` (V12). The Git page has neither.

**Goal**: a file opened from a commit's details, or from the uncommitted changes, shows at once
in the rows' place, as tall as the page, with Open in VS Code (`o`) in its head. The pane keeps
the commit and its files: another file is one click. Esc goes back to the rows, where they were.
**Unchanged**: the rows, the graph, the pane's place (right or below), its contents but the diff,
compare, checkout, the endpoints V66 added; a diff's page.

## The file in the rows' place (viewer)

- A file clicked in the pane shows in the rows' card, over the rows: a layer filling the card.
  The rows stay mounted under it, so their scroll, the cursor and the virtual rows' measures are
  kept; Esc, ✕ or the same file clicked again takes the layer away.
- The layer's head, as the Files page's (`file-head`): the path, its status in words, +/−, Open
  in VS Code (`o`), "staged" or "not staged" for an uncommitted file, ✕ (Esc). Under it the
  diff (`GitDiff`, unchanged: 3 lines of context, folds, "Show all") fills the rest and scrolls
  alone.
- Room: the card is 514 px wide at 1,440 px beside the pane (1.6× the pane's code), 782 px with
  the branches panel folded; below, the page's width. Nothing else moves.
- The pane: the open file stays marked (`current`); the `.git-details-diff` section goes. In the
  uncommitted changes, Stage and Unstage stay beside each file; staging the open file keeps it
  open on its new side.
- State moves up: the open file is the page's (`HistoryPage`), reset when the cursor's commit
  changes. A commit's details and lines are read by a hook the page calls (`useCommitDetails`),
  so the pane and the layer share one read.
- Keys while a file is open: `j`/`k` the next and previous file of the commit (the staged ones,
  then the rest, for the uncommitted changes), `o` Open in VS Code, Esc back to the rows. The
  rows are covered: moving through rows no one sees would change the pane under the person.
  The keys' help ("?") says so.

## Open in VS Code: the diff in VS Code's diff editor (server, viewer)

- What it opens: the diff the layer shows, in VS Code's diff editor, in the repository's window
  (`code <repo> --diff <left> <right>`, V43's `diffArgs`). Each side is the file as the row
  reads it:

  | File | Left | Right |
  |---|---|---|
  | A commit's | The file at its first parent; its previous path for a rename | The checkout's own file when it has no change since the commit (decision 287); else the file at the commit |
  | Staged | The file at HEAD; its previous path for a rename | The checkout's own file when nothing else changed it; else the index's |
  | Not staged | The index's | The checkout's own file |
  | Conflicted | The file at HEAD | The checkout's own file (its markers) |

  A side with no file: a new file (added, untracked, a root commit's) opens alone, as it is; a
  deleted one against an empty file (V43). A commit's or HEAD's file is V43's read-only copy in
  the cache (`keptFile`, `state/<repo>/revisions/<sha>/<path>`); the index's a copy by its blob,
  `revisions/index/<blob>/<path>`, as a checkout writes it (`cat-file --filters`), so each
  stays right as the index changes.
- `POST /api/git/open { sha?, path, staged? }` → `{}` once VS Code has it. `sha` a commit and
  `path` one of its files (decision 58); without `sha`, `path` one `git status` lists on that
  side. 400 a path not listed there, 409 no editor, 502 VS Code failing in its words, 403
  without `x-symbiote`.
- Core gains `fileInIndex` (the index's blob of a path and its bytes as a checkout writes them),
  beside `fileForCheckout`. `GitPage` (`packages/cli/src/git-page.ts`) resolves the two sides
  with `keptFile` and `emptyFile` (moved out of the workspaces' module when shared) and opens
  them with the `openFolder` the workspaces already use.
- The head says what happened, as the Files page's does: "Opened the diff of `<path>` in VS
  Code", or why not.

## Verification

1. **Tests first** (red before):
   - Core: `fileInIndex` (a staged file's bytes, none for a path not in the index, a
     submodule).
   - CLI: `git-page.test.ts` — the two sides of each row of the table: a commit's file (the
     checkout's own file, or the commit's copy once changed since), a rename, an added and a
     deleted file, a root commit; staged, not staged, untracked, conflicted; a path not listed
     refused; `server.test.ts` — `POST /api/git/open` (405, 403, 400, the answer).
   - Viewer: `details.test.ts` — the next and previous file (round the ends, the uncommitted
     sides in order).
   - e2e (`git.spec.ts`, `SYMBIOTE_CODE` a fake as `monitor.spec.ts`'s): a commit of 30 files,
     its last file clicked: the diff's first line inside the window at 1,440 × 900 and
     1,280 × 800, the pane on the right and below; `j`/`k` step files; Esc: the rows back, the
     cursor's row where it was; Open in VS Code and `o`: the fake VS Code gets
     `<repo> --diff <the parent's copy> <the checkout's file>`, the head says so; the same for an
     uncommitted file, staged and not.
2. **Nothing else changes**: `pnpm check`; the full e2e suite (`git.spec.ts`'s V66b test follows
   the diff out of the pane); no analysis change, so no `regression-check`.
3. **Viewer**: the `viewer-check` skill: screenshots at 1,440 × 900 and 1,280 × 800, device
   scale 1, dark and light — the layer, its head, the pane beside it — and every page audited
   for spacing; the `symbiote-style` skill for the head's controls.
4. **Real VS Code**, once, on this machine: a commit's file and an uncommitted one open as
   diffs in the repository's window.
5. **Cost**: opening a file no slower than today (the same `commit/file` read); the rows' first
   paint unchanged.

**Risks**

| Risk | Mitigation |
|---|---|
| The covered rows still take keys or clicks | The layer covers the card; the page's keys check for an open file first; e2e |
| The rows' scroll lost on return | They stay mounted under the layer; e2e checks the cursor's row in view after Esc |
| `j`/`k` mean two things | Only while a file is shown, said in the help and the ✕'s tip |
| A copy edited and saved, taken for the file | Read-only, in the cache; the right side is the checkout's own file whenever it is the same (V43) |
| The index's copies pile up | One per blob opened, a few KB, in the cache beside V43's; not pruned |

**Order**: the server's Open in VS Code (core's reader, the sides, the route), then the layer,
its keys and its head (the person's first complaint), then the uncommitted changes, docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V70 | A file on screen; Open in VS Code from Git | the layer, keys, `POST /api/git/open`, `fileInIndex`, e2e, docs |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 498 | Where an opened file's diff shows | **In the rows' card, over the rows, in both places of the pane; the pane keeps the files** | 150 of 300 commits showed no diff line; the pane is 360 px wide. Splitting the pane leaves the code 29 characters; turning the pane into the file hides the other files |
| 499 | The keys while a file is open | **`j`/`k` step the commit's files, `o` opens it in VS Code, Esc goes back to the rows** | The rows are covered; `o` is the Files page's key and free on Git |
| 500 | What Open in VS Code opens | **VS Code's diff editor of the file, in the repository's window: the diff the layer shows** | The person's choice ("Yes, the diff"); V66 planned it "as V43" |
| 501 | The two sides | **What the row reads: a commit against its first parent, staged HEAD against the index, not staged the index against the disk; the right side the checkout's own file when it is the same** | Precise beats complete: the diff opened is the diff shown; editable with VS Code's features in the usual case (decision 287) |

**Not in V70 (later)**: the checkout's file at a line from a diff's line number (the Files
page's, V12); stepping commits while a file is open; Stage and Unstage in the layer's head;
remembering the open file across commits; pruning the cache's copies.
