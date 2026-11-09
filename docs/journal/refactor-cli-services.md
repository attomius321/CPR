# Journal: Refactor — The CLI's large files in modules with an explicit context

[Index](../JOURNAL.md) · [Plan](../plan/refactor-cli-services.md)

## Refactor plan — measured, and the two guards (2026-11-09, branch `refactor/cli-services`)

Measured on `main` at `371be1d` before moving anything: each function's span (a TypeScript walk,
now `scripts/closures.mjs`), and for each closure which of its inner functions read and write each
`let`, `Map` and `Set` at its top (a walk with the type checker's symbols, so a shadowing name is
not counted).

**Learned**:
- **Six closures over 600 lines, all in the plan**: `hiveRunner` 2,070, `startViewServer` 2,054,
  `workspaces` 1,620, `merger` 1,021, `pageAgent` 916, `symbioteMcp` 901. The next is
  `eventStream` 440. Inside them only eight functions pass 100 lines (`repositoryRoute` 183,
  `workspacesRoute` 149, `reviewing` 115, `resolve` 112, `gitApi` 111, `summary` 110,
  `runCheck` 106, `start` 104): the length is the number of functions sharing a closure, not long
  functions. `workspaces`'s returned `service` object alone is 927 lines; `merger`'s 245;
  `pageAgent`'s 234.
- **Who writes the shared state** (it decides the modules):
  - `startViewServer`: `hosts` is written once after `listen` and read only by `sameSite`;
    `address` written then too, read by the MCP's `url` and the returned `url`; `checkingOut` read
    and written by `checkoutTarget` alone, so it moves with it; `events` set once at the start;
    `closing` written by `close`. `busy` is read by `oneAtATime`, `exclusive` and
    `nucleusFollows`; `streams` by the two log streams, the terminal's and `close`; `opened` by
    `workspacesRoute`, `serveReview` and `reviewsApi`; `pairSites`, `sites`, `reviewSites` and
    `pageErrors` by one function each.
  - `hiveRunner`: `closed` is written only by `close` and read by 14 functions across every step
    (`save`, `event`, `deliver`, `paced`, `runCheck`, `reviewing`, `pushOut`, `land`,
    `openRequest`, `reviewRequest`, `watchRequest`, `once`, `tick`, `schedule`): it becomes a
    context field. `holding`, `lastOn` and `offProbe` are written by `once` (and `close`),
    `ticking` and `again` by `tick`, `timer` by `schedule`: the tick loop's own. `checks` and
    `reviews` are read by the check's and the review's steps, turning off, `reconcile`, `once`
    and `close`; `failed` by `deliver` alone.
  - `workspaces`: one `let`, `copied`, written by `hookPath` alone; ten caches each read by one or
    two helpers (`ancestry` by `inHistoryOf`, `known` by `hasCommit`, `mains` by `mainOf`,
    `refsKeys` and `commitsCounted` by the summary).
  - `symbioteMcp`: `asked` written by the Confirm's `ask` and by the recorder; `recorded` by the
    recorder. `merger`: `running` and `again` by `kick` alone. `pageAgent`: `writing` by `write`;
    `watching`, `watched` and `wake` by Codex's watch and `close`.
- **The calls go both ways in Hive's runner**: a turn's end leads to the check, the check to the
  review, the review to the next round, which delivers a message and leaves the workspace to the
  forge's watch, which can send a failed landing back to `deliver`. Modules of one step each need
  some calls bound late (decision 963).
- **`naming.test.ts` pins `workspaces.ts`'s `feature` identifiers**: they are in
  `readWorkspaceConfig` and the kinds of work, which stay.
- **Decision numbers**: the next free were 955–959 when the plan was written; workspace
  `refactor/viewer-pages` committed 955–960 two minutes later, so this plan took 961–965.

**The guards** (committed before any move):
- `server-routes.test.ts`: three servers (every service a fake answering its method's name;
  `symbiote view` with only what it must have; `symbiote pr`'s one graph), each asked a `GET` and a
  page's `POST` for 184 addresses, two `PUT`s and four refusals before any route: 374 lines a
  server, each the status and the answer's first 100 characters (a stream: its type). 91 of the
  374 answer 200 with every service; three answer 500 (a fake's shape: kept, as the table only has
  to stay equal). Stable over four runs.
- `mcp-tools.test.ts`: `initialize` and `tools/list` with every service and with none, for Nucleus
  and for an agent through `symbiote mcp`, with Hive on and the person's setting on: 3,372 lines
  of JSON.

**Baseline** (this machine, other workspaces running; each timed once):

| Step | Time | Result |
|---|---|---|
| `pnpm build` | 5.2 s | passes |
| `pnpm check` | 105.4 s | 3,428 tests in 245 files |
| `hive-runner.test.ts` | 35.9 s | passes |
| `merges.test.ts` | 28.5 s | passes |
| `workspaces.test.ts` | 16.5 s | passes |
| `pnpm test:e2e` | 200.7 s | 436 viewer and 32 nexus tests |
