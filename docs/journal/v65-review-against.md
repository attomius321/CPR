# Journal: V65 — A workspace reviewed against where it started, or a branch you pick

[Index](../JOURNAL.md) · [Plan](../plan/v65-review-against.md)

## V65 spike — what a stacked workspace's review shows (2026-10-27, branch `milestone/v65-review-against`)

Read where Review, the changes panel, the head's count and the merge check start: all at the fork
point with the default branch (`reviews.ts` `resolve`, `workspaces.ts` `changesBase`), the
workspace's record not read. A workspace started from `feature/one` (2 commits) with 1 commit of
its own lists 3 commits and 3 files; one started from a History row inside `feature/one`, 2.

**Learned**:
- **The merger already stacks**: Merge into ▾ preselects the workspace's `from` (V26a), while
  the approval it follows names `main` (`info.into`). Review and merge disagreed on the target
  before this milestone; the base and `into` are now one rule (decision 473).
- **`workspace.base` alone is not enough**: after the agent merges `main` in, the start commit
  would count `main`'s commits again (the fix of 2026-10-20). The default moves it to the fork
  point with the branch it started from when that descends from it (decision 471).
