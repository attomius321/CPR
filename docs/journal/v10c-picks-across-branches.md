# Journal: V10c — Picks across branches: diverged picks compared from their fork point

[Index](../JOURNAL.md) · [Plan](../plan/v10c-picks-across-branches.md)

## V10c spike — what diverged picks show (2026-10-14, branch `milestone/v10c-picks-across-branches`)

Measured on the regression clones (every branch listed, HEAD as checked out there) before
refining V10's plan for picks across branches. Pairs picked among the rows a reader sees first
are often diverged: among the first 25 rows, 19–74 % of pairs on Qwik, vite, zod and Bitwarden
(0.7 % on this repository, whose branches are all merged). Against HEAD, the 20 unmerged remote
tips nearest the top were diverged in 71 of 80 cases, and a direct diff — what the server runs
today (`--no-merge-base`) — listed a median 99–208 files where the branch changed 5–15: 67–96 %
of its files were the default branch's work shown as reverted. Through Symbiote, a Qwik branch read as
43 files with 6 removed symbols and 3 findings; from its fork point, 7 files, none removed, 1
finding. In all 71 pairs the branch's tip was the lower row, today's base: a fork-point diff with
today's rule would have shown `main`'s work instead of the branch's.

**Learned**:
- The fork point can be found in the page from the shape alone: in graph order a row's children
  are all above it, so painting down from both picks and taking the first row both reach gives a
  best common ancestor, and counting rows reached by one side gives `rev-list --left-right
  --count`. Against git on 1,800 random pairs (six repositories, rows < 2,000): fork 1,800 equal
  to `git merge-base`, counts 1,800 equal, at most 2.0 ms. The server needs no change to diff
  from it.
- The first prototype stopped as soon as no one-sided row was left, which can happen before the
  scan reaches the fork row (its flags already joined): every ancestor pair came out without a
  fork. The rows still marked after the stop are all reached by both; the first of them is it.
- Qwik has unrelated lines: 39 of 300 random pairs share no history (`git merge-base` exits 1).
- Which side is the base matters as much as the fork point. "On HEAD's line" fixes the
  measured case only while the default branch is checked out; here the agent's branch often is.
  The default branch's line, then HEAD's, then the older row, covers both.

## V10c — Picks across branches (2026-10-14, branch `milestone/v10c-picks-across-branches`)

Two picks on lines that diverged are compared from their fork point, as a pull request is: the
page finds it from the history's shape and sends it as the base, so the server is unchanged.
The base's side is the pick on the default branch's line, else HEAD's, else the lower row; the
compare bar says the picks diverged, the fork's SHA goes to its row (ringed with dashes), and
Swap compares the other side. An ancestor pair and one pick against its parent are as before.

**Learned**:
- The shape is row numbers: the fork point's SHA is only known once its row's details are loaded.
  `comparison` takes the loaded SHAs and says "Finding where … forked…" until the page has
  loaded the fork's block (one request).
- What a reviewer reads is the graph, so "correct" was checked there, not only on the fork
  point: through `symbiote view`'s own server, the pair the page sends gave exactly the branch's
  files (`git diff A...B`) and the same graph as `symbiote diff A B` on 12 of 12 branches. The pair
  `main`'s page sent showed the branch's own work inverted: zod's 100 added symbols as 100
  removed, Qwik's 151 the same.
- Reading the default branch's tips after git's listing cost the shape 26–35 ms on Bitwarden;
  started alongside the listing, 9–12 ms.
- Swap keeps focus after a click, and a focused button takes Enter (V9): Enter right after Swap
  swaps back. The e2e test first pressed Enter there and found it.
- `--format='%H %P'` ends a root commit's line with a space: split on spaces, the root gets an
  empty parent. The new check script drops it; `scripts/viewer/lanes-check.mjs` (V10a) does not
  and gives every root a parent outside the history (`-1`). The server parses it right (`%x1f`,
  empty means none). Not fixed here.

**Verification**: tests first — 13 unit tests failed before the code (viewer 11, 4 of them
existing tests moved to the new API; core 1; CLI 1); on `main`'s build 3 of the 4 new e2e tests
failed on the label. 613 unit tests, 75 e2e. `compare-check.mjs` against git: 5,983 random pairs
on ky, zod, vite, Qwik, Bitwarden and CPython (1,199 diverged, 157 with no shared history, 1
criss-cross) and 998 on this repository's "This branch": the fork point, both sides' counts and
the base's side right on every pair; the default branch against every diverged remote branch
(1,868) gave the branch as head from the fork; at most 3.2 ms per comparison (CPython).
`diverged-diffs.mjs` on zod, vite, Qwik and Bitwarden (3 branches each): 12 of 12 as above.
Screenshots on Qwik, light and dark, no page errors. Cold `symbiote view` against `main`'s build:
first rows unchanged; the shape +9–12 ms (Bitwarden), within noise on CPython. Not verified:
Windows, macOS, Firefox, Safari; a repository with no `main`, `master` or remote `HEAD`.

Merged into main (2026-10-14). `main` verified after the merge: 613 unit tests, build, 75 e2e.
