# NU2 — Nucleus's Activity tab: everything it does, recorded

[Index](../PLAN.md) · [Journal](../journal/nu2-nucleus-activity.md)

**Status:** in progress (2026-10-30), on branch `feature/nucleus-activity` (a workspace started in
Symbiote, from `main` at `c88b237`). The person OK'd the plan with its three recommendations:
the real runs keep their records in a cache of the job's own, as NU1's did (the person's live
Nucleus conversation untouched); Codex's thread read every 2 s while it is active, its tokens from
its session file; Web research and Symbiote as phases with colours of their own.

**Problem** (asked: "an Activity tab for Nucleus, built like a workspace's Activity tab … Right now
what Nucleus does lives only in its terminal's scrollback", and "record everything possible").
Planned by NU1 as NU2 (decision 595). Measured on `main` at `c88b237`, Claude Code 2.1.314, Codex
0.163:

| What | Found |
|---|---|
| Where Nucleus's acts are kept | Its terminal only. Its settings file has one hook, the gate; it records nothing (decision 238: "none that record") |
| The person's live Nucleus conversation (`b2c9b54b`, read only) | 5 prompts, 82 calls: WebFetch 24, Grep 20, Read 16, WebSearch 10, Bash 4, Glob 2, Symbiote's tools 6. Inputs: median 120 B, p99 4 KB. Results: median 1.2 KB, p90 7 KB, largest 43 KB |
| The gate's cost | 20.7 ms median, 21.6 ms p90 (40 runs of `main`'s `nucleus-hook.js`, a `git log`): Node's start, nearly all of it |
| Claude Code's hooks | `UserPromptSubmit`, `Stop` (`last_assistant_message`), `StopFailure` (`error`), `SessionStart`/`SessionEnd`, `PreCompact`/`PostCompact`, `PostToolUse`/`PostToolUseFailure` (`duration_ms`), `PermissionDenied`, `Notification`; each with `transcript_path` |
| What Claude Code's results hold | WebFetch: `url`, `code`, `codeText`, `bytes`, `durationMs`, `result`; WebSearch: `query`, `results` (their links), `durationSeconds`; Bash: `stdout`, `stderr`, `interrupted` |
| Tokens and cost on Claude Code | Each assistant message's `usage` in the transcript (input, cache read and write, output). No cost in a background session |
| Codex's app server | `webSearch` items (`action`: `search` with its queries, `openPage` with its URL, `findInPage`), `mcpToolCall` (`arguments`, `result`, `error`, `durationMs`), `commandExecution` (`exitCode`, `durationMs`, output), `contextCompaction`; a turn's `startedAt`, `durationMs`, `error`. Tokens only in `thread/tokenUsage/updated` (live) and the session file's `token_count` lines (`Thread.path`) |
| Forge tokens Symbiote reads | `GITHUB_TOKEN`, `GH_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GITLAB_TOKEN`, `CI_JOB_TOKEN` |

**Goal**: Nucleus's page has an Activity tab beside its terminal, built from the workspace's (V73's
timeline, live strip, groups and raw stream; V74's colours): the person's messages and Nucleus's
answers, every call with its arguments, result, duration and exit, the gate's decision on each,
every Symbiote tool call and each Confirm with how it ended and what it did, the session's own
events and its tokens; for Claude Code and Codex alike; kept across conversations and restarts.
**Unchanged**: what Nucleus may do (the gate's answers, every Confirm); the workspace's Activity
tab's groups; Scribe.

## The record (decision 604)

- **One file across conversations**: `nucleus-activity.jsonl` beside `nucleus.json` (in
  `symbiote/`, else Symbiote's cache), one JSON object a line. Each line names its `conversation`
  (Claude Code's session ID, Codex's thread) and its `agent`.
- **Bounded**: above 4 MB, Symbiote's server moves it to `nucleus-activity.1.jsonl` (replacing an
  older one); the hooks only append. The tab reads the newest 1 MB across the two: about 400 calls
  at the measured sizes, five conversations like the person's.
- Two kinds of line, as a workspace's thread and activity are: **entries** (`kind`: the person's
  message, an answer, a session's start, end, compaction, error, an opened conversation, New
  conversation, a Confirm) and **calls** (`phase` `start` or `end`, V73's `ActivityEntry` with
  `gate`, `pages`, `source`).

## Claude Code (decision 605, revisits 238)

- **The gate records its own decision**: in its PreToolUse process, after deciding, one
  `appendFileSync` of the call's start (V73's fields: the input whole up to 8 KB, the agent's
  words) and `gate`: `allow` (with its reason), `deny` (with its reason) or `agent` (left to
  Claude Code's rules). Node's own modules only, as before; its answers byte for byte as on `main`.
- **The rest async** (adds nothing to a call): `PostToolUse`/`PostToolUseFailure` (V73's end, and
  a page's address, status and size, a search's query and links), `PermissionDenied`,
  `UserPromptSubmit`, `Stop` (the answer, and the turn's tokens from the transcript's end),
  `StopFailure`, `SessionStart`, `SessionEnd`, `PreCompact`, `PostCompact`, `Notification`. One
  module, `nucleus-record.ts`, run as `nucleus-hook.js --record <file>`.
- The settings file is rewritten at each wake (V35): a running conversation is recorded from its
  next wake. Scout's settings (`scout-hook.js`) are not rewritten: a Scout conversation is not
  recorded.

## Codex (decision 606)

- While Nucleus's thread is active, Symbiote's server reads its newest turns in full every 2 s
  (`thread/turns/list`) and writes what it has not: an item's start when first seen, its end when
  it completed, timed when seen; a turn's prompts and answer, its error, interrupted or failed.
  Symbiote still keeps no thread subscribed (decisions 154–155).
- **Tokens**: the session file's `token_count` lines at a turn's end, read field by field
  (`Thread.path`); absent when not read, and the tab says nothing of them.

## Symbiote's side (decision 607)

- `mcp.ts` records each call of Nucleus's (`via: 'nucleus'`): the tool, its arguments, its answer's
  first 2 KB, its duration, an error. An asked tool also: the words asked, how it ended
  (`confirmed`, `declined`, `expired`, `gone`), the time waited, and what it did (the act's
  answer). `suggest_settings`' proposal and `wait`'s answer are their answers.
- The page agent records Symbiote's acts on the conversation: opened (agent, model, effort), New
  conversation, a message sent, a failed start or reply. Only Nucleus's spec has an activity file.
- A Symbiote tool call is in the agent's record too; the viewer pairs the two by tool, arguments
  and time; where two could pair, neither is paired.

## Secrets (decision 608)

One `redact` on every string before it is written, in the hook and in the server: values of
environment variables whose names say secret (`TOKEN`, `SECRET`, `KEY`, `PASSWORD`, `PASSWD`,
`CREDENTIAL`, `AUTH`, `COOKIE`, `SESSION`), 8 characters or more, and the six forge variables; and
tokens by their shape (`ghp_`, `gho_`, `ghs_`, `github_pat_`, `glpat-`, `sk-ant-`, `sk-`, `xox?-`,
`AKIA…`, `Bearer …`, a URL's password, query parameters named like secrets). Each becomes
`[redacted]` or `[redacted: NAME]`. The settings file carries no secret: the hook redacts by its own
environment and the shapes.

## The tab (decisions 609, 610)

- **Shared**: `activityEvents` and `rawLines` take sources, not a workspace; the timeline (bar,
  live strip, rows, raw stream, follow the end) is one `ActivityTimeline` used by the workspace's
  tab and Nucleus's.
- **Nucleus's page**: line tabs above its card, **Terminal** and **Activity**;
  `/nucleus?activity` opens the second.
- **Its phases**: Exploration (files, git); **Web research** (searches and pages: "2 searches · 5
  pages"); **Symbiote** (its reads); a refused call stays in sight with the gate's reason, as a
  failed test does (V73). Milestones: the person's message, Nucleus's answer (its tokens), a
  Confirm (asked, then how it ended and what it did), the session's events.
- **The workspace's tab unchanged** (decision 610): a web read stays Exploration there; Nucleus's
  grouping is asked for by an option.
- **Two tokens**, `--phase-web` and `--phase-symbiote`, both themes, ≥ 3:1 (`tokens.test.ts`).
- `GET /api/nucleus/activity` answers `{ lines, cut }`, read while the tab is shown, with
  Nucleus's state reads.

## Verification

1. **Tests first**, red for the right reason: each hook event's line; the gate's decision
   recorded and its answers unchanged; `redact` on planted tokens; the rotation and the read
   across two files; MCP recording (a read, a Confirm confirmed, declined, expired, `wait`,
   `suggest_settings`); Codex's items (search, page opened, MCP call, command, compaction, turn
   interrupted and failed, tokens); the page agent's lines; the viewer's events, groups, pairing,
   live strip; the workspace tab's tests unchanged.
2. **The gate's cost**: the same 40 runs before and after; under 2 ms added at the median.
3. **e2e**: the tab, a group opened and an event; a refused call and its reason; a declined
   Confirm; the live strip; the raw stream; the tab again after `symbiote view` restarts.
4. **Real runs**, Claude Code then Codex, with this branch's `symbiote view` in this worktree,
   `GIT_CONFIG_GLOBAL=/dev/null` and a job-local cache (NU1's way): git reads, a refused command,
   a search, a page, Symbiote's reads and a declined Confirm, live and after a restart.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`; `viewer-check` screenshots of both tabs, dark and
   light, 1440 and 390 px.

**Risks**

| Risk | Mitigation |
|---|---|
| The gate slower on every call | One synchronous append, measured; the rest async |
| A running conversation not recorded | From its next wake; said |
| Codex's session file is not its protocol | Read field by field; tokens absent otherwise |
| What a page or a command printed is kept | Redacted, 2 KB a call, local, in the git-ignored `symbiote/` (V73's) |
| Two identical Symbiote calls at once | Not paired: both shown, never guessed |

## Milestones

| # | Milestone | Output |
|---|---|---|
| NU2a | Recording | the file, its rotation and read, Claude Code's hooks, Codex's reads, Symbiote's side, redaction |
| NU2b | The tab | shared timeline, Nucleus's events and groups, the page's tabs, colours |
| NU2c | Verification | e2e, real runs, screenshots, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 604 | Where it is kept | **One file across conversations beside `nucleus.json`, rotated at 4 MB to one older file; the tab reads the newest 1 MB** | The brief: kept across conversations, bounded; V73's 1 MB window |
| 605 | Claude Code's record (revisits 238) | **The gate records each call's start and its decision in its own process; every other event by async hooks** | A second synchronous hook would cost a Node start (~20 ms) a call |
| 606 | Codex's record | **Its thread read in full every 2 s while active, what is new written; tokens from its session file** | Symbiote keeps no thread subscribed (154–155); its items carry no time of their own |
| 607 | Symbiote's tools and Confirms | **Recorded where Symbiote answers them, paired in the viewer with the agent's call** | Only Symbiote sees the Confirm's end and what it did |
| 608 | Secrets | **Redacted before writing: secret-named environment values, the forge's variables, token shapes** | The brief: never record secrets |
| 609 | The tab | **The workspace tab's timeline shared; Web research and Symbiote phases with colours of their own; Confirms milestones** | The brief: reuse, not a copy; the person chose the colours |
| 610 | The workspace's tab | **Unchanged: Nucleus's phases by an option** | Out of scope but for shared parts |

**Not in NU2 (later)**: NU3–NU7; Scribe's activity; a cost where the agent gives none.
