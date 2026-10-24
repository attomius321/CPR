# V45 — More terminals in a workspace: shells in its worktree

[Index](../PLAN.md) · [Journal](../journal/v45-workspace-terminals.md)

**Status:** planned (2026-10-24), on branch `feature/workspace-multiple-terminal` (a workspace
started in Symbiote, from `main` at `c4ff77a`); waiting for the person's OK. Not started.

**Problem** (asked: "I would like in a workspace to have the capability to open multiple
terminals. The workspace creation stay the same. We only extend"). A workspace's panel has one
terminal: its agent's session (`claude attach <id>`, V21; Codex's TUI on its app server, V27b).
Anything else in the worktree (tests, a dev server, `git log`) needs a terminal outside Symbiote.
Read on `main` (`c4ff77a`) and measured in the V45 spike (node-pty 1.1.0, bash 5.2, Node 26):

| What `main` has | Read or measured |
|---|---|
| Terminals a panel can open | One, the agent's session; V21 left "a shell in the worktree" for later |
| What happens to a terminal when its tab is left | The page closes it at once (`AgentTerminal`'s cleanup); one nobody reads is hung up after 10 s |
| What a hang-up does to a shell | Ends it and its jobs: a foreground `sleep 301` and a background `sleep 300 &` both gone 0.5 s after SIGHUP |
| The terminals' limit | 4 at once, a fifth closes the oldest nobody reads: set for `claude attach`, 140 MB each |
| A shell's cost | bash with the person's rc files: first output 242–245 ms, 9 MB resident |
| What runs in a shell | node-pty's `process`: `sleep` while it ran, `/bin/bash` at the prompt |

So the agent terminal's rules would kill a shell's dev server whenever the person looks at the
thread, and its limit would let a fifth terminal hang one up.

**Goal**: in a workspace's panel, the person opens as many shells in its worktree as they need
(up to 8), each in a tab of its own, beside the agent's tabs. A shell keeps running while the
person looks at another tab, another workspace, or reloads, and ends only when they close it,
type `exit`, clean the workspace up, or quit Symbiote. Unchanged: starting a workspace; the
agent's Terminal, Thread and Brief tabs and their behaviour; a workspace without node-pty (no
shells, Talk as today); nothing in the analysis.

## Shells in the server (CLI)

- **What runs**: the person's shell, `$SHELL` from `symbiote view`'s environment, else `/bin/sh`;
  on Windows `%COMSPEC%`, else `cmd.exe` (not run here). In the worktree, with `symbiote view`'s
  environment and `TERM`/`COLORTERM` as V21's terminals. No arguments: an interactive shell, as
  the person's own terminal opens one.
- **Kept terminals** in `packages/cli/src/terminal.ts`: `open()` takes `kept: true` for a shell.
  A kept terminal is never hung up for having no reader (no 10 s grace), is never the one a new
  terminal closes to make room, and is not counted in the limit of 4 (that one is for `attach`'s
  140 MB). `Terminals` gains `running(id)`: the foreground program (node-pty's `process`), and
  whether it is the shell itself. Output kept as today (1 MB, the oldest dropped), so a tab
  opened again redraws from it (V21: 8 ms to send the kept output).
- **A workspace's shells** in `packages/cli/src/workspaces.ts`: kept in memory per branch, each
  `{ id, name }`, named `Shell <n>` with the lowest number free in that workspace. At most 8 per
  workspace. Open whatever the agent: Claude Code, Codex on its server or through `exec`, or a
  workspace whose agent has no session. Refused (409) when its worktree is gone, when terminals
  cannot run here (the reason, as V21's), or at 8. A shell that exits leaves the list.
- **Clean up** closes the workspace's shells before it removes the worktree.
- **Routes**, under V18's rules for writes:
  - `POST /api/workspaces/shell` `{ branch, cols, rows }` → `{ id, name }`.
  - `GET /api/workspaces/shells?branch=<name>` → `{ shells: [{ id, name, running? }] }`, where
    `running` is the foreground program when it is not the shell. It hands out terminal IDs,
    which give a terminal's output and keys: it needs `x-symbiote` as writes do.
  - Output, keys, resize, close, paths and links (V38) and images (V36): the existing
    `/api/terminals/<id>…`, unchanged.
- **When `symbiote view` exits**, its shells are hung up with every terminal (`closeAll`), as
  today. They are its children: shells do not outlive Symbiote (the desktop app too).

## Shells in the panel (viewer)

- **Tabs**: after Thread and Brief, a thin divider, then one tab per shell (`Shell 1`, `Shell 2`,
  each with a × on hover and when selected) and a `+` icon button, "New shell in the worktree".
  The agent's tabs keep their place and names. Shown when terminals can run here and the
  worktree exists. Many shells scroll the tab strip sideways rather than wrap (checked at 900 px).
- **The address**: `&shell=<n>` opens that shell's tab, so a reload comes back to it. The panel
  reads the workspace's shells when it opens, so a shell opened before a reload, or in another
  window, has its tab.
- **One terminal component**: `AgentTerminal` either opens a terminal (today) or listens to one
  given by ID. Leaving a shell's tab stops listening and does not close it; coming back redraws
  it from the kept output. A shell's tab does not make the list be read every 5 s (V21 does it
  for the agent's terminal: a key there may start a turn). Links (V38) and pasted images (V36)
  work in a shell as in the agent's terminal: an image is saved and its path pasted.
- **Closing**: × closes the shell. When a program runs in it (`running`), it asks first: "node is
  running in Shell 2. Close it anyway?" `exit` in the shell removes its tab; the panel shows the
  tab before it.
- **Unchanged**: Send the verdict types into the agent's terminal only; the box, Talk, Stop and
  Start as today.
- **Style**: the tab strip's existing tab recipe; the `+` and × as the style's icon buttons
  (lucide-style, from `src/ui/icons.tsx`); the shell's screen dark in both themes as the agent's
  (decision 115). The `symbiote-style` skill for the new pieces.

## Verification

1. **Tests first** (red before). `terminal.ts` with a fake pseudo-terminal: a kept terminal is
   not hung up with no reader past the grace time; it is not closed to make room and does not
   count in the limit of 4; `running`; `closeAll` hangs it up. One in a real pseudo-terminal:
   `/bin/sh`, a line typed, its echo, `exit`. `workspaces.ts`: the shell's command, folder and
   environment; names `Shell 1`, `Shell 2`, the lowest free one again after a close; the 9th
   refused; a gone worktree refused; an exited shell off the list; Clean up closes them; a
   Codex `exec` workspace and one with no session get shells. Server: both routes, 403 without
   `x-symbiote` (the list too), a bad branch refused. Viewer: the pure parts (tabs in order, the
   address, the close question).
2. **e2e** (`SHELL=/bin/sh` in the harness for a plain prompt): `+` twice; a line typed in each
   shell, each keeps its own; to Terminal and Thread and back, a `sleep` started in Shell 1
   still runs and its output is there; a reload with `&shell=2` reopens Shell 2 with its output;
   × on the shell running `sleep` asks first, then closes it (the process gone); `exit` removes
   the tab; without terminals no `+`; every existing spec passes.
3. **Real use** through `symbiote view` in Chromium, with the person's bash: `pnpm vitest
   --watch` in a shell keeps running across tab and workspace switches and a reload; two shells
   and the agent's terminal at once; `pgrep` finds none of the shells after × and after
   `symbiote view` exits.
4. **Viewer**: screenshots light and dark at 1440 and 900 px, every state of the tab strip (no
   shell, one, eight); `/workspaces` first paint and the main bundle as on `main` (no new
   dependency; xterm.js still loaded only when a terminal opens).
5. **Cost**: a new shell's first output under 0.5 s; a tab switch redrawn under 50 ms; 9 MB per
   shell, none left after it closes.
6. No analysis code changes: `pnpm check`, build, e2e; no regression sets.

**Risks**

| Risk | Mitigation |
|---|---|
| A shell runs anything as the person | As their own terminal; created only by a write (`x-symbiote`, JSON, same origin), IDs unguessable, the list behind `x-symbiote`, the Host check as today |
| Shells end when Symbiote quits | Said in the `+` button's title; their output is not kept on disk |
| A full-screen program (vim, top) redrawn from kept bytes at another size | The page resizes after redrawing; the program redraws on its resize signal; checked by hand |
| Eight tabs crowd the title bar at 900 px | The strip scrolls sideways; screenshot at 900 px with eight |
| Windows (ConPTY, `%COMSPEC%`), macOS, Firefox, Safari | Not run here; said in the results; the macOS CI job runs the unit tests |

**Order**: V45a (the server, unit tests), then V45b (the panel, e2e), then real use and
screenshots. One branch.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V45a | Shells in the server | Kept terminals in `terminal.ts` (no idle hang-up, outside the limit of 4, `running`); a workspace's shells in `workspaces.ts` (open, list, 8 at most, closed at Clean up); `POST /api/workspaces/shell`, `GET /api/workspaces/shells` |
| V45b | Shells in the panel | The shells' tabs, `+` and ×, `&shell=<n>`; `AgentTerminal` listening to a terminal by ID; the close question; README |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 294 | What a new terminal in a workspace runs | **The person's shell (`$SHELL`, else `/bin/sh`) in the worktree; the agent keeps its one terminal** | Covers tests, a dev server, git, and a second `claude` if the person wants one. A second `attach` to the agent's session draws the same session twice, at the newest client's size (V21 spike). |
| 295 | A shell's lifetime | **Until its ×, its `exit`, Clean up or `symbiote view` exiting; never hung up for having no reader, never closed to make room** | A hang-up ends a shell's jobs (measured: both `sleep`s gone in 0.5 s); a dev server must survive a look at the thread or a reload. |
| 296 | How many | **8 per workspace, outside the limit of 4 terminals** | 9 MB a shell against 140 MB an `attach` (measured); the limit of 4 was set for `attach`. |
| 297 | Where shells are in the panel | **Tabs after the agent's (`Shell 1`, `Shell 2`, the lowest free number), a `+` at the end, `&shell=<n>` in the address** | The agent's tabs keep their place and names ("We only extend"); a reload comes back to the shell. |
| 298 | Closing a shell with a program in it | **Asked first, naming the program** | Closing ends it (decision 295); node-pty names the foreground program (`sleep`, then `/bin/bash`, measured). |

**Not in V45 (later)**: terminals side by side (split); shells that outlive `symbiote view`
(tmux-like); renaming a shell; a shell in the main checkout or on the commits page; choosing
another program than the shell for a new terminal; more agent sessions in one workspace.
