# Journal: V45 — More terminals in a workspace: shells in its worktree

[Index](../JOURNAL.md) · [Plan](../plan/v45-workspace-terminals.md)

## V45 spike — a shell in a pseudo-terminal, and what V21's rules would do to it (2026-10-24, branch `feature/workspace-multiple-terminal`)

Asked: "I would like in a workspace to have the capability to open multiple terminals. The
workspace creation stay the same. We only extend". Read on `main` (`c4ff77a`): the server's
terminals (`packages/cli/src/terminal.ts`), the workspace's terminal route
(`workspaces.ts`), the panel's tabs (`Workspace.tsx`) and `AgentTerminal.tsx`. Measured with a
script outside the repository: node-pty 1.1.0 (the main checkout's build), `$SHELL` (bash 5.2.21
with the person's rc files) in this worktree, 100 × 30, Node 26.8, WSL2.

**Learned**:
- **A shell is cheap**: first output 242 ms and 245 ms (two runs, the person's `.bashrc`
  included), 9 MB resident (8,960 KB both runs). An `attach` is a Claude Code process, about
  140 MB (V21 spike): the limit of 4 terminals was set for that.
- **A hang-up ends a shell's jobs**: with `sleep 300 &` in the background and `sleep 301` in the
  foreground, SIGHUP (what V21 sends on close and 10 s after a terminal loses its reader) ended
  the shell (`exitCode 0`, `signal 1`) and both sleeps within 0.5 s. V21's rules suit `attach`,
  whose session goes on; for a shell they would end a dev server whenever its tab is left.
- **The page closes a terminal when its tab is left**: `AgentTerminal`'s cleanup posts `close`.
  A shell's tab must only stop listening; the server already redraws a new reader from the kept
  output (1 MB).
- **node-pty names the foreground program**: its `process` read `sleep` while `sleep 301` ran,
  `/bin/bash` at the prompt (and after Ctrl+C). Enough to ask before closing a busy shell.
- `pgrep -af 'sleep 300'` matched the spike's own shell command line; `pgrep -ax sleep` did not.

Not measured: a shell on Windows (ConPTY) or macOS; a full-screen program redrawn from kept
output at another size.
