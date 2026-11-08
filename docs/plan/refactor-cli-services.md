# Refactor — The CLI's four large closures in services with an explicit context

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding Q1) ·
[The refactor it continues](refactor-readability.md)

**Status:** planned (2026-11-06), to be built on branch `refactor/cli-services` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** refactor · **Branch** `refactor/cli-services` · **Size** L · **Depends on** P04 (SC1),
P11, P12, P13, P14, P31 landing first · **Plan** P44 of 51 (the audit's order)

## The brief

**What to change**: four factory closures hold most of the CLI. Split each into modules of one
concern with an explicit context object, as `refactor-readability.md` did on 2026-10-25 for the
first round, without changing behaviour.

**Where to look** (measured on `main` at c2aa5c4):

| Closure | File | Lines | File's lines | Shared mutable state at the closure's top |
|---|---|---|---|---|
| `startViewServer` | `packages/cli/src/server.ts:382-2357` | 1,976 | 2,516 | `hosts`, `address`, `checkingOut`, `events`, `opened`, `pairSites`, `busy`, `streams`; 106 `path ===`/`url.pathname ===` routes |
| `hiveRunner` | `packages/cli/src/hive-runner.ts:223-2292` | 2,070 | 2,315 | `closed`, `holding`, `lastOn`, `ticking`, `again`, `timer`, `offProbe`, `actions`, `checks`, `reviews`, `toStop`, `failed` |
| `workspaces` | `packages/cli/src/workspaces.ts:467-2212` | 1,746 | 2,212 | `copied`, `merges`, `checks`, `attached`, `ancestry`, `known` |
| `symbioteMcp` | `packages/cli/src/mcp.ts:670-1570` | 901 | 1,570 | `busy`, `held`, `asked`, `recorded` |

`merger` (`merges.ts:362-1382`, 1,021 lines) is the fifth; it waits for P11–P14, which change it.

**Out of scope**: any change of behaviour, route, JSON, log line or message; the viewer's large
pages (`HistoryPage.tsx` 1,737, `SettingsPage.tsx` 1,423, `Workspace.tsx` 1,320: a viewer plan of
their own); new features; renaming exported names other packages import.

**Done when**:
- No closure in `packages/cli/src` is over 600 lines (measured by the script in "Measure first").
- Each closure's shared state lives in one context object, typed, passed to the modules that
  need it; nothing else is captured across modules.
- Every test in `packages/cli/test` passes with only its import lines changed (decision 346), and
  the e2e suite passes unchanged.

## Measure first

Before any move, on the branch's `main`:
1. Line counts of the four closures and of every function over 100 lines inside them (an `awk` on
   the brace depth, as above), kept in the journal.
2. Each closure-level `let` and `Map`/`Set`: which inner functions read it and which write it. That
   map decides the modules: state written by one concern only moves with it.
3. Baseline timings: `pnpm check` (97 s on 2026-11-06), the cli tests (`hive-runner.test.ts`
   44.6 s, `merges.test.ts` 37.0 s, `workspaces.test.ts` 26.7 s), `pnpm test:e2e` (3.0 min).

## Approach

The first round's conventions hold (decisions 344–348): one folder, files named area first, a
factory keeps only what needs its state, no re-exports, a type with what implements it.

| Part | What | Mergeable alone |
|---|---|---|
| a | `server.ts`: the routes in modules per service (`server-workspaces.ts`, `server-merges.ts`, `server-hive.ts`, `server-nucleus.ts`, `server-terminals.ts`, `server-git.ts`); `startViewServer` keeps the HTTP server, the host check, `writable`/`sameSite` and the dispatch table. A `ServerContext` holds `hosts`, `address`, `events`, `opened`, `pairSites`, `busy`, `streams`, `checkingOut` | yes |
| b | `mcp.ts`: the 25 tool handlers by family (workspaces, reviews, merges, reads), the Confirm (`ask`, `held`) in `mcp-confirm.ts` | yes |
| c | `workspaces.ts`: start, the agent's lifecycle, cleaning, merges' preview; a `WorkspacesContext` with the six maps | yes |
| d | `hive-runner.ts`: the tick loop and its timers apart from a round's steps (write, check, review, land), each step a module taking a `HiveContext` | yes, last: it has the most state |
| e | `merges.ts` (`merger`), once P11–P14 have landed | yes |

Each part is a commit series that moves code first (no edits inside moved functions), then
narrows each module's inputs.

## Tests first

A refactor adds no behaviour, so no new failing test. Two guards before part a:
- A test that lists `startViewServer`'s routes by calling it with a request per route and an
  unknown one, and records each answer's status: a table that must stay equal through the
  refactor (it catches a route lost in a move).
- The same for `symbioteMcp`'s `tools/list`: the 25 names and schemas, as a snapshot.

## Verification

- After each part: `pnpm check`, `pnpm build`, `pnpm test:e2e`; the route and tool tables equal.
- The line counts again: no closure over 600 lines; the journal compares before and after.
- Timings within ±10 % of the baseline.

**Risks**

| Risk | Mitigation |
|---|---|
| Conflicts with every open branch that touches these files | Start after P04, P11–P14 and P31 land; one part per merge; say in each part's commit which functions moved |
| A move changes the order of effects (a timer set before a listener) | Move whole functions unchanged first; review the diff with `git diff --color-moved` |
| A context object becomes a new god object | Each module takes only the fields it uses (a `Pick<>` of the context) |
