# Journal: HV1 — Hive's agentic graph (spike)

[Index](../JOURNAL.md) · [Plan](../plan/hv1-hive-graph.md)

## HV1 spike — how Symbiote should run Hive's graph, and does it beat one agent? (2026-10-31, branch `spike/hive-agentic-graph`)

**The answer.** A graph of workspaces did not beat one agent on three small goals: the same
results at about twice the cost and time. The read-only reviewer caught none of 4 real defects,
but a reviewer that runs code caught all 4. Recommended: Symbiote's own runner, one workspace a
goal, the running reviewer as the verifier, and the graph later. The plan has the numbers, the five
answers, milestones HV2–HV5 and decisions 646–651. Nothing in `packages/` changed; the prototype
and its logs are in `spikes/hive-agentic-graph`.

### What was tried

- **Read**:
  - Hive's switch and record (V82, `hive.ts`), the workspace records and `start_workspace`'s
    `from`;
  - the merge queue and the merger's decisions (V26), Nucleus's tools and gates (MC1, NU1);
  - the usage reader;
  - Claude Code's flags (`--json-schema`, `--max-budget-usd`, `--setting-sources`, `--agents`,
    `--tools`), and the agent-teams and subagents docs.
- **Built**:
  - `hive.mjs`, a runner with no dependency;
  - a fake agent for its control flow;
  - `eval.mjs` (the same score for every result);
  - `probe-review.mjs` (a reviewer that runs code);
  - `summary.mjs` (the results table).
- **Ran**:
  - ten fake scenarios;
  - a trial on Haiku and Sonnet;
  - 15 measured runs on three goals;
  - 4 standalone running reviews;
  - one round trip of the running reviewer on a defective result;
  - LangGraph.js's interrupt and resume, in memory and across processes.

### Learned

- **The orchestrator follows its effort rule.** Opus split G1 and G2 into two dependent
  workspaces. For G3 it put the counter's shared rules first so its two parallel parts never
  touched the same code. Haiku kept G1 as one workspace. Opus's plans cost $0.19–0.39 and took
  24–102 s; its briefs were detailed enough to design the code.
- **Opus is fast on small goals.** One agent wrote 206–425 lines in 1.5–4 minutes for $0.47–1.06,
  and passed every hidden test. Nothing was left for a graph or a reviewer to improve. That is why
  the comparison came out even.
- **A read-only reviewer reads; it does not test.** 12 reviews, 12 approvals in round 1, 0 of 4
  defects caught. Both reviewers that approved a defective result said so: "I traced the edge
  cases by hand against the code but did not run them"; "I couldn't run any extra cases myself
  (shell access was denied)".
- **A reviewer that must prove each finding with a failing test is precise.**
  - It caught every defect, including two my hidden tests passed by coincidence: `'\''` reads
    the same whether or not `'` starts a literal, and so does `[=[ a ]] b` on one line.
  - On correct code it wrote 57 tests, saw them pass, and approved.
  - It invented nothing.
  - It costs about as much as the writer.
- **The round trip works on a real defect.** The Haiku writer's session, resumed with the three
  failing tests, fixed both Lua bugs in 24 s for $0.06. The second running review approved.
- **Writers vary more than arms do.** Haiku alone got G3 right for $0.04. Sonnet alone and
  Sonnet in the loop each left a different defect, and the next Sonnet run left none. One run an
  arm cannot rank arms closer than "the same".
- **LangGraph.js works for what the brief doubted**: `interrupt()` and `Command({ resume })` in JS,
  a SQLite checkpointer across processes. It solves none of the hard parts here.

### Traps

- **A killed call is not a finished step.** When Hive off stopped the writer, the first runner
  took its exit for the end of the step and went on to the check and the review. Fixed: once Hive
  is off, a call's end is never handed back; the switch's watcher ends the process.
- **A loop that waits only on running work stops early.** When a merge sent a workspace back to its
  writer, the graph loop saw nothing running and stopped with `needs-person`. Fixed: go round again
  whenever an iteration started or merged anything.
- **A session ID known only after the call can't be resumed.** A stop mid-call left no ID. Fixed:
  the runner makes the ID (`--session-id`) and saves it before the call. A resume that finds no
  conversation starts the step again fresh.
- **An agent outlives its runner.** Children started in their own process group survive a SIGKILL
  of the runner. A resume stops every call still marked running before it starts anything.
- **pnpm on `/tmp` looks for a store on that drive.** `pnpm install --offline` in `/tmp` failed
  (`ERR_PNPM_NO_OFFLINE_TARBALL`) until `store-dir` named the home store. One package was missing
  even then, and came from the registry.
- **vitest 5's JSON reporter writes to `.vitest/json/output.json`**, not stdout. Pass
  `--outputFile`.
- **`claude -p` needs its prompt on stdin or as an argument**: an evaluation run without one
  failed in a second with "Input must be provided".
- **`loc` already knew Rust, Swift and Lua roughly**, so G3's first wording ("does not know them")
  was wrong. It was corrected before any agent read it.
- **Two of my hidden tests passed broken code by coincidence**. A defect check needs a case where
  the wrong reading changes the count, which is what the running reviewer's tests had.

### How it was verified

- Every result was scored from a fresh clone of its `main`: the check, the hidden tests, the lines
  added, `symbiote diff`'s findings, and a blind Opus review.
- Each blocker or major was confirmed by running the case in the result's build. Four defect checks
  ran on every G3 result.
- The hidden tests pass on reference implementations of mine (G1: 26 of 26 with the seed's; G2: 30
  of 30). G2's ignore cases agree with `git check-ignore`.
- The fake scenarios cover the control flow the real runs never reached: a stall and new plan, the
  cap, a conflict, Hive off, a killed runner.
- The kept logs reproduce the table: `node spikes/hive-agentic-graph/summary.mjs`.
