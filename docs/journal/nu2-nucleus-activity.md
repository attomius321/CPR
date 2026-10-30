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
