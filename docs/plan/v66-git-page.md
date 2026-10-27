# V66 — Git: History renamed, a commit's details, changes, branches and remotes

[Index](../PLAN.md) · [Journal](../journal/v66-git-page.md)

**Status:** ready for review (2026-10-27), on branch `feature/history-feature` (a Symbiote
workspace). Its "As built" and results below.

**Problem** (asked: "Need to extend the history features. Rename this page to Git." and "i also
don't like the scroll that it goes next to the header"). History lists every branch's commits as a
graph (V10), with a branches panel (V10b), compare (V13), checkout (V11, V14), branch reviews
(V15) and "Start a workspace here" (V18). For everything else the person leaves for another git
tool; five plans left it "later":

| Left for later by | What |
|---|---|
| V10, V13 | A commit's message and files |
| V9, V10 | Uncommitted changes as a row |
| V10b, V11 | Creating, renaming, deleting branches; fetch, pull, push |
| V11 | Stash, reset, merge, rebase from the page |

The scrollbar runs beside the header: the header (`.commits-title`, 48 px) is `position: sticky`
inside the box that scrolls (`.commits-scroll`), so the scrollbar's track starts at the card's
top. Settings, Skills and the Monitor use the same class for their heads but scroll beneath them.

Measured (2026-10-27): this repository (891 commits, 54 local and 166 remote branches) and
Bitwarden's blobless clone (43,138 commits):

| What git does | This repository | Bitwarden (blobless) |
|---|---|---|
| A commit's details and files (`git show --name-status`) | 2–9 ms, merges included | 1 ms |
| Its files' line counts (`--numstat`) | 2–9 ms | 565–940 ms: the blobs are fetched first |
| `git status --porcelain=v2` | 9 ms | — |
| Searching every commit (`git log --all -i --grep`) | — | 451 ms |
| Every subject and author (`git log --all --format`) | — | 671 ms |

**Goal**: the page is **Git**, at `/git`, opened with `g`. Its header stays put and the scrollbar
starts under it. Selecting a commit shows its message, people, parents, refs and files, a file's
diff, and "Review this commit"; the pane is on the right, or below the rows if chosen in
Settings → Appearance. Uncommitted changes are a row above HEAD: their files can be staged,
unstaged and committed. Branches and tags can be made, renamed and deleted; Fetch, Pull
(fast-forward only, merging or rebasing) and Push are in the header; commits can be found by
subject, body, author or SHA. **Unchanged**: the graph, compare, checkout, branch reviews and
workspaces; `symbiote diff`, `symbiote pr` and a diff's pages.

## V66a — The name, the address and the header

- The sidenav entry is **Git**, with a branch icon and the key `g` (`h` goes; `g` is free in the
  shell). The page is at `/git` (`GIT_PAGE` in `shell/pages.ts`), `?scope=current` and
  `?branch=` as today; `/history` and `/` are moved there as the old Workspaces addresses are
  (`routeOf`'s `moved`), and the server serves `/git` (`server.ts`). Window title "Git — repo",
  a diff's back link "Git", the help label "Git's keys", the docs (README, `commands.md`, the
  guide).
- In code the list keeps its names: the folder `history/`, `/api/history…`, `Histories`. It is
  still the history; the API stays stable and the rename stays reviewable.
- The header leaves the scroll box: the card is a column, the header then the rows' box
  (`.commits-scroll`), which alone scrolls. The rows measure their view from that box
  (`list.offsetTop` becomes 0).

## V66b — A commit's details

- Selecting a row (click, j/k) shows its commit in a pane beside the rows: subject and body, the
  SHA with Copy, author and committer (when different) with dates, parents (each a link to its
  row), the row's branches and tags, and its files against the first parent: status, path,
  +/− lines (the workspace's `FileRow`), with totals.
- Placement: **right** (default) or **below**, in Settings → Appearance, kept in this browser
  like the theme (`symbiote.viewer.details`). The pane is resizable with `Resizer` and folds
  (`d`). Under 900 px it goes below.
- A file opens its diff in the pane: git's diff against the first parent, read by the Files
  page's `parseFileDiff` and folded by `foldRows` (3 lines of context); Open in VS Code as V43.
- **Review this commit**: the commit against its parent on a diff's page, the one-step compare
  V13 left for later.
- API (`packages/cli/src/server.ts`, core `git/show.ts`): `GET /api/history/commit?sha=` (details
  and file names), `GET /api/history/commit/lines?sha=` (line counts, asked after the names: on a
  blobless clone they cost a fetch), `GET /api/history/commit/file?sha=&path=` (one file's diff).
  Only full SHAs a listing has; paths only those the commit changes (decision 58).

## V66c — Uncommitted changes, staged and committed

- When the checkout has changes, a row above HEAD: "Uncommitted changes · N files", its node
  hollow on HEAD's lane. It is read with `git status` (9 ms) when the page lists, and when the
  window gets the focus again, as the page already checks for moved branches.
- Selected, the pane lists its files in two groups, **Staged** and **Changes** (not staged,
  untracked, conflicted), each with Stage or Unstage, and Stage all / Unstage all. A file opens
  its diff: staged against HEAD, not staged against the index; an untracked file whole.
- Under them, the commit box: a message (subject, blank line, body) and **Commit** (staged files
  only; Ctrl+Enter). Git runs its hooks; a hook's refusal is shown in git's words. Amend: a box
  to tick, which takes the last commit's message when empty.
- API: `GET /api/git/changes`, `POST /api/git/stage`, `/unstage` (paths), `POST /api/git/commit`
  (`message`, `amend`). Paths only those `git status` lists.

## V66d — Branches and tags

- A row's menu: **New branch here…** (its name checked by `branchNameProblem`; "Check it out"
  ticked by default) and **New tag here…** (a message makes it annotated).
- The branches panel: a branch's menu (right-click or its "⋯"): Check out, Rename…, Delete…,
  Review; a double-click checks it out. A tag can be deleted from its badge's row menu.
- Delete runs `git branch -d`. When git refuses because the branch is not merged, a dialog says
  how many commits only it holds and offers **Delete anyway** (`-D`). Refused: the branch checked
  out, a workspace's branch (deleting the workspace does that), a branch checked out in another
  worktree (git's words).
- API: `POST /api/git/branch` (`create`, `rename`, `delete`, `force`), `POST /api/git/tag`
  (`create`, `delete`).

## V66e — Fetch, pull, push

- In the header: **Fetch** (every remote, `--prune`), **Pull** with its choice — fast-forward
  only (the default), merging, rebasing — and **Push**, with the current branch's ↑ahead ↓behind
  on them.
- Pull never stashes or discards: git refuses what would be lost and says which files. A merge or
  rebase that stops on conflicts leaves the operation in progress and says so; the page lists the
  conflicted files in the uncommitted row.
- Push sends the current branch to its upstream; without one, to `origin` with `-u`, said in the
  button's tip first. Never forced.
- Every network run has `GIT_TERMINAL_PROMPT=0` (a credential prompt fails instead of hanging)
  and a 2-minute limit; the status bar says what runs and how it ended.

## V66f — Find a commit

- A search field in the header (`f`, Escape leaves): subject and body (`--grep`, `-i`), author,
  or a SHA prefix, over the listing's scope. The server maps matches to rows
  (`Histories.tips`); the rows are marked, Enter and Shift+Enter in the field step through them
  (`n` is the shell's Start a workspace) and the field says "3 of 41".

## Writes, all parts

- Every write goes through one queue per repository: one git write at a time. Every write is
  refused while a merge, rebase, cherry-pick, revert or bisect is in progress (decision 57),
  except staging, unstaging and committing, which finish a conflicted merge.
- Requests carry `x-symbiote: 1` like checkout's; after a write the page lists again
  (`onRelist`), the cursor kept on its commit.

## Verification

1. **Tests first** (red before): core on temporary repositories for every git step (details,
   files, diff, status, stage, unstage, commit, amend, branch and tag create/rename/delete,
   fetch/pull/push against a bare repository as `origin`, search); the server's new endpoints and
   their refusals (`server.test.ts`); the viewer's pure parts (routes, placement, search steps);
   Playwright: the address and the key, the header and the scrollbar, the pane in both places,
   staging and a commit, a branch made and deleted, a pull and a push to a local bare remote,
   a search.
2. **Nothing else changes**: `pnpm check`; every existing e2e spec (title-bar's page list with
   `/git`); no analysis change, so no `regression-check`.
3. **Viewer**: the `viewer-check` skill: screenshots of the Git page and its states at 1440×900,
   device scale 1, dark and light; every page audited (the header class is shared); first paint
   of `/git` against `main`'s `/history`.
4. **Cost**: first paint no slower than `main` (the pane's calls come after a selection);
   details shown within 50 ms on this repository.

**Risks**

| Risk | Mitigation |
|---|---|
| A write loses work | Never `--force`, never `reset --hard`, no stash or discard; git refuses and says why |
| Credentials prompt hangs a request | `GIT_TERMINAL_PROMPT=0`, a time limit |
| Line counts on blobless clones | Names first, lines after |
| The header move breaks the rows' placement | e2e for scrolling, j/k reveal, the kept cursor |

**Order**: V66a, then b (the pane the rest uses), c, d, e, f.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V66a | Git: the name, `/git`, `g`, the header out of the scroll | routes, sidenav, CSS |
| V66b | A commit's details, right or below | pane, three endpoints, Appearance choice |
| V66c | Uncommitted changes: stage, unstage, commit | row, pane, four endpoints |
| V66d | Branches and tags: make, rename, delete | menus, dialogs, two endpoints |
| V66e | Fetch, pull, push | header buttons, three endpoints |
| V66f | Find a commit | field, endpoint |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 475 | The page's name and address | **Git, at `/git`; `/history` and `/` moved there; the code's `history/` and `/api/history…` kept** | Asked; the API and folder are still the history |
| 476 | Its key | **`g`, `h` gone** | Asked ("yes") |
| 477 | The scrollbar | **Only the rows scroll; the header is above the scroll box** | Asked; Settings, Skills and Monitor already work so |
| 478 | Where a commit's details show | **A pane on the right, or below by Settings → Appearance (this browser)** | Asked: "Option from settings - default on the right" |
| 479 | A commit's files | **Against its first parent; names first, lines after** | A merge's files are what it brought in; lines cost a fetch on blobless clones (565–940 ms) |
| 480 | Uncommitted changes | **A row above HEAD; files staged and unstaged whole; commit and amend** | Asked: "Stage and commit also"; hunks are later |
| 481 | Deleting a branch | **`-d`, then "Delete anyway" (`-D`) after the commits it alone holds are counted** | Nothing lost without saying so |
| 482 | Pull | **Fast-forward only by default; merging or rebasing chosen** | Asked: "All"; fast-forward never makes a commit the person did not ask for |
| 483 | Push | **The current branch to its upstream, `-u origin` when none; never forced** | Force pushes lose others' work |
| 484 | Writes | **One at a time per repository; a pull refused during an operation** (checkout already is) | Decision 57; a conflicted merge must still be finishable, and branch and tag edits leave the working tree alone |

**Not in V66 (later)**: staging hunks or lines; stash; cherry-pick, revert, reset; merging or
rebasing a branch picked on the page; a file's history and blame; deleting remote branches;
hiding branches from the graph.

## As built (V66)

- **One API, `/api/git/…`** (`packages/cli/src/git-page.ts`, routed in `server.ts`), not
  `/api/history/commit…`: reads `commit`, `commit/lines`, `commit/file`, `changes`,
  `changes/lines`, `changes/file`, `sync`, `find`; writes `stage`, `unstage`, `commit`,
  `branch`, `tag`, `fetch`, `pull`, `push`. `commit` is both a read (GET) and a write (POST):
  the server routes by method. Core's parts: `git/commit-info.ts`, `git/working-changes.ts`,
  `git/ref-edits.ts`, `git/sync.ts`, `findCommits` in `git/log.ts`, and `GitRefused` (git's
  words, nothing changed). `git()` takes a timeout and extra environment; `gitInput` keeps git's
  stdout on failure, where a hook may say why.
- **A head of its own.** The search, Fetch, Pull and Push did not fit the rows' header: beside
  the pane it is about 480 px wide at 1,440 px, and it wrapped onto three or four lines. The page
  has a head like Settings', Skills' and the Monitor's: the icon, "Git", the branch against its
  upstream ("main · 2 to push, against origin/main"), then Find a commit, Fetch, Pull ▾, Push and
  Details (`d`). The rows' header keeps what it had before V66.
- **Where the pane goes.** On the right by default, below from Settings → Appearance (kept in the
  browser, `symbiote.viewer.details`). It goes below anyway when the page's body is under
  1,040 px (a container query, so the sidenav's width counts, not the window's): at 1,280 px on
  the right the rows had 320 px and their subjects none, which four existing specs caught. Rows
  narrower than 640 px drop the author's column. On the right the pane is resizable (300 px at
  least, the rows keeping 400) and gives way before the rows do; below it takes 42 % of the
  height, the rows keeping 180 px, and is not resizable (the resizer is horizontal only).
- **The uncommitted row is row −1**, a row above the list: the rows' math (`list.offsetTop`)
  already placed the list under the header that was there before, so j/k, reveal and the kept
  cursor work unchanged. Its dot is hollow and dashed on lane 0, HEAD's.
- **Branches in the panel**: no "⋯" on an entry (its row is one button, the workspace mark a link
  beside it); a right-click opens the menu (Check out…, Go to its tip, Review, Rename…, Delete…)
  and a double-click checks out through the row menu's confirmation (`branchChoice`). The keys'
  help says so: the entry's tooltip stays its name, shown only when cut (V54;
  `branches.spec.ts`).
- **A new branch's name** is checked against local branches only: `branchNameProblem` also
  refuses a remote's name, right for a workspace's branch, wrong for "New branch here".
- **Pull** opens its three ways each time (Fast-forward only, Merge, Rebase); none is
  remembered. A pull that stops on conflicts is not a refusal: the status bar says so and the
  conflicted files are in the uncommitted row.
- **Search keys**: Enter and Shift+Enter in the field; `n` stays the shell's Start a workspace.
  A match is underlined in amber (`--modified`): `--accent` is not for states (`tokens.test.ts`).
- **Not built**: Open in VS Code from the pane (a commit's file, or an uncommitted one).

**Results.** Tests first, red for the right reason, for each part: `pages.test.ts` and
`server.test.ts` (the address); core's `commit-info` (6), `working-changes` (9), `ref-edits`
(7), `sync` (7, a bare repository as `origin`), `findCommits`; the CLI's `Histories.find`,
`git-page` (4) and the server's four route tests; the viewer's `details.test.ts` (6) and
`branchChoice`. e2e: `history.spec.ts`'s header test (the scroll box started at y = 8, above the
header's 57) and `git.spec.ts` (6: the pane and its place, staging and a commit, branches and
tags, fetch/pull/push against a local bare remote, search). Existing specs follow the rename, the
row menu's two entries and the keys' help.

`pnpm check`: 1,951 unit tests; the full e2e suite: 314 passed. The endpoints, timed with
`curl` against `symbiote view` (a second ask in brackets):

| Repository | `commit` | `commit/lines` | `changes` | `changes/lines` | `sync` | `find` ("fix") |
|---|---|---|---|---|---|---|
| Bitwarden (blobless, 43,138 commits) | 10 ms (6) | 626 ms: blobs fetched | 31 ms | 7 ms | 24 ms | 366 ms (364) |
| zod | 5 ms (4) | 8 ms | 25 ms | 25 ms | 8 ms | 33 ms (34) |

The pane shows a commit's names within 10 ms; on a blobless clone its lines come after, as
planned.
