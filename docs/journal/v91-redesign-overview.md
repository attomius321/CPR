# Journal: V91 — Redesign step 4: the Overview pages

[Index](../JOURNAL.md) · [Plan](../plan/v91-redesign-overview.md)

## V91 spike — what the Overviews ask of the records (3 November 2026, branch `feature/redesign-overview`)

Read both proofs 01-overview against `705f20d`'s viewer, server and records, and this repository's
own records (`symbiote/`, the merge queue in the cache, git), read only.

**Learned**:
- **The merge queue does not say what was merged today**: it keeps a landed entry until the person
  removes it, and this repository's holds 0 entries, while git has 73 first-parent merges into
  `main` in 7 days (7–13 a day). Merged today and this week come from git.
- **Hive's spend is a running total**: `HiveSpend` per workspace, in the detail read only. A
  review's cost is timed by its `review` event; the writer's count only by its last read.
- **The writer's spend can be had by day**: Claude Code writes `cost-state`, the session's total,
  at each turn's end, with no time of its own. In the 14 Hive writers' transcripts all 63 such
  lines follow a line with a `timestamp` (41 a `turn_duration`, the turn's end; 6 an
  `away_summary`, 4 each an `api-request`, `queue-operation` and `assistant`, 2 each a
  `frame-link` and `attachment`), and no total shrinks. The next timed line comes 7 min later at
  the median (23 at the 90th percentile): the line before is the turn's end, not the one after.
- **Hive's events are recorded but not served**: `hive/<branch>.jsonl` (check, review with cost
  and kept findings, landed, stuck, pushed…), 2.4 MB over 42 files; nothing reads them yet.
- **Findings are not recorded per workspace**: a review's findings are worked out when it opens.
  The proof's Findings to read has no source.
- **Keys**: every keydown handler binds one of `a c d f g h i j k m n o p r s v w x`, `P`, `/`,
  `[`; `t` is free everywhere.

## V91 — the Overview, both modes (3 November 2026, branch `feature/redesign-overview`)

Built the Overview at `/overview`. It is first in the sidenav, the page `/` opens, and its key is
`t`. Normal mode follows its proof: the figures, the inbox with one action a workspace, agents at
work, the merges, merged today, usage and today's events. So does Hive mode: five figures, a
stopped workspace with why, in flight on V89's stage tracks, landed today, limits and events. A new
read-only `GET /api/workspaces/day?since=` gives the events, Hive's records with their writer's
timed totals, and git's merges. Decisions 848–859.

**Learned**:
- **The viewer's own typecheck is the only one that sees its sources.** Vitest does not
  typecheck, and the root `tsc -p tsconfig.json` covers the other packages. A union member left
  out of `Route` (a comment's line break broke the edit) passed every unit test, the build and the
  e2e run. Only `pnpm check`'s `pnpm -r typecheck` caught it. Run
  `pnpm --filter @symbiote/viewer typecheck`, not only the root `tsc`.
- **A merge's subject is not always the merger's.** This repository's merges read
  `Merge V90: …`: the person's convention, the same shape as Symbiote's `Merge <branch>: …`. The
  real records showed "a review's pages redesigned" as a title. A subject is now cut only when its
  branch is a workspace Symbiote knows.
- **Re-reading files is most of a warm read.** The day read's first build spent 105 ms on each
  warm read: threads parsed twice, the 147 workspace records read again, and 5–8 spawns of git one
  after another. Keeping each parse until its file changes, keeping the default branch and the
  records' place for a minute, and reading in parallel took it to 30–34 ms.
- **A first page that draws sooner moves the tests' timing.** Electron's `page.url()` follows the
  page's history a moment after the page draws. With Git as the first page, its rows took long
  enough to hide that. The app's specs now wait for the moved address.
- **The Done fold hides cards that eight specs were about.** Those specs open it through the
  browser's stored choice, as a person would.

**Verification**:
- **Tests first:** 34 unit tests for the derivations, 6 for the day read and 2 for its route, each
  seen failing.
- **`pnpm check`:** 2,992 tests.
- **`pnpm test:e2e`:** 414 of 415, then the one that failed (`page-frame.spec.ts`'s Hive frame,
  measured before the stopped card drew) fixed and passing twice in a row, with `overview.spec.ts`.
  `workspaces.spec.ts:510` failed once in a batch of specs and passed alone three times, and in the
  full run. It reads bounding boxes without waiting; it was not changed.
- **Real records:** the branch's `/` on a clone of this repository with its records. 64 merges this
  week, a 1.5 h median time to merge, today's events from the threads.
- **First paint:** no slower than `main` (the plan's Results).
- **Screenshots:** both modes in both themes, empty, none in flight, the budget reached and a
  narrow window, beside the proofs (`coverage/overview-shots`, not committed). Also `main`'s `/`
  and the branch's on the real records.

Not verified:
- A real Hive run feeding the Hive Overview. Its sections were checked over the proofs' records,
  answered by `page.route`, with Hive on.
- A transcript's cost line timed across a real midnight: the times were measured on 63 real lines,
  and the arithmetic across midnight is unit-tested.
