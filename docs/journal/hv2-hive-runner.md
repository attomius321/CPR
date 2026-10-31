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
