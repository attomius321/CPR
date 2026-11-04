# V94 — Push instead of polling: one server-sent stream per browser

[Index](../PLAN.md) · [Journal](../journal/v94-push-not-polling.md)

**Status:** merged into `main` on 2026-11-04; built (3–4 November 2026), on branch `feature/v94-push-not-polling` (the workspace's,
from `main` at `45424c6`); the person's OK on 3 November: terminals on the shared stream, numbers
on a copy of this repository, Hermes at the safety read only.

**Problem** (the brief: "the page learns of every change through one server-sent stream, `GET
/api/events`, instead of polling"). The spike ([journal](../journal/spike-push-instead-of-polling.md),
2026-10-30) measured polling: a change shows 0.8–4.2 s late (medians) while an agent works, and not
at all while none works until the page is focused; each page that reads costs `symbiote view`
17.5 s of CPU a minute on this repository, 85 % of it `/api/reviews`. A prototype showed changes in
30–220 ms and read nothing unless something changed. Since then the records grew. Measured on
3 November against the person's running view (read-only GETs; CPU from `/proc`):

| | Spike (10-30) | Today |
|---|---|---|
| `/api/reviews` | 50 KB, 1.25–1.38 s | 55 KB, 1.7–2.8 s (141 reviews, 14 refs still there) |
| `/api/workspaces` | 5.9 KB, 0.11–0.26 s | 11 KB, 0.23–0.37 s (3 open of 156 records) |
| merges, nucleus, scribe, asks | under 6 ms | under 14 ms |
| The view's CPU while agents work | 17.5 s a minute per reading page | 20.4 s a minute (7.9 s its own, 12.6 s its children; 2 minutes, 2 agents) |
| Folders under `symbiote/` | 133 | 208 |

What causes it:
- Every page reads the five shell reads every 5 s while anything is live (decisions 99, 161, 374),
  and the asks every 2 s always; each read makes new objects, so every reader keyed on them reads
  its own data again (a thread, the changes, the Hive detail, the activity, the findings).
- `/api/reviews` runs git for every ref of every review and twice for every approved verdict
  (`isCommit`, `isAncestor`), one after another, on every read; its answer changes only when a ref
  or a review file does.
- While nothing is live, nothing is read: a change made then shows only on focus.

**Goal**: every change kind shows in under 500 ms, with an agent working and with none, through
one stream per browser; `symbiote view` reads only when something may have changed. What each read
returns does not change: the stream carries today's JSON. A page served by an older `symbiote view`
(no `/api/events`), or opened with `?poll`, polls exactly as today. Push never starts a turn
(decision 364).

## What polls today (main at 45424c6)

| Reader | Reads | When | Under push |
|---|---|---|---|
| `useWorkspaces` (the sidenav, every page) | `/api/workspaces`, `/api/reviews`, `/api/merges`, `/api/nucleus`, `/api/scribe` | on mount, focus and shown; every 5 s while an agent works or waits, Hive is at work, Nucleus or Scribe is busy, a terminal is open or a read failed; every 1.5 s while a merge runs | the stream's parts |
| `useAsks` | `/api/mcp/asks` | every 2 s, always (the app: hidden too) | the `asks` part |
| `useFindings` (V93) | `/api/workspaces/findings` | each list read (`readAt`) | each change of `list` |
| Thread, Changes, Hive's Run tab, Activity, MergeControl (`version={list}`) | each its own | each new `list` object: every read | each change of `list` (its object kept otherwise) |
| `NucleusActivity` | `/api/nucleus/activity` | each new `nucleus` object | each change of `nucleus` |
| `useDay` (the Overview, V91) | `/api/workspaces/day` | when `dayKey` moves | unchanged |
| `useBranchReviews` (History) | `/api/reviews` | on mount and focus | the `reviews` part |
| The Skills page | `/api/skills` | every 5 s while Scribe writes, on focus | unchanged: skills are not under `symbiote/` |
| The status bar, `useUsage` | `/api/status`, `/api/usage` | every 60 s and on focus | unchanged: 2 requests a minute |
| `useDiffGraph` | an analysis's progress | every 500 ms while it runs | unchanged |
| Terminals, merge logs, Hive's logs | an `EventSource` each | while shown | terminals on the shared stream (V94b); logs unchanged |

On the server, Hive's runner ticks every 2 s (10 s while off), Codex's activity is read every 2 s
while it works, and MCP's `wait` reads every 2 s: they drive work, not a page, and stay.

## V94a — the stream

**Server**, `packages/cli/src/events.ts`:
- `GET /api/events` (the Host and same-site checks of every read): `retry: 1000`, then an `id`
  event (the stream's ID, for V94b), then `state` with every part, then `change` with only the
  parts whose JSON text changed. An `alive` event every 25 s: an event, not a comment, so a page
  tells a silent stream from a quiet one.
- **Parts**: `workspaces`, `reviews`, `merges`, `nucleus`, `scribe`, `asks` — today's reads, as
  they answer.
- **Reads**: a part is read 30 ms after the first trigger, then at most once a second; a part read
  meanwhile is read again after. A safety read of every part every 60 s while a page is connected;
  with none connected, nothing is read.
- **Triggers from memory**: the merge queue written, an ask held or settled, Hive's records
  written, and every write request answered below 400 (`/api/workspaces…`, `/api/merges…`,
  `/api/state/…`, `/api/reviews`, `/api/nucleus…`, `/api/scribe…`, `/api/mcp…`, `/api/hive…`),
  each mapped to the parts it can change. A terminal's keys and size are not writes of records.
- `close()` ends every stream, timer and (V94c) watcher: a listener left open keeps the process
  after SIGINT (the spike's UDP socket).

**`/api/reviews` cached** (`reviews.ts`), for every reader, polling's too: each review's summary
kept under a key of its file's text, its refs' tips, the tips it is counted against, its
workspace's `against`, and its verdict's target's tips. A read is then one `for-each-ref`, the
files, and git only for the reviews whose key changed.

**Viewer**, `packages/viewer/src/shell/events.ts`: one store for the page. A part whose JSON did
not change keeps its object, so React draws nothing for it and the readers keyed on it read
nothing. `useWorkspaces` and `useAsks` take their parts from it; their timers, focus reads and
`holdReads` do nothing while the stream is up. A page's own action still reads once through
`reloadWorkspaces` (the caller waits on what it reads), its parts kept where their JSON did not
change. While the stream reconnects, the sidenav says "Not updated since …" (V48). On a 404, with
`?poll`, or without `EventSource`, the page polls exactly as today.

## V94b — one stream per browser

Chrome holds 6 connections per host and an `EventSource` keeps one (the spike: one stream per tab
stalled the 6th tab; the 7th never loaded).

- The tab holding the Web Lock `symbiote-events:<host>` opens the stream and relays each event on
  the `BroadcastChannel` of the same name. A tab that joins says `hello`; the holder answers with
  the whole state. When the holder closes, the next tab waiting for the lock takes it.
- The holder's heartbeat on the channel every 10 s; a tab that hears nothing for 30 s (a frozen
  holder) opens its own stream, and keeps waiting for the lock.
- Without locks or a channel, each tab opens its own stream.
- **Terminals ride the shared stream** (the person's choice): 8 tabs each with a terminal would
  otherwise hold 9 connections. A tab subscribes a terminal with `POST /api/events/listen
  { stream, terminal }`; the server replays what it kept, as `/api/terminals/<id>` does, then sends
  `out` and `exit` events for it, relayed to the tab that listens. When the holder changes, each
  tab subscribes again; the terminal resets and draws the replay, as it does after a reconnect
  today. Without a shared stream the terminal opens its own `EventSource`, as today.
- Merge logs and Hive's logs keep their own streams: each is open only while its panel shows.

## V94c — changes from outside

- **Files** (`events-watch.ts`): one plain `fs.watch` per folder over the records' folder
  (`symbiote/`, or the cache's when records live there), git's `refs/heads/` and `refs/remotes/`
  (reviews list remote refs too), and `packed-refs`; folders added as they appear, the parent
  watched for a root not there yet; `*.lock` ignored. Node's recursive watch on Linux missed the
  third write by rename to one file and never fired on a folder made later (the spike).
  What a path touches: `threads/` the workspaces with Claude Code's list read anew (again 0.5 s
  later: the list follows a hook by 0.1–0.3 s); `activity/` the workspaces with the last list;
  `reviews/` the reviews and workspaces; `workspaces/` and `hive/` the workspaces and reviews;
  `nucleus*` Nucleus; `scribe*` Scribe; a ref the workspaces and reviews.
- **The hooks' ping** (`events-ping.ts`, Node's own modules, in the hook's copy, decision 721):
  after its write, the hook writes `POST /api/events/ping {branch, kind}` on a bare TCP socket to
  each view of its records' folder and is done once it is written, 150 ms at most (`node:http`
  costs 15 ms to load; a hung view cost an awaited ping 179–193 ms). The cache folder is on the
  hook's command line (`--cache=<dir>`): agents start with a clean environment. The view is found
  in `<cache>/running/` by a new optional field, `symbiote`, the records' folder it serves (a view
  in a worktree serves the main checkout's). On `/mnt/c` (no file events at all) the ping, the
  live read and the safety read are what remain.
- **Claude Code's list** read on the server every 5 s while an agent (a workspace's, Nucleus,
  Scribe) is live and a page is connected; a list that changed recomputes the parts that depend on
  it. It stayed busy 39–373 s after a Stop hook in 4 of 11 Stops (the spike): reacting to hooks
  alone misses that.
- **Codex's app server**: measured first. If the daemon tells a connection subscribed to no
  thread's deltas when a thread's status changes (decision 155 keeps none subscribed), Symbiote
  listens; else Codex's workspaces get the same 5 s live read.
- Hermes: the triggers and the safety read only (the person's choice): a Hermes agent's change may
  show up to 60 s late, where polling read every 5 s while it was live.

## V94d — measured and written down

- On a copy of this repository (a clone at `main` and a copy of `symbiote/`), `main` and the branch
  with fake agents writing hooks at the real rate (18 a minute): CPU a minute (from 20.4 s; under
  3 s), requests a minute per tab (from about 90; 2: the status bar's), renders, and the delays.
  The person's own view is not run with the branch's build: it would write
  `symbiote/claude-settings.json`. Its after-number comes when the person runs the branch.
- `docs/reference/commands.md`: live updates under `symbiote view` — the stream, `?poll`, file
  watching, the hooks' ping, `/mnt/c`.

## Verification

1. **Unit tests first** (red before):
   - cli: the stream (whole state; a change only when its JSON changed; one read a second; the
     safety read only while connected; `alive`); an idle connected server reads nothing for two
     minutes but its safety reads (no read that writes a watched file and wakes itself); `close()`
     leaves no watcher or socket (`process.getActiveResourcesInfo()`); the watch (three renames to
     one file, a folder made later, a root made later); the reviews cache (git calls counted: none
     when nothing changed, one review's when its ref moved); the ping (no view, a hung view, under
     its cap); the hook's arguments, old and new; the settings' command with the cache folder
     (Windows quoting too); the registry's `symbiote`.
   - viewer: parts keep their objects; the relay, a joining tab, the holder's handover, the 30 s
     silence (fake `EventSource`, locks and `BroadcastChannel`).
2. **e2e** (from the spike's specs): every change kind under 500 ms, with an agent working and with
   none — an agent's state, its commit, the person's commit in a terminal, a review written by
   another process, an ask, a merge's steps; 8 tabs on one stream, the holder closed, a terminal
   in each tab; the stream cut, the server stopped and restarted: the whole state again, nothing
   missed. The specs that fulfil the polled reads with `page.route` open with `?poll`; the whole
   suite also once with `?poll`.
3. `pnpm check`, `pnpm build`, `pnpm test:e2e`; `viewer-check` on a real graph.
4. **Cost**: V94d's table.

**Risks**

| Risk | Mitigation |
|---|---|
| A stream quiet without closing (sleep, a relay) | `alive` every 25 s; with none for 60 s the page says Symbiote did not answer and opens it again |
| A frozen tab holding the lock | the holder's heartbeat; 30 s of silence opens a tab's own stream |
| A read that writes a file it watches | the idle test above; `claude-settings.json` written only when its text differs |
| Under 3 s a minute is tight: the live read alone is about 1.5 s | measured in V94a; if missed, a hook's write recomputes only its workspace's row |
| Disks without file events (`/mnt/c`); macOS and Windows watching, not checked | the ping, the live read, the safety read |
| Merge and Hive logs still hold a connection each while shown | open only while their panel shows; measured with the tabs spec |
| Changes nothing announces (an edit in an editor, no hook) | the next trigger or the safety read; polling read them only while an agent was live |

**Order**: V94a, V94b, V94c, V94d, each committed and pushed in turn.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V94a | The stream | `/api/events`, triggers from memory and writes, the safety read, `/api/reviews` cached; the viewer's store; polling on 404 or `?poll` |
| V94b | One stream per browser | the lock and channel relay, heartbeat, terminals on the stream |
| V94c | Changes from outside | per-folder watches, the hooks' ping, Claude Code's list on the server, Codex's app server |
| V94d | Measured and written down | CPU, requests and delays against `main`; the docs |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 897 | How pages learn of changes | **One server-sent stream, `GET /api/events`: the whole state on connect, then the parts that changed; `retry: 1000`, an `alive` event every 25 s** (supersedes 374) | Polling cost 17.5–20.4 s of CPU a minute per page and showed nothing while no agent worked; the prototype showed changes in 30–220 ms |
| 898 | What the stream carries | **Today's six reads as they answer; a part sent only when its JSON text changed** | No read changes; unchanged parts draw nothing |
| 899 | When the server reads | **A part 30 ms after a trigger, then at most every 250 ms; every part every 60 s while a page is connected; nothing with none** | A burst of 120 hooks made 26 reads (the spike); one read a second made a change wait up to a second (801 ms in V94c's e2e); the safety read covers what no trigger sees |
| 900 | `/api/reviews`'s cost | **Each review's summary cached by its file and the tips it depends on, for every reader** | 85 % of polling's cost; its answer changes only with a ref or a review file |
| 901 | The page's readers | **A part that did not change keeps its object, and the readers keyed on it read nothing; polling as today on a 404, `?poll` or no `EventSource`** | Every polling read replaced every object (99 components drawn a read) |
| 902 | Tabs | **One stream per browser: the Web Lock's holder relays on a `BroadcastChannel`; its heartbeat every 10 s; a tab that hears nothing for 30 s opens its own** | One stream per tab stalled the 6th tab |
| 903 | Terminals | **Their output on the browser's one stream, a terminal subscribed by `POST /api/events/listen`; merge and Hive logs keep their own** | 8 tabs each with a terminal would hold 9 connections (the person's choice) |
| 904 | Files | **One plain `fs.watch` per folder over the records' folder, `refs/heads/`, `refs/remotes/` and `packed-refs`, folders added as they appear** | The recursive watch missed the third rename and folders made later (the spike) |
| 905 | Hooks | **A bare TCP POST to `/api/events/ping`, done once written, 150 ms at most; the cache folder on the hook's command line; the registry's `symbiote` names the folder a view serves** | 3 ms against `node:http`'s 15; agents start with a clean environment |
| 906 | Agents' state | **Claude Code's list read by the server every 5 s while a Claude agent is live, or a terminal is shown and 10 s after, and a page is connected; at once on a thread's or Nucleus's hook entry; Codex's app server heard on one quiet connection while a Codex agent is listed** (replaces 99's reads from the page, and 161) | The list stayed busy 39–373 s after a Stop in 4 of 11; Scribe's turn records nothing; a connection that started no thread hears only status changes (V27a) |
| 907 | Turns | **Push only reads; it never starts a turn** (364 holds) | The brief; NU3 is a standing watch |

**Not in V94 (later)**: the nexus's 2 s read of `/api/symbiotes` (0.12 s of CPU a minute); starting
turns on events (NU3); Hermes beyond the safety read; a WebSocket; merge and Hive logs on the
shared stream; `/api/status` and `/api/usage` on the stream.

## As built (V94)

- **One read every 250 ms, not one a second** (decision 899): behind any other read (the 5 s live
  read, a tool's hook), a change waited up to a second: 801 ms for an agent's commit in the first
  e2e run. A burst of hooks still makes at most 4 reads a second of a part.
- **On a thread's entry, Claude Code's list first, then the workspaces with it**: read side by
  side, the workspaces took the list from its 2 s cache and the state needed a second read (an
  agent asking showed in 460 ms; 108–111 ms after).
- **This process's writes are news without the watch**: `writeFileWhole` tells its listeners the
  path, so records, the merge queue and Hive's writes reach the stream on `/mnt/c` too.
- **A page counts as listening while its first state is read**: a trigger meanwhile was dropped
  (an ask held as a page opened).
- **Terminals: 4 of the 8 tabs.** Symbiote opens at most 4 terminals (V21, 140 MB each); the e2e
  shows the workspace's terminal in 4 tabs and other pages in 4, on one stream.
- **A shell's tab reads what runs in it when its output stops for 500 ms**: polling made a new
  list every 5 s while a terminal was open, and that was what renamed the tab.
- **Codex: one quiet connection, not a 5 s read** (decision 906's Codex part): V27a had probed
  that a connection that started no thread hears only status changes. `CodexServer.watch`, held
  while a Codex agent is listed at all (a turn typed in the person's own terminal starts an idle
  one) and across a page's reload; each time it opens, the Codex parts are read once. A daemon
  that does not answer leaves its parts to a read every 5 s.
- **`touched`: the files a page reads beside the parts.** A thread, an activity, a Hive record or
  Nucleus's activity can change while the part's JSON does not (a Confirm in Nucleus's activity),
  and polling's new objects every 5 s had hidden that. The stream names each such file when it
  changes, and the thread, activity, Hive detail and Nucleus activity read again on it.
- **Decision 161 on the server**: while a terminal is shown, and 10 s after, Claude Code's list is
  read every 5 s, once for the server instead of once per page: a turn typed there may start with
  no hook the page hears (Scribe records none).
- **A page's first state takes a fresh list** when a Claude agent is listed, and Nucleus's activity
  written reads the list first, as a thread's entry does.
- **A holder with no stream says so to a tab that joins**: it answered `hello` only while streaming,
  and the new tab waited 30 s for its own stream to fail.
- **`SYMBIOTE_EVENTS=off`**, not planned: no stream, the pages poll as before. The e2e suite runs
  under it once to keep polling working (`docs/reference/configuration.md`).
- **`?poll` is read as the page loads**: the shell moves `/` to `/overview` and the query went with
  it before the store asked.
- **Two e2e specs changed with the timing**: the merge page shows Files first once a merge has a
  resolution, and push brings that state before the log's next lines, so the spec opens the Log
  tab; a model appended to a transcript shows with the next hook, as a real answer comes with one.
  The spec of a failed read (V48) runs with `?poll`; the stream's own loss is `events.spec.ts`'s.
- **Each workspace's commits counted again only when what they come from moved** (V94d): a key of
  its base, `from`, `against`, its tip and every ref's tip. Each read of the list had run 4–5 git
  commands a workspace for the same answer; exact, so polling's reads get it too.
- **The page's stream's list is kept 6 s, any other 2 s** (`claude agents`, V94d): the workspaces'
  reads between two live reads ran it again, 19 a minute where 12 were the live read's.
- **The list's first read is news too** (but a page's opening's, whose parts are read just after): it
  only set a baseline, and Scribe working right after the person's prompt never showed.
- **Not done**: keeping a Claude workspace's `git status` until its hooks write (another 0.6 s a
  minute here). It would show an edit nothing records up to a minute late to every reader, polling
  pages and the MCP's tools included: the brief keeps what each read returns.

**Results.** Measured on a copy of this repository (a clone and a copy of `symbiote/`: 156
workspace records, 3 open with Claude agents, 141 reviews, Hive off), its `symbiote view` started
from each build, one headless page on the Overview, agent hooks written at the spike's rate of 18
a minute (15 tools, 3 notices) by each build's own `agent-hook.js` with a clean environment, real
`claude agents`; the view's CPU from `/proc` after 30 s; 5 minutes each
(`spikes/push-instead-of-polling/v94/measure.mjs`, results beside it):

| Build | CPU a minute | Its own | Its children | Requests a minute (one page) |
|---|---|---|---|---|
| `main` (45424c6), polling | 15.8 s | 6.3 s | 9.5 s | 95.9 |
| V94, push | **3.1 s** (3.0 s in a second, 2-minute run) | 0.9 s | 2.2 s | **8.4** (6.0 in the second) |
| V94, the same page with `?poll` | 3.5 s | 1.3 s | 2.2 s | 112.3 |

- The target was under 3 s: 3.0–3.1 s. About 1.5 s of it is Claude Code's list, read every 5 s
  while an agent is live (12 runs a minute at about 0.125 s, decision 906), the rest `git status`
  in each open worktree at each read of the list and the view's own work.
- Push's requests: none of the polled reads; the findings (4 a minute, read again when the list
  changes), the usage and the status bar's status (1 each). `main`: the asks 30 a minute, each of
  the five reads 9.5, the findings 19.
- `?poll` on V94 costs 3.5 s: the caches of the reviews and of each workspace's commits are most of
  the saving, and they serve an older page too. Push saves 0.4 s more, and 104 requests a minute.
- `main`'s 15.8 s is in line with the person's own view: 14.9 s on average and 17.5 s a page in the
  spike, 20.4 s in 2 minutes on 3 November with 2 agents working (pages open there: not known).

Delays, e2e (`events.spec.ts`, the page's clock against the test's, fake agents), with an agent
working / with none:

| Change | Delay |
|---|---|
| An agent asks (its permission hook) | 108 / 111 ms |
| Its commit, with its tool's hook | 74 / 74 ms |
| The person's commit, in a terminal (git's ref alone) | 91 / 90 ms |
| A review written by another process | 70 / 69 ms |
| An ask through `symbiote mcp` | 67 / 44 ms |
| A merge's steps: checking, landed (after the server's own line) | 240 ms, 39 ms |
| A change while the server was stopped 3 s, after it went on | 78 ms |
| A change while it was down, restarted on its port, after it was up | 829 ms (`retry: 1000`) |

Polling, as the spike measured: 0.8–4.2 s (medians) while an agent works, never while none does.

- 8 tabs of one view: one stream, every read answered in under 2 s, the holder closed and another
  took the stream, the terminals in 4 tabs (V21's most) typed into after.
- `pnpm check`: 3152 tests. `pnpm test:e2e` with push: 430 of 431 (the Split terminal test once,
  green alone and under load); with `SYMBIOTE_EVENTS=off`: 427, the stream's 4 skipped.
- `viewer-check`, Bitwarden `737ee3f` with the Angular plugin, 3 rounds each, the branch's build
  against `main`'s: first paint 296–316 ms (300–322), select 102–104 ms (88–104), mark reviewed
  34 ms (33–35), pan 62–63 fps (63), 3,124 page elements each, no page errors.
- Not measured: the person's own view running this build (it would write
  `symbiote/claude-settings.json`); macOS and Windows file events; a repository on `/mnt/c` end to
  end; a real laptop sleep; Firefox and Safari; Codex against a real daemon (V27a's probe and the
  fake app server only).
