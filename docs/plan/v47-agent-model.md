# V47 — A model for a workspace's agent

[Index](../PLAN.md) · [Journal](../journal/v47-agent-model.md)

**Status:** merged into `main` on 2026-10-24 (built 2026-10-24), on branch `feature/workspace-agent-model` (a
workspace started in Symbiote, from `main` at `f6e5408`; `main` merged in at `8dfdc6d`). The plan
OK'd by the person with its three questions answered: "1. Yes, should be set from the Settings. 2.
Should run in the background maybe ...every 24 hours or so..idk 3. Yes. Ok" — Scout, Scribe and
the merger get a model in Settings (V47c, decisions 342–343); Claude Code's list is kept on disk
and read again in the background once a day (decision 340, changed); its "Default (recommended)"
left out (337, confirmed). V47a–c built; "As built" and results at the end.

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
- **Scout, Scribe and the merger** (asked: "should be set from the Settings"): a Model in their
  Settings groups beside Effort, from their agent's list, saved in `symbiote/config.json`
  (`scout.model`, `scribe.model`, `merge.model`).
- **Unchanged**: a start without `model` gives each agent the same arguments as `main`
  (`agent.model` still passed to Claude Code when set); `POST /api/workspaces` without `model`;
  Scout, Scribe and the merger with no model set; `merge.model` written by hand; `symbiote diff`
  and `symbiote pr`. No graph or analysis change.

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
- **When** (decision 340, as the person answered): kept on disk in Symbiote's cache
  (`<cache>/agents/claude-models-<hash of the command>.json`, with when it was read), shared by
  every `symbiote view` on the machine. A use of a list a day old or older answers with it and
  reads it again in the background (one read at a time); only when none is kept does a use wait
  for the read (1.2 s, once). A failed read keeps the old list and is tried again at the next use.
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

## Settings: Scout, Scribe and the merger (V47c)

- **Config** (decision 342): `scout.model`, `scribe.model` (new) and `merge.model` (V26c, read by
  hand until now), each a model ID. Settings writes only a model the agent lists; removed by
  picking the default.
- **Settings page**: a "Model" item in the Scout, Scribe and Merger groups (Scout's and the
  merger's before their Effort). Its editor: a select of the agent's models — its default first,
  as on the start page, the merger's Claude Code default being Symbiote's ("Symbiote's default
  (sonnet)", V26c) —, the picked model's description, saved when picked ("Saved. Scout's next
  conversation starts on Sonnet 5.5."). Warnings as Effort's: no agent, a list Symbiote cannot
  read, a configured model the agent does not list.
- **Which agent's list**: Scout's and Scribe's default agent (`agent.kind`, else the first
  installed), the merger's (`merge.agent`, else the default), as their Effort.
- **The endpoints**: `GET /api/scout/efforts`, `/api/scribe/efforts` and `/api/merges/efforts`
  give each agent's `models` and `defaultModel` and the project's `model`; `POST
  /api/scout/model`, `/api/scribe/model`, `/api/merges/model` (`{ model: string | null }`) set it,
  as `…/effort` sets the level.
- **Used** (decision 343):
  - Scout and Scribe: a new conversation starts on `scout.model` / `scribe.model` when its agent
    lists it (the box can pick the other agent, whose list will not have it), else on
    `agent.model` (Claude Code, as today), else the agent's own; recorded with the conversation;
    the page's head says it ("…, with Claude Code on sonnet at high effort").
  - The merger: `merge.model` passed as today (a hand-written full model name keeps working);
    its log already names the model it asks.
  - Their Effort follows the model as the start page's does: Scout's box and Settings' stepper
    show the levels of the model the next conversation or run is on.

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
     unlisted); `startedWith` with a model; the Settings model choices (the merger's
     Symbiote default).
   - V47c CLI unit: `scout.model` and `scribe.model` read and written (`setModel`: listed only,
     null removes); a conversation started on the project's model when its agent lists it, not
     when the other agent is picked, `agent.model` otherwise; the record keeps it; the merger's
     `efforts()` lists its models and Symbiote's default; `setModel` writes `merge.model`; the
     levels shown follow the model; the kept list (a fresh file used, a day-old one used and read
     again, none read and awaited, a failed read keeping the old one).
2. **e2e** (`start.spec.ts`, `workspaces.spec.ts`, `codex-server.spec.ts`, `codex.spec.ts`): the
   fake Claude Code answers the `initialize` request with a short list (a model without levels,
   one without `xhigh`); the fake app server's `model/list` lists two models. New tests: the
   Model select lists the fake's models after "Claude Code's default"; picking Sonnet gives the
   fake `--model sonnet`, the default none; a model without levels hides Effort, one without
   `xhigh` drops a picked `xhigh` to the default; Codex's default named, its pick reaching
   `thread/start`; `exec`'s start and resume carrying `-m`; the draft keeping the model across a
   visit to History; the agent's change resetting it; the Brief tab's line. The keyboard test's Tab
   order gains the Model select. Settings (`settings.spec.ts`): Scout's, Scribe's and the merger's
   Model listed in their groups, a pick saved in the config file and read back, the merger's
   default naming Symbiote's `sonnet`; a Scout conversation started after a pick gives the fake
   `--model`. All of today's 221 pass.
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
| 1.2 s and a Claude Code process | Kept on disk for every view on the machine; read again in the background once a day; waited on only when no list is kept |
| A listed model the account cannot use | Claude Code's own list for this login; a start it refuses shows its words, as today |
| Claude Code's list goes stale (an update, a login) | At most a day old: read again in the background at the first use after that (the person's "every 24 hours or so") |
| A model that takes fewer levels than `--help` lists | Effort follows the model (decision 338): Opus 4.6 is not offered `xhigh` |
| Codex's `model/list` changes (`[experimental]`) | Read field by field, as V30b's levels |
| The model shown is not the session's any more (`/model` in its terminal) | Said as how the agent was started, on the Brief tab only (as decision 211) |

**Order**: V47a (the lists, `options()`, the request, passing and recording it, unit tests),
V47b (the select, effort following it, the draft, the Brief tab line, e2e, look), then V47c
(Settings for Scout, Scribe and the merger). One branch, committed per part.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V47a | The models | Claude Code's `initialize` read, Codex's `model/list` read, `models` on each agent option, `model` in the request, checked, passed (`--model`, `thread/start` or `turn/start`, `-m`), recorded, given again by Start again |
| V47b | The Model select | The select and its note, Effort following the model, the draft, the Brief tab's line, the fakes and e2e |
| V47c | Settings | `scout.model`, `scribe.model`, `merge.model` set in Settings from their agent's list; Scout's and Scribe's conversations started on it; their Effort following it |

**Decisions** (337 confirmed; 340 as the person answered; 342 asked; the others proposed):

| # | Question | Decision | Why |
|---|---|---|---|
| 336 | Which models | **The installed agent's own list: Claude Code's `initialize` answer, Codex's `model/list` (every page, not hidden); none when Symbiote cannot read one** | The ask ("queried from available models"). A fixed list in Symbiote would offer a model the login or the version does not have; the agents' lists differ by account and version |
| 337 | The default entry | **"<Agent>'s default", no flag: Codex's named from `config/read`, Claude Code's not; with `agent.model` in `symbiote/config.json`, "The project's (<model>)", passed as today. Claude Code's "Default (recommended)" entry left out** (confirmed) | Its entry is the account's recommended model, not the person's setting (measured: settings `haiku` and `--model sonnet` both still said Opus 5.5); offering it beside "Claude Code's default" would be two defaults, one of them overriding the person's `model` |
| 338 | Effort and model | **The levels shown are the picked model's; a picked level stays if the new model takes it; no Effort for a model with none; the default model keeps today's levels** | Claude Code's levels differ per model (Opus 4.6 has no `xhigh`, Haiku 4.5 none), and it ignores a level it does not take without failing (V30) |
| 339 | How the model reaches the agent | **Claude Code `--model` at the start; Codex `model` on `thread/start` (else the first `turn/start`, decided by the first real run), `-m` on every `exec` run; recorded, passed again by Start again** | As V30's levels: what each agent keeps for a session, measured, and the record for runs that keep nothing |
| 340 | When Claude Code's list is read | **Kept on disk for every view on the machine; read again in the background when a day old; waited on only when none is kept; a failed read keeps the old list** (as answered) | The person: "Should run in the background maybe ...every 24 hours or so". 1.2 s is too slow for every options read (V30b's warm read is 14–17 ms) |
| 341 | Where the model shows after | **The Brief tab's line, as how the agent was started: "Started with Claude Code on sonnet at high effort."** | As decision 211: `/model` in the agent's terminal changes it, and Symbiote does not read it back |
| 342 | Scout's, Scribe's and the merger's model | **Set in Settings, in their groups beside Effort, from their agent's list: `scout.model`, `scribe.model`, `merge.model`** (asked) | The person: "should be set from the Settings". Their Effort is set there already (fix/scout-effort-level, V46d) |
| 343 | When a project's model is used | **Scout and Scribe: when the conversation's agent lists it, else `agent.model` (Claude Code), else the agent's own. The merger: `merge.model` as today, unchecked** | Scout's box can pick the other agent, whose list will not have the model. `merge.model` has been passed as written since V26c; a full model name Claude Code takes but does not list must keep working |

**Not in V47 (later)**: a model picked per conversation in Scout's box (Settings sets it, as
asked); a project default for workspaces picked in Settings (`agent.model` stays a file setting);
the model of a running session read back or changed from Symbiote; Codex's model without its
daemon offered (no list to read).

## As built (V47)

- **Codex takes the model on `thread/start`** (decision 339), decided before building: a real
  thread started on `gpt-5.6-luna` (the configured model is `gpt-6-luna`) ran its two turns on it,
  and a third after `thread/resume` in a new app-server process; each turn's `turn_context.model`
  in its rollout. The thread was archived.
- **Claude Code's list is kept per program** in `<cache>/agents/claude-models-<hash>.json` (`read`,
  `models`), checked when read back as Claude Code's own answer is. No read is begun by the first
  workspaces request, as the plan had it: with the list on disk, only the first view on a machine
  waits for it (1.3 s), once.
- **Codex's models are a call of their own** (`CodexServer.models`, every page of `model/list`),
  beside `efforts`, which is unchanged: the options read opens one more connection to the app server
  (1–3 ms warm, below).
- **`POST /api/workspaces`'s parser** (`server.ts`) dropped fields it did not know: `model` is
  passed through and checked as a string; found before the V47a commit, with its test.
- **One check of a level on a model** (`effortOnProblem`) for the workspaces, Scout and Scribe, and
  the merger: "Haiku 4.5 takes no effort level: start it at its default", "Opus 4.6 takes low,
  medium, high or max: xhigh". The merger's log: "merge.effort is high, which Haiku 4.5 does not
  take: its own level".
- **Defaults named in Settings**: Scout's and Scribe's is `agent.model` when set (Claude Code), else
  Codex's configured model; the merger's Claude Code default is "Symbiote's default (sonnet)". A
  `defaultModel` is given only with a list Symbiote could read.
- **A `merge.model` its agent does not list** is said in Settings ("…: the merger asks on it as
  written"), and still passed (decision 343); a `scout.model` or `scribe.model` it does not list,
  "…: Scout starts on the default".
- **The model's note was bold**: inside its field the label's weight carried. Seen in the
  screenshots; the run column's notes are regular now.
- **`main` merged in** before finishing (RM2, two fixes, among them the `Treemap.tsx`/`treemap.ts`
  name clash that failed `files.test.ts` on this branch's base); only `docs/JOURNAL.md` conflicted
  (both appended). V47 and decisions 336–343 are used on no other branch.

## Results (V47)

**Tests.** Written first and seen red for the right reason: 15 CLI tests (V47a: no `models`, no
`parseClaudeModels`, no `-m`, no `model` on `thread/start`), 1 server parser test, 5 viewer unit
tests and 3 e2e tests (V47b: no Model select on the old page), 8 CLI tests and 3 e2e tests (V47c:
no `setModel`, no Model item in Settings). After `main` merged in: `pnpm check` (format, lint,
typecheck, 1,569 unit tests in 113 files), build, e2e 239 of 239.

**With the real agents** (Claude Code 2.1.310, Codex 0.163, this machine):

| What | Result |
|---|---|
| Symbiote's read of Claude Code's models (`claudeCode().models()`, built) | 12 models, its "Default (recommended)" left out; Haiku 4.5 without levels, Opus 4.6 and Sonnet 4.6 without `xhigh`; 1,415 ms; another view reads them from the file in 0.1 ms |
| A Claude Code session started through Symbiote's start on `haiku` at `low`, in a detached worktree of this repository | First turn `claude-haiku-5-5` at `low` (the person's default is Opus at `xhigh`); after Symbiote's reply (stop, `--resume` without flags) the same; session removed, worktree deleted |
| A Codex thread on `gpt-5.6-luna` (`thread/start`'s `model`) | Three turns on it, the third after a resume in a new server; archived |

**Cost**: `GET /api/workspaces/options` in a scratch repository, both agents installed, `main`'s
build against the branch's, two runs each:

| Build | First read | Warm (3 reads) |
|---|---|---|
| `main` | 243–244 ms | 13–17 ms |
| Branch, no list kept (the first view on a machine) | 1,275–1,307 ms | 15–17 ms |
| Branch, list kept | 246–250 ms | 16–19 ms |

**Look**: the start page (Claude Code's default, Opus 4.6, Haiku 4.5 without Effort, Codex) and
Settings' Scout and Merger Model at 1280, 1440 and 390 px, dark and light.

Not verified: a Codex workspace started through Symbiote's endpoint (it would leave a trust entry
for a throwaway folder in the person's Codex configuration; the thread's start was measured
directly, and the e2e checks Symbiote sends `model`); Codex `exec` with `-m` beyond unit tests;
Scout, Scribe and the merger on a picked model with the real agents (unit and e2e with the fakes);
Claude Code's list on an API key, Bedrock or Vertex login; the Electron window; macOS and Windows.
