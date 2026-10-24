# Journal: Fix — Merge into names no branch; the dropdown does

[Index](../JOURNAL.md)

## Fix — Merge into names no branch; the dropdown does (2026-10-21, branch `fix/fix-merge-into-main-button`)

The person: the button read "Merge into main" beside a dropdown of branches preselected with the
default branch; it should read "Merge into" and merge into the dropdown's value.

**Learned**:
- **The merge already went where the dropdown said.** `MergeControl` posts the picked branch as
  `into`, and `merger().enqueue` and `landEntry` use only that; no code path falls back to the
  default branch once a branch is picked. The cause was the label: it repeated the target
  (`Merge into {target}`), so the default branch read as part of the action. Now the button is
  "Merge into" and the target is the dropdown's alone; its tooltip still names it.
- No e2e test had picked a branch other than the preselected one.

**Verification**: a new e2e test (`workspaces.spec.ts`, "Merge into merges into the branch picked
in its dropdown, not main") was red first (no button named "Merge into"): it picks `release`,
merges, lands, and checks `release`'s merge parents and that `main` did not move. Specs that
clicked "Merge into main" now click "Merge into". `pnpm check`: 1,110 tests; build; e2e 173 of
173 twice (a first full run failed once without naming a test in the summary kept; not
reproduced).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `4d544c8`, no conflicts
(`main` had not moved since the branch).
