# V27 — Codex in the panel's terminal, through its app server

[Index](../PLAN.md) · [Journal](../journal/v27-codex-terminal.md)

**Status:** V27a and V27b merged into main (2026-10-20, from branch `milestone/v27-codex-terminal`).
As built and results: "As built (V27a)" and "As built (V27b)" below.

**Problem** (asked: "Why codex can't run in terminal?" … "Think of a way to make it work … try
codex agents, run a spike"). V20a runs Codex as `codex exec` through Symbiote's runner, which records
its thread from Codex's output. A Codex workspace has no terminal tab (decision 133): `codex
resume` in a terminal would not reach that thread, and V20a's resume lost the sandbox's writable
roots, so it could not commit in the worktree. Codex workspaces also never say "needs you"
(decision 131). Measured in the V27 spike (Codex 0.163.0, the latest):

| What | Measured |
|---|---|
| Symbiote as a client of an app server: `thread/start` in the worktree, the branch's git folders writable, `turn/start` | committed in the linked worktree, 4.2 s for the turn |
| A turn typed in `codex resume <thread> --remote unix://…` (the TUI joined to that thread) | reached Symbiote's client, every item, 3.0 s; committed from the sandbox |
| A turn Symbiote starts while the TUI is open | drawn in the TUI 0.9 s after `turn/start` |
| Symbiote's client gone mid-turn, a new one later | the turn finished; `thread/read` gave all 4 turns back with their items and times |
| An approval (`approvalPolicy: on-request`) | `waitingOnApproval` on the thread's status; Codex's own prompt in a TUI that joined later; answered from Symbiote, resolved for all |
| Trust | "Trust this folder?" once per worktree in the TUI; `-c projects…` ignored |
| The app server's memory | 269 MB for a private one; the person's daemon (212 MB) already runs |

**Goal**: a Codex workspace's panel gets a terminal, as Claude Code's has: Codex's own TUI on
the workspace's thread, and what is typed there in the thread Symbiote shows. Its state says "needs
you" when Codex waits for an approval. Unchanged: Claude Code workspaces; a Codex workspace when
no app server can be reached (V20a's `exec`, as today).

## Design

- **Codex workspaces run on the person's app-server daemon**: its socket from `codex app-server
  daemon version` (started with `daemon start` when it is not running). It is theirs already, it
  keeps threads running when `symbiote view` stops, and `codex agents` lists Symbiote's workspaces with
  their other sessions.
- **Symbiote is a client** over WebSocket on that unix socket: its own small client (the HTTP upgrade,
  text frames, ping), no new dependency. `initialize`, then per workspace:
  - start: `thread/start` (the worktree, `workspace-write`, the branch's git folders as writable
    roots as V20a gives them, `approvalPolicy: on-request`), `turn/start` with the prompt;
  - a reply from the box: `turn/start`, or `turn/steer` while a turn runs (no stop, no lost turn);
  - stop: `turn/interrupt`;
  - its thread: `thread/read` with `includeTurns` (items as V18c's thread entries), and the
    notifications while connected; no runner and no thread file for these workspaces.
- **State** from the thread's status: `active` → working; `active` + `waitingOnApproval` →
  needs you; `idle` → ready or done (V20a's rule on commits); a failed turn → failed.
- **The terminal tab**: `codex resume <thread> --remote unix://<socket> -C <worktree>` under
  Symbiote's terminals (node-pty), as `claude attach` is for Claude Code. The first time in a
  worktree, Codex asks to trust it: the person answers there.
- **Approvals** are answered in the terminal, Codex's own prompt. Answering them with Symbiote's own
  controls was V20b, dropped (decision 163).
- **A workspace started by V20a** (`exec`) keeps V20a's path until it is started again.

## Verification

1. Tests first: the WebSocket client (handshake, frames in both directions, ping, a fragmented
   message, close) against a fake server; the thread from `thread/read`; the state from status
   and turns; the terminal's command; the fallback to `exec` without a daemon.
2. A fake app server for e2e (a WebSocket server on a unix socket), answering as the spike's
   logs show: Codex's terminal tab, a turn there in the thread, "needs you".
3. Real use with the person's daemon: a workspace started, a turn typed in its terminal and in
   the box, an approval answered in the terminal, `symbiote view` restarted mid-turn.

**Risks**

| Risk | Mitigation |
|---|---|
| The app server is `[experimental]`: its protocol may change between Codex versions | The version from `initialize`; methods checked against `generate-ts` per version; V20a's `exec` when a call fails |
| The daemon restarts (an update "may interrupt running work") | Threads are on disk: `thread/resume` after a reconnect; the state says what happened |
| The daemon is the person's: Symbiote's threads sit among theirs | Named after the workspace (`thread/name/set`), archived at Clean up as V20a does |
| The trust prompt in every new worktree | Said in the panel before the terminal opens; the person decides |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V27a ✅ | Symbiote on Codex's app server | The client, start, reply, stop and the thread through the daemon; "needs you"; `exec` when no daemon |
| V27b ✅ | Codex's terminal | The terminal tab for Codex workspaces (`codex resume --remote`), the trust note |

**Decisions** (154 and 155 as built in V27a, 156 for V27b; 157 and 158 made while building V27a):

| # | Question | Decision | Why |
|---|---|---|---|
| 154 | Which app server | **The person's daemon, started when it is not running** | Threads outlive `symbiote view`; `codex agents` shows them; no second 270 MB process |
| 155 | Where a Codex thread comes from | **`thread/read` and the server's events; no runner, no thread file** | The server keeps every turn, from any client (4 of 4 read back after a reconnect) |
| 156 | Trust | **The person answers Codex's prompt in the terminal** | It writes their config; `-c` cannot set it, and Symbiote should not decide it |
| 157 | A thread's options when Symbiote continues it | **None: a bare `thread/resume`; the sandbox, writable roots, approvals and folder are the server's** | The server keeps them with the thread: a bare resume after a restart gave all four back (measured). Passing them again would undo what the person set in Codex's terminal. V20a passed them on every run because `exec resume` kept none |
| 158 | A start the server does not finish | **Unreachable: `exec`, as without a daemon. An answer: the start failed in its words, and a thread it made is kept for Clean up. The thread's name never fails a start** | A second thread beside one already running would be two agents on one branch. In the real run Codex refused the name while the thread's rollout was empty, after its turn had started |

## As built (V27a)

- **A connection per call, no thread kept subscribed.** The plan read the thread "and the
  notifications while connected". A connection that started or resumed a thread gets every delta
  of its turns, and one that did not gets only status changes (probed). So each call opens the
  socket, introduces Symbiote (`initialize`), asks, and closes. A start or a message waits on its own
  connection for the message's `item/completed` (3 s at most) so the page shows it at once: V20a's
  lesson, 5.3 s to the next read without it.
- **The daemon is found with `codex app-server daemon start`** alone, not `daemon version` then
  `start`: it is idempotent (`alreadyRunning`), 57 ms when it runs and 1.25 s from cold (measured
  in a throwaway `CODEX_HOME`), and its last line is JSON with `socketPath`. A call whose socket
  does not answer starts the daemon again once and asks once more. No daemon: asked again a minute
  later, and `exec` meanwhile.
- **Writable roots go in `config.sandbox_workspace_write.writable_roots`** on `thread/start`
  (`sandbox` takes only a mode). Continuing a thread passes no options (decision 157).
- **Two reads.** The list reads the last two turns with `itemsView: "summary"`, each turn's first
  message and final answer: 4–5 ms per Codex workspace on the person's daemon. The panel reads 50
  turns in full, with every message (steered ones too) and Codex's commentary: 10 ms. Not
  `thread/read` with `includeTurns`, which Codex 0.163 calls deprecated for paginated threads.
- **"Needs you" comes from the thread's status only.** The pending approval is not an item (it
  appears once accepted) and goes only to subscribed clients. The panel shows what Codex said
  before asking, when it said something: in the real run it asked with no message, only
  reasoning. The words are "approval prompt" and "question", read after "Waiting:" as Claude
  Code's "permission prompt" is.
- **A message while Codex works joins its turn** (`turn/steer`): the box says Send, not "Stop and
  send". To a turn waiting on an approval, a message stops it first, after asking, as for Claude
  Code. The server answers 409 without `stop`.
- **Start again makes a new thread**, as V20a made a new run. The record keeps the current
  `thread` and the earlier ones in `threads`. Clean up interrupts a running turn and archives
  them all with `thread/archive`, else `codex archive`. The panel shows the current thread only.
- **The thread's name is set after the prompt is in** and never fails the start (decision 158).
  In the real run, Start again failed on `thread/name/set` ("rollout … is empty") while its turn
  was already running, and the old code lost that thread. The fake server now refuses a name
  until the thread has an item.
- **A turn typed outside the page shows when the page is focused again**, as with `claude attach`:
  the list is read every 5 s only while an agent works or waits. V21's terminal in the panel has
  the same gap for Claude Code (its e2e passes only because its fake agent stays "working"); V27b
  closes it for both (decision 161).
- **Talk** copies `codex resume <thread> --remote unix://<socket> -C <worktree>`, without V20a's
  note that its turns are not recorded. `codex resume` takes `--remote` with `-C`; checked in its
  help, not run (it asks to trust each new worktree, which writes the person's config: V27b).
- **The e2e fake app server runs in Playwright's process**: the unit tests' fake
  (`packages/cli/test/fake-app-server.ts`), imported as `forge/test/mock-api.ts` already is. The
  fake `codex` names its socket on `app-server daemon start` only then, so V20a's specs keep
  testing `exec`.

**Results (V27a).** Tests first, red before: the WebSocket client 6 (against a fake server: frames
of every length, fragments with pings between, bytes cut mid-header, close both ways, a refused
upgrade, no answer), the app-server client and operations 9, discovery, entries and state 11, the
service 8, viewer 2, e2e 2. 888 unit tests (852 on `main`), 119 of 119 e2e, V20a's three Codex
specs unchanged. With the real Codex 0.163 on the person's daemon, through `symbiote view` in Chromium,
in a throwaway repository outside `/tmp` (where `workspace-write` writes freely): started in 1.82 s
(the worktree, `daemon start`, `thread/start`, the prompt in); a message sent while it worked
joined its turn and showed in the thread 0.79 s after Send; Codex committed on its branch in the
linked worktree from its sandbox (`338aa87`, the steered comment in it), ready for review 12.7 s
later. `symbiote view` stopped 3 s into a 15 s turn and started again: the workspace read "working"
at once, and the turn finished without Symbiote ("slept", 13.3 s). An approval: "Waiting: approval
prompt" 2.2 s after the message, then "Stop it and send" interrupted it and the next turn answered
in 1.9 s. Stop 0.36 s. Start again: a new thread, named after the branch, 1.6 s. `GET
/api/workspaces` 19–26 ms with that workspace; its thread 9–10 ms. Clean up archived all three
threads on the daemon (one by hand: the thread the failed start lost, before the fix). Screenshots
light and dark at 1440, 900 and 390 px, no page errors; at 390 px the header's help wraps into a
narrow column, as on `main`. Not verified: a turn typed in Codex's own terminal against the real
daemon (the fake's, and the V27 spike's, only), an approval answered there, a daemon restarted
during a turn (the fake's restart only), macOS and Windows. (The V27b spike since verified the
first two, and found that this Stop leaves the turn's commands running: decision 159.)

## V27b — Codex's terminal

**Problem** (measured in the V27b spike, below; Codex 0.163.0, the person's daemon, `codex resume
<thread> --remote unix://… -C <worktree>` in node-pty):

| What | Measured |
|---|---|
| The TUI joined to a thread Symbiote started | first output 49 ms; Symbiote's turns drawn; 266 MB for Codex + 49 MB for its Node wrapper (Claude Code's `attach`: 140 MB) |
| Trust | asked for the worktree although `thread/start` had just made Codex trust the repository: "Trust this folder? … Your trust decision will be saved", **1. Trust and continue · 2. Back to Agent Command Center**; no way on without trusting |
| A writable sandbox and trust | `thread/start` with `workspace-write` (as `sandbox` or in `config`) and `codex exec -s workspace-write` (V20a) each write `trust_level = "trusted"` for the repository's root into the person's `~/.codex/config.toml`, unasked (4 of 4; without it, none and a read-only sandbox) |
| A turn typed in the TUI | in Symbiote's read 111 ms after Enter; an Enter in the same write as the text is not a submit (Codex's paste-burst rule); a line written alone stays in its input as plain text |
| An approval Symbiote's turn asked | drawn as Codex's prompt (y · p · esc); `y` there: Symbiote's read lost "approval" 65 ms later, the turn finished in 0.85 s |
| Esc, Ctrl+C, a hang-up | Esc interrupts the turn; Ctrl+C clears the input, on an empty one quits the client ("Any running work continues"), exit 0; SIGHUP: exit 0, the thread unchanged |
| **Symbiote's Stop (V27a)** | **the interrupted turn's command runs on** as a Codex background terminal (`sleep 45` still running 18 s after Stop); `thread/backgroundTerminals/clean` (experimental) ended it in 7 ms |
| The list after a turn typed in the panel's terminal | not read until the page is focused again, for Claude Code too (V21) |

**Goal**: a Codex workspace on the app server gets V21's Terminal tab, Codex's own TUI on its
thread, and the panel opens on it. Its approvals are answered there; what is typed there is in the
thread; the state follows while the terminal is open. Stop ends the turn and its commands. The
trust Codex asks for, and the one it records on its own, are said, not decided. Unchanged: V20a's
`exec` workspaces (Talk, no terminal); Claude Code's terminal, except that the list is read while
it is open.

**Design**:
- **The terminal**: `POST /api/workspaces/terminal` for a Codex workspace on the server opens
  `codex resume <thread> --remote <address> -C <worktree>` under Symbiote's terminals (V21), Codex as
  found (`SYMBIOTE_CODEX`, else `codex` on PATH). A V20a workspace is still refused (Talk). Joining a
  stopped thread starts nothing, so V21's "continues the stopped session" is not asked for Codex.
- **Trust**: the answer says `trusted: false` when Codex's configuration, read from the server
  (`config/read`, its `projects`), has no entry for the worktree or a folder above it; the panel
  then says, above the terminal, that Codex asks whether to trust the worktree and saves the
  answer in the person's Codex configuration. Symbiote never answers it (decision 156).
- **Stop** interrupts the turn, then cleans the thread's background terminals (a connection that
  declares `experimentalApi`); if Codex refuses that method, the turn is still interrupted. Clean
  up does the same before it archives.
- **The list is read every 5 s while a terminal is open** in the panel, for both agents.
- **The panel**: the Terminal and Thread tabs as for Claude Code; the reply box hidden while a
  terminal can run; the hint "? in an empty prompt lists Codex's keys". Terminals stay four at
  most (each Codex one about 315 MB, said in the README).
- **Saying what Codex records**: README, and the start dialog's sandbox tooltip: starting Codex
  makes Codex mark the repository trusted in the person's Codex configuration (its rule for a
  writable sandbox), since V20a.

**Verification**: tests first — the terminal's command and refusals (V20a workspaces, no
terminals), `trusted` from `config/read` (exact entry, a folder above, none), Stop cleaning
background terminals and surviving a refusal of that method, the list read while a terminal is
open; e2e: the Codex Terminal tab on a fake TUI (keys reach it, the trust note, Thread read only,
reopen after it ends), the state following a turn typed there. Real use: the person's daemon
through `symbiote view` in Chromium — the trust prompt answered in the panel, a turn typed, an approval
answered, Stop ending a running command; screenshots; everything removed, trust entries too.

**Risks**

| Risk | Mitigation |
|---|---|
| `thread/backgroundTerminals/clean` is experimental | Asked on its own connection; a refusal leaves V27a's Stop (the turn interrupted) |
| Codex's trust rule is per worktree folder, and each new workspace asks again | Said in the panel each time Codex will ask; the person decides (decision 156) |
| 315 MB per Codex terminal | Four terminals at most, the oldest unread one hung up first (V21) |
| Codex's TUI draws its own colors | Symbiote's dark terminal theme, as Claude Code's |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 159 | What Stop ends for Codex on the app server | **The turn (`turn/interrupt`), then its commands (`thread/backgroundTerminals/clean`)** | An interrupted turn's command ran on (18 s after Stop, measured); V20a's Stop ended the process group, and a Stop that leaves a test run or a server going is not a stop |
| 160 | When the panel speaks of trust | **When Codex's configuration has no entry for the worktree or a folder above it** | Codex asks per worktree and has no untrusted way on; the note never says Codex will ask when it will not |
| 161 | The list while a terminal is open | **Read every 5 s, for both agents** | A turn typed in the panel's terminal after "Plan ready" showed only on focus (V21 too) |
| 162 | The trust Codex records on its own | **Said in the README and the start dialog; not avoided** | Any writable sandbox makes Codex trust the repository (4 of 4 calls); there is no writable sandbox without it |

## As built (V27b)

- **The trust note goes with the first key in the terminal.** Planned for as long as the terminal
  is open; in the real run it still stood above an approval, after the person had trusted the
  worktree. Codex's question is the first thing its terminal shows, and any key answers it
  (Enter trusts, Esc goes back to its agents' list).
- **Stop** interrupts the turn, then cleans the thread's background terminals on a connection of
  its own that opts into experimental methods; Clean up does the same before archiving. A Codex
  without the method answers -32600, and the turn is still interrupted (a test of the fake, which
  answers as Codex 0.163 does without the opt-in).
- **The e2e's fake Codex TUI** is the fake `codex` with `resume … --remote`: it reads trust with
  `config/read`, asks as Codex does, trusts through a fake-only method, and gives each line to the
  thread through Symbiote's built client. Its first version used single backslashes in the template
  literal: the generated script did not run, and Symbiote fell back to `exec` without a word (V21's
  trap again; a syntax check must interpret the template's escapes, or it passes).
- **A line typed faster than a person types is not sent by an Enter right after it**: Codex reads
  the run as a paste. Typed at 60 ms a key, the turn was in the thread 128 ms after Enter; with no
  delay at all (Playwright's default), the Enter right after was not taken, a second was. Symbiote
  types no Enter itself (decision 114), so only automation meets it.
- **Opening a workspace's page again while its terminal runs** briefly gives two TUIs on the
  thread (the old page's is hung up when it goes, else after V21's 10 s grace): measured both
  gone once the tab was left.
- **Found, not fixed here**: at 390 px the panel with a terminal makes the page 670 px wide
  (the terminal box 588 px), for Claude Code and Codex alike: V21's, on `main`. Proposed as
  `fix/terminal-narrow`.

**Results (V27b).** Tests first, red before: the client 2 (Stop cleaning, trust entries), when
Codex will ask 2, the service's terminal 2, the panel 3, the reads while a terminal is open 2, e2e
1 (red without the held reads, at "Working"; red without the note going on the first key). 899
unit tests (852 on `main`), 120 of 120 e2e. With the real Codex 0.163 on the person's daemon
through `symbiote view` in Chromium: the panel opened on Codex's terminal with the note, Codex asked
to trust the worktree 0.29 s after the page opened, Enter there trusted it and the TUI drew the
thread (100 MB for Codex and 50 MB for its Node wrapper at first); Codex committed on its branch
(`8dbda4a`, 15 s); a turn typed at a person's pace in the thread 128 ms after Enter; an approval
read "needs you" 1.8 s after the message, `y` in the panel's terminal cleared it in 22 ms, and
the command ran ("HTTP/2 200"); the Thread tab read only, the TUI hung up once the tab was left.
Stop with `sleep 62` running: 45 ms for `POST /api/workspaces/stop`, the command ended (the
driver's 4.06 s for the same in the page was Playwright waiting on the button). Screenshots light
and dark at 1440 and 390 px; no page errors. Everything made was removed: 5 threads archived,
the repositories deleted, and the trust entries the runs wrote taken out of the person's Codex
configuration (it reads as before the runs). Not verified: a daemon restarted under an open
terminal, two people's TUIs on one thread, macOS and Windows.
