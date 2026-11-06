# Fix — A landed merge leaves the sidenav's Merging group

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V11)

**Status:** planned (2026-11-06), to be built on branch `fix/landed-merge-group` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/landed-merge-group` · **Size** S · **Depends on** none · **Plan**
P36 of 51 (the audit's order)

## The brief

**What happens**: once a merge lands, the sidenav keeps it under the group "Merging" (count 1) as
"Add a half function · Landed · into main", until the person removes the entry. The same
workspace is also under "Done today". A group named Merging holds a merge that is over.

**How to reproduce**: `serveWorkspaces()`, start a workspace, commit, approve, Merge into with no
check, Land (the audit's tour; `workspaces.spec.ts`'s `approvedWorkspace` helper). The sidenav then
shows Merging 1 with the landed row.

**Where to look**:
- `packages/viewer/src/shell/Sidenav.tsx:146` (`queued = merges?.merges ?? []`: every entry).
- `:422-440` (the Merging group renders all of `queued`, count `queued.length`).
- `src/workspaces/merges.ts:270-274` (`mergingAlone` already leaves `landed` out, for the
  workspaces' own rows).
- `src/workspaces/row-words.ts:187-215` (`mergeRowWords`, a `landed` case).
- Decision 877 (Done today and Earlier: a landed merge says when).

**Out of scope**: removing landed entries from the queue file; the merge page of a landed entry
(still opened from Done today and History).

**Done when**:
- A landed entry is not in the Merging group: the group's count leaves it out, and the group is
  gone when nothing else is in it.
- The workspace is under Done today with the landing's time, as decision 877 says.
- Its merge page is still reachable (from the row under Done today, and its address).

## Evidence

Reproduced in the audit's workspace tour: shots `overview-after`, `git-after` and
`history-after` all show "Merging 1 · Add a half function · Landed · into main" beside
"Done today 1".

## Approach

`const merging = queued.filter((e) => e.state !== 'landed')` for the group's rows and count. Check
the merge page's own route (`?merge=<branch>`), opened from the row today: Done today's row must
open it, or keep its link to the workspace. Read `doneGroups` (`Sidenav.tsx:137-140`) to see what
a landed workspace's row opens.

## Tests first

`e2e/merges.spec.ts` (or `workspaces.spec.ts`, after a Land): the region "Merging" has no row for
the landed branch, and Done today has it. Red today.

## Verification

`pnpm check`, `pnpm test:e2e`; a sidenav screenshot after a landing, both themes.
