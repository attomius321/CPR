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
