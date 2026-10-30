# V46 — Merger logs: what a merge is doing, and its files

[Index](../PLAN.md) · [Journal](../journal/v46-merger-logs.md)

**Status:** merged into `main` on 2026-10-24 (built 2026-10-24), on branch `feature/merger-logs` (a workspace started
in Symbiote, from `main` at `561826d`). The plan OK'd by the person, with its three questions
answered: "1. Add a merger effort in settings. 2. Yes 3. Yes, recommendation. Ok" — a merger
effort in Settings (V46d), the log in a terminal, a file's regions only. As built and results
under "As built (V46)" below.

**Problem** (asked: "The merger page feel empty for the moment...there is no feedback in
processing, nothing. I need some logs if there are tests. and if the merge needs an agent, i need
to see that agent thinking process. in a terminal maybe. At the end, in case of conflicting merge
results, i want to be able to see per file the result, so i need a list of files."). Read on
`main` (`561826d`) and measured in the V46 spike (Claude Code 2.1.310, Codex 0.163.0, pnpm 12.8.1):

| What `main` has | Read or measured |
|---|---|
| What the merge page says while a merge runs | One line per state (`mergeState`): "Merging into main", "Resolving 1 conflicting file: the merger agent answers each region", "Checking: pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm test:e2e". Nothing else changes until the state does |
| How long that line stays, here | This repository's check (`merge.checks`), run as the merger runs it (a shell, pipes): **218 s** — install 0.2 s, `pnpm check` 47.5 s, build 3.4 s, `pnpm test:e2e` 167 s. A merger agent run: 7–49 s (V26c, 11 replays) |
| What that check writes | **365 lines, 30 KB** in all (e2e 267 lines). No colour codes and no `\r` when piped. Output comes in bursts: up to **18 s** without a line (`pnpm check`'s tests), 10.8 s in e2e |
| What is kept of it | Collected in memory; at the end its last 60 lines go in the entry (`OUTPUT_LINES`). The page shows them only when the check failed ("Its output"): a passed check's output is kept and never shown |
| The merger agent's run | `claude -p --output-format json`: one object when it exits, nothing while it works. Codex (`exec --json`) streams events, read only after it exits |
| What Claude Code can stream (two small conflicts, `sonnet`) | `--output-format stream-json --verbose --include-partial-messages`: each tool call (`Read notes.txt`) and its result, the text as it is written, usage at the end; the same `result` object as today. Thinking: 0 thinking tokens on a trivial region, 161–250 where the sides disagree, but its text is **empty** (`"thinking": ""`, `thinking_display: "updates"`). With `--thinking-display summarized` (a flag `claude --help` does not list) a summary streams: 19 deltas, 198–333 characters ("I'm merging the two changes by renaming the loop variable to "tries" throughout…"). `showThinkingSummaries: true` in `--settings`: still empty. 3.6–6.4 s a run |
| What Codex streams (the same conflict) | `thread.started`, `turn.started`, `item.completed` (`agent_message`), `turn.completed`; no `reasoning` item at its default configuration (`reasoning_output_tokens: 0`). 7.4 s |
| A resolution to review | Every region of every file in one list, each headed `path:line` (`MergeView`); no list of files |
| Conflicting merges in this repository (125 merges on every branch, replayed with `git merge-tree`) | **22** conflict: 12 in one file, **10 in 2–4 files** (up to 7 regions). Bitwarden (V26 spike): 30 conflicting `messages.json` files in 21 merges |

What causes it:
- A check's output and the agent's events are read only once the process exits, and the page
  draws only the entry's state.
- The queue file holds the result, not the way there: nothing records what each step did and when.
- The resolution is drawn region by region, with the file as a heading.

**Goal**: while a merge runs, its page shows each step — the merge, the merger agent, each check
command, the landing — with its mark and its time, and a log beside them in a terminal: what git
did, the check's output as it is written, and the merger agent's thinking, tool calls and answer
as it works. A merge whose conflicts were resolved lists its conflicting files, each with what
its resolution did in a few words; a file shows its own regions. **Unchanged**: the queue, its
states and actions; what the agent is given and how its answer is written (decisions 150–152);
the check; landing; `symbiote merge`'s output; nothing in the analysis.

## The log (CLI: `merge-log.ts`, beside `merges.ts`)

- **A log per queue entry**: `state/<repo>/merges/<id>.jsonl` in Symbiote's cache, beside
  `merges.json`. One JSON object a line, appended as it happens, each with its time `at` (ms):
  - `{ at, step, title }`: a step starts. `merge`; `resolve`; `check`, one per command, its
    title the command; `land`.
  - `{ at, out }`: what the step writes. A check command's stdout and stderr, as they come.
    For git's steps, Symbiote's own lines: "Merging 1a2b3c4 into main at 5d6e7f8",
    "2 files conflict: docs/JOURNAL.md, docs/PLAN.md", "Committed the merge 9f8e7d6",
    "main fast-forwarded in /home/…/Symbiote", "Pushed to origin", git's words when it refuses.
    For the resolve step, before the agent runs: the symbols both sides changed (V26c's analysis,
    with its time) and the prompt's size.
  - `{ at, agent }`: one of the merger agent's events (below).
  - `{ at, end: { ok, ms } }`: the step ended.
  - `{ at, run }`: the entry runs again, and why: Retry, Request changes ("asked again with your
    words"), Check again, `into` moved ("merged again on its tip"), a stop ("merged again after
    Symbiote stopped"). The earlier runs' lines stay above.
- **Not in `merges.json`**: the queue file is rewritten whole on every change, and every page
  reads it every 1.5 s while a merge runs. Output chunks would go through both.
- **Written by the process that merges** (a `symbiote view`, or `symbiote merge` in a terminal);
  read by any. The queue already follows other processes (V26a).
- **Its size**: a step's output past 1 MB keeps its first 64 KB and, from then on, only its end
  (1 MB), with a line saying how much was left out. Measured here: 30 KB for the whole check, so
  this is a guard for other projects.
- **Its lifetime**: removed with its entry (Remove). A log whose entry is gone is removed when the
  queue is next drained.
- `check.output` (the last 60 lines) stays in the entry: `symbiote merge` prints it, and entries
  from before V46 have no log.

## The merger agent's process (CLI: `merge-agent.ts`)

- `MergerAgent.run` gains `onEvent`; `runWithInput` gains `onLine`, so stdout is read line by
  line while the agent runs. The answer is read as today.
- **Claude Code**: `--output-format stream-json --verbose --include-partial-messages
  --thinking-display summarized` in place of `--output-format json`. Kept in the log:
  - `thinking_delta` → `{ think }`: the summary of its thinking, as it comes;
  - `text_delta` → `{ say }`: what it writes (its answer, JSON);
  - an `assistant` message's `tool_use` → `{ tool, input }`: `Read` and the path, `Grep` and the
    pattern, `Glob` and the glob;
  - a `user` message's `tool_result` → `{ result }`: its size ("214 lines"), not its content (a
    read file can be ~100K tokens, V26c);
  - `system` `init` → `{ start }`: Claude Code's version and the model;
  - the `result` event: the answer, `is_error` and `usage`, the fields `--output-format json`
    gives today; the log adds "Answered in 23.4 s · 10.2K tokens in, 1.1K out".
  - Not kept: hook events, rate-limit events, signatures, message starts and stops.
- **`--thinking-display` is not in `claude --help`.** A Claude Code that refuses it ("unknown
  option") is run again at once without it, and the log says its thinking is not shown. The
  answer never depends on it.
- **The model thinks when it decides to.** How much is the merger's effort's (below).
- **Codex**: its `exec --json` lines read as they come: `reasoning` → `{ think }`,
  `command_execution` → `{ tool: '$', input }` and its exit code, `agent_message` → `{ say }`.

## The merger's effort (V46d; CLI `merges.ts`, Settings)

Asked, on question 1: "Add a merger effort in settings".

- **`merge.effort`** in `symbiote/config.json`, beside `merge.agent` and `merge.model`: one word
  (`EFFORT_LEVEL`). Absent: no level is passed, the agent's own setting decides (as today).
- **Passed to each run**: Claude Code `--effort <level>`, Codex `-c model_reasoning_effort="<level>"`
  (as `codex.ts` starts a workspace's turn). A level the merger's agent does not list is not
  passed, as Scout's (fix/scout-effort-level): the project's file may name another agent's level.
  The resolve step's log says which: "Effort: high (merge.effort)", or "merge.effort is ultra,
  which Claude Code does not list: its own level".
- **Settings**: "Effort" in the Merger group, after its Instructions, on the same stepper as
  Scout's Effort (the merger's agent's levels, read where the stepper shows); saved in the config
  when the handle is let go. `GET /api/merges/efforts`, `POST /api/merges/effort { effort }`
  (null removes it), shaped as Scout's (`ScoutEfforts`, `ScoutEffortChange`).

## The stream (server)

- `GET /api/merges/log?id=<id>` → server-sent events, as the terminals' (V21): `line` for each
  line of the log from the first, then each line appended, while the page listens. The server
  reads the file from its last offset when its size changes (checked every 250 ms while a stream
  is open), so a merge made by another process streams the same way.
- No such entry: 404. An entry without a log (made before V46): 404 "no log", and the page keeps
  "Its output".

## The page (viewer: `Merge.tsx`, `merges.ts`, `MergeLog.tsx`)

- **Steps**, under the head (which is unchanged: the branches, the label, the actions, the
  state line, the title): Merge, Merger agent (when a conflict went to it), each check command,
  Land. Each with a mark (running, passed, failed, not run, waiting) and its time; a running
  step's time counts up, so a silence of 18 s still shows the merge is alive. The commands after
  a failed one are "not run", as `failedCheck` says today.
- **Log**: a read-only terminal (xterm.js, the agent terminal's chunk and dark colours, Geist
  Mono), fitted to the main area, every step's lines in order under a heading line
  ("── pnpm check ──"). It follows the end while the merge runs, unless the person scrolled up
  (xterm's own behaviour). A click on a step scrolls the log to its heading (an xterm marker).
  Text can be selected and copied.
  - The agent's lines: its start ("Claude Code 2.1.310 · sonnet"), thinking dim and italic after
    `∴`, a tool call `● Read docs/JOURNAL.md` and its result `⎿ 214 lines`, its text as written,
    then the time and tokens.
- **Files** (a resolution to review, and a conflict left to the person): the conflicting files,
  each with its regions' count and what its resolution did in a few words — the regions' flags
  put together ("Drops 3 lines from main", "1 line kept twice", "Keeps every line of both
  sides") — and its tone. A click shows that file's regions as today (`MergeRegionView`). The
  first file shown is the first that drops or doubles lines, else the first. A file not given to
  the agent (deleted on one side, a submodule, binary) is listed with why; when the agent said
  "needs you", every file is listed, none resolved.
- **Where each goes**: two tabs under the head, "Files" and "Log", when a merge has both; Files
  first on a resolution to review, Log otherwise. Without files, the steps and the log alone. At
  390 px the steps go above the log, and the files above the regions.
- "Its output" goes: the log has all of a failed check's output. Kept for an entry without a log.

## Verification

1. **Tests first** (red before):
   - CLI, the log: a clean merge (merge, each check command, land, in order, with times), a
     failed check (no step for the commands after it), a conflict resolved (the resolve step
     with the fake agent's events), Retry and Check again (a `run` line, the earlier lines kept),
     Remove (the log removed), a check's output in the log before its command ends (a fake
     `runCheck` that writes, waits, writes), the 1 MB cap.
   - `claudeMerger` on a recorded stream (from the spike's runs): its events, and the same answer
     and usage as today; the run again without `--thinking-display` when refused. `codexMerger`
     on recorded `exec --json` lines with `command_execution` and `reasoning` items.
   - The server: the lines so far, then those appended, by this process or another writer; 404s.
   - Viewer unit (pure): steps from log lines (marks, times, not run), the agent's events as
     terminal lines, each file's summary and the first file shown.
   - e2e (`merges.spec.ts`): a check that writes, waits, then writes: its first line is in the
     log while its step runs, then the step passes; the fake merger agent streams a thought and
     a tool call, seen before it answers; a resolution of two files: the list, a click shows only
     that file's regions. The existing merge specs pass.
2. **Nothing else changes**: the existing merger tests (prompt, answer, states, landing),
   `symbiote merge`'s output, the other e2e specs. No analysis code changes: no
   `regression-check`. The graph JSON is unchanged.
3. **Real use**: a real conflicting merge of this repository (one of the 22 above) in a
   throwaway clone, with the real Claude Code (`sonnet`) and this repository's check, through
   `symbiote view`: the log while it runs (screenshots), the thinking and tool calls seen, the
   files list. Tokens and time per run against V26c's (median 10.0K input tokens, 7–49 s), with
   summarized thinking on.
4. **Viewer**: `viewer-check` — the merge page running, on a resolution, failed and landed, at
   1440×900 and 390×844, dark and light, device scale 1; every other page checked for uneven
   spacing; first paint of History unchanged (xterm loads only on a merge page with a log).
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| `--thinking-display` is not documented and may change or go | Run again without it when refused; the log says so; the answer never depends on it |
| Summarized thinking costs tokens or time | Measured in the real use against V26c's numbers; dropped if it does |
| A check that writes megabytes | 1 MB per step kept (its start and end); measured here: 30 KB in all |
| A file written by one process, read by another | The size read every 250 ms while a page listens; tested with a second writer |
| The log's terminal hides the review | Files first on a resolution to review; the log a tab away |

**Order**: V46a first (the log, the stream, steps and the terminal: the check's output live,
which is most of the waiting), then V46b (the agent's process in it), then V46c (the files).

## Milestones

| # | Milestone | Output |
|---|---|---|
| V46a | A merge's log | The log file per entry, the git steps' lines, each check command's output as it comes, `/api/merges/log`, the steps and the terminal on the page |
| V46b | The merger agent's process | Claude Code's stream (thinking summaries, tool calls, text, usage) and Codex's events in the log; the fallback without `--thinking-display` |
| V46c | A resolution's files | The list of conflicting files with each one's summary; a file's regions; Files and Log tabs |
| V46d | The merger's effort | `merge.effort`, passed to Claude Code and Codex when listed; Effort in Settings' Merger group |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 313 | Where a merge's log is kept | **A JSON-lines file per entry in Symbiote's cache, beside the queue; not in `merges.json`** | The queue file is rewritten whole on every change and read every 1.5 s by every page; a file appended by whichever process merges is read by any |
| 314 | How the page gets it | **Server-sent events from the file's tail, as the terminals' streams** | Lines arrive as they are written; a `symbiote merge` in a terminal is followed the same way |
| 315 | What of the agent is shown | **Its thinking summaries, tool calls with their input, results by size, its text, and its time and tokens** | What it does and why, without the files it reads (up to ~100K tokens, V26c); the empty thinking blocks Claude Code sends by default show nothing |
| 316 | How the log is drawn | **A read-only terminal (xterm.js), steps beside it, following the end** | Asked "in a terminal"; it draws any project's colours and `\r` as the person's terminal does, with the agent terminal's look (question 2) |
| 317 | A resolution's files | **A list of the conflicting files, each with its regions' flags put together; a click shows its regions; the first shown is the first that loses or doubles lines** | 10 of the 22 conflicting merges here have 2–4 files; the reviewer's question per file is still "what was lost?" (chore-lost-feature) |
| 318 | Huge output | **1 MB a step: its first 64 KB and its end** | The start says what ran, the end what failed; 30 KB measured here |
| 319 | How much the merger thinks | **`merge.effort`, set in Settings; absent, the agent's own level** | Asked ("Add a merger effort in settings"). The model thinks when it decides to (0 thinking tokens on an easy region, 161–250 where the sides disagree): the person picks the cost |

**Questions for the person**, answered on 2026-10-24 ("1. Add a merger effort in settings. 2. Yes
3. Yes, recommendation. Ok"):
1. **How much thinking.** Keep the merger at its default, or add `merge.effort`? → `merge.effort`
   in Settings (V46d, decision 319).
2. **The log: a terminal or page text.** → A read-only terminal like the agent's (decision 316).
3. **A file's result: its regions, or the whole file too** (VS Code's diff, as V43)? → Its
   regions (decision 317).

**Not in V46 (later)**: `symbiote merge` printing the log as it goes; paths and links in the log
(V38); a log for merges made before V46; a file's whole merge in VS Code's diff (question 3); the
person's own Claude Code hooks run in the merger's `claude -p` (2 `SessionStart` hooks in every
spike run).

## As built (V46)

- **The size cap** (decision 318): a step's output is written as it comes up to 512 KB; past it,
  only its last 512 KB, written when the step ends, after a line saying how much was left out. An
  appended file cannot drop its middle later, so the plan's "its first 64 KB and its end" became
  "its start live, its end once done". This repository's whole check writes 30 KB.
- **An `end` closes only a step its process started**; a merge that throws (the queue's drain
  catches it) writes what it said and ends its step failed. Found reading the diff: such a step
  stayed open and was drawn "stopped".
- **The steps the page shows** come from the log, and two from the entry: while it checks, the
  commands not started yet are "waiting" (`check.commands`); after a failed one, the rest "not
  run", before a landing that followed (Approve after a failed check).
- **A `note` event** (`MergeAgentEvent`), drawn dim as the agent's start: the run again without
  `--thinking-display` says its thinking is not shown.
- **`unresolvable`** (`MergeEntry`, optional): the conflicting files not given to the agent and
  why (deleted on one side, a submodule, binary), so the Files list can say it per file. The
  entry's message is unchanged.
- **Files and Log are tabs only when the merge conflicted.** Files is shown first once a
  resolution is there to read (not while it runs); the person's pick then stays. The view not
  shown stays mounted, so the log keeps streaming. "Its output" stays for a merge made before V46.
- **The e2e's fake Claude Code speaks `stream-json`**: its start, a thought, a file read, the
  answer; with `E2E_AGENT_FLAG` it answers once that file exists, so a spec sees it at work. It
  answers `--help` with effort levels and records its arguments (V46d).
- **Settings' Effort editor is one for both** (`AgentEffort`): Scout's texts unchanged, the
  merger's its own; the Merger group lists Effort after Instructions.
- **`symbiote merge` reads the merger's levels too**, through the same finders as `symbiote view`.
- **The agent's JSON answer is counted, not printed** (decision 315, as built): its text streams
  as one dim line rewritten in place ("Writing its answer: 46,788 characters"). In the real run
  below the answer was 18.8K tokens of escaped JSON that buried the thinking above it, and its
  content is on Files, region by region with its notes. Text that is not the answer (prose before
  a tool call) is written as it comes; the log file keeps every piece.

**Results.** Tests first throughout, each red for the reason given. `pnpm check`: 1,449 tests;
build. e2e: **225 of 225** on the last full run. Two earlier full runs each had one failure, both
from V46: the V17 reviews spec read the list V46c replaced, and the V16/V17 spec's `{ name: 'Land' }`
also matched the landing's step button ("Land: passed", Playwright matches by substring) whenever
the log's line arrived first; the specs read Files and use exact names now. New: 13 log tests in the merger's and 7 of the log file, 3 agent-stream tests on a
recorded Claude Code 2.1.310 stream, the routes', 17 viewer unit tests (steps, the terminal's text,
files), 3 e2e (a check's output while it runs; the agent's thought and file read while it works;
two files), the Merger's Effort in Settings.

Real use, `e380fef` (feature/skill-creator into main: README, JOURNAL, PLAN and an e2e spec
conflicting, 5 regions) replayed through `symbiote merge` in a throwaway clone with the real
Claude Code (`sonnet`, its default effort) and a conflict-marker check:

| What | Measured |
|---|---|
| The resolution | Equal to the committed merge (`git diff e380fef <merge>` empty) |
| The run | 85 s; 27.0K tokens in, 18.8K out (its prompt 50,988 characters; V26c's median was 10.0K in, 7–49 s, on smaller conflicts) |
| Its thinking, shown | 58 pieces, 703 characters of summary, the first 4.0 s after its start |
| Its tools | none: the regions were enough |
| Its log | 2,404 lines, 2,333 of them the answer's pieces |
| The page | Files: 4 files, each with its words; Log: the steps, the thinking, "Writing its answer: 46,788 characters", the time and tokens, the check |

Whether summarized thinking costs output tokens was not measured on this merge (one run). On the
spike's small conflict, at the same effort: 475 output tokens without it, 516 with (243 and 250
thinking): within a run's spread.

Found, not V46's: the review's "kept twice" (the merge page remake) flagged correct resolutions
on this merge — `JOURNAL.md` "2 lines kept twice", `PLAN.md` "10": both sides added an entry with
its own `**Learned**:` and table lines, and keeping both counts as doubling. Files shows the
regions' flags put together, so it shows them too. A fix of its own.
