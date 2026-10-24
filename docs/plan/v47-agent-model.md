# V47 — A model for a workspace's agent

[Index](../PLAN.md) · [Journal](../journal/v47-agent-model.md)

**Status:** planned (2026-10-24), on branch `feature/workspace-agent-model` (a workspace started
in Symbiote, from `main` at `f6e5408`); waiting for the person's OK. Not started.

**Problem** (asked: "At the moment there is no way to choose a model per agent. There should be a
selector with the model. The model should be queried from available models, respective to Claude
code / Codex."). Start a workspace offers the agent, its effort (V30b) and its permission, not its
model. Each agent runs on the model it would run on anyway:

| Agent | Today's model | Where it comes from |
|---|---|---|
| Claude Code | `--model <agent.model>` when `symbiote/config.json` names one, for every workspace (and Scribe); else Claude Code's own (`"model": "opus"` in the person's `~/.claude/settings.json` here) | One value per project, in a file; no choice per workspace |
| Codex (app server or `exec`) | Codex's own (`model = "gpt-6-luna"` in `~/.codex/config.toml` here, read by `config/read`) | Never passed by Symbiote |

What the installed agents list, measured on this machine (Claude Code 2.1.310, Codex 0.163):

| Agent | How to ask | Measured |
|---|---|---|
| Claude Code | No subcommand lists models (`claude --help`'s commands). Its SDK asks the CLI with the `initialize` control request on `claude -p --input-format stream-json --output-format stream-json`; the answer's `models` is what the SDK's `supportedModels()` returns | 13 models, each `value` (what `--model` takes: `opus`, `sonnet`, `claude-opus-4-6`…), `displayName`, `description` and `supportedEffortLevels`. 1,224–1,235 ms in this repository with `--safe-mode` (3 runs; 1,312 ms without it, which also runs the person's SessionStart hooks). Closing stdin after the answer ends it with exit 0: no turn, no `result` line, no transcript written (`--no-session-persistence`; the project folder's file count 1 before and after) |
| Claude Code's levels per model | `supportedEffortLevels` | Not the same for every model: `claude-opus-4-6` and `claude-sonnet-4-6` take low, medium, high, max (no `xhigh`); `claude-haiku-4-5-20251001` takes none. `--help` lists the five for all |
| Claude Code's "default" | The list's first entry, `value: "default"`, "Default (recommended)", "Opus 5.5 · …" | It is the account's recommended model, not the person's setting: with `--settings '{"model":"haiku"}'` and with `--model sonnet` it still said Opus 5.5 |
| Codex | `model/list` on its app server (already called for its effort levels, V30b) | 3 models, one page (`nextCursor` null): `gpt-6-luna` (`isDefault`), `gpt-5.6-terra` (adds `ultra`), `gpt-5.6-luna`; each `id`, `model`, `displayName`, `description`, `hidden`, `supportedReasoningEfforts`, `defaultReasoningEffort`. 1.1 s on a fresh stdio server (V30 measured 1.1 ms on the daemon) |

How each agent takes a model:

| Agent | Given by |
|---|---|
| Claude Code | `--model <value>` on `claude --bg` (`ClaudeCode.start` passes it today when `agent.model` is set). Symbiote's replies resume the session without flags, and V30's spike saw Claude Code wake it "with its saved options (--name, --effort, --model)" |
| Codex, app server | `model` on `thread/start` (the thread's setting), or on `turn/start` ("for this turn and subsequent turns", as `effort`); `thread/resume` takes one too (the generated schema of 0.163) |
| Codex, `exec` | `-m, --model <MODEL>` on `codex exec` and on `codex exec resume` |

What causes it:
- V30 left "a model per workspace" for later; `agent.model` (V18) is a project setting, read once
  when Claude Code is found, and only for Claude Code.
- Symbiote reads each agent's effort levels but not its models, so it has nothing to offer.

**Goal**:

```
│ Branch             │
│ [feature/add-clamp]│
│ Agent              │
│ [Claude Code     ▾]│
│ your Max subscr…   │
│ Model ?            │
│ [Claude Code's d…▾]│   ← Claude Code's default, Opus 5.5, Fable 5.1, Sonnet 5.5, Haiku 5.5, …
│ For complex work…  │   ← the picked model's description, from the agent
│ Effort ?           │
│ ●──○──○──○──○──○   │   ← the picked model's levels
│ Permission         │
│ [Auto            ▾]│
│ ☑ Plan first       │
```

- **A Model select** on the start page's Run column, under the agent: "<Agent>'s default" first,
  then every model the installed agent lists, by its own name and in its own order.
- **The list is the agent's**: Claude Code's from its `initialize` answer, Codex's from
  `model/list`. When Symbiote cannot read one, no Model choice (as Effort, decision 209).
- **Effort follows the model**: the levels shown are the picked model's.
- The model goes to the agent when its session starts, is recorded with the workspace, used
  again by Start again, and said on the Brief tab as how the agent was started.
- **Unchanged**: a start without `model` gives each agent the same arguments as `main`
  (`agent.model` still passed to Claude Code when set); `POST /api/workspaces` without `model`;
  Scout, Scribe and the merger; `symbiote diff` and `symbiote pr`. No graph or analysis change.

## The list (core, cli)

- **Types** (core, `workspaces.ts`): `AgentModel { id: string; name: string; description?: string;
  efforts?: AgentEfforts }`; `AgentOption.models?: AgentModel[]` and `AgentOption.model?: string`
  (the model used without a pick, when Symbiote knows it); `WorkspaceRequest.model?: string`;
  `WorkspaceAgentState.model?: string`. A `MODEL_ID` pattern for what Symbiote passes and reads
  back: starts with a letter or digit, no spaces, at most 100 characters (never an option).
- **Claude Code** (`claudeCode().models()`, `workspaces.ts`): `claude -p --input-format
  stream-json --output-format stream-json --verbose --no-session-persistence --safe-mode
  --strict-mcp-config --tools ''` in the repository's root; it writes one `initialize` control
  request, reads lines until its `control_response`, closes stdin. Parsed field by field
  (`parseClaudeModels`): `value` as the ID, `displayName` as the name, `description`,
  `supportedEffortLevels` (words only) as the levels; the `default` entry left out (decision
  337). 20 s at most; no answer, an error, or no `models`: null, and no Model choice.
- **When** (decision 340): once per `symbiote view`, as `--help` is, begun by the first
  workspaces request (the sidenav's list at page load), so the start page rarely waits; the
  options read waits for it if it has not ended. A failed read is tried again at the next options
  read, not kept.
- **Codex** (`CodexServer.models(cwd)`, `app-server.ts`): `config/read`, then `model/list`'s
  pages (`cursor`, at most 5), models not `hidden`; `model` (the ID `--model` and `thread/start`
  take) as the ID, `displayName`, `description`, `supportedReasoningEfforts` and
  `defaultReasoningEffort` as the levels. The configured `model` (else the `isDefault` one) is
  `AgentOption.model`. It replaces `efforts(cwd)`: one read gives both, on the connection the
  efforts already use. Without the daemon (`exec`): no list, no Model choice.
- **`options()`** gives `models` and `model` with each agent; `efforts` stays the default model's
  levels (Claude Code's `--help`, Codex's configured model), as today.

## The start page (viewer)

- **Model** (`StartPage.tsx`): a select under the agent and its account, labelled "Model" with
  a "?" ("The model its session starts on; change it later in its terminal (/model)"). Entries:
  - the default (decision 337): "Claude Code's default" (unnamed: Claude Code does not report
    the person's setting, and its own "Default (recommended)" is not it, measured), "Codex's
    default (GPT-6-Luna)" (named from `config/read`), or, with `agent.model` in
    `symbiote/config.json`, "The project's (sonnet)";
  - then each listed model by `name`.
  The picked model's `description` is a muted line under the select (it is that select's note).
- **Effort follows it** (decision 338, `effortChoices` in `workspaces.ts`): the picked model's
  levels; the default's are `AgentOption.efforts`, as today. A picked level is kept when the new
  model takes it, else the stepper goes back to the default. A model with no levels (Haiku 4.5):
  no Effort field.
- **The draft** (`RunChoices.model`, `readRun`): the model is kept with its agent, only while
  that agent lists it. Changing the agent goes back to its default model (a model is one agent's).
  After a start only the kind is kept, as today.
- **The request** carries `model` only when one is picked.
- **Brief tab** (`startedWith`, decision 341): "Started with Claude Code on sonnet at high
  effort." — the recorded ID, as `--model` was given it; without a pick, as today.
- Styles: the select and the note reuse the Run column's (`workspace-field`, `dialog-note`); no
  new tokens. Checked with the `symbiote-style` skill.

## Starting with it (cli)

- **Checked** in `start()` (`modelFor`, beside `effortFor`): a model must be one the picked agent
  lists (400, "Claude Code lists no model gpt-5: pick one it lists"); refused for an agent with no
  list, and when it is not a `MODEL_ID`. A level must be one the picked model takes (400,
  "Haiku 4.5 takes no effort level").
- **Passed** (decision 339):
  - Claude Code: `--model <id>` on `claude --bg` (`ClaudeCode.start`), in place of `agent.model`'s
    when both are there. Replies (stop, `--resume`) keep it.
  - Codex on its app server: `model` on `thread/start` (`CodexServer.start`), if the build's
    first real run shows the thread keeping it through a later turn and a `thread/resume` on a new
    connection; else on the first `turn/start`, as `effort`.
  - Codex by `exec`: `-m <id>` in `codexArgs`, on the start and on every `exec resume`, from the
    record (it keeps nothing between runs, as the level and the sandbox).
  - Start again (`startAgent`) passes the recorded model again, as it does the level.
- **Recorded**: `WorkspaceAgentRecord.model`, read back by `asAgent` only as a `MODEL_ID`, and
  given with the workspace's summary.

## Verification

1. **Tests first** (red before).
   - CLI unit: `parseClaudeModels` on today's answer (13 models, `default` left out, Haiku 4.5
     without levels, Opus 4.6 without `xhigh`), on an answer without `models`, on IDs that are not
     `MODEL_ID`s; `claudeCode().models()`'s arguments and its written request, a timeout and a
     failed run giving null, a failure read again; `CodexServer.models` from `config/read` and
     `model/list` (configured, default, hidden, two pages, missing fields); `options()` offers
     both lists; `start()` passes `--model` for a pick, `agent.model` without one, nothing with
     neither (the same arguments as `main`); refuses an unlisted model, a model for an agent with
     no list, a level the model does not take; records the model; Start again passes it;
     `codexArgs` with `-m` on `exec` and `exec resume`; `CodexServer.start` sends `model`; a
     record from before V47 reads without one.
   - Viewer unit: the model choices (each default's words, the agent's order); the effort choices
     following a model (kept, dropped, none); `readRun` with a model (kept, another agent's,
     unlisted); `startedWith` with a model.
2. **e2e** (`start.spec.ts`, `workspaces.spec.ts`, `codex-server.spec.ts`, `codex.spec.ts`): the
   fake Claude Code answers the `initialize` request with a short list (a model without levels,
   one without `xhigh`); the fake app server's `model/list` lists two models. New tests: the
   Model select lists the fake's models after "Claude Code's default"; picking Sonnet gives the
   fake `--model sonnet`, the default none; a model without levels hides Effort, one without
   `xhigh` drops a picked `xhigh` to the default; Codex's default named, its pick reaching
   `thread/start`; `exec`'s start and resume carrying `-m`; the draft keeping the model across a
   visit to History; the agent's change resetting it; the Brief tab's line. The keyboard test's Tab
   order gains the Model select. All of today's 221 pass.
3. **Real agents**: a Claude Code workspace started through Symbiote's endpoint on `haiku` at
   `low`: its transcript's assistant lines on `claude-haiku-5-5`, again after Symbiote's reply
   (stop, resume), one session; removed after. A Codex thread on the person's daemon, in a
   detached worktree of this repository, on `gpt-5.6-luna`: its rollout's `turn_context.model`
   on the first turn and a later one, and after a `thread/resume` on a new connection; archived
   after. This decides `thread/start` against `turn/start` (decision 339).
4. **Look** (`viewer-check`, `symbiote-style`): the start page at 1280, 1440 and 390 px, dark and
   light, each agent, the default and a picked model, a model without Effort; every page and
   state the change touches (the Brief tab).
5. **Nothing else changes**: a start without `model` gives the same arguments as `main` (unit
   tests); no graph or analysis change, so no `regression-check`.
6. **Cost**: `GET /api/workspaces/options` cold and warm, `main` against the branch (V30b: 263 ms
   cold, 14–17 ms warm); the Claude Code read's time in the view's first second; nothing added to
   a warm read.

**Risks**

| Risk | Mitigation |
|---|---|
| The `initialize` answer changes (it is the SDK's protocol with the CLI, not a documented command) | Read field by field; no `models`: no Model choice, never a guessed list. A unit test holds today's answer |
| The read runs the person's hooks or plugins | `--safe-mode` (no hooks, plugins, MCP servers, CLAUDE.md); settings, auth and model selection still apply, so the list is the one the person's sessions get (13 with and without it, measured) |
| 1.2 s and a Claude Code process once per `symbiote view` | Begun by the first workspaces request, in the background; only views that serve workspaces; kept for the run |
| A listed model the account cannot use | Claude Code's own list for this login; a start it refuses shows its words, as today |
| Claude Code's list goes stale in a long-running view (an update, a login) | Read again at the next `symbiote view`; a failed read is tried again. Said in the plan; not re-read on a timer |
| A model that takes fewer levels than `--help` lists | Effort follows the model (decision 338): Opus 4.6 is not offered `xhigh` |
| Codex's `model/list` changes (`[experimental]`) | Read field by field, as V30b's levels |
| The model shown is not the session's any more (`/model` in its terminal) | Said as how the agent was started, on the Brief tab only (as decision 211) |

**Order**: V47a (the lists, `options()`, the request, passing and recording it, unit tests) then
V47b (the select, effort following it, the draft, the Brief tab line, e2e, look). One branch,
committed per part.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V47a | The models | Claude Code's `initialize` read, Codex's `model/list` read, `models` on each agent option, `model` in the request, checked, passed (`--model`, `thread/start` or `turn/start`, `-m`), recorded, given again by Start again |
| V47b | The Model select | The select and its note, Effort following the model, the draft, the Brief tab's line, the fakes and e2e |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 336 | Which models | **The installed agent's own list: Claude Code's `initialize` answer, Codex's `model/list` (every page, not hidden); none when Symbiote cannot read one** | The ask ("queried from available models"). A fixed list in Symbiote would offer a model the login or the version does not have; the agents' lists differ by account and version |
| 337 | The default entry | **"<Agent>'s default", no flag: Codex's named from `config/read`, Claude Code's not; with `agent.model` in `symbiote/config.json`, "The project's (<model>)", passed as today. Claude Code's "Default (recommended)" entry left out** | Its entry is the account's recommended model, not the person's setting (measured: settings `haiku` and `--model sonnet` both still said Opus 5.5); offering it beside "Claude Code's default" would be two defaults, one of them overriding the person's `model` |
| 338 | Effort and model | **The levels shown are the picked model's; a picked level stays if the new model takes it; no Effort for a model with none; the default model keeps today's levels** | Claude Code's levels differ per model (Opus 4.6 has no `xhigh`, Haiku 4.5 none), and it ignores a level it does not take without failing (V30) |
| 339 | How the model reaches the agent | **Claude Code `--model` at the start; Codex `model` on `thread/start` (else the first `turn/start`, decided by the first real run), `-m` on every `exec` run; recorded, passed again by Start again** | As V30's levels: what each agent keeps for a session, measured, and the record for runs that keep nothing |
| 340 | When Claude Code's list is read | **Once per `symbiote view`, begun by the first workspaces request, awaited by the options read; a failed read tried again** | 1.2 s: too slow for every options read (V30b's warm read is 14–17 ms), too slow to make the start page wait on its first open |
| 341 | Where the model shows after | **The Brief tab's line, as how the agent was started: "Started with Claude Code on sonnet at high effort."** | As decision 211: `/model` in the agent's terminal changes it, and Symbiote does not read it back |

**Not in V47 (later)**: a model for Scout's conversations, for Scribe, and for the merger
(`merge.model` stays a file setting); a project default picked in Settings (`agent.model` stays
a file setting); the model of a running session read back or changed from Symbiote; Codex's
model without its daemon offered (no list to read).
