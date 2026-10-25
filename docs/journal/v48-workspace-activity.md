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
