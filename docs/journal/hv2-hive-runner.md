# Journal: HV2 — Hive's runner and record

[Index](../JOURNAL.md) · [Plan](../plan/hv2-hive-runner.md)

## HV2 plan — Hive's loop on Symbiote's own pieces (2026-10-31, branch `feature/hv2-hive-runner`)

Read HV1's answer and its prototype's `loop` mode, then the pieces HV2 must drive instead of
`claude -p`: `workspaces.start` and `launch` (a `claude --bg` session with Symbiote's hooks),
`reply` (a session resumed, an idle live one stopped first), the thread's `prompt` and `report`
entries (`turnEnded`), `agentState`, the merger's `checkOf` and `runShell`, and the merge queue's
pid lock. The person answered the plan's five questions as recommended.

**Learned**:
- **Symbiote already records every turn's end.** The `Stop` hook writes a `report` after the
  `UserPromptSubmit` hook's `prompt`, the first prompt included. The runner needs no signal of its
  own; it must only wait until its own message is in the thread, or the previous turn's report
  reads as this turn's end.
- **`--bg` sessions outlive `symbiote view`**, unlike the prototype's `-p` children, which a resume
  had to kill. A restarted runner waits for a writer still working; only a check, a child of the
  view, can be orphaned.
- **This repository's check takes minutes**: 396 s for the HV1 merge (install, check, build, e2e).
  Running it in the workspace's worktree saves an install a round.
- **Decisions up to 651 are taken**, on `main`, every branch and every worktree; HV2 and 652–658
  were free.

## HV2 — Hive's runner and record, built (2026-10-31, branch `feature/hv2-hive-runner`)

A workspace started while Hive is on is Hive's: `hive: true`, its step in
`symbiote/hive/<branch>.json`, a `{hive}` line in its first prompt. `symbiote view`'s runner reads
its writer's turns from the session list and the hooks' thread, runs the project's check in the
worktree after each, sends failures back with `reply` for up to 3 rounds, and asks the person to
land it. Hive off stops Hive's writers and checks and keeps each step; on again, or a new runner,
goes on from there. Decisions 652–658.

**Learned**:
- **A turn's end needs Hive's own message in the thread first.** Right after Hive sends a message,
  the session still reads as finished and the last report is the turn before's. A turn counts only
  once the thread's last prompt is at least as new as the step's start; the tests' fake writes that
  prompt from its hooks, as Claude Code does.
- **A killed check is no result** (HV1's trap again): a check stopped by Hive off, a message, or the
  view closing records nothing and keeps the step; only a check that ran to its end is a round.
- **Hive off must stop what works then, not at every look.** The person may talk to a Hive
  workspace's agent while Hive is off; stopping every live writer at each tick would cut those
  turns. The writers working when Hive turns off are stopped once (a failed stop retried).
- **Hive off could have cost two git runs every 10 s** (`reviewPlace`, and `ls-files` for a tracked
  `hive.json`). A runner that never saw Hive on now `stat`s `hive.json` and reads the switch only
  when the file changed; `POST /api/hive` tells it at once.
- **Card text is not Markdown**: the stuck note first quoted the command in backticks, which the
  card showed as they were. The card's words are plain; the message to the agent keeps its code.
- **Hive's words are Symbiote's**: a working card puts the agent's mark before what the agent does;
  "Hive: running the check" got Claude's mark until `WorkspaceNext.hive` left it out.
- **The e2e fake records a stop before Hive writes the record**: the spec polls the record, not
  the stop.
