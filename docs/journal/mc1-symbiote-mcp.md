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
