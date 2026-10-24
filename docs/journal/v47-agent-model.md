# Journal: V47 — A model for a workspace's agent

[Index](../JOURNAL.md) · [Plan](../plan/v47-agent-model.md)

## V47 spike — what each agent lists, and how it takes a model (2026-10-24, branch `feature/workspace-agent-model`)

Asked: "At the moment there is no way to choose a model per agent. There should be a selector
with the model. The model should be queried from available models, respective to Claude code /
Codex." Measured with the installed agents (Claude Code 2.1.310, Codex 0.163) in a scratch folder
and in this worktree.

**Learned**:
- **Claude Code has no command that lists models, but its SDK's handshake does.** `claude -p
  --input-format stream-json --output-format stream-json --verbose` answers an `initialize`
  control request with `models`: 13 here, each with the `value` `--model` takes, a display name, a
  description and its effort levels. Closing stdin after the answer ends it with exit 0, no turn
  and no `result` line; with `--no-session-persistence` no transcript was written (the project
  folder's file count unchanged). 1,224–1,235 ms with `--safe-mode`, 1,312 ms without it, which
  also ran the person's two SessionStart hooks. The list was the same 13 with and without
  `--safe-mode`.
- **Claude Code's levels are per model, `--help`'s are not.** Opus 4.6 and Sonnet 4.6 take low,
  medium, high and max (no `xhigh`); Haiku 4.5 takes none. `--help` lists the five for all. The
  start page's Effort has to follow the model picked.
- **Claude Code's "Default (recommended)" is not the person's default.** The list's first entry
  stayed "Opus 5.5" with `--settings '{"model":"haiku"}'` and with `--model sonnet`. Symbiote
  cannot name what Claude Code runs without a flag (as V30's levels, decision 210), and offering
  that entry would be a second default that overrides the person's `model`.
- **Codex lists its models where Symbiote already reads its levels.** `model/list` gave 3 models
  in one page (`gpt-6-luna` the default, `gpt-5.6-terra` with one more level, `ultra`), 1.1 s on
  a fresh stdio server; `config/read` the configured `gpt-6-luna`. Codex 0.163's generated
  schema takes `model` on `thread/start`, `turn/start` ("this turn and subsequent turns") and
  `thread/resume`; `codex exec` and `codex exec resume` take `-m`.

**Verification**: real runs only, no prompts sent: 7 `initialize` reads of Claude Code (3 in this
worktree, timed), 1 stdio Codex app server (`initialize`, `model/list`, `config/read`), the
schema generated into the job's scratch folder. Nothing left in the person's Claude Code or Codex
state (no session, no thread). Not measured yet: a real session on a picked model (the build's
first step, decision 339).
