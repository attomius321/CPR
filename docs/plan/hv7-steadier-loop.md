# HV7 — A steadier Hive loop: what the graph runs found

[Index](../PLAN.md) · Journal: none yet

**Status:** proposed (2026-11-02), from the real runs of 2026-11-02 that measured a graph of
workspaces against one (the HV6 spike, stopped and dropped); not planned or started. Decision
numbers for its parts are given when it is planned.

**Why HV7 is this.** HV7 was the graph: Alpha Ceph splitting a goal into workspaces and
orchestrating them, built only if HV6 showed a gain (decisions 691, 692). The person stopped
HV6's runs and dropped both (2026-11-02): "We'll stop here with the Hive, and improve what we
have, we'll keep HV4." Hive stays one workspace a goal, as HV4 built it (decision 811). HV7 now
names the fixes those runs found in that loop. Older plans and journals that say "HV7" mean the
graph.

## What was run

Goal: D3's true warnings (D3a–D3d of [d3-true-warnings.md](d3-true-warnings.md)), as one Hive
workspace and, side by side, as three Hive workspaces in parallel (D3a, D3b, D3c+D3d), in two
scratch clones of Symbiote at `609dcd7` with their own `symbiote/`, cache and bare `origin`.
Writers Claude Code on Opus 5.5 at xhigh, the running reviewer Opus at xhigh, this repository's
whole check, `hive.budget` $40, pause at 90 %. Started 18:19 UTC, stopped by the person at 19:53
(94 min), nothing landed:

| Arm | Spent | Checks (failed) | Reviews | Where it was |
|---|---|---|---|---|
| One workspace | $26.04 | 0 | 0 | first turn |
| Graph: D3a | $12.25 | 2 (1) | 1, 1 defect proven ($1.27) | round 3 of 3 |
| Graph: D3b | $16.55 | 3 (2) | 1 running at the stop | round 3 of 3 |
| Graph: D3c+D3d | $24.48 | 0 | 0 | first turn |

The graph spent $53.28, 2.0× the single workspace's $26.04 in the same 94 min. HV1 had measured
1.8–2.2× the cost and 1.7–2.0× the time on three small goals.

## What the runs found

1. **The budget cannot see a writer before its first stop.** `hive.budget` counts a writer by
   the last `cost-state` line of its transcript (decision 801). Claude Code writes that line
   when a session is stopped, not when a turn ends: at each of Hive's messages (`reply` stops
   and resumes it) and at Hive off.

   | Writer | First `cost-state` | Spent by then |
   |---|---|---|
   | One workspace, D3 | at Hive off, 94 min | $26.04 |
   | D3c+D3d | at Hive off, 94 min | $24.48 |
   | D3a | at its first message, 36 min | $8.76 |
   | D3b | at its first message, 71 min | $15.91 |
   | HV5's writer (this repository, 2026-11-02, one turn) | never | $19.21 at list prices |

   A writer whose first turn runs past the budget is not stopped. Today's large first turns
   alone came to $24–26. The transcript at list prices, each message's usage once, matched
   Claude Code's count: $26.04 against $26.04 (one workspace), $10.99 against $10.99 (D3a),
   $29.08 against $29.18 (HV8).
2. **Flaky tests take rounds.** 3 of the 5 checks failed, each only in this repository's own
   timing tests, which none of the changes touched:
   - D3a, round 1: `hive-request-checkout.test.ts` (the GitLab case), a 5 s timeout.
   - D3b, round 1: `test:e2e`, 3 of 394 (`alpha-ceph.spec.ts:167`, `merges.spec.ts:242`,
     `targets.spec.ts:38`).
   - D3b, round 2, the same commit `c203e9e`: `hive-request-checkout.test.ts` (the GitHub
     case), a 5 s timeout.

   Each failed check is one of a workspace's 3 rounds (decision 651): D3b spent 2 of its 3 on
   them. The same happened before: HV2's real run spent a round on two e2e tests its change could
   not reach ([journal](../journal/hv2-hive-runner.md)), and AR1 found flaky e2e in 3 of 3
   failed Hive checks ([AR2](ar2-defaults-from-ar1.md)).
3. **Checks run all at once.** Hive starts a check whenever a turn ends; nothing limits how many
   run together. With four workspaces, their checks and the writers' own real-repo comparisons,
   the load average was 19–37 on 32 cores. A whole check took 506–539 s against 446 s on the idle
   machine (`pnpm check` 91 s, `build` 4 s, `test:e2e` 351 s), +13–21 %, and the timing tests
   above failed.
4. **Hive off leaves what the writer started.** Hive off stopped the four sessions and the
   review in 2 s. Six processes the writers had started in the background were still running:
   - two `symbiote view`s started from worktrees;
   - two Playwright runs;
   - a `regression/run.mjs` on Qwik, with its shell.

   One view ended on its own seconds later; the other five were stopped by hand. Decision 690
   says Hive off stops everything.
5. **A new repository waits on trust, unsaid.** Claude Code refused every `claude --bg` in the
   two new clones ("Workspace not trusted") until the person trusted them, about 4 h
   later. A trusted parent folder (`/`, `/home/anton/projects`) does not count. Hive learns it
   only by starting a writer (HV4: started again once, then stopped with why). HV4 left it for
   later ("answered once by the person").
6. **The second check at landing** (HV4's later list). HV5's landing waited 7.5 min for the
   queue's check of a tree Hive had checked 18 min before (`land-queued` 14:03:03, `landed`
   14:10:35).

**Also measured.** Each Opus writer at xhigh spent about $16 an hour. The five-hour window went
from 5 % to 66 % in 90 min with four writers. The week went from 10 % to 19 % for about $80, about
$9 a point. A large goal can cost more than $40: HV8 cost $47.19, and today's single workspace
spent $26 in its first turn.

**Goal**: Hive's one-workspace loop holds its limits and spends its rounds on the change. The
budget sees a writer from its first minute. A flaky test costs minutes, not a round. Checks don't
trip each other. Hive off leaves nothing running. A folder Claude Code does not trust is said
before any start. Normal mode is unchanged.

## Parts (to plan)

- **Spend from the transcript** (`hive-pacing.ts`): a writer's spend is Claude Code's
  `cost-state` when one is newer than the transcript's last usage. Otherwise it is the transcript
  at list prices, each message's usage once, read from where the last read stopped. Measure how
  far the two differ, at its stops, on today's four transcripts.
- **A failed check run again once** (`hive-runner.ts`): before a failure costs a round, the
  failed command runs once more on the same commit. A pass then is recorded as flaky, with the
  tests' names, and sent nowhere. Decide whether to run every failure again, or only one whose
  failing tests the change does not touch.
- **Checks at once** (`hive-runner.ts`): at most `hive.checks.atOnce` (a number to measure here)
  run together, the others waiting their turn, recorded and on the card.
- **Hive off stops what the writer started**: on Hive off and on a stop, the processes left
  behind with their working folder in the workspace's worktree are stopped. The person's own
  processes there are not.
- **Trust said before a start**: Hive on, and each start, says which folder Claude Code does not
  trust, before any writer starts. Reading Claude Code's trust needs a way that writes nothing
  of the person's.
- **No second check at landing**: HV4's later item, kept here because today measured it.

**Not in HV7**: a graph of workspaces, an orchestrator, Alpha Ceph driving workspaces (811). The
other later items of HV4 (a landed workspace cleaned up; the landing's time on the card and its
log while it runs) stay in HV4's list. `scripts/regression/setup.mjs` failed on zod: 6 pinned
commits no branch reaches any more ("commits not found"); fetched by full SHA by hand. That is a
fix of its own.

## Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 811 | Does Hive get a graph of workspaces? (supersedes 691, 692; replaces 649's split) | **No. Hive stays one workspace a goal, as HV4 built it: no split into several workspaces, no orchestrator, Alpha Ceph drives no workspaces. HV6 (the measurement) and the graph are dropped; HV7 is the loop's fixes these runs found** | The person (2026-11-02), after the runs: "We'll stop here with the Hive, and improve what we have, we'll keep HV4." On D3 the graph spent 2.0× as much in the same 94 min, with nothing landed in either arm, and 3 of its 5 checks failed on flaky tests under the load of four workspaces; HV1: 1.8–2.2× the cost and 1.7–2.0× the time for the same results on three small goals |
