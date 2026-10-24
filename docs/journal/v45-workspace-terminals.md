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

## V45 — shells in a workspace's worktree (2026-10-24, branch `feature/workspace-multiple-terminal`)

Asked, after the plan: "1. For the moment, just a shell. 2. For the moment Shell is ok. 3. Yes.
OK". A workspace's panel opens shells in its worktree (`+` after the Brief tab, `Shell 1`,
`Shell 2`, at most 8), kept by `symbiote view` until closed: V45a in the server (kept terminals,
`POST /api/workspaces/shell`, `GET /api/workspaces/shells`, Clean up closing them), V45b in the
panel (the tabs, `&shell=<n>`, `AgentTerminal` listening to an open terminal, the close question).
Decisions 294–298.

**Learned**:
- **dash's `exit` passes on the last status**: after Ctrl+C a bare `exit` ended the shell with 130,
  so the real-terminal test ends with `exit 3` and expects 3. dash, like bash, ends a foreground
  job on a hang-up: `sleep` gone 122 ms after SIGHUP.
- **A close is followed by its exit in the page**: × posts `close`, and the shell's event stream
  then says `exit`. Both removed the shell from the list as read in the render where × was
  clicked. Now a functional update by ID (twice is once), and the tab shown for a shell that went
  is derived while rendering (its neighbour, else the agent's tab), so no frame mounts the agent's
  terminal on the way.
- **`--repeat-each` runs copies side by side**: with 4 workers, the e2e's `pgrep` for its `sleep`
  counted the other copies' (3 where 1 was expected). Its length is now the worker's.
- **A background command's exit code was `tail`'s**: the first full e2e run reported 0 through the
  pipe and had failed once (`changes.spec`'s "] and the head's button hide it": after a reload,
  `]` did not show the changes again). Alone it passed 6 of 6.
- **A program that set its title is named by it**: node-pty read npm's title, `npm exec vitest
  --watch packages/viewer/test/shells.test.ts`, as the foreground program, so × asked
  "shells.test.ts is running". Its first word now ("npm"). Found only with real use.
- **The screenshots found what the tests did not**: at 900 px with eight shells, the picked tab and
  `+` were out of sight in the scrolled strip. Fixed (scroll into sight on pick and on resize, `+`
  pinned), then an e2e check at 900 px.
- **Setting `data-app` after load does not show Symbiote's title bar** in a browser: the bar's slots
  are made at start. The title bar was checked by its Electron test only.

**Verification**: tests first, red for the missing pieces, except the e2e and its 900 px check
(written after the code). 1,401 unit tests (14 new); e2e 221 of 221 twice (one new test, checks in
three others). Real use with the person's bash 5.2: first output 293–315 ms, 9.3–9.5 MB a shell, a
switch back to a shell redrawn in 71–86 ms (the plan's 50 ms missed: each switch makes the terminal
and its stream anew), `npx vitest --watch` running on across tabs, another workspace and a reload,
× naming npm and ending it, the shells left gone 45 ms after `symbiote view` quit, `top` redrawn at a
new size, no page errors. Screenshots light and dark at 1440 and 900 px. Main bundle +3.5 KB.

Not verified: Windows and macOS; Firefox and Safari; Symbiote's window by eye; `/workspaces` first
paint against `main`; a real Claude Code beside the shells.
