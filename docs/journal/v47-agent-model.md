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

## V47a — each agent's models, and a workspace started on one (2026-10-24, branch `feature/workspace-agent-model`)

Claude Code's models from its answer to `initialize`, kept in Symbiote's cache for every view and
read again in the background once a day; Codex's from `model/list`. `POST /api/workspaces` takes a
`model`, checked against the agent's list and the level against that model's; passed as
`--model`, as `model` on Codex's `thread/start`, as `-m` on every `codex exec` run; recorded and
given again. Decisions 336–340.

**Learned**:
- **Settle the protocol question with one real run before writing the code**: three one-word
  turns on the person's Codex showed `thread/start`'s `model` held through a resume in a new
  server process, so the start needed no second place to put it.
- **A field the server's parser does not name never reaches the service**: `parseWorkspaceRequest`
  rebuilds the request from the fields it knows. The service's tests passed while the HTTP path
  would have dropped `model`; a parser test caught it before the commit.
- **One read at a time needs its tests to wait for the read to end**: a call made while a failed
  read was still settling joined it instead of starting another, which is right, and the test
  waits for the next use to ask again.

**Verification**: tests first (15 CLI tests and the parser's red for the right reason), 694 CLI
tests, format, lint, typecheck.

## V47b — the Model select on the start page (2026-10-24, branch `feature/workspace-agent-model`)

"Model" under the agent: its default first (Codex's configured model named, the project's
`agent.model` named, Claude Code's own not), then its models by name, the picked one's description
under it. Effort follows the model; the draft keeps it with its agent; the Brief tab says "Started
with Claude Code on sonnet at high effort." Decision 341.

**Learned**:
- **The e2e harness is a template literal, again**: written through a script, `'\\n'` lost a
  backslash and the fake Claude Code died on a syntax error. Nothing said so: the options came back
  with no account, no levels and no models, and the Effort test failed first. `node --check` on the
  generated fake found it (V30b's journal has the same trap).
- **A muted note inside a field takes the label's weight**: the account note sits outside its field,
  the model's inside, and it read as a second label until the run column's notes were made regular.

**Verification**: 5 viewer unit tests and 3 e2e tests red first (on the old page: no Model select),
then green; e2e 233 of 233 on the branch; the note's weight found in screenshots at 1280, 1440 and
390 px, both themes.

## V47c — Scout's, Scribe's and the merger's model in Settings (2026-10-24, branch `feature/workspace-agent-model`)

A Model item in the Scout, Scribe and Merger groups, from the agent's own list, saved as
`scout.model`, `scribe.model` or `merge.model` when picked. Scout and Scribe start on the
project's model when the conversation's agent lists it; the merger passes `merge.model` as written,
as since V26c. Their Effort follows the model. Decisions 342–343.

**Learned**:
- **A project's model must not reach the wrong agent**: Scout's box can pick the other agent, whose
  list will not have `scout.model`; the list decides, as it does for `scout.effort`.
- **Changing what the merger passes would break a working configuration**: `merge.model` has been
  passed as written since V26c, and Claude Code takes full model names it does not list. Settings
  offers only listed ones and says when the file names another; the merger still passes it.

**Verification**: 8 CLI tests and 3 e2e tests red first, then green; 700 CLI tests. After `main`
merged in: `pnpm check` (1,569 unit tests), build, e2e 239 of 239. With the real agents: Symbiote's
read of Claude Code's 12 models (1,415 ms; 0.1 ms from the file), a session started through
Symbiote's start on `haiku` at `low` kept both through a reply. Options read 246–250 ms with the
list kept (`main` 243–244), 1,275–1,307 ms the first time on a machine. Numbers in the plan's
results. Not verified: a Codex workspace through Symbiote's endpoint; `exec` with `-m` beyond unit
tests; the page agents and the merger on a picked model with the real agents.
