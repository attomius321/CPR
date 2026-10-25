# Journal: MC1 — Symbiote's MCP: Scout as the person's assistant

[Index](../JOURNAL.md) · [Plan](../plan/mc1-symbiote-mcp.md)

## MC1 spike — what Scout's start takes of an MCP server, and what its gate can do there (2026-10-25, branch `feature/symbiote-mcp`)

Asked: "an MCP for symbiote", so that Scout is "an orchestrator like of workspaces flow from dev
to merge", with "access to all the logical features the symbiote gives". Counted what Scout can
reach today against `server.ts`'s routes, and the person's flow from their records; then ran
Claude Code 2.1.310 in `-p` (Haiku 5.5) in a scratch folder with Scout's flags, a 20-line stdio
MCP server offering `status` and `merge`, and a PreToolUse gate allowing `status`, asking for
`merge` and denying the rest. Nothing ran in the repository or in `symbiote/`.

**Learned**:
- **Scout reaches none of Symbiote's actions.** 18 workspace routes, 12 merge routes, the
  reviews' and analyses' API: Scout has Read, Grep, Glob and git's reads. It can Read a
  workspace's or review's JSON if it knows the path; agent states, the merge queue and graphs
  are in `symbiote view`'s memory and cache.
- **The person runs many workspaces at once.** 52 records in 8 days (14 on 2026-10-24), 44
  (85 %) with plan first, 50 on Claude Code, 46 finished; 49 verdicts, every one an approval.
- **Scout's flags take an MCP server unchanged.** With `--tools Read,Grep,Glob,Bash
  --strict-mcp-config --mcp-config mcp.json`, the session's tools were the four and
  `mcp__symbiote__merge`, `mcp__symbiote__status`; the server read `connected`. `--tools` limits
  only the built-in set.
- **The gate sees MCP calls.** Its `*` matcher was called for both tools. `allow` ran `status`
  in `dontAsk` mode; `ask` on `merge` was a denial with the gate's reason ("merging needs the
  person", in `permission_denials`) in `dontAsk` and in `default`: in `-p` nobody can answer.
  Claude Code's documentation says a hook's `ask` prompts the person, also in auto mode, and the
  person's deny and ask rules still apply; it says nothing of `ask` in `dontAsk`. So the plan
  moves Scout to `default` and checks a background session's prompt first.
- **The cost of a turn**: 2.7–3.0 s and $0.0002–0.0018 a run with two tool calls.

**Not tested**: an `ask` in a background session (`claude --bg`): it needs a folder the person
trusts, and `claude agents` would list a spike session in this worktree, where Symbiote looks for
this workspace's agent. A woken session's MCP server; Claude Code's MCP timeout on a long call;
Codex.

## MC1 replan — the person's answers; what Codex does with an MCP server (2026-10-25, branch `feature/symbiote-mcp`)

The person on the plan: the asks as proposed; Codex "should be resolved now, this app Symbiote
will firstly be used with Codex"; `symbiote mcp` included. Codex 0.163 measured with `codex
exec` in the scratch folder (the read-only sandbox and approvals `never`, as Scout's thread runs),
the toy server given by `-c mcp_servers.symbiote…`, and the app server's protocol from `codex
app-server generate-json-schema`.

**Learned**:
- **Codex refuses MCP calls under approvals `never`**: both tools failed with "MCP tool call
  requires approval, but approval policy is never", and the agent reported the refusal. MC1 as
  first planned would have given Codex's Scout tools it could never run.
- **One server can be approved alone**: `default_tools_approval_mode = "approve"` on
  `mcp_servers.symbiote` (Codex's `RawMcpServerConfig`; also `tools.<name>.approval_mode`,
  `enabled_tools`, `tool_timeout_sec`) ran both calls, in the read-only sandbox, approvals still
  `never`.
- **The server runs outside Codex's sandbox**: it read `http://127.0.0.1:<port>/` (a toy page)
  while the thread was read-only with no network; `CODEX_SANDBOX` was unset in its environment.
  The bridge can reach `symbiote view`.
- **A 75-second call came back** with no `tool_timeout_sec` set (84 s for the turn): the limit,
  if any, is above that; MC1 sets it to 11 minutes and measures 10.
- **A thread's configuration is given at its start and again at each resume**: `thread/start`
  and `thread/resume` both take `config`. Whether the daemon keeps a thread's MCP server when
  Codex's terminal resumes it was not measured: it needs this branch built.
- **So Symbiote asks, not the agents** (decision 361): Codex's own asking for MCP calls is
  either "approve" or a request to whichever client holds the turn (`mcpServer/elicitation/
  request`), and Claude Code's `ask` was a denial in `-p`. A Confirm in Symbiote's pages works for
  both, and for `symbiote mcp`'s callers.
- **What a turn reads on Codex**: 45.6K input tokens (41.3K cached) over a turn with two
  refused calls, 89.5K (84.9K cached) with two that ran, two tools defined. The 23 tools' cost
  is measured on both agents (spike d).

**Not tested**: the daemon's threads (start, resume, Codex's terminal) with the server; a
10-minute call; elicitation.

## MC1 — Symbiote's tools, Scout on both agents, the person's Confirm on every page (2026-10-25, branch `feature/symbiote-mcp`)

Built what the replanned MC1 says: `POST /api/mcp` with 23 tools over `symbiote view`'s services
(MC1a), the stdio bridge (`dist/mcp-stdio.js`, `symbiote mcp`) finding the view by a record in the
cache, Scout started with Symbiote's server on Claude Code and on Codex (MC1b), and the asks as a
bar on every page (MC1c); decisions 358–365. Then the whole flow for real with Scout on Codex in a
trial repository (MC1d).

**Learned**:
- **Codex takes a thread's MCP server from any resume**: a thread started without it got it from a
  `thread/resume` with `config` ("symbiote: starting → ready"), and its tool ran; a resume without
  `config` kept it. So Symbiote gives it at the start, with each message and before Codex's
  terminal joins (`load`), and never needs the person's `config.toml`.
- **Waiting is free on Claude Code, not on Codex**: a 10-minute `wait` took Claude Code two model
  requests (17.6K tokens); Codex checked the running call about every 30 s (four messages of
  "still waiting" among them), about 430K input tokens, 95 % cached. Codex's 0.163 timeout did
  not cut a 75 s call, and with `tool_timeout_sec` 660 not a 604 s one.
- **The person's answer must wait for the action**: answered at once, the page read the merges
  before the merge was queued, and the sidenav never showed it (nothing else was running to read
  again). Answering once the action is done, then reading again, fixed it.
- **A floating card covers what pages put at the bottom right**, and at 390 px the status bar's
  second line: the bar in its own grid row covers nothing.
- **Headless Chromium drew no frame with `WAYLAND_DISPLAY` set** on this machine today: every
  click waited for "stable" and timed out, in a new spec and in `shell.spec` alike; a blank page
  in a fresh `chromium.launch()` gave no `requestAnimationFrame`, with or without `--disable-gpu`.
  Unsetting `WAYLAND_DISPLAY` alone gave frames back. Not Symbiote's; every e2e run here unset it.
- **Restarting the person's Codex daemon to see a forgotten thread was refused** by the session's
  classifier (other work could run there); `load` makes it unneeded.
- **A real Codex Scout keeps to its prompt**: it asked for the start, the approval, the merge and
  the clean-up and nothing else; it sent the OK unasked, as decided; its answers were three lines.

**Verification**: tests first, red for the right reason (the plan's Results list them); `pnpm
check` 1,619 tests; e2e `mcp.spec.ts` 2 of 2, the full suite 240 of 242 before the last changes
(Scout's help text, fixed; `changes.spec`, passing alone). Real Codex flow in the trial repository:
four Scout turns of 5–13 s, four Confirms, the fix landed on `main` with its check, `via: "scout"`
on the verdict and the record, the checkout clean; 312.6K input tokens for Scout's thread (91 %
cached). Screenshots of the bar on History and Scout at 1440×900 and 390×844, dark and light.

Not verified: Scout on Claude Code with the real agent in the trial (it needs the folder trusted);
a woken Claude Code session's new bridge; Codex's own terminal joining after `load`; macOS and
Windows; `regression-check` (no analysis code). Cleaned up: the spike threads and Scout's trial
conversation archived, the trial's `symbiote view` stopped (its record removed); the trial
repository kept for the person to try Scout there.
