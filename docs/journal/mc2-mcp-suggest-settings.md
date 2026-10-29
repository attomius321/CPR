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

## MC2 — `suggest_settings`, the start's Confirm with its settings, Scout's prompt (2026-10-29, branch `feature/mcp-suggest-settings`)

Built what the plan says, with the person's answers (no Confirm; the documents by name; the
start's Confirm naming the model and the effort; Scout waits for their answer): the tool over the
workspaces' `suggest`, its arguments through `parseSuggestRequest`, the agent checked there for
the endpoint too, and a paragraph of Scout's prompt; decisions 582–584.

**Learned**:
- **The decision numbers collided while MC2 was built.** 576–578 were free on every branch and
  worktree at plan time; by the check before finishing, `feature/scout-reads-worktrees` and
  `feature/workspaces-card-revamp` both had 576–579 (and both V79), and a third worktree 576–581.
  MC2 took 582–584; the two commits before the renumbering say 576 and 578.
- **Nothing new was needed for a failure**: the advisor's `WorkspaceRefused` words reached the
  tool's error result through `run`'s catch, for all five refusals tested.
- **The worktree had no `node_modules`**: vitest's config did not load until
  `pnpm install --frozen-lockfile --offline` (150 ms from the store).

**Verification**: tests first, 9 red for the right reason, then green; `pnpm check` 2,252 tests;
`pnpm build`; `e2e/mcp.spec.ts` 2 of 2 with `WAYLAND_DISPLAY` unset. A real call through
`symbiote mcp` against this branch's `symbiote view` in a scratch repository (its own
`SYMBIOTE_CACHE_DIR`): a fix brief on Claude Code answered in 3.9 s with Haiku 5.5 at `low`'s
proposal; `agent: "nope"` refused in 2 ms, in the words the endpoint's 400 gave on the same
server. The view stopped by its PID after; the advisor's run folder was gone.

Not verified: Scout calling the tool in a real conversation (a Scout run writes into the person's
`symbiote/`), Codex as the advisor through the tool, a project whose own Scout prompt lacks the
new paragraph (the tool's description says the same).
