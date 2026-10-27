# V65 — A workspace reviewed against where it started, or a branch you pick

[Index](../PLAN.md) · [Journal](../journal/v65-review-against.md)

**Status:** planned (2026-10-27), on branch `milestone/v65-review-against`.

**Problem** (asked: "The current review of a workspace force against main?" — "Yes, we need
that, and also I need to have the capacity to change the review against branch in workspace. The
default value should be the workspace.base."). A workspace's Review, its changes panel, its
commit count and its merge check all start at the fork point with the **default branch**
(`reviews.ts` `resolve`, `workspaces.ts` `changesBase`, decision 187), whatever the workspace
started from. Since V33 a workspace can start from any branch, and the merger already preselects
that branch (`merges.ts` `targets`: `from` first). Reproduced in a unit test:

| Workspace | Its own | What Review and the panel show today |
|---|---|---|
| `feature/two` started from `feature/one` (2 commits on `main`), 1 commit of its own | 1 commit, 1 file | 3 commits, 3 files: `feature/one`'s 2 as its own |
| started from a History row on `feature/one`'s first commit, 1 commit of its own | 1 commit | 2 commits: `feature/one`'s first as its own |
| started from `main` | 1 commit | 1 commit (right) |

An approval then names `main` as the branch to merge into (`info.into`), while Merge into ▾
preselects `feature/one`. Nothing lets the person compare with another branch.

**Goal**: a workspace's review starts **where the workspace started** (`workspace.base`), and the
person can pick any other branch to review it against, in the workspace. Review, the changes
panel, the head's commit count, the merge check and an approval's `into` follow the same base.
**Unchanged**: a workspace started from the default branch (the default start) — its base is the
fork point with the default branch as today; a branch with no workspace (reviewed from History).

## Where a review starts (`packages/cli/src/review-base.ts`)

One function, `reviewBase(repo, refs, tip, main, workspace)`, used by Review (`reviews.ts`) and
the workspace (`workspaces.ts`: list count, changes, a file's diff, merge check), so the panel
shows what Review shows (decision 187 kept):

- **No workspace**: the fork point with the default branch, `into` the default branch (today).
- **A workspace, nothing picked** (the default): `workspace.base`, moved forward to the fork point
  with the branch it started from (`from`; the default branch for a History row, or once `from`
  is gone) when that fork point descends from `workspace.base`. So it is exactly the start commit
  until the agent takes in that branch (a merge of it, or a rebase onto it): then that branch's
  commits are not counted as the workspace's (the fix of 2026-10-20 kept). `into`: `from` when it
  is still a branch, else the default branch.
- **A workspace with a branch picked** (`against`): the fork point with that branch, its local and
  remotes' tips (`forkPoint`), `into` that branch. A picked branch that is gone: the default.
- The callers keep their rule for a merged branch (the fork point is the tip): the panel and the
  count go back to `workspace.base`; Review refuses (`merged into <into>`).
- `since` (the panel's "since …") names the branch the base is the fork point with; absent when
  the base is the start commit. Review's "since the last review" count leaves out the commits of
  `into`'s tips (V17's `not`, for the default branch today).

## The record and the API

- `WorkspaceFile.against?: string` — the branch picked; absent: where it started. Written only by
  the new request, kept across starts.
- `GET /api/workspaces/against?branch=` → `WorkspaceAgainst { against?, from?, base, branches }`:
  the pick, where it started, and every branch name (local, and remotes' by name; not its own),
  as Merge into ▾ lists them.
- `POST /api/workspaces/against { branch, against: string | null }` → the same. A name that is
  no branch, or the workspace's own, is refused with 400; `null` goes back to where it started.
  The server forgets the review it had opened for that branch, so the next Review resolves again.
- Merge into ▾ preselects `against` first, then `from`, the verdict's `into`, the default branch.

## The viewer

The changes panel's Commits heading says `since` with a select: **where it started** (`<from>` or
the commit `abc1234`) first, then every branch. Picking one posts it and reads the changes again;
Review then opens against it. The select's tip says what the base resolved to.

## Verification

1. **Tests first** (red before): `review-base.test.ts`-style cases in `workspaces.test.ts` and
   `reviews.test.ts` — a stacked workspace counts and lists only its own commits; a History-row
   workspace starts at its commit; one started from `main` is as today after a rebase, a merge of
   `main` and once merged; `against` picks another branch's fork point, Review and the count
   follow, `into` is that branch; refusals (unknown branch, its own); `null` clears.
   `server.test.ts`: the endpoint, and Review resolved again after a pick. Merge targets
   preselect `against`.
2. **Nothing else changes**: every existing review, workspace and merge test passes unchanged.
3. **Viewer**: an e2e test in the workspace specs — the select lists the branches, a pick
   changes the count and the Review page's base; a screenshot of the panel.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`. No analysis code changes: no regression set.

**Risks**

| Risk | Mitigation |
|---|---|
| A review file's marks and drafts were made against another base | Marks are by symbol fingerprint (I1): a symbol unchanged keeps its mark; others read as not reviewed, which is right |
| The start commit after the agent rebased onto another branch than it started from | The base is still the start commit (not an ancestor of the tip): the diff shows the new branch's changes; picking that branch fixes it |
| Bitwarden's 1,591 branch names in a select | A native select, as Start from (V33, decision 230) |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V65 | Review against where it started, or a picked branch | `reviewBase`, `against` in the record and its API, the panel's select |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 471 | Where a workspace's review starts by default | **`workspace.base`, moved to the fork point with `from` once the branch takes it in** | What was asked; a merge of the parent must not count its commits as the workspace's (the fix of 2026-10-20) |
| 472 | What a picked branch means | **The fork point with that branch's tips**, as Review does for the default branch | One rule for every branch; a stale local branch does not pull a remote's commits in |
| 473 | Where an approval merges | **The branch reviewed against**: `against`, else `from`, else the default branch | Approving a diff against `feature/one` and landing it in `main` would land `feature/one`'s unreviewed commits |
| 474 | Where the choice is | **In the changes panel's "since"**, kept in the record | The panel is where the base shows; the record makes Review, the count and the merge check agree across pages and `symbiote view`s |

**Not in V65**: a pick for a branch reviewed from History without a workspace; the agent's prompt
still names the default branch as where its work merges (`promptOf`).
