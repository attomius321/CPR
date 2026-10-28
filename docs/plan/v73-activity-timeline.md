# V73 — The Activity tab as a timeline of phases

[Index](../PLAN.md) · [Journal](../journal/v73-activity-timeline.md)

**Status:** in progress (2026-10-28), on branch `feature/workspace-activity` (a workspace's
branch). Plan agreed by the person ("OK as you say").

**Problem** (asked: "The Activity tab currently renders a dense, flat list of events containing
raw shell commands, absolute filesystem paths, file edits, commits, tool counts, and agent
messages … The result looks like a terminal output stream, not a polished agentic development
interface"). The tab (V48c, `workspaces/ActivityTab.tsx`, `timeline.ts`) draws one line an event
from the thread, the recorded tools (`symbiote/activity/<branch>.jsonl`, V48f), the branch's
commits and the verdict. Measured on the person's 32 recorded workspaces (5,398 tool calls) and
the 79 Claude Code transcripts of Symbiote's worktrees (15,628 shell commands):

| What | Today |
|---|---|
| A row per command | 4,007 of 5,398 calls (75 %) are `Bash`; each is a row ("Ran …"). Only reads next to reads, edits next to edits fold |
| The worktree's path in the row | 852 commands start with `cd /home/…`; the row shows it |
| The command cut where it is recorded | 1,783 (44 %) cut at 160 characters (`MAX_SUBJECT`): the whole command is nowhere to open |
| What a call keeps | its tool, its subject, `failed`; no exit code, output, duration or error — 57 failures with nothing to say why |
| What Claude Code gives (2.1.312's hook schema) | `PostToolUse`: `tool_response` (Bash: `stdout`, `stderr`, `interrupted`, `backgroundTaskId`; Edit/Write: `structuredPatch`) and `duration_ms`; `PostToolUseFailure`: `error`, `is_interrupt`, `duration_ms` |
| The agent's own words for a command | 95.5 % of commands carry Bash's `description` ("Run full check") |
| Commands' size | median 238 bytes, p90 1,808, p99 7,904; 566 (3.6 %) over 4 KB |
| Their output | median 835 bytes, p90 5,589; failures' errors median 337 |
| Test runs | 1,863 (`vitest`, `playwright test`, `pnpm check|test|build`…); 1,261 (68 %) print their summary in their last 2 KB |

What causes it: V48c chose rows over phases (decision 372: "one line an event"); V48f kept only a
subject of each call (decision 375) and named nothing a command does (decision 376).

**Goal**: the tab reads as the work's phases — exploring, implementing, editing docs, testing,
looking at screenshots, debugging, committing, waiting on the person, reporting — each one line
with its time, how long, its status and how many events, opening to every event and each event to
its whole command, output, exit code and duration. A live strip on top says what runs now. The raw
stream, every line Symbiote recorded, one switch away. **Kept**: the Terminal, Thread and Brief
tabs; the list's polling; older records (without the new fields) drawn as well as they can be;
nothing recorded is changed, dropped or made up.

## Recording (CLI, `@symbiote/core` types)

`ActivityEntry` gains optional fields, all absent when not given (older lines read as before):

- On a start: `input` — a command's whole text (Bash's `command`, Codex's), cut at 8 KB (p99 of
  the commands measured); `about` — Bash's `description`, cut at 160; `task` — for `TaskCreate`
  its subject, for `TaskUpdate` its ID and status (`TodoWrite`'s list is not read).
- On an end: `ms` (Claude Code's `duration_ms`, Codex's duration); `exit` (Codex's exit code;
  Claude Code's from its error's "Exit code N" line); `output` — a command's output (stdout then
  stderr) or a failure's error, its last 2 KB; `interrupted` (`is_interrupt`,
  `tool_response.interrupted`); `background` (a command sent to the background: its end is not
  the command's); `added`/`removed` — the lines an Edit or a Write changed, counted from
  `structuredPatch`; `task` — the ID `TaskCreate` was given.
- `thread.ts` `activityEntry` fills them from Claude Code's hooks; `codex-run.ts` from `exec
  --json`'s items; `codex.ts` `serverTools` from the app server's `full` items. Hermes keeps its
  subject only (not in V73).
- **Its own read** (decision 517): `GET /api/workspaces/activity?branch=` answers
  `{ tools, cut }` — the activity file's last 1 MB (about 700 calls at the new sizes; the person's
  longest workspace has 350), `cut` when older lines were left out — or the app server's and
  Hermes's tools as the thread read gives them today. Only the Activity tab reads it, while it is
  shown, with the list's reads. The thread's read no longer reads the tools: the timeline was
  their only reader, and the thread is read with every list read whatever tab is shown.

## Grouping (viewer, `workspaces/activity/`, pure)

- **`events.ts`** — `activityEvents(workspace, thread, tools, commits)`: the raw events, oldest
  first, keys stable while the sources grow: the workspace made; each thread entry (start, prompt,
  message, ask, report, notice, end, and any kind it does not know); each tool call once, its
  start and end paired by ID whatever order the async hooks wrote them in (an end without its
  start, cut by the window, is a call too; a line seen twice counts once); each commit; the
  verdict. Every recorded line stays reachable (`lines`), unchanged.
- **`classify.ts`** — what a call is: `Read`, `Grep`, `Glob`, web reads, subagents and read-only
  commands explore; edits inside the worktree implement (a `.md` file: docs; outside the worktree:
  scratch, joining what is around it); test, lint, typecheck, build and format-check commands test;
  an image read or a screenshot command is visual; `git` commands are git; task and tool-search
  calls join what is around them. `shownCommand` drops a leading `cd <worktree> &&` and writes the
  worktree's and the home's paths short; the whole command stays in the details.
- **`groups.ts`** — `activityGroups(events, state)`: phases between milestones (a prompt, the
  person's message, an ask, a report, a commit, the verdict, a session's start and end). Reads
  between edits stay in Implementation; a run of tests is Testing; screenshots are Visual
  inspection; a failed test followed by edits, to the next passing run, is Debugging (decision
  518); a `git commit` call and the commit it made are one Commit; an agent's task in progress
  names the phases it spans. Each group: `key` (its first event's), `kind`, title, a summary of
  facts ("5 files · +482 −37", "pnpm check passed · 1,723 tests"), start, end, status (`running`,
  `done`, `failed`, `recovered`, `cancelled`, `waiting`, `open` — no end recorded), its events.
- **`test-summary.ts`** — Vitest's, Playwright's, Jest's, pytest's, cargo's and go's summary
  lines read from a test command's output; nothing read, the exit code alone.
- **`live.ts`** — while the agent works: the newest call not ended (its phase, its words, since
  its start) or thinking (since the last end); while it waits: its ask. Codex's untimed items: no
  elapsed time.

## The tab (viewer)

- **Live strip** (decision 516): the working dot (`StateDot`), the phase, the agent's words for
  the call ("Run full check") with the command beside it, the elapsed time from the call's
  recorded start (a 1 s clock only in that element). Waiting: what it asks, still. No progress
  bars, no percentages.
- **Timeline**: a time column (time, duration; muted, tabular), a 1 px rail with a small node per
  group in its status's tone, the group's line (16 px icon, title, summary, status, count).
  Milestones (prompt, message, ask, report, commit, verdict) in the text's weight with a filled
  node; commits with their short SHA in mono and their subject. Failures in `--error` with the
  exit code.
- **Open a group**: one surface, hairline dividers, every event: what it did (the agent's words,
  else the shortened command), a relative path, its duration and exit code. **Open an event**: its
  whole command (copy), output, error, exit code, start and end, ID. More than 50 events: the
  first 50 and "Show all N".
- **Raw events**: a switch beside the strip shows every recorded line in time order, each opening
  to its JSON.
- Open groups stay open across reads (keyed); new groups fade in; the view follows the end while
  it is there; rows off screen are skipped (`content-visibility`); a narrow panel drops the time
  column's duration first.

**Not as in the mockup** (`Dark Developer Activity Timeline.png`): no test progress bar (a
running command's output is not recorded until it ends: a count would be made up); 16 px icons in
the state's tone, not 32 px colour tiles (colour is for state in Symbiote's style); one surface,
not cards in cards; summaries of facts, not prose.

## Verification

1. **Unit, red first** (`packages/viewer/test/activity-*.test.ts`): events (pairing, ends before
   starts, an end alone, duplicates, untimed Codex items, unknown kinds); classification on real
   commands; grouping (exploration → implementation → testing → debugging → commit → report; glue;
   milestones; a commit's call and commit as one; asks waiting and answered; cancelled and
   interrupted; a session ended with a call open); keys kept as events are appended; statuses;
   test summaries on real Vitest and Playwright output; `shownCommand`; the live state.
   CLI (`packages/cli/test/thread.test.ts`, `codex.test.ts`): the new fields, their cuts.
2. **e2e** (Playwright, the fake agent's hooks): a group opened to its events, an event to its
   command and output; the raw stream; a live update (a call started: the strip and a running
   group; ended: done); a failed command with its exit code and error; a workspace without
   recorded tools.
3. **Real data**: copies of the person's longest threads and activity (323 and 350 calls) served
   in a scratch repository: groups per workspace (a naive first cut gave a median of 48 for 146
   calls: too many), grouping time, first render; screenshots at 1440 px and a narrow panel, dark
   and light, 1×.
4. **A real agent**: `claude -p --model haiku` in a scratch repository with settings running this
   branch's hook into a scratch `symbiote/`: a failing test, a fix, an edit, a commit; what Claude
   Code 2.1.312 really sends, recorded and shown.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`; the other tabs unchanged.

**Risks**

| Risk | Mitigation |
|---|---|
| Output kept may hold what a command printed (a token) | 2 KB, local, in the git-ignored `symbiote/` as the thread's 4 KB permission inputs are |
| The person's workspaces run `main`'s hook | the new fields arrive once merged and built; until then the timeline groups what is recorded |
| A long session's read grows | 1 MB window, only while the tab is shown; `cut` says so |
| Phases named wrong | named from the tool and the command's program only; the result only from the exit code and the command's own summary; every event one click away |
| V72 (page frame, `feature/layout-fixing`) reworks panel insets | the tab's own CSS only; merge `main` when it lands |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V73a | Recording | the new fields from Claude Code and Codex; `/api/workspaces/activity` |
| V73b | Grouping | `activity/` modules and their tests |
| V73c | The tab | live strip, timeline, groups and events, raw stream |
| V73d | Verification | e2e, real sessions, a real agent, screenshots |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 513 | Where phases come from | **A presentation layer over the raw events, in the viewer; every recorded line one switch away** | the brief: "do not discard, mutate, or fabricate raw events" |
| 514 | What a call keeps | **Its whole command (8 KB), its description, duration, exit code, its output's or error's last 2 KB, edits' lines, interrupted, background, task** (replaces 375's "nothing else of its input") | 44 % of commands cut at 160; 68 % of test runs' summaries are in their last 2 KB |
| 515 | Naming a phase from a command | **The phase from the tool and the command's program; its result only from the exit code and the command's own printed summary** (376 stays for the sidenav's "Running …") | precise beats complete: a phase can be named, a result cannot be guessed |
| 516 | The live strip | **The agent's state and its newest call not ended; elapsed from that call's recorded start; no bars, no percentages** | the brief: no fake progress |
| 517 | How the tab reads the tools | **Its own read, the last 1 MB, only while it is shown; the thread's read without them** | the thread is read every 5 s whatever tab is shown |
| 518 | Debugging | **A failed test followed by edits, to the next passing run** | a phase the events show, not a guess at intent |

**Not in V73 (later)**: Hermes's commands and outputs; a running command's output while it runs
(Claude Code's hooks give it only at the end); prose summaries of a phase.
