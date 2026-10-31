# Hive's live progress — journal

[Plan](../plan/hive-live-progress.md) · [Index](../JOURNAL.md)

## Hive's live progress, plan (2026-10-31)

**Learned.** Hive's records of this repository: 7 checks of `pnpm install --frozen-lockfile`,
`pnpm check`, `pnpm build`, `pnpm test:e2e`, 405–449 s each; one running review, 124 s, 18 tool
calls, its stream 234 KB in 140 lines, written only once the reviewer ended. The running check's
`started` is rewritten at each command, so the check's own start is not recorded. The merge log
(V46a, V46b) already has what a live check and review need: a JSON-lines log with steps, bounded
output, the agent's events from Claude Code's stream, a server-sent stream and a terminal view.
The runner writes a record whole from several paths of one process; a write from a copy read
earlier undoes the tick's (decision 694).

Hive's runner answers a plan-first workspace's turn with no commit by "no commit on <branch>": it
does not know about plan-first workspaces. Left for the runner's fix.

**Verification.** Planned: see the plan.
