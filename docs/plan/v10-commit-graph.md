# V10 — A commit graph

[Index](../PLAN.md) · [Journal](../journal/v10-commit-graph.md)

**Status:** V10a merged into main (2026-10-13, from branch `milestone/v10-commit-graph`; "As
built — V10a" below). V10c and V10b refined, built and merged on their own (2026-10-14): see "V10c — Picks across branches" and "V10b — Branches panel"
after V17.

**Problem** (asked: "I want to see the tree on the left, with branch divergence … if that is
possible"; "I want to see all the commits, from any branches, not only from the branch, with a
tree structure"; "exactly like git extension, or gitty up, the entire flow of the commits, with
the branch trees on the left" — a graph and a branches panel, as Git Extensions and Gittyup
have; "How much time it takes to load 100.000 commits, can't we lazy load"; "tags should only be
in the row, as a head … the tree should be branches only"). The commits page (V9) lists
`git log HEAD` in date order as plain rows, 100 at a time. Nothing says which rows are the
branch's own line and which came in through a merge, and other branches are not listed.
Measured on this repository, the regression clones and CPython (fresh clones of the history
only, no commit-graph file). Lanes are `layoutLanes`'s (V10a) over the whole history, checked
against git by `scripts/viewer/lanes-check.mjs`; the planning prototype undercounted them (see
"As built — V10a"):

| Repo | Local / remote branches (not merged into HEAD) / tags | This branch, first 100 rows: from merged branches / merges | Every branch: rows | Of its first 100 rows, not on this branch | Remote branch tips: median row (deepest) | Widest row, lines whole (git `--graph`) | Widest row, lines over 100 rows as arrows (arrows) |
|---|---|---|---|---|---|---|---|
| Symbiote | 1 / 50 (0) / 0 | 66 / 20 | 179 | 0 | 116 (175) | 3 (3) | 3 (0) |
| ky | 1 / 2 (1) / 99 | 0 / 0 | 593 | 0 | 1 (173) | 2 (2) | 2 (0) |
| zod | 1 / 154 (128) / 219 | 0 / 0 | 4,239 | 48 | 978 (4,058) | 10 (9) | 7 (14) |
| vite | 1 / 88 (85) / 1,054 | 0 / 0 | 10,359 | 56 | 691 (9,260) | 53 (54) | 3 (75) |
| Qwik | 1 / 133 (125) / 559 | 57 / 44 | 12,362 | 62 | 3,695 (8,889) | 37 (35) | 10 (240) |
| Bitwarden | 1 / 1,591 (1,539) / 638 | 0 / 0 | 39,861 | 93 | 9,165 (37,633) | 142 (143) | 20 (1,939) |
| CPython | 1 / 6 (5) / 676 | 0 / 0 | 150,182 | 0 | 11,068 (33,309) | 37 (37) | 35 (169) |

Arrow counts corrected (2026-10-14): `lanes-check.mjs` gave each root commit a parent outside
the history, an arrow too many per root above the last 100 rows (zod 15, Qwik 241, Bitwarden
1,943 as first published); lane widths were right.

- Repositories that merge with merge commits (Symbiote, Qwik) list side-branch commits among the
  branch's own: 66 and 57 of the first 100 rows, with nothing telling them apart. V9 met this
  already: counting the rows between two picks was wrong, so the label walks parents.
- Squash-merging repositories (ky, zod, vite, Bitwarden) are one line on their branch: their
  divergence is in the branches not listed, up to 1,539 unmerged ones on Bitwarden. With every
  branch, 48–93 of the first 100 rows are on other branches; HEAD is still in rows 1–7.
- Branch tips sit deep: Bitwarden's median remote tip is row 9,165 (95 of 1,591 in the first
  1,000 rows), CPython's 11,068. A panel whose click goes to a branch cannot page its way there.
- Git orders the whole history before its first row unless the repository has a commit-graph
  file (`git gc` and `git maintenance` write one; a fresh clone has none). Without one, the first
  row of Bitwarden comes after 243 ms, of CPython after 762–776 ms; with one, after 42 ms and
  6 ms. The order of every row is known soon after: 344 ms and 1.2 s without the file (with it
  622 ms and 2.0 s: the incremental walk is slower in total).
- What is heavy is the rows' details, not the order: CPython's 150,182 rows with subject, author,
  date and refs are 30.5 MB (Bitwarden's 39,861: 7.5 MB). The shape alone, each row's parents as
  row numbers, is 1.32 MB (0.34 MB); lanes over it take 62 ms (24 ms). Details for 200 rows
  fetched by SHA take 16–20 ms, about 40 kB, wherever they are in the history.
- Lines drawn whole, as the tools named do, need 142 lanes on Bitwarden (git's own `--graph`:
  143), 53 on vite, 37 on Qwik and CPython: a branch that forked long ago keeps its line open down
  to its fork. Cutting lines over 100 rows into two arrows, as gitk does, takes Bitwarden to 20,
  vite to 3, Qwik to 10; CPython stays at 35 (its width is parallel maintenance branches).
- Tags as tips of the graph explode it: CPython's 676 tags reach 22,214 commits no branch does,
  and its widest row goes from 37 lanes to 2,449 (git's `--graph` agrees, and takes 15 s to draw
  it). Bitwarden's tags reach 1,497 such commits, vite's 401.
- Order: `git log`'s default (commit date) can list a parent above its child when clocks are
  skewed, which no graph can draw. Date order (`--date-order`) keeps children first but
  interleaves lines: in the first prototype Qwik's own branch needed 13–15 lanes instead of 7–11
  in graph order (`--topo-order`), zod with remotes 5–12 instead of 4.

**Goal**: `symbiote view` opens on the whole history of every branch, local and remote, drawn as a
graph left of the rows, with a branches panel left of the graph. The current branch is the
straight line on the left; other branches leave a line where they diverged and join it where
they were merged; a line longer than 100 rows is two arrows; the scrollbar spans the whole
history, and the rows' details load as they come into view. Tags show as badges on their commits' rows, as today. The
panel lists local branches (with how far each has diverged from its upstream) and remote
branches by remote and folder; a click goes to the tip. Two picks on diverged branches compare
what one adds since they forked; picks on one line compare as today. "This branch" narrows the
list to V9's. `symbiote view <base> [head]`, `symbiote diff` and `symbiote pr` do not change. A sketch
(`origin/feature/q3` is made up):

```
Filter branches     │ ●           d4d2d32  Docs: V9 merged                 main  origin/main
▾ Local             │ │ ●         9c1e0aa  Q3: route loaders typed         origin/feature/q3
  ● main  ↑1        │ ●─┼─╮       db1acce  Merge V9: pick two commits      v0.9
    milestone/v10   │ │ │ ●       fb0050b  Fix: a key pressed as soon as …
▾ Remotes           │ │ │ ●       6ac99b5  Plan V9: pick two commits
  ▾ origin          │ ●─┼─╯       b6b0016  Docs: V8e merged, V8 closed
    ▸ milestone/ 27 │ │ │         ░░░░░░░  ░░░░░░░░░░░░░░░  (details loading)
    ▸ fix/ 4        │
```

## History, loaded lazily (core, server)

- **Tips**: `HEAD`, `--branches`, `--remotes` (scope `all`, the default) or `HEAD` alone (scope
  `current`, as V9). Never tags (decision 48) and never `--all` (the stash, `refs/symbiote/*`). Only
  the scope's name comes from the request, checked against the two; the revisions are fixed.
- **The order, once**: the server streams `git log --topo-order -z --format=%H%x1f%P` over the
  tips (graph order: every commit above its parents, a branch's commits together, what
  `git log --graph` draws) and keeps, per scope, the SHAs in order and each row's parents as row
  numbers. It is made again when the refs change: the server compares `git for-each-ref`'s
  output (10–79 ms) when the page asks for the history.
- **Core**: `streamHistory(repo, scope, onRows)` in `src/git/log.ts` (rows as git gives them),
  `commitDetails(repo, shas)` (`git log --no-walk=unsorted` with V9's format, parsed by
  `parseLog`), `listRefs(repo)` (one `git for-each-ref` over `refs/heads` and `refs/remotes`:
  branches with `upstream`, `ahead`, `behind`, `gone`; remotes without their `HEAD`).
  `listCommits` and `parseLog` stay for V9's callers.
- **API**:
  - `GET /api/history?scope=…&rows=<from>-<to>` → the details of those rows (at most 500), from
    the kept order. It answers as soon as git has listed them: the first 200 rows do not wait for
    the whole walk.
  - `GET /api/history/shape?scope=…` → `{ version, rows, head, parents }` (`head`: HEAD's row;
    `parents`: row numbers) once the whole order is known. `version` changes with the refs; rows
    asked with an older version answer 409, and the page loads anew.
  - `GET /api/refs?scope=…` → the branches and remotes, each with its tip's row (null when the
    scope does not list it).
- **Hint**: when the order took over 500 ms and the repository has no commit-graph file, the
  terminal says once that `git commit-graph write --reachable` (or `git maintenance start`) makes
  the first rows come at once. Symbiote does not write it: that would change the user's repository.

## Lanes (viewer, pure)

`layoutLanes(parents, head)` in `src/lanes.ts`, over row numbers, gives each row: `lane` (the
column of its dot), `through` (lanes passing by), `from` (lanes ending in its dot from above: its
children's lines, so branches diverged here when there are two or more), `to` (one lane per
parent below; a merge has two or more) and `width`. Rules:

1. Lane 0 is the current branch's first-parent line (HEAD, its first parent, …): the straight
   line on the left, however many tips are newer.
2. A commit takes the leftmost lane waiting for it; a new tip takes the leftmost free lane; a
   lane whose line ended is free again. A first parent continues in the child's lane.
3. Lines never shift sideways: a line bends only where it starts or ends, so each row is drawn
   from its own data.
4. A line to a parent more than 100 rows below is cut: an arrow under the child, one over the
   parent, no lane between (decision 50). HEAD's line is never cut; a line that can join a lane
   already going to its parent joins it. The first rows are drawn from their own parents before
   the shape arrives (a parent not yet listed counts as below the last row).

## Drawing (viewer)

- Rows have a fixed height (about today's 33 px) and only those in view (and a screen around) are
  in the page. Their details are asked for in blocks of 200 as they come near; a row whose
  details have not come yet shows its graph and grey bars. The cursor's scrolling and j/k work by
  row number, not by element.
- A graph cell at the left of each row: an inline `<svg>` of the row's full height, its top half
  the lines from children, its bottom half the lines to parents, a curve where a line changes
  lane. The cell spans the row's padding and border, so lines join across rows.
- Lanes 14 px apart, narrowed down to 6 px when the widest row would pass 240 px; past 6 px the
  column widens (CPython's 35 lanes: 240 px at 6.9 px).
- An arrow says how far its other end is ("Its parent is 441 rows below: click to go there");
  a click moves the cursor there.
- A lane keeps one color from start to end: lane 0 the accent (`--moved`), the others a palette
  of six tokens with light and dark values. A merge is a hollow dot. A picked commit's dot gets a
  ring; the fork point of two diverged picks a dashed one.
- Badges as today: branches, remotes and tags on their commit's row; tags only there.
- The page opens with the cursor on HEAD's row. The `○/●` pick column and the row's picked
  background stay.

## Branches panel (viewer)

- Left of the graph, its own scroll, about 260 px wide (hidden behind a "Branches" button under
  900 px). Branches only:
  - **Local**: the current branch first (●), then by name; each with `↑2 ↓1` against its
    upstream (title: "2 commits not pushed to origin/main, 1 not pulled"), `gone` when the
    upstream was deleted.
  - **Remotes**: per remote, then folders by `/` (`milestone/`, `fix/`), each folder with its
    count; folders start closed.
- A filter box on top narrows both by name and opens the folders that match (Bitwarden: 1,591
  remote branches).
- A click puts the cursor on the branch's tip row and scrolls it to the middle (its details load
  as any rows in view); the row flashes. Under "This branch", a tip not listed switches to every
  branch first.

## This branch (viewer)

- In the title: "All branches · This branch". The choice is kept in the page's URL
  (`/?scope=current`), so a reload keeps it; changing it clears the picks.

## Picking across branches (viewer, server)

- One pick an ancestor of the other: as today. In graph order the ancestor is the lower, so it is
  the base.
- Neither (diverged): the label says "a1b2c3d ⑂ e4f5a6b · forked at 9f8e7d6: 3 and 5 commits"
  (each side's commits since the fork, walked through the shape), and the fork point's row is
  marked. Compare analyzes the fork point against head: what head's branch adds since they
  diverged, as `symbiote view <base> <head>` and pull requests do. The lower pick is the base; Swap
  exchanges them.
- Server: `POST /api/diffs { base, head, from: 'fork' }` checks both with `isCommit`, resolves
  `git merge-base` (execFile) and answers the URL of `/diff/<fork>..<head>/`. Unrelated
  histories: 400 "these commits share no history".

## Verification

1. **Unit** (red first): `streamHistory` on a fixture repository with a merged branch, an
   unmerged one, a local branch ahead of and behind its upstream, a remote-only branch, a tag on
   no branch, a stash and a `refs/symbiote/*` ref (the last three never listed); a child dated before
   its parent still listed above it; `current` lists V9's commits. `commitDetails` in the order
   asked, tags among the refs. `listRefs`: ahead/behind, `gone`, no remote `HEAD`, no tags. The
   server: rows before the walk ends, the shape after, rows past the end, more than 500 rows
   refused, 409 after the refs change, one walk per scope and refs state. `layoutLanes`: one
   line; a merged branch (fork and merge rows); two branches from one commit; an octopus merge;
   a tip newer than HEAD (lane 0 stays HEAD's); a lane freed and reused; a parent not yet listed
   (open to the bottom); a detached HEAD; the first rows keep their lanes when the shape comes.
   The panel tree (pure): folders by `/`, counts, the filter opening folders. `comparison`:
   ancestor picks unchanged; diverged picks (label, Swap). `POST /api/diffs` with `from: 'fork'`.
2. **Nothing else changes**: no analysis code is touched; goldens identical; `symbiote diff` and
   `symbiote pr` tests unchanged; every e2e spec passes.
3. **The graph is git's**: a script checks `layoutLanes` over the whole history of Symbiote, Qwik,
   Bitwarden and CPython against `git log --topo-order`'s parents: each row's lines reach
   exactly its parents' rows, lane 0 holds exactly the first-parent line, and the widest row
   matches the Problem table.
4. **E2E** (`serveCommits` grows a merged branch, an unmerged local one, a remote-only one, a tag
   on no branch and an upstream ahead): a graph cell per row (`data-lane`); every branch listed,
   the tag only as a badge, "This branch" and the URL; rows' details arriving on scroll; the
   panel (sections, a folder, the filter, a click going to the tip); diverged picks → the fork
   point's diff; Swap; the keys as before; no sideways scroll with the widest graph; screenshots
   light and dark.
5. **Real repos** (`viewer-check`), without a commit-graph file and with one: `symbiote view` on Qwik,
   Bitwarden and CPython — the first rows drawn (target: under 1 s on CPython without the file,
   under 0.3 s with it), the shape in, scrolling top to bottom and a panel click to the deepest
   tip with no frame over 100 ms; the browser's memory after scrolling CPython end to end.
6. **Cost**: 200 rows' details under 50 ms anywhere in the history; the shape under 2.5 s on
   CPython (git: 1.2–2.0 s), under 700 ms on Bitwarden; `/api/refs` under 150 ms.

**Risks**

| Risk | Mitigation |
|---|---|
| Large histories (CPython: 150,182 rows, 30.5 MB of details) | Only the shape for every row (1.32 MB); details for the rows in view, 200 at a time (20 ms); rows virtualized. Not measured beyond CPython (the Linux kernel has over 1.3 million commits). |
| The first row waits for git's ordering (CPython 0.77 s without a commit-graph file) | The rows come as soon as git has them; the hint names the command that makes it instant; the page shows "Listing commits…" meanwhile. |
| Refs move while the page is open (a fetch) | Rows and shape carry the history's version; an old version answers 409 and the page lists anew. |
| Wide graphs (lines whole: Bitwarden 142 lanes, vite 53, Qwik 37) | Lines over 100 rows are arrows (Bitwarden 20, vite 3, Qwik 10); spacing narrows to 6 px; "This branch". |
| Most rows are other people's branches (Bitwarden: 93 of the first 100) | The current branch is lane 0; the page opens on HEAD; the panel; "This branch". |
| 1,591 remote branches in a panel | Folders closed at first, counts, the filter. |
| Rows' padding and borders break lines between rows | Fixed row height; the cell spans the whole row; e2e checks lines meet. |
| Dates no longer fall steadily down the list (a branch's commits are kept together) | It is `git log --graph`'s order; the date column stays. |
| Diverged picks: the reader expects a direct diff | The label says "forked at …"; Swap; a direct diff only if asked for (decision 52). |

**Order**: on one branch, merged together. V10a (the history as a graph, lazily) first; V10b (the
panel) next, since a click must reach any tip; V10c (picks across branches), since every branch
listed makes diverged picks common; "This branch" with V10a.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V10a ✅ | The history as a graph | `streamHistory`, `commitDetails`; the kept order per scope and refs state; `/api/history` (rows, shape); `layoutLanes`; virtualized rows with a graph cell, lane colors and details by block; the cursor on HEAD; "This branch"; the commit-graph hint; the check against git. |
| V10b | Branches panel | `listRefs` and `/api/refs` with tip rows; Local (ahead/behind) and Remotes by remote and folder; the filter; a click to the tip. |
| V10c | Picks across branches | The diverged label, the fork point marked, Compare from the fork point (`from: 'fork'`), Swap. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 47 | Row order | **Graph order (`--topo-order`)** | A graph needs every commit above its parents; date order interleaves lines (Qwik 13–15 lanes against 7–11, zod 5–12 against 4); it is what `git log --graph` shows. |
| 48 | Which commits | **Every branch, local and remote, and HEAD; "This branch" on demand. Tags only as badges on their rows; not the stash or `refs/symbiote/*`** | Asked: "all the commits, from any branches" and "tags should only be in the row … the tree should be branches only". As tips, CPython's tags take its graph from 37 lanes to 2,449. |
| 49 | Lane rules | **Lane 0 is HEAD's first-parent line; lines never shift sideways; the leftmost free lane is reused** | The current branch is always the straight line on the left; each row is drawn from its own data. |
| 50 | Long lines | **Lines over 100 rows as two arrows (gitk's way): hover says how far, a click goes there; HEAD's line never cut** | First "drawn whole" (asked: "exactly like git extension, or gitty up … the entire flow"); then measured with the real lanes, whole lines need 142 lanes on Bitwarden (git `--graph`: 143), 53 on vite, 37 on Qwik; asked again with those numbers, the user chose arrows: 20, 3 and 10 lanes. |
| 51 | How the history loads | **The order once, on the server (kept per scope and refs state); the shape of every row to the viewer; the details of the rows in view, 200 at a time** | Asked: "can't we lazy load". Git orders everything before the first row anyway (CPython 0.77 s, 6 ms with a commit-graph file); the details are the weight (30.5 MB on CPython against a 1.32 MB shape); 200 rows' details take 20 ms anywhere; tips sit deep (median row 9,165–11,068), so the panel needs every row's place. |
| 52 | What diverged picks compare | **The fork point (merge-base) against head; the lower pick is the base; Swap** | What a branch adds since it forked is what a pull request shows; directly, base's own changes would show as reverted. For a commit and its ancestor the merge-base is the ancestor, so V9's picks compare as before. |
| 53 | The left panel | **Branches only: Local (with ahead/behind), Remotes by remote and folder; a filter; a click goes to the tip** | Asked: "graph + branches panel", "the tree should be branches only". Bitwarden's 1,591 remote branches need folders and a filter. |

**Not in V10 (later)**: hiding branches from the graph (checkboxes in the panel); a commit's
details (message, files); repository actions from the panel (checkout, delete, fetch); histories
beyond CPython's size (browsers cap an element's height: Chromium at 33.5 million px, about a
million rows of 32 px; the Linux kernel has 1.3 million commits); uncommitted changes as a row;
a direct diff of diverged picks; a lane layout that moves lines left as lanes free up (git
`--graph`'s p95 is lower: Bitwarden 90 against 112 lanes whole).

## As built — V10a

- **Core** (`src/git/log.ts`): `streamHistory(repo, scope, onRows)` streams `git log
  --topo-order -z --format=%H%x1f%P` (a new `gitStream` in `exec.ts`); `commitDetails(repo,
  shas)` reads rows by SHA (`--no-walk=unsorted`, V9's format, full SHAs only);
  `historyState(repo)` gives the branch, HEAD and a version (a hash of HEAD and `for-each-ref`
  over `refs/heads` and `refs/remotes`: tags do not change it); `hasCommitGraph(repo)`.
  `listCommits` and `/api/commits` are gone: the history serves both scopes, and nothing else
  called them.
- **Server** (`packages/cli/src/history.ts`): `Histories` keeps one listing per scope until the
  version changes; a request without a version checks it (and lists anew), one with a stale
  version answers 409. `GET /api/history?scope=&from=&to=&version=` (at most 500 rows; it waits
  only until `to` rows are listed) and `GET /api/history/shape?scope=&version=` (the plan had
  `rows=<from>-<to>`). After a listing over 500 ms in a repository without a commit-graph file,
  `symbiote view` prints once: "hint: listing 150,182 commits took 1.2 s; `git commit-graph write
  --reachable` (or `git maintenance start`) lets git list them at once".
- **Lanes** (`src/lanes.ts`, pure): as planned, plus arrows for lines over `LONG_LINE` (100)
  rows (`down`, `up` per row). A line joins a lane already going to its parent rather than be
  cut. Before the shape arrives the first page's parents are numbered by `parentRows` (a parent
  not listed gets its own negative number); a line to one is cut when more than 100 rows
  follow, so only the first page's last 100 rows can change when the shape comes.
  `laneSpacing(lanes)`: 14 px, down to 6.
- **Drawing** (`src/GraphCell.tsx`, `src/CommitsPage.tsx`): rows 32 px high, absolutely placed,
  without borders (lines run from row to row); only rows near the view are in the page (35 at
  1440 × 900), details asked for by block of 200 (`blocksAround`). Lane colors are
  `--lane-1`…`--lane-6` with dark values, set as `color` per lane class so lines and dots use
  `currentColor`. "All branches · This branch (main)" in the title, `?scope=current` in the URL.
  The cursor starts on HEAD.
- **Badges**: a row shows three refs at most, then "+N" naming the rest. Qwik's HEAD row carries
  nine tags: on `main` its subject was squeezed to nothing (a first row Playwright saw as hidden).
- **Picks** carry their row (`Picked`); `comparison` counts through the shape's row numbers.
- Trap: the planning prototype did not count a side branch's line down to its fork on HEAD's
  line, and gave Bitwarden 17 lanes where the real layout (and git) needs 142. The check script
  found it on the first run; decision 50 was asked again with the real numbers.
- Trap: in this machine's headless Chromium (WSL) the first layout of the stylesheet's font
  stacks costs 400–1,000 ms per page (`ui-monospace, SFMono-Regular, Menlo` alone: 347 ms; plain
  `monospace`: 4 ms). It predates V10 (`main` pays it too) and a Windows browser does not;
  timings below are also given with plain fonts.

**Results (V10a)**, 4 cores, WSL, fresh clones without a commit-graph file:

| | Symbiote | Qwik | Bitwarden | CPython |
|---|---|---|---|---|
| Rows (every branch) | 181 | 12,362 | 39,861 | 150,182 |
| First listing (git's walk), server | 0.02 s | 0.08 s | 0.28 s | 0.80 s |
| First rows, warm server, plain fonts: `main` / V10 | 101–119 / 107–148 ms | 87–96 / 102–104 ms | 90–96 / 106–133 ms | 90–94 / 114–120 ms |
| Shape received, warm server; longest task | — | 74–75 ms; none | 78–79 ms; none | 83 ms; 62 ms (lanes) |
| Lanes (`layoutLanes`) | 0 ms | 6 ms | 22 ms | 67 ms |
| Scrolling 30 screens, jumping to the middle and end: longest task | — | 0 ms | 0 ms | 0 ms |
| Browser heap after scrolling | — | 17 MB | 25 MB | 72 MB |

- `lanes-check.mjs`: 0 errors on Symbiote, ky, zod, vite, Qwik, Bitwarden and CPython (every line
  ends in its parent's row, every arrow has its partner, lane 0 is exactly HEAD's first-parent
  line).
- A cold server pays git's walk once per scope: CPython's first rows at 0.93 s, its shape at
  1.23 s (plain fonts). `main` lists 100 commits of one branch without that walk.
- Tests: 495 unit (core `log` 14, `Histories` 8, server 2 new, `lanes` 13, `commits` 15), 48 e2e
  (3 new: every branch and "This branch"; 450 commits: rows near the view, details on scroll,
  arrows). Not verified: Windows and macOS browsers; Firefox's and Safari's element height caps
  (Firefox about 17.9 million px: 559,000 rows).
