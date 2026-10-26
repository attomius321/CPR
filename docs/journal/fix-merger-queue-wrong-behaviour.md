# Journal: Fix — a merge that failed or waits for you holds the next one; Check again on a moved target

[Index](../JOURNAL.md)

## Fix — a merge that failed or waits for you holds the next one; Check again on a moved target (2026-10-25, branch `fix/merger-queue-wrong-behaviour`)

The person: with two merges in the queue, "the second one when it starts, it does not recheck the
current HEAD of main… because the first merge might move the HEAD… also if the first merge fails,
the second one should not start… the queue must remain intact and wait for the first to resolve in
some way or another."

**Learned**:
- **Both are in Symbiote's own log of the day** (`<cache>/logs/2026-10-25.jsonl`, the `view`
  process that merged this repository). At 20:20:52 `fix/merging-status` failed its check, and in
  the same second `spike/ctrl-x-ctrl-s-works` started merging. At 21:03:40
  `feature/done-workspace`'s resolution went to `needs-you`, and `feature/skills-page-styling`
  started at once on main's tip of that moment. The first was approved 6 s later and main moved.
  The second's agent run and its 5-minute check ran on the old tip, and its Approve at 21:09:39
  found "main moved since the merge: merging again on its tip": a second agent run and a second
  check.
- **The fault was a choice of V26a's.** "A merge waiting at `ready` holds later merges into the
  same branch… A conflict or a failure holds nothing." A merge that starts always read the
  target's tip; it started too early. A failure or a resolution waiting for the person still lands
  in the end (Retry, Approve), moving the branch, so a merge started beside it is made and checked
  on a tip about to move. Landing refused the stale merge (`landEntry` compares the tip with
  `base`), so nothing wrong ever landed. The cost was the runs and the order.
- **`holding` is now every state but `queued` and `landed`.** A merge into a branch waits until
  every other merge into it has landed or been removed. The ways out are the page's buttons: Retry,
  Request changes, Answer and Check again queue it again (it is earlier in the queue, so it goes
  first), Approve and Land land it, Remove takes it out. While the fix is in, no branch can have two
  merges held this way: one runs or waits at a time. A queue written before it may have two failed
  merges into one branch; the second, retried, then waits for the first as well.
- **Check again was the one start that did not read the tip.** It reset the worktree to the old
  merge commit and checked it, so a target moved meanwhile (a merge by hand, now the only way)
  had its check run on a merge Approve would refuse. It now reads the tip first: unchanged, the
  same merge is checked again (fix/fix-merger); moved, it is merged again on the tip, as a landing
  that finds the target moved does, the merge step's first line saying so.
- `symbiote merge` and the MCP's `queue_merge` follow a held merge as they followed one behind a
  `ready` merge: it stays `queued`. The viewer says "Queued" with the wait tone's spinning dot; the
  merge that holds it is listed with it, red or amber. Naming it in the queued line ("after
  fix/x, which failed") is left for later.

**Verification**: tests first (`merges.test.ts`), red for the right reason (4): behind a failed
merge the second merged too (`['failed', 'failed']`, its check the same fake); behind a resolution
waiting for review the second landed (`['needs-you', 'landed']`); after a commit on main, Check
again checked the merge on the old tip (`base` the old `M2`). Then green: Retry lands both in
order, the second on the first's merge; Remove starts the second on main; Approve starts the second
on the resolution; Check again on a moved main merges again (its parents the new tip and the
branch, the agent asked a second time, the log's line). The merger's 67 tests pass, the existing
"holds … while one waits to land", "merges one at a time" and "runs a failed check again on the
same merge" among them. `pnpm check` (1,766 tests, with the entry below), `pnpm build`, `pnpm
test:e2e`: 271 of 272, every merge spec among them. The one failure, `changes.spec.ts:100` (`]`
shows a workspace's Changes), fails 1 of 64 runs under 16 workers and 0 of 10 alone; nothing on
its path changed here. Not measured on `main`.

Not verified: a real queue of two merges in a running `symbiote view` (the tests run the merger
on real git repositories with a fake check and agent).

## The Skills page's Save: a `title` the merge of V54 brought back (2026-10-25, same branch)

`pnpm check` failed on `main` (`d3dd6e1`) before this branch changed anything:
`tooltips.test.ts` found `skills/SkillsPage.tsx:583 <button title>`. V54 (`e003bbe`) had made
the Save button's `title` a tip; V56 moved the button out of the delete branch. The merger agent
was asked about that region, and the resolution approved at 21:19:54 kept V56's button with its
`title`.

**Learned**:
- The button now has V54's `tip('Save it in this checkout', { keys: 'Ctrl+S' })`; `tip` was still
  imported. Nothing else of the merge differs from either side on tooltips (`tooltips.test.ts`
  reads every component).
- Every merge into `main` runs `pnpm check`, so until this lands every merge fails its check, this
  branch's too.

**Verification**: `pnpm check` red on `main`'s code (1 of 1,766: the test above), then green
(1,766 of 1,766).
