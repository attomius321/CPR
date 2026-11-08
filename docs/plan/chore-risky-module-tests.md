# Chore — Tests of their own for the merge queue, runShell, core's merging and the Codex runner

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding Q5)

**Status:** planned (2026-11-06), to be built on branch `chore/risky-module-tests` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/risky-module-tests` · **Size** S · **Depends on** none; overlaps
P11 (runShell) and P12 (the pid lock): build their failing tests there, and only the rest here ·
**Plan** P48 of 51 (the audit's order)

## The brief

**What to change**: modules that run processes, hold locks or move branches have no test of
their own; they are reached only through larger tests or e2e specs. Add direct unit tests that
pin today's behaviour, and mark (as `it.fails` or `it.todo` with the plan's name) the cases
other plans fix.

**Where to look** (checked on `main` at c2aa5c4):

| Module | Lines | Tests that import it today | Cases to write |
|---|---|---|---|
| `packages/cli/src/merge-queue.ts` (`mergeQueue`: `read`, `change`, `lock`, `lockedElsewhere`) | 65 | none | read of a missing and of a corrupt `merges.json`; `change` serializes two changes in one process; the lock: free, held by a live pid, held by a dead pid (taken), **empty file** (today taken: P12), two processes taking it at once (child processes; today both can win: P12) |
| `packages/cli/src/programs.ts` (`runShell`) | 287 | 7 files, none for `runShell` (`runGroup` only, in `hive-review.test.ts:26,277`) | exit codes, output kept to its last 200,000 characters past 1 MB, the timeout: a compound command (`sleep 100 & sleep 100; wait`) is stopped **with its children** (today only `sh`: P11) |
| `packages/core/src/git/merging.ts` | 9 exported functions: `resetMergeWorktree`, `mergeInWorktree`, `fastForwardBranch`, `tipsIn`, `pushCommit`, `commitSubject`, `conflictKinds`, `abortMerge`, `commitResolution` | none names them; reached through `cli/test/merges.test.ts` | each on a scratch repository: a clean merge, a conflict, each `ConflictKind`; `commitResolution` with a path holding `[id]` beside another unresolved path (glob pathspec: P51's item); `pushCommit` to a remote that does not answer (no timeout today: P13) |
| `packages/cli/src/workspace-codex.ts` | 359 | none | `workspaceCodex` with a fake `codex` (the e2e's `fakeCodex` in `packages/viewer/e2e/symbiote.ts` shows its shape): start, a turn's end, a failed turn |

**Out of scope**: fixing what the tests show (P11, P12, P13 and P51's items do); refactoring the
modules (P44); e2e specs.

**Done when**:
- Each module in the table has a test file of its own (`merge-queue.test.ts`, `programs.test.ts`,
  `core/test/merging.test.ts`, `workspace-codex.test.ts`).
- Every case in the table is written: passing for today's behaviour, or `it.fails` naming the
  plan that fixes it.
- The new tests add under 10 s to `pnpm test` (measured; the suite is 41 s of wall time).

## Evidence

**Code**: the import counts above (`grep -rl "src/<module>.js'" packages/cli/test`); the cli
review's thin-tests list, checked for this plan. The core review: none of `merging.ts`'s 9
functions is named in a test.

## Approach

Scratch repositories as the other tests make them (`packages/cli/test` helpers, `GIT_CONFIG_GLOBAL
=/dev/null`), and a cache folder of their own (`SYMBIOTE_CACHE_DIR`: P10's fix; set it in each
new test even before P10 lands). Child processes for the two-process lock case. No real agent:
fakes only.

## Tests first

This plan is tests. Write the `it.fails` cases first and see them fail for the right reason (the
lock taken twice; the child of `sh` still alive after the timeout).

## Verification

- `pnpm check`; the new files alone 5 times (`npx vitest run <file> --repeat 5` or a loop): no
  flake.
- `ls ~/.cache/symbiote/worktrees | wc -l` before and after a run: unchanged.
