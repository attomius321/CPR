# V9 — Pick two commits

[Index](../PLAN.md) · [Journal](../journal/v9-commit-picker.md)

**Status:** merged into main (2026-10-13, from branch `milestone/v9-commit-picker`). As built
and results: "As built — V9" below.

**Problem** (asked: "I would also like to start making a git user interface to manage the
repository … from where you can select 2 commits and go to this diff page … This should be the
first page when you type "symbiote view" command. A list of commits, select 2 commits, view diff
between them."). Today `symbiote view` without arguments is a usage error ("missing <base>"): the
revisions come from the command line, the server starts with one graph analyzed before it
listens, and another pair means stopping it and running again. Measured on the regression
clones (4 cores, `symbiote diff`, this branch's build):

| Repo | Commits | 100 commits listed (`git log`) | One commit (`HEAD~1..HEAD`), first / second run | 20 commits |
|---|---|---|---|---|
| ky | 549 | 9 ms | 6.6 / 2.8 s | 5.6 s |
| zod | 3,247 | 66 ms | 10.4 / 6.2 s | 6.6 s |
| vite | 9,734 | 14 ms | 0.7 / 0.6 s (no TypeScript changed) | 9.5 s |
| Qwik (`--plugin qwik`) | 10,736 | 8 ms (628 ms with a cold disk) | 24.3 / 13.6 s | 23.3 s |
| Bitwarden (`--plugin angular`) | 23,236 | 23 ms | 59.1 / 46.5 s | 86.6 s |

So listing commits is instant, but a pair takes 1–90 s: the page must say what it is doing and
keep what it made. And the analysis is synchronous (ts-morph): run in the server's process, it
would stop the server answering for up to 90 s.

**Goal**: `symbiote view` with no arguments opens a page listing the current branch's commits; the
reviewer picks two (or one commit, against its parent) and gets the same diff page as
`symbiote view <base> <head>`, with a way back to the list. `symbiote view <base> [head]` and `symbiote pr` work
as today; `symbiote diff`'s results do not change.

## Commit list (V9a)

- Core: `listCommits(repo, { skip, limit })` in `packages/core/src/git/log.ts`: `git log HEAD`
  with fields separated by `%x1f` and records by `%x00` (subjects may hold anything), parsed by a
  pure `parseLog`: sha, parents, author, date, subject, refs (`%D`: branches, tags, HEAD).
  Newest first, 100 a page.
- Server: `GET /api/commits?skip=<n>` → `{ head, commits, more }`; `/api/capabilities` says
  `commits: true` when the server has a repository (`symbiote view`, not `symbiote pr`).
- Viewer: at `/`, when the server lists commits, a commits page instead of the graph: rows with
  the short sha, subject, author, relative date and branch/tag badges, "Load more" at the end.
  A click picks a commit; a second click picks the other end; the lower in the list (older) is
  the base. A bar shows "a1b2c3d → e4f5a6b · 12 commits" and Compare. Each row has "This commit"
  (against its first parent). Keys as in the change list: j/k move, x picks, Enter compares.
  The rules (order, label, one commit) are pure, in `src/commits.ts`.
- CLI: `symbiote view [<base> [head]]`; without arguments nothing is analyzed before serving, so the
  URL prints at once.

## Diffs on demand (V9b)

- **Where a diff lives**: `/diff/<base>..<head>/` (full SHAs). The viewer calls its API with
  relative URLs (`./api/graph`, `./api/source`, `./api/state/<name>`) and loads its files from
  `./assets/`, so under that path every call reaches that diff: the server routes
  `/diff/<pair>/api/…` to it and serves the viewer's files under any `/diff/<pair>/` prefix. A
  diff page can be reloaded or bookmarked while the server runs; reviewed marks and drafts are
  kept per pair, as today (`stateDir` keys by base..head).
- **Starting one**: `POST /api/diffs { base, head }`, a write like the others (same-origin JSON
  with the custom header). Both must be full SHAs of commits (`git cat-file -e <sha>^{commit}`,
  through `execFile`, no shell), else 400. The answer is `{ url }`; the commits page goes there.
- **What is compared**: a picked pair directly, without the merge-base (`--no-merge-base`): the
  diff between the two commits. `symbiote view <base> [head]` keeps comparing with the merge-base, as
  `symbiote diff` and pull requests do.
- **Where it runs**: a child process of the CLI per analysis (`symbiote diff <base> <head>
  --no-merge-base --json` with the server's `--plugin`, `--project` and `--depth`), so the server
  keeps answering, the analysis's memory is freed when it ends, and it can be stopped. Its phases
  (checkout, load base, load head, extract, references, findings) come over IPC from an `onPhase`
  callback added to `analyzeGit`; nothing else in core changes. One runs at a time, in the order
  asked.
- **While it runs**: `GET /diff/<pair>/api/graph` answers 202 `{ phase, elapsedMs, queued }`;
  the page shows "Analyzing a1b2c3d → e4f5a6b — loading head · 12 s" with Stop, and asks again
  every 500 ms; then 200 with the graph, as today. A failure shows the CLI's message and the way
  back. Leaving the page does not stop it: the result is kept.
- **Kept**: the last 8 graphs, in memory, while the server runs; asking for one again is instant.
- `symbiote view <base> [head]` analyzes as today (before serving, in its own process), registers that
  diff and opens `/diff/<from>..<head>/`; its commits page is at `/`. `symbiote pr` is unchanged: one
  graph at `/`. A diff page served by `symbiote view` has "← Commits" in its header.

## Verification

1. **Unit** (red first): `parseLog` (merges with two parents, refs, a subject holding the
   separators, the root commit); `src/commits.ts` (base and head by list position, one commit
   against its parent, the label); server: `/api/commits` pages, `POST /api/diffs` refusals (not a
   SHA, not a commit, another site), a diff's 202 → 200 with a fake runner, sources and state per
   diff, Stop; `onPhase` called in order with the same analysis.
2. **Nothing else changes**: goldens and the `r1` regression set identical; every existing e2e
   spec passes (`symbiote view HEAD~1 HEAD` now opens `/diff/<pair>/`; `symbiote pr` as before).
3. **E2E**: a fixture repo of 5 commits served by `symbiote view` without arguments: the list newest
   first; pick two → "Analyzing…" → the graph; "← Commits"; "This commit"; reload a diff URL.
4. **Real repos**: `symbiote view` in the Bitwarden and Qwik clones: the commits page in under 1 s; a
   pair's time against `symbiote diff` (within 10 % + the child's start); the server answering status
   requests during an analysis in under 100 ms.
5. **Cost**: `symbiote view <base>` as fast as today.

**Risks**

| Risk | Mitigation |
|---|---|
| A pair takes up to 90 s on large repos (Bitwarden) | Progress by phase and elapsed time; Stop; results kept; one run at a time. |
| A child process per diff adds a start (Node, ts-morph) | Measured against today; small next to 3–90 s. |
| Input from the page reaching git | Only full SHAs verified as commits; `execFile`; writes need the same-origin rules. |
| Paths under `/diff/<pair>/` break the viewer's files | The viewer is built with relative URLs (`base: './'`); e2e reloads a diff URL. |
| A stopped run leaves worktree locks | Locks hold the owner's pid; stale ones are recovered (`worktree.ts`). |

**Order**: V9a (the list), then V9b (diffs), on one branch: the list alone compares nothing.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V9a ✅ | Commit list | `listCommits`, `/api/commits`, the commits page, `symbiote view` without arguments. |
| V9b ✅ | Diffs on demand | `/diff/<pair>/`, `POST /api/diffs`, child-process runs with phases, the progress page with Stop, kept graphs, "← Commits". |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 42 | What `symbiote view` opens without arguments | **The current branch's commits: pick two, or one against its parent** | It was a usage error; 100 commits list in 9–66 ms, even with 23,236. |
| 43 | How a picked pair is compared | **Directly, without the merge-base; the older is the base** | "The diff between them"; the merge-base suits a branch against its target (`symbiote view <base>`, pull requests). |
| 44 | Where a diff lives | **`/diff/<base>..<head>/`, the viewer's relative API under it** | One server, many diffs; reload and back work; review state is already per pair. |
| 45 | Where an analysis runs | **A child process of the CLI, one at a time, with Stop** | The analysis is synchronous: in the server it would block it for up to 90 s; a process frees its memory and can be stopped. |
| 46 | What is kept | **The last 8 graphs, in memory, while the server runs** | A pair takes 3–90 s; going back must be instant. On disk later. |

## As built — V9

- **Core**: `listCommits(repo, { skip, limit })` in `src/git/log.ts` returns `{ branch, commits,
  more }` (`branch` is null for a detached HEAD; the plan said `head`). Refs come from `%D` with
  full names as `{ kind: head | branch | remote | tag, name }`; a remote's `HEAD` and refs outside
  `heads/`, `tags/`, `remotes/` (`refs/symbiote/*` from `symbiote pr`, the stash) are left out. The
  subject is the last field, so one holding the separators is read whole. `isCommit` takes only
  full SHAs (40 or 64 hex). `analyzeGit`'s `onPhase` reports `checkout`, `loadBase`,
  `loadHead`, `extract`, `references`, `findings` as each starts; `--since`'s extra extraction
  reports nothing.
- **Server** (`packages/cli/src/server.ts`): one "site" per graph — its sources, review state
  and reviews — at `/` for `symbiote pr`, under `/diff/<base>..<head>/` for `symbiote view`
  (`/diff/<pair>` redirects to the trailing slash). A diff's `api/graph` answers 200 (graph),
  202 `{ base, head, status, phase | queued, elapsedMs }` (`elapsedMs` since asked: waiting
  counts), 502 `{ base, head, error }` (the CLI's `symbiote: …` lines), 404 `{ base, head }`.
  Stop is `POST /api/diffs/stop { base, head }`. Capabilities say `commits: true` under
  `symbiote view` only; there the root's `/api/graph` is 404.
- **Runs** (`diffs.ts`, `runner.ts`): `Diffs` queues pairs, runs one at a time, keeps failures
  until asked again and the last 8 graphs by use (a graph opened again moves to the end).
  `childRunner` spawns `node [execArgv] bin.js diff <base> <head> --no-merge-base --json
  --depth n [--plugin …] [--project …]` with an IPC channel; the CLI sends `{ phase }` when it
  has one (`CliContext.onPhase`). The child's hints and warnings go to `symbiote view`'s terminal,
  prefixed with the pair. Stop sends SIGTERM to the node child only: a `git checkout` it started
  finishes, so no slot is left half checked out, and the slot's pid lock is recovered as stale
  (a run started within that checkout can meet its index lock and fail: "Analyze again").
  Stopping the server stops every run.
- **Viewer**: `src/commits.ts` (pure) and `src/CommitsPage.tsx`. A click picks, a picked commit is
  unpicked, a third replaces the last picked. The label counts the commits head adds to base,
  walked through the listed commits' parents (the rows between them would count commits of
  other lines). A diff page opened anew (a bookmark, a restarted server) starts its own analysis;
  404 while polling (stopped elsewhere) shows "not analyzed" with "Analyze again"; a failure
  shows the message and "Analyze again". `App` loads capabilities, then the graph, and polls
  while it gets 202.
- **CLI**: `symbiote view [<base> [head]]`; `--since` without `<base>` is a usage error. With a pair,
  the URL printed and opened is the diff's (`/diff/<from>..<head>/`); its review state is in the
  same folder as before (`stateDir` keys by base..head).
- Trap: the stylesheet is flat, and `.progress` was already the sidebar's review bar; the
  progress page uses `.diff-progress` (an e2e check holds the bar's margin at 0).

**Results (V9)**, 4 cores, the regression clones, `HEAD~1..HEAD`, warm (worktrees made), 2 rounds:

| | Qwik (`--plugin qwik`) | Bitwarden (`--plugin angular`) |
|---|---|---|
| `symbiote view` prints its URL | 0.58–0.64 s | 0.58 s |
| `/api/commits` (100 commits) | 33–104 ms | 42–166 ms |
| A pair picked → its graph served | 13.8–14.3 s | 41.6–43.2 s |
| `symbiote diff` of the same pair | 14.2–15.1 s | 39.8–40.2 s |
| Status requests during the analysis: median (max) | 1.8 ms (17 ms) | 1.8 ms (20 ms) |
| The pair asked again (kept) | 1.4–3 ms | 6–10 ms (206 kB) |

- A pair through the server against `symbiote diff`: Qwik −3 to −5 %, Bitwarden +3.5 to +8.4 % —
  within the target (10 % plus the child's start, 0.7 s). The server answered 135–421 status
  requests per run, none over 20 ms.
- Phases (polled every 100 ms): the child starts in 0.7 s (Node, ts-morph), checks out in 0.1 s;
  Qwik loads base 6.8 s and head 6.4 s, then extract, references and findings take 0.3 s
  together; Bitwarden loads base 18.6–20.4 s and head 15.2–16.5 s, then extract 0.1 s,
  references 4.9–6.0 s, findings 0.7 s.
- In Chromium on Qwik: the URL printed after 0.60 s, 100 rows drawn 0.24–0.26 s after opening
  (target: under 1 s); two rows four apart labelled "5 commits" (`git rev-list --count`: 5);
  no page errors. Long subjects first widened the page past the window (the brand, dates and
  Compare off screen): `.commits` now has `contain: inline-size`, and the e2e fixture holds a
  long subject. A picked pair's header showed its SHAs twice in full; a ref equal to its SHA is
  now shown short.
- `symbiote view HEAD~1 HEAD --plugin qwik` to its URL, 3 runs alternating: `main` 13.1–14.5 s, V9
  13.2–14.5 s.
- `r1`: 29 comparisons identical (859 edges, no finding changed), time 0.97 of `main`'s.
- Tests: 466 unit (33 new, with the guard against names differing only by case), 45 e2e (5 new; the 40 others unchanged, `symbiote view HEAD~1 HEAD` now
  opening `/diff/<pair>/`).
- Not verified: Windows and macOS (spawning the CLI, signals); a server restarted while a diff
  page polls (the page then starts the analysis again, by design, but no test restarts it).

**Not in V9 (later)**: uncommitted changes as a head (analysis reads commits only); other
branches and tags (a ref picker), search through history; branch lanes; a commit's details
(message body, files); graphs kept on disk across runs; managing the repository (checkout,
branches, commits) — the larger git interface this starts.
