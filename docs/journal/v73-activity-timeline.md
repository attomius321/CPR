# Journal: V73 — The Activity tab as a timeline of phases

[Index](../JOURNAL.md) · [Plan](../plan/v73-activity-timeline.md)

## V73 spike — what the Activity tab draws, and what agents' records hold (2026-10-28, branch `feature/workspace-activity`)

Read: the tab (`ActivityTab.tsx`, `timeline.ts`, V48c), the recording (`thread.ts`
`activityEntry`, `codex-run.ts`, `codex.ts` `serverTools`), the thread's read
(`workspaces.ts` `thread`). Measured: the person's 32 activity files in `symbiote/activity/`
(5,398 calls), the 79 Claude Code transcripts of Symbiote's worktrees (15,628 shell commands, their
results), Claude Code 2.1.312's hook schema (in its binary).

**Learned**:
- **Commands are three quarters of the rows**: 4,007 of 5,398 calls are `Bash`; each is its own
  row today. 852 start with `cd /home/…`. The rest: `Read` 544, `Edit` 269, `TaskUpdate` 177,
  `Write` 158, `TaskCreate` 105.
- **The whole command is not recorded**: 1,783 commands (44 %) were cut at 160 characters. Of the
  transcripts' commands, the median is 238 bytes, p90 1,808, p99 7,904: 8 KB keeps 99 %.
- **Claude Code sends more than Symbiote keeps**: `PostToolUse` has `tool_response` (Bash:
  `stdout`, `stderr`, `interrupted`, `backgroundTaskId`, `returnCodeInterpretation`; Edit and
  Write: `structuredPatch` hunks) and `duration_ms`; `PostToolUseFailure` has `error`,
  `is_interrupt`, `duration_ms`. A failed command's error begins "Exit code N" (to confirm on a
  real run).
- **Agents describe their commands**: 95.5 % of Bash calls carry a `description` ("Run full
  check"): the timeline's words, without reading the command.
- **Test summaries are at the end**: 1,261 of 1,863 test runs (68 %) print their counts in their
  output's last 2 KB; outputs' median is 835 bytes, p90 5.6 KB.
- **Tasks name the work**: `TaskCreate`'s input has `subject`, its response `{ task: { id } }`;
  `TaskUpdate`'s input `taskId` and `status`.
- **Runs alone make too many phases**: a first cut (consecutive calls of one kind) gave a median
  of 48 groups for 146 calls, 100 for 323. Agents read between edits and take screenshots in the
  middle of implementing: reads between edits must stay in the edit's phase.
- **The hooks run `main`'s build**: `symbiote/claude-settings.json` runs
  `/home/anton/projects/Symbiote/packages/cli/dist/agent-hook.js`; the new fields reach the
  person's workspaces once merged and built. A real agent's check needs settings of its own.

## V73 — the Activity tab as a timeline of phases (2026-10-28, branch `feature/workspace-activity`)

Built as planned in four parts: the hook and Codex record each call's whole command, its
description, duration, exit code, output's end and an edit's lines (V73a); the viewer groups the
events into phases between milestones, pure and tested (V73b); the tab draws them on a timeline
with a live strip, groups that open to their events and events to what was recorded, and the raw
stream (V73c); e2e specs, real records and a real agent (V73d). Decisions 513–518.

**Learned**:
- **Runs of one kind are not phases.** Agents read between edits, run a test as they implement and
  look at a screenshot between tweaks: runs gave 48 phases for 147 calls. "Sandwich" rules (a phase
  takes what little lies between two of its runs) brought it to 27; a failed test is never taken
  in, so failures stay visible.
- **Piped test runs exit 0.** Agents pipe checks to `tail` (`pnpm check 2>&1 | tail -20`): the
  exit is the pipe's. The real run's first `npm test` failed with exit 0; the runner's printed
  counts decide instead.
- **Claude Code refuses edits under `~/.claude`** ("a sensitive file") in `-p` mode with
  `acceptEdits`: the first real run, in the job's folder, recorded two Edit starts with no end.
  The tab says "No end recorded" for them. The second run used a folder under `/tmp`.
- **`--allowedTools` takes the rest of the line**: `claude -p --allowedTools "Bash Edit" "the
  prompt"` read the prompt as a tool. The prompt goes on stdin.
- **A CSS `::before` separator is not text**: Playwright's `toHaveText` and screen readers missed
  the "·" between a summary's parts. They are spans now.
- **The fake agent reads `ready` once its thread ends in a report**: a screenshot of a live strip
  needs a new prompt (the `UserPromptSubmit` hook) and calls timed after it.

**Verification**: tests first, red for the right reason (the hook's fields, Codex's, the read
window, classification, grouping, statuses, test summaries, words, the live state). `pnpm check`:
2,067 tests. e2e: 332 of 332 (5.0 min), the four new Activity specs among them. Real records: 33 workspaces, 5,675 calls, median rows 37 against 143
on `main`. A real Claude Code 2.1.312 run (haiku) through this branch's hook, drawn in the tab.
Screenshots before and after (dark, light; 1440 and 760 px).

Not verified: real Codex and Hermes runs; a session filling the 1 MB window; the desktop app.

## V73 — main merged in: V72's page frame (2026-10-28, branch `feature/workspace-activity`)

`main` took V72 (one page frame: 16 px margins and insets, 48 px card heads) while V73 was built.
Merged into the branch: only `docs/JOURNAL.md` conflicted, both sides having appended to it (V72's
lines first, then V73's). The Activity tab's bar, live strip and timeline take V72's
`--card-pad` for their insets instead of a 16 px of their own.

**Verification**: `pnpm check` (2,067 tests), `pnpm build`, e2e 335 of 335 (V72 added three).
Screenshots again on the merged build, dark and light, 1440 and 760 px: the tab in V72's card, the
panel head's "Running pnpm check 2>&1 | tail -20" without the worktree's `cd`.
