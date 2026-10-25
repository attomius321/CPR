# Journal: V48 — Workspaces that show what their agents are doing, and which wait for you

[Index](../JOURNAL.md) · [Plan](../plan/v48-workspace-activity.md)

## V48 spike — where an agent's state comes from, and what the page makes of it (2026-10-25, branch `feature/dynamic-agent-workspace-activity-status`)

Read on `main` at `94e1feb`: how each agent's state is decided (`claude-code.ts` `agentState`,
`codex.ts` `codexState` and `serverState`, `workspaces.ts` `summary`), what the hooks record
(`thread.ts`), how the page reads it (`useWorkspaces.ts`) and draws it (`Sidenav.tsx`,
`WorkspaceFacts.tsx`, `Workspace.tsx`). Then the e2e fake agent in six states — working, a Bash
permission, an `AskUserQuestion`, finished with a commit, failed, stopped — screenshotted at
1440×900, device scale 1, dark and light, by a Playwright spec outside the repository. Then the
person's 52 threads in `symbiote/threads/` (read only) and today's log's request times.

**Learned**:
- **No agent reports "starting" or "thinking".** `claude agents --json` (2.1.x, this machine)
  gives `pid`, `id`, `cwd`, `kind`, `startedAt`, `sessionId`, `name`, `status`, `state` and
  `waitingFor`, nothing about tools. The hooks record a session's start and end, prompts, end-of-turn
  reports, permissions and questions (`PreToolUse` only for `AskUserQuestion`) and notices: no
  tool call. Codex's runner drops `exec --json`'s items; its app server is read with items as
  `summary`. The person's last start (`POST /api/workspaces`) took 926 ms: the only "starting" is
  that request.
- **The thread already knows what an agent waits on.** For a Bash permission the card says
  "Waiting: permission p…" (cut at about 22 characters in 240 px) while the thread has "Waiting:
  permission to run pnpm test -- --run src/auth"; only the open workspace's Thread tab reads it.
- **Needs you is most of the states.** 17 of the 19 lines `workspaceNext` can say land there; with
  two waiting agents, one to review, one failed and one stopped, the count by "Workspaces" said 5.
- **The card's time is the workspace's age**, not its agent's: every card said "just now" in the
  shots whatever its state.
- **What the person's agents did** (52 threads): 21 permission or question waits (9 Bash, 6
  `AskUserQuestion`, 6 `EnterWorktree`), median 2.1 min until the next entry, p75 15.8, p90 31.3;
  97 finished turns before the person's next message, median 2.4 min, p90 15.4; 166 turns, median
  3.4 min, p90 24.5, longest 625 min; at most 4 agents working at once (25 Oct, 13:50).
- **A path starting with `//` stops `symbiote view`.** The spike's first address,
  `http://127.0.0.1:<port>//?branch=…`, answered "TypeError: Invalid URL" and the server was gone
  (the next request was refused): `new URL('//?branch=…', 'http://localhost')` at `server.ts:288`
  throws outside any handler. Not V48's: reported to the person for a fix of its own.
- **A parallel fix changes the same rules**: `fix/needs-you-workspaces-fix` (ready for review)
  draws "ready" in Needs you's amber in `Sidenav.css`, `Workspace.css`, `WorkspaceMark.css` and
  tests it in `tokens.test.ts`. The plan keeps its rule and expects to merge `main` after it.

Not measured yet: the list's read time with 50 workspaces, the halo's cost in the app on WSLg; both
are in the plan's verification.

## V48f spike — what Claude Code's and Codex's tools can tell (2026-10-25, branch `feature/dynamic-agent-workspace-activity-status`)

The person asked for tool-level activity in V48 ("5. Add now"). Read: Claude Code 2.1.310's own
hook schema (in its binary), Codex 0.163's app-server protocol (`codex app-server generate-ts`),
`codex-run.ts` and `merge-agent.ts`'s reading of `exec --json`. Timed: `dist/agent-hook.js` on
a copy of the person's 35 workspace records, 20 runs; the person's two Codex app-server threads
read in `summary` and `full` (read only, no turn started).

**Learned**:
- **Claude Code's hooks can run in the background**: its command hooks take `async: true` ("If
  true, hook runs in background without blocking"). `PreToolUse` carries `tool_name`,
  `tool_input`, `tool_use_id`; `PostToolUseFailure` (it exists in 2.1.310) adds `error`,
  `is_interrupt` and `duration_ms`.
- **A hook run costs 29.8 ms** (median of 20; 25.5–34.8; a bare `node -e 0` 15.5 ms): Node's start
  and reading every record to find the workspace. Before and after every tool, synchronous, that
  is ~60 ms a call; async, the agent does not wait.
- **Codex's app server says what runs only in `full`**: `summary` holds the user's and the agent's
  messages; `full` adds `commandExecution` (command, status, exit code, output), `fileChange`
  (paths), `reasoning`, `mcpToolCall`, `webSearch` and more. On the two threads here: 1,525 against
  4,571 bytes, 25 and 4 ms; 803 and 800 bytes for a turn with no command. A long turn's `full`
  read was not measured: no such thread here.
- **Async hooks can land out of order**: two processes per tool, each taking its own time; the
  plan pairs a start and its end by `tool_use_id` rather than by order.

## V48a–V48f — the groups, what runs, Waiting for you, the Activity tab, the small things (2026-10-25, branch `feature/dynamic-agent-workspace-activity-status`)

Built as planned with the person's answers (decisions 367–377): `workspaceNext` splits Needs you
into Waiting for you, To review and Not running; the list's summary carries `activity` (since
when, the ask, the last report, what runs); every tool's start and end is recorded (Claude
Code's hooks in the background, Codex's runner, Codex's app server read in full while active);
the sidenav draws Waiting for you first with Respond, the dots by shape, the slow pulse, the
times; a workspace's heading its strip and Next waiting; an Activity tab; notices, a starting
card, stale reads, skeletons, cards that slide. Commits `7d52163` to `e13ff2a`.

**Learned**:
- **"Thinking" needs proof the tools are recorded**: an agent started before V48 has no tool
  hooks, and "no tool running" would read as thinking forever. The record says `activity: true`
  at a start with them; without it the card says Working, as before.
- **Two async hooks of one tool can land out of order** (each its own Node process): a start and
  its end are paired by `tool_use_id`, never by position; only the current turn's tools count, so
  an end lost to an interrupt does not keep a tool "running".
- **Codex's web search and reasoning items have no status**: read as running, they would have
  stayed so. Such an item runs only while it is the last of a running turn.
- **A pseudo-element's animation recalculates style every frame**: 601 in 10 s for four dots,
  with or without `will-change`, and with a real child element too. No layout. ≈1 % of a core.
- **The list's added read is mostly opening a file**: 0.36 ms a working workspace at 16 KB
  against 0.55 at 64 KB; the derivation is 0.016 ms.
- **Flex drops a leading space**: "no commits yet· under a minute" in the heading until the
  separator was a no-break space.
- **Under load a starting card was measured instead of the real one** (both carry the branch
  name): 64.00003 px against look.spec's 64. Its name lays out as a card's button now.
- **A starting card's name was a `.workspace-about`**, the class the arrows and the focus take for
  a card's button: the second full run's focus test pressed ↓ onto it (1 of 253; alone 4 of 4
  passed). It has a class of its own now.
- **`.button` alone is the primary** in this stylesheet: a card's Respond is `secondary`.
- **The first `//?branch=` address of the spike crashed `symbiote view`** (`server.ts:288`): not
  fixed here, reported.

**Verification**: tests first for each part (red for the right reason: missing modules, `needs-you`
where `waiting` was expected, `undefined` asks), then green: viewer workspaces 42, timeline 7,
clock 4, transitions 5, starting 1; CLI workspace-activity 15, thread 19 (activity lines and the
hook's mode), workspaces (the settings file, the record, doing, tools in the thread, Codex's app
server); `pnpm check` 1,723 tests. e2e 253 of 253 (`env -u WAYLAND_DISPLAY`), 8 new for V48:
Waiting for you, Respond focusing the terminal, the count and the title, Next waiting, leaving
it without a reload; what runs and since when; the pulse and its still halo; the six groups'
icons; the Activity tab's rows and a report appended; the notice and Open; the stale line; the
outlines and the starting card; Stopping…; and the V44 icons test grown to six groups. Costs against `main`'s build in the plan's results.
Screenshots at 1440×900, device scale 1, dark and light: each state's panel, the rail, the
Activity tab, History, Settings, Start, Scout, Skills, Monitor, the narrow drawer.

Not verified: the pulse's CPU in the desktop app on WSLg; a real Claude Code or Codex session
with the new hooks and reads (the fakes stand in, shaped on 2.1.310's schema and Codex 0.163's
protocol); macOS and Windows rendering.
