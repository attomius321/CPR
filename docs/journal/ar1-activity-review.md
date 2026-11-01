# Journal: AR1 — Symbiote's own record: what works, what fails, what to change (spike)

[Index](../JOURNAL.md) · [Plan](../plan/ar1-activity-review.md)

## AR1 plan — the sources and what is counted (2026-11-01, branch `spike/activity-review`)

The person's export holds 131 workspaces and Nucleus (904 messages, 13,735 calls, 155 failed, 942
commits). Only 76 workspaces, from 25 October, have their calls; the 55 before have messages,
reports and commits only. Hive drove 6 workspaces on 31 October. Not in the brief's sources but
found on this machine and agreed by the person: Claude Code's transcripts of every worktree
(tokens, interrupted turns, the older workspaces) and a second repository run with Symbiote,
Starknet (23 workspaces, 25–28 October). The plan counts by kind from all of them, read only.

## AR1 spike — what the records say, and what to change (2026-11-01, branch `spike/activity-review`)

**The answer.** Symbiote does what it was built to do, and its records hold the proof:

- plan first was kept 67 of 67 times;
- the person answered a plan in a median 2.4 minutes;
- 116 of 131 workspaces were approved;
- 1.1 % of calls failed, none of them stopping a workspace.

The time goes to checks and conflicts. Writers ran the whole e2e suite 181 times (8.0 h); merges
ran the check 89 times (8.5 h, 12 failed); 53 of 148 merges into `main` conflicted in
`docs/JOURNAL.md`. The money: $1,884 API-equivalent for 127 workspaces in 17 days, 60 % of it
cache reads.

Seven changes are ranked in the plan, with numbers 735–737 for the spike's own decisions. Nothing
in `packages/` changed; the scripts are in `spikes/activity-review/`.

**Learned**:

- **Claude Code's transcripts hold what Symbiote's record lacks.** They give tokens per request,
  the model actually run, and the 55 workspaces from before calls were recorded.
  - Assistant lines repeat one request per content block: count usage once per message id.
  - At list prices (Opus 5.5 $4 / $20, cache read $0.20, 1-hour cache write 2× input), the sums
    match Claude Code's own `cost-state` within 3 %.
  - The merger's and the reviewer's `claude -p` runs keep no transcript.
- **The record calls Symbiote's messages the person's.** `activity-export.ts` labels every
  prompt but the first "The person's message". Hive's 4 messages, 3 verdict texts and 5 subagent
  hand-backs read as the person's: 12 of 255.
- **A background job's end is a prompt.** Claude Code's `<task-notification>` arrives as a
  prompt, names the call's `tool-use-id`, and starts a turn. 439 of them drove 224 turns and 19 %
  of the dollars. It is also how to time a background suite run: 138 runs, median 4.6 minutes.
- **75 of 240 "waiting for your input" notices were the agent waiting on itself**: its own
  background job ended next, not a message from the person.
- **The journal conflicts every time, and git can merge it.** All 53 conflicted merges since
  15 October touched `docs/JOURNAL.md`. `git merge-tree` with a union driver, in a scratch clone,
  leaves 17.
- **Flaky tests reach the branch's agent by hand.** The person pasted 14 merge-check failures
  into writers. The agents found 10 a race in a test the branch could not reach. 7 then changed
  that test on their own feature branch, outside their brief, and needed another review.
- **Hive's own prompts ask for the duplicate check.** `hive.check` says "run the check
  yourself". On a Python repository, with a 75-second check:
  - today's words: the writer ran the whole check 1–3 times per turn;
  - the proposed words: 0 times;
  - all six fixed the bug and committed.
- **Starknet looks the same.** 23 workspaces, Opus at xhigh, plan first, approvals only, no
  permission prompts. Its 2 spikes ended with the person asking to commit the result, as 2 of
  Symbiote's 9 did.
- **Real `claude -p` trials from inside a Claude Code session**:
  - The auto-mode classifier refuses an unconfined agent: confine it in Claude Code's sandbox.
  - `dontAsk` with `Edit(./**)` from an inline `--settings` refused edits.
  - A clone under `~/.claude/` is a "sensitive file" for edits.
  - What worked: a clone under `/tmp`, `--permission-mode acceptEdits`, Bash allowed in the
    sandbox. Five setup runs went to finding that.

**Verification**:

- The totals match the export's heads (13,318 calls, 145 failed, 450 reports, 249 + 6 messages).
- 20 random counted items were found in the Markdown.
- The 119 later messages and 14 pasted failures were read by hand.
- The merges were replayed with `git merge-tree`.
- The trials: 13 runs, $0.82, one run over the 12 agreed.

Not verified:

- Whether higher effort or a larger model does better.
- What the card showed while an agent waited on its own job.
- The merger's cost.
- The reviewer change: one pair of runs, which neither flagged the later ask.
