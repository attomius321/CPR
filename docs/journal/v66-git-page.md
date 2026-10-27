# Journal: V66 — Git: History renamed, a commit's details, changes, branches and remotes

[Index](../JOURNAL.md) · [Plan](../plan/v66-git-page.md)

## V66 spike — what git costs for a commit's details, a search and the status (2026-10-27, branch `feature/history-feature`)

Read History's page, its plans' "later" lists (V9, V10, V10b, V11, V13) and the header's CSS;
timed git on this repository (891 commits) and on Bitwarden's blobless regression clone (43,138).

**Learned**:
- **The scrollbar beside the header is the sticky header**: `.commits-title` is `position: sticky`
  inside `.commits-scroll`, which scrolls, so the track spans the card. Settings, Skills and the
  Monitor share the class but scroll beneath it.
- **Line counts cost a fetch on a blobless clone**: `git show --numstat` took 565–940 ms on
  Bitwarden (3 ms once fetched), `--name-status` 1 ms; on this full clone both take 2–9 ms. The
  pane asks for names first, lines after.
- **A search is half a second on Bitwarden**: `git log --all -i --grep` 451 ms, every subject and
  author 671 ms; it is the server's work, the rows mapped by the listing.

## V66 — Git: History renamed, a commit's details, changes, branches, remotes, search (2026-10-27, branch `feature/history-feature`)

History is Git at `/git` (`g`), its header above the rows' scroll box. A selected commit shows in
a pane on the right (or below, from Settings → Appearance): message, people, parents, refs,
files and a file's diff, Review this commit. The uncommitted changes are a row above the commits,
staged, unstaged and committed in the pane. Branches and tags are made at a row and renamed or
deleted from the branches panel; the page's head fetches, pulls (fast-forward only, merge,
rebase), pushes and finds commits. Decisions 475–484.

**Learned**:
- **The scrollbar beside the header** was the header's `position: sticky` inside the box that
  scrolls. The card is now a column, the header then the scroll box; Settings keeps the shared
  class's sticky, as its page scrolls under its head.
- **A pane on the right squeezes the rows to nothing at 1,280 px**: 320 px, the subjects 0 px
  wide, and four existing specs (monitor, report, tooltips, commits) failed on a hidden
  `.commit-subject`. The breakpoint is a container query on the page's body, not a media query:
  the sidenav's width is the person's to drag.
- **`commit` is a read and a write at one path** (`GET` a commit's details, `POST` a commit): the
  first routing by name sent the read to the write's 405.
- **Tests that were wrong, not the code**: `git rm --cached` keeps the file, so unstaging it
  leaves no change; a conflict on a file both sides had is `UU`, not `AA`; `git pull --rebase`
  replays every local commit and drops the merge.
- **A full e2e run during rebuilds fails at random**: the first full run overlapped two viewer
  builds; its results were thrown away and the suite run again on one build.
- **A button name is a substring match**: `commits.spec.ts` checked there is no "This commit"
  button; once the pane had loaded, "Review this commit" was one, so the test failed only when
  the details came first. The check is exact now.

**Verification**: tests first (red for the right reason) for each part, listed in the plan's
results; `pnpm check` (1,965 tests after merging `main`); the full e2e suite (316 passed on the merged
build); the endpoints timed on
Bitwarden and zod (a commit 4–10 ms, Bitwarden's lines 626 ms on its blobless clone, a search
366 ms there, 33 ms on zod); screenshots at 1,440 × 900 and 1,280 × 800, device
scale 1, dark and light (the pane, the uncommitted changes, the row menu, the new-branch dialog,
a search). No analysis code changed: no `regression-check`.

Not verified: a push or fetch over SSH or HTTPS with credentials (the tests use a local bare
repository); a commit signed with a GPG key that asks for its passphrase; the desktop app (the
page is the browser's, `title-bar.spec.ts` compares them).
