# Journal: MC2 — `suggest_settings`: the advisor's proposal through Symbiote's MCP

[Index](../JOURNAL.md) · [Plan](../plan/mc2-mcp-suggest-settings.md)

## MC2 spike — what a start through Scout runs on, and what the advisor's endpoint checks (2026-10-29, branch `feature/mcp-suggest-settings`)

Read the workspaces' records since 2026-10-28 (`symbiote/workspaces/`, read only), Symbiote's MCP
(`mcp.ts`), the endpoint `POST /api/workspaces/suggest` and its parser, and the service's
`suggest`. Nothing was run.

**Learned**:
- **Scout's starts run on the agent's defaults.** 13 starts since 2026-10-28: the 11 on the Start
  page all at `xhigh` (2 on `opus`), the 2 through Scout with no model and no effort. Scout has
  no tool for the advisor, and no HTTP access.
- **The start's Confirm hides the settings.** `start_workspace`'s words name the branch, the
  title, the agent, plan first and the branch it starts from; a model or an effort Scout passes
  is started without the person seeing it.
- **The endpoint takes any agent.** `parseSuggestRequest` checks only that the agent is a text;
  the service's `found` reads anything not `claude` or `hermes` as Codex. The page never sends
  another, so the page never met it.
- **A failure needs nothing new.** The advisor's refusals are `WorkspaceRefused` with the words
  the page shows, and the MCP's `run` turns any error into its tool's error result in its words.
