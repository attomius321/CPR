# V10c — Picks across branches: diverged picks compared from their fork point

[Index](../PLAN.md) · [Journal](../journal/v10c-picks-across-branches.md)

**Status:** merged into main (2026-10-14, from branch `milestone/v10c-picks-across-branches`).
As built and results: "As built — V10c" below. Planned with V10 (decision 52, "Picking across branches" there); refined here, before V10b, on
today's code and measurements.

**Problem** (asked: "let's do v10c first"; "be absolutely sure that it renders the correct
changes, in most of the cases"). Since V10a the commits page lists every branch, and compare mode
(V13) picks any two rows. Two picks on branches that diverged are compared **directly**: the
server analyzes every pair with `symbiote diff <base> <head> --no-merge-base`
(`packages/cli/src/runner.ts`). Everything the base's branch did since the fork then shows as
reverted in head. The label (`a1b2c3d → e4f5a6b · N commits`) counts only head's side and does
not say the picks diverged. Measured on the regression clones (`HEAD` as checked out there, every
branch listed):

| Repo | Diverged pairs among the first 25 rows / first 100 | HEAD against the 20 unmerged remote tips nearest the top: diverged | …tip on the lower row (today's base) | Files in the direct diff / the branch's own (median) | Direct diff's files the branch never touched |
|---|---|---|---|---|---|
| Symbiote | 0.7 % / 0.4 % | no unmerged remote branch | — | — | — |
| zod | 64 % / 34 % | 17 | 17 | 208 / 9 | 91.6 % |
| vite | 32 % / 55 % | 15 | 15 | 101 / 5 | 95.8 % |
| Qwik | 19 % / 53 % | 19 | 19 | 187 / 15 | 84.7 % |
| Bitwarden | 74 % / 96 % | 20 | 20 | 99 / 5 | 67.3 % |

Through Symbiote's analysis, one pair each (HEAD against an unmerged remote branch):

| Pair | Direct (today) | From the fork point |
|---|---|---|
| Qwik `3fd543f` / `origin/fix-unclaimed-visible` | 43 files; 1 added, 6 removed, 9 modified symbols; 3 findings | 7 files; 1 added, 0 removed, 4 modified; 1 finding |
| zod `b500a2e` / `origin/bench/recursive-type-wall-clock-20260929` | 24 files; 21 added, 9 removed, 155 modified | 12 files; 21 added, 3 removed, 151 modified |

Causes:
- Pairs are analyzed directly (V9's decision, made when the page listed one branch: there every
  pair was an ancestor and its descendant, and direct equals from-the-fork).
- The base is the lower row. In graph order a diverged branch's tip is usually below the
  default branch's newest commits: 71 of 71 diverged pairs above. So even from the fork point
  today's rule would show what `main` did, not what the branch did.
- Nothing on the page says the picks diverged or where.

**Goal**: two picks that diverged compare what the head pick's branch adds since the two forked,
as `symbiote view <base> <head>`, `symbiote diff` and pull requests do. The base is chosen so that this is
the branch's own work in the usual cases (a branch against the default branch, wherever HEAD is).
The compare bar says the picks diverged, where (the fork point, marked in the graph and a click
away), and how many commits each side has; Swap exchanges the sides. A pick and its ancestor, and
one pick against its parent, compare exactly as today. `symbiote diff`, `symbiote pr`, branch reviews and
the analysis do not change.

## Which pick is the base (viewer, pure)

For two picks where neither is an ancestor of the other, the base is, in order:
1. the pick on the **default branch's line** (the first-parent line from its tips: the local
   branch and each remote's, as V15's `forkPoint` takes them);
2. else the pick on **HEAD's line** (lane 0);
3. else the **lower row** (older in graph order).

Rule 1 covers a branch against the default branch whether the default branch or the branch is
checked out (in this repository the agent's branch often is, and rule 2 alone would then show
`main`'s work). Rule 2 covers "This branch" and repositories without a default branch. A pick and
its ancestor: the ancestor is the base, as today. Swap exchanges base and head; picking again
resets it.

## The fork point and the counts (viewer, pure)

- `comparison(picks, shape)` in `src/commits.ts` paints down from both picks in row order (graph
  order: every child above its parents, so a row's flags are final when it is reached): rows
  reached by one side are counted for it, and the first row reached by both is the fork point.
  It stops when no row reached by one side alone is left. This replaces `countBetween`, which
  walked the whole history from both picks on every render.
- The fork point is a best common ancestor by construction (no other common ancestor is below
  it). Where git has several (criss-cross merges), it may not be the one `git merge-base` prints;
  the label and the diff use the same one. Prototype against git on 300 random pairs among the
  first 2,000 rows of each of Symbiote, zod, vite, Qwik, Bitwarden, CPython (621 diverged):
  **fork = `git merge-base` 1,800 of 1,800; both sides' counts = `git rev-list --left-right
  --count` 1,800 of 1,800**; slowest 2.0 ms.
- No fork point: if a row reached has a parent the shape does not hold (a shallow clone's edge,
  or the first rows before the shape is in), the answer is "unknown": "Listing the history…"
  until the shape arrives, then "Their fork point is not in this clone". Otherwise the picks
  share no history (39 of Qwik's 300 pairs: its unrelated lines). Either way Compare is off.
  No direct diff instead (decision 52).

## Compare bar and graph (viewer)

- Diverged picks: `9f8e7d6 → e4f5a6b · 5 commits`, then "diverged from a1b2c3d (3 commits not
  in this diff)"; the fork's short SHA is a button that moves the cursor to its row; "Swap".
  Ancestor picks keep today's label.
- The fork point's dot gets a dashed ring (`fork-ring`), as V10 planned.
- Compare sends `{ base: <fork point>, head }` to `POST /api/diffs`: the server is unchanged
  and the diff is served at `/diff/<fork>..<head>/`, the same pair `symbiote view <fork> <head>` and
  the label name. For ancestor picks the fork is the base, so the request is today's.

## The default branch in the shape (core, server)

- Core: `defaultBranchTips(repo)` → `{ name, tips }` (V15's `defaultBranch` and the same tips
  `forkPoint` uses), null without one.
- `GET /api/history/shape` gains `defaultBranch: { name, rows }`: the rows of those tips in the
  scope's listing (absent when none is listed, e.g. "This branch" on a branch behind which `main`
  moved). Read once per listing, when the shape is made; the history's version already follows
  every branch.

## Verification

1. **Unit** (red first): `comparison` — one pick (its parent), an ancestor pair (as today, both
   orders), diverged picks (fork, both counts, label), the three base rules and Swap, a merge
   commit as a pick, a criss-cross (the fork is one of the two bases), unrelated lines, a missing
   parent (unknown), counts equal to the old `countBetween` on ancestor pairs. Core:
   `defaultBranchTips` (origin/HEAD, `main`, none; local and remote tips). `Histories`: the shape
   carries the default branch's rows; absent when not listed.
2. **E2E** (a new `serveDiverged` fixture: `main` adds two functions after `topic` forked; `topic`
   adds one and changes one): pick `main`'s tip and `topic`'s → the diverged label, the fork ring,
   the fork button; Compare → the diff lists only `topic`'s symbols (none of `main`'s as removed);
   Swap → only `main`'s; ancestor picks unchanged; with `topic` checked out, the same base (rule 1).
   Every existing spec passes.
3. **Against git on real repositories** (`scripts/viewer/compare-check.mjs`, the viewer's own
   `comparison` on the shape the server sends): Symbiote, ky, zod, vite, Qwik, Bitwarden, CPython —
   ≥ 1,000 random pairs each, near the top and across the whole history: the fork point is one of
   `git merge-base --all` (and how often it is git's), both counts equal `rev-list`, unrelated
   pairs recognized; and HEAD against every unmerged remote tip: the base is HEAD's pick.
4. **The diff renders the branch's changes** (end to end, `symbiote view`'s server, the request the
   page sends): on zod, vite, Qwik and Bitwarden, several HEAD/branch pairs: the graph's files
   equal `git diff --name-status <head pick>...<branch>` (three dots: from the merge-base), and
   its symbols, edges and findings equal `symbiote diff <head pick> <branch>`'s (merge-base by
   default). The diff page in a browser (`viewer-check`): screenshots light and dark.
5. **Nothing else changes**: no analysis code touched (goldens identical); `symbiote diff`/`symbiote pr`
   tests unchanged; ancestor pairs send the same request as `main`.
6. **Cost**: `comparison` under 5 ms on CPython's shape for any pair; first rows as fast as
   `main` (the shape gains one small field).

**Risks**

| Risk | Mitigation |
|---|---|
| The diff page names the fork, not the pick (`9f8e7d6 → e4f5a6b`) | The label says so before Compare; the pair is the one `symbiote view <fork> <head>` serves. |
| Criss-cross merges: our fork point is not git's | Still a best common ancestor; label and diff agree; the check script counts how often it differs. |
| The default branch is unknown or not listed | Rule 2 (HEAD's line), then the older pick; Swap. |
| Two feature branches: no side is "right" | The newer is head (what it adds since they forked); the label names both sides' counts; Swap. |
| A shallow clone hides the fork | "Unknown", Compare off; no guess. |

**Order**: the pure `comparison` and its tests, checked against git with the script; the shape's
default branch (core, server); the compare bar, ring and Swap; the e2e fixture; the end-to-end
check on real repositories.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V10c | Picks across branches | `comparison` with the fork point, both counts and the base rules; `defaultBranch` in the shape; the diverged label, fork ring and button, Swap; Compare from the fork point; `compare-check.mjs`. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 88 | Which diverged pick is the base (supersedes 52's "the lower pick") | **The pick on the default branch's line, else on HEAD's line, else the lower row; Swap** | 71 of 71 diverged HEAD/branch pairs had the branch on the lower row: the lower pick as base shows `main`'s work. Rule 1 holds wherever HEAD is (here the agent's branch is often checked out). |
| 89 | Where the fork point is found (supersedes V10's `from: 'fork'` in `POST /api/diffs`) | **In the page, from the shape, and sent as the base** | Matches `git merge-base` on 1,800 of 1,800 pairs, in ≤ 2 ms; the label is shown before any request, and the diff then analyzes exactly the fork the label names; the server is unchanged. |
| 90 | No fork point | **Say why (no shared history, not in this clone, still listing); Compare off** | A direct diff would show the other side's work as reverted (decision 52); precise beats complete. |

**Not in V10c (later)**: a direct diff of diverged picks; ranking a pick merged into the default
branch above one that is not; the diff page naming the picks it came from; V10b (branches panel).

## As built — V10c

- **The fork point's SHA comes from the rows' details.** The shape holds row numbers only, so
  `comparison` takes `shaAt(row)` (the details loaded) besides `parents`, `head`, `trunk` and
  `complete`. While the fork's row is not loaded the bar says "Finding where … forked…" and the
  page loads its block of 200 (one request, 16–20 ms anywhere in a history, V10).
- **`comparison` returns `{ pair, label, diverged? }`**: `pair` null with the reason in the label;
  `diverged` names the other pick, its commits since the fork, the fork's row and which rule chose
  the base (`default`, `head`, `older`) for the note's title. It replaces `countBetween`, which
  walked the whole history from both picks on every render; the result is now memoized.
- **The bar**: `8dd3ab0 → 7b3a37e · 2 commits · diverged from 3fd543f: its 11 commits since the
  fork are not in this diff` (Qwik), the fork's SHA a button to its row, then Swap. The title
  says why: "3fd543f is on main: this diff shows what 7b3a37e adds since they forked at 8dd3ab0.
  Swap compares 3fd543f instead." The SHAs keep the monospace font; the note takes the page's.
- **Swap keeps focus**, so Enter right after it swaps again (V9's rule: a focused button takes
  Enter); Compare is the next control.
- **The default branch's tips are read while git lists the history**, not after: read after, the
  shape took 26–35 ms longer on Bitwarden; alongside, 9–12 ms.
- **Core**: `defaultBranchTips(repo)`; `forkPoint` and it share `branchTips`. `HistorySource`
  gains an optional `defaultBranch()` (tests' fakes have none); a failed shape is not kept.
- **Two scripts** stay: `scripts/viewer/compare-check.mjs` (the viewer's `comparison` against git
  on whole histories) and `scripts/viewer/diverged-diffs.mjs` (`symbiote view`'s server driven as the
  page does, the graph against `git diff A...B` and `symbiote diff A B`).

**Results (V10c)**. Tests first: 13 unit tests failed before the code (viewer 11, 4 of them
existing tests on the new API; core 1; CLI 1);
on `main`'s build 3 of the 4 new e2e tests failed on the label (`main`'s tip compared directly
with the branch's), the ancestor-pair one passed on both. Now 613 unit tests and 75 e2e.

Against git (`compare-check.mjs`, 500 random pairs among the first 2,000 rows and 500 anywhere):

| Repo | Rows | Pairs (diverged / no shared history / several merge-bases) | Fork = `git merge-base`; both counts = `rev-list`; base's side by the rules | Default branch against each diverged remote branch: the branch is head, from the fork | Slowest |
|---|---|---|---|---|---|
| Symbiote ("This branch") | 243 | 998 (2 / 0 / 0) | 998 of 998 | — (none) | 0.4 ms |
| ky | 593 | 998 (0 / 0 / 0) | 998 of 998 | 1 of 1 | 0.4 ms |
| zod | 4,239 | 997 (297 / 0 / 1) | 997 of 997 | 124 of 124 | 0.2 ms |
| vite | 10,359 | 997 (95 / 0 / 0) | 997 of 997 | 80 of 80 | 0.3 ms |
| Qwik | 12,362 | 997 (265 / 126 / 0) | 871 of 871; the 126 "share no history" | 124 of 124 | 0.7 ms |
| Bitwarden | 39,861 | 997 (505 / 31 / 0) | 966 of 966; the 31 "share no history" | 1,534 of 1,534 | 0.6 ms |
| CPython | 150,182 | 997 (37 / 0 / 0) | 997 of 997 | 5 of 5 | 3.2 ms |

End to end (`diverged-diffs.mjs`: `symbiote view`'s server, the default branch's tip and the three
nearest diverged remote branches' tips picked, the pair the page sends analyzed): **12 of 12
graphs hold exactly the branch's files (`git diff --name-only A...B`) and equal `symbiote diff A B`**
(files, symbols, edges, findings). Beside them, what `main`'s page analyzed for the same picks:

| Pair | V10c: from the fork, the branch as head | `main`: the branch's tip as base, directly |
|---|---|---|
| zod `b500a2e` / `c7705c5` | 38 files; 100 added, 12 removed; 2 findings | 44 files; 12 added, **100 removed**, 1 modified; 0 findings |
| vite `cf80aa5` / `f957682` | 3 files; 3 added, 1 modified | 48 files; 0 added, **3 removed**, 1 modified |
| Qwik `3fd543f` / `7b3a37e` | 7 files; 1 added, 4 modified; 1 finding | 43 files; 6 added, 1 removed, 9 modified; 4 findings |
| Qwik `3fd543f` / `aec301b` | 49 files; 151 added, 1 removed, 10 modified; 3 findings | 142 files; 29 added, **151 removed**, 38 modified; 12 findings |
| Bitwarden `51450a5` / `2651094` | 4 files; 4 modified; 3 findings | 44 files; 7 added, 25 modified; 12 findings |

On the Qwik clone in Chromium (1440 × 900, light and dark): `main` and `origin/fix-unclaimed-visible`
picked, the bar and the dashed ring as above, no page errors. Cold `symbiote view`, 4 rounds against
`main`'s build back to back: first rows unchanged (Bitwarden 267–283 against 268–299 ms, CPython
812–848 against 820–876 ms); the shape 87–94 against 75–82 ms (Bitwarden), 350–372 against
339–380 ms (CPython). No analysis code changed (goldens unchanged), so no regression-check run.

Not verified: Windows and macOS; Firefox and Safari; a repository whose default branch is not
`main` or `master` and has no remote `HEAD` (rule 2 then, as unit-tested); shallow clones beyond
the unit test.
