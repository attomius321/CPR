# Journal: V27 — Codex in the panel's terminal, through its app server

[Index](../JOURNAL.md) · [Plan](../plan/v27-codex-terminal.md)

## V27 spike — Codex in the panel's terminal, through its app server (2026-10-20, branch `milestone/v27-codex-terminal`)

Asked: make a Codex workspace's terminal work (V20a left it out: its turns in a terminal would
not reach Symbiote's thread, decision 133); "try codex agents". Codex 0.163.0, the latest release
(2026-10-15). Run in a throwaway repository with a linked worktree as Symbiote makes them, on a
private app server (`codex app-server --listen unix://…`), the person's own daemon left alone.

**Learned**:
- **Codex 0.163 has the binding: a shared app-server daemon** (`codex agents` browses it, `codex
  app-server daemon version` names its socket) **and a TUI that joins it**: `codex resume
  <thread> --remote unix://<socket> -C <worktree>`. Every client of one thread gets its events.
- **The socket speaks WebSocket**, JSON-RPC inside without the `jsonrpc` field (101 Switching
  Protocols on an HTTP upgrade). `codex app-server proxy` relays raw bytes, so it answered
  nothing to plain JSON lines (2 of 2). Node has no WebSocket client over a unix socket: the
  spike's client did the upgrade and the frames itself (~70 lines).
- **Symbiote as a client starts the thread**: `thread/start` (the worktree, `workspace-write`, the
  branch's git folders as writable roots, `approvalPolicy`), then `turn/start`. Codex committed
  in the linked worktree, 4.2 s for the turn. The server holds the thread with those options.
- **A turn typed in the TUI reaches Symbiote**: `turn/started`, the person's `userMessage`, each
  agent message and command, `turn/completed`, 3.0 s. It committed from the sandbox too (the
  thread's writable roots stayed: V20a's `exec resume` lost them).
- **A turn Symbiote starts shows in the open TUI**: its answer was drawn 0.9 s after `turn/start`.
- **No client needs to stay**: a 15 s turn finished after Symbiote's client was killed 3 s in, and a
  new client's `thread/read` (`includeTurns`) gave every turn back (Symbiote's, the TUI's, the one it
  missed) with their items and times. Symbiote need not record the thread itself.
- **"Needs you" exists for Codex here.** With `approvalPolicy: on-request`, a command the sandbox
  refused became `item/commandExecution/requestApproval` to the clients, and the thread's status
  `active` with `waitingOnApproval`. A TUI that joined later drew Codex's own prompt ("Would you
  like to run the following command?", its reason, y / esc). Declined from Symbiote's client:
  `serverRequest/resolved` to all, the command `declined`, nothing written, the turn finished.
- **The TUI asks "Trust this folder?" once per worktree**, and Enter writes `[projects."<path>"]
  trust_level = "trusted"` into the person's `~/.codex/config.toml`. `-c projects."<path>"…` is
  ignored, on the TUI and on the server alike (Codex's warning: "session-flags: … is ignored").
  It is the person's decision, made in their terminal. The spike's three entries were removed.
- **`workspace-write` lets commands write anywhere in `/tmp`** by default (`exclude_slash_tmp`,
  `exclude_tmpdir_env_var` turn it off): a write "outside the folder" there asked nothing.
- **Memory**: a private app server 269 MB (and 50 MB for its Node wrapper); the person's daemon,
  already running, 212 MB. On the daemon, Symbiote adds no process.
- The person's daemon answered the same `initialize` over the same transport (1 ms); nothing
  else was asked of it.

**Not tested**: Symbiote's threads on the person's daemon end to end (only `initialize`); a thread
`codex exec` made (V20a's), resumed on the app server; the daemon restarting during a turn
(`daemon update` "may interrupt running work"); a TUI's memory; macOS, Windows. The 4 threads
were archived (`codex unarchive` brings them back).

## V27a — Symbiote on Codex's app server (2026-10-20, branch `milestone/v27-codex-terminal`)

Asked: "Start V27a". A Codex workspace now starts on the person's app-server daemon (found, or
started, with `codex app-server daemon start`): a thread in the worktree, its branch's git folders
writable, approvals asked, named after the branch. Symbiote reads its state and thread from the server;
a message joins a running turn; Stop interrupts it; Clean up archives its threads. Talk copies
`codex resume <thread> --remote unix://<socket> -C <worktree>`. Without a daemon, V20a's `exec`
as before. Claude Code workspaces unchanged.

**Learned**:
- **Probed first on a private app server** (Codex 0.163, the person's daemon left alone): writable
  roots go in `config.sandbox_workspace_write.writable_roots` (`sandbox` takes only a mode). The
  server keeps a thread's sandbox, roots, approval policy and folder: after a restart, a bare
  `thread/resume` gave all four back, so Symbiote passes none when it continues a thread (decision
  157). `turn/start` on a thread the server does not hold fails "thread not found" (-32600), a
  turn cut by the restart reads `interrupted`, and the thread `notLoaded`.
- **A connection that did not start or resume a thread hears only its status changes.** Symbiote keeps
  none subscribed (a subscriber gets every delta) and reads with `thread/read` (1.9 ms) and
  `thread/turns/list` (`summary`: each turn's first message and final answer, 3.3 ms for 6 turns;
  `full`: every message and Codex's commentary, 7.2 ms). Items have no times, turns do (seconds).
  Agent messages carry `phase`: `commentary` or `final_answer`.
- **While Codex waits on an approval, the request is no item**: the last turn shows the person's
  message and, sometimes, Codex's commentary ("May I run it outside the sandbox?"); in the real run
  only reasoning. "Needs you" comes from the status flag `waitingOnApproval`. Server requests are
  numbered from 0, so a response is told from a request by its `method`, not its ID.
- **Messages can come with the upgrade's answer**, in the same chunk: the first test of the
  WebSocket client lost one, since the caller could not listen before the promise resolved. The
  client now holds messages until its first listener.
- **`codex app-server daemon start` is idempotent**: 57 ms when it runs, 1.25 s to start one (in a
  throwaway `CODEX_HOME`); `daemon version` exits 1 with "failed to connect" when none runs. A
  socket path past ~100 bytes is made a symlink into `/tmp/codex-daemon-<uid>/`.
- **The real run found what the fake did not: Codex refuses to name a thread whose rollout is
  empty.** Start again called `thread/name/set` right after `turn/start` and got "failed to update
  thread metadata … rollout … is empty"; Symbiote called the start failed while the turn ran, and lost
  the thread (it redid the brief, found it done, committed nothing; archived by hand). The first
  start had named its thread by timing alone. Now the name is set once the prompt is in and never
  fails a start, a start that fails after `thread/start` keeps the thread for Clean up (decision
  158), and the fake refuses a name until a thread has an item.
- **A turn typed outside the page shows only when the page is focused again**: the list is read
  every 5 s only while an agent works or waits, so after "Plan ready" nothing reads it. The same
  holds for `claude attach` in the person's terminal; the e2e dispatches `focus` to model coming
  back. V27b's terminal in the panel needs a rule.

**Verification**: tests first (WebSocket client 6, app-server client and operations 9, discovery,
entries and state 11, service 8, viewer 2, e2e 2; red before, for the reasons above). 888 unit
tests (852 on `main`), 119 of 119 e2e; V20a's Codex specs pass unchanged (their fake `codex`
starts no daemon). Real Codex 0.163 on the person's daemon through `symbiote view` in Chromium, in a
throwaway repository outside `/tmp`: started 1.82 s after Start; a message while it worked joined
the turn and was in the thread 0.79 s after Send; it committed in the linked worktree from its
sandbox (`338aa87`), ready 12.7 s later; `symbiote view` stopped mid-turn and started again read
"working", and the turn ended without Symbiote (13.3 s); an approval read "Waiting: approval prompt"
2.2 s after the message, "Stop it and send" ran the next turn (1.9 s); Stop 0.36 s; Start again a
new named thread (1.6 s); the list 19–26 ms, a summary read 4–5 ms, the panel's 50-turn read
10 ms; Clean up archived both threads. Screenshots light and dark at 1440, 900 and 390 px, no
page errors. Everything made was removed and all 3 threads archived (`thread/list` by folder: 0
listed, 3 archived), with the probe's thread on the private server. Not verified: a turn typed in
Codex's own terminal on the real daemon, an approval answered there (both V27b), the daemon
restarting during a turn (the fake only), macOS and Windows.

Merged into main (2026-10-20), with V27b (entry below).

## V27b spike — Codex's own terminal on a Symbiote thread (2026-10-20, branch `milestone/v27-codex-terminal`)

Asked: "Start v27b". Codex 0.163.0, the person's daemon: a thread started as V27a starts one, in a
throwaway repository's linked worktree, then `codex resume <thread> --remote unix://… -C
<worktree>` in node-pty (120 × 40), driven by a script reading the screen with escape codes
stripped; the trust questions measured in throwaway `CODEX_HOME`s with a private app server.

**Learned**:
- **Symbiote has been making Codex trust each repository it starts Codex in, since V20a, without
  saying so.** `thread/start` with `sandbox: "workspace-write"`, the same sandbox in `config`, and
  `codex exec -s workspace-write` each wrote `[projects."<repository>"] trust_level = "trusted"`
  into Codex's `config.toml` (4 of 4); `thread/start` with neither wrote nothing and got a
  read-only sandbox. Found because the person's config held entries for V27a's throwaway
  repositories, written at the second their threads started. There is no writable sandbox without
  it; Symbiote will say so (decision 162).
- **The TUI still asks for the worktree**: "Trust this folder? Codex can read, edit, and run files
  here, subject to your permission settings. Folder settings can run code automatically … Your
  trust decision will be saved", then "1. Trust and continue · 2. Back to Agent Command Center".
  No way on without trusting. The repository's entry did not count for its linked worktree.
- **Joined, it is the thread**: first output in 49 ms; Symbiote's turns drawn with their answers; a
  turn typed there in Symbiote's read 111 ms after Enter; the approval Symbiote's turn asked drawn as
  Codex's prompt ("Would you like to run the following command? … 1. Yes, proceed (y) · 2. Yes,
  and don't ask again … (p) · 3. No … (esc)"), and `y` there cleared "approval" from Symbiote's read in
  65 ms, the turn done 0.85 s later. Codex said why before asking this time (V27a's run: no word).
- **An Enter written with the text is not a submit**: Codex reads a fast run of characters as a
  paste. Text, then Enter on its own, submitted. A 208-character line written at once (Send the
  verdict) stayed in the input as plain text.
- **Esc interrupts the turn; Ctrl+C clears the input, and on an empty one quits the client** ("Any
  running work continues", exit 0); a hang-up exits 0 and leaves the thread as it was.
- **An interrupted turn's command runs on.** After Esc, and after Symbiote's own Stop (`turn/interrupt`,
  V27a), the turn's `sleep` went on as a Codex "background terminal" (alive 18 s after Stop).
  `thread/backgroundTerminals/clean`, an experimental method a client opts into at `initialize`
  (`experimentalApi`), ended it in 7 ms; `…/list` named it first. V27a's Stop is not V20a's.
- **Memory**: the TUI is 266 MB for Codex and 49 MB for its Node wrapper, against 140 MB for
  Claude Code's `attach`.
- **The list is not read after a turn typed in the panel's terminal**, unless an agent works or
  waits: V21's terminal has had this gap for Claude Code too; its e2e passes because its fake
  agent stays "working". The V27a "As built" said V21 had a rule: it had none.
- Whether Codex counts a trusted folder above a worktree stayed open: in a throwaway `CODEX_HOME`
  the TUI asked to sign in before anything else.

**Not tested**: the TUI on a thread the daemon no longer holds (a restart); two TUIs on one thread;
Codex's colors in Symbiote's terminal theme. Cleaned up: the thread archived, the repository removed,
and the 4 trust entries this session's runs wrote taken out of the person's config (two older ones,
for folders of an earlier spike that no longer exist, left as they are).

## V27b — Codex's terminal in its workspace's panel (2026-10-20, branch `milestone/v27-codex-terminal`)

Asked: "Start v27b". A Codex workspace on the app server gets V21's Terminal tab: Codex's own TUI
joined to its thread (`codex resume <thread> --remote <address> -C <worktree>`), the panel opening
on it, the thread read only. When Codex will ask to trust the worktree, the panel says so first.
Stop ends the turn and the commands it left. The list is read while any terminal is open. The
start dialog and the README say that Codex trusts the repository on any writable start.

**Learned**:
- **The trust note must go once it is answered.** Planned to stand while the terminal was open,
  it still sat above an approval in the real run, after the person had trusted the worktree. Any
  key in the terminal answers Codex's first question, so the first key now takes it away.
- **A fake in a template literal, again**: the first fake TUI wrote `\n` where the template needed
  `\\n`; the generated `codex` failed to parse, `daemon start` failed with it, and Symbiote quietly ran
  `exec` (the e2e saw "working" and no thread). A syntax check that copies the template's text
  without reading its escapes passed: it must interpret them. V21 found the same trap.
- **Codex takes a fast run of keys for a paste**: with no delay between keys (Playwright's
  default), the Enter after them did not submit; at 60 ms a key it did (128 ms to the thread).
- **Stop's own time is milliseconds**: `turn/interrupt` 10 ms, idle at 12 ms, the clean 0 ms;
  `POST /api/workspaces/stop` 45 ms with the command ended. The driver's 4.06 s was Playwright's
  click waiting for the button to settle: measure the API when a page number looks wrong.
- **The terminal panel overflows at 390 px**, for Claude Code too (the page 670 px wide): V21's,
  found here, proposed as its own fix.
- The TUI measured 100 MB (and 50 MB for its Node wrapper) when it joins, 266 MB once a thread's
  history is drawn (spike): four Codex terminals can hold over a gigabyte.

**Verification**: tests first (client 2, trust 2, service 2, panel 3, reads 2, e2e 1; the e2e red
without the held reads at "Working", and without the first-key rule at the note). 899 unit tests
(852 on `main`), 120 of 120 e2e. Real Codex 0.163 on the person's daemon through `symbiote view` in
Chromium: the trust question 0.29 s after the page opened and answered in the panel; a commit
from the sandbox in 15 s; a turn typed in 128 ms to the thread; an approval answered with `y` in
the panel's terminal (22 ms to clear "needs you"); Stop 45 ms with the command ended; no page
errors; screenshots light and dark at 1440 and 390 px. Cleaned up: 5 threads archived, the
throwaway repositories deleted, the person's Codex configuration as it was before the runs.

Merged into main (2026-10-20): V27a and V27b, no conflicts (`main` had not moved since the branch
started; the merge's tree is the branch's). `main` verified after the merge: frozen install, 899
unit tests, lint, typecheck, build, 120 of 120 e2e.
