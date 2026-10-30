# Journal: Fix — Git lists in place; more of git

[Index](../JOURNAL.md) · [Plan](../plan/v66-git-page.md#fix-the-page-lists-in-place-more-of-git-fixgit-page-feature-extend)

## Fix — Git lists in place, the file shown kept; more of git (2026-10-31, branch `fix/git-page-feature-extend`)

The person: "there is something that keeps refreshing the git page...and i lose my current view
(i loook at a file, and goes back to the history)", and "Implement other git features"; the
features chosen from V66's "later" list: "All of them". Decisions 634–645.

**Learned**:
- **Listing anew was a remount.** `HistoryPage` keyed `History` by `scope:generation`, and three
  things bumped the generation unasked: the window's focus after any branch moved (the cursor
  went to HEAD too), a workspace's tip moving (read every 5 s while an agent works, so every
  agent commit and every merge into main), and a block or search answered 409 (the whole page
  replaced by "The branches moved…"). Each one dropped the file shown (V70), its scroll and the
  pane, and showed "Listing commits…" in the page's place meanwhile. Reproduced on `main` with
  a scratch Playwright run: one listing, `.git-shown` gone, the cursor from "Add cube" to HEAD.
- **A commit's new row is the server's to say.** The first 200 rows hold the cursor's commit
  only near the top; `Histories.tips` already mapped SHAs to rows for the branches panel, so
  `GET /api/history/rows?sha=` gives the kept commit's row (and the picks', and the row kept in
  place on screen), and the block holding it is read before the swap: the pane and the file
  stay mounted, their reads not repeated.
- **The file shown was held by its row number** (`row: cursor`): a commit listed above it moved
  the row, which closed the file. It is held by its commit's SHA now; a row not read yet
  decides once it is, so a file's history can go to a row and open the file there.
- **A search's version change moved the cursor**: the search effect ran again with the new
  version and jumped to the next match. The same words now find again without moving.
- **The status's version must be the listing's.** Hidden branches change the version
  (`historyState(repo, hidden)`); `/api/status`, the listing and the search all pass the hidden
  list, or every focus would have listed anew forever.
- **`git merge refs/heads/topic` writes "Merge branch 'refs/heads/topic'"**: the branch's name
  is given (its full ref only when a tag has the name too, or it reads as an option).
- **A hidden branch is not listed, but its menu must still open**: drawn `aria-disabled` as an
  unlisted one, Playwright (and a screen reader) took it as disabled. Only a branch not listed
  for another reason is.
- **`.ask-more` was taken** (the shell's AskBar): the dialog's classes are `git-ask-*`.
- **A partial patch keeps one side whole.** Staging keeps every old line (a removed line not
  picked becomes context, an added one goes) so the old start stays; unstaging applies a patch
  of the staged diff reversed, keeping every new line. The other side's start moves by what
  earlier hunks changed; a side with no line starts at the line before (git's `-5,0`).

**Verification**: tests first, red for the right reason: `e2e/git.spec.ts` (2: a branch moved
and the focus; a workspace's agent committing, its list faked) failed on `main` with
`{ removed: true, listing: true }`; core on temporary repositories (operations 11, stash 4,
line staging 6, file log 2, `deleteRemoteBranch` 1, hidden branches in the listing 1); the CLI
(`git-page` 4, `git-hidden` 3, server 2); the viewer's pure parts (`actions` 6, `details` 3,
`branches` 1); `e2e/git-writes.spec.ts` (8, one per feature group, written with the features and
not run on `main`, where its menu entries do not exist). `pnpm check`: 2,525 unit tests (2,485
after the fix alone). The full e2e suite: 359 passed, 2 failed — `reviews.spec.ts` pins the row
menu word for word (updated: five entries), and a workspace card's chip (`workspaces.spec.ts`,
a null bounding box; 3 of 3 alone, the sidenav untouched); after the last change the Git, new,
checkout, reviews, tooltips and look specs (47) pass.

One in-place listing, timed with `curl`-like reads against `symbiote view` (a branch moved, then
the first 200 rows, the shape, the branches and the kept commit's row; four runs):

| Repository | Rows listed | First rows | Shape, branches, row lookup (together) | In all |
|---|---|---|---|---|
| This repository (a clone) | 1,127 | 18–22 ms | 11–12 ms | 29–34 ms |
| Bitwarden (a shared clone) | 23,495 | 137–144 ms | 43–50 ms | 186–193 ms |

The row lookup (8–9 ms, 42–47 ms on Bitwarden) runs beside the shape and the branches, which the
listing read before the fix too: it adds nothing to the time. What changed is that the page
stays meanwhile; before, it showed "Listing commits…" for that time and then read its rows again.

Screenshots at 1,440 × 900 and 1,280 × 800, device scale 1, dark and light: the row menu with
Merge into main's branches, the reset dialog with its count, the panel with a hidden branch and a
stash's menu, an uncommitted file's lines picked, a file's history and blame, a merge in progress
and its Abort. They found the shown file's head overflowing beside the pane (the name over "not
staged", Open in VS Code cut, the close button gone) and the stashes mid-panel; both fixed and
taken again.

Not verified: a push `--delete` to a remote that asks for credentials (the tests use a local bare
repository); a rebase that stops more than once (core continues one that stops once); line
staging on a file with Windows line ends or no newline at its end; the desktop app (the page is
the browser's); macOS and Windows.
