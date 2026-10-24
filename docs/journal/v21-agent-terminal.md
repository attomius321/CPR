# Journal: V21 — The agent's terminal in its feature's panel

[Index](../JOURNAL.md) · [Plan](../plan/v21-agent-terminal.md)

## V21 spike — Claude Code's own terminal in a feature's panel (2026-10-15, branch `milestone/v21-agent-terminal`)

Asked: could the chat the person uses (Claude Code) be in Symbiote instead of V18c's box; of the
ways compared (the Agent SDK hosting the session in `symbiote view`, `claude attach` in a terminal in
the page, V18c with more hooks), "is it easier to do like this?" — the terminal. Question: does
`claude attach <id>` in a pseudo-terminal, drawn by xterm.js in a page, give the whole session
while Claude Code keeps hosting it? Run with Claude Code 2.1.300, Haiku, the person's Pro
subscription: a background session (`--bg`, `manual` permission mode, a hooks file that logs
every event) in a detached worktree of this repository (trusted), started with a clean
environment; a spike server (node-pty 1.1.0, output by server-sent events, keys and resizes as
same-origin JSON POSTs with `x-symbiote`, as every write today) and xterm.js 6.0.0 in Chromium
(Playwright 1.63).

**Learned**:
- **It works whole.** `attach` in node-pty printed its first output in 152–174 ms (4 attaches).
  xterm.js drew Claude Code exactly as a terminal does (123 × 45 at 1000 × 700, 77 columns at
  640 px, reflowed on resize), the person's status line included; a page that joined late got
  the history in 8 ms; no page errors. A key to its echo on screen: median 22 ms, max 37 ms (30
  keys, Playwright's overhead included); the server's write to the next output: median 3 ms,
  p90 21, max 69 (78 writes). Each attach is a Claude Code process: 140 MB resident.
- **Permissions in the page**: a `Write` waited on its dialog (the new file's text shown);
  Enter in the page allowed it, the file was written, `PostToolUse` and `Stop` hooks fired as
  without a terminal.
- **Esc**: on a permission prompt it denies and ends the turn; mid-answer it interrupts
  ("Interrupted · What should Claude do instead?"). Both times **no hook fired** (no `Stop`, no
  `Notification`), and `claude agents` said `status: idle`, `state: working` until the next turn
  ended (11:04 to 11:06:24, across a stop and a restart). V18b's rule reads `state` first, so the
  features view says "Working" for an agent that waits on the person. This already happens on
  `main` when someone attaches through Talk and presses Esc.
- **Typed messages reach the thread**: each prompt typed in the terminal fired
  `UserPromptSubmit`. A message typed while the agent worked was queued ("Press up to edit queued
  messages") and answered after the current turn, each turn with its `Stop`: what V18 left for
  later ("a message kept for the end of the agent's turn") is Claude Code's own behaviour here.
- **Symbiote should type one line at most.** A bracketed paste arrived as `<pasted_content id=…>`,
  which Claude Code tells the agent to treat as text the person may not have written (the agent
  followed it this time); the thread got the wrapper too. Multi-line text typed with
  backslash-Enter kept its backslashes, and its first Enter did not submit. One line, then
  Enter, submitted 4 of 4.
- **Two clients** on one session both drew it and both could answer; the session drew at the
  newest client's size (the 123-column client showed 100-column lines). Hanging one up (SIGHUP,
  as a closed tab) left the session running, same process.
- **`claude stop` while attached**: the client printed "Session … has exited" and exited 0;
  `SessionEnd` fired. **`attach` on a stopped session restarts it** under the same ID with its
  saved options (`SessionStart` `resume`, the hooks file, `manual` mode), without a turn.
  `attach` to an unknown ID printed "No job matching…" and **exited 0**.
- **← on an empty prompt opens Claude Code's agent view**: every background session (one of the
  person's other sessions was listed), a box to start a new session, reply to another, delete
  one (ctrl+x). A panel cannot keep the terminal on its feature's session.
- **Light background**: Claude Code keeps its own theme; on white its `●` marks vanished and
  prompts sat on dark bars. Its theme is Claude Code's setting, not the client's.
- **node-pty 1.1.0** ships prebuilt binaries for macOS and Windows only (64 MB unpacked). On
  Linux it compiles one C++ file with node-gyp (1.6 s with Node's headers cached; needs
  python3, make, g++); pnpm 10+ skips its build script until allowed (`onlyBuiltDependencies`),
  and the module then fails to load. Built on Node 26 it loaded on Node 24 (Node-API).
- **xterm.js 6.0.0**: 345 KB minified (89 KB gzip), 7 KB CSS, the fit add-on 2 KB; the viewer's
  main bundle is 564 KB today.
- The CI matrix (Ubuntu with Node 22 and 24, macOS with 24), the Action (`action/install.sh`)
  and the GitLab template (`node:22`) install the whole workspace.
- Restarting the spike server with `kill $(pgrep -f '[n]ode server.mjs')` in a command that also
  started `node server.mjs` killed that shell (CLAUDE.md's `pkill` trap, once more).

**Not tested**: Windows (ConPTY) and macOS; Firefox and Safari; a question (`AskUserQuestion`)
answered in the page; a session in `failed`; `symbiote view` itself (the spike server stood in for
it); `pnpm install --no-optional` with a frozen lockfile. Everything made was removed: the
session (`claude stop`, `claude rm`), the worktree, and Claude Code's records of its folder
(`claude purge`: the transcript, 8 prompts in the history, the config entry).

## V21 — The agent's terminal in its feature's panel (2026-10-18, branch `milestone/v21-agent-terminal`)

Asked: "Yes. Go for it, implement it, starting with the bug". The interrupted-state fix first
(entry above), then V21a (terminals in the server) and V21b (the Terminal tab), on one branch.

**Learned**:
- **Esc still reads `working` and `idle` on Claude Code 2.1.302**, for the 40 s watched; Symbiote said
  "Interrupted: waiting for you" 301 ms after it. A session reopened by `attach` after a stop
  reads the same way, so the thread decides between finished and interrupted.
- **Lines written in one go are typed, not pasted**: a 229-character write, then Enter as its own
  write, reached the agent as a plain prompt; so did a burst typed at once. The spike's
  `<pasted_content>` came from a bracketed paste, which Symbiote never sends.
- **pnpm 12 approves builds with `allowBuilds`** in `pnpm-workspace.yaml`. A first "no compiler"
  test passed for the wrong reason: pnpm reused the build from its store (0.17 s, `pty.node` in
  place). With `--config.side-effects-cache=false`, the failed build left the install at exit 0
  and node-pty dropped, as an optional dependency should be.
- **`--no-optional` is not an option for the Action**: the lockfile's 80 optional packages
  include the build's native binaries (rolldown, lightningcss).
- **xterm.js draws only the visible rows**: a check that waits for the screen's text to grow by
  400 characters never ends, and one that polls every 100 ms measures every key as 104–106 ms.
  Measured again per animation frame: 32–33 ms, two frames.
- **An event stream's head is the answer's status**: sending it before knowing whether the
  terminal exists turns a 404 into "headers already sent". The server now listens first and
  keeps what arrives until the head is out.
- **The e2e fake is a script in a template literal**: its new `attach` used single backslashes,
  which became line breaks inside the generated script's strings, and every fake call failed
  (no `sessions.json`). Syntax-check a generated fake (`node --check`) when a spec fails before
  its point.
- **An open terminal and a stopped session**: asking "this continues the stopped session"
  whenever the session reads stopped hid the terminal's last lines after a stop from the head; it
  is asked only when a terminal is about to open.

**Verification**: tests first, except `terminal.ts` (written before its tests, which then failed
only for the missing module). 717 unit tests (24 new, one in a real pseudo-terminal), 101 e2e (3
new). A real Claude Code (2.1.302, Haiku 5.5, the person's Pro subscription), five throwaway
features through `symbiote view`: the session drawn and a question answered in the page; prompts typed
and written reaching the thread; Esc read as interrupted; a stop shown in 755 ms and reopened in
230 ms; leaving the tab hanging up only the client; no page errors; everything removed, Claude
Code's records of the folder too. One run's message was not submitted (typed before Claude Code
said `idle`); not explained. Not verified: Windows, macOS, Firefox, Safari; a permission prompt
in Symbiote's terminal (`auto` asked none); four real terminals at once.

Merged into main (2026-10-18), after the state fix. `main` verified after the merge: 717 unit
tests, build, 101 e2e.
