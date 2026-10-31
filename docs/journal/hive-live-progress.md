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

**Verification.** Planned: see the plan.

## Hive's live progress, built (2026-10-31)

**Learned.**
- A plan-first workspace's turn is not one Hive acts on: its writer's state is `plan-ready`, not
  `ready` or `done` (`hive-runner.test.ts`, "a plan first waits for the person"). The plan's first
  version said Hive would answer it with "no commit"; it does not.
- The tick writes nothing on a branch whose check its runner runs: it only watches for the person's
  message. The check's per-command write from an old copy undid nothing in practice; it is guarded
  now all the same (decision 694).
- A real reviewer's last call is `StructuredOutput`, its whole answer as input: shown as what it
  runs, the card would have said JSON. Found by running a real kept stream through the new code.
- Claude Code's `-p` stream without partial messages gives the reviewer's words and thinking
  whole, in `assistant` messages; the merger's `claudeLine` read only their deltas.
- Every card's state line is one line, cut at its end: a Hive card says its step and time on one
  line and the command on the next, so the time is never the part cut.
- The merge log's view was bound to a merge's entry by two things only: its address and which
  states run. `StepLog` takes those; the merge log is its first user, unchanged in its e2e.
- A view kept across two logs keeps the first's lines unless it resets them (found by e2e).

**Verification.** Tests first for the runner (several commands, one, a failed one, the expected
time and its absence, no check found, a running review, a write kept between two commands), the
log stream, the reviewer's events and the viewer's words; then e2e with real shell commands and a
fake reviewer that holds. The card's read of a 905 KB review log: 4.2 ms, then 0.33 ms. Screenshots
in both themes at 1×. `pnpm check` (2,663 tests), `pnpm build` and `pnpm test:e2e` (373 and 20) pass. Not
done: a real Hive run of this branch (the plan's As built says why).
