# MC2 — `suggest_settings`: the advisor's proposal through Symbiote's MCP

[Index](../PLAN.md) · [Journal](../journal/mc2-mcp-suggest-settings.md)

**Status:** merged into `main` on 2026-10-29 (built 2026-10-29), on branch `feature/mcp-suggest-settings` (a workspace
started through Scout); planned the same day with the person's answers below. Its "As built" and
results below.

**Problem** (asked: "Scout (or any client of Symbiote's MCP server) can ask the advisor (V75) for
a workspace's settings before it starts one"). The advisor is reachable only from the Start page's
**Suggest settings** (`POST /api/workspaces/suggest`); Scout has no HTTP access and Symbiote's MCP
(MC1) has no tool for it. So a start through Scout runs on the agent's defaults:

| Workspaces started since 2026-10-28 (`symbiote/workspaces/`) | Starts | Model | Effort |
|---|---|---|---|
| On the Start page | 11 | `opus` on 2, the default on 9 | `xhigh` on 11 |
| Through Scout (`via: "scout"`) | 2 | the default | the default |

Both of Scout's (`feature/scout-reads-worktrees`, this one) are plan-first features the person
sizes at `xhigh` on the page. Two more things, read from the code:

- `start_workspace`'s Confirm says `Start fix/x, "Title", with Codex, plan first`: a model or an
  effort Scout passes is not in the words the person confirms.
- `parseSuggestRequest` takes any text as the agent: `agent: "nope"` reaches the service, whose
  `found` reads anything not `claude` or `hermes` as Codex.

**Goal**: Scout, or any client of `symbiote mcp`, asks `suggest_settings` with the brief it will
start and gets the advisor's proposal as the page gets it: model, effort, plan first, the one
sentence why, and the model it ran on. Scout shows it and waits for the person's answer; the
person's choice wins, and the Confirm of the start names the model and the effort it starts with.
**Unchanged**: the advisor, its prompt and models; the Start page; a running workspace's settings.

## The tool (`packages/cli/src/mcp.ts`)

- `suggest_settings`, listed between `start_options` and `start_workspace`, needs `workspaces`;
  `McpServices.workspaces` adds `suggest`.
- Input: `kind`, `title`, `parts`, `agent` — one set of definitions shared with `start_workspace`,
  so the two briefs cannot drift — and `documents`, the attached files' names (strings), as the
  page sends them. Required: `kind`, `title`, `parts`, as `start_workspace` requires them.
- The handler picks those five fields, passes them through `parseSuggestRequest` (the endpoint's
  checks, so the endpoint's words), and returns `workspaces.suggest(request)` unchanged.
- The service's refusals (`WorkspaceRefused`: declined, no answer within 20 s, an exit code, an
  answer Symbiote cannot use, Hermes, not installed) reach the tool's error result word for word,
  through `run`'s catch; nothing is put in their place.
- Its description says what it costs and when to call it: one turn of the agent's small model on
  the person's subscription, 20 s at most, nothing started; only before a start the person asked
  for; the person's choice wins. A client other than Scout reads only that.
- No Confirm (decision 582): it is not in `asking`.

## The start's Confirm (`start_workspace`)

The words name the model and the effort when the call gives them: `Start fix/x, "Title", with
Codex on gpt-6 at high, plan first` (decision 584). Without them, as today.

## The request's check (`server-requests.ts`)

`parseSuggestRequest` refuses an agent that is not one of `AGENT_KINDS`, with the words it gives a
non-text agent: `agent: claude, codex or hermes`. The endpoint and the tool both get it.

## Scout (`prompts.scout`)

One paragraph: before a start the person asked for, unless they named the model, the effort and
plan first, call `suggest_settings` with the brief to start; show the proposal in one line (model,
effort, plan first, its why) and wait for their answer; start with what they choose, their choice
over the proposal. A failure is said in its words, never a guess in its place; never called for
anything else. A project that changed Scout's prompt keeps its own text: the tool's description
says the same.

## Docs

`docs/reference/commands.md` (the tools' table), the README's Scout line, this plan and its
journal.

## Verification

1. **Tests first** (red before):
   - `mcp.test.ts`: listed after `start_options` with its schema, not among the asked ones;
     `start_workspace`'s whole arguments give the service only the brief's fields and the
     suggestion back unchanged, nothing asked or started; bad input refused with the words
     `parseSuggestRequest` throws for the same body, the service not called; the service's
     refusal passed through; the start's Confirm with a model and an effort.
   - `workspace-advice.test.ts`: `agent: "nope"` refused.
   - `prompts.test.ts`: Scout's prompt names `suggest_settings` and says the person's choice wins.
   - `e2e/mcp.spec.ts`: 24 tools.
2. `pnpm check`, `pnpm build`, `mcp.spec.ts`. No analysis code: no `regression-check`.
3. **A real call**: `symbiote mcp` against this branch's `symbiote view` in a scratch repository,
   the advisor on Claude Code (`haiku` at `low`, one turn): the tool's answer equals a
   `WorkspaceSuggestion`.

**Risks**

| Risk | Mitigation |
|---|---|
| Scout calls it for every message, spending turns | The prompt and the description: only before a start the person asked for, never for anything else |
| A proposal Scout starts with unseen | Scout waits for the person's answer; the start's Confirm names the model and effort |
| Documents named that the start cannot attach (MCP's `start_workspace` takes none) | Names only, as the page; the person asked for them |
| A running `symbiote view` lacks the tool | It is the build it started with (fix/suggest-settings-models): restart after `pnpm build` |

## Milestones

| # | Milestone | Output |
|---|---|---|
| MC2 | `suggest_settings`, the start's Confirm with its settings, Scout's prompt | the tool, tests, docs |

**Decisions** (the person's answers, 2026-10-29: "1. Yes 2. Iclude documents 3. Yes 4. Yes"):

| # | Question | Decision | Why |
|---|---|---|---|
| 582 | Does `suggest_settings` wait for the person's Confirm? | **No**; Scout's prompt and the tool's description: only before a start the person asked for, and Scout waits for their answer before it starts | It starts nothing (a proposal, decision 548) and costs one small turn at `low` (3–5 s, V75); the start that follows waits for Confirm already, so a second would double the person's clicks per start. Decision 549's "only when asked" stays, in the words that bound when it is called |
| 583 | What does it take and answer? | **`start_workspace`'s brief (kind, title, parts, agent) and the documents' names, checked by `parseSuggestRequest`; the `WorkspaceSuggestion` unchanged, a refusal or failure in the service's words** | Scout passes one brief to both; one check gives the endpoint's words to both; a guess in a failure's place would be a proposal nobody made |
| 584 | What does the start's Confirm say of the settings? | **The model and the effort, when the call gives them** | The person confirms what starts; today a model Scout passes is not in the words |

**Not in MC2**: attaching documents through `start_workspace`; changing a running workspace's
model or effort; the advisor itself.

## As built (MC2)

- **As planned**, but for the decisions' numbers: planned as 576–578, they are **582–584**. While
  MC2 was built, `feature/scout-reads-worktrees` and `feature/workspaces-card-revamp` both took
  576–579 (and both V79), and another branch went up to 581.
- **The shared brief**: `brief` (`kind`, `title`, `parts`) and `agentKind` in `mcp.ts` are the
  schema of both tools; a test compares `suggest_settings`'s properties with `start_workspace`'s.
- **The endpoint's 400s are now tested by their words** (`server.test.ts`): `kind: feature, fix,
  refactor, chore or spike` for `epic`, `agent: claude, codex or hermes` for `nope`. Before, only
  the status was.

**Results.** Tests first, 9 red for the reason they name (`unknown tool: suggest_settings`; the
Confirm without the model; Scout's prompt without the tool; a 200 for `agent: "nope"`), then
green; `pnpm check` 2,252 tests; `pnpm build`; `e2e/mcp.spec.ts` 2 of 2 (24 tools). A real call
through `symbiote mcp`, against this branch's `symbiote view` in a scratch repository with a
cache of its own: 24 tools listed; a one-line fix brief on Claude Code answered in 3.9 s with
`{ agent: claude, model: haiku, effort: low, planFirst: false, why: "A single word typo in one
README heading is a small, mechanical copy fix.", by: Haiku 5.5 at low }`; `agent: "nope"`
refused in 2 ms with `agent: claude, codex or hermes`, the words the endpoint answered with its
400 on the same server. Not verified: Scout itself calling the tool (a real Scout run writes into
the person's `symbiote/`), Codex as the advisor, a project with its own Scout prompt.
