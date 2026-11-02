# Journal: V89 — Redesign step 2: the workspace page and the terminal view

[Index](../JOURNAL.md) · [Plan](../plan/v89-redesign-workspace-terminal.md)

## V89 spike — what the designs ask of the records (3 November 2026, branch `feature/redesign-workspace-terminal`)

Read the proofs (normal 02, 08, 09; Hive 02, 08), `term.css`, and each field they draw against
what `WorkspaceSummary`, the thread and Hive's detail carry on `98e28e2`.

**Learned**:
- **The bar's words are recorded, its options are not.** Claude Code's `Notification` hook gives
  its own sentence ("Claude needs your permission to use Bash"), the `PermissionRequest` hook the
  tool and its input, `AskUserQuestion` its questions and options. A permission prompt's choices
  are not recorded, and its "don't ask again" varies by tool: the bar shows Enter and Esc, both
  measured in V21's spike (Esc on a permission prompt denies and ends the turn, no hook fires).
- **`waitingFor` is short**: "permission prompt", "input" in the tests and records; the
  notification's message is the agent's own words.
- **Hive's spend is not in the list**: `WorkspaceHive` has the step, rounds, check, review and
  live run; `spend` is only in `/api/workspaces/hive`, the read the Review tab makes. Sharing it
  needs no new server data.
- **A shell names its program only**: node-pty's `process` (`node`, `sleep`), not "npm run dev"
  and no port, as the proofs draw.
- **Tool-call counts are not in the list**: the proofs' "14 tool calls" would need the Activity
  tab's read; left out.
- **Switching tabs re-attaches today**: the agent's `AgentTerminal` is unmounted when its tab is
  left and posts `close`; an attach is a Claude Code process (~140 MB, V21). Split and Focus must
  keep it at its place in the tree, or each toggle would attach again.

## V89 — the workspace page and the terminal view, both modes (3 November 2026, branch `feature/redesign-workspace-terminal`)

The steps in the head (normal mode and Hive), named session tabs with their state, the bar under
the terminal, Focus, Split, the side card as the designs draw it, and a plan typeset with Approve
plan and Send reply typed into the terminal. Decisions 823–834.

**Learned**:
- **An Enter typed into a terminal still opening is lost.** The first Approve plan typed its OK
  as soon as the terminal was mounted: the fake agent echoed the text before its prompt showed and
  never saw the Enter. `OpenedTerminal.submit` waits for the agent's input as V78's paste does.
- **Flex shrinks in proportion.** A shrink factor of 100 on what the agent runs on still took a
  pixel from every other item of the head's line, and each showed an ellipsis. It now takes only
  the room left (basis 0, growing).
- **A fit can be stale when a line appears above the terminal.** With a gone worktree the error
  line pushed xterm down 38 px after it was fitted; the old card hid it, the new bar showed it.
  Each pane clips its terminal.
- **Names in the page are shared.** The Activity tab's region is "Now" and the Brief tab's
  paragraph `.workspace-started`: the side card's "Now" and the head's "started" matched both, and
  four specs failed in strict mode.
- **The terminal pays for the bar**: two rows (37 px). The side card stays 256 px rather than the
  proof's 300, so the terminal loses nothing more.

**Verification**: tests first (workspace-steps 14, terminal-bar 10, StageTrack's `you`;
terminal-view.spec 6, the Split fit), seen red for the missing parts; `pnpm check` 2,930 tests;
`pnpm build`; `pnpm test:e2e` all pass: the viewer's 405, the nexus's 20 (the first full run: 25 specs failed, 21 naming what moved, 4 real faults, each fixed). A key to its echo: median 4 ms before and after. Screenshots of every
state, both modes, both themes, 1×, before and after, beside the proofs.

Not verified: a question's number keys on a real Claude Code session (none shown); Hive stopped at
the round cap on screen (unit-tested only); the desktop app's window (the e2e runs in Chromium).

Merged into main (2026-11-03).
