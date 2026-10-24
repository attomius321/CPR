# Journal: Fix — a workspace's commits counted from its fork point

[Index](../JOURNAL.md)

## Fix — a workspace's commits counted from its fork point (2026-10-20, branch `fix/commits-from-fork-point`)

Found in V29d: the head's "N commits" (`ahead`) counted from the commit the workspace started at,
the changes panel and Review from where the branch leaves the default branch. After the agent
rebases onto a newer `main`, or merges `main` in, `main`'s commits were counted as the
workspace's: 2 where the panel and Review listed 1.

**Learned**:
- **What the count decides, in practice, is the label.** It also picks "Ready for review" over
  "Finished without commits" and gates the merged check, Review and Merge. But a branch whose
  only commits are `main`'s has its tip in `main`, so it reads "Merged" before and after the fix;
  a branch with commits of its own counts above 0 either way. Said wrongly to the person at first
  (that a rebase alone would read "Ready for review").
- **The default branch was looked up once per workspace** by the new fork point (a git run per
  remote): one lookup per read of the refs now, shared by the list's trunk and every workspace.

**Verification**: a unit test red before (after the rebase, 2 against the panel's 1): the list's
count equals the panel's with no commits, one, after a rebase, after `main` merged in (its commit
and the merge), and merged into `main`. `pnpm check` 989 unit tests; e2e of the workspace specs 51
of 51. `list()` with 5 workspaces on a clone of this repository: `main` 96 and 96 ms (medians of
15), the fix 112 and 123 ms with a lookup per workspace, 102, 106 and 110 ms with it shared;
back to back, not alternated.

Merged into main (2026-10-20), after V29, no conflicts. `main` verified after the merge: frozen
install, 989 unit tests, format, lint, typecheck, build, 140 of 140 e2e.
