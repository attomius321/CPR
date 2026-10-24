# V38 — Paths and links in an agent's terminal

[Index](../PLAN.md) · [Journal](../journal/v38-terminal-links.md)

**Status:** merged into main (2026-10-23, from branch `feature/clickable-paths-from-agent-terminal`,
a workspace started in Symbiote; approved in Symbiote at `a6af371`). The spike is in the journal
("V38 spike"); as built and results under "As built (V38)" below.

**Problem** (asked: "Provided paths from an agent terminal should be clickable...and open"; and,
for web addresses, "I also want links"). The agent's terminal (a workspace's Claude Code or Codex,
V21 and V27b; Scout's, V35) draws what the agent prints, and nothing in it can be followed. Read in
the code of xterm.js 6.0.0, Claude Code 2.1.308 and Codex 0.163 as installed here:

| What the agent prints | What a click does today |
|---|---|
| A path as text: `Read(packages/cli/src/editor.ts)`, `src/a.ts:12:5`, `/home/…/a.ts` | Nothing: the terminal has no link provider |
| A web address as text: `https://github.com/…/pull/12` | Nothing |
| A link of its own (OSC 8): Codex's TUI has a `terminal_hyperlinks` module with `file://` targets; Claude Code makes them only when it thinks the terminal can (`TERM_PROGRAM`, `FORCE_HYPERLINK`, whatever the server inherited) | xterm.js's default: `confirm("Do you want to navigate to …? WARNING: This link could potentially be dangerous")`, then `window.open`, of no use for `file://` |

Symbiote already opens files in VS Code from the server (V12 a diff's line; V29d a workspace's
file, `vsCodeFolder` with `at`): `code <folder> --goto <file>:<line>:<col>`.

**Goal**: in every agent terminal Symbiote draws, a path the agent printed to a file in the
terminal's folder, and any web address, is underlined under the pointer with a hint saying what it
opens; Ctrl+click (⌘+click on macOS) opens the file in VS Code at the line printed, in the window
with that folder, or the address in a new tab (the desktop app: the system browser). **Unchanged**:
a plain click, selection, keys, paste and images (V36), the terminal's other routes; no new
dependency.

## Server (`packages/cli/src/terminal.ts`, `server.ts`)

- A terminal remembers the folder it was opened in (`cwd`): a workspace's worktree, Scout's
  repository.
- `POST /api/terminals/<id>/paths { paths }`: each path (at most 50, each at most 1,024
  characters) resolved against that folder — relative, absolute, `~/` — and answered `{ files }`,
  those that are regular files inside it. Under the write rule as every terminal write (JSON,
  `x-symbiote`, same origin): which files exist is not for another site.
- `POST /api/terminals/<id>/open { path, line?, column? }`: the same resolution, then
  `code <folder> --goto <file>:<line>:<column>` through `vsCodeFolder` (its `at` gains a column).
  The line as printed: the agent speaks of the working copy, so there is no V12 mapping. 404
  without such a terminal, 400 a path outside its folder, 409 not a file, 502 VS Code failed (its
  words), 409 without an editor.

## The page (`packages/viewer/src/AgentTerminal.tsx`, `terminal.ts`)

- **Finding them** (pure, unit-tested): `terminalLinks(text)` gives each candidate's offsets in a
  row's text: web addresses (`http://`, `https://`, their closing `)` or `.` kept only when they
  belong to the address), and paths — `a/b.ts`, `./`, `../`, absolute, `~/`, a bare `README.md` —
  with an optional `:12`, `:12:5`, `:12-20` or `#L12`; surrounding `()`, backticks, quotes and
  brackets stripped, a trailing `.,;:` dropped.
- **Links** (`term.registerLinkProvider`): the hovered row, joined with the rows xterm.js wrapped
  it onto, offsets mapped to cells (a wide character such as `⏺` before a path takes two). Paths
  are asked of `…/paths` once a row and the answers kept for the terminal's life (a path not found,
  asked again after 5 s); only files become links. Web addresses need no question.
- **The agent's own links** (`linkHandler`, OSC 8): `file://` and `vscode://file/…` opened as a
  path; `http(s)` as a web address; others ignored. No `confirm()`: the hint shows where the link
  goes, as the text may say something else.
- **Following one**: Ctrl+click (⌘ on macOS, where Ctrl+click is the context menu); a plain click
  stays the terminal's. On hover a hint above the link, "Open in VS Code · Ctrl+click" or the
  address, in the style's tokens.
- **Errors** (VS Code not found, the file gone) in the terminal's error line (V36's).

## Spike first

In a throwaway clone, with the real Claude Code (`claude attach`, as Symbiote opens it) and Codex
(`codex resume --remote`), the cheapest model, the terminal's environment as Symbiote gives it:

1. The raw output of a turn that reads and edits files and cites `path:line`: the forms paths
   take, and where the agent wraps a line itself (two rows xterm.js cannot join).
2. Whether either prints OSC 8 links in Symbiote's terminal, and their targets.
3. Whether either turns mouse tracking on: xterm.js then sends clicks to the agent, and a link
   would need Shift as well.

## Verification

1. **Tests first** (red before): the viewer's `terminal.test.ts`, `terminalLinks` on rows copied
   from the spike and traps (`e.g.`, `1.2.3`, `v0.11.0`, an address in parentheses, trailing
   punctuation), the cell mapping with wide characters and wrapped rows; the CLI's
   `terminal.test.ts`, resolution (relative, absolute inside, `~`, `..` out of the folder refused,
   another folder refused, a folder not a file); `server.test.ts`, both routes (403, 404, 400,
   409, the editor's arguments).
2. **e2e**: the fake `claude attach` prints a row with an existing `src/…:3`, a missing file, a
   path outside its worktree and a web address. Only the file and the address are links;
   Ctrl+click gives the fake VS Code `[worktree, --goto, <worktree>/src/…:3:1]`, and the address a
   new tab; a plain click opens nothing; an OSC 8 `file://` link opens the same way; Scout's
   terminal opens files in the repository; without VS Code, the error line. Every spec as before.
3. **Real agents**, through `symbiote view` on the throwaway clone: a workspace's Claude Code and
   Codex terminals and Scout's, paths from a real turn opened in VS Code here (WSL); the requests
   counted while the pointer crosses a full screen of output. Everything made removed after.
4. **Viewer**: the hint's screenshot, dark and light (the terminal is black in both); the bundle
   against `main`'s; nothing new loads before a terminal opens.
5. No analysis code changes: `pnpm check`, `pnpm build`, `pnpm test:e2e`; no regression sets.

**Risks**

| Risk | Mitigation |
|---|---|
| A word taken for a path | Only files the server finds in the terminal's folder become links |
| An agent that takes the mouse | The spike first; if so, Shift as well, as xterm.js forces selection with it |
| A request each time the pointer moves | One per row, the answers kept |
| A link whose text is not where it goes (OSC 8) | The hint shows the target; only files in the folder, `http` and `https` are followed |
| A path the agent wrapped itself, over two rows | Not joined (only xterm.js's own wraps are); said in the results |
| Windows (`C:\…`) and macOS | Unit-tested only; said in the results |

**Order**: the spike; the server (tests, routes); the page (tests, the provider, e2e); the real
agents, screenshots, README.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V38 | Paths and links in an agent's terminal | The spike; `…/paths` and `…/open`; the link provider, the OSC 8 handler and the hint in `AgentTerminal`; the fake's paths; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 251 | What a path opens | **VS Code, at the line printed, in the window with the terminal's folder** | Symbiote's one editor (V12, V29d), run from the server where the files are: no case for WSL or SSH. |
| 252 | Which text becomes a link | **A path only when the server finds a file there; a web address always** | Precise beats complete: a word that looks like a path (`e.g.`, `v1.2`) must not be underlined. |
| 253 | How a link is followed | **Ctrl+click (⌘+click on macOS); a plain click stays the terminal's** | Asked. VS Code's terminal, Windows Terminal and iTerm do the same; a click to focus the terminal must not bring VS Code forward. |
| 254 | A path outside the terminal's folder (`~/.claude/…`, the main checkout, `/tmp`) | **Not a link** | Asked. It would open in the worktree's window, among files it does not belong to. |
| 255 | The agent's own links (OSC 8) | **`file://` and `vscode://file/` as a path, `http(s)` as an address, the rest ignored; no `confirm()`** | xterm.js's warning came for every link and could not open a file; the hint shows the target instead. |
| 256 | Where a web address opens | **A new tab (the desktop app: the system browser, its `setWindowOpenHandler`)** | Asked ("I also want links"); the page keeps the terminal. |

**Not in V38 (later)**: paths outside the terminal's folder; a path the agent wrapped over two
rows itself; another editor than VS Code; opening a file in Symbiote (its changes panel or diff);
links in the Thread (V18c), whose Markdown has its own.

## As built (V38)

- **grep's `path:line:text`**: found with the real Codex, whose `rg -n` printed
  `packages/app/src/greet.ts:4:export function greet(…)` as one word to the first space; the whole
  word was asked for as a path and nothing was linked. A path followed by `:line:` and text is now
  read first, and the link is `path:line` (a test, red first).
- **Codex takes the mouse, and Ctrl+click still follows a link** (spike question 3): xterm.js's link
  detection listens on the terminal's element on its own, while it reports the click to Codex.
  Codex 0.163 drew nothing in answer: the screen's text was the same before and after each of the
  13 Ctrl+clicks compared. No Shift is needed.
- **No `FORCE_HYPERLINK`**: Claude Code's output stays what its environment makes it. Paths as text
  go through the link provider, its OSC 8 links (when on) through the handler; on the same cells,
  xterm.js keeps the OSC 8 link and drops the other.
- **The hint in the terminal's own colours** (`#e6e6e9` on the black screen, its keys as a key
  cap), not the page's inverted tooltip: in the light theme that would be dark on black. Otherwise
  the style's tooltip: shown after 400 ms, so a pointer crossing the screen flashes none.
- **The folder's real path** is accepted as well as the one the terminal was opened with (macOS's
  `/var` and `/private/var`; a folder reached through a link); VS Code gets the latter.
- **Answers kept**: a file stays a file for the terminal's life; a path not found is asked again
  after 5 s, a failed request at once.
- **Not found as paths**: a path with a space, and Next.js route groups (`app/(auth)/a.tsx`): a
  word ends at a space or a parenthesis, which `Update(src/a.ts)` needs.

**Results.** Tests first, red for the right reason: the CLI's `terminal.test.ts` 4 (`files` and
`openFile` missing), `server.test.ts` 1 (405, no route), the viewer's `terminal.test.ts` 10 (the
functions missing) and later the grep row, and the e2e workspace test on `main`'s
`AgentTerminal` (no hint). `pnpm check` 1,280 tests before `main`'s V37 was merged in, 1,288
after. e2e: the new workspace test (a file of the worktree opened at its line, a plain click
opening nothing, a missing file and one outside not linked, an OSC 8 `file://` link, a web address
in a new tab, a file gone since in the error line) and a Scout test (the checkout's file); with
`main` merged in, 200 of 200. Before, two full runs lost one and two keyboard-focus tests that pass
alone; one of them, `shell.spec`'s "a card keeps the focus when its workspace moves", fails on
`main` too (its own full run: 197 of 198; alone, 3 of 8 runs on `main`, 4 of 8 here).

With the real agents through the page in Chromium (1440 × 900), on a throwaway repository with
`symbiote view` from this build and a recorder as `SYMBIOTE_CODE`:

| Terminal | Agent | Linked and opened | Not linked | Codex's screen after Ctrl+click |
|---|---|---|---|---|
| Scout's | Claude Code 2.1.308, Haiku 5.5 | `math.ts:2`, `math.ts:7`, `greet.ts:4`, the README's absolute path (VS Code: `code <checkout> --goto <file>:<line>:1`); the PR's address in a new tab | — | — |
| A workspace's | Codex 0.163, GPT-6-Luna (mouse tracking on) | `rg` output (`greet.ts`, `math.ts`, `greet.ts:4`, `greet.ts:5`), the answer's three `path:line` and the README in the worktree; its OSC 8 link to the PR in a new tab | the main checkout's `symbiote/AGENTS.md` (outside the worktree) | unchanged, 13 of 13 compared |

Moving the pointer over a whole screen of output (4 px steps, about 800 px): Claude Code 4
`…/paths` requests (4 paths), Codex 10–11 (11–12 paths). No page errors, no error line. The hint, dark
and light: the same, the terminal being black in both. Cost: the main bundle 660,474 → 665,684
bytes (+5,210; +2,252 gzipped), the stylesheet +533; the xterm.js chunk the same 331,178 bytes,
and nothing new loads before a terminal opens. Cleaned up after: the workspace (Clean up),
Scout's conversation, Claude Code's records of the folder (`claude purge`), the two trust entries
Codex wrote, the repository.

Not verified: a real VS Code window (a recorder took `code`'s arguments; V12's `--goto` is
unchanged, its column now passed); Claude Code's own OSC 8 links in Symbiote (its `file://` form
read in the spike, followed in e2e from the fake); macOS (⌘+click) and Windows paths, unit-tested
only; the desktop app's new tab, which its `setWindowOpenHandler` sends to the system browser;
Firefox and Safari; `/history` first paint, not measured again (the bundle +0.8 %).
