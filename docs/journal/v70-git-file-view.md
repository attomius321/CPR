# Journal: V70 — Git: a commit's file on screen, and Open in VS Code

[Index](../JOURNAL.md) · [Plan](../plan/v70-git-file-view.md)

## V70 spike — where a commit's file opens, and how much of it shows (2026-10-27, branch `feature/history-commit-details`)

Served `symbiote view` on this repository (`main` at `2ee21cd`) and opened the last file of
commits with 1 to 27 files at 1,440 × 900 and 1,280 × 800, device scale 1, counting the diff's
lines inside the window; counted the files of the last 300 commits (no merges).

**Learned**:
- **The diff is under everything else in the pane**: message, facts, every file, then the diff.
  At 1,440 × 900 a one-file commit shows 5 of its 24 diff lines, three files 1, five or more none
  (27 files: the diff starts at y = 1,170). Below the rows (1,280 × 800) none ever shows.
- **Half the commits never show it**: 150 of the last 300 change 5 files or more (median 4, the
  90th percentile 15, the largest 143).
- **The pane is narrow for code**: 360 px, about 230 px of code after the gutters, 29 characters
  before a line wraps; the rows' card beside it is 514 px, 782 px with the branches panel folded.
- **Open in VS Code was planned and left out**: V66's plan has it "as V43", its As built "Not
  built". `o` is free on the Git page.
