# HV2 — Hive's runner and record

[Index](../PLAN.md) · [Journal](../journal/hv2-hive-runner.md)

**Status:** built, ready for review (2026-10-31), on branch `feature/hv2-hive-runner` (the
workspace's, from `main` at `6250957`); the person's OK on the plan ("Ok, go for it"), with the
recommended answers to its five questions. The real run went from its start to landing asked, in 3
rounds, through a killed `symbiote view` and a Hive off and on (see Results).

**Problem** (the brief: "Build HV2, the first Hive milestone the HV1 spike proposed"). Hive mode
(V82) is a switch and a look: `symbiote/hive.json` turns on the ink and crimson and nothing else.
HV1's prototype (`spikes/hive-agentic-graph/hive.mjs`) drove `claude -p` sessions in a scratch
folder; none of Symbiote's own pieces ran under it: `claude --bg` workspace sessions, their hooks
and thread, the check the merger runs.

| Fact | Measured |
|---|---|
| This repository's check (`merge.checks`: install, check, build, e2e) | 396 s, its last run (the HV1 merge, `merges.json` in the cache) |
| A turn's end, as Symbiote reads it | the `Stop` hook's `report` in `symbiote/threads/<branch>.jsonl`, after the `UserPromptSubmit` hook's `prompt` (V18c) |
| `claude agents --json --all` | about 150 ms, read at most every 2 s and shared by the workspaces, Nucleus and Scribe (V18) |
| Decisions in use, on `main`, every branch and every worktree | up to 651; HV2 unused |

**Goal**: while Hive is on, every workspace started gets `hive: true` in its record and Symbiote's
runner in `symbiote view` drives it: the writer works the brief, Symbiote runs the check after each
turn and sends failures back, then asks the person to land it. Hive off stops every Hive agent and
keeps the step; Hive on again, or a restarted `symbiote view`, resumes at that step.
**Unchanged with Hive off**: start prompts byte for byte, workspace records, nothing written under
`symbiote/hive/`, and the runner makes no agent call.

## The record (decision 652)

`symbiote/hive/<branch>.json` holds a Hive workspace's step, `<branch>.jsonl` its events (the
branch's slashes as folders, as the workspace records). Beside the workspace records, in the main
checkout's `symbiote/` (git-ignored, decision 621's place) or in Symbiote's cache where the reviews
are kept. Written whole after each step (`writeFileWhole`). In HV2 a goal is one workspace
(decision 649), so the goal is named by its branch; HV7's goals of several workspaces get names of
their own.

```json
{
  "branch": "feature/x",
  "step": "checking",
  "round": 2,
  "rounds": 3,
  "since": "2026-10-31T12:00:00.000Z",
  "interrupted": true,
  "check": { "pid": 4242, "started": "…" },
  "checks": [{ "round": 1, "at": "<sha>", "ok": false, "ms": 381000, "failed": "pnpm check", "output": "…its last lines" }],
  "checked": "<sha>",
  "message": { "key": "hive.check", "text": "…", "at": "…" }
}
```

The workspace record gains `hive: true` (`workspace-record.ts`), read back only when it is `true`.

## The loop (decision 653)

`packages/cli/src/hive-runner.ts` (the record and events: `hive-record.ts`). It reads what a
workspace's card reads: the sessions (`claude agents`, shared, at most every 2 s) and the thread's
end. It ticks every 2 s while Hive is on; while Hive is off, it reads only `hive.json`.

| Step | What Hive does |
|---|---|
| `writing` | Waits for the writer's turn to end, counted only once the thread's last prompt is newer than the step's `since` (Hive's own message must have arrived). A turn that ended with commits since the base and a clean worktree → `checking`. Files not committed, or no commit at all → `hive.commit`. Anything else (working, a question, a plan waiting for the person's OK, stopped by the person, failed) waits: those are the person's. |
| `checking` | Runs the check (decision 654) in the worktree, in a process group of its own. Passed → `landing`. Failed → `reply` with `hive.check`, round + 1, `writing`; after round 3 → `stuck`. No check found → `landing`, with a note. A prompt that reaches the writer meanwhile (the person took over) stops the check → `writing`, the rounds counted again. |
| `landing` | Asked of the person: Approve, then Merge into, as for any workspace (V17, V26). Merged into the default branch → `landed`. A message the writer gets (the person's, a verdict sent) → `writing`, the rounds counted again. New commits since the check, the writer not working → `checking`. |
| `stuck` | Waits for the person. A message the writer gets → `writing`, the rounds counted again. |
| `landed` | The end. A workspace cleaned up (`finished`) is left alone at any step. |

Every message Hive sends is written in the record first (`message`), then sent with
`workspaces.reply` (its refusals, its stop of an idle live session, the settings file rewritten). A
restart that finds a message the thread never got sends it again.

## The check (decision 654)

- **What**: `merge.checks`, else the command guessed from the branch's tip, after the package
  manager's install (the merger's `checkOf`, moved to `check.ts` and shared).
- **Where**: the workspace's worktree, on a clean tree, after the writer's turn: its own
  dependencies, no second install (the person's answer to question 3).
- **How**: a shell in a process group of its own (`detached`), so Hive off and a resume can kill it
  whole; its pid in the record; the 60-minute timeout of the merger's check. The record keeps the
  last lines of its output, as the merger's entry does.
- **Rounds**: 3 (decision 651); a failure's command and last lines go to the writer.

## Hive off, Hive on, a restart (decision 655)

- **Off**: each Hive workspace's live session is stopped (`claude stop`) and its record marked
  `interrupted`; a running check's process group is killed. The step stays. A stop that fails is
  tried again at the next tick while Hive is off.
- **On, or a `symbiote view` started again**: Hive reads what the session shows before it acts.
  - The turn ended meanwhile (the person sent a message while Hive was off, say): the step goes on.
  - The writer was stopped mid-turn: `hive.resume`.
  - A check marked running: its process group is killed if it outlived its runner, and the check
    runs again.
  - A writer still working: Hive waits for it. `--bg` sessions are Claude Code's and outlive
    `symbiote view`; a restart never stops them.

## One runner per repository (decision 656)

A pid lock, `symbiote/hive/runner.lock`, as the merge queue's (`merge-queue.ts`). Another
`symbiote view` of the repository reads the records (its cards) but drives nothing; it takes over
at its next tick when the holder is gone. `POST /api/hive` tells this process's runner at once; a
change another process makes is read at the next tick.

## Start

`workspaces.start` with Hive on: `hive: true`, the start prompt's `{hive}` line, and the runner
takes the workspace at `writing`, round 1, `since` its creation. Nucleus's `start_workspace` goes
through it too. Claude Code only (decision 658): a start that picks Codex or Hermes while Hive is on
is refused (409), "Hive drives Claude Code only: pick Claude Code, or turn Hive off"; with no agent
picked, Claude Code is the one, and a start without Claude Code installed is refused. The writer's
permission mode is the one picked on the Start page (no `bypassPermissions`): a writer that asks
permission waits for the person.

## Prompts (decision 657)

New keys in a Hive group of Settings → Prompts, listed only while Hive is on:

| Key | Symbiote's text (as planned) | Placeholders |
|---|---|---|
| `hive.start` | What `{hive}` becomes: "Hive drives this workspace. When you end a turn with commits, Symbiote runs the check ({check}) on the branch's tip and sends you its failures, up to {rounds} rounds; once it passes, the person reviews the branch and lands it. Commit everything before you end a turn, end it only when the work is done or you need the person, and never push, merge or switch branches." | `{check}`, `{rounds}` |
| `hive.check` | "Symbiote ran the check on {branch} at {at} (round {round} of {rounds}): `{command}` failed. Its last lines: … Fix the cause, run the check yourself, commit, and end your turn." | `{output}` (required), `{command}`, `{at}`, `{round}`, `{rounds}`, `{branch}` |
| `hive.commit` | "You ended your turn with {what}. Commit your work on {branch}, or remove what does not belong, then end your turn." | `{what}`, `{branch}` |
| `hive.resume` | "You were stopped mid-turn: Hive was turned off, and is on again. Continue where you stopped, commit, and end your turn when the work is done." | none |

`{hive}` joins the start prompts' placeholders. Symbiote's start prompts hold it on a line of its
own; for a workspace not Hive's, that line goes with the blank line after it, so the prompt is
today's byte for byte. A project's own start prompt without `{hive}` gets the Hive text at its end,
as `{documents}` does (V40).

## The viewer

- **The state**: `WorkspaceSummary.hive?` (core types only; no graph JSON change): the step, the
  round, the last check, `paused` while Hive is off.
- **The card and the workspace's head** (`workspaceNext`, pure and unit-tested): "Hive: running
  the check (round 2 of 3)"; "Checked: review and land it"; "Hive stopped: the check failed 3
  times"; "Hive off: paused"; a writer's own states as today. A small Hive mark on a Hive card.
- **Start**: a line under the agent while Hive is on; Codex and Hermes off, with the reason.
- **Settings → Hive mode**: what Hive does now, in place of "Hive is not built yet".
- **Settings → Prompts**: the Hive group, only while Hive is on.

## Verification

1. **Unit, red first** (`packages/cli/test/hive-runner.test.ts`, the fake `ClaudeCode` of
   `workspaces.test.ts`, real temp repositories, a real check command):
   - the happy path to `landing`, then `landed` once merged;
   - a failing check: the message sent with its output, round 2, the cap, `stuck`;
   - files not committed: `hive.commit`;
   - Hive off mid-writing: the stop called, `interrupted`; on again: `hive.resume`;
   - Hive off mid-check: a real `sleep` process group killed; on again: the check run again;
   - a killed runner (dropped with no cleanup) with its check still running: a new runner kills the
     orphan and runs the check again; with its writer working: the new runner waits, no stop, no
     message;
   - the person's message at `landing` → `writing`, the rounds counted again;
   - the lock: two runners, one drives;
   - **Hive off = `main`**: the record and the prompt equal today's, no `symbiote/hive/`, no
     `sessions()` call from the runner.
2. **Prompts**: `{hive}` filled for a Hive workspace, its line gone otherwise, added at a project
   prompt's end; the keys in Settings' list.
3. **e2e** `hive-loop.spec.ts` (the suite's fake `claude`, a `merge.checks` script that fails once):
   Hive on, Start, a commit and a report, the check fails, Hive's message reaches the fake, the fix,
   "Checked: review and land it"; Hive off mid-turn, the stop recorded, Hive on, the resume sent;
   the Prompts' Hive group only while Hive is on.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`; the `viewer-check` skill on the sidenav's cards, a
   workspace, Start and Settings (Hive mode, Prompts), Hive on and off, both themes.
5. **A real run in this repository**: this branch's `symbiote view --no-open` on the main checkout,
   Hive on, one small Claude Code workspace from Start to "landing asked"; mid-run `symbiote view`
   killed with SIGKILL and started again; Hive off at the end. The workspace stays for the person to
   land or clean up. It writes main's `symbiote/` (the person's yes).

**Risks**

| Risk | Mitigation |
|---|---|
| A turn's end read too early: before Hive's message reached the session, the last report is the previous turn's | Counted only once the thread's last prompt is newer than the step's `since` |
| The check runs while the person works in that worktree | Only on a clean tree, after a turn; a message to the writer during a check stops it |
| A message lost in a crash, or sent twice | Written in the record before it is sent; sent again only when the thread never got it |
| Two views drive one repository | The pid lock |
| A check that never ends | The merger's 60-minute timeout; Hive off kills it |

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV2a | The record and the runner | `hive-record.ts`, `hive-runner.ts`, the shared check, `workspaces.start`, `summary.hive`, `symbiote view`'s wiring |
| HV2b | Hive's prompts | `{hive}`, `hive.start`, `hive.check`, `hive.commit`, `hive.resume` |
| HV2c | The viewer | the cards, the head, Start, Settings; `hive-loop.spec.ts` |
| HV2d | Docs and the real run | `configuration.md`, the README, As built, the journal; one real Hive workspace to landing asked |

**HV1's decisions as HV2 applies them** (the person's OK): 646, the runner in `symbiote view`, is
built; 647 is made concrete by 652; 649, one workspace a goal, holds; 651's gates (landing, pushing,
deleting unmerged work stay the person's) and its 3-round cap hold. 648 and 650's running reviewer
come in HV3 (the person's answer to question 1); usage read before each start in HV5; new plans and
merges of `main` in HV7.

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 652 | Where a Hive workspace's state lives | **`symbiote/hive/<branch>.json` and `<branch>.jsonl` (events) beside the workspace records, written after each step; `hive: true` on the workspace record; in HV2 a goal is one workspace, named by its branch** | Decision 647, concrete: the records' place and naming; one workspace a goal (649) |
| 653 | What drives a step | **The writer's session and thread as the card reads them, polled every 2 s while Hive is on: `writing` → `checking` → `landing` → `landed`, `stuck` at the cap; a turn's end counted only after Hive's message arrived; the person's message at `landing` or `stuck` starts the rounds again** | No new signal to keep: the hooks already record every turn; the sessions' list is read at most every 2 s and shared |
| 654 | The check | **`merge.checks`, else the merger's guess, run by Symbiote in the workspace's worktree on a clean tree after a turn, in a process group of its own; its failure's command and last lines sent with `reply`; 3 rounds, then the person** | The person's answer: no second install (this repository's check: 396 s); HV1: the check stays the last word |
| 655 | Hive off, on, and a restart | **Off: Hive's sessions stopped, a check's group killed, the step kept (`interrupted`); on or a restart: what the session shows first — a turn ended goes on, a stopped writer gets `hive.resume`, a check runs again; a restart never stops a `--bg` session** | HV1's trap: a killed call is not a finished step; `--bg` sessions outlive `symbiote view` |
| 656 | Who drives | **One runner per repository, by a pid lock beside the records; another view reads only** | Two `symbiote view`s of one repository share its `symbiote/`; the merge queue's lock (V26) |
| 657 | Hive's prompts | **`{hive}` in the start prompts (its line gone when not Hive's, the text added at a project prompt's end), and `hive.start`, `hive.check`, `hive.commit`, `hive.resume` in a Hive group listed only in Hive mode** | The person's answers: new keys in a Hive group; a `{hive}` line only for Hive workspaces; Hive's settings only in Hive mode |
| 658 | Which agents Hive drives | **Claude Code only; a start that picks Codex or Hermes while Hive is on is refused (409); the writer in the permission mode picked, no `bypassPermissions`** | The brief: Claude only for now; "every workspace started while Hive is on" stays true; the person's answers to questions 2 and 4 |

**Not in HV2 (later)**: the running reviewer and its Settings (HV3, Opus at high effort by
default); the graph, new plans and merges of `main` (HV7); usage read before each start (HV5);
Codex in any Hive role.

## As built (HV2)

- **The runner reads, the workspaces act.** `hive-runner.ts` asks `workspaces.ts` for one
  workspace's summary (`summaryOf`, new: the list's `summary` for one branch), and sends and stops
  through `reply` and `stopAgent`, so Hive's messages take the person's path (an idle live session
  stopped, then resumed; a turn at work refused and tried again at the next tick).
- **Messages in the tick, checks beside it.** A message is sent inside the tick that decides it;
  only a check runs in the background, one per workspace, watched each tick for a message that
  stops it (the person took over).
- **Hive off stops what works at that moment, once.** Stopping every live Hive writer at each tick
  while Hive is off would stop the person's own turns (they may talk to the agent while Hive is
  off). Hive off marks the writers working or waiting when it turns off, stops them (a failed stop
  is tried again at the next tick), and then does nothing until Hive is on again.
- **Hive off costs a `stat`.** A runner that never saw Hive on reads `hive.json`'s time every 10 s
  and reads the switch (two git runs) only when the file changed; `POST /api/hive` tells it at
  once. Measured by test: off, three ticks read the switch once and list no session.
- **A spike that ends without commits goes to the person** with no check: its answer is its report,
  and its start prompt says to commit nothing.
- **The card's words** (`workspaceNext`): "Hive: reading its turn" in the seconds between a turn's
  end and Hive's next look, so the card never says "Ready for review" for a turn Hive has not read;
  "Hive: running the check" without the round, which the facts give (a hexagon and `2/3`, or `off`)
  — the planned "(round 2 of 3)" wrapped on the 300 px sidenav; no agent's mark before Hive's
  words; a review or a verdict at `landing` says what is next as for any workspace; the stuck note
  in plain words (the card is not Markdown).
- **Start with Hive on** offers Claude Code only, and says what Hive does; the request is refused
  for Codex and Hermes by the server as well (409).
- **The Hive mode page and its question** say what Hive does now, in place of "not built yet".
- **An event's time is its own.** The real run's first `check-started` event read
  `"at": "72ed10b…"`: its data's `at` (the commit) replaced the event's time. The data says
  `commit` and `prompt` now, and `hiveEvent` keeps its `at` and `kind` whatever the data holds
  (fixed on the branch, `311e0ec`, with a test).

**Results.**

- **Tests**: `hive-runner.test.ts` 13 (the happy path to landing, then landed; the cap; work not
  committed; a spike; plan first; Codex refused; a lost message sent once; Hive off mid-turn and
  mid-check, then on; a turn the person finished while Hive was off; a killed runner's orphaned
  check; the lock; Hive off = `main`); prompts 4; the viewer's card words and facts 4, Settings'
  Hive group 1. The 48 start prompts recorded from `main` before V28 still match byte for byte.
  `pnpm check`: 2,549 tests. e2e: 363 viewer and 20 nexus passed (before the last card fix; the
  Hive, Settings and Start specs, 42, after it); `hive-loop.spec.ts` green 3 runs in a row.
- **The real run** (this branch's `symbiote view` on the main checkout, a cache of its own; a chore
  to correct the stale "about 2.5 min" above `CHECK_TIMEOUT_MS`; Claude Code in `auto`):

  | Time (UTC) | What happened |
  |---|---|
  | 09:41:47 | Started: `hive: true`, Hive's record at `writing`, round 1 |
  | 09:43:39 | The writer's turn ended (1 min 52 s), one commit, `72ed10b`: the check started |
  | about 09:44:42 | `symbiote view` killed with SIGKILL during `pnpm check`; its check's group outlived it, its lock left behind |
  | 09:44:45 | The view started again; at 09:44:46, the lock taken over, the orphaned group (pid 61464) killed, the check run again |
  | 09:51:32 | The check failed after 406 s: 2 e2e tests of 361 (`intro.spec.ts`'s lost WebGL context, `merges.spec.ts`'s conflict), not touched by the change |
  | 09:51:34 | Its command and last lines sent to the writer: round 2 (2 s after the check) |
  | 09:57:41 | The writer's turn ended: it ran the whole e2e itself (381 of 381 passed, 5.4 min), judged the two flaky under load (load average about 9) and made no commit. Its commit still ahead, Hive ran the check again |
  | 10:00:12 | The person turned Hive off from their own `symbiote view` (`main`'s build) |
  | 10:00:14 | The runner killed the check (2.5 s later, its next look) and kept the step: `checking`, `interrupted`; the card "Hive off: paused before the check" |
  | 10:15:19 | The person turned Hive on again (asked first): the runner ran round 2's check again |
  | 10:22:04 | It failed after 405 s on one e2e test, `intro.spec.ts:52` (the intro's animation timed against the wall clock), under a 15-minute load average of 11; round 3 sent 2 s later |
  | 10:30:54 | The writer's turn ended: the intro spec 5 times (45 of 45) and the whole check (448 s) passed for it; no change, no commit. Hive checked again |
  | 10:37:56 | The check passed (422 s): **landing asked**, the card "Checked: review and land it", ⬡ 3/3 |
  | 10:38:24 | Hive turned off again; the view stopped with Ctrl+C, its lock released |

  The runner used 22 s of CPU in 54 minutes, 174 MB. Another workspace ran its own Playwright
  suite during rounds 2 and 3 (load average up to 22).
- **Each round runs the check twice**: the writer runs it before it ends a turn (its prompt and
  the project's instructions say so), then Symbiote does. Here that is about 6.5 minutes each.
- **A flaky check costs rounds**: rounds 1 and 2 failed on e2e tests the change cannot reach (a
  different test each time; all pass alone and in the writer's own full runs). The writer's answer
  (run them again, change nothing) and Hive's rule (a turn that ends with commits ahead is checked)
  tried again without a change, and round 3 passed. Under a busy machine the last round was near:
  one more flaky run would have stopped it for the person.
- **Not verified**: landed after a real merge (the workspace waits for the person); a writer
  stopped mid-turn by a real Hive off (the writer was between turns at 10:00); a real stuck
  workspace. Each is covered by the tests with the fakes.
- **A second `symbiote view` rewrites `symbiote/claude-settings.json`** with its own build's hook
  path; the person's view writes its own back at its next list. Both record the same thread.
- **A check run again says why.** The real run's events went `off`, `check-stopped`, then a bare
  `check-started` when Hive came on again; an `on` event comes first now (`cc38a36`).
