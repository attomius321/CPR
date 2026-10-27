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

## V65 — a workspace reviewed against where it started, or a branch picked in it (2026-10-27, branch `milestone/v65-review-against`)

One rule for where a branch's review starts (`packages/cli/src/review-base.ts`), read by Review,
a workspace's changes, its count, a file's diff and the merge check; `against` in the record, set
from a select in the changes panel's Commits heading (`GET`/`POST /api/workspaces/against`); an
approval and Merge into ▾ target the branch reviewed against. Decisions 471–474.

**Learned**:
- **The server keeps an opened review by branch** (`opened` in `server.ts`): a pick must drop it,
  or a reload of the review page keeps the old base. The server test is red without the drop.
- **`useChanges(branch, [version, picks])` would loop**: a new array each render is a new effect
  dependency, a read each render. The re-read is a number of its own.
- **The head's merge check is read per tip**: without `against` in the summary it kept saying
  "Merges cleanly into main" after a pick of another branch.
- **A start commit can be older than a fork point that does not descend from it** (a workspace
  from a History row inside another branch): the fork point with `main` is then before the start,
  and counting from it took the other branch's commits; descent decides (decision 471).
