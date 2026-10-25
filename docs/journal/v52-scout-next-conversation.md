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
