# Refactor — The CLI's large files in modules with an explicit context

[Index](../PLAN.md) · [Journal](../journal/refactor-cli-services.md) · [The audit](../journal/chore-improvement-audit.md) (finding Q1) ·
[The refactor it continues](refactor-readability.md)

**Status:** built (2026-11-09), merged into `main` on 2026-11-10, on branch `refactor/cli-services` (a workspace
started in Symbiote, from `main` at `371be1d`). Planned 2026-11-06 by the improvement audit
(`chore/improvement-audit`) for after P04, P11–P14 and P31; the person decided on 2026-11-09 not
to wait for them (decision 961): none has a branch, and they will be built on the new modules
(As built says where each one's code is now). As built and results below.

**Kind** refactor · **Branch** `refactor/cli-services` · **Size** L · **Depends on** none (planned
after P04 (SC1), P11, P12, P13, P14 and P31; built before them, decision 961) · **Plan** P44 of 51
(the audit's order)

## The brief

**What to change** (the audit, 2026-11-06): four factory closures hold most of the CLI. Split each
into modules of one concern with an explicit context object, as `refactor-readability.md` did on
2026-10-25 for the first round, without changing behaviour.

**Widened on 2026-11-09** (the person's brief for the workspace): all of this plan, parts a–d and
part e (`merges.ts`), and in the same way the CLI's other files over 1,000 lines — `main.ts`,
`page-agent.ts`, `prompts.ts` — and `packages/core/src/workspaces.ts`. "The person finds these
files too big and wants all of them done."

**Where the length is** (measured on `main` at `371be1d`, a TypeScript walk of each function's
span; the audit's numbers at `c2aa5c4` were a little lower):

| File | Lines | Largest closure | Its lines | Its functions over 100 lines | Shared state at the closure's top |
|---|---|---|---|---|---|
| `packages/cli/src/server.ts` | 2,599 | `startViewServer` | 2,054 | `repositoryRoute` 183, `workspacesRoute` 149, `gitApi` 111, `terminalApi` 104 | `hosts`, `address`, `checkingOut`, `events`, `closing` (lets); `opened`, `pairSites`, `busy`, `streams`, `sites`, `reviewSites`, `pageErrors` |
| `packages/cli/src/hive-runner.ts` | 2,315 | `hiveRunner` | 2,070 | `reviewing` 115, `runCheck` 106 | `closed`, `holding`, `lastOn`, `ticking`, `again`, `timer`, `offProbe` (lets); `actions`, `checks`, `reviews`, `toStop`, `failed` |
| `packages/cli/src/workspaces.ts` | 2,078 | `workspaces` | 1,620 (its `service` object 927) | `summary` 110, `start` 104 | `copied` (let); `merges`, `checks`, `attached`, `ancestry`, `known`, `mains`, `commitsCounted`, `refsKeys`, `shellsByBranch`, `branchChanges` |
| `packages/cli/src/main.ts` | 1,596 | `view` | 304 | `view` 304, `pr` 125, `merge` 106 | — (functions of their arguments) |
| `packages/cli/src/mcp.ts` | 1,570 | `symbioteMcp` | 901 (`reads` 288, `asking` 228) | — | `asked`, `recorded` (lets); `busy`, `held`, `closing` |
| `packages/cli/src/merges.ts` | 1,382 | `merger` | 1,021 (its returned service 245) | `resolve` 112 | `running`, `again` (lets); `holding` |
| `packages/cli/src/page-agent.ts` | 1,321 | `pageAgent` | 916 (its returned agent 234) | — | `writing`, `watching`, `wake`, `watched`, `closed` (lets); `codexSeen`, `changed` |
| `packages/cli/src/prompts.ts` | 1,102 | — | — | — | — (half of it the prompts' words: `startPrompt`, `nucleusInstructions`, `DEFAULT_PROMPTS`; `SPECS` 279) |
| `packages/core/src/workspaces.ts` | 1,115 | — | — | — | — (89 exported types and five constants) |

No other closure in `packages/cli/src` is over 600 lines (`eventStream` 440 is the next).

**Out of scope**: any change of behaviour, route, JSON, log line, message or prompt text (a
prompt's words move byte for byte); `packages/viewer` and `packages/nexus` (workspace
`refactor/viewer-pages` splits their large files in parallel); renaming exported names other
packages import; the six waiting fixes themselves; new features.

**Done when**:
- No closure in `packages/cli/src` is over 600 lines (`scripts/closures.mjs`); none of the nine
  files is over 800 lines, or the journal says why one is.
- Each closure's shared state lives in one typed context object, passed as a `Pick<>` to the
  modules that need it; nothing else is captured across modules.
- The route table and the `tools/list` snapshot are equal before and after; every test in
  `packages/cli/test` passes with only its import lines changed (decision 346); `pnpm test:e2e`
  unchanged; `pnpm check` and `pnpm build` pass; timings within ±10 % of the baseline.

## Measure first

Before any move, on `main` at `371be1d` (the journal keeps the numbers):
1. Line counts of the closures and of every function over 100 lines inside them
   (`scripts/closures.mjs`, a TypeScript walk; the table above).
2. Each closure-level `let`, `Map` and `Set`: which inner functions read it and which write it
   (a walk with the type checker's symbols). That map decides the modules: state written by one
   concern only moves with it.
3. Baseline timings: `pnpm build`, `pnpm check`, the long CLI tests (`hive-runner.test.ts`,
   `merges.test.ts`, `workspaces.test.ts`), `pnpm test:e2e`, each timed once on the same machine
   before and after.

## Approach

The first round's conventions hold (decisions 344–348): one folder, files named area first, a
factory keeps only what needs its state, no re-exports (importers and tests import from the new
home), a type with what implements it. Files found at run time beside their importers keep their
names (the hooks, the gates, the Codex runner, `app-server.ts`, `mcp-stdio.ts`, `bin.ts`).

**The context** (decision 962). Each closure gets one typed object, `<Area>Context`, in
`<area>-context.ts` (so no module imports the closure's file: no cycle): the closure's injected
options and the state more than one module reads. State that one module alone reads and writes
moves into that module (`checkingOut` with the checkout route, `running`/`again` stay with the
merger's queue runner). A module takes `Pick<<Area>Context, …>`, never the whole.

**A module** (decision 963) is a factory, `serverWorkspaces(ctx, uses)`: `ctx` a `Pick<>` of the
context, `uses` the functions of other modules it calls (each typed as a `Pick<>` of that module's
return type). Its functions move with their bodies unchanged; the names they read are
destructured at the factory's top, so `git diff --color-moved` shows each body as moved. A `let`
that several modules read becomes a field of the context and is read as `ctx.<name>` (the only
edit inside a moved body). Calls that go both ways between modules (Hive's write → check → review
→ land → back to the round) are bound late, by an arrow at the closure's wiring. A helper that
reads no state moves to module level instead (decision 345).

| Part | File | What | Kept in the closure |
|---|---|---|---|
| a | `server.ts` | `server-context.ts` (the options' types, `Site`, `ServerContext`); `server-http.ts` (`send`, `json`, `readBody`, `read`, `answer`, `refusals`, `ofBranch`, `exported`, the cross-site checks: no state); `server-sites.ts` (a graph's pages: `serveSite`, `serveDiff`, `serveReview`, the review's and the diff's sites, the files, `state`, `openFile`, the review's writes, `/api/reviews`, `/api/diffs`); `server-git.ts` (history, `gitApi`, status, refs, checkout with its `checkingOut`); `server-workspaces.ts` (`/api/workspaces…`, the Hive tab's routes); `server-hive.ts` (`/api/hive…`, `hiveState`, `nucleusFollows`); `server-nucleus.ts` (Nucleus's and Scribe's routes, `/api/mcp…`, the start's Confirm switch); `server-merges.ts` (`/api/merges…`, the log streams); `server-terminals.ts`; `server-pages.ts` (skills, monitor, issues, usage, settings: the shell's other pages); `server-logs.ts` (a request's line, a page's error) | The HTTP server, the host check, `writable`/`sameSite`/`written`/`oneAtATime` (they read `hosts` and `busy`), the dispatch (`handle`, `repositoryRoute`), listen and close |
| b | `mcp.ts` | `mcp-tools.ts` (`MCP_TOOLS`: the 25 names, words and schemas); `mcp-confirm.ts` (`ask`, `held`); `mcp-recorder.ts` (Nucleus's calls in its activity); the handlers by family: `mcp-workspaces.ts`, `mcp-reviews.ts`, `mcp-merges.ts`, `mcp-reads.ts` (overview, usage, code map, wait) | `handle`, `answerOf`, `run`, the protocol |
| c | `workspaces.ts` | `workspace-context.ts`; `workspace-summary.ts` (a workspace's summary and its caches); `workspace-trunk.ts` (its main, trunk, base, merged, its end: `ancestry`, `known`, `mains`); `workspace-agent.ts` (the agent's lifecycle: found, levels, launch, start, stop, reply, `attached`, the hook's copy); `workspace-advisor.ts`; the service's operations by concern (start, reads, cleaning, merges' preview, shells) | `readWorkspaceConfig`, the factory's wiring and the `Workspaces` type |
| d | `hive-runner.ts` | `hive-context.ts`; `hive-round.ts` (the record's moves: `save`, `event`, `queue`, `deliver`, `moveTo`, `leaveTo`, `nextRound`, `paced`); `hive-writing.ts`, `hive-checking.ts`, `hive-reviewing.ts`, `hive-landing.ts`, `hive-forge.ts` (the request opened, reviewed, watched); `hive-off.ts` (turning off, `reconcile`) | The tick loop and its timers (`once`, `tick`, `schedule`), the lock, `close` |
| e | `merges.ts` | `merge-context.ts`; `merge-run.ts` (`mergeOne`, `fastForwardOne`, `checkMerge`); `merge-resolve.ts` (`resolve`, the levels); `merge-land.ts` (`landEntry`, `push`, `syncTarget`); `merge-targets.ts`; the service's operations | The queue's runner (`drain`, `kick`, `running`, `again`) and the wiring |
| f | `main.ts` | A file per command with its help: `command-view.ts`, `command-pr.ts`, `command-merge.ts`, `command-activity.ts`, `command-app.ts`; `command-args.ts` (`parse`, `UsageError`, the shared options and checks) (decision 964) | `run`, the help, `CliContext`, `diff` |
| g | `page-agent.ts` | `page-agent-context.ts`; `page-agent-record.ts` (paths, record, activity); `page-agent-levels.ts` (models and levels); `page-agent-codex.ts` (Codex's tools and its watch); `page-agent-start.ts` (start, reply, the conversation) | The `PageAgent` it returns, its wiring |
| h | `prompts.ts` | `prompt-text.ts` (every prompt's words, byte for byte); `prompt-specs.ts` (the editor's specs, `fillPrompt`); `config-write.ts` (`symbiote/config.json` written) (decision 964) | Reading and saving the prompts, `promptSettingsService` |
| i | core's `workspaces.ts` | By area (decision 965): `agents.ts` (kinds, models, levels, an agent's state), `hive.ts` (Hive's steps, landing, request, check, review, logs), `workspace-activity.ts` (the thread and tools), `workspace-day.ts` (the Overview's day); `index.ts` exports every name as before | A workspace's summary, list, start, changes, reply |

Each part is its own commits: the move first (whole functions, bodies unchanged), reviewed with
`git diff --color-moved`; then the narrowing (the `Pick<>`s, helpers of no state to module level).
The module names above are the plan; where a file reads better otherwise, As built says so.

## Tests first

A refactor adds no behaviour, so no new failing test. Two guards, committed before part a:
- `packages/cli/test/server-routes.test.ts`: `startViewServer` with every service as a fake, and
  bare, sent a `GET` and a `POST` (a page's write) for each of its routes and an unknown one; each
  answer's status and its first words, a table in a file snapshot
  (`__snapshots__/server-routes.txt`) that must stay equal (it catches a route lost in a move).
- `packages/cli/test/mcp-tools.test.ts`: `symbioteMcp`'s `tools/list`, with every service and
  with none, for Nucleus and for an agent through `symbiote mcp`: the 25 names, words and schemas,
  as a file snapshot (`__snapshots__/mcp-tools.json`).

## Verification

- After each part: `pnpm check` and `pnpm build`; the two snapshots equal; the tests' diff has only
  import lines (a script reads `git diff main -- packages/*/test`).
- After parts a, d, e and at the end: `pnpm test:e2e` (it runs a real `symbiote view`).
- The line counts again (`scripts/closures.mjs`): no closure over 600 lines; the journal compares
  before and after.
- Moves verbatim: `git diff --color-moved` per move commit; Symbiote's own diff of the branch
  (`symbiote diff main HEAD`) lists the moved symbols and the ones changed in place.
- No import cycle in the CLI; no new dependency.
- Timings within ±10 % of the baseline.

**Risks**

| Risk | Mitigation |
|---|---|
| Conflicts with the six waiting fixes | They have no branch yet (decision 961); As built maps each to the modules that now hold its code |
| A move changes the order of effects (a timer set before a listener) | Whole functions move unchanged; modules are built in the closure where the code was; `--color-moved` |
| A context object becomes a new god object | Each module takes only the fields it uses (a `Pick<>`); state of one module stays in it |
| A `let` read through a copy goes stale | A `let` several modules read is a context field read as `ctx.<name>`; types and tests |
| A runtime path moves | No entry point or file found at run time moves (decision 344) |
| `naming.test.ts` pins `workspaces.ts`'s `feature` identifiers | `readWorkspaceConfig` and the kinds of work stay in `workspaces.ts` |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 961 | Wait for P04 (SC1), P11–P14 and P31, which edit these files, as the audit planned? | **No** (the person, 2026-11-09): build all of this first; they are built on the new modules afterwards | None of them has a branch, so there is nothing to conflict with yet; their plans name lines that move, and As built maps each to its new home |
| 962 | Where a closure's shared state lives | **One typed `<Area>Context` per closure, in `<area>-context.ts`: its options and the state more than one module reads; a module takes a `Pick<>` of it; state of one module moves into that module** | What a module depends on shows in its signature; the context's file imports none of the modules, so no cycle; no new god object |
| 963 | The shape of a module cut out of a closure | **A factory of `(ctx: Pick<…>, uses)` whose functions keep their bodies; names destructured at its top; a shared `let` read as `ctx.<name>`; calls both ways bound late by arrows at the wiring** | The bodies move byte for byte and read as moved in `--color-moved`; the order of effects stays the closure's |
| 964 | `main.ts` and `prompts.ts`, which the first round left whole | **`main.ts`: a file per command with its help (`command-*.ts`), `run` and the dispatch kept. `prompts.ts`: the words in `prompt-text.ts` byte for byte, the editor's specs and the config writer apart** | The person wants every file over 1,000 lines split; a command and its help, and a prompt's words, read best whole |
| 965 | Core's `workspaces.ts`, 89 types | **Split by area (`agents.ts`, `hive.ts`, `workspace-activity.ts`, `workspace-day.ts`); `index.ts` exports every name as before** | Other packages import from `@symbiote/core` only, so no importer outside core changes; core's own importers import from the new home |

## As built

Every part as planned, in the brief's order: the two guards, parts a–e, then `main.ts`,
`page-agent.ts`, `prompts.ts` and core's `workspaces.ts`; one or two commits a part. What
differs from the plan, and why:

- **How the code moved**: by a script that cuts whole declarations, with their comments, out of
  a closure or a file and puts them, unchanged, into the module's factory or at its top level;
  imports seeded from the old file and pruned by TypeScript's own "remove unused". A second walk
  compares every named declaration on `main` with the one of that name on the branch, token for
  token: in each part, only the closure itself differs, and in part d the 20 reads of `closed`
  (as `ctx.closed`). The prompts' and core's types were compared character for character.
- **Each module's `Pick<>` came with the move**: a module's parameters are the names its moved
  code reads, as the compiler lists them, split between the context and the modules that provide
  them. A separate narrowing commit was left only where a whole options object was passed: parts
  a (`options`, `repository`) and b (`options`).
- **Part a, the server**: the request helpers that read the server's state (`writable`,
  `sameSite`, `written`, `oneAtATime`, `exclusive`, `streamLog`) are `serverHttp` in
  `server-http.ts` rather than kept in `startViewServer`: every route module uses them, and a
  closure's function has no type a module could name without importing `server.ts` back.
  `hosts` is a set filled once the server listens (it was a `let` set then), so the helpers read
  it as before. `checkingOut` is the git routes' own `let`. Two modules the plan did not name:
  `server-logs.ts` (a request's line, a page's error, with the per-minute count) and
  `server-pages.ts` (the intro, the Monitor, the Issues page). The options' types moved to
  `server-context.ts`.
- **Part b, the MCP**: the families are `mcp-workspaces.ts`, `mcp-reviews.ts`, `mcp-merges.ts`
  and `mcp-overview.ts` (the plan's "reads": overview, usage, code map, wait), each returning
  its tools that run at once and those that ask; `mcp-lookup.ts` the five lookups they share.
  `mcp-confirm.ts` holds Nucleus's recorder too: it numbers a skipped Confirm with the asks'
  count. `MCP_TOOLS` and the arguments' readers are `mcp-tools.ts`.
- **Part c, workspaces**: eight modules where the plan named five: `workspace-trunk.ts`,
  `workspace-agent.ts`, `workspace-summary.ts`, `workspace-lifecycle.ts` (start, the agent
  started, stopped, replied to, the prompt, clean up), `workspace-advisor.ts`,
  `workspace-options.ts` (the Start page), `workspace-open.ts` (VS Code, terminals, shells) and a
  factory added to `workspace-changes.ts` (changes, the merge preview, `against`). The
  `Workspaces` and `WorkspaceConfig` types moved to `workspace-context.ts` with the context, so
  no module imports `workspaces.ts` back; `readWorkspaceConfig` stays, as `naming.test.ts` pins
  its `feature` identifiers there. `exportActivity` reads `changes` through the service, bound
  when called.
- **Part d, Hive's runner**: the plan's "round's steps (write, check, review, land)" are
  `hive-writing.ts`, `hive-checking.ts`, `hive-reviewing.ts`, `hive-landing.ts`, with
  `hive-round.ts` (the record's moves, delivery through the pacing gate, a failed landing sent
  back, the push after a turn), `hive-forge.ts` (the request opened, reviewed and its one gate)
  and `hive-off.ts`. The calls between steps have one cycle (`deliver` → `leaveTo` →
  `watchRequest` → `conflictOnForge` → `landingFailed` → `deliver`): with `landingFailed` and
  `pushOut` in the round, the modules form a chain and one call, `leaveTo`'s `watchRequest`, is
  bound late at the wiring.
- **Part e, the merger**: `set` and `fresh`, which every step writes with, are in the context.
  The settings and the project's check (`readMergeConfig`, `projectCheck`, `foundCheck`) are
  `merge-config.ts`; `MergeRefused` and four small helpers every step uses are in
  `merge-context.ts`. The steps call no step back: nothing is bound late. The 16 operations stay
  in `merger` (401 lines).
- **`main.ts`**: besides a file per command, `command-args.ts` (parsing, the shared options and
  checks), `command-context.ts` (`CliContext`, `processContext`, the version), `command-agents.ts`
  (the agents' finders) and, in `command-diff.ts`, the analysis, report and server that `view`
  and `pr` use too. The two files that resolve a package's file beside them make their own
  `createRequire`, as `main.ts` did; `bin.ts` takes `processContext` from `command-context.ts`.
- **`page-agent.ts`**: three modules (`page-agent-levels.ts`, `page-agent-files.ts`,
  `page-agent-conversation.ts`, the plan's "start"). The Codex watch loop and the activity's writer
  stay in `pageAgent`: their `let`s are what `close` reads. The session helpers
  (`newPageAgentSession`, `findPageAgentSession`) moved to the conversation, the settings' and MCP
  files' text to the files.
- **`prompts.ts`**: a fifth file, `prompt-settings.ts` (Settings' service and
  `parsePromptChange`): it writes prompts, and the writer reads them, so in `prompts.ts` it made
  a cycle. `fillPrompt` is in `prompt-text.ts`, as `nucleusInstructions` uses it.
- **Core's `workspaces.ts`**: as planned. `merges.ts` now takes `AgentKind` from `agents.ts`,
  which ends core's `merges` ↔ `workspaces` type cycle.
- **Docs that named moved code**: the Reviews and merger area pages, and the `writing-docs`
  skill (the window's message is in `command-app.ts`).
- **Not done**: the CLI's other files over 600 lines, not in the brief (`nucleus-shell.ts` 937,
  `app-server.ts` 929, `hive-review.ts` 860, `activity-export.ts` 859, `server-requests.ts`
  753); the CLI's three import cycles from before (`workspace-record` ↔ `reviews` ↔
  `review-base`, `skills` ↔ `library`); `plural` and `short`, one line each, still defined in
  several files.

**Where the waiting plans' code is now** (decision 961):

| Plan | What it changes | Where that code is now |
|---|---|---|
| P04 (SC1) | `writable`, `sameSite`; `/api/mcp/asks`, `/answer`; `callerOf`; the page's index; `/api/events/ping`; Nucleus's bridge arguments; `startsAtOnce` | `server-http.ts` (`serverHttp`); `server-nucleus.ts` (`mcpRoute`, `callerOf`); `server-sites.ts` (`serveFile`); `server.ts` (`handle`); `page-agent.ts` (`symbioteServer`); `mcp.ts` (`startsAtOnce`) |
| P11 | The merger's check: `runCheck = runShell`, the `RunCheck` seam | `merges.ts` (the default), `merge-context.ts` (`MergerOptions`, `MergerContext`), `merge-run.ts` (`checkMerge`) |
| P12 | Hive's pid lock: `lock`, `unlock`, `aliveProcess` | `hive-runner.ts` (unmoved) |
| P13 | The merger's push: `(hive ? pushBranch : pushCommit)` | `merge-land.ts` (`push`) |
| P14 | A failed check's record; `mergeStates`; `lastLines`; git's failures' `message` | `merge-run.ts` (`checkMerge`, `mergeOne`, `fastForwardOne`); `command-view.ts` (`mergeStates`); `merge-context.ts` (`lastLines`); `merge-land.ts` (`syncTarget`); `merges.ts` (`drain`) |
| P31 | `ToolSpec`, `object()`, the 25 tools, `wait`'s `minutes`; `tools/list` | `mcp-tools.ts` (`ToolSpec`, `object`, `MCP_TOOLS`, `MAX_WAIT`); `mcp.ts` (`handle`); the arguments' readers in `mcp-tools.ts` (`words`, `flag`, `count`) |

## Results

Measured on this machine, other workspaces running; `scripts/closures.mjs` for the spans.

| File | Lines on `main` | Now | Its closure on `main` | Now | Beside it now (lines) |
|---|---|---|---|---|---|
| `cli/src/server.ts` | 2,599 | 525 | `startViewServer` 2,054 | 426 | `server-context.ts` 237, `server-http.ts` 339, `server-sites.ts` 506, `server-git.ts` 270, `server-workspaces.ts` 275, `server-hive.ts` 137, `server-nucleus.ts` 177, `server-merges.ts` 116, `server-terminals.ts` 139, `server-pages.ts` 128, `server-logs.ts` 86 |
| `cli/src/hive-runner.ts` | 2,315 | 330 | `hiveRunner` 2,070 | 253 | `hive-context.ts` 144, `hive-round.ts` 513, `hive-writing.ts` 224, `hive-checking.ts` 270, `hive-reviewing.ts` 307, `hive-landing.ts` 362, `hive-forge.ts` 445, `hive-off.ts` 120 |
| `cli/src/workspaces.ts` | 2,078 | 208 | `workspaces` 1,620 | 91 | `workspace-context.ts` 259, `workspace-trunk.ts` 153, `workspace-agent.ts` 315, `workspace-summary.ts` 520, `workspace-lifecycle.ts` 449, `workspace-advisor.ts` 160, `workspace-options.ts` 152, `workspace-open.ts` 225, `workspace-changes.ts` 134 → 200 |
| `cli/src/main.ts` | 1,596 | 84 | `view` 304 | 304 (in `command-view.ts`) | `command-context.ts` 86, `command-args.ts` 106, `command-diff.ts` 274, `command-agents.ts` 98, `command-view.ts` 433, `command-pr.ts` 221, `command-merge.ts` 214, `command-activity.ts` 99, `command-mcp.ts` 41, `command-app.ts` 80 |
| `cli/src/mcp.ts` | 1,570 | 304 | `symbioteMcp` 901 | 231 | `mcp-context.ts` 126, `mcp-tools.ts` 375, `mcp-confirm.ts` 146, `mcp-lookup.ts` 84, `mcp-overview.ts` 131, `mcp-workspaces.ts` 234, `mcp-reviews.ts` 154, `mcp-merges.ts` 198 |
| `cli/src/merges.ts` | 1,382 | 548 | `merger` 1,021 | 403 | `merge-context.ts` 86, `merge-config.ts` 111, `merge-targets.ts` 92, `merge-land.ts` 170, `merge-resolve.ts` 327, `merge-run.ts` 266 |
| `cli/src/page-agent.ts` | 1,321 | 567 | `pageAgent` 916 | 443 | `page-agent-context.ts` 159, `page-agent-levels.ts` 206, `page-agent-files.ts` 190, `page-agent-conversation.ts` 399 |
| `cli/src/prompts.ts` | 1,102 | 122 | — | — | `prompt-text.ts` 444, `prompt-specs.ts` 345, `config-write.ts` 145, `prompt-settings.ts` 76 |
| `core/src/workspaces.ts` | 1,115 | 381 | — | — | `agents.ts` 149, `hive.ts` 359, `workspace-activity.ts` 153, `workspace-day.ts` 89 |

- **Closures**: none in `packages/cli/src` over 600 lines; the longest are `pageAgent` 443,
  `workspaceSummary` 440, `eventStream` 440 (not touched), `hiveRound` 428, `startViewServer`
  426. **Files**: none of the nine over 800 lines; of the new ones the longest is
  `server-sites.ts`, 506.
- **Moved unchanged**: 1,981 named declarations compared with `main`'s, every one equal (once
  `ctx.closed` reads as `closed`); only the six closures restructured, `hosts` and the object
  literals they gather (`reads`, `asking`, `service`) differ.
- **The guards**: the route table (three servers, 374 requests each) and `initialize` with
  `tools/list` are equal to their first run, committed before part a.
- **Tests**: `pnpm check` 3,432 tests in 247 files after parts a, e, i and on the last commit;
  18 test files changed, none but import lines (a script reads `git diff 371be1d -- packages/*/test`).
  e2e 436 viewer and 32 nexus tests after parts a, d and on the last commit.
- **Imports**: no new import cycle in the CLI; core's one is gone. No dependency, `package.json`
  or lockfile changed; no exported name of `@symbiote/core` changed (432, a walk of both).
- **Timings** (each step timed once, before on `main` at `371be1d` and after on the last commit,
  the same machine, other workspaces running):

| Step | Before | After | Change |
|---|---|---|---|
| `pnpm build` | 5.2 s | 4.2 s | −19 % (a second) |
| `pnpm check` | 105.4 s (3,428 tests) | 109.6 s (3,432 tests) | +4.0 % |
| `hive-runner.test.ts` | 35.9 s | 38.6 s | +7.5 % |
| `merges.test.ts` | 28.5 s | 29.1 s | +2.1 % |
| `workspaces.test.ts` | 16.5 s | 17.7 s | +7.3 % |
| `pnpm test:e2e` | 200.7 s (436 + 32) | 205.9 s (436 + 32) | +2.6 % |

Not verified: Codex and Claude Code themselves (the tests use fakes, as on `main`); the desktop
app's window beyond its e2e specs; a real Hive run (the CLI's 280 Hive tests and the e2e Hive specs ran,
with fakes).
