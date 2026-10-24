# V15 — Branch reviews in the repository

[Index](../PLAN.md) · [Journal](../journal/v15-branch-reviews.md)

**Status:** merged into main (2026-10-14, from branch `milestone/v15-branch-reviews`). As built
and results: "As built — V15" below.

**Problem** (asked: "this app will be a review app for commits made by an agent"; then, on where
reviews live: "this should be shared in the repo, so .git is not a good position...much better
to create a folder symbiote at the root, and there we should store eveythinf related, reviews etc";
and: "can't we just keep symbiote folder at the root, and gitignore it?").
An agent commits to a branch several times, and the reviewer looks at the branch after each
commit or batch. Today:

- Outside `symbiote pr`, reviewed marks and drafts are kept per pair of revisions (`stateDir` in
  `packages/cli/src/state.ts`: `<cache>/state/<repo id>/<sha256(base..head)>/`). A new commit
  makes a new pair, so the marks start empty.
- They live in Symbiote's cache (`~/.cache/symbiote`), next to throwaway worktrees: one machine, one
  person, and gone when caches are cleared.
- The commits page does not show which commits or branches were reviewed.

Measured on this repository, where an agent wrote 189 of 206 commits (`Co-Authored-By:
Claude`). Four milestone branches, each commit compared with the branch's fork point (`symbiote
diff`, 1.0–1.4 s each); the marks of the commit before (as if all were reviewed) checked
against each new commit by fingerprint, I1's rule:

| Branch (fork point) | Commits | Symbols at the tip | A commit added to a reviewed branch: marks still valid | Symbols to look at, per pair (today) / per branch |
|---|---|---|---|---|
| V9 (`b6b0016`) | 10 | 109 | 617 of 637 (96.9 %), 8 times | 732 / 115 |
| V11 (`78ca95a`) | 4 | 63 | 114 of 116 (98.3 %), 2 times | 121 / 7 |
| V12 (`d67a5d6`) | 6 | 85 | 285 of 286 (99.7 %), 4 times | 332 / 47 |
| V14 (`c2e3486`) | 3 | 12 | 11 of 12 (91.7 %), once | 12 / 1 |
| All | 23 | | 1,027 of 1,051 (97.7 %), 15 times | 1,197 / 170 (14 %) |

Of the 24 marks lost, 11 are symbols changed again (rightly "↻ changed since you reviewed it")
and 13 moved with a renamed file (`e75c1cf`: a symbol's ID holds its path).

**Goal**: "Review" a branch from the commits page. Symbiote compares the branch's fork point with
its tip and opens the diff with the reviewer's marks and drafts for that branch. After the agent
adds commits, reviewing the branch again keeps every mark whose symbol did not change, so only
new and changed symbols are left. Reviews are files in `symbiote/reviews/` at the repository's root,
one per branch and reviewer, plain JSON. By default they stay out of git: Symbiote writes a
`symbiote/.gitignore` once, and deleting it makes them commit and share like any file. Symbiote never
stages or commits them. The commits page shows each reviewed branch's
progress and the commits added since. `symbiote pr`, `symbiote diff`, compare-mode pairs and the graph
JSON do not change.

## Where reviews live (`symbiote/`)

- `symbiote/reviews/<branch>/<reviewer>.json`, at the root of the working tree `symbiote view` runs in
  (`git rev-parse --show-toplevel`):
  - `<branch>`: the branch name without its remote (`origin/topic` and `topic` are one branch).
    Its slashes become folders; git refuses `a` and `a/b` as branches, so paths cannot clash.
  - `<reviewer>`: the repository's `git config user.email`, already in every commit the
    reviewer makes. Without one, the page says so and the review stays in the cache, as today.
- One file per reviewer and branch: two reviewers never write the same file.
- Keys sorted, two-space indent, one mark per line, so git merges and diffs it line by line;
  the same review always gives the same bytes:

  ```json
  {
    "base": "<the fork point, full SHA>",
    "branch": "milestone/v14-checkout-submenu",
    "drafts": [],
    "head": "<the tip last reviewed, full SHA>",
    "marks": {
      "packages/viewer/src/checkout.ts#checkoutChoices": "<fingerprint>"
    },
    "reviewer": "anton@example.com",
    "summary": "",
    "updated": "2026-10-14T10:12:00Z"
  }
  ```

- Local by default. The first time Symbiote writes a review it creates `symbiote/.gitignore`, unless the
  file exists (then Symbiote never changes it), as pytest and ruff do for their cache folders:

  ```
  # Written by Symbiote: reviews stay on this machine. Delete this file to commit and share them.
  *
  !config.json
  ```

  Nothing shows in `git status`, an agent's `git add -A` skips open reviews, and checkouts leave
  ignored files alone. `symbiote/config.json` stays trackable: CI reads it.
- Shared, once `symbiote/.gitignore` is deleted: the files are committed like any other, where it
  suits (on the agent's branch the review travels with the work; on `main` everyone sees it).
  The format above is made for that: one file per reviewer, stable sorted lines.
- Symbiote never runs `git add` or `git commit`.
- A repository whose own `symbiote/` folder holds tracked files that are not Symbiote's (`git ls-files
  symbiote`: anything but `config.json`, `.gitignore` and `reviews/`) is left alone: reviews stay in
  the cache, and the page says why. A `*` there would hide that project's new files.
- Drafts sit in the same file: that is what feedback to the agent (later) will read.
- `symbiote/config.json` replaces `symbiote.config.json` (`plugins`); the old file is still read when the
  new one is absent. `.symbioteignore` stays at the root for now: core reads it per revision, an
  analysis change.

## Reviewing a branch

- The row menu (V14) gains "Review ▸": a submenu with the row's branches, one entry per branch
  name (local or remote), each a badge with a note: "not reviewed", or "40 of 63 reviewed · 2
  commits since". `r` on the cursor row opens it, as `c` opens "Check out".
- Not offered on the default branch (`origin/HEAD`, else `main`, else `master`): it has no fork
  point (later: review it from a commit you pick).
- Fork point: `git merge-base <tip> <default branch>`, recomputed at each review. A rebase moves
  it, and fingerprints then flag what changed, as I1 does after a rebase.
- Server: `POST /api/reviews { branch }` (a write: same-origin JSON with the custom header)
  resolves the tip and fork point, starts the analysis in `/api/diffs`' queue (the same 8 kept),
  and answers `{ url: '/review/<branch, URL-encoded>/' }`. Under that path the server serves
  the branch's diff with the viewer's files and API, as under `/diff/<pair>/`; a path opened
  anew (a reload, a new `symbiote view`) resolves the tip itself, as V9's diff URLs do.
  `./api/state/review` and `./api/state/drafts` read and write the branch's file (both in one
  file; `head` and `updated` set on each write).
- The diff page's header: "Review of wip · a1b2c3d → e4f5a6b · 2 commits since your last
  review". The change list already marks reviewed symbols and flags "↻ changed since you
  reviewed it".

## The commits page

- `GET /api/reviews` → the reviewer's reviews: branch, fork point, the tip last reviewed, the
  commits since (`git rev-list <head>..<tip>`, at most 100), marks.
- A reviewed branch's badge gets "✓" when the review's head is the tip, else "+2" (commits
  since). Rows of commits added since the review get a dot ("new since your review").

## Code

- `packages/cli/src/reviews.ts` (new): paths from branch names, the reviewer, read (missing or
  invalid → empty), write (sorted, atomic: temp file + rename, as `fileStateStore`), list.
- `packages/cli/src/server.ts`: `/api/reviews` (GET, POST) and `/review/<branch>/`.
- `packages/core/src/git`: `defaultBranch`, `forkPoint` (`merge-base`), with `isCommit`'s
  checks on what reaches git (branch names only as `listRefs` lists them).
- `packages/viewer`: the row menu's "Review ▸" (`CheckoutMenu` becomes the row menu), badges
  and dots on the commits page, the review header on the diff page.
- No graph change (no schema bump).

## Verification

1. **Unit** (red first): paths from branch names (slashes, remote prefixes); the file's bytes
   stable and sorted; a missing or invalid file; the reviewer from git config, and its absence;
   fork points on temp repositories (a branch off `main`, after `main` moved, after a rebase);
   `symbiote/.gitignore` written on the first review and never changed after, `git status` clean
   after a review, the review file untracked once `.gitignore` is deleted, a foreign `symbiote/`
   folder left alone; server: `POST /api/reviews` for an unknown branch (400), the default
   branch (refused), a state round trip writing `symbiote/reviews/<branch>/<email>.json` in the
   working tree with nothing staged.
2. **E2E** (red first), a fixture branch "written by an agent": review it from the row menu
   (header, nothing marked); mark two symbols; a commit added that changes one of them; review
   again: one still reviewed, one "↻ changed", the new symbols unmarked; the commits page shows
   "+1" on the badge and a dot on the new commit; the file in `symbiote/reviews/` survives a restart
   of `symbiote view` on a new port.
3. **Nothing else changes**: compare-mode pairs and `symbiote pr` keep their cache state (existing
   tests); goldens unchanged; every e2e spec.
4. **Real repository**: on a clone of this repository, review V12's branch at `d175ee5`, mark
   everything, move the tip to `86dcb60`: 83 of 83 marks valid, 2 symbols left (as measured).
5. **Cost**: a review is one analysis, as a picked pair (1.0–1.4 s on this repository);
   `/api/reviews` one `rev-list` per reviewed branch.

**Risks**

| Risk | Mitigation |
|---|---|
| Reviews stay on one machine by default | Asked. Deleting `symbiote/.gitignore` shares them; the format is made for it. |
| `git clean -fdx` deletes ignored files, reviews with them | Only with `-x`; the README says so. Shared reviews are in git. |
| Each worktree has its own `symbiote/`: an agent working in its own worktree does not see your reviews | Nothing reads them yet. Feedback to the agent (later) will write where the agent works, or give it the path. |
| A project with its own `symbiote/` folder | Left alone when it tracks files that are not Symbiote's; reviews stay in the cache. |
| Shared: review files carried by a checkout, or git refusing one when the target has its own version of a file | New untracked files never block a checkout (V11 counts tracked changes only); one file per reviewer and branch makes "its own version" rare; the confirmation shows git's refusal, as today. |
| Shared: an agent can write review files too, marking its own work reviewed | The file names its reviewer and git says who committed it. Not enforced (later: a warning when a review file's last commit is not by its reviewer). Local reviews: anything on the machine can write them. |
| Shared: the same reviewer on two machines edits one file | Sorted JSON, one mark per line: a conflict is a few plain lines. |
| Email addresses in the tree | The same as in commit metadata; a noreply address works the same. |
| A renamed or deleted branch | The review stays as history; a new name starts a new review. |
| A renamed file loses its marks (13 in the measurement) | I1's limit, unchanged. |
| Commits of review files show in diffs' file lists (`graph.files` lists non-code files) | No symbols, so no changes or findings; used only for comment anchors. |

**Order**: V15a (reviews in `symbiote/`, "Review" a branch: core, server, menu, header); V15b (the
commits page shows progress); V15c (`symbiote/config.json`). One branch.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V15a ✅ | Branch reviews | `symbiote/reviews/<branch>/<reviewer>.json`, local by default (`symbiote/.gitignore`); "Review ▸" in the row menu; `/review/<branch>/` with marks kept across new commits; the review header. |
| V15b ✅ | Progress on the commits page | `GET /api/reviews`; "✓" or "+n" on reviewed branches' badges; dots on commits added since. |
| V15c ✅ | `symbiote/config.json` | Plugins read from `symbiote/config.json`, else `symbiote.config.json`. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 71 | Where reviews live | **`symbiote/reviews/` at the repository's root, kept out of git by a `symbiote/.gitignore` Symbiote writes once (`*`, `!config.json`) and never changes after; deleting it shares reviews through commits; Symbiote never stages or commits** | Asked: a folder at the root, then "gitignore it". `.git` cannot be shared and the cache is cleared with caches; `symbiote/config.json` must still reach CI. Pytest and ruff keep their folders out of git the same way. |
| 72 | What a branch review is keyed by | **The branch name without its remote; marks checked by fingerprint** | Measured: 97.7 % of marks still valid after a new commit; per pair, none. |
| 73 | Whose review a file is | **One file per reviewer, named by `git config user.email`** | Two reviewers never write one file; the email is already in their commits. |
| 74 | Where a branch review starts | **The fork point with the default branch, recomputed each time; not offered on the default branch** | What a pull request of the branch would show; the default branch has no fork point. |
| 75 | What stays in the cache | **Compare-mode pairs and `symbiote pr` reviews** | A picked pair is a look, not a branch's review; `symbiote pr`'s review goes to the forge, and its marks already outlive pushes. |

**Not in V15 (later)**: feedback to the agent (drafts as a prompt or file it reads); agent
commits marked (co-author trailers, bot authors, branch names like `codex/`); a commit's details
beside the list; reviewing the default branch from a picked commit; other reviewers' reviews on
the commits page; `.symbioteignore` in `symbiote/`; checking who last committed a review file.

## As built — V15

- **Core** (`src/git/branches.ts`): `defaultBranch`, `forkPoint`, `commitsBetween`,
  `userEmail`, `trackedFiles`, and the types the viewer reads. `forkPoint` takes the latest
  merge-base among the default branch's local and remote refs, not `merge-base <tip> <default>`
  as planned: an agent that branched from `origin/main` while the local `main` was stale would
  otherwise have its review start before commits that are not its own. `trackedFiles` uses a
  `:/symbiote` pathspec, so `symbiote view` started in a subfolder checks the right folder. No analysis
  code changed: the goldens are unchanged.
- **CLI** (`src/reviews.ts`): as planned. Marks and drafts share one file, so writes go one at
  a time per file (read, change, write back, atomically). A branch name only remotes have (a
  review's address opened anew) is found on `origin` first. The server keeps the review each
  branch's page shows; asking again re-resolves the tip. A review page whose branch cannot be
  reviewed answers its graph with the reason (404).
- **Viewer**: `CheckoutMenu.tsx` became `RowMenu.tsx` (entries, each with a submenu; ↑/↓ move
  between entries, `RefBadge`) and `CheckoutDialog.tsx`. The Review submenu has an entry per
  branch name: a row holding `v12` and `origin/milestone/v12-open-in-vscode` at the same commit
  offers both. Its note says "12 reviewed · 2 commits since", not the planned "40 of 63": the
  total needs the analysis. Reviews are read again when the page is back in focus (a review is
  made on another page; its marks do not change the history's version).
- The review page's header is "Review of wip · 2 commits since your last review", without the
  planned SHAs: the summary right after it already shows them (seen on the first screenshot).

**Results (V15)**. Tests first: core 7 of 7 and CLI 11 of 11 failed before the code existed,
the server's 5 new tests failed (no routes), the e2e spec failed on the missing "Review" entry.
Now 587 unit tests (29 new: core 8, CLI 17 with server and config, viewer 4) and 67 e2e (1 new:
review an agent's branch, mark both changes, the file in `symbiote/reviews/` with `git status`
clean, "✓"; the agent changes `square` and adds `half`: "+1" and a dot; reviewing again from
the keyboard leaves 1 of 3 with one symbol "changed since you reviewed it"; a restarted
`symbiote view` on a new port finds the review).

On a clone of this repository with `main` set back before V12's merge (`d67a5d6`), through
`symbiote view`'s API: reviewing `v12` at `d175ee5` gave 83 changed symbols, all marked; with the tip
moved to `86dcb60`, `/api/reviews` reported "+1" and that commit, and reviewing again found 83
still reviewed, none changed, 2 left, as the spike measured. From "Review" to the graph: 1.6–1.7
s. The file landed in `symbiote/reviews/v12/reviewer@example.com.json`; `git status` stayed clean.
`GET /api/reviews`, which the commits page now asks for beside its first rows: 10 ms on Qwik
(694 refs), 24 ms on Bitwarden (2,231 refs), 14 ms with one review (medians of 5). Screenshots
light and dark: the badge's "+1", the dot, the Review submenu, the review header; no page
errors.

Not verified: Windows and macOS (branch folders, `@` in file names); a review shared through
git and merged from two machines (the format is made for it, not exercised); worktrees; Firefox
and Safari; first rows drawn (not re-measured: the reviews request runs beside the listing).
