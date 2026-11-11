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

## MC3 — one Confirm for many actions, mark merged, and the gaps Nucleus hit (2026-11-11, branch `feature/mcp-batch-confirm`)

Built as the person OK'd it (decisions 987–997): `start_workspace` takes `workspaces` and
`clean_workspace` `branches`, one Confirm with a tick a row, answered per item; `mark_merged` from
the repository's `merged` commands; an MCP approval queues its merge in the same Confirm, and
`queue_merge` approves a tip nobody approved; `needsYou` without merged workspaces; a lapsed
Confirm stays on the bar 24 hours for a late yes (B); `interrupted` only from Claude Code's
transcript; fix-mcp-annotations built whole.

**Learned**:
- **"Interrupted" had three more believers than the code**: decision 810's test, three of Hive's
  and the e2e fake each encoded `working` and idle as an Esc. The full e2e run caught the fake
  (468 of 469): its Esc kept the permission prompt it had named, and with a named wait first the
  row read "Waiting: permission prompt". The fake now does what Claude Code does: names every hook
  a `transcript_path` and writes its Esc there.
- **Nucleus's own page has the same guess** (`page-agent-conversation.ts:70`, `working` and idle
  read as interrupted). Not changed: the brief names a workspace's state. A fix of its own.
- **The page compared asks by their IDs** (`useAsks`): a batch's row changing state would never
  have redrawn. Found writing the bar, before a test showed it.
- **Unknown arguments refused meets decision 583**: `suggest_settings` takes `start_workspace`'s
  whole brief by design. Its schema now lists those fields too; refusing them would have broken
  "one brief fits both". Two of today's tests called `workspaces` with an argument it never took.
- **`git()` from core keeps its output's newline**: `mark_merged`'s first commit SHA carried one,
  and `merge --ff-only` said "not something we can merge". Trimmed.
- **A clone's `origin/HEAD` names the branch it was cloned from**: the first real run of
  `mark_merged`, in a scratch clone of this worktree, marked that branch, as `defaultBranch` reads
  it. `git remote set-head origin main` and it marked `main`. A person's clone of GitHub has the
  right one.
- **The batch's answer waits for its items**: the page's answer route waits up to 30 s for what
  was confirmed to be done; three fake starts took about 1 s, nine clean-ups would take a few.

**Verification**: tests first, red for the right reason: 17 for the batch and the lapse
(`mcp-batch.test.ts`), 8 for the approval that queues and `queue_merge` on any branch (5 red, the
3 others today's behaviour), 9 for `mark-merged.ts` on a temp repository with a bare `origin`
(red: no module), 3 for the tool (red against the commit before it), 3 for fix-mcp-annotations
(red; `wait {"seconds": 1}` waited until the test's 5 s cap), 6 for `interrupted` and the
transcript (the start test reproduced v99's `needs-you`, `interrupted`) and 4 changed that
encoded the guess, 1 for `needsYou` (9 of 9 merged, as measured), 2 for the Activity tab, 7 for
the bar's words. The Markdown export's test of a batch was written after its code. The tools/list snapshot
updated on purpose and read per listing: 26 tools, each with annotations and
`additionalProperties: false`, changes only as MC3 meant; the routes snapshots unchanged. Two e2e
tests through Nucleus's bridge and the fake agent: three starts in one Confirm, one unticked, two
started; their clean-up in another, one with a file not committed kept as "can't" until Close; a
lapse confirmed late, another dismissed. The real bar screenshotted in both themes at 1x
(`packages/viewer/coverage/mc3-shots/out/`, not committed): it draws as the mockup. A real
`mark_merged` on this repository's docs, in a scratch clone with a bare remote: dry run 452 ms, 20
files, 9 rows; marked 506 ms, one "Docs: merged" commit with the IDs in its body, `main` moved in
the clone's checkout, pushed.

Not verified: a real Nucleus session (it would write into the main checkout's `symbiote/`; the
e2e fake drove the bridge instead); a batch being done in a screenshot (a second or two); Codex as
the client of a lapse (the call still ends at 10 minutes, as before).
