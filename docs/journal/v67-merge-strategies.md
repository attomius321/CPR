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
