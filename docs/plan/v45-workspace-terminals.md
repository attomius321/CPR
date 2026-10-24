# V45 — More terminals in a workspace: shells in its worktree

[Index](../PLAN.md) · [Journal](../journal/v45-workspace-terminals.md)

**Status:** ready for review (2026-10-24), on branch `feature/workspace-multiple-terminal` (a
workspace started in Symbiote, from `main` at `c4ff77a`); the plan and its three choices OK'd by the
person ("1. For the moment, just a shell. 2. For the moment Shell is ok. 3. Yes. OK"). As built
and results under "As built (V45)" below.

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
| V45a ✅ | Shells in the server | Kept terminals in `terminal.ts` (no idle hang-up, outside the limit of 4, `running`); a workspace's shells in `workspaces.ts` (open, list, 8 at most, closed at Clean up); `POST /api/workspaces/shell`, `GET /api/workspaces/shells` |
| V45b ✅ | Shells in the panel | The shells' tabs, `+` and ×, `&shell=<n>`; `AgentTerminal` listening to a terminal by ID; the close question; README |

**Decisions** (294–298, as proposed; OK'd with the plan):

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

## As built (V45)

- **A shell carries its number, not its name**: `{ id, number, running? }` (`WorkspaceShell` in
  `@symbiote/core`); the page names it `Shell <n>` and puts `&shell=<n>` in the address.
- **What runs in it** (`Terminals.running`): node-pty's foreground program by name, against the
  name of the program the terminal started, so the shell at its prompt is null. A login shell's
  `-bash` and Windows' `CMD.EXE` are read as `bash` and `cmd`. Undefined is "no such terminal":
  the workspace's list drops a shell that exited or was closed by that.
- **The shell on Windows** is `%COMSPEC%` found whatever the case of its name (Windows names it
  `ComSpec`; a copy of the environment keeps the case), and never Git Bash's `SHELL`. Not run.
- **Numbered once open**: the number is taken after the terminal opens, with no wait between, so
  two shells opened at once cannot share one. The limit is checked before (two at once could make
  a ninth: not worth a lock).
- **Clean up closes the shells after its refusals** (not merged, files not committed), just before
  the worktree goes: a refused Clean up leaves them running.
- **The list needs `x-symbiote`** (`GET /api/workspaces/shells`): a 403 without it or from another
  origin, before the method and branch checks.
- **A new shell's size**: `+` opens the shell before any terminal is drawn for it, at the size the
  last terminal in the page was fitted to (80 × 24 before any); the tab then fits it to its box and
  sends that size, as it does each time it is shown (another window may have resized it).
- **`AgentTerminal` with an `id`** listens to a terminal that is open: no POST to open, no close
  when it unmounts, and the list is not read every 5 s for it (V21's reason, a key that starts a
  turn, is the agent's).
- **Which tab shows when a shell goes**: its neighbour, the one before first, else the one after,
  else the agent's default tab (Terminal, else Thread). The plan said "the tab before it", which
  for `Shell 1` is Brief.
- **× reads the list again** before closing, for what runs now; a program there asks first in the
  panel's confirm line ("Close it" / Cancel), as Clean up does.
- **The strip in the title bar** (Symbiote's window) scrolls sideways like the page's: it got 4 px
  of padding inside a −4 px margin, so a focus ring is not cut by the scrolling box and the tabs
  stay where they were.
- **The e2e harness runs `/bin/sh` with `PS1='shell$ '`** for workspaces' shells, not the person's
  shell (`serveWorkspaces({ shell })` for another).
- **A program that set its title** is named by the title's first word on Linux: closing a shell
  running `npx vitest --watch …` first asked "shells.test.ts is running", node-pty giving npm's
  title (`npm exec vitest --watch packages/viewer/test/shells.test.ts`) as the program; now "npm
  is running in Shell 1". Windows' name is taken as it is (spaces are part of its paths).
- **The strip with many shells**, seen in screenshots at 900 px with eight: the picked tab and `+`
  were scrolled out of sight. The picked tab now scrolls into sight when it is picked and when the
  strip narrows (a `ResizeObserver`), clear of `+`, which stays pinned at the strip's end
  (`position: sticky`); the wheel scrolls the strip sideways. At 1440 px with the changes panel
  eight shells overflow by 19 px.
- **A shell that goes** (×, `exit`) is removed by ID, twice being once (a close is followed by its
  exit event), and the tab shown for it is derived while rendering; see the journal.
- **The environment**: a shell gets `symbiote view`'s, as the agent's terminal does. Started through
  `npx`, that includes npm's `npm_config_*` variables (the person's nvm warned about
  `npm_config_prefix` in the check below). Left as it is.

**Results.** Tests first, red for the missing pieces, except the e2e (written after the panel) and
the 900 px check (written after the fix the screenshots asked for). Unit: 1,401 (1,387 on `main`;
14 new: terminal 5, one in a real pseudo-terminal running `/bin/sh`; workspaces 3; server 1; the
viewer's shells 5). e2e: 221 of 221, twice in a row (220 on `main`; one new test, and checks added to
the no-terminals, Codex `exec` and app title-bar tests). An earlier full run failed once in
`changes.spec` ("] … kept across a reload"), which passed 6 of 6 alone and in both later full runs.

Real use, through `symbiote view` (the e2e's fake agent) in Chromium at 1440 × 900, with the person's
bash 5.2 and its rc files:

| Check | Measured |
|---|---|
| `+` to the shell's first output | 293–315 ms (4 shells, two runs) |
| A shell's memory | 9.3–9.5 MB resident (9,472–9,728 KB) |
| Back to a shell, its output redrawn | 71–86 ms (10 switches; median 83). Over the 50 ms planned: each switch makes the xterm.js terminal and its event stream anew; keeping one stream per shell open would meet HTTP/1.1's 6 connections per origin |
| `npx vitest --watch` in Shell 1 | Still running after Shell 2, Thread, Terminal, another workspace's shell, 12 s, and a reload; its output there |
| × on it | "npm is running in Shell 1: closing the shell ends it."; Close it: vitest's 3 processes and the shell gone |
| Quitting `symbiote view` | The two shells left gone 45 ms later |
| `top` in a shell, left, the window narrowed to 1100 × 700, back | Drawn whole at the new size |
| Page errors | None |

Screenshots light and dark at 1440 and 900 px: no shell, one, eight, the close question; `top`
after a resize. Main bundle 698,278 → 701,812 bytes (+0.5 %); xterm.js's chunk unchanged.

Not verified: Windows (`%COMSPEC%`, ConPTY) and macOS; Firefox and Safari; Symbiote's window by eye
(its title-bar test passes with Shell 1 and `+` in the bar; no screenshot); `/workspaces` first paint
against `main`; a real Claude Code beside the shells (the agent's terminal is unchanged and its
tests pass).
