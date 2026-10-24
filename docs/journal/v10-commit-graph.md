# Journal: V10 — A commit graph

[Index](../JOURNAL.md) · [Plan](../plan/v10-commit-graph.md)

## V10 spike — what a commit graph needs (2026-10-13, branch `milestone/v10-commit-graph`)

Measured before planning lanes for the commits page, with a prototype of the lane walk over
`git log` on this repository, fresh blobless clones of ky, zod, vite, Qwik and Bitwarden, and a
history-only clone of CPython (172,396 commits). The plan changed four times as the user said
what they wanted (every branch; "exactly like git extension, or gitty up", with a branches
panel; lazy loading; tags only as badges); each change was measured first.
Repositories that merge with merge commits list side-branch commits among the branch's own (Symbiote
66 and Qwik 57 of the first 100 rows); squash-merging ones are one line, and their divergence is
in branches the page does not list (Bitwarden: 1,539 remote branches not merged into HEAD).

**Learned**:
- `git log`'s default order (commit date) is not a graph order: with skewed clocks a parent can be
  listed above its child. Of the two that are, `--topo-order` keeps a branch's commits together
  and needs fewer lanes than `--date-order`: Qwik's own branch 7–11 against 13–15, zod with
  remotes 4 against 5–12. It is also what `git log --graph` draws.
- Without a rule for the current branch, a newer tip of another branch takes the first lane and
  the current branch wanders. Keeping lane 0 for HEAD's first-parent line fixes it, and the
  prototype's rows then matched `git log --graph` on this repository.
- An ordered log walks the history first unless the repository has a commit-graph file, and a
  fresh clone has none (`git gc` writes it): 100 rows on Bitwarden take 111–123 ms (with every
  remote branch 206–237 ms) against 14–16 ms unordered; with the file, 1–25 ms. Within budget
  either way, so Symbiote need not write one (it would change the user's repository).
- Every remote branch is mostly other people's work: on Bitwarden 93 of the first 100 rows. The
  first plan listed local branches and their upstreams by default; the user asked for every
  branch, as Git Extensions and Gittyup show it, with a branches panel on the left.
- Branch tips sit deep in graph order: Bitwarden's median remote tip is row 9,165 (deepest
  37,633; 95 of 1,591 in the first 1,000 rows), Qwik's 3,695. A panel click cannot page its way
  there 100 rows at a time.
- Without a commit-graph file git orders the whole history before its first row: Bitwarden
  243 ms, CPython 762–776 ms. With one the first rows come in 42 ms and 6 ms, but the whole order
  takes longer (Bitwarden 622 against 344 ms, CPython 2.0 against 1.2 s): the incremental walk is
  slower in total.
- What is heavy is the rows' details, not their order: CPython's 150,182 branch commits with
  subject, author, date and refs are 30.5 MB; each row's parents as row numbers are 1.32 MB, and
  the lane walk over them 62 ms. Details for 200 rows fetched by SHA (`git log --no-walk`) take
  16–20 ms anywhere in the history. Hence the plan's lazy loading: the order once on the server,
  the shape to the viewer, details for the rows in view. Sending everything at once (the second
  plan) would have been 7.5 MB on Bitwarden and over 30 MB on CPython.
- Lane counts on partial lists mislead: lines to parents not yet listed stay open to the bottom.
  Bitwarden showed 49 lanes in its first 10,000 rows but needs 17 over the whole history; Qwik
  needs 36 (p95 35). Cutting lines over 100 rows into arrows, as gitk does, takes partial lists
  to 5–19 lanes, but the tools asked for draw every line whole; not planned.
- Tags as tips explode a graph: CPython's 676 tags reach 22,214 commits no branch does (old
  release lines), and its widest row goes from 37 lanes to 2,449. Git's own `--graph` agrees (36
  and 2,449) and takes 15 s to draw it. On Bitwarden and vite they added rows (1,497 and 401)
  but no lanes, which hid it. The user had asked for tags only as badges anyway.
- Cross-checking the prototype against `git log --graph` (the widest line's width) is cheap: 36
  against 37 lanes on CPython's branches, 2,449 against 2,450 with tags. The one-lane difference
  is not explained yet; the plan's check script compares row by row.
- Correction (V10a): the prototype's lane counts were low. It did not count a side branch's
  line down to its fork on HEAD's line; the real layout needs 142 lanes on Bitwarden, not 17
  (git's `--graph`: 143). See V10a.
- Unrelated: `scripts/regression/setup.mjs r1` fails on a fresh machine. Zod's pinned commits
  (`f448c44d` and five more) are no longer reachable from its branches, and git cannot fetch a
  commit by a short SHA. The set needs reachable (or full, fetchable) SHAs; not fixed here.

## V10a — The history as a graph (2026-10-13, branch `milestone/v10-commit-graph`)

`symbiote view`'s commits page lists every branch, local and remote (or "This branch"), in graph
order, with lanes drawn left of the rows; lines over 100 rows are two arrows. The server lists
the order once per scope and serves rows' details by block and the whole shape; the viewer lays
out lanes over the shape and draws only the rows near the view.

**Learned**:
- Check a prototype against the tool it imitates before planning on its numbers. The lane
  prototype skipped one kind of line (a side branch's way back to HEAD's line) and reported 17
  lanes for Bitwarden; `scripts/viewer/lanes-check.mjs`, which walks every drawn line to its
  parent and prints git `--graph`'s width beside ours, showed 142 on its first run. Whole lines
  were what the user had asked for; with the real numbers they chose gitk's arrows (Bitwarden
  20 lanes, 1,939 arrows in 39,861 rows; 1,943 as first counted, see "Fix — lanes-check and root
  commits").
- `--no-walk=unsorted` reads any 200 commits by SHA in 16–20 ms, wherever they are in a
  150,000-commit history: the order is the only thing that must be listed whole.
- A line may join a lane already going to its parent before it is cut: on HEAD's line that is
  common (a branch forked from the very next commit of lane 0) and costs nothing.
- Before the whole shape is known, parents not listed get their own negative numbers; with
  identity kept, the first rows lay out as they will in the whole history, except the last 100,
  whose lines may turn into arrows once their parents' rows are known.
- In this WSL machine's headless Chromium the first layout of a font stack naming fonts it lacks
  (`ui-monospace, SFMono-Regular, Menlo`) costs 347 ms, and the viewer's stacks together
  400–1,000 ms per page. It looked like a V10 regression (a 921 ms task right after the first
  rows arrived) until a profile pointed at `measure` reading layout and the same page on `main`
  paid it too. Timings are given with plain fonts beside.
- `box-sizing: border-box` on a list whose height is set inline to rows × 32 px loses the border
  from the rows' area and clips the last row: the list is `content-box`.
- Qwik's HEAD row carries nine tags; on `main` (V9) they squeezed its subject to nothing. A row
  now shows three refs, then "+N".

**Verification**: tests first — core `streamHistory` (every branch, no tag-only commit, stash or
`refs/symbiote/*`; a child dated before its parent listed above it; an empty repository),
`commitDetails`, `historyState` (moves with HEAD and branches, not tags), `hasCommitGraph`;
`Histories` (rows before the walk ends, the shape after, rows by SHA from the kept order, a new
version, one listing per scope, a failed listing, the hint); the server's `/api/history` and
`/api/history/shape` (defaults, refusals, 409); `layoutLanes` (one line, a merge, two tips from
one commit, an octopus, a freed lane, parents not listed, no HEAD, the first rows unchanged by
the rest, arrows at 101 rows and not 100, a join instead of a cut); `comparison` on rows,
`parentRows`, `blocksAround`, `laneSpacing`. E2E: every branch in graph order with lane 0 and
the cursor on HEAD, tags as badges and "+N", "This branch" in the URL, 450 commits (35 rows in
the page, details on scroll, arrows both ways); all 48 specs pass. `lanes-check.mjs`: 0 errors on
seven repositories. Real repositories in Chromium (plain fonts, warm server): first rows
102–147 ms against `main`'s 87–119 ms; CPython's shape in 83 ms, lanes 62 ms, no long task
while scrolling or jumping, heap 72 MB. A cold server: CPython's first rows at 0.93 s (git's
walk). Not verified: Windows and macOS browsers, Firefox's height cap.

Merged into main (2026-10-13), V10a alone: V10b (branches panel) and V10c (picks across
branches) are not started. `main` verified after the merge: 495 unit tests, build, 48 e2e.
