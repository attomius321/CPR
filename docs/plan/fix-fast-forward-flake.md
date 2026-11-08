# Fix — The fast-forward spec stays "Queued" under load: find why

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S9)

**Status:** planned (2026-11-06), to be built on branch `fix/fast-forward-flake` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix (an investigation first) · **Branch** `fix/fast-forward-flake` · **Size** S–M ·
**Depends on** none · **Plan** P32 of 51 (the audit's order)

## The brief

**What happens**: in the full `pnpm test:e2e` (431 viewer tests, 3.0 min), the test
"a fast-forward main can no longer take waits for you; Merge commit instead lands it with one
(V67)" failed. After Land, its entry stayed
`Queued: d190621 into main, by fast-forward (main moved: fast-forwarding again from its tip)` for
the whole 12 s window, 26 polls. It should have read
`Cannot fast-forward: main has 1 commit feature/add-a-half-function does not…`. Alone,
`--repeat-each 5`, it passed 5 of 5 in 6.2 s.

**How to reproduce**: `pnpm build`, then `pnpm test:e2e` in full while other work loads the
machine. Alone: `cd packages/viewer && npx playwright test e2e/workspaces.spec.ts:2293
--repeat-each 20`, with a CPU hog (`stress -c 16` or two other spec runs) to reproduce the load.

**Where to look**:
- The spec: `packages/viewer/e2e/workspaces.spec.ts:2293-2330` (`POLL` is 12 s here).
- `packages/cli/src/merges.ts:923-940` (`landEntry`: a moved target sets the entry back to
  `queued` with "fast-forwarding again from its tip").
- `:1072-1108` (`drain`: takes the queue lock, re-queues stale runs, merges the next queued).
- `:1113-1127` (`kick`: one drain at a time, `again` for a kick during a drain).
- `:1203-1204` (the Land route: `landEntry` then `kick()`).
- `packages/cli/src/merge-queue.ts:35-60` (the pid lock; a drain that cannot take it returns at
  once and no retry is scheduled).

**Out of scope**: the merge queue's design; the other merge specs, unless the cause is shared.

**Done when** one of:
- **A cause found and fixed**: the spec passes 20 of 20 under the reproduced load, and the
  journal names the cause with the timings that showed it.
- **Or the wait justified**: the queue's steps were timed under load, the spec's wait is raised
  to what the numbers say (e.g. the 99th percentile × 2), and the journal records them.

## Evidence

Reproduced: the full run failed (output in the audit's checks section); the run alone passed 5 of
5. Under that load other specs passed. The repository's 15 s expect timeout (`playwright.config.ts`,
AR2) is 12 s in this spec.

## Approach (investigation)

Time each step of the entry with the merge log's timestamps, `<cache>/state/<repo>/merges/*.jsonl`
(`merges.ts:395`). While investigating, keep the spec's cache rather than removing it at `stop()`. Hypotheses, in order:
1. **No drain after the re-queue.** The Land route's `kick()` ran while a drain was running (the
   one that saw "Not checked"), `again` was set, and the second drain found the lock held: a
   `null` from `queue.lock()` returns with no retry. The S3 race (P12, an empty lock read as free)
   is related.
2. **The re-merge itself is slow under load**: `git merge` in the cache's merge worktree. The log's
   step times show it.
3. **The page's poll**: the merge page reads on the event stream (V94). Under load an event may
   come late; the server's state is in `merges.json` at the moment of failure.

## Tests first

A unit test in `packages/cli/test/merges.test.ts`: Land while a drain holds the lock. The
re-queued entry must be picked up by the next drain within one kick, with no new request. Red if
hypothesis 1 holds. Write the test that matches what the timings show.

## Verification

`--repeat-each 20` under load, before and after; `pnpm test:e2e` in full twice; `pnpm check`.
