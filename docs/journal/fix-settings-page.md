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

`pnpm check`: 226 files, 3,076 tests. `pnpm test:e2e`: 425 of 426 in the viewer, the one
`terminal-view.spec.ts:165` (a known flake under load; 3 of 3 alone); the nexus 20 of 20.
`look.spec.ts:74` and `hive-review.spec.ts:52` failed once each in a run of six specs beside other
workspaces' tests, and passed alone and in the full run. Screenshots at 1440 × 900 and 390 × 844,
dark and light, Hive off and on (a spec in the ignored `coverage/settings-shots/`): the list, a
fold open, the filter, the Checks page empty, drafted and saved, the Hive mode page's check row.
Not verified: in the desktop app, and against a real merge or Hive round (the merger and Hive
read `merge.checks` as before; the unit tests cover the file they read). `docs/images/settings.png`
still shows the list before this fix.

**Landing (2026-11-03)**: the merge into `main` failed its check: `loading.test.ts`, which came to
`main` with fix/static-loadings after this branch started, refuses a loading line drawn as words
alone, and the Checks page drew "Reading the check…" as a plain hint. `main` merged in (the index
row and the viewer's `CLAUDE.md` row kept from both), the line drawn with `Loading` as the other
Settings pages draw theirs. `pnpm check`: 227 files, 3,087 tests; `settings.spec.ts`,
`look.spec.ts` and Hive's Settings test in `hive-loop.spec.ts` 29 of 29.
