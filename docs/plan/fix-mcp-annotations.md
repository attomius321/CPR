# Fix — MCP tools say which are read-only and refuse unknown arguments

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S8)

**Status:** built in MC3 (decision 997) on branch `feature/mcp-batch-confirm`, ready for review
(2026-11-11); planned 2026-11-06 for a branch `fix/mcp-annotations` of its own, written by the
improvement audit (`chore/improvement-audit`).

**Kind** fix · **Branch** `fix/mcp-annotations` · **Size** S · **Depends on** none · **Plan** P31
of 51 (the audit's order)

## The brief

**What happens**: `symbiote mcp`'s `tools/list` returns 25 tools, none with `annotations`. An
agent's client therefore asks the person before every read (`overview`, `workspaces`, `merges`…)
as before a merge. The input schemas set no `additionalProperties: false`, so a mistyped argument
is ignored: `wait` with `{"seconds": 1}` waited its default 10 minutes.

**How to reproduce**: a `symbiote view` with its own `SYMBIOTE_CACHE_DIR`, then from its
repository `symbiote mcp` over stdio: `initialize`, `tools/list` (no `annotations` on any tool),
`tools/call wait {"seconds":1}` (no answer within 120 s).

**Where to look**:
- `packages/cli/src/mcp.ts:161-168` (`ToolSpec`), `:191-198` (`object()`, the schema helper),
  `:201-463` (the 25 tools; `asks: true` marks those waiting for the Confirm).
- `:1519-1532` (`tools/list` maps `name`, `description`, `inputSchema` only).
- `:1053` (`wait`'s `minutes`, default `MAX_WAIT` 10).
- `packages/cli/test/mcp.test.ts`.

**Out of scope**: the tools' behaviour; the Confirm (SC1, P04); new tools.

**Done when**:
- Every tool in `tools/list` has `annotations`. The reads (`overview`, `workspaces`, `workspace`,
  `thread`, `activity`, `start_options`, `suggest_settings`, `review`, `merges`, `merge_log`,
  `usage`, `code_map`, `wait`) are `readOnlyHint: true`.
- The tools that act are `readOnlyHint: false`; those that remove something (`clean_workspace`,
  `remove_merge`, `stop_agent`) are `destructiveHint: true`; `idempotentHint` where it holds.
- A call with an argument its schema does not name answers a tool error naming it, and nothing
  runs.
- `wait` with no `minutes` keeps its 10-minute default.

## Evidence

Reproduced in the audit with a stdio client on a scratch repository: `init 230 ms`, 25 tools, every
one "no annotations"; `wait {"seconds":1}` exceeded the client's 120 s. The person's logs hold
`POST /api/mcp` requests of 600 s (`wait`'s cap). Those are expected, but show how long a wrong
argument blocks.

## Approach

- `ToolSpec` gains `annotations: { readOnlyHint: boolean; destructiveHint?: boolean;
  idempotentHint?: boolean; title?: string }`, required, so a new tool must say what it is.
- `object()` adds `additionalProperties: false`.
- The call path checks the arguments' keys against `inputSchema.properties` before `prepare`, and
  answers `isError` with "unknown argument: seconds (wait takes minutes)". Today an unknown tool
  is refused at `:1441`.
- `tools/list` sends `annotations`.
- `suggest_settings` runs a small model on the person's subscription: `readOnlyHint: true`, since
  it changes nothing, but its description already says it runs.

## Tests first

`mcp.test.ts`:
1. Every tool in `tools/list` has `annotations.readOnlyHint` as a boolean, and the read set above
   is `true`. Red today.
2. `tools/call wait {"seconds":1}` answers `isError` at once, naming `seconds`. Red today: it
   waits.
3. Every schema has `additionalProperties: false`.

## Verification

`pnpm check`; `e2e/mcp.spec.ts`; the stdio run of the audit repeated (25 tools, the wrong argument
refused in < 50 ms).

## As built (in MC3)

Built whole in [MC3](mc3-mcp-batch-confirm.md), which changed four of the same schemas and the
tools snapshot (decision 997, the person's choice). As planned, but:

- **`suggest_settings` names every field of a start.** It takes `start_workspace`'s whole brief by
  design (decision 583: one brief fits both, the run's choices left out). With unknown arguments
  refused, its schema lists those fields too, and it still reads only the brief.
- **An acting tool says `destructiveHint: false`** unless it removes something: MCP's default for
  a tool that is not read-only is that it may destroy. `stop_agent`, `clean_workspace` and
  `remove_merge` say `true` and `idempotentHint: true`.
- **Two tests called tools with arguments they do not take** (`workspaces` with `state`): they now
  use real ones.

`wait {"seconds": 1}` answers "unknown argument: seconds (wait takes minutes)" at once, where it
waited 10 minutes; 26 tools listed, each with its annotations and `additionalProperties: false`.
