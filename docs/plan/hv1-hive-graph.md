# HV1 — Hive's agentic graph: how Symbiote should run it, and does it beat one agent? (spike)

[Index](../PLAN.md) · [Journal](../journal/hv1-hive-graph.md)

**Status:** measured (2026-10-31), a spike on branch `spike/hive-agentic-graph` (from `main` at
`40c000a`). Nothing in `packages/` changed. The prototype, its run logs and the scripts that
score them are in `spikes/hive-agentic-graph`. Nothing is built: the milestones below wait for the
person. The person's answers to the plan: run the core comparison; Claude models only for now;
landing on `main` approved automatically during the measurement; the person's minutes estimated.

**Question** (the brief): how should Symbiote implement Hive, the planned graph loop mode
(`docs/reference/configuration.md`, Hive mode: an orchestrator with full access, a main agent, a
researcher and a reviewer in every workspace), and is it worth it? Five parts: the runner, the
outer graph, the inner loop, the gates and limits, and the number that decides it.

## The answer

- **Splitting a goal into a graph of workspaces did not beat one agent.** On three small goals,
  Opus alone and the graph both passed every hidden test and left the same kind of findings. The
  graph cost 1.8–2.2× as much and took 1.7–2.0× as long.
- **The reviewer Nucleus proposed caught nothing.** It is read-only, has a clean context and
  judges the diff. It approved 12 of 12 times in round 1, including two results with real
  defects. Both times it said it had not run anything.
- **A reviewer that runs code caught every defect.** It works in a throwaway copy and reports only
  defects a failing test of its own shows. It found all 4 defects in the 3 defective results, and
  none of its 9 failing tests was wrong. Sent back to the writer, the failing tests were fixed in
  one round.
- **Build it this way.**
  - Hive's runner goes in `symbiote view`, with one workspace per goal by default.
  - The running reviewer is the verifier, with the check still the final word.
  - The orchestrator splits a goal into a graph only when its parts are large or truly
    independent.
  - Don't build the read-only reviewer or the researcher as agents of their own.

## What was tried

- **A runner of Symbiote's own**: `spikes/hive-agentic-graph/hive.mjs`, 1,097 lines, no
  dependency. Four modes:
  - `graph`: the orchestrator's workspaces, each with the inner loop;
  - `loop`: one workspace with the inner loop;
  - `one`: one agent alone;
  - `subagents`: one session whose researcher and reviewer are Claude Code subagents.

  Agents ran as Claude Code `-p` sessions with stream-json output, so every call has its tokens
  and Claude Code's own cost (`total_cost_usd`, list price; a Max subscription is not billed by
  it).
- **A fake agent** (`fake-agent.mjs`) for the control flow, at no cost. Ten scripted cases:
  - the happy path and a stall that gets a new plan;
  - the round cap;
  - Hive turned off mid-call, and the runner killed with SIGKILL mid-call, each resumed;
  - two parallel workspaces that conflict;
  - the one, loop, subagents and running-reviewer modes.
- **Three goals** on a scratch repository, `loc`: Symbiote's own line counter (`packages/monitor`'s
  `count.ts` and `languages.ts`, 330 lines, 15 tests), checked by `tsc` and vitest in about 1 s.
  - **G1**: a folder report: `scanFolder`, `summarize`, and a `loc` command over them.
  - **G2**: an ignore file: a `.gitignore`-style matcher, then the scan and the command using it.
  - **G3**: Rust, Swift and Lua counted right: nested comments, raw and long strings, lifetimes.
- **Hidden acceptance tests**, written before any run and never shown to an agent: 11, 13 and 8
  tests. They pass on reference implementations of mine (G1, G2). G2's ignore cases were checked
  against `git check-ignore`.
- **The same score for every result** (`eval.mjs`, on a fresh clone of the result's `main`):
  - the check and the hidden tests;
  - the lines added;
  - Symbiote's findings (`symbiote diff`; none on any result);
  - a blind review by a fresh Opus that saw only the goal and the diff;
  - each blocker or major from the blind review, confirmed by me in the code.
- **A reviewer that runs code** (`probe-review.mjs`, then built into the runner as `--review
  probe`): a clean-context Opus in a throwaway copy, free to write and run tests. It reports only
  defects a failing test of its own shows. The runner then runs those tests itself and keeps a
  finding only when its test fails.
- **Other runners, checked without tokens**:
  - LangGraph.js 1.6.0 installed in a scratch folder: a 30-line graph with `interrupt()`, run once
    in memory, then across two processes with its SQLite checkpointer;
  - Claude Code's agent teams and subagents from their docs;
  - Temporal from its docs.

All of it ran in `/tmp/hive-spike-b89c2d5a`; writers and the running reviewer had
`bypassPermissions` there only. Nothing ran in the person's checkout or its `symbiote/`.

## Measured

Opus 5.5 at high effort wrote in every arm unless the writer column says otherwise. The in-loop
reviewer was Sonnet when Opus wrote, and Opus when Sonnet or Haiku wrote. Reviews: A approved, C
changes asked, with the number of findings. Blind findings are blocker / major / minor.

| Run | Goal | Arm | Writer | Workspaces | $ | Min | Calls | In-loop reviews | Hidden | Blind b/M/m | Lines added |
|---|---|---|---|---|---|---|---|---|---|---|---|
| g1-graph | G1 | graph | opus | 2 | 1.05 | 3.0 | 7 | A0 A0 | 11/11 | 0/1/5 | 467 |
| g1-one | G1 | one | opus | 1 | 0.47 | 1.5 | 1 | | 11/11 | 0/0/6 | 425 |
| g2-graph | G2 | graph | opus | 2 | 0.91 | 2.5 | 7 | A0 A0 | 13/13 | 0/0/6 | 208 |
| g2-loop | G2 | loop | opus | 1 | 0.61 | 1.9 | 3 | A0 | 13/13 | 0/0/5 | 206 |
| g2-subagents | G2 | subagents | opus | 1 | 0.71 | 2.7 | 1 | | 13/13 | 0/0/5 | 206 |
| g2-one | G2 | one | opus | 1 | 0.51 | 1.5 | 1 | | 13/13 | 0/0/5 | 255 |
| g3-graph | G3 | graph | opus | 3 | 2.21 | 7.4 | 10 | A0 A0 A0 | 8/8 | 0/0/3 | 513 |
| g3-loop | G3 | loop | opus | 1 | 1.13 | 4.9 | 3 | A0 | 8/8 | 0/0/5 | 262 |
| g3-subagents | G3 | subagents | opus | 1 | 1.21 | 5.6 | 1 | | 8/8 | 0/0/3 | 250 |
| g3-one | G3 | one | opus | 1 | 1.06 | 4.0 | 1 | | 8/8 | 0/0/6 | 242 |
| g3-loop-sonnet | G3 | loop | sonnet | 1 | 0.75 | 3.1 | 3 | A0 | **7/8** | 0/0/4 | 235 |
| g3-one-sonnet | G3 | one | sonnet | 1 | 0.34 | 2.3 | 1 | | 8/8 | 0/**1**/2 | 403 |
| g3-probeloop-sonnet | G3 | loop, running reviewer | sonnet | 1 | 1.28 | 5.8 | 3 | A0 | 8/8 | 0/0/5 | 345 |
| g3-loop-haiku | G3 | loop, then the running reviewer | haiku | 1 | 1.92 | 13.0 | 6 | A1, then C2 A0 | 8/8 | **1**/0/6 → 0/0/4 | 297 |
| g3-one-haiku | G3 | one | haiku | 1 | 0.04 | 3.4 | 1 | | 8/8 | 0/0/5 | 246 |
| r1-cheap-graph | G1 | graph, trial | sonnet | 1 | 0.16 | 2.0 | 4 | A3 | 11/11 | 0/0/7 | 271 |

The check passed on every result. `node spikes/hive-agentic-graph/summary.mjs` prints this table
from the kept logs.

**The graph against one agent (Opus).**

| Goal | Cost, graph / one | Time, graph / one | Code added, graph / one |
|---|---|---|---|
| G1 | 2.2× | 2.0× | 1.1× |
| G2 | 1.8× | 1.7× | 0.8× |
| G3 | 2.1× | 1.9× | 2.1× |

The one-workspace loop (researcher, writer, reviewer) cost 1.1–1.2× one agent. Subagents in one
session cost 1.1–1.4×. None of them changed a result.

**Defects.** Four checks of mine, each a rule the G3 goal states (multi-line nested comments,
Rust's `'\"'`, Lua's `t[1]`, Lua's `[==[`), on every G3 result:

| Result | Wrong | Found by |
|---|---|---|
| Opus: graph, loop, subagents, one | none | — |
| Sonnet alone | `'\"'` | blind review, running reviewer |
| Sonnet, read-only loop | nested comments | hidden test, running reviewer |
| Sonnet, running-reviewer loop | none | — |
| Haiku alone | none | — |
| Haiku, read-only loop (round 1) | `t[1]`, `[==[` | blind review (`t[1]`), running reviewer (both) |
| Haiku, after the running reviewer's round | none | — |

Across those results, each checker caught this share of the 4 defects:

| Checker | Defects caught |
|---|---|
| Read-only in-loop reviewer | 0 of 4 |
| Blind read-only Opus | 2 of 4 |
| Hidden tests (mine) | 1 of 4 |
| Running reviewer | 4 of 4 |

On Opus's correct G3 result, the running reviewer found one real edge case that predates the
change: `#![…]` on a Rust file's first line is taken for a shebang. On the two correct results it
reviewed inside the loop, it approved after writing and passing 57 tests (Sonnet) and its own
round-2 tests (Haiku).

**Each part's cost**:

| Part | Cost | Time |
|---|---|---|
| The orchestrator's plan (Opus) | $0.19–0.39 | 24–102 s |
| A researcher (Sonnet) | $0.05–0.10 | 12–27 s |
| A read-only review | $0.05–0.27 (Sonnet), $0.41 (Opus) | — |
| A running review (Opus) | $0.44–1.37 | 1.5–6 min |
| The Haiku writer's fix in round 2 | $0.06 | 24 s |

**Usage.** Every agent call of the measured runs added up to $14.33 by Claude Code's own count:

| Model | Cost | Cache reads | Output |
|---|---|---|---|
| Opus | $11.01 | 5.1M | 237K |
| Sonnet | $3.14 | 1.8M | 118K |
| Haiku | $0.18 | 3.1M | 177K |

The blind reviews added about $9.6 and the separate running reviews $4.0. From 22:10 to 23:52 UTC,
the subscription's 5-hour window went from 3 % to 70 % and its week from 63 % to 70 %. That
includes this spike's own conversation and anything else the subscription ran, so no run's share
of a window can be told apart.

## 1. The runner: Symbiote's own, in `symbiote view` (decision 646)

**Recommendation.** Hive's runner is Symbiote's own code in `symbiote view`'s process. It is the
one owner of the merge queue, the sessions and the analyses there (decision 358's reason). It
starts and talks to agents as Symbiote already does: workspaces, `reply`, threads. It adds no
dependency.

- **What the prototype did in 1,097 lines.**
  - A plan from the orchestrator's structured output (`--json-schema`), checked for unknown
    dependencies and cycles.
  - Ready workspaces started, a dependent one from its parent's approved branch.
  - Merges in dependency order: a merge worktree, the check, a fast-forward.
  - A conflict sent back to the workspace's writer.
  - The round cap, a progress ledger, a new plan on a stall, and the stops.
  - The usage gate, Hive off, and a resume after a kill.
  - The hard parts were processes, git, merges and stopping. No framework does them.
- **LangGraph.js 1.6.0.**
  - What works: `interrupt()` pauses a graph in JS, `Command({ resume })` resumes it, and its
    SQLite checkpointer resumed it in a new process. This settles the brief's unverified point.
  - What it costs: 52 packages, 81 MB, and a native module (better-sqlite3).
  - What it adds: nodes and checkpoints that Symbiote's records and git already give. A node is
    its unit, so an agent call stopped after 5 minutes reruns from its start, as the prototype's
    steps do.
- **Claude Code subagents.** They worked: the same results for 1.1–1.4× one agent. But inside one
  session, Symbiote can't show a subagent, stop it, gate it, or give it another vendor. Per the
  docs, a subagent also takes the parent's `bypassPermissions` over its own `permissionMode`.
  Subagents are the writer's own tool, not Hive's structure.
- **Agent teams** (docs; not run): experimental, and not spawned in `-p` or the Agent SDK. One team
  a session, no nesting. `/resume` doesn't restore in-process teammates, and a permission mode
  can't be set per teammate at spawn. "Significantly more tokens than a single session." Not a
  base for an orchestrator that must outlive a restart.
- **A durable-execution engine** (Temporal; docs only): a server to run beside a local tool. The
  durability Hive needs came from a JSON record written after each step, and git.

## 2. The outer graph (decisions 647, 649)

**Recommendation.** One workspace per goal by default. The orchestrator splits only along real
dependencies or into large parts that can be built apart; it gives each part a brief and
dependencies, and a task ledger. The graph is a later milestone, built when a goal shows that one
workspace can't hold it.

- **The plan**: one orchestrator call (`-p`, read-only tools, a JSON schema) gives workspaces
  (`id`, `title`, `brief`, `deps`) and the task ledger: facts it checked, guesses, the plan in a
  sentence. Symbiote checks the ids, the dependencies and cycles.
  - Opus split G1 and G2 into two dependent workspaces. For G3 it put the counter's shared rules
    first, then Swift and Lua in parallel on top: they merged without a conflict.
  - Haiku kept G1 as one workspace.
  - Opus's briefs were detailed (file names, signatures, the table's columns). Cognition's
    "managers over-prescribe" warning applies; here it caused no failure.
  - One possible seam (one case only): G1's command workspace didn't handle errors from a scan
    another workspace owned. On an unreadable folder the graph's `loc` crashed with a stack trace;
    one agent's printed `loc: EACCES…`.
- **Starts**: a workspace is ready when its dependencies are approved. With one dependency it
  starts from that branch's approved tip, without waiting for the landing (`start_workspace`
  already takes `from`). With several, it starts from `main` once they have merged.
- **Merges**: in dependency order, one at a time, through Symbiote's merge queue: the merge
  worktree, the check, a fast-forward (V26). A conflict goes to the merger (V26); a check that fails
  after a merge goes back to the workspace's writer. The prototype sent both to the writer and
  tested that with fakes only.
- **Stalls**: Symbiote keeps the progress ledger itself, not an agent: new commits, the check's
  state, the reviewer's failing tests. Two rounds without progress ask the orchestrator for a new
  plan (a new brief on the same branch), at most twice, then the person. Tested with fakes; no
  real run stalled.
- **State** (decision 647): `symbiote/hive/<goal>.json` and `<goal>.jsonl` (events) beside the
  workspace records, which `symbiote/.gitignore` keeps out of git. They are written after each
  step. A restart of `symbiote view` resumes at the step it stopped in:
  - the agents of the lost process are stopped;
  - the writer's session continues with "you were interrupted";
  - a session the stop cut before it was written starts again fresh.

  Tested with fakes, including a runner killed with SIGKILL whose agents had outlived it.

## 3. The inner loop (decisions 648, 650)

**Recommendation.** Two agents a workspace, each a session Symbiote can show and stop.

- **The writer**: the only one who writes in the worktree and on the branch. In Symbiote it is the
  workspace's agent (`claude --bg`, its terminal, its thread). Feedback goes to it with `reply`, so
  it keeps its context. The prototype resumed `-p` sessions by ID.
- **The running reviewer**:
  - a fresh session with a clean context, in a throwaway worktree at the branch's tip;
  - full access there and nothing outside; it may build and run anything;
  - it gets the brief, the diff and the check's result;
  - it reports only defects a failing test of its own shows;
  - Symbiote reruns those tests itself and keeps a finding only when its test fails, then deletes
    the copy.

  The failing tests are the review sent back. The writer adds them and makes them pass, or says in
  one line why a test is wrong.

  The read-only reviewer approved 12 of 12, including two defective results ("I traced the edge
  cases by hand … but did not run them"; "shell access was denied"). The same model, Opus, found
  them by running tests. The fix is structural, as MAST says, not a better prompt.
- **No researcher agent** by default. The orchestrator's plan already reads the repository (its
  facts), and the writer reads what it needs, with its own subagents if it wants. Four
  researchers cost $0.05–0.10 each with no measured effect.
- **When it stops**: the running reviewer approves and Symbiote's check passes. Or after 3 rounds
  (started again after a new plan), the person is asked. The check stays the last word; the
  reviewer's approval alone lands nothing.
- **Cost**: a running review costs about as much as Opus writing the goal ($0.44–1.37). On these
  goals Opus alone left no defect it found, so for Opus it doubles the cost for a safety net.
  Sonnet or Haiku with it reached Opus's results ($1.28; Haiku $1.51 without its first read-only
  review), but not more cheaply than Opus alone ($1.06). A writer leaves defects some of the time:
  on G3, Sonnet in 2 runs of 3, Haiku in 1 of 2, Opus in none of 4.

## 4. Gates and limits (decision 651)

- **Without the person**:
  - the plan;
  - starting workspaces and messaging their agents;
  - the running reviews and their round trips;
  - queuing merges into the goal's branch.
- **Stops for the person**:
  - landing on `main`: approved automatically in this spike by the person's choice, for the spike
    only;
  - the round cap;
  - two new plans that didn't help;
  - a conflict the merger can't resolve;
  - pushing, and deleting unmerged work: never Hive's.
- **Access**: the writer has full access inside its worktree; the running reviewer, inside its
  throwaway copy; nothing outside either. This spike ran everything in a scratch folder.
- **Limits**:
  - the round cap is 3 per workspace, started again after a new plan;
  - 2 new plans per workspace, and 2 merges of `main` into a workspace before the person is asked;
  - the usage windows are read before each agent starts. Above a limit (the prototype's: 70 % of
    5 hours, 85 % of the week), Hive starts no agent, and in Symbiote it would resume when the
    window resets. No real run hit it; I stopped the measurements at 70 % myself.
- **Hive off**: every running agent's process group is stopped. The fake run's agent was gone
  within a 1 s poll plus a 3 s grace. The step it was in stays, so turning Hive on and resuming
  continues there, and a resume refuses while Hive is off.

## 5. The number

- **Graph against one agent, on small goals**: no gain. The same hidden-test results and the same
  kind of findings left, at 1.8–2.2× the cost and 1.7–2.0× the time. G3's graph also wrote twice
  the code for the person to read (513 lines against 242).
- **The verifier**: the running reviewer caught 4 of 4 defects where everything else caught 0 to 2.
  None of its failing tests was wrong, and one round fixed what it found.
- **The person's minutes**: not timed (the person's choice). One agent asks for one landing and one
  review of 242–425 lines. The graph asks for one landing a workspace (2–3) and 208–513 lines.

## Milestones

Proposed, in this order. Each one is worth having before the next. HV2 and HV3 are built. Since
[Hive's North Star](#chore-hives-north-star-chorehive-north-star) (decisions 688–692), the
milestones after HV3 are numbered in the order they are built: HV4 autonomous landing, HV5 usage
pacing, HV6 a more rigorous measurement (a spike), HV7 the graph, with Alpha Ceph orchestrating.
Their rows are in the [index](../PLAN.md#agents); the graph proposed here as HV4 is HV7.

| # | Milestone | Output |
|---|---|---|
| HV2 | Hive's runner and record | A goal becomes one workspace started by Symbiote (`workspaces.start`), its writer's session, the check, landing asked; `symbiote/hive/<goal>.json`; Hive off stops every agent; a restart resumes at the step |
| HV3 | The running reviewer | A throwaway worktree, a clean-context session that proves defects with failing tests, Symbiote rerunning them, the tests sent with `reply`, rounds and the cap; the findings and their tests in the workspace's Review tab; Codex as an option for another vendor |
| HV5 | Usage pacing and models | Usage read before every start, a pause until the window resets, each role's model and effort in Settings |
| HV7 (was HV4) | The graph | The orchestrator's split with structured output and the ledgers, dependents from the parent's approved branch, merges in order through the merge queue, conflicts to the merger, stalls and new plans, a page that shows the graph. Only once a real goal shows one workspace is not enough |

## Not verified

- **Symbiote's own pieces were not driven**:
  - real `claude --bg` workspace sessions, their hooks and terminal (the prototype used `-p`, which
    also avoids the trust prompt in a scratch repository);
  - Symbiote's merge queue and merger (the prototype merges in order itself);
  - Codex in any role (the person: Claude only for now).
- **Real agents never hit a stall, a new plan, the round cap, a conflict or Hive off**. These ran
  with the fake agent only. The usage gate never tripped in a run.
- **Small goals, small samples**:
  - three goals of 206–513 added lines, on a 330-line library with a check of about 1 s;
  - nothing at Symbiote's scale (its CLAUDE.md, journals, a `pnpm check` of minutes);
  - one run an arm. Writers vary between runs (Sonnet: 2 of 3 defective), so the defect rates are
    rough.
- **The judges**:
  - the blind reviewer and every in-loop reviewer are Claude models;
  - my hidden tests missed 3 of the 4 defects;
  - the running reviewer's precision rests on 9 failing tests and 2 approvals of correct code.
- **Usage per run** in subscription windows: only the whole spike's change, shared with this
  conversation and anything else that ran.
- **Agent teams and Temporal**: read about, not run.

## Decisions

All proposed by this spike, for the person to confirm when HV2 is planned.

| # | Question | Decision | Why |
|---|---|---|---|
| 646 | What drives Hive | **Symbiote's own runner in `symbiote view`'s process; no LangGraph, agent teams or durable-execution engine** | The work was processes, git, merges and stopping, which none of them does; LangGraph's checkpoints repeat Symbiote's records (52 packages, a native module); agent teams don't run in `-p`, nest or survive `/resume`; one owner of the queue and sessions (decision 358) |
| 647 | Where Hive's state lives | **`symbiote/hive/<goal>.json` and its events, beside the workspace records, written after each step; a restart resumes at the step** | Resumed after Hive off and after a killed runner in the prototype; the agents' sessions and git hold the rest |
| 648 | Who verifies a workspace's work | **A reviewer that runs code in a throwaway copy and reports only defects its failing tests show, which Symbiote reruns; the check stays the last word; no read-only reviewer** | Read-only: 0 of 4 defects, 12 approvals of 12; running: 4 of 4, none of 9 failing tests wrong, fixed in one round |
| 649 | How many workspaces a goal gets | **One by default; the orchestrator splits only along real dependencies or large independent parts; a dependent starts from its parent's approved branch; merges in dependency order** | On three goals the graph cost 1.8–2.2× and took 1.7–2.0× as long for the same results |
| 650 | Which agents a workspace has | **The writer and the running reviewer, each a session Symbiote shows and can stop; no researcher agent** | Subagents can't be shown, stopped or given another vendor; researchers cost $0.05–0.10 each with no measured effect |
| 651 | Gates and limits | **Landing on `main`, pushing and deleting unmerged work stay the person's; 3 rounds, 2 new plans, 2 merges of `main` before the person; usage read before each agent starts; Hive off stops every agent and keeps the step** | The brief's proposals, run in the prototype; landing was approved automatically only for this measurement. For Hive mode, replaced by 689 and 690; normal mode keeps every gate |

## Chore: Hive's North Star (chore/hive-north-star)

**Status:** ready for review (2026-10-31), on branch `chore/hive-north-star` (from `main` at
`d40cde5`). Docs only.

**Why.** Symbiote's North Star was one: review decisions, not lines, with the person deciding. Hive
already runs without the person: HV2 and HV3 drive a workspace through the writer, the check and
the running reviewer, and only Land waits for the person (decision 681). The person (2026-10-31):
"Symbiote normal mode north star is ok, keeping the human in the loop. But Hive mode, it should be
a fully autonomous machine, with agent graphs, loops", and "the mode splitting should be clear for
the agents". So `docs/PLAN.md` now states two North Stars, and `CLAUDE.md` says which of its rules
are which mode's.

**Changed:**

- `docs/PLAN.md`: the North Star as two, normal mode's word for word as before; the rows of
  HV4–HV7 in the Agents section, in the order they are built.
- `CLAUDE.md`: the North Star line names both modes; "Two modes" says which rules hold where.
- This plan: the Milestones table points to the new rows; 651's row says what replaces it in Hive
  mode; the decisions below. HV2's, HV3's and V82's plans name the graph HV7.

**Not changed:** code, prompts and the viewer's text. The text that says landing is the person's
(Settings' Hive page, README, `configuration.md`, the agents' prompts) is listed in HV4's row and
changes when HV4 is built. Decision 119 (`design.md`, "the North Star is unchanged") is left as
dated history. The `milestone` skill's "ask before merging" is normal mode's and is left as it is.

### Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 688 | Symbiote's modes | **Two, set per repository. Normal mode (Hive off), human-centric: "Review decisions, not lines", its three questions and tie-breakers, unchanged. Hive mode (Hive on), fully autonomous: goals in, verified work landed; its tie-breakers: proven beats claimed, stopping beats guessing, recorded beats silent, within limits beats faster** | The person: normal mode keeps the human in the loop; Hive mode "should be a fully autonomous machine"; "the mode splitting should be clear for the agents" |
| 689 | Who Hive waits for | **No one: in Hive mode no step waits for the person, landing included. This replaces 651's gates for Hive mode only; normal mode keeps every gate. Until HV4 is built, Land stays the person's press (681). A workspace at a cap or stuck stops and records why; it does not ask** | Fully autonomous, with no person in the loop; "stopping beats guessing" |
| 690 | Hive's hard limits | **Hive off stops every agent and check and keeps the step (655); the round caps: 3 rounds a workspace, 2 new plans, 2 merges of `main` (651); a usage or budget cap (HV5). Hive pushes only a workspace's branch to `origin`, never `main`, for now; it never force-pushes and never deletes unmerged work** | The person's answers (2026-10-31): hard limits stay; "push only on the workspace branch, for now"; force-pushing and deleting unmerged work cannot be undone |
| 691 | When the graph comes | **649 stands: one workspace a goal by default. The graph (HV7) comes only after HV6, a more rigorous measurement on large real goals, shows a gain** | HV1: on three small goals the graph cost 1.8–2.2× and took 1.7–2.0× as long for the same results |
| 692 | Who orchestrates | **Alpha Ceph, Nucleus's name in Hive mode (682), becomes Hive's orchestrator in HV7: it splits a goal and drives its workspaces** | The person: "Alpha Ceph will become the orchestrator" |
