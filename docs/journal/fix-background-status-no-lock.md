# Journal: Fix — Symbiote's git reads take no optional lock

[Index](../JOURNAL.md)

## Fix — Symbiote's git reads take no optional lock (2026-10-22, branch `fix/background-status-no-lock`)

The merger's check on `feature/agent-terminal-accept-images` (merge `e80530e`, its JOURNAL.md
conflict resolved correctly) failed 1 of 195 e2e: "Clean up: once merged…", whose `git add
src/half.ts` in a workspace's worktree met "index.lock: File exists". It passed 5 of 5 alone
after. V20a found the cause and proposed this fix ("Found, not fixed here"): `/api/workspaces`
runs `git status` in each worktree, and status rewrites the index under its lock when a file's
timestamps changed. A `git add` or `git commit` made at that moment, by the agent, the person or
a test, fails. Asked: "Yes", to fix it on its own branch.

**Learned**:
- **Four `git status` reads**, all in folders the person or an agent works in: a workspace's
  count (`uncommittedFiles`) and files (`worktreeStatus`), polled with the list; the checkout's
  state before a checkout (`workingState`); a file's state for Settings (`fileGitState`). All go
  through core's `git()`; nothing in Symbiote spawns git elsewhere.
- **One environment fixes them all**: `GIT_OPTIONAL_LOCKS=0`, git's documented setting for
  background processes, in the environment `git()` and `gitStream()` share. Status then neither
  takes `index.lock` nor rewrites the index. Writes (worktrees, checkout, the merger) still take
  the locks they need.
- **Cost**, on a clone of this repository (889 tracked files): 5 ms a status on a settled index
  either way. With every file touched but unchanged, 16–17 ms a read until something else writes
  the index; git with the lock fell to 5 ms after its first writes. Only files touched without a
  change are read again.

**Verification**: test first, red on `main` for the right reason. A worktree and the checkout,
each with a file touched but unchanged, read by the four functions: both indexes were rewritten
on `main`, and now stay byte for byte the same. `pnpm check` 1,252 tests; build; e2e 194 of 194. Not
verified: that the race is gone from the e2e suite (seen twice in this journal, V20a and this
check; the test shows its cause instead); `regression-check` (the analysis' git calls take no
optional lock, so their output cannot change).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `7fdd235`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md`, resolved in the merge.
