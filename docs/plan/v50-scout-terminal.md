# V50 — Scout is a terminal

[Index](../PLAN.md) · [Journal](../journal/v50-scout-terminal.md)

**Status:** planned (2026-10-25), on branch `feature/scout-should-be-a-terminal` (a workspace
started in Symbiote, from `main` at `94e1feb`). The person OK'd starting once the plan was written
("After you plan, you have my blessing to start working").

**Problem** (asked: "Scout should always be a terminal when going to that page, with options in
header to change the model, new conversation, etc...the first settings page is unnecessary").
Today `/scout` with no conversation is a form: a label and its help, a 4-row question box, a
6-stop effort stepper, an agent select when two are installed, and Ask. The terminal shows only
after a question; New conversation brings the form back. The model is set only in Settings (for
every conversation), the effort only on the form (before the first question), and neither can be
changed from the page once a conversation runs (only by `/model` or `/effort` typed in its
terminal, which the page's head does not see).

Measured (spike, 2026-10-25; Claude Code 2.1.310 with Haiku 5.5 and Sonnet 5.5, Codex CLI 0.163
on its 0.164 app server, in a throwaway repository in this job's scratch folder):

- **Claude Code starts with no question**: `claude --bg --name … --tools Read,Grep,Glob
  --permission-mode dontAsk --strict-mcp-config --model … --append-system-prompt "<instructions>"`
  and no prompt exits 0 in 3.6 s (0.66 s later on), and `claude agents` lists it `blocked`/`idle`,
  nothing it waits for ("idle — send a prompt to start"). No turn runs, so no token is spent until
  the person types.
- **Its instructions hold**: a question typed in `claude attach` was answered as the appended
  system prompt said; after `claude stop` and a wake by `attach`, the next answer still was.
- **A model or a level changes without losing the conversation**: `claude --bg --resume <session>`
  with the same flags and `--model sonnet --effort low`, no prompt: "keeps its own saved options,
  so the flags you passed started a copy as f9b2d965", idle. Asked in the copy "what did I ask
  first, and which model are you?": "You first asked what is in README.md, and I'm Claude Sonnet
  5.5". It does the same for a session with no turn yet, and for a running one (the original keeps
  running). The original stays listed until `claude rm`.
- **Codex too**: `thread/start` read-only, approvals `never`, `developerInstructions`, the level in
  `config.model_reasoning_effort`, and no `turn/start`: a thread (named on the 0.164 server; 0.163
  refused to name an empty one, V35). `codex resume <thread> --remote` opened it ("GPT-6-Luna low ·
  ScoutProbe") and its first answer followed the instructions. `thread/fork` at
  `model_reasoning_effort: medium`: Codex's terminal said "Thread forked from ScoutProbe", showed
  the earlier turn and "medium", and answered what was asked first. A thread with no turn forks
  too.

**Goal**: `/scout` is Scout's terminal whenever terminals run. Opening it with no conversation
starts one with no question, and its terminal takes the first one. The head holds Scout's choices:
the agent (when two are installed), the model, the effort, the state and New conversation, which
starts the next one at once. A model or an effort picked there moves the conversation to it, its
turns kept. **Unchanged**: Scout's tools, gate, MCP server and record; Scribe's pane (a request box
first, V41); Settings' `scout.model` and `scout.effort`, the ones each conversation starts on; the
question box where no terminal runs (no `node-pty`, `SYMBIOTE_TERMINAL=off`).

## Server (`scout.ts`, `claude-code.ts`, `app-server.ts`, `server.ts`)

- **Scout's instructions become its system prompt** (decision 383): Claude Code's
  `--append-system-prompt <prompts.scout>`, Codex's `developerInstructions`. A first prompt would
  have to be a question, or a turn spent on a greeting. The person's words are the first message:
  typed in its terminal, or the box's question where no terminal runs. `prompts.scout` loses
  `{question}`; a project's text that still has one gets it filled with nothing. Scribe keeps its
  first prompt (`{request}`).
- **`POST /api/scout/open { agent?, model?, effort? }`**: with no conversation, or a gone one,
  starts one with no question, on the model and at the level named, else the project's
  (`scout.model`, `scout.effort`) as a question's start takes them; with a live one, starts
  nothing and answers the state. Claude Code: `--bg` without a prompt. Codex: `thread/start`
  without a turn, its level in its config, named Scout.
- **`POST /api/scout/switch { model, effort }`** (decision 384): the conversation goes on, on that
  model and at that level (null: the agent's own). Claude Code: stopped when it runs, then `claude
  --bg --resume <session>` with Scout's flags and the new model and level, no prompt; the copy is
  found as a start's session is (the new background session named Scout in the checkout, decision
  239), recorded, and the original removed (`claude rm`; its transcript stays). Codex: `thread/fork`
  with Scout's read-only options and Symbiote's server, on the new model and level, named Scout;
  the original archived. Refused while Scout answers or waits on a dialog (409): a copy would cut
  the turn.
- `GET /api/scout` says whether terminals run with no conversation too: the page chooses the
  terminal or the box before anything starts. A new state, **`ready`**: a conversation asked
  nothing yet (Claude Code `blocked` with nothing it waits for; Codex a thread with no turn), "Ready:
  ask in its terminal" rather than "Answered".
- `/new` as today (the session stopped and removed, the thread archived); the page then opens the
  next.

## Viewer (`ScoutPage.tsx`, `Conversation.tsx`, `ScoutPage.css`)

- **On Scout, with terminals**: no conversation (or a gone one) opens one at once ("Starting
  Scout…" in the terminal's place), then its terminal fills the page as today and takes the focus.
  A failed start says why, with Try again; it is not retried by itself.
- **The head**: "Scout", what it does where ("In Symbiote, with Claude Code"), then its choices:
  - **Agent** (two installed): the other starts a new conversation with it.
  - **Model**: the agent's models (V47's list, its default first); the conversation's is shown.
  - **Effort**: the stepper (every effort setter is one, `fix/scout-effort-level`), on the
    model's levels; the conversation's is shown.
  - The state and **New conversation**.

  A model or a level picked goes to `switch`; the terminal joins the copy. While Scout answers,
  Model and Effort are disabled ("after its answer"). Narrow, the choices go on a line of their
  own under the title.
- **New conversation**: `/new`, then the next opens on the project's model and level (Settings'),
  decision 385.
- **Without terminals**: the box as today, without its agent select and stepper: the head's
  choices are what its first question starts on.
- `a` on Scout goes to its terminal (or the box), as today.

## Verification

1. **Tests first** (red for the right reason): `scout.test.ts` — `open` starts Claude Code with
   no prompt and Scout's instructions as `--append-system-prompt`, at the project's model and
   level or the ones named; a live conversation starts nothing; a gone one starts another;
   `switch` stops a running session, resumes it as a copy with Scout's flags and the new model and
   level, records the copy, removes the original; refused while working; Codex's `open` (no turn,
   developer instructions, level in config) and `switch` (fork, archive); `ready` from a session
   asked nothing. `claude-code.test.ts`/`app-server.test.ts` — the arguments and requests.
   `prompts.test.ts` — Scout's default has no `{question}`, a project's `{question}` filled with
   nothing. Viewer `scout.test.ts` — `ready`'s words, no mark for it. `e2e/scout.spec.ts` with the
   fake Claude Code (which learns a start without a prompt and a resume with flags as a copy):
   opening Scout starts a session with no prompt and shows its terminal, focused; the person's
   session in the checkout is not taken; Model and Effort in the head make a copy, the terminal
   joins it, the original is removed; New conversation removes the session and opens the next on
   the project's model and level; with `SYMBIOTE_TERMINAL=off`, the box; without agents, the note.
2. **Nothing else changes**: Scribe's specs (`skills.spec.ts`), Settings', the shell's and the
   others as on `main`; `pnpm check`, `pnpm build`, `pnpm test:e2e`.
3. **Real agents** (a throwaway clone of this repository, never the person's checkout:
   `symbiote/` there would be written): opening Scout starts Claude Code with nothing asked, a
   question typed in its terminal is answered as Scout (its gate holds: `ls` refused); Model to
   Sonnet keeps the conversation ("what did I ask first?"); New conversation; the same with Codex.
4. **Viewer**: `viewer-check` screenshots of Scout at 1440×900 and 390×844, dark and light, the
   head's choices included; `symbiote-style` for the head.

**Risks**

| Risk | Mitigation |
|---|---|
| Opening the page spends tokens | No turn until the person types (spike); a start with no prompt, not a greeting |
| A copy loses Scout's tools or gate | Every Scout flag passed again (the copy keeps only what it is given); unit-tested arguments; the real run asks for `ls` after a switch |
| The person's half-typed line in the terminal is lost on a switch | Said in the Model's and Effort's help: the terminal joins the copy |
| A Claude Code release changes `--resume` with flags | The copy is found as a start's session, by the lists before and after; none found is said |
| Two tabs open Scout at once | One write at a time on the server; the second reads the first's conversation |
| An idle session kept for a page visit | One per repository, as after a question today; New conversation and Clean-up as before |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V50 | Scout is a terminal | `/scout` opens Scout's terminal with no question; its head picks the agent, model and effort, and starts a new conversation |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 383 | Where Scout's instructions go | **The system prompt** (Claude Code `--append-system-prompt`, Codex `developerInstructions`); the person's words are the first message | A start needs no question and runs no turn; the spike's answers followed them, after a wake too |
| 384 | A model or level picked in a running conversation | **A copy on it, its turns kept** (Claude Code's `--resume` with flags; Codex's `thread/fork`), the original removed | Both keep the conversation (spike); typing `/model` into the person's terminal would mix with what they typed, and Codex's `/model` is a picker |
| 385 | What New conversation starts on | **The project's model and level** (Settings'), not the head's last pick | Settings says what each conversation starts on (V47, `fix/scout-effort-level`); the head is this conversation's |

**Not in V50 (later)**: Scribe as a terminal first; the model `/model` set in the terminal shown
in the head (Claude Code does not list a session's model).
