# V52 — Scout's head picks the next conversation

[Index](../PLAN.md) · [Journal](../journal/v52-scout-next-conversation.md)

**Status:** planned (2026-10-25), on branch `feature/scout-view-settings` (a workspace started in
Symbiote, from `main` at `c136ee3`); in progress. The person OK'd it on the plan: decision 392 as
proposed, and for 393 "Remove it now".

**Problem** (asked: "A change from Scout page of a setting should only trigger a new session on
click new conversation, not on every change"). Since V50 each choice in Scout's head acts at once
(`ScoutPage.tsx`):

| Choice | What one change does today | Measured |
|---|---|---|
| Model | `POST /api/scout/switch`: the session stopped, resumed as a copy on the model, the original removed; the terminal joins the copy | 4.2 s with the real Claude Code (V50's run); `e2e/scout.spec.ts`: a model and a level picked, 2 copies, 2 stops, 2 removals, 3 attaches |
| Effort | The same, once per stop: each arrow key or click on the stepper commits (`EffortStepper`'s `pick`) | Default to max by keys: 5 copies (about 21 s at V50's 4.2 s each) |
| Agent | `POST /api/scout/new`, then the page opens the next with the other agent | 1 session removed, 1 started |

A line half typed in the terminal is lost at each copy, and Model and Effort are locked while
Scout answers (a copy would cut its turn).

**Goal**: a choice in the head (Agent, Model, Effort) starts nothing and stops nothing. New
conversation ends this conversation and starts the next on the head's choices. The server's
`switch`, which only the head called, goes. **Unchanged**: the rest of the server's API (`open`
already takes the agent, model and level); opening Scout with no conversation, or a gone one, on
Settings' model and level; Scribe; the question box where no terminal runs, which already starts
on the head's choices.

## Viewer (`scout/ScoutPage.tsx`, `scout/scout.ts`)

- **The head is what New conversation starts on** (decision 391). It shows this conversation's
  agent, model and level, as today, until the person changes one; with no conversation, Settings'
  (`scout.model`, `scout.effort`) where the agent lists them, as today. A change is kept in the
  page's state (`picked`) and goes to no endpoint.
  - Model: picked; the level stays when the new model takes it, else the agent's own (as today).
  - Effort: picked on every stop of the stepper (`onChange`); no `onCommit` needed.
  - Agent: picked; the other agent's models and levels shown at Settings' (as today, decision 385's
    rule for an agent's first conversation).
  - Model and Effort stay enabled while Scout answers: they touch nothing that runs.
- **New conversation** (decision 392): `/new`, then `/open` with the head's agent, model and level
  (`''` sent as null, the agent's own). Nothing changed: the next starts on this one's. The open
  effect that starts a conversation when there is none passes the picked choices, so it serves
  both a first open (nothing picked: Settings') and New conversation. Without terminals, `/new`
  only: the box's next question starts on the head's choices (`ask` already sends them).
- **The picks are dropped when a new conversation runs** (its ID changes): the head then shows that
  conversation's own, which are the picks it started on.
- **Seeing that a change waits**: when the head differs from the running conversation, New
  conversation becomes the primary (accent) button, and its title says what it ends and what it
  starts ("Ends this conversation (on Opus 5.5, high) and starts another on Sonnet 5.5, high").
  The Model's and the Effort's titles say "What New conversation starts on"; the head's Help says
  a choice here starts nothing until New conversation, and that Settings sets what Scout opens on.
- Gone from the page: `choose`'s call to `/switch`, `moving` (the terminal quiet during a move),
  `pending` (the stepper's value during a move), the lock and its "after its answer" title.
- Pure, in `scout.ts` and unit-tested: `headChoices` takes the picks over the conversation's or
  Settings'; a function saying whether the head differs from the conversation, and the words of
  New conversation's title.

## Server

- **`switch` goes** (decision 393): no page calls it after V52. Gone with it: the route and
  `parseScoutSwitch` (`server.ts`, `server-requests.ts`), `Scout.switch` (`scout.ts`), the
  `ScoutSwitch` type (`@symbiote/core`), a start's `from` (Claude Code's `--resume` with options,
  `claude-code.ts`, and `claudeStart`'s), Codex's `fork` (`app-server.ts`, and its retry in
  `codex.ts`), and their tests. The fakes lose what only a move used: the fake app server's
  `thread/fork`, the e2e fake Claude Code's copy on options (its numbering past an ID in use
  stays). A `POST /api/scout/switch` then gets what any unknown path under `/api/scout` gets.

## Docs

- README's Scout section: the head's choices are the next conversation's; New conversation starts
  on them; Settings' are what Scout opens on with no conversation.
- V50's plan keeps its decisions; 391 and 392 say they replace 384 (on the page) and 385.

## Verification

1. **Tests first**, red for the right reason on `main`'s page:
   - Viewer `test/scout.test.ts`: the picks over the conversation's model and level; the levels
     follow a picked model; another agent picked shows its own at Settings'; the head differs, or
     not, from the conversation; New conversation's title.
   - `e2e/scout.spec.ts` (the fake Claude Code), replacing V50's "move the conversation to a copy"
     test: Sonnet picked and the effort stepped three times by keys start nothing (one call, no
     stop, no removal, one attach, the terminal still `fake0`), Model enabled while Scout answers,
     New conversation the primary button; on its click, the session removed and the next started
     (`--name`, not `--resume`) with `--model sonnet` and that level; the head shows them, New
     conversation secondary again, `symbiote/config.json` untouched.
   - The New conversation test: with `scout.effort` medium, high picked and New conversation gives
     `--effort high`; a second New conversation with nothing changed gives `high` again, not
     Settings' medium (decision 392).
   - The Agent (`codex: true, appServer: true`): Codex picked starts no thread and removes nothing;
     New conversation removes Claude Code's session and starts Codex's thread (`thread/start`, no
     turn).
   - Without terminals: after a question, Sonnet picked starts nothing; New conversation, then a
     question, starts on `--model sonnet`.
   - The server: `switch`'s tests in `cli/test/scout.test.ts` and `fork`'s in `app-server.test.ts`
     go with them; nothing else in those files changes.
2. **Nothing else changes**: the other Scout specs (open, the person's session, the sidenav, VS
   Code links, no agents), Scribe's (`skills.spec.ts`), Settings'; `pnpm check`, `pnpm build`,
   `pnpm test:e2e` (run with `env -u WAYLAND_DISPLAY` on this machine).
3. **Viewer**: `viewer-check` screenshots of Scout's head at 1440×900 and 390×844, dark and light,
   with New conversation plain and primary; `symbiote-style` for the primary button's use.
4. **Real agents**: not planned. The server's `open` does not change (only `switch` goes), and a
   real Scout run from this worktree writes into the main checkout's `symbiote/`; on the person's
   word, a throwaway clone.

**Risks**

| Risk | Mitigation |
|---|---|
| The person believes a pick moved this conversation | New conversation turns primary and its title names both; the Help says so |
| A Settings change no longer reaches New conversation (the head shows this conversation's) | Said in the Help and README; Settings still sets what Scout opens on. The other rule is open choice 1 |
| Picks lost on leaving the page | They only wait for New conversation; the head shows the running conversation's again |
| The open effect and New conversation race (two opens) | One task at a time as today (`busy`); the effect runs only with no conversation |
| A caller of `switch` outside the page | None: the viewer's head was its only caller (`grep`); Symbiote's MCP tools never had it |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V52 | Scout's head picks the next conversation | Agent, Model and Effort start nothing; New conversation starts the next on them |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 391 | What a choice in Scout's head does | **Nothing runs: it is what New conversation starts on**; the running conversation keeps its own. Replaces 384 on the page | The person's ask; a copy per change (5 for the stepper by keys) joined the terminal each time and dropped a typed line |
| 392 | What New conversation starts on | **What the head shows**: this conversation's agent, model and level unless changed there. Replaces 385 | One place says what the next starts on; nothing changes behind what the head shows |
| 393 | The server's `switch` | **Removed**, with Codex's fork and a start's `from` | The person's choice ("Remove it now"): nothing calls it after 391 |

**Choices the person made on the plan**: 392 as proposed, not its alternative (with nothing
changed, New conversation on Settings', and the head showing Settings'); 393 removed now, not kept
unused.

**Not in V52 (later)**: applying a choice to the running conversation (it would bring back
V50's copy and fork); keeping picks across pages.
