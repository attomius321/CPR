# NU2 — Nucleus's Activity tab: everything it does, recorded

[Index](../PLAN.md) · [Journal](../journal/nu2-nucleus-activity.md)

**Status:** ready for review (2026-10-30), on branch `feature/nucleus-activity` (a workspace
started in Symbiote, from `main` at `c88b237`; `main` merged in at `55314f3`, docs only). The
person asked to start implementing with the plan's three recommendations: the real runs keep their
records in a cache of the job's own, as NU1's did (the person's live Nucleus conversation
untouched); Codex's thread read every 2 s while it is active, its tokens from its session file;
Web research and Symbiote as phases with colours of their own. Its "As built" and results below.

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

## As built (NU2)

- **The gate's own record cost 4.5 ms a call, not the append.** Built as planned (one
  `appendFileSync` in the gate's process), the hook took 26 ms against `main`'s 21. Two causes,
  measured by turning parts off one at a time: a case-insensitive regex costs ~1.3 ms at a
  process's start (the redaction now matches variables' names by string), and the recording took
  the hook's heap past V8's first young-generation limit: one 3.5 ms scavenge on every call
  (`--trace-gc`). Nucleus's hook command starts Node with `--min-semi-space-size=4` (only when it
  records: Scribe's settings are unchanged); no scavenge then, even for a 7 KB input.
- **The gate loads only what it needs**: `nucleus-record.ts` (redaction, the start line, the
  append) and `tool-activity.ts` (the tool line's code, moved out of `thread.ts`, which loads
  `fs/promises`); the rest of the record, `nucleus-activity.ts`, is loaded only for the events
  Claude Code runs in the background.
- **Not "a message sent" by the page agent**: a message is recorded once, by Claude Code's
  `UserPromptSubmit` or Codex's turn; Symbiote records a conversation opened and New
  conversation. A conversation is named by Claude Code's session ID, as its hooks name it.
- **A refused call ends at its start**: the viewer gives a call the gate refused an end at its
  start, so every phase rule reads it as done; its details say "Never ran: its gate refused it".
  A call refused, or declined by the person's Confirm, is not counted as a failure: the summary
  says "1 refused", the Confirm "Declined".
- **Codex's items in the app server's reader**: MCP arguments and answers, the pages a search
  opened, a turn's time and compactions are kept in fields `serverTools` does not read (`mcp`,
  `web`, `ms`, `compactions`), so a workspace's Codex activity is as on `main`. The turn's `ms`
  shows in one existing test's expectation.
- **The workspace's tab**: `ActivityTimeline.tsx` is the timeline both tabs draw;
  `liveActivity` takes an agent's state and a folder instead of a workspace. Nucleus's own kinds
  (`web`, `symbiote`) are set on its calls by `nucleusEvents`, so the workspace's classification
  is untouched.
- **Colours**: `--phase-web` a yellow (`#d4c84a` dark, `#6f6a00` light) and `--phase-symbiote` a
  magenta (`#dc7cf0`, `#9c2fb8`), between the existing hues; `tokens.test.ts` checks 3:1 on every
  background and on their wash.
- **The tab's place**: line tabs on the card's head, as a workspace's; the terminal's tab unmounts
  its terminal as a workspace's does. `nucleus.spec.ts`'s layout check now has the tabs at the
  card's top and the terminal under them.
- **A paired call starts when Symbiote saw it, when that was earlier**: Codex's items are read
  every 2 s, so a fast MCP call is first seen after it ended, after its own Confirm. Its start
  is Symbiote's record of it.
- **The bar's Timeline and Raw events keep one line each** at a phone's width (they wrapped at
  390 px, in the workspace's tab as well).

**Results.** Tests first, red for the right reason (the recorder's module missing, the settings
without the activity file, `mcp.ts` without `record`, the page agent without `activity`), then:
31 tests for the recorder (redaction, the gate's line, every hook event, the file's rotation and
read, the hook in one process), 5 for Codex's thread, 4 for `mcp.ts`, 4 for the page agent and
Codex's reads through the fake app server, 1 for the server, 19 for the viewer (events, pairing,
groups, the live strip, words, the agent's state). e2e: `nucleus-activity.spec.ts`, 2 specs.

| What | Result |
|---|---|
| The gate's cost, 60 runs × 3, `git log` | `main` 20.6 ms mean; recording 22.8 ms (+2.2 ms, ~11 %); this branch without `--activity` 21.5 ms. Medians of an earlier 50-run set: 20.7 and 22.4 ms |
| The workspace's tab, the person's 50 recorded workspaces (17,719 tool lines) | `main`'s and this branch's 2,177 groups, their statuses, summaries, event words and colours identical |
| Claude Code 2.1.314 as Nucleus (Sonnet, low), one message: a git read, `curl`, a search, a page, `overview`, `workspaces`, `start_workspace` | 41 s. 23 lines: the gate's decision on 8 calls (the `curl` refused with its reason), 7 search results, the page (200, 39,824 bytes), Symbiote's side paired with each MCP call, the Confirm declined after 1.2 s, the answer with 155K tokens in (80 % cached) and 603 out |
| Codex 0.163 (its daemon 0.166) as Nucleus (low), the same message, after New conversation | 22 s. 17 lines of its own: both commands failed in Codex's sandbox launcher (`bwrap: execvp`, recorded with exit 1), the search and the page it opened, the MCP calls paired, the Confirm declined, the answer with 204K tokens in (78 % cached) and 559 out from its session file |
| After `symbiote view` restarted | The same 53 lines (18.4 KB for both conversations) on the tab; none of this machine's secret-named values or token shapes in the file |
| Screenshots, the real record: 1440 and 390 px, dark and light, closed, opened, raw | First group drawn in 138–155 ms; no horizontal overflow; no page errors |

At the real runs' sizes a conversation of 7 calls takes about 9 KB: the tab's megabyte holds about
110 such conversations, the 4 MB file about 450.

**Not verified**: a conversation that already runs picking up its recording at its next wake (the
settings file is rewritten then, as for V80's reach); Claude Code's compaction, `StopFailure` and
`PermissionDenied` events and a Codex compaction from a real run (unit-tested from their schemas);
the file's rotation at 4 MB on a real record; Codex's terminal's turns (read the same way as its
messages from the page); the desktop app; macOS and Windows; the person's own Nucleus conversation
(`b2c9b54b`), which records once `main` is built with NU2 and the session wakes.
