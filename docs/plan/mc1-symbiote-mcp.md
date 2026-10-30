# MC1 — Symbiote's MCP: Scout as the person's assistant, from a workspace's start to its merge

[Index](../PLAN.md) · [Journal](../journal/mc1-symbiote-mcp.md)

**Status:** merged into `main` on 2026-10-25 (built 2026-10-25), on branch `feature/symbiote-mcp` (a workspace started
in Symbiote); planned and replanned the same day with the person's answers (what asks: as
proposed; Codex now, "this app Symbiote will firstly be used with Codex"; `symbiote mcp`
included). Its "As built" and results below.

**Problem** (asked: "We need an MCP for symbiote, because i would like the Scout to be an
orchestrator like of workspaces flow from dev to merge. Should have access to all the logical
features the symbiote gives, Scout will be like my assistant"). Scout (V35) reads files and git's
history, and nothing else: it cannot see a workspace's agent, a review, a merge or an analysis,
and it is told never to act. Every step of a workspace's flow is the person's clicks:

| Symbiote does (its API, `server.ts`) | Operations | Scout today |
|---|---|---|
| Workspaces: list, options, start, the agent's thread, reply, stop, start again, changes, merge check, clean up | 18 routes | Only `symbiote/workspaces/*.json` by Read, if it knows the path; no agent state |
| Reviews: list, a branch's review, its verdict | 3 | The JSON files by Read; no marks' meaning, no verdict written |
| Analyses: a pair's graph, its findings | 3 | None: the graph is in `symbiote view`'s memory and cache |
| Merges: queue, log, land, retry, a resolution's approve or redo, recheck, remove | 12 | None: the queue is in Symbiote's cache |
| Usage, Monitor | 3 | None |

The person's flow, from their records (`symbiote/workspaces/`, `symbiote/reviews/`): 52
workspaces in 8 days (14 on 2026-10-24), 44 of them (85 %) with "plan first", 50 on Claude Code,
46 finished; 49 verdicts, all approvals. Each one is a start page, a plan to read and answer in a
terminal, a review, an approval, a merge, a land and a clean-up, done by hand across several
workspaces at once. From now on Codex comes first.

What decides the design (spike in a scratch folder with a toy stdio MCP server; journal):

- **Claude Code takes an MCP server with Scout's flags as they are** (2.1.310, `-p`):
  `--tools Read,Grep,Glob,Bash` limits only the built-in tools; `--strict-mcp-config
  --mcp-config <file>` adds that file's servers and no other. Scout's gate's `*` matcher saw
  both MCP calls and its `allow` ran one in `dontAsk` mode.
- **Claude Code's own asking does not fit a background Scout**: the gate's `ask` was a denial in
  `-p`, in `dontAsk` and in `default`; the documentation says `ask` prompts in a live session but
  not what it does in `dontAsk`, and a prompt in Scout's terminal is seen only while the person
  has it open.
- **Codex refuses every MCP call in Scout's thread** (0.163, `codex exec`, the read-only sandbox,
  approvals `never`, as Scout runs): "MCP tool call requires approval, but approval policy is
  never", for both tools. With `default_tools_approval_mode = "approve"` on that one server, both
  ran; the server, which Codex runs outside the sandbox, read a local HTTP address (the bridge's
  case); a 75-second call came back with no timeout set.
- **Codex takes a thread's configuration at its start and at each resume**: `thread/start` and
  `thread/resume` both have `config`, where `mcp_servers.symbiote` can go. The person's
  `config.toml` has no MCP server today.
- **A Scout conversation outlives `symbiote view`'s port**: Claude Code's background session stays
  idle between turns (V35), Codex's thread lives in its daemon, and a new `symbiote view` takes a
  free port. A server address written into the agent's configuration would go stale; a stdio
  program the agent starts can look the address up on each call.

**Goal**: Scout becomes the person's assistant for the workspace flow, on Codex and on Claude
Code. From its page the person says "start a fix for X, plan first", "what is waiting for me?",
"show me feature/y's plan", "tell it OK", "review it", "approve and merge it", "clean it up", and
Scout does it through Symbiote's own services, the same ones the pages use. What changes a
branch's fate — starting an agent, recording a verdict, merging, landing, cleaning up — waits for
the person's Confirm in Symbiote, on whatever page they are, with what is about to happen. Scout
still never edits a file, commits, checks out or pushes in the checkout. The same tools serve the
person's own agents through `symbiote mcp`. **Unchanged**: workspaces' agents (Symbiote gives
them no MCP), the merger, the review and merge pages, `symbiote/AGENTS.md`'s rules, Scribe.

## Symbiote's tools (`packages/cli/src/mcp.ts`, `POST /api/mcp`)

- **Where they run**: in `symbiote view`'s process, over the services it already has
  (`RepositoryOptions`: `workspaces`, `reviews`, `diffs`, `merges`, `usage`, `monitor`), as
  `POST /api/mcp`: one JSON-RPC 2.0 message in, its answer out (MCP's Streamable HTTP, JSON
  answers, no stream). The same protection as every write: the host check, a JSON body, the
  `x-symbiote: 1` header, no foreign `Origin`.
- **The protocol, by hand** (decision 359): `initialize` (protocol version echoed, `tools`
  capability, `serverInfo: symbiote`), `notifications/initialized`, `ping`, `tools/list`,
  `tools/call`; anything else `-32601`. A service's refusal (`WorkspaceRefused`, `ReviewRefused`,
  `MergeRefused`, `ScoutRefused`) is a tool result with `isError: true` and its words; a bad
  argument the same, naming it. Results are text: compact JSON of what matters (no brief text in
  a list, the thread's last 20 entries, a log's last 60 lines).
- **The tools** (Claude Code shows them as `mcp__symbiote__<name>`, Codex as `symbiote.<name>`).
  *Unasked*: they run at once. *Asked*: they wait for the person's answer in Symbiote (below).

  | Tool | Service | What it answers or does | |
  |---|---|---|---|
  | `overview` | status, workspaces, reviews, merges | The checkout (branch, HEAD, changes not committed), each workspace's state, what needs the person (`needs-you`, `plan-ready`, `ready`, a merge `needs-you`), the queue | unasked |
  | `workspaces` | `workspaces.list` | Every workspace: branch, kind, title, agent state, ahead, merged, last action | unasked |
  | `workspace` | `changes`, `merge`, `prompt` | One workspace: its brief, commits and files, whether it merges cleanly, its review's last verdict | unasked |
  | `thread` | `workspaces.thread` | What its agent was given and reported, what it waits on | unasked |
  | `start_options` | `workspaces.options`, `check` | Kinds and their brief parts, agents, levels, models, branches to start from, the guessed check | unasked |
  | `start_workspace` | `workspaces.start` | A kind, title, brief parts, branch, plan first, agent, level, model, from | **asked** |
  | `reply` | `workspaces.reply` | A message to a workspace's agent ("OK, go ahead") | unasked |
  | `stop_agent` | `workspaces.stopAgent` | Stops an agent that works or waits | unasked |
  | `restart_agent` | `workspaces.startAgent` | Starts a workspace's agent again | **asked** |
  | `clean_workspace` | `workspaces.clean` | Its sessions, worktree and (merged) branch; `unmerged` only when said | **asked** |
  | `review` | `reviews.resolve`, `diffs` | The branch's graph from its fork point to its tip (decision 363): changed symbols by kind, every finding in the detector's words, the most-called changed symbols, its review's marks and verdict, the page's address | unasked |
  | `finish_review` | `reviews.finish` | A verdict (approve into a branch, request changes, comment) with a summary and comments on symbols or lines | **asked** |
  | `merges` | `merges.list`, `targets` | The queue; a branch's targets | unasked |
  | `merge_log` | `merges.log` | An entry's log, its last lines | unasked |
  | `queue_merge` | `merges.enqueue` | The approved commit of a branch, into a branch | **asked** |
  | `land_merge` | `merges.land` | A `ready` merge lands | **asked** |
  | `merge_resolution` | `approve`, `requestChanges` | Approves the merger's resolution, or asks it again with words | **asked** |
  | `retry_merge`, `recheck_merge`, `remove_merge` | `retry`, `recheck`, `remove` | As the merge page's buttons | **asked** |
  | `usage` | `usage.report` | Each subscription's windows of use: whether another agent fits | unasked |
  | `code_map` | `monitor.map` | Where the checkout's code is, by folder | unasked |
  | `wait` | all of the above | Waits until a workspace's or a merge's state changes, or `minutes` pass (10 at most); what changed (decision 364) | unasked |

- **Symbiote asks, not the agent** (decision 361). An asked tool's call is held as a request:
  its words ("Merge feature/x at `abc1234` into main"), the tool and its input, who asks (Scout,
  or `symbiote mcp` and the client's name and folder), when. `GET /api/mcp/asks` lists the open
  ones; `POST /api/mcp/answer { id, yes }` answers one (a write, as every other). Confirm runs the
  tool and the call returns its result; Decline returns "the person declined", and nothing is
  done; no answer in 10 minutes returns "no answer: nothing was done, ask again". One request at
  a time per caller; a request is dropped when its caller hangs up.
- **Not exposed** (decision 360): checking out (the person's working copy), Settings (prompts,
  levels, models), terminals and shells, documents for a start, Skills and Scribe, opening VS
  Code. Each is the person's, on its page.
- **What Scout did says so** (decision 362): `via: "scout"` on a verdict in
  `symbiote/reviews/<branch>/<reviewer>.json` (under the person's name: they confirmed it), and
  on the record of a workspace it started; AGENTS.md's text gains one line saying what it means.
  `symbiote mcp`'s callers get `via: "mcp"`.

## The bridge (`packages/cli/src/mcp-bridge.ts` → `dist/mcp-bridge.js`; `symbiote mcp`)

- A stdio MCP server that forwards each line of JSON-RPC to `POST /api/mcp` of the live
  `symbiote view` and writes its answer back; notifications get none. Node's modules only, like
  the hooks, so it starts in tens of milliseconds (decision 358). It tells the server who calls
  (`--as scout`, else the client's `initialize` name and its folder), for the asks.
- **Finding the server**: `symbiote view` writes `<cache>/views/<repo id>.json` (`url`, `pid`,
  `root`, `started`) once it listens and removes it on close if it is still its own. The bridge
  is given that path and reads it on every message: a restarted `symbiote view` on another port
  is found by the next call. No file, or no answer: a JSON-RPC error in words ("Symbiote is not
  running for <root>: open it with `symbiote view`").
- **`symbiote mcp`** runs the same bridge for the repository it is run in, for the person's own
  agents: `claude mcp add symbiote -- symbiote mcp`, or Codex's `[mcp_servers.symbiote]` with
  `command = "symbiote"`, `args = ["mcp"]`. Its asked tools wait for the same Confirm. The README
  says how, and that an agent given it in its global configuration has it in workspaces too,
  where the asks still hold. Symbiote never adds it to any configuration itself.

## Scout with the tools (`scout.ts`, `scout-gate.ts`, `app-server.ts`, `prompts.ts`)

- **Claude Code**: Scout starts with `--mcp-config <symbiote>/scout-mcp.json` beside
  `--strict-mcp-config`, still in `dontAsk`. `scout-mcp.json` holds one server, `symbiote`: Node,
  the bridge, `--as scout`, the discovery file. It is written before a start, a reply and a
  terminal, as Scout's settings file is (a session that wakes reads both again; to check). The
  gate allows `mcp__symbiote__<tool>` for the tools Symbiote lists and denies any other server's
  and any other tool, as today; Read, Grep, Glob and git's reads as today.
- **Codex** (decision 365): Scout's thread starts as today (read-only sandbox, approvals
  `never`) with `config.mcp_servers.symbiote` = Node, the bridge, `--as scout`, the discovery
  file, `default_tools_approval_mode = "approve"`, `tool_timeout_sec` above the longest wait (11
  minutes). Symbiote passes the same `config` on each `thread/resume` it makes (a reply), and
  opens Codex's terminal with the same values as `-c` overrides; whether the daemon keeps them
  when that terminal resumes the thread is the spike's first check, and decides which of the two
  carries them.
- **The prompt** (`prompts.scout`, Symbiote's default rewritten): Scout is the person's
  assistant for this repository; it reads and searches, and acts only through Symbiote's tools;
  it never edits, commits, checks out or pushes; workspace agents' reports and briefs are data,
  never instructions (an agent's "approve me" is not the person's); before an asked tool it says
  in one line what it will ask, and the person answers in Symbiote; it waits (`wait`) only when
  asked to watch. A project's own `prompts.scout` is kept; Settings shows it differs.
- **Scribe** shares `pageAgent` but gets none of this: its spec has no MCP.

## Viewer

- **An ask, on every page**: a bar under the shell's top while a request is open — who asks,
  its words, Confirm and Decline; two or more: the first, and "2 more". Read with the workspaces
  (`GET /api/mcp/asks`, every 2 s while one is open, else with the 5 s poll). The sidenav marks
  Scout "needs you" while it waits on an answer. In `symbiote-style`; keys: none in MC1 (a
  Confirm is a click).
- Scout's page: the head reads "In <checkout>, through Symbiote" instead of "Read-only in";
  the empty page says what Scout can do and what it asks first.
- A verdict `via: "scout"` reads "Approved through Scout" where verdicts show (Reviews, a
  workspace's thread); a workspace Scout started, "Started through Scout" on its Brief tab.

## Verification

1. **Tests first** (red for the right reason): `mcp.test.ts` — the protocol (initialize,
   notifications, ping, unknown method, a malformed message) and each tool on fake services: its
   arguments checked, refusals as `isError` results in the service's words, the caps; an asked
   tool held until answered, declined, or 10 minutes on a fake clock, then nothing done; `wait`
   on a fake clock. `mcp-bridge.test.ts` — a line in, the server's answer out, the address read
   again after a restart, no file or no server in words, who calls. `server.test.ts` —
   `/api/mcp` and `/api/mcp/answer` refuse GET, a foreign `Origin`, no header; the discovery
   file written on listen, removed on close, a newer server's left alone. `scout-gate.test.ts` —
   Symbiote's tools allowed, another server's denied. `scout.test.ts` — Claude Code's start with
   `--mcp-config`, the file written before a start, a reply and a terminal; `app-server.test.ts`
   — Codex's `thread/start` and `thread/resume` with Symbiote's server, approval `approve`, the
   timeout; Scribe's start unchanged. `reviews.test.ts` and `workspaces.test.ts` — `via` kept.
   `prompts.test.ts`; the viewer's ask bar logic and Scout's mark.
2. **End to end without an agent**: an e2e runs the bridge against the e2e server as an MCP
   client: `overview` lists the fake workspaces; `reply` reaches the fake agent; `finish_review`
   shows its ask on History and on Scout's page, Confirm records the approval with `via`;
   `queue_merge` declined does nothing; confirmed, it shows on the merge page. `scout.spec.ts`:
   Claude Code's and Codex's starts carry the server.
3. **Nothing else changes**: every other unit and e2e test as on `main`; Scribe as today; a
   workspace's agent starts with the same arguments as on `main`. No analysis code changes:
   `regression-check` not needed (core gains types only).
4. **Spike first, with the built branch** in the trial repository (below): (a) Codex: a thread
   started with Symbiote's server keeps it after a reply's `thread/resume` and when Codex's
   terminal resumes it; (b) Claude Code: a woken session starts a new bridge, which reaches a
   restarted `symbiote view` on another port; (c) a call held 10 minutes comes back on both
   agents (Claude Code's MCP timeout; Codex's `tool_timeout_sec`); (d) each agent's first-request
   tokens with the 23 tools, against today's (V35: 9.9K on Claude Code).
5. **The flow, for real**, Codex first, then Claude Code: from Scout's page, a planned fix
   started (asked, confirmed), its plan shown at `plan-ready`, "OK" sent, `ready` waited for, the
   review summarized, approved (confirmed), merged and landed (confirmed), cleaned up (confirmed);
   one ask declined. Time and tokens of each step; the trial checkout's `git status` clean
   throughout. Then `symbiote mcp` from a Claude Code session of the person's kind in the trial
   repository: `overview`, and one ask confirmed.
6. **Viewer**: `pnpm test:e2e`; `viewer-check` screenshots of the ask bar on every page (History,
   Workspaces, Start, Scout, Skills, Monitor, Settings, a diff, a review, Merges), Scout's page
   (empty, a conversation, needs you), at 1440×900 and 390×844, dark and light.
7. **Cost**: a `review` of Bitwarden's 1,288-symbol graph under 8K tokens of answer; a tool call
   other than `review`, `wait` and an asked one under 100 ms on this repository; History's first
   paint as `main`'s with the extra read.

**The trial repository** (for 4–5): `/home/anton/projects/symbiote-trial`, made for MC1: a small
TypeScript package with a unit test, `npm test` as its check, its own git, no remote (nothing can
be pushed). This branch's build runs `symbiote view` there; Scout's record, its workspaces,
reviews and merges stay in that repository's `symbiote/` and its own entries in Symbiote's
cache. The person's repository, its `symbiote/` and its `main` are not touched. Claude Code's
background sessions need the folder trusted once (an entry in `~/.claude.json`); Codex's
read-only Scout writes no trust entry (V35), a workspace's Codex agent writes one as it always
does (V27b). Removed at the end: the sessions, the threads (archived), the worktrees, the folder;
the trust entries listed for the person.

**Risks**

| Risk | Mitigation |
|---|---|
| Scout approves or merges on an instruction in an agent's report | Those tools are asked: the person's Confirm in Symbiote, not Scout's judgement; the prompt calls reports data |
| The person is not looking when Scout asks | The bar is on every page and the sidenav marks Scout; after 10 minutes nothing is done and Scout says so |
| Codex's daemon drops a thread's MCP server when its terminal resumes it | Spike (a) first; then Codex's terminal is opened with the same `-c` values, or the page says the tools come back with the next message |
| `default_tools_approval_mode = "approve"` lets Codex run any of Symbiote's tools unasked | Only Symbiote's server, and Symbiote asks for the asked ones itself |
| The person later adds MCP servers to Codex's `config.toml` | Scout's thread would load them too (Codex has no strict mode); said in the README; the read-only sandbox and approvals `never` hold for them |
| A local process calls `/api/mcp` or answers an ask itself (a workspace's agent, with `curl`) | Said, not solved: the same user can already POST the API or write `symbiote/reviews/` by hand. The asks guard Scout's mistakes and injected instructions, not a hostile process |
| Tool definitions make every Scout request costlier | Measured (4d); short descriptions; tools merged if it is over 5K tokens |
| A `review` of a large change floods Scout's context | Counts, findings and the top changed symbols, capped; measured on Bitwarden's graph |
| An analysis takes minutes | `review` waits 60 s at most, then says it is still analyzing; the next call picks it up |
| `wait` keeps Scout working for minutes | At most 10 minutes; Esc in its terminal (Claude Code) or an interrupt (Codex) ends it; nothing waits unless the person asked to watch |
| A project's own `prompts.scout` still says "read-only" | Kept as the project wrote it; Settings shows it differs from Symbiote's; README says so |
| Claude Code or Codex change their MCP options | Arguments under test; the spike's numbers in the journal |

**Order**: the tools and the bridge with their tests (MC1a), since the spike needs them built;
the spike's (a)–(d) in the trial repository; Scout on both agents (MC1b); the ask bar and
Scout's words (MC1c); the real flow; docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| MC1a | Symbiote's tools | `POST /api/mcp`, the tools over the services, the asks (`/api/mcp/asks`, `/api/mcp/answer`), `dist/mcp-bridge.js`, `symbiote mcp`, the discovery file |
| MC1b | Scout with them, on both agents | `scout-mcp.json` for Claude Code, Codex's per-thread server, the gate, `prompts.scout` rewritten, `via` on verdicts and records |
| MC1c | The viewer | The ask bar on every page, Scout's "needs you" and words, "through Scout" on verdicts and briefs |
| MC1d | Real runs | The spike and the whole flow in the trial repository, Codex then Claude Code, measured; README, AGENTS.md's line |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 358 | Where the tools run | **In `symbiote view`'s process (`POST /api/mcp`), reached through a stdio bridge that reads the server's address from a file on each call** | One owner of the merge queue, the sessions' list and the analyses; a conversation outlives the port; stdio is what Claude Code and Codex both start, and Codex runs it outside its sandbox |
| 359 | MCP's SDK | **None: the five methods by hand**, as `websocket.ts` is | `initialize`, `tools/list`, `tools/call`, `ping`, notifications; no new runtime dependency |
| 360 | What Scout may do | **Reads, `wait`, `reply` and `stop_agent` unasked; starting an agent, a verdict, every merge action and a clean-up asked; checkout, Settings, terminals, Skills not exposed** (the person: as proposed) | The asked ones change a branch's fate or spend a new agent's quota; Approve means merge (V17) and stays the person's yes |
| 361 | Who asks | **Symbiote: an asked call waits for Confirm or Decline on whatever page the person is, 10 minutes at most; Scout's agents run the tools without their own approval** (Claude Code in `dontAsk`, Codex with `approve` for Symbiote's server) | Codex refuses MCP calls under approvals `never`, and an approval inside a thread nobody has open is not seen; Claude Code's `ask` was a denial in `-p`; one way for both agents and for `symbiote mcp`'s callers, which no "don't ask again" skips |
| 362 | What Scout made | **`via: "scout"`** (`"mcp"` for `symbiote mcp`) on the verdict and the workspace's record, under the person's name | Explainable later: who typed it, who confirmed |
| 363 | What `review` answers | **Symbiote's graph of the branch (fork point → tip): symbols by kind, findings word for word, the most-called changed symbols; not the diff's lines** | North Star: review decisions, not lines; findings stay the detectors' own |
| 364 | Telling Scout something changed | **`wait`, asked for by the person, up to 10 minutes; Symbiote never starts a turn by itself** | A wait reads Symbiote's state and costs no tokens; a turn Symbiote started would spend the person's quota unasked |
| 365 | Codex | **In MC1, first: Scout's read-only, never-asking thread with Symbiote's server in its `config`, at its start and at each resume Symbiote makes; approval `approve` for that server only** (the person: "should be resolved now") | Both tools ran so in the spike, the server reached a local address from outside the sandbox; nothing is added to the person's `config.toml`, so workspaces' Codex agents get none |

**Not in MC1 (later)**: documents with a start; a list of what Scout did on its page; Symbiote
telling Scout of a change by itself; Settings to choose which tools ask; keys for Confirm and
Decline; Codex's own approval and elicitation requests (`mcpServer/elicitation/request`) as
another way to ask.

## As built (MC1)

- **The asks are a bar in the shell's own grid row** (`asks`, between its top and the page, in all
  four templates: wide, narrow and the desktop window's two), as the plan said. A floating card
  was tried first: at 390 px it covered the status bar's second line, and it would cover a page's
  own bottom-right controls (a workspace's Send). Without an ask the row is empty and 0 high.
- **The asks are read on their own**, every 2 s while a page shows (`useAsks`), not with the
  workspaces: an agent through `symbiote mcp` may ask while nothing Symbiote reads is working, and
  the workspaces' read stops then.
- **The person's answer is answered once what they confirmed is done** (30 s at most), and the
  page then reads the workspaces, reviews and merges again: in the e2e a merge queued through the
  tools did not show in the sidenav until then.
- **One ask at a time per caller**: a second one while the first waits is refused in words; a
  call whose caller hangs up drops its ask; `symbiote view` closing ends every held call with a
  503 the bridge passes on.
- **Codex's server is given at every resume Symbiote makes, and before its terminal joins**
  (`codexServer.load`): measured, a thread started without the server got it from a resume with
  `config`, and its tool ran; a resume without `config` kept it while the daemon held the thread.
  Restarting the person's daemon to see a thread it forgot was not done (the session's
  classifier refused it: other work could run there).
- **A wait costs tokens on Codex, not on Claude Code**: a 10-minute `wait` returned after 603 s on
  Claude Code with two model requests (17.6K tokens in all); on Codex after 604 s, with Codex
  checking the running call about every 30 s, about 430K input tokens (95 % cached). README says
  so; the prompt already has Scout wait only when asked.
- **`via` is shown** on History's mark ("Approved through Scout") and a workspace's Brief tab
  ("Started through Scout"), not on the review page's own verdict (the page's own Finish never
  goes through the tools).
- **`Asks.tsx` became `AskBar.tsx`**: beside `asks.ts` it was one name on macOS (`files.test.ts`).
- **Tokens of the tools**: Claude Code's first request read 8,015 tokens without Symbiote's server
  and 11,774 with its 23 tools (+3,759, under the planned 5K): the tools were kept as they are.

**Results.** Tests first, red for the right reason: `mcp.test.ts` (23), `mcp-bridge.test.ts` (7),
the server's MCP routes (4), `symbiote view`'s record and `symbiote mcp` (1), the gate (2), Codex's
per-thread configuration (1), Scout on both agents (4), `via` on verdicts and records (2), the
prompts, the viewer's asks (3) and `via` words (2). `pnpm check` 1,619 tests. e2e: `mcp.spec.ts`
2 of 2 (the spec as the MCP client: Scout reviews, approves and queues a merge on Confirms, a
decline does nothing, a restarted view on another port is found; an agent through `symbiote mcp`
starts a workspace); the full suite 240 of 242 before the last changes, its two failures fixed
or passing alone (`look.spec`'s Scout help text; `changes.spec` passed alone, 26 of 26 with
`mcp`, `look` and `shell`). Every e2e run with `WAYLAND_DISPLAY` unset: on this machine headless
Chromium drew no frame with it set, on every spec. Real runs in a trial repository made for MC1
(`/home/anton/projects/symbiote-trial`, a TypeScript cart with a bug, no remote), this branch's
`symbiote view`, Scout on Codex 0.163 (app server 0.164):

| Asked Scout | Its turn | What it did | Asks confirmed |
|---|---|---|---|
| What waits for me? Then start a fix with Codex, plan first, for this bug | 13 s | `overview`, `start_options`, `start_workspace` | the start |
| Show me its plan in three lines; if it tests first, tell it OK | 7 s | `thread`, `reply` (unasked) | none |
| It is ready: review it, tell me what changed; if nothing is risky, approve and queue its merge | 12 s | `review` (no findings), `finish_review`, `queue_merge` | the approval, the merge |
| It landed: clean it up | 5 s | `clean_workspace` | the clean-up |

The workspace's Codex agent planned at once and committed the fix with its test in 15 s after
the OK; the merge was checked (`npm test`, 157 ms) and landed on `main`. The verdict and the
workspace's record carry `via: "scout"`; the trial checkout's `git status` stayed empty. Scout's
thread over the four turns: 312.6K input tokens (284.5K cached, 91 %), 1,333 out, 14 model
requests. A declined start did nothing and the agent was told so.

Not verified: Scout on Claude Code with the real agent (its background sessions need the trial
folder trusted, which is the person's to do; its start's arguments are under test, and `claude
-p` with the same flags loaded the 23 tools and ran one, held 10 minutes); a woken Claude Code
session's new bridge reaching a restarted view (the bridge's re-read is under e2e); Codex's own
terminal joining Scout's thread after `load` with the real Codex; macOS and Windows;
`regression-check` (no analysis code changed: core gained types only).
