# Journal: V77 — History: finished workspaces, their activity and brief

[Index](../JOURNAL.md) · [Plan](../plan/v77-workspace-history.md)

## V77 spike — what a cleaned-up workspace leaves (2026-10-29, branch `feature/workspaces-history`)

The person's `symbiote/` folder read (not changed): 99 workspace records, 97 of them `finished`;
their threads, recorded tools and reviews; `git merge-base --is-ancestor` of each approved commit
against `main`, and whether each branch is still there.

**Learned**:
- **The history is on disk, unread**: all 97 briefs, 94 threads, 40 activity files (5.4 MB, the
  largest 485 KB). Only the list's `!f.finished` filter and the page's "No workspace" hide them.
- **The commits outlive the branch**: Clean up deletes a merged branch, but 83 approved commits
  are on `main` (Symbiote merges with `--no-ff`, the approved commit the merge's second parent)
  and 13 workspaces kept their branch: 96 of 97 can show their commits. The record itself says
  nothing of the branch's end, so V77 has Clean up write `tip` and `merged`.
- **Two approved commits are not on `main`**: an Approve is not proof of a merge; the outcome is
  read from git, not from the verdict.
- **A finished Codex or Hermes workspace keeps its conversation in the agent** (3 of 97): reading
  it means asking Codex's app server or starting Hermes for a workspace whose sessions were
  archived. V77 reads Symbiote's own files only and says so.
- **`/history` is taken**: Git's address until V66, still moved to `/git`, and Git's API is
  `/api/history`. The page is `/workspace-history`.
