# Journal: V67 — Merge strategies: a merge commit, or a fast-forward to the approved commit

[Index](../JOURNAL.md) · [Plan](../plan/v67-merge-strategies.md)

## V67 spike — how many merges could have been fast-forwards (2026-10-27, branch `feature/review-merging-strategies`)

Replayed the last 200 first-parent commits of this repository's `main`: for each merge, whether
its first parent (the target's tip then) was an ancestor of its second (the branch), with `git
merge-base --is-ancestor`. Read the merger's code (`merges.ts`, core `git/merging.ts`) for where
a merge commit is made and how a branch lands.

**Learned**:
- **Most merges here could have been fast-forwards**: 118 of 159 (74 %); of the merger's own 74
  (`Merge <branch>: <title>`), 44. Each added a merge commit a fast-forward would not have.
- **The landing is a fast-forward already** (`fastForwardBranch`: `merge --ff-only` in the
  checkout, else `update-ref`): only the merge step changes. A fast-forward sets the entry's
  `merge` to the approved commit and goes through the same check and landing.
- **Which targets can fast-forward is one git call**: `for-each-ref --merged <approved>` lists
  every branch whose tip is in it. One `merge-base --is-ancestor` per branch would be 1,591 runs
  on Bitwarden.

## V67 — a merge by fast-forward, picked at Merge into (2026-10-27, branch `feature/review-merging-strategies`)

Merge into ▾ gets a second select, "with a merge commit" or "by fast-forward"; `symbiote merge
--strategy`, MCP's `queue_merge` and `merge.strategy` say the same. A fast-forward merges
nothing: the merge worktree is reset to the approved commit, the check runs there, and the
existing landing moves the target to it. Only where the target's tip is in the approved commit;
a target that moved while it waited waits for the person, with Merge commit instead. Decisions
485–489.

**Learned**:
- **The landing was a fast-forward already**: only the merge step changed. `landEntry`'s guard
  (the target still at `base`, and `base` in `merge`) holds for a fast-forward as written, so a
  target moved during the check goes back to the queue, and at its turn waits for the person.
- **One row is all the workspace head has**: a line of text for "cannot fast-forward" wrapped
  its actions to a second row, the head's height then following the picked target. An icon with
  the reason in its tip keeps the row. Seen only in screenshots: the e2e tests passed with the
  wrap.
- **The strategy select costs the head about 180 px** at 1440 px: the title, branch and state
  give way ("Approved: ask your agent to me…" to "Appro…"). Compared by hiding the select in the
  same page, which is what `main` draws there.
- **Words written for a merge read wrong for a fast-forward**: "Merged, not checked", "main
  moved since the merge", "main moves to 1a2b3c4" on one that cannot. Found reading the merge
  page, in the e2e test and its screenshots; each has a test now.
- **A full check here runs e2e while other sessions run theirs**: run 1 of the real use failed 3
  of 309 e2e (intro, a merge spec, a review spec) under a load average of 20, and nothing
  landed, which is the merger doing its job. Run 2, without e2e, landed.

**Verification**: tests first, red for the right reason (16 in `merges.test.ts`, 1 server, 2
MCP, 4 viewer); 2 e2e written after the viewer's code. Screenshots of Merge into ▾ (the head, the
Review tab), its tip, and the merge page ready and waiting, dark and light, 1440 px. The real
runs in the plan's results: landed in 84.7 s, the landing under 0.1 s; a target that moved
refused at queue time.

Not verified: a real `symbiote view` session of the person's (the e2e harness and a clone of
this repository were used); Codex or Claude Code as the merger (a fast-forward asks no agent).
