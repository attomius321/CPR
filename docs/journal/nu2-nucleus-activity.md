# Journal: NU2 — Nucleus's Activity tab: everything it does, recorded

[Index](../JOURNAL.md) · [Plan](../plan/nu2-nucleus-activity.md)

## NU2 spike — what Nucleus's agents give to record (2026-10-30, branch `feature/nucleus-activity`)

Read on `main` at `c88b237`: Nucleus (`nucleus.ts`, `nucleus-gate.ts`, `nucleus-hook.ts`,
`page-agent.ts`), Symbiote's MCP server (`mcp.ts`), the workspace's recording (`thread.ts`,
`codex.ts` `serverTools`) and Activity tab (`ActivityTab.tsx`, `activity/`). Measured: the gate
built on `main`, Claude Code 2.1.314's binary (its hook events and their fields), Codex 0.163's
app-server schema (`codex app-server generate-json-schema`), one Codex session file, and the
person's live Nucleus transcript (read only; nothing started, nothing written in `symbiote/`).

**Learned**:
- **The gate costs 20.7 ms a call** (median of 40, p90 21.6 ms), Node's start nearly all of it. A
  second synchronous hook would double it; one append in the gate's own process adds little.
- **Nucleus is a reader of the web**: of the person's 82 calls, 34 are WebFetch or WebSearch, 38
  Read, Grep or Glob, 4 Bash, 6 Symbiote's tools. Results run to 43 KB (p90 7 KB): 2 KB a call
  keeps the file near 2.5 KB a call, 400 calls a megabyte.
- **Claude Code says what a page was**: WebFetch's result has `url`, `code`, `bytes` and
  `durationMs`; WebSearch's `query`, its links and `durationSeconds`. `StopFailure` carries
  errors; `PostCompact` a compaction's summary.
- **Tokens are in the transcript, not the hooks**: each assistant message's `usage`; no cost in
  a background session.
- **Codex says which pages it opened**: a `webSearch` item's `action` is `search` (queries),
  `openPage` (URL) or `findInPage`. An `mcpToolCall` has `arguments`, `result`, `durationMs`.
  Tokens only live (`thread/tokenUsage/updated`) or in its session file (`token_count`, timed).

## NU2 — Nucleus's Activity tab: everything it does, recorded (2026-10-30, branch `feature/nucleus-activity`)

Built as planned (decisions 604–610) in three parts. **Recording**: Nucleus's settings file runs
its hook with `--activity=<file>`. The gate records each call's start and decision. Async hooks
record the rest of Claude Code's events. `mcp.ts` records Nucleus's calls of Symbiote's tools and
each Confirm. The page agent records a conversation opened and New conversation. Codex's thread is
read every 2 s while a turn runs. Everything is redacted, in one file, rotated at 4 MB. **The tab**:
the workspace tab's timeline is shared (`ActivityTimeline`), and `nucleusEvents` reads Nucleus's
lines into its events: Web research and Symbiote phases, refused calls in sight, Confirms,
answers with tokens. **Verification**: tests, e2e, the person's records, real runs.

**Learned**:
- **A hook's cost is Node's start, and a young-generation scavenge.** The recording gate first ran
  4.5 ms slower than `main`'s, while its own work measured 0.7 ms in-process. Turning each part
  off showed it: any one of the redaction or the JSON put the heap past V8's first limit, and
  `--trace-gc` showed one 3.5 ms scavenge. `--min-semi-space-size=4` on the hook's command removes
  it. Separately, a case-insensitive alternation regex costs ~1.3 ms at a process's start.
- **Claude Code runs a session's SessionStart hook before Symbiote finds the session**: the
  record starts "Claude Code started", then "A conversation opened".
- **Codex's MCP items are seen after they end**: read every 2 s, a fast call's start and end land
  in one read, timed then, up to 2 s after Symbiote's own record of it. Pairing the two allows 5 s
  each side.
- **Codex's sandboxed shell failed on this machine** in the real run: `bwrap: execvp …
  app-server-daemon/releases/0.166.0…` for both commands (the daemon is 0.166, the CLI 0.163). The
  record shows exit 1 and the error; NU2 changes nothing there.
- **Test times lose fractions in `Date.UTC`**: `Date.UTC(…, 13.3)` is 13 s, which tied a Confirm
  with its call in a test. The helper adds milliseconds instead.

**Verification**: see the plan's Results.
