# Journal: V52 — Scout's head picks the next conversation

[Index](../JOURNAL.md) · [Plan](../plan/v52-scout-next-conversation.md)

## V52 spike — what a choice in Scout's head starts (2026-10-25, branch `feature/scout-view-settings`)

Read on `main` at `c136ee3`: `ScoutPage.tsx`, `EffortStepper.tsx`, the server's page-agent routes
and `e2e/scout.spec.ts`; the times are V50's real run (Claude Code 2.1.310).

**Learned**:
- **Every change is a session.** A model picked is `switch`: the session stopped, resumed as a copy,
  the original removed, the terminal joined to the copy (4.2 s). Another agent is `new`, then an
  open. The e2e test of V50 counts 2 copies, 2 stops, 2 removals and 3 attaches for one model and
  one level.
- **The stepper commits at each stop by key or click** (`EffortStepper`'s `pick` calls `onCommit`;
  the range input's `change` fires per arrow key): Default to max by keys is 5 copies. Only a drag
  commits once, when let go.
- **The server needs nothing new**: `POST /api/scout/open` already takes `agent`, `model` and
  `effort` (null: the agent's own), so New conversation can start the next on the head's choices.

## V52 — Scout's head picks the next conversation (2026-10-25, branch `feature/scout-view-settings`)

A change of Agent, Model or Effort in Scout's head starts nothing (decision 391): the head shows
this conversation's choices until one is changed, and New conversation starts the next on what it
shows (392), turning primary, its title naming both, while they differ. The server's `switch`,
which only the head called, is gone with Codex's fork and a start's `--resume` options (393, the
person's "Remove it now"). Settings' Scout model and effort say they are what Scout opens on with
no conversation.

**Learned**:
- **Settings' words were the first thing 392 made untrue.** "Saved. Scout's next conversation
  starts on Opus 4.6." held while New conversation started on the project's (385); with the head's
  choices it holds only when Scout opens with no conversation. The plan named the Help and the
  README, not Settings' messages; found by grepping for "next conversation" after the page was
  done.
- **The picks have to outlive New conversation's two steps.** `/new`, a read with no conversation,
  then the open: the page pins what the head shows as picks before `/new`, the open sends them,
  and they are dropped only when a conversation with a new ID runs. Dropping them on the read
  with no conversation would have opened the next on the project's.
- **A model picked without a level needs the level worked out where it is shown.** V50 did it in
  the model's handler; V52's `headChoices` does it (the level shown, when the model takes it,
  else the agent's own), so a level picked comes back when its model does.

**Verification**: tests first, red for the right reason on `main`'s page (viewer `scout.test.ts` 5
of 5 new; `e2e/scout.spec.ts` 4 of 9: the stepper locked during a move, Agent ending the
conversation at once, Model locked while Scout answers), then green. `pnpm check` 1,739 unit
tests; e2e 256 of 256 after the removal, the final source 255 of 256 (the sidenav card's height, 64.00003 px against 64, under the full suite's load; 5 of 5 alone; the sidenav untouched). Screenshots of Scout's head (one and two agents,
1,440 and 390 px, dark and light, New conversation plain and primary) and of Settings' Scout page:
nothing wider than the window, no page error.

Not verified: with the real Claude Code or Codex (the server's `open` is unchanged; a real run
from this worktree writes into the main checkout's `symbiote/`); macOS and Windows.
