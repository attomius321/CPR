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
