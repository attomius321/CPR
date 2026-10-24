# V30 — Start a workspace on a page, with the agent's effort

[Index](../PLAN.md) · [Journal](../journal/v30-start-page.md)

**Status:** merged into main (2026-10-21, from branch `milestone/v30-start-page`): V30a and V30b,
their "As built" and results below. Decisions 207 and 211 and what is left out confirmed by the
person (2026-10-21); 210 left to Symbiote ("Idk"), kept as proposed; 205, 206, 208 and 209 proposed.
The Brief tab, where 211's line goes, drew the brief's Markdown as source: fixed on its own
branch first (`fix/brief-markdown`, merged into main 2026-10-21).

**Problem** (asked: "the create a workspace should not be in dialog. it should be itself a page,
rendered fully on the right of sidenav, and with an option for initial effort, for that
session"). Since V29a every page shows in the main area beside the sidenav; starting a workspace
is the one thing still drawn over it, in V18's dialog (V24c's fields).

Measured on `main` (`c280663`) in Chromium, `serveWorkspaces` with the fake Claude Code and Codex,
the dialog opened with `n` on History:

| What | Today |
|---|---|
| Where | A modal dialog over the whole window: the sidenav, History or a workspace behind it cannot be used while it is open |
| Its box, More closed, at 1280×720 · 1440×900 · 1920×1080 | 640×626 px at every size: 55 · 38 · 23 % of the main area (1,040–1,680 px wide). 358×669 at 390×844 |
| More open (Where to look, Out of scope, Notes) | 883 px of content: it scrolls inside the dialog at 1280×720 (686 px shown), 1440×900 (866) and 390×844 (810 of 926); it fits only at 1920×1080 |
| Text areas | 598 px wide at every size; the required part 5 rows (108 px), the others 2 (52 px) |
| The agent's options | One muted line under Plan first: agent ▾ · account · permission ▾ (Claude Code) or "sandbox: its worktree and branch" (Codex) |
| Effort | Not offered. Each agent runs at its own default: here Claude Code `xhigh` (the person's `effortLevel`), Codex `medium` (`model_reasoning_effort` in `~/.codex/config.toml`) |
| e2e | ≈ 52 of 158 tests, in 9 specs, start a workspace through the dialog, most through one helper per spec |

How each agent takes an effort level, measured with the real agents (Claude Code 2.1.306,
Codex 0.163 on its daemon; one-word prompts in a worktree of this repository, each turn's level
read from the agent's own transcript: Claude Code's `effort` on every assistant line, Codex's
`turn_context.effort` in its rollout):

| Agent | Given by | Measured |
|---|---|---|
| Claude Code | `--effort <level>`: "low, medium, high, xhigh, max" in its `--help` (70–90 ms to read) | `--bg --effort low` → `low`. Stopped, then `--bg --resume <id> "<text>"` as Symbiote replies (V18c): "woke session … with its saved options (--name, --effort, --model)", `low` again. A resume of a running session makes a copy, which ran at `medium` (Symbiote never does that). All five levels accepted on Haiku, Sonnet and Opus 5.5. An unknown level: a warning on stderr, the default used, exit 0. No flag: the person's default (`xhigh` here) |
| Codex, app server (V27a) | `effort` on `turn/start`, "for this turn and subsequent turns"; `thread/start` answers the thread's `reasoningEffort` | First turn with `low` → `low`; a second turn without it → `low`; `thread/resume` on a new connection (Symbiote opens one per call) reports `low`. `model/list` (1.1 ms) gives each model's levels and default: `gpt-6-luna` low, medium, high, xhigh, max, default medium; `gpt-5.6-terra` adds `ultra`. `config/read` (3 ms) gives the configured model and `model_reasoning_effort` |
| Codex, `exec` (V20a, without the daemon) | `-c model_reasoning_effort="<level>"` | Start `low` → `low`; `exec resume` without it → `medium`: like the sandbox, it must be given on every run |

What causes it:
- The start came before the shell (V18, V24c) as a dialog over whichever page was open; V29a
  moved every page into the main area and left the dialog as it was.
- A dialog is sized for the smallest window: 640 px wide, More folded away, the agent's options on
  one line. On a page the brief has the main area's width and height.
- Symbiote passes an agent no effort: only the permission mode (Claude Code) and the model
  (`agent.model` in `symbiote/config.json`, every workspace).

**Goal**:

```
┌──────────────────┬─────────────────────────────────────────────────────────────┐
│ Symbiote · repo       │ Start a workspace   from main at 1280b76   Cancel Clear Start │
│ ◷ History      h ├────────────────────────────────────────┬────────────────────┤
│ ⚙ Settings     s │ Feature  Fix  Refactor  Chore  Spike ⓘ │ Branch             │
│                  │ Title                                  │ [feature/add-clamp]│
│ Workspaces     ⊕ │ [                                    ] │ in …/feature-add-… │
│ ● Working 2      │ Goal                                   │ Agent              │
│   Add clamp      │ [                                    ] │ [Claude Code     ▾]│
│   Document …     │ [                                    ] │ your Pro subscr…   │
│                  │ Done when  optional                    │ Effort             │
│                  │ [                                    ] │ [Claude Code's de▾]│
│                  │ › More: Where to look, Out of scope, … │ Permission         │
│                  │                                        │ [Auto            ▾]│
│                  │                                        │ ☑ Plan first       │
├──────────────────┴────────────────────────────────────────┴────────────────────┤
│ status bar                                                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

- **A page, not a dialog**: "Start a workspace" opens in the main area, right of the sidenav,
  at `/start`; the sidenav and the status bar stay usable.
- **The brief on the left, the run on the right**: the kind, title and parts in a column up to
  760 px wide; the branch, the agent, its effort, its permission or sandbox, and Plan first in a
  300 px column. At 1440×900, More open, nothing scrolls.
- **Effort**: one more choice beside the agent: its default, or a level the installed agent
  lists. It is given to the agent when its session starts, kept by the agent for that session,
  and recorded with the workspace.
- **Unchanged**: what a start does (the branch, its worktree, the record, the agent, the brief
  `briefOf` makes), the draft (V24c), the kinds and their parts, the check guess, the agent's
  permission and sandbox, `POST /api/workspaces` without `effort`, `symbiote diff` and `symbiote pr`.

## The page (viewer)

- **Route**: `{ page: 'start'; at?: string }` at `/start`, and `/start?at=<sha>` for a commit
  picked in History (decision 205). `inShell`, `routeTitle` ("Start a workspace") and N1's title
  bar label know it.
- **`src/StartPage.tsx`** replaces `StartWorkspaceDialog.tsx` and `WorkspaceStarter.tsx`: it reads
  `/api/workspaces/options`, `/api/refs` and the draft as the starter did, then the check guess
  at the commit. Its form logic (`brief.ts`) is unchanged.
- **Head strip** (as a workspace's, 40 px, fixed while the body scrolls): "Start a workspace",
  where it starts ("from `main` at 1280b76", or "from the commit 1a2b3c4"); on the right Cancel,
  Clear and Start (Ctrl+Enter; "Make the branch" without an agent). A refused start's words show
  under the strip (`role="alert"`), where they are seen without scrolling.
- **Body** (decision 206): two columns where the main area is at least 1,000 px wide (a
  container query: 1,040 px at 1280 with the sidenav), one below it, the run under the brief.
  - Brief: the kinds and ⓘ, Title, the kind's required part (7 rows), Done when (3), the guess,
    More and its parts (3 rows each), the brief's length near its limit.
  - Run: Branch and the worktree folder under it; Agent (a select when two are installed) and its
    account; Effort; Permission (Claude Code) or the sandbox's words (Codex); Plan first; the
    `ANTHROPIC_API_KEY` warning.
- **Ways in**: the sidenav's ⊕ (shown pressed on `/start`), `n` anywhere in the shell (on
  `/start` it focuses Title), "Start a workspace here" in History's row menu (`/start?at=`), the
  empty sidenav's hint. On a diff (its own document, `DiffShell`) the ⊕ and `n` load `/start`.
  `useShell().startWorkspace(sha?)` navigates; `starting` goes (History no longer waits on a
  dialog).
- **Ways out** (decision 207): the draft is saved as typing pauses and when the page is left, as
  the dialog's was, so leaving loses nothing. Cancel and Escape go back to the route shown before
  `/start` (the shell keeps it), else History. A start replaces `/start` in the history with the
  workspace's address: Back does not return to an emptied form. Title and Branch get
  `autocomplete="off"`, so Escape never only closes a browser's list.
- `startedNotice` and the flash on the new card stay.

## Effort (core, cli, viewer)

- **Types** (core): `AgentOption.efforts?: { levels: string[]; default?: string }` — what the
  installed agent takes, and its default when Symbiote can read it; `WorkspaceRequest.effort?:
  string`; `WorkspaceAgentState.effort?: string`, the level it was started at. Absent everywhere
  means the agent's own default: no flag, as today.
- **Which levels** (decision 209): the installed agent's own list, never one of Symbiote's.
  - Claude Code: the `--effort <level>` line of `claude --help`, read once per `symbiote view` (70–90
    ms) and parsed from its parenthesis. A Claude Code whose help has no such line gets no Effort
    choice. A fixed list in Symbiote could offer a level Claude Code dropped, which it would ignore
    without failing (measured: a warning on stderr, the default, exit 0).
  - Codex: on its app server, `config/read` (the configured `model` and
    `model_reasoning_effort`), then `model/list`: that model's `supportedReasoningEfforts`, else
    the `isDefault` model's; `default` from the configuration, else the model's
    `defaultReasoningEffort`. Read field by field: these are `[experimental]` APIs. Without its
    daemon (`exec`), no Effort choice.
- **The default** (decision 210): the select's first entry is "Claude Code's default" or "Codex's
  default (medium)": the agent's level is named when Symbiote reads it from the agent (Codex), not
  when it would have to resolve the agent's settings files (Claude Code: user, project, local,
  managed, per-model). A new form starts at the default; the draft keeps a picked level until the
  start (it is for that session), then only the kind, as today. Changing the agent keeps a level
  the other agent lists, else the default.
- **Passing it** (decision 208):
  - Claude Code: `--effort <level>` on `claude --bg` (`ClaudeCode.start`). Symbiote replies by stopping
    the session and resuming it without flags (V18c), which keeps it (measured).
  - Codex on its app server: `effort` on the thread's first `turn/start` (`CodexServer.start`);
    the server keeps it for the thread's next turns, Symbiote's messages and the person's in Codex's
    terminal (measured).
  - Codex by `exec`: `-c model_reasoning_effort="<level>"` in `codexArgs`, on the start and on
    every `exec resume`, from the record.
  - Start again (`startAgent`, a new session or thread) passes the recorded level again, as it
    does the permission mode.
- **Checked** (`start()`): a level the picked agent does not list is refused (400, "Claude Code
  takes low, medium, high, xhigh or max: ultra"), as is one for an agent with no list.
- **Recorded**: `WorkspaceAgentRecord.effort`, read back by `asAgent` only as a short word
  (`/^[a-z][a-z-]{0,23}$/`), and given with the workspace's summary.
- **Shown after the start** (decision 211): the Brief tab's first line says how the agent was
  started: "Started with Claude Code at high effort, permission Auto". Not on the card or the
  head: the person can change the level in the agent's terminal (Claude Code's `/effort`), and
  Symbiote does not read it back.

## Verification

1. **Tests first** (red before). Viewer unit: `routeOf`/`hrefOf` for `/start` and `?at=`, the
   title; the effort choices for an agent (its levels, the default's words, a level kept or
   dropped when the agent changes); the Brief tab's line. CLI unit: `--help` parsed (today's
   text; no `--effort` line; a level added); `ClaudeCode.start` with and without `effort`;
   `codexArgs` with `effort` on `exec` and `exec resume`; `CodexServer.start` sends `effort` on
   its first `turn/start` (the fake server records it); `CodexServer` levels from `config/read`
   and `model/list` (configured model, default model, missing fields); `options()` offers them;
   `start()` refuses an unknown level and a level for an agent without a list, records a known
   one; `startAgent` passes it again; a reply by `exec resume` passes it; a pre-V30 record reads
   without one.
2. **e2e**: the ≈ 52 tests that start through the dialog start from the page (their helpers
   first, in V30a, before anything else moves); new ones: `/start` from ⊕, `n`, a row's "Start a
   workspace here" (the From line has its commit) and a diff's ⊕ (a full load); Cancel and Escape
   back to the page it came from; the draft kept across a visit to History and back; Back after
   a start skips `/start`; two columns at 1440 and one at 390; More open without a scroll at
   1440×900; the fake Claude Code's args carry `--effort high` for a picked level and none for
   the default; the fake app server's `turn/start` carries `effort`; the fake `codex exec`'s
   start and resume carry `model_reasoning_effort`; the Brief tab's line. The fakes answer
   `--help`, `config/read` and `model/list`. All of today's 158 pass.
3. **Real agents**: a Claude Code workspace started from the page at `low`: its transcript's
   turns `low`, and again after a reply (stop, resume). A Codex workspace at `low`: its rollout's
   first and a later turn `low`, one of them typed in its terminal.
4. **Look** (`viewer-check`): the page at 1280, 1440, 1920 and 390 px, dark and light, More
   closed and open, each agent.
5. **Nothing else changes**: no graph or analysis change (no `regression-check`); a start without
   `effort` gives the agent the same arguments as `main` (unit tests compare them).
6. **Cost**: `/api/workspaces/options` before and after (one `claude --help` per run, 70–90 ms;
   two app-server calls, ~4 ms); from `n` to the Title's focus, dialog against page.

**Risks**

| Risk | Mitigation |
|---|---|
| Removing the dialog breaks ≈ 52 e2e tests | V30a moves each spec's helper to the page first, with the start's behaviour unchanged; the start's own tests keep their assertions |
| Escape on a page leaves it by surprise | The draft is kept (nothing lost); `autocomplete="off"` on the text inputs; Escape in a select, the ⓘ or More is theirs |
| Claude Code's help changes its wording | No Effort choice, never a wrong one; a unit test holds today's text |
| Codex's `model/list` or `config/read` change (`[experimental]`) | Read field by field; no Effort choice rather than a guess |
| A level the model does not take | Claude Code took all five on Haiku, Sonnet and Opus 5.5; Codex lists levels per model |
| Higher effort spends the subscription faster | The person picks it per workspace; the default stays the agent's; the status bar shows usage (V29c) |
| The level shown is not the session's any more (`/effort` in its terminal) | It is said as how the agent was started, on the Brief tab only |

**Order**: V30a (the page) first: it is most of the ask and moves the e2e helpers once. V30b
(effort) on the page's Run column.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V30a ✅ | The page | `/start` in the shell, `StartPage.tsx` (head strip, two columns, one below 1,000 px), the ways in and out, the dialog and `WorkspaceStarter` gone, the e2e helpers moved |
| V30b ✅ | Effort | The levels from each agent, `effort` in the request, the record and the summary, `--effort` / `turn/start` / `model_reasoning_effort`, the Effort select, the Brief tab's line |

**Decisions** (207 and 211 confirmed; 210 left to Symbiote; the others proposed):

| # | Question | Decision | Why |
|---|---|---|---|
| 205 | Where the start is | **A page at `/start` (`?at=<sha>` for a commit) in the main area; the dialog goes** | The person's ask. The dialog covers the window, and with More open it scrolls at 1280×720, 1440×900 and 390×844 (883 px of content) |
| 206 | Its layout | **The brief in a column up to 760 px, the run in a 300 px column beside it; one column under 1,000 px of main area** | The text areas get the width; the run's choices are short. A container query, so the sidenav's rail and drawer change it as the window does |
| 207 | Leaving it | **The draft keeps the form; Cancel and Escape go back to the page before; a start replaces `/start` in the history** (confirmed) | V24c's draft already makes leaving lossless; keys stay as the dialog's (`n` … Escape); Back after a start should not show an emptied form |
| 208 | How the effort reaches the agent | **Claude Code `--effort` at the start; Codex `effort` on the first `turn/start`, or `-c model_reasoning_effort` on every `exec` run; recorded, passed again by Start again** | Measured: Claude Code and Codex's app server keep it for the session; `exec resume` drops it |
| 209 | Which levels | **The installed agent's own list: Claude Code's `--help`, Codex's `model/list` for the configured model; none when Symbiote cannot read one** | Claude Code ignores an unknown level without failing: a fixed list could offer one that silently does nothing |
| 210 | The default | **"<Agent>'s default", no flag; Codex's level named (from `config/read`), Claude Code's not; each new workspace starts at it** (left to Symbiote) | "For that session": a level is a choice per workspace. Claude Code has no command that reports its level (`claude config …` is no subcommand: it runs as a prompt), so naming it would mean resolving its settings layers, and a wrong name is worse than none |
| 211 | Where it shows after | **The Brief tab's line, as how the agent was started** (confirmed) | The level can be changed in the agent's terminal; Symbiote does not read it back, so the card and head would show a stale value |

**Not in V30 (later)**, confirmed: a project default for the level (`agent.effort` in `symbiote/config.json`); a
model per workspace; changing the level of a running session from Symbiote; the session's current
level read back; the merger agent's level (V26c, `merge.model`).

## As built (V30a)

- **The sidenav's ⊕ is a link to `/start`**, not a button: it opens a page, `aria-current` marks it
  there, and on a diff (its own document) the link loads the page with no code of the diff's.
  The ≈ 52 tests' helpers click a link now.
- **`n` on a diff** loads `/start` too: it did nothing there before.
- **Leaving** asks the Navigation API for the entry before `/start`: `history.back()` when it is
  Symbiote's (same origin: History, Settings, a workspace, or a diff), else History in `/start`'s place
  (a tab opened at `/start`). Browsers without the API (Firefox, Safari) always get History.
- **The draft is read after the page's last save**: leaving and coming back at once posted the
  draft and read it in the same moment; the page now waits on its own last save (a promise kept
  by the module) before it reads.
- **The head** is a grid: title, where it starts, the buttons; under 600 px of page the "From …"
  line goes under the other two (squeezed between them at 390 px in the first build).
- **The run's order**: Branch and its folder, Agent and its account, Permission (or Codex's
  sandbox), Plan first. Tab now reaches the permission before Plan first (the dialog's agent line
  came after it): the keyboard test says so.
- **Words**: "the start dialog" in the `{brief}` placeholder's description in Settings is "the
  start page"; the agent's account has its own line ("Claude Code · your Pro subscription" was
  one line).
- `StartWorkspaceDialog.tsx`, `WorkspaceStarter.tsx`, the dialog's styles and the shell's
  `starting` (History waited on the dialog for its keys) are gone; the form's logic (`brief.ts`)
  is unchanged.

**Results (V30a).** Unit: 1,055 (route and title tests for `/start` and `?at=`, the server serving
`/start` only with workspaces: red first). e2e: 6 new in `start.spec.ts` (red on V30 plan's build:
no link, no `/start`), 52 moved from the dialog to the page in 8 specs (4 needed more than the
locator: text now on two lines, and the tab order), 165 of 165. The page, measured as the dialog
was (Chromium, `serveWorkspaces` with both agents):

| Window | The page | Required part | More open |
|---|---|---|---|
| 1280×720 | 1040×696, two columns (660 + 300 px) | 660×146 px (dialog 598×108) | the body scrolls under the head (771 of 652 px); Start stays in view |
| 1440×900 | 1200×876, two columns (760 + 300) | 760×146 | fits (832 of 832) |
| 1920×1080 | 1680×1056, two columns (760 + 300) | 760×146 | fits |
| 390×844 | 390×783, one column | 358×146 | the body scrolls (1,034 of 720 px) under the head |

From `n` on History to the Title focused and painted, 10 times each, two rounds: the dialog
(`main`) 36–51 ms, median 41; the page 35–51 ms, median 37. Screenshots at 1280, 1440 and 390 px,
dark and light. Not verified: Firefox and Safari (no Navigation API: Cancel goes to History),
the Electron window (its title bar names the page; the e2e for it moved to the link and passed).

## As built (V30b)

- **The Brief tab's line names the agent and its level**, not the permission mode: "Started with
  Claude Code at high effort." (or "at its default effort"). The mode would have been a new field
  on every workspace's summary, changing its shape for something not asked.
- **The draft keeps all the run's choices** (agent, level, permission mode, plan first), not the
  level alone: a level belongs to its agent, and leaving the page should lose nothing (decision
  207). After a start only the kind is kept, as before: the next workspace starts at the
  agent's default. A level kept with no agent picked is the first agent's: the e2e found Escape
  and back losing `high` until it was.
- **Codex without its daemon**: no Effort choice (no list to read, decision 209), but a level
  recorded on the app server goes to `exec` when the workspace is started again without the
  daemon, and to each `exec resume` (decision 208). The plan's two statements disagreed; both
  hold this way.
- **Codex's levels are read at every read of the options** (two app-server calls, about 5 ms);
  Claude Code's `--help` once per `symbiote view`. Only `model/list`'s first page is read (3 models).
- **Codex's sandbox is a field of its own** ("Sandbox: Its worktree and branch"): under Effort,
  the line read as Effort's note.
- Levels are passed only as lowercase words (`EFFORT_LEVEL` in core), on the way in (the
  request), out (`--effort`, `turn/start`, `model_reasoning_effort`) and back from a record.

**Results (V30b).** Unit: 1,070 (CLI: `--help` parsed, Claude Code's and Codex's arguments, the
app server's levels and first turn, the service's levels, start, refusals, Start again and
`exec` replies, the server's parser: 14 red first; viewer: the choices, the line, the draft's
run). e2e: 2 new (red first), 167 of 167. With the real agents (Claude Code 2.1.306, Codex 0.163,
this machine):

| What | Result |
|---|---|
| Levels offered | Claude Code low, medium, high, xhigh, max (no default named); Codex low … max, "Codex's default (medium)" |
| A Claude Code workspace started through Symbiote's endpoint at `low` | First turn `low` (15.3 s), Symbiote's reply (stop, resume) `low` (8.9 s), the same session; listed with `effort: low`; cleaned up |
| `GET /api/workspaces/options`, cold · warm, `main` → branch, two runs | 549 and 222 → 263 and 237 ms · 8–12 → 14–17 ms |

Not verified: a real Codex workspace through Symbiote (it would leave a trust entry for a throwaway
folder in the person's Codex configuration; the V30 spike showed the app server keeping a first
turn's level, and the e2e that Symbiote sends it); Codex `exec` with a level (unit tests only); the
level after `/effort` in a session's terminal (Symbiote does not read it back, decision 211).
