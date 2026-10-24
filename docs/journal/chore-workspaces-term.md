# Journal: Features → Workspaces, in the UI

[Index](../JOURNAL.md)

## Features → Workspaces, in the UI (2026-10-19, branch `chore/workspaces-term`)

"Feature" named the container (a branch, its worktree, its agent and terminal), not the work, and
read oddly for a fix or a spike. The viewer now says **workspace**: the page tab, the page title,
"Start a workspace" (header, row menu, dialog), "Open its workspace", the marks' titles, the
notices, and the server's refusals the viewer shows ("no workspace …", "a workspace needs a
brief", "a workspace is being started"). The view's address is `/workspaces`; `/features` is
still served and the viewer rewrites it to `/workspaces` (same query), for bookmarks.

Unchanged on purpose: code identifiers and file names (`Feature*`, `features.ts`), the HTTP API
(`/api/features/*`), the records in `symbiote/features/<branch>.json`, the `features.*` keys in
`symbiote/config.json`, the `feature/` branch prefix, and the agent's prompt. Renaming the records'
folder or the config keys would need a migration for no visible gain.

**Verification**: unit tests and e2e updated to the new words; a server test that `/features`
still serves the page, and an e2e test that it lands on `/workspaces?branch=…` with the
Workspaces tab current. 731 of 731 unit tests (node-pty built here: `npm i -g node-gyp`, then
`pnpm install --offline --config.nodedir=/opt/node22`). Build. E2e 102 of 104:
`commits.spec.ts:161` fails on `main`'s build too (the toggle drops a line in compare mode at
1280 px, measured the same on both), and `features.spec.ts:683` is flaky on both (1 of 4 on
`main`, 5 of 6 here). No analysis code changed: no regression sets.

Merged into main (2026-10-19): no conflicts, `main`'s tree the branch's. `main` verified after the
merge: 731 of 731 unit tests, build, 101 of 104 e2e — `commits.spec.ts:161` as on the branch,
and `interdiff.spec.ts` (2), which timed out in the full run and passed 6 of 6 alone (flaky, as
after V22's merge; not this change).
