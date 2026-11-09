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

## Refactor — the nine files in modules with an explicit context (2026-11-09, branch `refactor/cli-services`)

Parts a–e of the plan, then `main.ts`, `page-agent.ts`, `prompts.ts` and core's `workspaces.ts`,
in 13 commits after the plan's. The nine files went from 15,078 lines to 3,069; the six closures
over 600 lines from 8,582 to 1,847 (the longest now 443); 63 new files, none over 520 lines.

**Learned**:
- **Retyping was never needed.** A script cut whole declarations with their comments by name,
  from a closure's body, an object literal or a file's top level, into a factory or a file;
  another seeded each new file with the old one's imports and let TypeScript's own "remove
  unused" prune them. The compiler's "cannot find name" list for each new module is exactly the
  names its code reads: split between the context and the modules that provide them, it wrote
  each factory's `Pick<>` parameters. A first version of the cutting script placed text at the
  source file's offsets in the target: the files did not compile, and were made again from
  `main`'s text.
- **A token-for-token walk is the review's anchor.** Every named declaration of `main`'s nine
  files compared with the branch's, whitespace aside: 1,981 equal, once `ctx.closed` reads as
  `closed`. The prompts and core's types were compared character for character (a prompt's words
  are in template literals, where whitespace counts).
- **Cycles come from where the shared bits sit, not from the steps.** Each part's first cut made
  cycles: modules importing helpers, types or a refusal class (`MergeRefused`,
  `PageAgentRefused`) from the file that wires them. Each was solved by giving the shared bit a
  home below the steps: the context file for types and refusals, the first step for helpers
  (`hive-round.ts`), a file of its own where the thing is a concern of its own (`merge-config.ts`,
  `config-write.ts`, `prompt-settings.ts`). One cycle was in the calls themselves, in Hive's
  runner, and one late-bound call breaks it.
- **The `let`s decide what stays.** A `let` read by more than one module must be a context field
  read live (`ctx.closed`, 20 reads in Hive's runner, the only edit inside moved bodies); where
  only the closure's own `close` reads it with one module (the page agent's Codex watch, its
  activity writer), the module stayed in the closure instead.
- **`exportfix` and `unexport`**: moving a private helper into a shared module needs `export`;
  a script added it where the compiler asked, and another removed it again where no file imports
  the name and `main` did not export it.
- **The intro e2e timing tests did not fail here**; the e2e runs were 3.7–4.0 minutes while
  vitest ran beside them, 3.0–3.1 alone.

**Verification**:
- The route table (three servers, 374 requests each) and `tools/list` with `initialize` equal to
  their first run after every part; `pnpm check` (3,432 tests) after parts a, e and i and on the
  last commit; the CLI's 1,674 tests after every part; e2e (436 viewer, 32 nexus) after parts a,
  d and on the last commit.
- 18 test files changed, none but import lines; no new import cycle (core's `merges` ↔
  `workspaces` one gone); `@symbiote/core` exports the same 432 names.
- Timings against the baseline: `pnpm check` 105.4 → 109.6 s (+4.0 %), the three long CLI test
  files +2.1 % to +7.5 %, e2e 200.7 → 205.9 s (+2.6 %), the build a second faster: within ±10 %.
