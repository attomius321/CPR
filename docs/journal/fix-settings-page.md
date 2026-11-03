# Journal: Fix — Settings by what is set, and the check set from Settings

[Index](../JOURNAL.md)

## Fix — Settings by what is set, and the check set from Settings (2026-11-03, branch `fix/settings-page`)

The person's brief: Settings needs structure, its navigation is hard to use; and the check commands
should be set from Settings, in normal and Hive mode. Asked at plan time, they chose one check for
both modes.

**Learned**:
- **The list was the prompts' groups, the real settings at its bottom.** With Hive off it had 20
  rows in 6 groups (Workspaces 9, Reviews 5, Prebuilt agents 3, then This repository, This machine,
  This browser one each); with Hive on, Hive's 10 prompts first and about 30 rows, scrolling. Agents
  were split between Prebuilt agents and the Hive group (the reviewer), the advisor was a Workspaces
  prompt, and Hive mode moved between groups with the mode. Now it is one order in both modes:
  **This repository** (Checks, Hive mode), **Agents** (Nucleus or Alpha Ceph, the merger, Scribe,
  the reviewer while Hive is on, Suggest settings), **Prompts** in groups that fold (Hive's first
  while on), **This machine**, **This browser**, and a filter (a name, an agent's prompt titles, a
  setting's config key: "check" finds Checks, the merger, Hive's Check failed). Folded, the list is
  10 rows with Hive off and 12 on; the group holding the entry open opens with it, the person's
  folds are kept in the browser, and a folded group shows its "not saved" or "changed".
- **One check, two runners.** The merger (`projectCheck` at the target's tip) and Hive's runner (at
  the workspace's tip) both read `merge.checks` from the main checkout's config, else the check
  found in the commit's files; both stop at the first command that fails. So a check saved in
  Settings is the next merge's and Hive's next check, and Hive checks a commit again when its
  commands change (`sameCommands`). A separate `hive.checks` would have let a commit pass Hive's
  check and fail the merge queue's at landing.
- **Hive's page never showed a found check.** `/api/hive/state` asks `projectCheck(…, 'HEAD')`, and
  `treeAt` reads a tree by SHA only (`not a commit SHA: HEAD`), caught as null: without
  `merge.checks`, the Hive mode page and the turn-on question said "None is set or found" in a
  repository whose `package.json` has a check. `foundCheck` resolves a ref first.
- `writeConfig` wrote strings, numbers and booleans; a list is now a value too, and `writeConfigAt`
  refuses a save over a file changed since the page read it (409), as a prompt's save is, inside
  the same one-at-a-time lock.
- The commands are in Geist Mono (literal, as Start's branch): `look.spec.ts` allows
  `.checks-command` beside `#start-branch`.

**Verification**: failing tests first (commit `ca36879`): `check-setting.test.ts` (read, save with
the rest of the file kept, reset, stale and non-JSON refused, the body's checks), the route in
`server.test.ts`, `settingsNav`/`filterNav`/`foldOpen` and the draft's helpers in
`settings.test.ts`; red at import (none of it existed), then green. Two new e2e in
`settings.spec.ts`: commands typed, reordered, saved as `merge.checks`, kept over a reload, shown on
the Hive mode page whose Change opens Checks, cancelled, reset; and Hive mode's list, folds, the
fold kept over a reload, the filter. Eleven e2e encoding the old list changed with it (settings,
alpha-ceph, hive, hive-loop, hive-review, look).
