# Journal: V58 — Hermes as a workspace's agent, in its terminal

[Index](../JOURNAL.md) · [Plan](../plan/v58-hermes-agent.md)

## V58 spike — Hermes in a pseudo-terminal, and what its store says (2026-10-26, branch `feature/hermes-support`)

Asked: "I need support for Hermes agent inside agent terminals". Read on `main` (`3c83dc6`): how
Claude Code and Codex reach a workspace's terminal (`workspaces.ts`, `workspace-codex.ts`,
`terminal.ts`, `AgentTerminal.tsx`, `Workspace.tsx`) and Hermes Agent 0.21.3's CLI and source
(`~/.hermes/hermes-agent`). Measured with a script outside the repository: node-pty 1.1.0 (this
worktree's build), Hermes's classic interface at 120 × 40, in a throwaway git repository in this
job's scratch folder; Hermes's provider is a local `llama` server (`localhost:8080`), which was not
running, so no model answered.

**Learned**:
- **`-q` on a terminal seeds an interactive session**: first output 1.03 s, the prompt submitted
  as the first turn. The TUI gets it too (`HERMES_TUI_QUERY`), but not `--query-file`, which is read
  after the TUI's launch: `-q` it is (node-pty passes it as one argument, no shell).
- **The store has what a state needs**: the session's row (`cwd` exactly the folder, title from
  the prompt) and the prompt as a user message 0.5 s after the start, before any model call
  (Hermes persists a turn at its start, for crashes). The person's store: final answers
  `finish_reason: stop` (87), steps `tool_calls` (370), tool results (420), failed turns an
  assistant message with none (16).
- **The folder filter skips open sessions**: `hermes sessions export --cwd <folder>` printed
  nothing while the session was open ("open sessions also match these filters but…" on stderr).
  `hermes sessions list --workspace <folder>` lists it with its ID (0.28 s); `export
  --session-id` reads it open or not (0.31–0.34 s).
- **An open row is not a running Hermes**: 3 sessions in the person's store never recorded an
  end. Whether Hermes runs comes from Symbiote's terminal.
- **A hang-up ends Hermes cleanly**: exit 0 two seconds after SIGHUP, `end_reason: cli_close`.
  `hermes --resume <id>` drew the conversation again in the session's folder and opened the row
  again (`ended_at` cleared).
- **No host for the CLI**: nothing like `claude --bg` or Codex's daemon; `hermes serve` and the
  TUI's `HERMES_TUI_GATEWAY_URL` belong to the desktop app. Shell hooks are the person's
  configuration, consented once each: Symbiote cannot pass its own for one run.
- **An approval leaves no trace**: the CLI's prompt for a dangerous command waits in the terminal;
  only the gateway's wait labels its activity ("waiting for user approval").
- node-pty names Hermes's foreground program `…/venv/bin/python`, not `hermes`.

Cleaned up: the spike's session deleted from the person's store (`hermes sessions delete`), the
repository removed, no Hermes process left.

Not measured: a turn with a model (the server was down), a command Hermes runs when its terminal
is hung up, Hermes's TUI interface (the person's is the classic one), Windows and macOS.

## V58 — Hermes as a workspace's agent, in its terminal (2026-10-26, branch `feature/hermes-support`)

Built as planned (decisions 415–421): Hermes offered on the start page where terminals run; run as
`hermes chat --query=<prompt>` in a kept terminal (V45's kind) in the worktree; its state, thread
and tools read from its session through `hermes sessions list --workspace` and `hermes sessions
export --session-id`; its terminal continued with `hermes --resume`; Stop a hang-up, recorded;
Scout, Scribe and the merger kept to Claude Code and Codex.

**Learned**:
- **A hang-up is not silent.** The real Hermes closed the turn it was hung up in with a message of
  its own ("Your request was not processed…") within 0.3 s, and Stop read "Plan ready". The fake
  had not done that, so only the real run showed it. Stop is now recorded in the workspace's record
  and wins until Hermes runs again; the fake does what the real one does.
- **"Not ended" is not "running", and "no finish reason" is not "failed".** 3 of the person's
  sessions never recorded an end; 16 assistant messages have no `finish_reason`, failures and
  plain answers alike. Whether Hermes runs comes from Symbiote's terminal; a failed turn reads
  finished, with Hermes's words.
- **Scout would have run Codex under Hermes's name.** Scout's agent list and the merger's lookups
  treated any kind but Claude Code as Codex: with `agent.kind: hermes`, Scout's page listed Codex
  twice, once named Hermes. A new kind must be looked for wherever kinds are switched on, not only
  where the compiler complains (`Record<AgentKind, …>` caught two maps; the `else` branches
  compiled).
- **The e2e harness must pin every agent's program.** `hermes` is on this machine's PATH: without
  `SYMBIOTE_HERMES` pinned, every spec's start page would have offered the person's real Hermes.
- **A fake's files beside its script share its folder.** The fake's sessions folder and its script
  were both `<dir>/hermes`; `sessions list` failed with ENOTDIR, which the page showed as "Hermes
  could not read its session" (the error path, at least, worked).
- **Hermes's session appears seconds after its start with a long prompt**: 4 s in the real run
  (0.5 s for the spike's one line). The panel opens on a working Hermes before its session has an
  ID.
- **A list read costs a Python process**: 285–361 ms with one Hermes workspace (one export; Codex's
  read is 4–5 ms). Hermes workspaces are read in parallel; the list is read every 5 s only while
  an agent works or a terminal is open.

**Verification**: tests first, red for the right reasons (the module 18, the service 9, Scout 1
changed, the panel's helpers 2 new and 2 changed, Stop 1 changed). `pnpm check`: 1,799 unit tests
(1,770 on `main`). e2e: 276 of 276 in the last full run (274 on `main`, 2 new in `hermes.spec.ts`); the first
full run 275, `scout.spec.ts` failing once (below). The real Hermes through `symbiote view`'s API in a throwaway
repository (plan, results): options with its 8 levels 285–307 ms, start 327 ms, Stop 594 ms and
stopped, `--resume` 292–296 ms, Clean up 19–24 ms; both runs' sessions deleted from the person's
store. Screenshots light and dark at 1440 and 900 px. No analysis code changed: no regression sets.

Found, not fixed (not this branch's): `scout.spec.ts` "another agent picked in its head starts
nothing" reads Scout's record as soon as Codex's `thread/start` is seen, before Symbiote writes it:
1 of 276 in a full run, 1 of 5 alone. At 900 px a workspace's head puts its state's tail under the
attach button, for Claude Code too.

Not verified: a turn a model answers (the person's model server was down): tool calls in the
Activity tab, an approval prompt, what Stop does to a command Hermes runs; Hermes's TUI interface;
macOS and Windows.
