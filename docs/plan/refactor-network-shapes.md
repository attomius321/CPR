# Refactor — Shape checks where JSON enters: forge answers, SSE, the viewer's reads

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding Q2)

**Status:** planned (2026-11-06), to be built on branch `refactor/network-shapes` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** refactor · **Branch** `refactor/network-shapes` · **Size** M · **Depends on** P06 (the
graph file check), P08 (V95, the read hook), P13 (network timeouts) · **Plan** P45 of 51 (the
audit's order)

## The brief

**What to change**: type safety in the code is good (0 `any` in every package), but JSON that
comes over the network or from another process is cast to its type without a look. A wrong
answer then fails far from where it came in, as a `TypeError` with no word for the person.
Check the shape where JSON enters, and turn a wrong shape into the place's own error.

**Where to look** (each entry point, checked on `main` at c2aa5c4):

| Where | What enters | Today |
|---|---|---|
| `packages/forge/src/http.ts:52` | every GitHub and GitLab answer | `JSON.parse(text) as T` |
| `packages/forge/src/github.ts` (`fromPull`, reads `pull.base.ref`, `pull.head.sha`) | a pull request | trusted fields |
| `packages/cli/src/runner.ts:78` | the analysis child's graph | `as Graph` |
| `packages/cli/src/hive-live.ts:143` | Hive's log lines | `as HiveLogLine` |
| `packages/cli/src/merge-log.ts:109` | a merge's log lines | `as LogLine<S>` |
| `packages/cli/src/thread.ts:183` | workspace records, read by hooks | `as typeof record`, then `record.branch` |
| `packages/viewer/src/ui/http.ts:13`, `:30` (`postJson`, `getJson`) | most reads and writes | `as T` |
| `packages/viewer/src/history/commits.ts:375-377` (`graphLoaded`) | `api/graph` and `?graph=` | `body as Graph` (P06 adds the graph's check) |
| `packages/viewer/src/shell/events.ts:241`, `:482`, `:485` | the server-sent stream (V94) | `JSON.parse(…) as T` inside a listener |
| `packages/viewer/src/workspaces/StepLog.tsx:113`, `HiveRunTab.tsx:87` | a merge's and Hive's log streams | `as LogRead<string>` |
| `packages/viewer/src/workspaces/Workspace.tsx:119` | a workspace's shells | `as WorkspaceShells` |
| the viewer's 33 `res.json()` calls | every other read | `as Promise<T>` |
| `packages/nexus/src/page/*.ts` (7 `json()) as` casts), `src/scan.ts:184` | the nexus page's reads; `scan.json` | casts after a shallow check |

**Out of scope**: a schema library as a new runtime dependency (the CLAUDE.md asks a reason for
one; small hand-written guards first); the graph JSON's schema (P06 checks it in the viewer); any
change to what a valid answer does.

**Done when**:
- Each entry point in the table goes through a guard (`isObject`, field checks) next to its type.
- A wrong shape gives the place's own error: the forge's "unexpected answer from GitHub at …", the
  runner's "the analysis printed no graph", a stream event dropped with one console warning
  (never a throw inside a listener), a read's error state (V95's `useRead`).
- No `as` cast of parsed JSON is left at those places (a grep in the plan's journal shows it).

## Evidence

**Code**: the counts are the audit's (finding Q2, from the reviews' scans, checked by grep for this
plan): forge `http.ts:52`; `runner.ts:78`; `hive-live.ts:143`; `merge-log.ts:109`; `thread.ts:183`;
`events.ts:241`; 33 viewer `.json()` calls; 7 casts in the nexus page. V1 (a non-graph JSON turns
the page white) is one reproduced case of the same hole.

## Approach

1. A tiny shared module per package (`json-shape.ts`): `isObject`, `isString`, `field(obj, key,
   check)`; no dependency.
2. The forge first (`http.ts`): `api()` takes an optional guard; `fromPull` and the other readers
   pass theirs. A failed guard throws a `SymbioteError` (as `http.ts:41-49` already does for a refused answer) with the host, the path and the first 200 characters.
3. The CLI's three log and record readers: a bad line is skipped and counted, as an unreadable
   file already is in `thread.ts:184-186`.
4. The viewer: once V95's `useRead` exists, it takes a guard; the SSE `data<T>` helper takes one
   and drops a bad event with a warning.
5. The nexus page's reads, the same way.

## Tests first

- `packages/forge/test`: the mock API answering `200` with an HTML page, and a pull without
  `head` → a `SymbioteError` naming the host and path. Today a `TypeError` (or a `SyntaxError` for HTML).
- `packages/cli/test`: `thread.ts`'s lookup with one record file holding `null` beside a good
  one → finds the good one. Today it throws (this is also an item of P51).
- `packages/viewer/test`: the events helper given `"{"` or a payload of the wrong shape → no
  throw, one warning.

## Verification

- `pnpm check`, `pnpm build`, `pnpm test:e2e`.
- By hand: the viewer with a `page.route` answering each read with `{}`: a word on the page, no
  white page (the audit's tour has the harness: `coverage/audit/tour.spec.ts` on its branch).

**Risks**

| Risk | Mitigation |
|---|---|
| A guard stricter than the real answers (an optional field a forge leaves out) | Guards check only fields the code reads; tests on the recorded answers in `packages/forge/test/mock-api.ts` |
| Overlap with V95 and P06 | Built after them; reuse their guards |
