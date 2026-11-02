# Journal: HV4 — Hive drives a workspace from start to end

[Index](../JOURNAL.md) · [Plan](../plan/hv4-autonomous-landing.md)

## HV4 plan — from the brief to landed, with no person (2026-11-01, branch `feature/hv4-autonomous-landing`)

Read HV1–HV3, Hive's live progress, the runner flaws' fix (716–721), AR1 and AR2, and the code
that lands today: `hive-workspace.ts`'s Land, the runner's `landing` step, the merge queue
(`merges.ts`: the merger, `landEntry`, `merge.push`, the states that hold a target). Measured
Hive's records and `main`'s reflog for the wait at landing: 7 min 51 s to 99 min 43 s, one
workspace over 14 h, each with the queue's own check (a median 6.9 min, AR1). The brief asked for
autonomous landing; the person widened it to the whole workspace: "the North star of Hive mode is
a fully autonomous system. From the start to the end." Planned three times: once before `main`
moved, once after merging it in (the runner flaws' fix, AR2, V86), once with the person's answers.
Not built: "Plan, but don't start implementing. We don't have enough weekly session."

**Learned**:
- **A failed Hive landing would hold `main`.** The queue holds a target while an entry is `ready`,
  `needs-you` or `failed`, and decision 717 counts `failed` as not landing: Hive must take its own
  failed entries out of the queue, not leave them.
- **This repository pushes `main` on every merge** (`merge.push: true`), while decision 690 said
  Hive never would. The person: Hive pushes the branch the workspace started from, after landing,
  whatever `merge.push`; 690 changes with it.
- **Most conflicts here are in docs.** 53 of 148 merges conflicted (AR1), all in
  `docs/JOURNAL.md`; with AR2's union merge, 17 would still, 8 in code. Sending them to the writer
  (the person's choice) costs a round each: about 20 min and a review here.
- **Landing is one gate of many.** In this repository's 131 workspaces (AR1): plan first in 121, 29
  permission prompts, 20 questions. A Hive workspace that lands alone but waits on a plan or a
  question is not autonomous; HV4 takes those gates too.
- **The parked question was settled meanwhile**: AR2 (decision 739) has the writer run the failing
  tests and those its change touches, and Symbiote the whole check.
- **Decision numbers moved twice while planning**: 716 was free at first, then the runner flaws'
  fix took 716–721, AR1/AR2 735–744, V86 750–752, V87 760–766. HV4 takes 767–775, rechecked on
  `main`, every branch and every worktree.

Not verified: everything; nothing is built. The `auto` permission mode's behaviour in a `--bg`
session, and a fetch and push against a bare remote, are the first things to measure.

## HV4 — Hive from the brief to landed, built (2026-11-02, branch `feature/hv4-autonomous-landing`)

At `landing` Hive approves the commit as its own (`via: "hive"`) and queues it into the branch the
workspace started from; the queue brings that branch up to its remote, merges, checks, lands and
pushes it. A conflict, a failed merge check or a fast-forward outrun goes back to the writer
(`hive.land`), twice at most. The branch is pushed after each turn. Plans, questions and
permissions get Hive's answer; a failed writer is restarted once. Hive won't turn on while a
normal-mode workspace is open, and asks before it turns off while it works. In Hive mode the
sidenav has Hive and Done only. Decisions 767–775.

**Learned**:
- **A stuck Hive landing would hold `main`.** The queue holds its target while an entry is `ready`,
  `needs-you` or `failed`; Hive takes its failed entries out of the queue before it tells the
  writer, which is also what lets the message go (decision 717 sends nothing to a branch in the
  queue).
- **The merge commits need a git user name**, which the runner's test repositories had never set:
  the first landing failed "Committer identity unknown", and the failure path sent it to the writer
  as it should.
- **"Not mine" is a cheap retry.** With decision 716, a writer that answers a failed merge check
  with no change sends the same commit straight back to landing: only the merge's check runs again,
  not Hive's check or the review (tested with a check that fails once in the merge's worktree).
- **The sidenav stopped reading the list while Hive worked.** It read only while an agent worked or
  waited, or a merge ran; a Hive workspace whose writer is idle moved on unread. Found by the full
  e2e run (a card left at "Merged"), not by the spec alone, which passed 3 of 3: under load, the
  last read fell between the queue's landing and Hive's record of it.
- **A question that reads before it opens loses clicks**: Turn on first read the list, then opened
  its question; the Hive page's e2e clicked beside the question before it was there.
- **Claude Code's trust question stops a real run before any token**: in a scratch repository no one
  had trusted, the writer did not start; Hive started it again once and stopped it, with why, in
  3 seconds. HV4c's path, seen for real.

**Verification**: tests first, each red for the reason it names (no `by`, the merger asked, no push,
no fetch; no lander, no `answered`; no answer to a plan, a question or a failure; no
`/api/hive/state`); `merges.test.ts` 94, `hive-runner.test.ts` 60, `pnpm check` 2,763 tests.
e2e: the viewer's 388, 387 passed on the first run, the one failure the polling flaw above; after
its fix the Hive, Alpha Ceph, merges and Settings specs 48 of 48, then the whole suite 388 of 388
(6.1 min); nexus 20 of 20. Screenshots of the
sidenav, a Review tab with its landings, Start, and the Hive page and its off question, dark and
light, over this branch's view on the scratch repository.

Not verified: a push to GitHub (the real runs pushed to a local bare `origin`); a real merge
check that fails; a writer that asks in `auto` mode (none did); macOS and Windows.

## HV4 — the real runs: two workspaces landed with no press (2026-11-02, branch `feature/hv4-autonomous-landing`)

Once the person trusted the scratch repository (HV1's `loc` seed, a bare `origin`,
`merge.push: false`), this branch's view drove two workspaces with Hive on, the writer on Sonnet
at low effort in `auto` mode, the reviewer on Sonnet at medium. `feature/lua-comments` landed 63 s
after its start: one turn, the check (1.8 s), an approving review (23 s, $0.12), Hive's approval
and the queue's merge, check and push. `feature/readme-languages` met a conflicting `README.md`
rewrite on `main`: the queue stopped at the conflict with no merger agent, Hive took the entry out
and sent `hive.land`; the writer answered "My branch caused the conflict", merged `main` in and
kept both sides' intents; the check and review passed again and it landed 2 min after its start,
`merges: 1`. Both pushed `main` and their branch to `origin`. The plan has the timeline.

**Learned**:
- **The writer reads `hive.land` as meant**: it said whose fault the conflict was, merged, and
  resolved in 27 s, with no rebase and no push of its own.
- **After `hive.land` the rounds start again**: the second check and review are listed in round 1
  on the Review tab, beside the first; the landings say which came first.
- **A real landing here costs seconds, not minutes**: the queue's check on the merge took 1.1 s on
  a 1 s check. In this repository the same step is about 6 minutes (AR1).

**Verification**: the records and events (`symbiote/hive/feature/*.json(l)`), `main`'s graph and
`origin`'s refs in the scratch repository, the person's review file (`via: "hive"`), the queue's
entries (`by: "hive"`, `pushed` ok), the review copies removed (only their streams kept);
screenshots of the real Review tab and the Done group, dark and light.
