# V21 — The agent's terminal in its feature's panel

[Index](../PLAN.md) · [Journal](../journal/v21-agent-terminal.md)

**Status:** merged into main (2026-10-18, from branch `milestone/v21-agent-terminal`): V21a and
V21b, after the state fix (`fix/agent-idle-after-interrupt`, merged first). The
spike is in the journal ("V21 spike"); as built and results under "As built (V21)" below.

**Problem** (asked: "Can we somehow integrate this chat inside my app, instead of the current
chat?"; then, of the ways compared, "is it easier to do like this?" — `claude attach` in a
terminal in the panel). Since V18c a feature's panel shows the agent's reports and one box, and
everything else happens in Claude Code's own session, which Symbiote only copies a command for (Talk:
`claude attach <id>`, pasted in a terminal elsewhere). Measured in the V18c and V21 spikes
(Claude Code 2.1.300, Haiku, a Pro subscription):

| What V18c has | Measured |
|---|---|
| What the agent did between reports: in the session only | The thread gets `last_assistant_message` per turn; tool calls, their output and the text before them stay in Claude Code |
| A reply stops the session, then resumes it | 1.6 s, and a turn in progress is lost ("Stop and send"); in a terminal, a message typed while the agent works is queued and answered after the turn, each turn with its `Stop` |
| A permission or a question: shown, answered by attaching | In the page, Enter on a `Write`'s dialog allowed it; the file was written and the hooks fired as without a terminal |
| Talk copies `claude attach <id>` | `attach` in a pseudo-terminal: first output in 152–174 ms; xterm.js drew it whole (123 × 45 at 1000 × 700; 77 columns at 640 px); a key to its echo 22 ms median, 37 ms max |
| (Esc in an attached session, possible on `main` through Talk) | No hook fires; `claude agents` says `status: idle`, `state: working` until the next turn ends: the features view says "Working" for an agent that waits on the person |

**Goal**: a feature's panel can show its agent's session as Claude Code draws it — the
conversation, tool calls, dialogs, Esc, queued messages, slash commands — beside the list, while
Claude Code keeps hosting the session (`--bg`, decision 95) and Symbiote's hooks keep recording the
thread (decision 108). Where the terminal cannot run (node-pty missing or not built), the panel
is V18c's, Talk copying as today. A repository with no feature starts nothing new; nothing in
the analysis changes.

## The terminal (CLI, server)

- **`packages/cli/src/terminal.ts`**: open terminals, each one `<claude> attach <id>` in a
  pseudo-terminal (`node-pty`, loaded with `import()` the first time a terminal is asked for), in
  the feature's worktree, with `symbiote view`'s environment and `TERM=xterm-256color`,
  `COLORTERM=truecolor`. Each keeps its output since it started (at most 1 MB, the oldest
  dropped: a page that reconnects redraws from there, measured 8 ms) and its listeners.
- **Which session**: the feature's newest session (V18b's choice, by folder). `attach` to an
  unknown ID exits 0 ("No job matching…"), so Symbiote attaches only to a session `claude agents`
  lists, and answers 409 with what to do otherwise ("Start the agent"). Attaching to a stopped
  session restarts it with its saved options and no turn (measured): allowed, and the panel says
  so before ("Opening the terminal continues the stopped session").
- **Routes**, under V18's rules for writes (same-origin JSON with `x-symbiote`):
  - `POST /api/features/terminal` `{ branch, cols, rows }` → `{ id }`: an unguessable ID (16
    random bytes). Creating needs the write rule, so another site cannot start a process.
  - `GET /api/terminals/<id>` → server-sent events: `out` (the output so far, then live chunks),
    `exit` (the client's last line, e.g. "Session … has exited", and its code).
  - `POST /api/terminals/<id>/in` `{ data }` (at most 64 KB); `…/resize` `{ cols, rows }`;
    `…/close`.
- **Lifetime**: one terminal per open panel. It is hung up (SIGHUP: measured to leave the
  session running) on close, when its stream has been gone 10 s (a reload reconnects within
  that), and when `symbiote view` exits. At most 4 at once (each attach is about 140 MB); a fifth
  closes the oldest without a listener, else 409.
- **Without node-pty**: `/api/features/options` says `terminal: false` with the reason (not
  installed, or "built for another Node" with its error); the panel keeps Talk.

## The panel (viewer)

- The head's **Talk** becomes **Terminal** when terminals can run: the panel's lower part
  switches between "Thread" (V18c's thread and box) and "Terminal"; `?branch=<name>&terminal`
  in the address, so a reload reopens it. Without terminals, Talk copies as today.
- **xterm.js** (`@xterm/xterm`, `@xterm/addon-fit`) is loaded with `import()` when a terminal
  first opens: its own chunk (89 KB gzip), so the commits page and `/features` load what they do
  today. Fitted to the panel, resized with it (`ResizeObserver` → `…/resize`).
- **Dark in both themes**: Claude Code keeps its own theme whatever the client's background
  (measured: on white its `●` marks vanish). The terminal's colors are the dark theme's tokens.
- **Keys**: one POST at a time, what was typed meanwhile sent together (measured: 22 ms a key).
  The page's shortcuts already ignore keys from a text area (`FeaturesPage.tsx`), which is
  where xterm.js types.
- **The box while the terminal is open**: hidden. A reply through it stops the session, and a
  stop ends the attach (measured).
- **Send the verdict** with the terminal open types one line into the agent's input and does not
  press Enter (decision 82): the verdict's first line and where the review is ("Address this
  review of the branch feature/x (anton, at 1a2b3c4): changes requested. The review:
  symbiote/reviews/feature/x/anton.json; how to act on it: symbiote/AGENTS.md."). Not the whole text: a
  paste reaches the agent as `<pasted_content>`, and typed lines kept their backslashes
  (measured). With the terminal closed, the box as in V18c.
- **When the session ends** (stopped from the panel or elsewhere), the terminal shows the
  client's last line and "Open again"; Stop / Start stay in the head as in V18b.
- A line under the terminal: "← in an empty prompt lists all your agents" — Claude Code's agent
  view can switch to another session, start one without Symbiote's hooks, or delete one (measured);
  Symbiote cannot keep the terminal on its feature.

## The agent's state after Esc

- In `agentState`, `status: idle` with `state: working` is a turn that ended without a report
  (interrupted): "needs you", in words "Interrupted: waiting for you". Measured: no hook fires
  on Esc, and `state` stays `working` until the next turn ends. This is on `main` today through
  Talk: fixed first on its own branch (`fix/agent-idle-after-interrupt`, test first), if agreed.

## Install

- `node-pty` an **optional** dependency of `@symbiote/cli`, its build allowed in
  `pnpm-workspace.yaml` (`onlyBuiltDependencies`). On Linux it compiles (python3, make, g++;
  1.6 s); macOS and Windows use its prebuilt binaries. A failed build fails nothing: the panel
  keeps Talk and says why.
- CI installs that never open a terminal skip it: `action/install.sh` and the GitLab template
  with `--no-optional` (to check with `--frozen-lockfile`); the repository's own CI builds it
  (Ubuntu, macOS), so its tests run with a real pseudo-terminal.
- New runtime dependencies, with their reasons: `node-pty` (Claude Code's interface needs a
  terminal; Node has no pseudo-terminal), `@xterm/xterm` and `@xterm/addon-fit` (a terminal in
  the page; the one VS Code uses). No WebSocket library: events and POSTs keep the server's
  write rule.
- README: the Terminal, what Linux needs to build it, and Talk without it.

## Verification

1. **Tests first** (red before): `terminal.ts` with a fake pseudo-terminal — create, output
   kept and capped, input, resize, close, hang-up 10 s after the stream goes, the limit of 4,
   IDs required and unguessable; the routes (409 without a session, 403 without `x-symbiote`);
   `agentState` for `idle` + `working`; the verdict's line; options without node-pty.
2. **e2e** with the fake Claude Code gaining `attach <id>` (a Node script in a real
   pseudo-terminal: draws a prompt, echoes keys, answers a line with "got: …", exits on
   `stop`): open the terminal, type, Enter, see the answer; resize; Send the verdict types one
   line without Enter; Thread hangs up (the fake records SIGHUP); a stopped session reopens;
   without node-pty Talk copies as today; every existing spec passes.
3. **A real Claude Code** (Haiku, a trusted repository, a throwaway feature through `symbiote
   view`): start; open the terminal; answer a permission and a question; Esc, and the state
   says "Interrupted"; a message typed while it works; Stop from the head (the terminal shows
   the exit), Open again; the thread recorded all of it. Everything made removed (`claude rm`,
   the worktree, `claude purge`).
4. **Viewer**: screenshots light and dark at 1440 and 900 px; `/features` first paint and the
   main bundle as on `main` (xterm.js in its own chunk, not loaded until opened).
5. **Cost**: attach under 0.3 s to first output; a key under 50 ms to its echo; 140 MB per open
   terminal, none after it closes (`pgrep` finds no attach).
6. No analysis code changes: `pnpm check`, build, e2e; no regression sets.

**Risks**

| Risk | Mitigation |
|---|---|
| ← opens Claude Code's agent view: another session, one without Symbiote's hooks, deletions | Said under the terminal; Symbiote's states still come from the worktree's sessions; not blocked (← also moves the cursor) |
| node-pty does not build (no compiler, Alpine, a new Node) | Optional; Talk as before, the reason in the panel; macOS and Windows prebuilt |
| Another site drives a terminal | Created only by a write (`x-symbiote`, JSON, same origin); IDs unguessable; the Host check against DNS rebinding as today |
| Two clients share one size (measured) | The newest client's size wins; documented, nothing to fix in Symbiote |
| Memory: 140 MB per terminal | One per panel, hung up when it closes; at most 4 |
| Claude Code changes `attach`'s screen or keys | Symbiote depends on `attach <id>`, its exit and the bytes; the fake pins Symbiote's side |
| Windows (ConPTY), macOS, Firefox, Safari not run | node-pty prebuilds; said in the results; the CI's macOS job runs the unit tests |

**Order**: the state fix first (its own branch, if agreed). Then V21a (server, fake attach,
unit tests), V21b (the panel, e2e), then the real-agent check and screenshots.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V21a ✅ | The terminal in the server | `terminal.ts` (node-pty optional, `attach` in the worktree, output kept, hang-up, limit 4); `POST /api/features/terminal`, `GET /api/terminals/<id>` (events), `…/in`, `…/resize`, `…/close`; `terminal` in the options; the fake's `attach`; `pnpm-workspace.yaml`, the Action and GitLab installs. |
| V21b ✅ | The terminal in the panel | Terminal in the head (Talk without it); Thread · Terminal, `&terminal` in the address; xterm.js in its own chunk, dark, fitted; the box hidden, Send the verdict's one line; exit and Open again; the line about ←; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 111 | How Symbiote shows an agent's session | **Claude Code's own interface: `claude attach <id>` in a pseudo-terminal (node-pty), drawn by xterm.js in the feature's panel; Claude Code keeps hosting the session** | Asked ("is it easier to do like this?"). Spike: the whole session works with nothing drawn by Symbiote. The Agent SDK would host the session in `symbiote view` (closing it stops the agent), its docs do not allow third-party products to offer claude.ai login without approval, and Symbiote would draw every message, tool and dialog itself. |
| 112 | How bytes travel | **Output as server-sent events; keys, resizes and close as JSON POSTs with `x-symbiote`; a terminal created only by a POST** | Keeps the server's write rule (a WebSocket is not covered by it) and adds no dependency; measured 22 ms a key. |
| 113 | A terminal's lifetime | **One per open panel; hung up on close, 10 s after its stream goes, and when `symbiote view` exits; at most 4** | 140 MB per attach; hanging up leaves the session running (measured). |
| 114 | The box and the verdict while the terminal is open | **The box hidden; Send the verdict types one line (the verdict's first line and where the review is), without Enter** | A stop ends the attach; a paste reaches the agent as `<pasted_content>`; typed lines kept their backslashes; nothing is sent without the person (decision 82). |
| 115 | The terminal's colors | **Dark in both themes** | Claude Code keeps its own theme; on white its marks vanished (measured). |
| 116 | Installing node-pty | **An optional dependency whose build is allowed (`allowBuilds`); where it cannot build, pnpm drops it and the panel keeps Talk; the Action and GitLab installs unchanged** | No Linux prebuilds (a compiler is needed). As built: `--no-optional` would also drop the build's own native binaries, and a failed build fails no install (measured). |
| 117 | `status: idle` with `state: working` | **A turn that ended without a report: "Interrupted: waiting for you"** | Esc fires no hook and leaves `state` at `working` until the next turn ends (measured). |

**Not in V21 (later)**: Symbiote's own chat over the Agent SDK (decision 111); answering
permissions and questions with Symbiote's controls (V20b: dropped, decision 163; the terminal answers
them); a terminal for Codex (V20a: `codex resume` in the same terminal, once
Codex is started by Symbiote); keeping the terminal on its feature's session (←); a shell in the
worktree; the terminal on the commits page.

## As built (V21)

- **The state fix first**, on `fix/agent-idle-after-interrupt` (decision 117), merged into this
  branch, which builds on it; it goes into `main` first.
- **Where the page learns that terminals can run**: `/api/features` carries `terminal`
  (`{ available: true }`, or `false` with the reason) once there are features, not
  `/api/features/options`: the page reads the list anyway, the options only in the start dialog.
  A repository with no feature does not load node-pty.
- **Install** (decision 116 as built): pnpm 12 records the approval as
  `allowBuilds: { node-pty: true }` in `pnpm-workspace.yaml` (`onlyBuiltDependencies` is pnpm
  10's). The Action and the GitLab template are unchanged: `--no-optional` would also drop the
  lockfile's 80 other optional packages, among them the build's own native binaries (rolldown,
  lightningcss). Measured instead, in a clean worktree with `make`, `g++` and `c++` failing and
  pnpm's build cache off: `pnpm install --frozen-lockfile` exits 0 and drops node-pty; Symbiote then
  says "node-pty is not installed" and the panel keeps Talk.
- **`SYMBIOTE_TERMINAL=off`** turns terminals off: the e2e case without them, and anyone who prefers
  Talk.
- **Tabs**: "Thread · Terminal" above the panel's lower part, when terminals can run and the agent
  has a listed session; Talk is not shown then. Then, after a first look (asked: "Do we need it
  anymore?" — of the thread), the panel opens on the Terminal and the Thread is the feature's
  history, read only: one way to answer the agent, not two (the box's reply stops the session).
  `&thread` opens on the thread; "Send to the agent" from the Review tab types the verdict's line
  into the terminal. The thread itself stays: the states (decision 117), Send the verdict's offer
  read it, and it outlives the session. Without terminals the panel is V18c's.
- **A reload opens a new client** rather than reconnecting to the old one by ID; the old one is
  hung up 10 s later. The kept output (1 MB) serves an event stream that drops and reconnects by
  itself: the page clears the screen and draws it again.
- **A stopped session's question** is asked when a terminal is about to open, not while one is
  open: a stop from the head leaves the terminal's last lines ("Session … has exited.") in view
  with "Open again".
- **The event stream's head**: the server listens first, keeping what arrives, then sends the
  head and what it kept. The first version sent the head before knowing whether the terminal
  existed, and an unknown ID then failed with "headers already sent" instead of 404.
- **A reopened session reads like an interrupted one** (`working`, `idle`, measured): with the
  thread's report after its last prompt, decision 117's rule reads it as finished ("plan ready"),
  else as interrupted — waiting for the person either way.

**Results.** Tests: 717 unit tests (24 new: terminal 13, one of them in a real pseudo-terminal;
features 3, server 4, viewer 4) and 101 e2e (3 new: keys and the thread, hang-up, reopen, resize,
stop and Open again; the verdict typed without Enter; no terminals). Red before, except
`terminal.ts`, written before its tests (they failed only for the missing module). The V18b spec
for Talk runs without terminals.

A real Claude Code (2.1.302, Haiku 5.5, the person's Pro subscription, the account's default
permission mode `auto`): five throwaway features in this repository through `symbiote view`, driven in
Chromium.

| Check | Measured |
|---|---|
| The session in the Terminal tab | Drawn whole: header, Symbiote's prompt, a question with its options; first output 1.1 s after opening `&terminal` (page, xterm chunk, attach); the question answered with Enter in the page, then "plan ready" |
| What reaches the agent | Typed slowly, typed at once, and one 229-character write then Enter (what Send the verdict does): each a plain prompt in the thread (`UserPromptSubmit`), none wrapped as pasted content |
| Esc while it writes | Claude Code: `state: working`, `status: idle` for the 40 s watched; Symbiote: "needs you, interrupted" 301 ms after Esc; the row "Interrupted: waiting for you" |
| Stop from the head | Claude Code's last lines ("Session a27d1f2d has exited.") 755 ms after the click; Open again asks first; the session back 230 ms after "Open the terminal" |
| Leaving the tab | Our `claude attach` processes 1 → 0; the session went on (`working`, `idle`) |
| Page errors | None |

Everything made was removed: the sessions (Clean up's `claude rm`), worktrees, branches, records,
threads, `symbiote/config.json` (the model, Haiku), and Claude Code's records of the folder (`claude
purge -y`). One run's typed message was not submitted: it was typed as soon as Symbiote's cached state
said "plan ready", before Claude Code's own `idle`; the three runs that waited for `idle` all
submitted. Not explained.

Cost: a key to its echo through Symbiote with the fake agent, 30 keys watched every animation frame,
32–33 ms (two frames); its first output 122 ms after opening. With the real agent, watched every
100 ms: every key under 106 ms. xterm.js in its own chunks, 331 KB (83 KB gzip) and 4 KB of CSS,
loaded when a terminal first opens; the main bundle 575.9 → 581.7 KB.

Not verified: Windows (ConPTY) and macOS; Firefox and Safari; a permission prompt answered in
Symbiote's terminal (`auto` asked none; the spike answered one in a terminal); four real terminals at
once (unit-tested with fakes); the 140 MB per attach, not measured again.
