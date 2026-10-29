# V78 — Scout and Scribe are terminals, set in Settings

[Index](../PLAN.md) · [Journal](../journal/v78-scout-scribe-terminals.md)

**Status:** ready for review (2026-10-29), on branch `feature/remove-scout-in-page-settings` (a
workspace started in Symbiote, from `main` at `61163d2`). The person OK'd the plan with three
answers: no Agent row in Settings ("The agent choices are already in Settings"), Improve with
Scribe types its text into the terminal, and no question box where no terminal runs ("it should
run a terminal"). Planned as V77 with decisions 561–564; renumbered V78 and 569–572 before review,
since `feature/workspaces-history` took both meanwhile (its commits before the renumbering say V77).

**Problem** (asked: "remove the scout in-page settings, always on terminal, and only from settings
it can be set. Keep the new conversation button. Also, Scribe should be direct a terminal, not an
input with effort and a button start, just like Scout"). Read on `main` at `61163d2`:

| Page | What it offers besides the agent's terminal | Where |
|---|---|---|
| Scout | A card head with Agent (two agents installed), Model and Effort; New conversation starts the next on what they show (V52, decisions 391–392). Where no terminal runs, a question box. | `scout/ScoutPage.tsx` |
| Scribe's pane (Skills, `?scribe`) | A request box (a label and its help, 4 rows), an Effort stepper, an Agent select (two agents), Write. The terminal only after a request; New conversation brings the box back. | `scout/Conversation.tsx` |

Scribe cannot open with no request: its instructions are its first prompt, built around
`{request}` (`prompts.ts`), and `POST /api/scribe/open` answers 409 "Scribe starts with what you
ask it" (`scout.ts`, `open`). Settings' Scout and Scribe pages already set the model and the
effort (`scout.model`, `scout.effort`, `scribe.model`, `scribe.effort`).

**Goal**: Scout's page and Scribe's pane are the agent's terminal, opened at once. Their heads say
what the conversation runs on, its state, and New conversation; nothing else to change there.
Every conversation starts on Settings' model and effort. **Unchanged**: Scout's and Scribe's tools,
gates, records and folders; the agent, `agent.kind`'s order, else Claude Code, else Codex
(decision 240); Settings' rows; the server's `ask`, which the pages stop calling.

## Server (`scribe.ts`, `prompts.ts`)

- **Scribe's instructions become its system prompt** (decision 570), as Scout's did in V50
  (decision 383): its spec gets `instructions` (the project's `scribe` prompt, its `{library}` as
  today), and `prompt` is the person's words. `open` then starts it with no request: Claude Code
  `--bg` with `--append-system-prompt` and no prompt; Codex a thread with developer instructions
  and no turn, in `.claude/skills` as today.
- Symbiote's `scribe` text loses its last lines ("The person's request:" and `{request}`); Settings
  no longer lists `{request}`, and its words say it is the system prompt. A project's text that
  still has `{request}` gets it filled with nothing, as Scout's `{question}` was.

## Viewer (`scout/`, `skills/SkillsPage.tsx`, `settings/SettingsPage.tsx`)

- **One hook for both** (`usePageAgent`): with terminals and no conversation (or a gone one), it
  opens one at once with nothing picked; New conversation is `/new`, then that open again; a
  failed open says why, with Try again. Today the open is Scout's alone and the rest written twice.
- **Scout's page** (decision 569): the card head with Agent, Model and Effort goes; the card is the
  terminal. The line under the title says what the conversation runs on ("In Symbiote, with
  Claude Code on sonnet at high effort"); the Help says Settings sets them for each conversation.
  New conversation is a secondary button: the head no longer differs from the conversation.
  `headChoices`, `newConversation` and the picks go, with their unit tests.
- **Scribe's pane**: the same. Opening `?scribe` opens its conversation ("Starting Scribe…"), and
  its terminal fills the pane edge to edge (V56). The box, its Effort, its Agent and Write go.
- **Improve with Scribe** (decision 571): opens the pane, and types `Improve
  .claude/skills/<name>/SKILL.md: ` into Scribe's terminal, unsent, for the person to finish. It is
  pasted (bracketed when the agent asked for it, as an image's path is) once the terminal has
  printed and been quiet for a moment: typed before the agent's input is drawn, it could be lost.
  "Ask Scribe to write it" only opens the pane. The note "Its conversation goes on… a new one takes
  …" goes.
- **No terminal here** (no `node-pty`, `SYMBIOTE_TERMINAL=off`; decision 572): no box. The card
  says Scout (or Scribe) runs in a terminal and none runs here, and why; with a conversation, how
  to reach it from a terminal of one's own (`claude attach <id>`).
- **Settings**: the words that point at Scout's head or Scribe's box say instead that a running
  conversation keeps its own, and New conversation starts the next on these.

## Verification

1. **Tests first** (red for the right reason):
   - `packages/cli/test/scribe.test.ts`: `open` starts Claude Code with no prompt, Scribe's
     instructions (the library's line when one is set) as `--append-system-prompt`, at
     `scribe.model` and `scribe.effort`; Codex starts a thread with no turn and the instructions as
     developer instructions. `prompts.test.ts`: Scribe's default has no `{request}`; a project's
     text without one is used; one with it has it filled with nothing.
   - `e2e/scout.spec.ts`: no select, no slider, no textbox on the page; the line says the
     conversation's model and level; New conversation opens the next on Settings' (changed while
     one runs). It replaces V52's three tests of the head's choices and the box's test.
   - `e2e/skills.spec.ts`: opening Scribe starts Claude Code with no prompt and its instructions;
     its terminal shows and takes the keys; no textbox, slider or Write; `scribe.effort` reaches the
     start; Improve's text is in the terminal and not sent (the fake echoes keys, prints `got:` on
     Enter); New conversation opens the next. Without terminals, the note on both pages.
2. **Nothing else changes**: `pnpm check`, `pnpm build`, `pnpm test:e2e` (page frame, terminal
   fit, title bar, Settings included).
3. **Real agents**, in a throwaway clone (a run from this worktree writes the main checkout's
   `symbiote/`): Codex's Scribe and Scout open with nothing asked; a request typed in Scribe's
   terminal writes a skill as its instructions say; Improve's text reaches Codex's input. Claude
   Code only if the person trusts the clone's folder first; else reported not verified.
4. **Viewer**: screenshots of Scout, Scribe's pane and Settings' Scout and Scribe pages at 1440×900
   and 390×844, dark and light, at 1x.

**Risks**

| Risk | Mitigation |
|---|---|
| Opening Scribe's pane spends tokens | No turn until the person types (V50 measured it for Scout; the same start) |
| Improve's text typed before the agent reads its input is lost | Pasted after the first output and a quiet moment; the e2e fake and the real Codex run check it |
| A project's own Scribe text ends "The person's request:" with nothing after | Said in Settings as a text that differs from Symbiote's; Reset gives Symbiote's back |
| A running conversation does not follow a change in Settings | Settings says so; New conversation starts the next on it |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V78 | Scout and Scribe are terminals | Scout's page and Scribe's pane open the agent's terminal; their model and effort set only in Settings |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 569 | Where Scout's and Scribe's agent, model and effort are chosen | **Only in Settings** (and `agent.kind` for the agent); the page shows the conversation's, read-only. Replaces V52's 391–392 | The person's ask: "These two should be controlled only from Settings" |
| 570 | How Scribe starts with no request | **Its instructions are its system prompt**, as Scout's (383) | A start needs no request and runs no turn (V50's measurements) |
| 571 | What Improve with Scribe does without a box | **Its text pasted into Scribe's terminal, unsent** | The person picked it; the skill's path is what the person would type first |
| 572 | Where no terminal runs | **A note, no box** | The person: "it should run a terminal" |

**Not in V78 (later)**: an Agent row in Settings for Scout and Scribe (the person: "already in
Settings"; today `agent.kind` decides); the server's `ask`, `open`'s and `ask`'s agent, model and
effort, kept for now though no page sends them.

## As built (V78)

- **One conversation module for both pages.** `scout/Conversation.tsx` holds `usePageAgent` (the
  open at once, New conversation, Try again), `PageAgentBody` (the terminal, "Starting…", or why
  none runs), `PageAgentActions` (the state and New conversation) and `PageAgentError`. Scout's
  page is these in the page frame (351 lines to 67); Scribe's pane is `Conversation`, the same
  parts under its head strip.
- **The line names the model.** "on Sonnet 5.5", not "on sonnet": the page reads `<api>/efforts`
  once a conversation runs on a model, for its name in the agent's list (`runsOn`, unit-tested);
  its ID when the list has none.
- **Improve with Scribe** is `OpenedTerminal.type`: a paste (bracketed when the agent asked for
  it) once the terminal has printed and been quiet 300 ms, or 3 s after its first print if it
  keeps printing. While Codex's trust question waits, the text is held until the person's key
  answers it: a paste would answer it. A text not yet typed is dropped when another pane opens,
  so a later visit to Scribe does not type it.
- **No terminal here**: the note, and with a conversation, `claude attach <id>` (or `codex resume`)
  to reach it from one's own terminal. New conversation is shown only with a conversation.
- **Help and Settings say "the model and effort"**, not "the agent": Settings has no agent row
  (`agent.kind` in `symbiote/config.json` decides). Settings' Effort help says a running
  conversation keeps its own and New conversation starts the next on it.
- **Gone**: `headChoices`, `newConversation` and their tests; `scoutLevel` (the box's level) and
  its test; the `.scout-choices`, `.scout-effort`, `.scout-ask` and `.skills-scribe-note` rules;
  the box's selectors in `ui/controls.css`.
- **Specs**: `library.spec.ts` filled Scribe's box too (missed in the plan); it now checks the
  library skill's path typed in the terminal and `--add-dir` with the system prompt.
  `page-frame.spec.ts` lost Scout's card head and question form.
- **Renumbered** V78, decisions 569–572 (see the status): the first three commits say V77.

**Results.** Unit tests: 2,241 pass (`pnpm check`), the CLI's 997 among them (Scribe's open on
Claude Code and on Codex, its instructions with and without a library, a project's `{request}`
filled with nothing); the viewer's `runsOn` added, the head choices' and the box level's tests
removed with their code. e2e: the whole viewer suite 337 of 338, the one failure
`library.spec.ts`'s box, then fixed (it and `skills.spec.ts`, 23 of 23); nexus 15 of 15.
Screenshots at 1440×900 and 390×844, dark and light, at 1x (the e2e fake): Scout's page, Scribe's
pane, Improve's text in the terminal, the no-terminal note, Settings' Scout and Scribe pages. At
1,440 px Scribe's line is cut with an ellipsis ("…of repo, with Codex at low e…"), as it was
before when long; the whole line is not in a tooltip, only the checkout's path.

Real Codex (0.163), in a throwaway repository with its own cache and config folders (no skill
library, the person's `symbiote/` untouched), `agent.kind: codex`, `scribe.effort: low`: opening
Scribe's pane started a Codex thread with no turn (`ready`, at `low`), and its terminal joined it.
Codex's first screen was its trust question for `.claude/skills`; answering it writes the person's
Codex trust list, so the run stopped there. **Not verified with a real agent**: a request typed in
Scribe's terminal, Improve's paste into Codex's or Claude Code's input, Scout on a real agent
(Scout's open path is V50's, unchanged). The thread was archived by New conversation.
