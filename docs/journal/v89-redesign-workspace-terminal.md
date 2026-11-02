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
