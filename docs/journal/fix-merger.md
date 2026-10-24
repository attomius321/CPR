# Journal: Fix — a resolution's failed check is said, not taken for a wrong one; Check again

[Index](../JOURNAL.md)

## Fix — a resolution's failed check is said, not taken for a wrong one; Check again (2026-10-22, branch `fix/fix-merger`)

The person approved `feature/agent-terminal-accept-images` (`9a7c9dd`) into `main` (`43924ec`).
Only `docs/JOURNAL.md` conflicted, one region: two entries added at the end. The merger agent
(`sonnet`) kept both (merge `26b2676`). Install, `pnpm check` and the build passed. `pnpm test:e2e`
failed 1 of 189: `shell.spec.ts:120`, the keys flake (8 of 30 runs failed on `main`, the rename's entry above).
The row read "Resolved 1 region (sonnet) · its check failed: pnpm test:e2e", all red, with no
Approve. "It should display what actually happened… not assume the merge was incorrect because
of a test." Then, on the plan: "And check again in the end".

**Learned**:
- **Not designed: V26c's code added it.** The plan had a resolution wait "plus the check's result.
  Approve → ready → landed", and no decision blocks Approve on a failed check. V26c's commit
  message says "Approve lands it (not when its check failed)". It was blocked in three places:
  `mergeState` (red), `mergeActions` (no Approve) and `approve` (409). The check judges the
  merge, not the resolution, and here no test or source file reads `JOURNAL.md`. Decision 242:
  the person decides.
- **A second fault was behind the first.** With Approve allowed, a landed merge said "checked in
  2 min 31 s" after a failed check, and a refused landing at `ready` said "Merged, not checked".
  Both now keep "its check failed (…)", and so does `symbiote merge`.
- **What ran is in the entry already.** `commands` and `failed`: the commands before the failed
  one passed, the ones after it did not run. `failedCheck` says it ("pnpm install, pnpm check and
  pnpm build passed; pnpm test:e2e failed after 2 min 31 s") without a schema change.
- **Red is for what Symbiote cannot carry further.** A resolution whose check failed is the
  person's turn, `you`, as a passed one is.
- **Check again needs the worktree back at the merge.** A resolution waiting at `needs-you`
  holds nothing, so another merge may have reset Symbiote's merge worktree. `recheck` goes
  through the queue (one merge or check at a time) and resets the worktree to `merge` first. A
  test moves the worktree in between and checks the commit each command ran on. A process that
  stops mid-check merges it again in full, as before. A clean merge whose check failed keeps
  Retry, which is the same with no agent (decision 153).
- **Three actions do not fit at 390 px.** "Request changes" and "Check again" broke over two lines.
  The actions now wrap as whole buttons.
- The README's Merging section still described conflicts as in V26a ("stops the merge with the
  files named"). It now describes the merger agent, Approve, Request changes and Check again.

**Verification**: tests first, red for the reason reported:
- Viewer unit, 5: the text and tone, no Approve, ready and landed, no `failedCheck`.
- CLI, 2: `approve` threw "its check failed"; `symbiote merge --approve` exited 1.
- e2e, 1: the row read "its check failed: ls e2e.passed".
- Check again: viewer unit 2, CLI 2 and the server's route (405), red. Its e2e was written first
  but not run red (that needs a build without the button).

`pnpm check`: 1,251 tests. Build. e2e: 194 of 194 in one run, and the merge spec 4 of 4 after
the last change. The keys flake did not show this time.

Screenshots of the resolution page with a failed check (4 commands: 2 passed, 1 failed, 1 not
run), at 1440×900 and 390×844, dark and light: the label is the person's colour, and Approve,
Request changes and Check again are offered. No horizontal overflow and no page error.

Not verified: a real merge with a real flaky check through Check again (the e2e uses a check that
passes once a file exists); `regression-check` (no analysis code: core gained one optional field
on a queue type).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `c258eb5`, no conflicts
(`main` had not moved since the branch).
