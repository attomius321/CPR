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
