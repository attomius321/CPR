# Fix — One pid lock that cannot be taken twice: the merge queue, Hive, analysis slots

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S3)

**Status:** planned (2026-11-06), to be built on branch `fix/pid-lock` in its own workspace; written
by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/pid-lock` · **Size** S · **Depends on** none · **Plan** P12 of 51
(the audit's order)

## The brief

**What happens**: three hand-written pid locks can be held by two processes at once.
- **The merge queue's and Hive's**: `writeFile(file, pid, { flag: 'wx' })` creates the file
  before its pid is in it. A second process that reads it in that moment reads `''`, which is pid
  0, "not held". It removes the live lock and takes its own.
- **All three, including core's analysis slot**: two processes that both find a stale lock both
  remove it and create their own. The later `rm` deletes the first winner's lock. Core's comment
  says so: "Two runs recovering the same lock at once is not handled".

Two merge queues then drain into one target, two Hive runners run, or two analyses check out into
one slot and give a wrong graph.

**How to reproduce** (a test, since the window is a few µs):
- Write an empty lock file, then call `lock()`. `merge-queue.ts` and `hive-runner.ts` take it.
- Two `tryLock` calls in core on one stale file, interleaved through a stubbed `rm`, both return a
  release.

**Where to look**:
- `packages/cli/src/merge-queue.ts:35-60`: `lock`, and `lockedElsewhere`, which reads `''` as 0.
- `packages/cli/src/hive-runner.ts:333-356` (`lock`, `unlock`, decision 656) and `:2295`
  (`aliveProcess`, a second copy of the alive check).
- `packages/core/src/git/worktree.ts:104-140`: `tryLock`, and `isStale`, which already waits 60 s
  before calling an unreadable lock stale.

**Out of scope**: `merges.json`'s cross-process writes (listed for P51); what each lock protects.

**Done when**:
- One `pidLock(file)` in core (Node only, no new dependency) used by all three.
- An empty or half-written lock younger than 60 s counts as held.
- Taking over a stale lock is atomic: of two processes recovering it at once, exactly one wins.
- The three call sites behave as today otherwise (same files, same release).

## Evidence

Code (finding S3), read on `main` c2aa5c4:
- `merge-queue.ts:39` and `hive-runner.ts:339` write with `flag: 'wx'`.
- `merge-queue.ts:52`: `Number('')` → `0` → "not held".
- `hive-runner.ts:345-347`: `held` 0 → `aliveProcess(0)` false → `rm`.
- `worktree.ts:111`: the comment about two runs recovering at once.

## Approach

- **Create**: write `${pid}\n` to `<file>.<pid>.tmp`, then `link(tmp, file)`. It is atomic and fails
  with `EEXIST` if the lock is held. Then remove the tmp file. The lock is never seen empty.
- **Take over a stale lock**: `rename` the stale file to `<file>.stale.<pid>`, which only one
  process can do, check that the renamed file still holds the stale pid, then try `link` again.
  The loser of the rename sees `ENOENT` and retries the normal path.
- **Read**: an unparseable lock younger than 60 s is held (core's rule today).
- **One alive check**, `process.kill(pid, 0)` with `EPERM` as alive, exported with it.
- Put it in `packages/core/src/lock.ts`. The CLI already imports core at run time.

## Tests first

`packages/core/test/lock.test.ts` (new):
- an empty lock file made just now → `pidLock` returns undefined (held). It fails today for the
  merge queue's and Hive's logic.
- A lock holding a dead pid, taken by two `pidLock` calls in parallel (`Promise.all`, run 50 times)
  → exactly one release each time. It fails today: core's comment.
- A live pid → held; its release removes only its own lock.

Plus a case each in `merges.test.ts` and `hive-runner.test.ts`: an empty lock file blocks
`lock()`.

## Verification

- `pnpm check`, `pnpm build`.
- `regression-check` r1 against `main` (the analysis slot's lock changed): identical graphs and
  times within noise.
- `pnpm test:e2e`: `merges.spec.ts`, `hive*.spec.ts`.
