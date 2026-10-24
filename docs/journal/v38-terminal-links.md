# Journal: V38 — Paths and links in an agent's terminal

[Index](../JOURNAL.md) · [Plan](../plan/v38-terminal-links.md)

## V38 spike — what the agents print in a terminal (2026-10-22, branch `feature/clickable-paths-from-agent-terminal`)

Asked: "Provided paths from an agent terminal should be clickable...and open", and web links
too. Read first: xterm.js 6.0.0 has no link provider of its own beyond OSC 8, and for those its
default asks `confirm("…WARNING: This link could potentially be dangerous")` and calls
`window.open`. Then the real agents in a pseudo-terminal (node-pty, 120 × 40, `TERM=xterm-256color`,
`COLORTERM=truecolor`, the job's environment without `TERM_PROGRAM`), one turn each on a throwaway
repository (two files in `packages/app/src/`, a README) asking to read both, add a function, and
answer with each function as `path:line`, the README's absolute path, a web address and a
Markdown link; the raw output replayed into xterm.js in Chromium to read its rows.

**Learned**:
- **Claude Code 2.1.308 (Haiku 5.5) prints paths as text**: `● Update(packages/app/src/math.ts)`,
  `- cube (new): packages/app/src/math.ts:12`, absolute paths in `Bash(…)` and its output. A
  Markdown link comes out as `xterm.js (https://xtermjs.org)`: an address's closing `)` is not
  its own. A long `Bash(…)` line was wrapped by Claude Code itself onto a second row, which
  xterm.js does not mark as wrapped. No OSC 8 link, no mouse tracking (only `ESC[?1004h`, focus).
- **With `FORCE_HYPERLINK=1` it makes OSC 8 links**: `file:///…/packages/app/src/math.ts` on the
  `Update(…)` header, `https://xtermjs.org` behind the text "xterm.js", and the web address. Which
  of the two the person sees depends on what environment `symbiote view` was started in
  (`TERM_PROGRAM=vscode` turns links on): both must work.
- **Codex 0.163 (GPT-6-Luna, low) takes the mouse**: the alternate screen (`ESC[?1049h`) and
  any-event mouse tracking (`ESC[?1000h ?1002h ?1003h ?1006h`), still on at the end. xterm.js
  then reports clicks to Codex, while its link detection listens on the same element on its own:
  a click on a link both follows it and reaches Codex (to check in the page).
- **Codex's OSC 8 links are web addresses only**, each drawn four times by its redraws; its paths
  are text: `packages/app/src/math.ts:2`, absolute ones, and `Read math.ts` (a name, not a path
  from the folder: nothing to open). "Added cube to packages/app/src/math.ts
  (packages/app/src/math.ts)": a file citation drawn with its target.
- **Claude Code writes the words of a dialog apart with cursor moves** (`Quick ESC[8Gsafety
  ESC[15Gcheck`): in the buffer the cells between are empty, read as spaces. A row's text must
  come from the buffer, never from the stream.
- A repository under `~/.claude/` makes Claude Code ask before each edit even with `acceptEdits`
  (its own folder); V36's spikes ran under `~/projects`.

Cleaned up after the real-agent checks (V38's verification): see V38's entry.

## V38 — paths and links in an agent's terminal (2026-10-23, branch `feature/clickable-paths-from-agent-terminal`)

Asked: paths an agent prints in its terminal are clickable and open; and web links. In every agent
terminal (a workspace's Claude Code or Codex, Scout's), a path to a file of the terminal's folder
and any web address are underlined under the pointer with a hint; Ctrl+click (⌘ on macOS) opens
the file in VS Code at the line printed, in the folder's window (`POST /api/terminals/<id>/open`),
or the address in a new tab. The server says which printed paths are files (`…/paths`); the
agent's own OSC 8 links go through xterm.js's `linkHandler` instead of its `confirm()`. Decisions
251–256.

**Learned**:
- **xterm.js asks for a row's links once, as the pointer reaches it**, and keeps them while it
  stays on that row: one `…/paths` request a row, and a whole screen swept cost 4 (Claude Code)
  to 11 (Codex) requests. A link provider answers through a callback, so the links wait for the
  server's answer.
- **A link range ends on its last cell, 1-based**, both cells of a wide character included. The
  row's text is read cell by cell from the buffer, an empty cell as a space and the second half of
  a wide one skipped, so `⏺` before a path does not shift the underline.
- **On the same cells, xterm.js keeps the earlier provider's link**: its own OSC 8 provider is
  registered first, so an agent's OSC 8 link wins over the same text found as a path.
- **An OSC 8 link is drawn with a dashed underline at all times** by xterm.js (Codex's web
  addresses); a link from the provider only under the pointer.
- **Codex's mouse tracking does not take the link's click**: xterm.js reports the click to Codex
  and its link detection, on the same element, follows the link; Codex drew nothing in answer.
- **grep's `path:line:text` is one word**: `rg -n` in Codex's tool output joined the path, the
  line and the code's first word; seen only with the real agent, then a unit test.
- **The e2e fake ends its session when a test sets an answer without `status`**: `setSession`
  replaces the state fields; the terminal printed "Session fake0 has exited" and the server
  answered 404. Set `status: 'idle'` with an answer, as Scout's specs do.
- **`shell.spec`'s "a card keeps the focus when its workspace moves" is flaky on `main`**: alone, 3
  of 8 runs failed there and 4 of 8 here (ArrowDown leaves the second card unfocused), and `main`'s
  own full run lost it. Not V38's; not fixed here.
- **`main` took V37 while this was built** (the look, `feature/ui-improvements`): this milestone
  was renumbered V38, its decisions 251–256; its first commits say V37.

**Verification**: tests first, red for the right reason (CLI 4 and 1, viewer 10, then the grep row;
the e2e workspace test on `main`'s `AgentTerminal`: no hint). With `main` (V37) merged in: `pnpm
check` 1,288 tests; build; e2e 200 of 200. The real
Claude Code 2.1.308 (Scout, Haiku 5.5) and Codex 0.163 (a workspace, GPT-6-Luna) through the page
from this build, a recorder as `SYMBIOTE_CODE`: every printed file of the folder opened at its line,
the README by its absolute path, the PR's address in a new tab (Codex's through its OSC 8 link), the
main checkout's file outside the worktree not linked; screenshots of the hint dark and light. Not
verified: a real VS Code window; macOS and Windows; the desktop app's new tab. Cleaned up: the
workspace, Scout's conversation, `claude purge` of the folder, Codex's two trust entries, the
repository.

Merged into main (2026-10-23) by Symbiote's merger, from the approved `a6af371`, no conflicts (the
branch had merged `main` in first).
