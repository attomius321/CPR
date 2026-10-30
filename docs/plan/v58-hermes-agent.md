# V58 — Hermes as a workspace's agent, in its terminal

[Index](../PLAN.md) · [Journal](../journal/v58-hermes-agent.md)

**Status:** merged into `main` on 2026-10-26 (built 2026-10-26), on branch `feature/hermes-support` (a workspace started
in Symbiote, from `main` at `3c83dc6`); the person asked to build it with the plan's
recommendations once written ("After the plan, execute with your recomandations"). Built as
planned, with Stop recorded after the real run; "As built" and results at the end.

**Problem** (asked: "I need support for Hermes agent inside agent terminals"). A workspace's agent
is Claude Code (V18, its session in the panel's terminal since V21) or Codex (V20a, its TUI there
since V27b). Hermes Agent (Nous Research's CLI agent; 0.21.3 installed here, the person's gateway
running) cannot be picked: the start page lists the two, `AgentKind` is `'claude' | 'codex'`, and
the only way to run Hermes in a workspace is to type `hermes` in a V45 shell, where Symbiote gives
it no prompt and knows nothing of it (the card says "no agent", no thread, no state). Measured in
the V58 spike (Hermes 0.21.3, its classic interface, its provider a local `llama` server that was
not running; a throwaway repository in this job's scratch folder):

| What | Measured |
|---|---|
| `hermes chat -q <prompt>` in a pseudo-terminal (node-pty 1.1.0, 120 × 40) | first output 1.03 s; its interface drawn; the prompt submitted as its first turn ("On a real TTY the prompt seeds an interactive session") |
| Its session in Hermes's store | a row whose `cwd` is the folder exactly, title from the prompt; the prompt stored as the first user message 0.5 s after the start, before any model call |
| A hang-up (SIGHUP, as `Terminals.close`) | Hermes exits 0 two seconds later; the session gets `end_reason: cli_close` |
| `hermes --resume <id>` in a pseudo-terminal | draws the earlier conversation ("↻ Resumed session … 2 total messages"), in the session's folder; the session is open again (`ended_at` cleared) |
| Finding a session | `hermes sessions export --cwd <folder>` skips open sessions (it says so on stderr); `hermes sessions list --workspace <folder>` lists open ones with their IDs, 0.28 s; `hermes sessions export --session-id <id> --format jsonl -` gives the row and its messages, 0.31–0.34 s |
| How a turn ends, in the person's store | final answers `finish_reason: stop` (87), steps `tool_calls` (370), tool results `role: tool` (420), a failed turn an assistant message with none (16: "Your request was not processed…") |
| Open rows | 3 sessions in the person's store never recorded an end: an open row is not a running Hermes |
| A background host | none for the CLI: no `--bg`/`attach`; `hermes serve` and the TUI's `HERMES_TUI_GATEWAY_URL` are the desktop app's, undocumented for this |
| Hooks | shell hooks live in the person's `~/.hermes/config.yaml`, each consented to once; nothing passes them for one run (Claude Code's `--settings`) |
| An approval prompt (a dangerous command) | drawn in the terminal only; the CLI's prompt writes nothing to the store |
| Its levels | `hermes chat --help`: `--reasoning LEVEL` "none, minimal, low, medium, high, xhigh, max, or ultra"; no machine-readable model list (`hermes model` is a picker) |

Causes:
- Symbiote knows two agents; each has its host (`claude --bg`, Codex's app server).
- Hermes's CLI is its terminal: no host keeps a session running without one.

**Goal**: the start page offers Hermes when it is installed and terminals can run. A workspace
started with it opens on Hermes's own interface in the panel's terminal, running in its worktree
with Symbiote's prompt as its first turn. Its card says working, plan ready, ready for review or
stopped from Hermes's session; its Thread and Activity tabs show its messages and tool calls. Stop,
Start the agent, Talk, Send the verdict and Clean up work for it. **Unchanged**: Claude Code and
Codex workspaces; Scout, Scribe and the merger (Claude Code and Codex only); a repository with no
Hermes workspace (Hermes is never run); the analysis.

## Running Hermes (CLI)

- **Found** as the others: `SYMBIOTE_HERMES` (a path or a command on PATH), else `hermes` on PATH
  (`findHermes`, `packages/cli/src/hermes.ts`), which also holds what Symbiote asks of it
  (`Hermes`: `efforts`, `sessions`, `read`) and the pure parts (arguments, parsing, state,
  thread). A fake in tests and e2e.
- **In a kept terminal of `symbiote view`** (decision 415): starting a workspace opens V45's kind of
  terminal — never hung up for having no reader, outside the limit of 4 — running `hermes chat -q
  <prompt> [--reasoning <level>]` in the worktree, with `symbiote view`'s environment. Leaving the
  tab, another workspace or a reload keep Hermes running; it ends with Stop, Clean up, its own
  `/exit`, or `symbiote view` exiting. Its terminal's ID is kept per branch in the service's
  memory, as V45's shells are.
- **Its interface is the person's**: no `--tui` or `--cli` (their `display.interface` decides),
  no `--yolo` (approvals stay theirs), no `--worktree` (Symbiote made it), `--source` left as
  `cli` (the person's session lists show Symbiote's runs among theirs). The model is Hermes's own
  configuration. `-q` carries the prompt (it reaches the TUI too; `--query-file` does not).
- **Continuing**: opening the terminal of a workspace whose Hermes is not running runs `hermes
  --resume <session> [--reasoning <level>]` in a kept terminal: the conversation drawn again, no
  turn. Asked first when the state is `stopped`, as V21 asks for Claude Code ("Opening the
  terminal continues the stopped session").
- **Its session** (decision 416): `hermes sessions list --workspace <worktree>` gives the
  candidates' IDs (open ones too), `hermes sessions export --session-id <id>` each one's folder,
  times and messages; the workspace's is the newest whose folder is the worktree (real paths).
  Its ID is kept per branch and looked up again when none is known or it ended while Hermes runs
  (Hermes's `/new`, a compression that starts a new session). Then each read is one export
  (0.3 s); the list reads its Hermes workspaces in parallel.
- **The record**: `agent: { kind: "hermes", started, effort? }`; old records unchanged.

## State, thread, stop, clean up (CLI)

- **State** (decision 417), from whether Symbiote's terminal for it runs and the session's last
  message:
  - running: a user message, a tool result or a step (`tool_calls`) last → working; a final answer
    (any other assistant message) → finished: plan ready, ready or done by commits (V18b's rule);
    no session yet → working;
  - not running: a final answer last → finished as above; anything else → stopped; no session →
    failed ("Hermes ended before its first message"), or not running when Symbiote never ran it
    (a `symbiote view` started since);
  - never "needs you": Hermes's approvals are drawn in its terminal only (said in the risks);
  - `id`: the session's ID (Talk, `hermes --resume <id>`).
- **Thread**: its start, each user message as `prompt` (Symbiote's, then the person's typed in the
  terminal), each final answer as `report`, its end as `end` (`cli_close` → stopped). **Activity**
  (V48f): each tool call's start (the step's time) and end (its result's time), its subject from
  the call's arguments (`command`, `path`, …). `recorded: true`.
- **Stop** (decision 418): hangs up its terminal, while it works; Hermes ends, its session stays.
  **Start the agent** again: a new session with the prompt (an earlier Hermes terminal of the
  branch hung up first).
- **Messages from the box** (decision 419): refused (409, "Hermes takes messages in its
  terminal"); the box is hidden where terminals run, as for the others. Send the verdict types its
  line into the terminal without Enter (decision 114).
- **Clean up** (decision 420): its terminal hung up with the shells; its sessions stay in Hermes's
  history.
- **Options**: Hermes listed when found and terminals can run, its levels from `hermes chat
  --help` (kept for the process, as Claude Code's), no models (no choice offered, V47), no
  account line. The default stays `agent.kind`, else Claude Code, else Codex, else Hermes
  (decision 421). A permission mode or a model asked with Hermes is refused (400).
- **Who else picks agents**: Symbiote's MCP starts workspaces through the same service, so Hermes
  is one of its `agent`s. Scout's and Scribe's agents and the merger stay Claude Code and Codex:
  their lists name both explicitly, so a project whose `agent.kind` is `hermes` does not hand them
  Hermes (today's code would have run Codex for any kind that is not `claude`).

## The panel and the start page (viewer)

- `AGENT_NAMES` gains Hermes. The start page's agent select lists it; its line after Effort is
  "Approvals: in its terminal", with a Help: Hermes runs in Symbiote's terminal with your Hermes
  configuration, asks there before dangerous commands, and stops when Symbiote quits (its terminal
  continues the session).
- **The panel** opens on the terminal for a Hermes workspace whenever terminals run (no session ID
  is needed for the one it started). `AgentTerminal` keeps a terminal the server says is `kept`
  open when its tab is left (V45's rule for shells) and still reads the list every 5 s while it is
  shown (a turn typed there changes the state). The hint under it: "/help in its prompt lists
  Hermes's commands". Talk (where terminals do not run) copies `hermes --resume <id>`.
- **Its mark** beside a working agent's line (V53): a Hermes mark in `src/ui/icons.tsx`, drawn
  lucide-style (a staff with two wings), as Claude Code's and Codex's.

## Verification

1. **Tests first** (red before): `hermes.ts` — the arguments (start, resume, a level), the levels
   from a recorded `--help`, the session IDs from a recorded `sessions list`, a recorded export
   parsed, the state in each case (running and working, a step last, a final answer with and
   without commits and plan first, not running and finished, stopped, failed, unknown), the
   thread's entries, the tools' lines. The service with a fake Hermes and fake terminals: a start
   opens a kept terminal with the command in the worktree and records the agent; no terminals →
   not started with the reason; the terminal answers the running one (resized) or resumes the
   session in a kept one; no session → 409; Stop hangs it up; a reply is refused; Clean up closes
   it; options list Hermes with its levels and no models; a model or a permission mode refused;
   Scout's agents and the merger never Hermes with `agent.kind: hermes`. The server: the routes
   take `agent: "hermes"`. The viewer's pure parts: Talk, opening the terminal, asking first, the
   hint.
2. **e2e**, a fake `hermes` as `SYMBIOTE_HERMES` (a Node script in a real pseudo-terminal: draws
   a prompt, records its session in a file its `sessions list` and `sessions export` read, answers
   a typed line): start a workspace with Hermes picked → the panel on its terminal, the prompt
   there, "Working"; the fake's answer → "Plan ready" and the report in the thread; Thread and back
   → the same Hermes, not a second; a line typed → working, then its answer; Stop → "Stopped";
   the terminal again → asked first, then `--resume`; Clean up. Without Hermes installed: not
   offered. Every existing spec passes.
3. **A real Hermes**: needs the person's model server (`llama` at `localhost:8080`, down during the
   spike). With it running: start, the first turn, a line typed, Stop, reopen, Clean up, times for
   each; else said not verified.
4. **Viewer**: screenshots of the start page with three agents and a Hermes workspace's panel,
   light and dark, 1440 and 900 px; no page errors.
5. **Nothing else changes**: no analysis code, so no regression sets; `pnpm check`, build, e2e.

**Risks**

| Risk | Mitigation |
|---|---|
| Hermes ends with `symbiote view` (no background host) | Said on the start page's Help and in the README; its session continues with `--resume` from the panel |
| Each read is a Python process (0.3 s) | One export per read once the session is known; the list's Hermes workspaces read in parallel; measured in the results |
| Hermes's output formats (the list's table, the export's JSONL) change | Only the IDs' pattern and a few fields are read; a read that fails says "unknown" with why, and the terminal still works; the fake follows 0.21.3's |
| An approval waits in the terminal while the card says Working | Said in the start page's Help and the README; the panel opens on the terminal, where it shows |
| Stop's hang-up may leave a command Hermes ran | Not measured (no model ran in the spike); measured in the real run when the model server is up |
| A Hermes the person runs by hand in the worktree | Its session is read (the newest there) but not "running" for Symbiote: its state reads finished or stopped |
| Windows and macOS | Not run here; said in the results |

**Order**: the Hermes module with its tests, the service and server, the viewer, the e2e fake and
spec, then the real run if the model server is up, screenshots and docs. One branch.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V58 | Hermes as a workspace's agent | Hermes on the start page; run in a kept terminal in its worktree; its state, thread and tools from its session store; the terminal continued by `--resume`; Stop, Start, Talk, Clean up; Scout, Scribe and the merger unchanged |

**Decisions** (415–421, as recommended; the person asked to build with them):

| # | Question | Decision | Why |
|---|---|---|---|
| 415 | How Symbiote runs Hermes | **In a kept terminal of `symbiote view` (V45's kind), `hermes chat -q <prompt>` in the worktree; continued by `hermes --resume <session>`** | Hermes's CLI has no documented background host (no `--bg`, no app server for it); its interface is a terminal; a kept terminal survives tab changes and reloads, as shells do (decision 295) |
| 416 | Where its state and thread come from | **Hermes's session store through its CLI: `sessions list --workspace` for the ID, `sessions export --session-id` for the messages; whether it runs from Symbiote's terminal** | Its SQLite file is internal and per profile; hooks live in the person's configuration behind consent; the folder filter skips open sessions; 3 rows never ended, so "open" is not "running" |
| 417 | Its states | **Running: a final answer last → finished (plan ready, ready, done), else working. Not running: a final answer last → finished, else stopped; nothing stored → failed. Never "needs you"** | The prompt is stored at the turn's start and every step as it goes (spike, Hermes's turn code); its CLI's approvals leave no trace |
| 418 | What Stop does | **Hangs up its terminal: Hermes ends, its session stays** | As `claude stop` ends a session; measured: exit in 2 s, `cli_close` recorded |
| 419 | Messages from the box | **None: Hermes takes them in its terminal** | Its terminal is its only input; a second Hermes resuming the same session would race the first |
| 420 | Hermes's sessions at Clean up | **Kept in Hermes's history** | Archiving takes only filters, which skip open sessions; the person's history stays theirs (decision 134's reason) |
| 421 | Who offers Hermes | **The start page and Symbiote's MCP (workspaces); default after Claude Code and Codex unless `agent.kind` names it; Scout, Scribe and the merger keep Claude Code and Codex** | Asked for agents' terminals; Scout and Scribe need a session started with no question and a read-only tool set, the merger a headless run: not measured for Hermes |

**Not in V58 (later)**: Scout, Scribe and the merger on Hermes; a model picked for Hermes (no list
to read); "needs you" for its approvals; Hermes outliving `symbiote view`; its usage in the status
bar; Hermes's skills on the Skills page.

## As built (V58)

- **`--query=<prompt>`, not `-q <prompt>`**: one argument whatever the prompt starts with. Checked
  against Hermes 0.21.3 in a terminal: a prompt starting with `-` was its first message, and
  `--reasoning low` was in the session's configuration (`reasoning_config.effort: low`).
- **Stop is recorded** (`agent.stopped` in the record, decision 418 as built). The real run showed
  a hang-up is not silent: Hermes closes the turn it was in with a message of its own ("Your
  request was not processed. Send it again…") within 0.3 s, and Stop read "Plan ready". Now a
  Hermes Symbiote stopped reads stopped until it runs again (its terminal continues it, which
  clears the field) or a message was given since; kept in the record, a restarted `symbiote view`
  knows it too.
- **A failed turn reads finished, its words the report.** Hermes marks no failure: of the 16
  assistant messages without a `finish_reason` in the person's store, some are failures ("Your
  request was not processed", "This turn did not complete"), some interrupts ("Operation
  interrupted."), some ordinary answers. A finished state with Hermes's own words is what can be
  said without guessing (precise beats complete).
- **Finding its session**: `hermes sessions list --workspace` matches the folder as a substring, so
  each candidate is read and its folder compared (real paths); a session that began more than 5 s
  before the agent's start is an earlier start's. Its ID is then kept per branch: one export per
  read. In the real run the session appeared 4 s after the start (Symbiote's long prompt; the
  spike's one line, 0.5 s), so the panel opens on a working Hermes with no session ID yet.
- **Hidden messages are left out** (`display_kind: hidden`, empty ones Hermes adds itself), as
  Hermes's own interface leaves them out.
- **Its tools as the page words them**: `terminal` as Codex's `command`, `read_file`, `write_file`
  and `patch` as Claude Code's Read, Write and Edit (paths from the worktree), `search_files` as
  Grep, `web_search` as WebSearch, `web_extract` and `browser_navigate` as WebFetch,
  `delegate_task` as Task; any other tool by its own name, without a subject.
- **Scout and the merger fixed before they could misread Hermes**: both treated any kind but
  Claude Code as Codex, so `agent.kind: hermes` listed Codex a second time under Hermes's name on
  Scout's page (its test red before). Scout's and Scribe's agents are now named (`PAGE_AGENTS`);
  the merger's lookups skip Hermes.
- **Its mark** is a caduceus drawn in `icons.tsx`, in its CLI's default golds (`#ffd700` to
  `#b8860b`): Hermes's own mark is the ☤ glyph, and a glyph is a font lookup (V29b).
- **The e2e harness pins `SYMBIOTE_HERMES`** to a missing program for every spec, as it pins
  Claude Code's and Codex's: `hermes` is on this machine's PATH, and every start page would have
  offered it. The fake Hermes keeps its sessions in `hermes-sessions/` beside its script (the first
  version put both at `hermes`, and its `sessions list` failed: the page said "Hermes could not read
  its session", the error path working as planned).

**Results.** Tests first, red before for the right reasons: the Hermes module 18 (no module), the
service 9 (Hermes unknown; the guard "Hermes is asked nothing without a Hermes workspace" passed as
written), Scout's agents 1 changed (Codex listed as Hermes), the panel's helpers 2 new and 2
changed; then Stop read as stopped, 1 changed (red: "plan-ready"). Unit: 1,799 (1,770 on `main`).
e2e: 2 new (written after the panel, with a fake Hermes in a real pseudo-terminal); 276 of 276 in
the last full run (274 on `main`); in the first, 275, the one failure `scout.spec.ts` racing its
own record (journal).

A real Hermes (0.21.3, the person's configuration; its model server was not running, so no turn
was answered) through `symbiote view`'s API, in a throwaway repository:

| Step | Measured |
|---|---|
| Options | 285–307 ms; Hermes offered alone (no Claude Code or Codex given), its 8 levels read from `hermes chat --help` |
| Start (`--reasoning low`) | 327–332 ms; working at once |
| Its session found | 4 s after the start; that read 622 ms (list and export), then 285–361 ms a list read (one export) |
| Its thread | its start and Symbiote's prompt, 291–315 ms |
| Stop | 594 ms, stopped (before the fix: plan ready, Hermes's closing message read as an answer) |
| Its terminal again | `--resume` in 292–296 ms; then finished, Hermes's words as the report |
| Clean up | 19–24 ms |

Both runs' sessions were deleted from the person's Hermes store, and no Hermes was left running.
Screenshots of the start page (three agents, Hermes picked) at 1440 and 900 px and of a Hermes
workspace (terminal, thread, activity) at 1440 and 900 px, light and dark: no page errors; the
mark reads on both themes. At 900 px the panel's head puts its state's tail under the attach
button, for Claude Code alike (on `main`, not this branch's).

Not verified: a turn a model answers (tool calls in the Activity tab, a final answer, an approval
prompt and what Stop does to a command it runs); Hermes's TUI interface (the person's is the
classic one; `-q` reaches it through `HERMES_TUI_QUERY`, read in its source); macOS and Windows.
