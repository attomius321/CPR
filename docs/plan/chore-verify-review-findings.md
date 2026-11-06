# Chore — Verify the code reviews' unchecked findings, one failing test each

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) ("From the code
reviews, not checked by me")

**Status:** planned (2026-11-06), to be built on branch `chore/verify-review-findings` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/verify-review-findings` · **Size** M · **Depends on** none ·
**Plan** P51 of 51 (the audit's order)

## The brief

**What to change**: the audit's four read-only code reviews reported findings the audit did not
check. For each, write the test that would prove it, run it, and record the result. A proven one
becomes a fix workspace of its own (its brief: this plan's row, the failing test); a refuted one
gets a line in the audit's journal saying why. Commit only the tests that pass on `main` as
regression guards; keep the failing ones on the fix's branch, not here.

**Where to look** (each line checked to exist on `main` at c2aa5c4):

| # | Finding | Where | The test that would prove it | If proven |
|---|---|---|---|---|
| 1 | `merges.json` loses updates across processes: `symbiote merge` and `symbiote view` both read, modify and rename it; `change` serializes only within one process | `packages/cli/src/merge-queue.ts:13-33`; `main.ts:1323` (`enqueue` from the CLI); `merges.ts` (`enqueue`) | two child processes, each `change`-ing a different entry 50 times at once; the file must end with both sets | fix `fix/merge-queue-cross-process` (a file lock around read-modify-write, or the CLI asking the running view) |
| 2 | `symbiote/config.json` is written in place, not renamed into place: a reader can see a truncated file | `packages/cli/src/prompts.ts:1038-1041` (`writeFile` of the whole file) | a writer saving a large config in a loop while a reader parses it 1,000 times; any parse error proves it | fix `fix/config-written-whole` (the `writeFileWhole` the records use) |
| 3 | A late throw after headers are sent can end `symbiote view`: the `.catch` calls `send(res, 500, …)`, whose `writeHead` throws when headers went out | `packages/cli/src/server.ts:474-477` | a route made to throw after `res.writeHead` (a test-only route or a stub of a streaming handler); the process must survive | fix `fix/server-late-error` (`if (!res.headersSent) send(…) else res.destroy()`) |
| 4 | One record holding `null` ends a hook's thread lookup: `JSON.parse` gives `null`, then `record.branch` throws outside the `try` | `packages/cli/src/thread.ts:180-190` | a records folder with `null.json` (content `null`) and a good record; the lookup must find the good one | fix `fix/thread-null-record` (an `isObject` guard; P45 does the same pattern) |
| 5 | A stash can go stale between its SHA and its index: `stashRef` turns a SHA into `stash@{n}`, then another git process pops or drops by index; a `git stash push` between them (the stash stack is shared by every worktree) hits the wrong entry | `packages/core/src/git/stash.ts:49` (`stashRef`), `:90`, `:105` (its uses) | push a stash, look it up, push another (as another session would), then pop by the looked-up SHA; the wrong one comes off | fix `fix/stash-by-sha` (`stash apply <sha>`; check `rev-parse stash@{n}` equals the SHA right before `drop`) |
| 6 | The Angular version is read from the installed package for both sides of a diff: an upgrade's base is parsed as the new major (or the head as the old) | `packages/plugin-angular/src/index.ts:233-251` (`angularVersions`, `installedMajor`) | a fixture whose base `package.json` asks `@angular/core@16` and head `@17`, a fake installed 17; base templates with a raw `@` must not show spurious changes | fix in the plugin (prefer each revision's `package.json` range when it disagrees with the installed major); run `regression-check`'s `bitwarden` set |
| 7 | `commitResolution` stages with glob pathspecs: a resolved `src/routes/[id]/index.tsx` also matches other unresolved paths, which are marked resolved with their markers | `packages/core/src/git/merging.ts:223-232` (`git add -- ...paths`, no `--literal-pathspecs`) | a merge with conflicts in `src/routes/[id]/index.tsx` and `src/routes/i/index.tsx`; resolve only the first; the second must stay unmerged | fix `fix/literal-pathspecs` (as `operations.ts:192` and `working-changes.ts:134` already do) |
| 8 | The nexus: a failed home scan replaces the last good one with `null`, and the page asks again every 500 ms forever | `packages/nexus/src/scan.ts:199-206`; `src/page/main.ts:1194-1198` | `scanner` with a `scanFolder` that throws after one success: `last` must keep the success; the page's retry must stop or back off (a unit test of the retry's schedule) | fix `fix/nexus-scan-failure` |
| 9 | The nexus: each folder listing probes every running Symbiote's `/api/status` (up to 1 s each) only to fill `roots` for places the page no longer draws | `packages/nexus/src/main.ts:145-150`; `folders.ts` (`places`) | a listing with one Symbiote that answers after 900 ms: the listing must not wait for it | fix `fix/nexus-listing-probes` (pass `roots: []` or drop `places`) |
| 10 | The nexus's Stop could signal a reused pid: a record is live when its pid answers `kill(pid, 0)` and *something* answers `/api/status` at its URL; nothing ties the two | `packages/nexus/src/start.ts:55-65`, `:154-157`; `core/src/git/checkout.ts:32` (`RepoStatus`, no `pid`) | a record whose pid is another live process of the test's and whose URL a different server answers; Stop must refuse | fix `fix/nexus-stop-pid` (`/api/status` answers its `pid`; compared) |
| 11 | The desktop window has no `session.setPermissionRequestHandler` (Electron grants every permission by default), and no `will-redirect` or `will-frame-navigate` handling | `packages/desktop/src/main.ts` (0 matches for the three) | an app spec: a page asks for the camera or notifications; it must be refused | fix `fix/desktop-permissions` (deny all but clipboard, which the nexus's framed Symbiotes use) |
| 12 | `symbiote:start:forget` answers `recentRepos()` to any sender; `symbiote:start:recent` checks `fromStart(event)` first | `packages/desktop/src/main.ts:484-498` | a unit test of the handler with a sender that is not the start page: it must answer `[]` | fix in the same branch as 11 |
| 13 | The desktop start page waits forever on a server that never prints its ready line | `packages/desktop/src/launcher.ts:56-83` (`startServer`: no timeout) | `startServer` with a stand-in that prints nothing: it must answer an error within its timeout | fix `fix/desktop-start-timeout` |
| 14 | Dead code: `WorkspaceState`, `KindTag`, `StateDot`, `StateAge`, `StateFor` (`packages/viewer/src/workspaces/WorkspaceFacts.tsx:60-212`), `EffortIcon` (`ui/icons.tsx:626`), `class Spring` (`ui/hive-art.ts:34`), `ARRIVAL_MS` (`shell/hive-arrival.ts:21`); about 10 CSS classes with no user (`.merge-chip`, `.branch-pick`, `.checkout-notice`, `.git-details-fold`, …); about 170 exports used only in their own file | as listed | a script: each name grepped across `packages/*/src`, `test`, `e2e`, `scripts`; dynamic class names (`prefix-${…}`) checked by hand | a chore `chore/dead-code` that deletes them (no behaviour change; e2e passes) |
| 15 | Duplication: the terminal's palette hard-coded in 5 files in two greys (`#e6e9ef`, `#e3e6ec`): `AgentTerminal.css:18,31,59,78`, `Workspace.css:856,874,891`, `MergeLog.css:144`, `terminal.ts:378-379`; five copies of git's message stripper (`core/src/git/operations.ts:19`, `ref-edits.ts:24`, `merging.ts:16`, `sync.ts:36`, `worktrees.ts:146`) | as listed | a grep of each value; for the palette, a screenshot of a terminal in each place showing the two greys | a chore `chore/terminal-tokens` (`--term-*` tokens in `ui/base.css`, `tokens.test.ts` guards them) and one for the stripper; the pid locks are P12 |

**Out of scope**: fixing any item here (each proven one is its own workspace); items the audit
already checked (they have plans P01–P50).

**Done when**:
- Each of the 15 rows has a result in the audit's journal (a new dated entry): proven, with the
  test's name and its failing output, or refuted, with why.
- Each proven row has a fix plan in `docs/plan/` in this repository's way (a brief, the failing
  test, the approach), ready to start as a workspace.
- Only tests that pass on `main` are committed on this branch.

## Evidence

**Code**, from the four reviews' reports (2026-11-06); the audit read none of these beyond
checking that each line exists. Rows 1–4 are the cli review's, 5–7 the core review's, 8–10 the
ops review's on the nexus, 11–13 its desktop part, 14–15 the viewer, ops and core reviews.

## Approach

One row at a time, cheapest first (4, 7, 12, 2, 9, 13, 8, 3, 10, 11, 5, 1, 6, 14, 15). Scratch
repositories and fakes only; a cache folder of the test's own (`SYMBIOTE_CACHE_DIR`). Row 6 needs
`regression-check` only if proven.

## Tests first

The plan is tests: each row's "test that would prove it", written and run before anything else.

## Verification

- `pnpm check` with the passing guards added.
- The journal entry's table: 15 rows, each with its result.
