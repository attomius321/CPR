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

## V70 — a commit's file in the rows' place; Open in VS Code from Git (2026-10-27, branch `feature/history-commit-details`)

A file clicked in Git's pane shows over the rows, in their card, its head as tall as the pane's;
`j`/`k` step the commit's files, Esc goes back. Open in VS Code (`o`) opens the diff it shows in
VS Code's diff editor (`POST /api/git/open`), each side as the row reads it: a commit against its
first parent, staged HEAD against the index, not staged the index against the disk, the right
side the checkout's own file when it is the same. Decisions 498–501.

**Learned**:
- **A path in a narrow head breaks mid-word**: the whole path, wrapping, took three lines at
  514 px ("…/src/h", "istory/HistoryPage.ts", "x"). The name then its folder, cut, keeps one
  line; the full path is the tip's.
- **Hiding the words hid the side**: under 640 px of card the status's words went, and "not
  staged" with them, while the e2e test still passed: `toContainText` reads hidden text. The
  side is its own element now, and the test checks it is visible.
- **`.git-file` was taken** by the uncommitted pane's rows (a file and its Stage button): the
  view is `.git-shown`. Class names are global (the viewer's CLAUDE.md).
- **The page's rows already had a `shown`** (the row numbers in view): the file's state is
  `openFile`.
- **A command chain hid a lint error**: `eslint … | tail` exits 0, and the first server commit
  went in with one (`setUp` async without an await); fixed in the next commit, not rewritten.
- **The keys' help is pinned word for word** in `commits.spec.ts`: a new clause fails it.

**Verification**: tests first (red for the right reason) for each part, listed in the plan's
results; `pnpm check` (2,008 unit tests); the full e2e suite (321 passed), then the Git,
commits, history, title-bar and look specs after the last change (39 passed); screenshots at
1,440 × 900 and 1,280 × 800, device scale 1, dark and light: a commit's file beside the pane and
above it, the note after Open in VS Code, an uncommitted file, the rows after Esc. On this
repository's `7fa440d` (27 files), 27 diff lines in view where there were 0, 25 at 1,280 × 800.
After merging `main` (V69): `pnpm check` (2,008), the full e2e suite 322 passed, 1 failed by
3/100 000 of a pixel (V48's starting card, 72.00003 px against at most 72; 3 of 3 alone).

Not verified: the real VS Code (a window on the person's desktop: only a stand-in that writes
down its arguments was asked); macOS and Windows.
