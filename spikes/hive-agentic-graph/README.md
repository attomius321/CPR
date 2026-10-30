# Spike HV1: Hive's agentic graph

A throwaway prototype of Hive's runner, and the runs that measured it against one agent. The
answer is in [docs/plan/hv1-hive-graph.md](../../docs/plan/hv1-hive-graph.md); what was learned is
in [docs/journal/hv1-hive-graph.md](../../docs/journal/hv1-hive-graph.md).

## Files

| File | What it is |
|---|---|
| `hive.mjs` | The runner: the orchestrator's plan, workspaces as git worktrees, the inner loop (researcher, writer, reviewer, round cap, progress ledger, a new plan on a stall), merges in dependency order, stops, the usage gate, Hive off, resume |
| `fake-agent.mjs` | A fake Claude Code for the control flow, at no cost (`--profile fake --fake happy\|stall\|cap\|slow\|parallel`) |
| `eval.mjs` | Scores a finished run: the check, the hidden tests, the change's size, `symbiote diff`'s findings, a blind Opus review |
| `probe-review.mjs` | A reviewer that runs code, on a finished run's result (also in `hive.mjs` as `--review probe`) |
| `summary.mjs` | The results table from `runs/` |
| `goals/` | The three goals as the agents got them |
| `hidden/` | The hidden acceptance tests, never shown to an agent |
| `runs/` | Every run's `state.json`, `events.jsonl`, `eval.json`, `probe.json` and console log; `agents.tar.gz` holds each agent call's stream-json |

## Running it

It needs this worktree built (`pnpm build`: `symbiote diff` and the usage reader). It also needs a
scratch repository with a `check` script whose dependencies resolve. The spike's lived in
`/tmp/hive-spike-b89c2d5a`, with `node_modules` in that folder for every worktree under it.

```sh
node spikes/hive-agentic-graph/hive.mjs start --run <dir> --template <repo> \
  --goal spikes/hive-agentic-graph/goals/g1-folder-report.md \
  --mode graph|loop|one|subagents --profile fake|cheap|real|sonnet|haiku [--review probe] [--fake happy]
node spikes/hive-agentic-graph/hive.mjs off --run <dir>      # Hive off: every agent stopped
node spikes/hive-agentic-graph/hive.mjs on --run <dir>
node spikes/hive-agentic-graph/hive.mjs resume --run <dir>
node spikes/hive-agentic-graph/eval.mjs <dir> --hidden spikes/hive-agentic-graph/hidden/g1-acceptance.test.ts
node spikes/hive-agentic-graph/summary.mjs
```

Profiles other than `fake` run real Claude Code sessions (`claude -p`) on the person's
subscription. Writers and the running reviewer get `bypassPermissions`: run them only in a scratch
folder.
