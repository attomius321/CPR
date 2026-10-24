# V11 — Checkout from the commits page

[Index](../PLAN.md) · [Journal](../journal/v11-checkout.md)

**Status:** merged into main (2026-10-13, from branch `milestone/v11-checkout`): V11b and V11c;
V11a dropped (the user: V10a's "All branches · This branch" switch already does it). As built and
results: "As built — V11" below.

**Problem** (asked: "let's make a mini git extension out of this … checkout to branch/commit/
tag as a first feature, also, a checkbox with Show only this branch commits"). The commits page
shows every branch (V10a) but changes nothing: to check out what it shows, the reviewer goes to
a terminal. And the page does not notice. On a clone of this repository, after `git switch
--detach HEAD~5` in a terminal, the open page still showed HEAD at `78ca95a`, before and after
scrolling to the end: its 181 rows were all in the first block, so it asked for nothing and met
no 409. Only a reload showed `41e6cc1`. On a longer history it notices only when it asks for a
new block ("The branches moved…").

What git does, measured on that clone (713 files):

| Case | `git switch` |
|---|---|
| To a commit 60 back (647 files differ) / the first commit (104) / back to the tip (713) | 18 / 6 / 54 ms |
| A local change to a file the target does not change | carried along (` M .editorconfig` after) |
| A local change to a file the target changes | refused, nothing changed: "Your local changes to the following files would be overwritten by checkout: README.md" |
| A branch checked out in another worktree | refused: "'other-branch' is already used by worktree at …" |
| `git switch <name>` for a remote-only branch | creates `<name>` tracking `origin/<name>` |
| Counting local changes (`git status --porcelain=v2 --untracked-files=no`) | 10 ms (713 files), 3 ms on ky (115) and zod (742) |

So git already refuses whatever would lose work, and says why; a checkout costs tens of
milliseconds here (git's own cost, growing with the files that differ).

**Goal**: from the commits page, check out a local branch, a remote branch (as its local
tracking branch), a tag or a commit (detached HEAD), after a confirmation that says what will
happen; the page then shows the new HEAD (lane 0, cursor, badges). A checkout made elsewhere
shows when the page gets focus. "Show only this branch's commits" is a checkbox. `symbiote diff`,
`symbiote pr` and diff pages do not change.

## What can be checked out (core)

- `checkout(repo, target)` in `src/git/checkout.ts`, the target one of:
  - `{ kind: 'branch', name }` → `git switch --no-guess <name>`;
  - `{ kind: 'remote', name: 'origin/x' }` → the local branch `x`: absent, `git switch --create
    x --track origin/x`; present and tracking `origin/x`, `git switch x`; present and tracking
    something else, refused ("a local branch x exists and tracks origin/y");
  - `{ kind: 'tag', name }` and `{ kind: 'commit', sha }` → `git switch --detach <commit>`.

  Never `--force`, `--discard-changes` or `--merge`: what git refuses is refused, with its
  message.
- Names only as `listRefs` lists them (exact match; a name starting with `-` refused), SHAs only
  full and `isCommit`: nothing else from the request reaches git, as with V9's diffs.
- Refused while a merge, rebase, cherry-pick, revert or bisect is in progress (their files in the
  worktree's own git dir, `git rev-parse --git-dir`).
- HEAD is read again after git returns: a failing post-checkout hook makes git exit non-zero
  after HEAD moved, and the answer says "checked out; the post-checkout hook failed: …".
- `workingState(repo)`: `{ changed, operation }` — tracked files with local changes, and the
  operation in progress or null.
- `listRefs(repo)` (from V10b's plan, brought forward): local branches with their upstream,
  remote branches with their remote (the configured remote whose name prefixes the ref), tags
  peeled to their commit. The menu offers what it lists.

## Server

- `GET /api/status` → `{ version, branch, head, changed, operation }`; `GET /api/refs` →
  `listRefs`'s answer.
- `POST /api/checkout { kind, name | sha }`: a write like the others (same-origin JSON with the
  custom header), one at a time. 200 `{ branch, head, warning? }`; 400 for a name or SHA the
  repository does not have; 409 for a refusal (git's or ours), with the message.
- After it the history's version has changed (HEAD moved): the page lists anew, by V10a's path.

## Viewer

- A menu per row: right-click, the row's "⋯" (on hover and on the cursor row), or `c` on the
  cursor row. Its entries come from the row's refs and `/api/refs`:
  - each local branch: "Check out branch wip" (the current one disabled: "checked out");
  - each remote branch: "Check out origin/topic as topic", or "… (tracked by topic)" when a
    local branch tracks it; disabled with the reason when a local branch of that name tracks
    something else;
  - each tag: "Check out tag v1 (detached HEAD)";
  - always "Check out this commit (detached HEAD)".
- A confirmation says what will happen: the branch checked out or created, or the detached HEAD;
  "3 files have uncommitted changes: they come along, unless the target changes them too — then
  git refuses and nothing changes"; an operation in progress disables "Check out" and says
  which. Enter confirms, Escape cancels.
- While it runs: "Checking out…". Then the history is listed anew, the cursor goes to HEAD, and
  a line under the title says "Switched to branch wip" or "HEAD is now at 9c1e0aa (detached)". A
  refusal shows git's message in the confirmation, and nothing else changes.
- On focus (`visibilitychange`, `focus`): `GET /api/status`; a version other than the page's
  lists anew (a checkout or a commit made elsewhere).
- "Show only this branch's commits": a checkbox replacing V10a's two buttons, named for the
  branch ("Show only main's commits"; detached: "Show only HEAD's commits"), kept in the URL as
  before. After a checkout, "this branch" is the new one.

## Verification

1. **Unit** (red first), core on temp repositories: each kind of target; a local change carried;
   one refused (git's message, HEAD unchanged); a branch checked out in another worktree; a merge
   in progress; a remote whose local name tracks another; unknown names, short SHAs, a name
   starting with `-`; a failing post-checkout hook (HEAD moved, the warning). `workingState`
   (counts, each operation), `listRefs`. Server: `/api/checkout` refusals (another site, an
   unknown ref, one already running); a checkout changes `/api/status`'s version.
2. **Nothing else changes**: goldens; `symbiote diff` and `symbiote pr` tests; every e2e spec.
3. **E2E** (a fresh fixture repository per test: checkouts change it): the menu's entries per
   row; `wip` → its HEAD badge, lane 0 on its line, the cursor, "Switched to branch wip";
   `origin/topic` → a local `topic`; tag `v1` → detached, the checkbox says "HEAD's"; a
   conflicting local change → git's message, nothing changed; a terminal checkout shows on
   focus; the checkbox and the URL.
4. **Real repositories**: on clones (never a working tree in use): a branch, a remote branch, a
   tag, a commit on this repository's clone and on a full clone of Qwik; the round trip
   (checkout and relisting) against the checkout and the listing alone.
5. **Cost**: the round trip no more than git's checkout plus V10a's listing (0.02 s on Symbiote,
   0.8 s on CPython without a commit-graph file) plus 100 ms.

**Risks**

| Risk | Mitigation |
|---|---|
| A checkout changes the user's working tree: the first thing Symbiote writes outside its cache | `git switch` only, never forced; a confirmation every time; git's refusals shown; no reset, stash or discard. |
| A detached HEAD surprises | The menu, the confirmation and the line after say "detached"; the checkbox says "HEAD's". |
| Hooks (husky) run, can be slow or fail | Run as git runs them; "Checking out…" meanwhile; a failure after HEAD moved is a warning. |
| An editor sees files change under it | That is a checkout; the confirmation says the working tree changes. |
| A page acts on a stale view (another tab or a terminal checked out) | Names and SHAs are checked against the repository when asked; the page lists anew on focus. |
| Requests from other sites | Same-origin JSON with the custom header, like every write. |
| Analyses running meanwhile | They use Symbiote's cached worktrees, never the working tree: unaffected. |

**Order**: V11a (the checkbox, viewer only), V11b (status and refs; the page notices changes on
focus), V11c (checkout), on one branch.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V11a (dropped) | Show only this branch's commits | V10a's switch already does it. |
| V11b ✅ | Status and refs | `workingState`, `listRefs`, `/api/status`, `/api/refs`; the page lists anew on focus when the version changed. |
| V11c ✅ | Checkout | `checkout`, `POST /api/checkout`, the row menu (right-click, "⋯", `c`), the confirmation, the line after. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 54 | How a checkout runs | **`git switch`, never forced: local changes come along unless the target changes them too; then git refuses and nothing changes** | Measured: git carries what it can, refuses what would be lost and names the files. Options that stash or discard (Git Extensions has them) can lose work; later, if asked. |
| 55 | A remote branch | **Its local tracking branch: created if absent, checked out if it tracks it, refused if a branch of that name tracks something else** | What `git switch <name>` does by default, without its guessing where it would be ambiguous. |
| 56 | Tags and commits | **A detached HEAD, said before and after** | Git's own way; creating a branch there is a separate action (later). |
| 57 | Operations in progress | **Refused: merge, rebase, cherry-pick, revert, bisect** | Checking out in the middle of one leaves a state the page cannot show. |
| 58 | What a request may name | **Refs as `listRefs` lists them, by exact name; full SHAs of commits** | As V9's diffs: nothing else from a page reaches git. |
| 59 | "This branch" | **V10a's "All branches · This branch" switch stays (no checkbox); after a checkout, "this branch" is the new one** | Asked first for a checkbox, then: "I didn't see that we already have a switch between All branches, and current branch". |

**Not in V11 (later)**: creating, renaming or deleting branches; stash, reset, merge, rebase,
fetch, pull, push; choosing what to do with local changes (stash, discard); untracked files;
the branches panel (V10b), where a double-click could check a branch out.

## As built — V11

- **Core**: `listRefs` in `src/git/refs.ts` (one `for-each-ref`, `%1f`-separated; the remote of
  `refs/remotes/a/b` is the longest configured remote prefixing it; a remote's `HEAD` and tags
  on trees or blobs left out). `workingState` and `checkout` in `src/git/checkout.ts`; the
  operation is read from `git rev-parse --absolute-git-dir` (`rebase-apply/applying` is `am`).
  A remote branch with no local branch of its name: `git switch --create x --track
  refs/remotes/origin/x` (the full ref, never a guess); git sets up tracking only for a remote
  it has configured. `RepoStatus` is `HistoryState & WorkingState`.
- **Server**: `GET /api/status`, `GET /api/refs`, `POST /api/checkout` as planned; a refusal is
  409 `{ error }` with git's words; a second checkout while one runs is 409 too.
- **Viewer**: `src/checkout.ts` (pure: the menu's entries, the note on local changes, the line
  after) and `src/CheckoutMenu.tsx` (menu and confirmation). A remote branch whose tracking
  branch is on the same row gets no entry of its own (the branch's covers it). After a checkout
  `CommitsPage` lists anew in a new generation of the page (fresh rows, lanes and picks; the
  cursor on HEAD) and shows the line above the rows; a stale page's "List them again" does the
  same instead of reloading. "c checks out" joins the help line.
- Test helper: `createRepo`'s `git` keeps stderr in the error (a test that conflicts on purpose
  printed git's "could not apply" into every `pnpm check`).
- **HEAD stands out** (asked after trying a checkout: "the current HEAD marker is not really
  visible"): HEAD and its branch are one solid badge, "HEAD → main" (`rowBadges` in
  `src/commits.ts`; detached: "HEAD", titled so); HEAD's row is tinted with a bold subject; its
  dot has a green ring; the title has a "HEAD → main" chip that goes to HEAD from anywhere in the
  history.

**Results (V11)**: from "Check out" to the page drawn again, on a clone of this repository
(181 commits, plain fonts): a remote branch (creating its local branch) 109 ms, a branch 112 ms,
the first commit (detached, 713 files changed) 115 ms. Tests: 519 unit (24 new: core 15,
server 3, viewer 6), 53 e2e (5 new: the menu's entries per row; a branch with HEAD, lane 0 and
the cursor following; a remote branch from the keyboard and a tag detached; git's refusal with
nothing changed; a terminal checkout shown on focus). Not verified: a large working tree (the
regression clones of Qwik, Bitwarden and CPython have none: they are history only), Windows
and macOS, a checkout through a hook that is slow (husky).
