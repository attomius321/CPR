# Journal: MC3 — One Confirm for many actions, mark merged, and the gaps Nucleus hit

[Index](../JOURNAL.md) · [Plan](../plan/mc3-mcp-batch-confirm.md)

## MC3 spike — what Nucleus's 15 workspaces asked of the person (2026-11-11, branch `feature/mcp-batch-confirm`)

Measured, read only, on the person's records: `symbiote/nucleus-activity.jsonl` (4.2 MB, 5,115
lines since 2026-10-30), the running view's `/api/workspaces`, `scripts/plan/mark-merged.mjs`
without `--write` on `main` at `bc24845`, and the transcripts of feature/v99's agent and
fix/ci-green's. The mockup of the batch Confirm was drawn over a real `symbiote view` of this
branch's build, in both themes at 1x (`packages/viewer/coverage/mc3-mockup/`, not committed).

**Learned**:
- **Starts come in runs**: since 2026-11-09, 23 Confirms, 21 of them starts; five runs of 2 or 3
  starts, 9–71 s apart. No call was refused by the one-ask-a-caller rule: Nucleus waited for each
  answer before the next ask.
- **Every lapsed Confirm was wanted**: 5 have lapsed since MC1, all starts; each time the person
  came back and typed "again" (or "Try again", "Start again") 15, 16, 18, 19 and 607 minutes
  after the ask. Claude Code ran each held call as a background MCP task, so Nucleus said "nothing
  was done; ask again?" in its own terminal, where the person was not looking.
- **Neither Approve queues**: the page's Approve records the verdict only (V17, V26); the person's
  **Merge into** press queued V100 3 s later. Through the MCP the same two steps were two
  Confirms (`finish_review` at 21:34:27, `queue_merge` at 21:34:35 for spike/graph-usability).
- **The merger never needed a workspace**: `queue_merge` refuses a branch only for want of an
  approval (`merge-targets.ts`); Nucleus read two pushed refactor branches as "not workspaces, so
  nothing ever queued them" and started a workspace to merge them.
- **`needsYou` was all merged workspaces**: 9 of its 9 entries, each `ready` and merged. The
  page's inbox leaves them out: they are in the Done group (`mergedForCard`).
- **"Interrupted" was a guess**: `start_workspace` answered feature/v99 as `needs-you`,
  `interrupted` at 21:43:13.462, 0.3 s after its prompt was recorded and 0.4 s before the session's
  first request. Claude Code lists a session it just started `working` with status `idle`;
  `agentState` read the pair as an Esc. Claude Code records an Esc in the transcript, a user entry
  "[Request interrupted by user…]" with `interruptedMessageId` (fix/ci-green's, 2026-11-08); v99's
  had none. Hive met the same moment after a resume and guards it for itself
  (`hive-writing.ts:19-25`).
- **`mark-merged.mjs` reads a branch with no commits of its own as merged**: V96 and V108, started
  that day and not yet committed, were listed as notes ("merged, but its row says planned"), not
  marked. Harmless, since only rows that say built are marked; the tool's answer gives the notes.
