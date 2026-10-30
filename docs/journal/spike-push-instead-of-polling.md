# Journal: Spike — push instead of polling

[Index](../JOURNAL.md)

## Spike — push instead of polling: is it a noticeable improvement, and reliable? (2026-10-30, branch `spike/push-instead-of-polling`)

**The answer: push, yes.** With push, changes show in 30–220 ms. Polling shows them in
0.8–4.2 s (medians) while an agent works, and not at all while none works, asks excepted. On
this repository polling cost the person's Symbiote about 15 s of CPU a minute (40-minute
average) while agents worked: 17.5 s for each page that reads. With push nothing is read
unless something changed. Push is reliable in every case tried, with three conditions:

- one stream per browser, not per tab;
- the server reads Claude Code's own list while an agent is live, because hooks and the list
  disagree for minutes;
- the whole state on every connect, and a slow safety read.

The design and a milestone outline are at the end.

### What was tried

- **Read**: `useWorkspaces`, `useAsks`, the server's reads and its two streams, the hooks, the
  nexus's registry and probes; the plans and journals of V18, V21, V46, V48, MC1 and NX1.
- **Read-only on real use**: the person's running `symbiote view` on this repository (112
  workspace records, 105 reviews). I sampled its CPU from `/proc` for 40 minutes and fetched each
  read once. For about 2 hours, while 2–4 real agents worked, I asked
  `claude agents --json --all` every 250 ms and compared it with the hooks' writes to
  `symbiote/threads/`. Nothing was written there.
- **A prototype**, `spikes/push-instead-of-polling/push.patch`, in a copy of `main` in the job's
  folder; nothing in `packages/` changed:
  - `GET /api/events`: server-sent events with the whole state on connect (the five reads and
    the asks), then only the parts whose JSON changed.
  - Its triggers, picked by `SPIKE_PUSH`: a hook's ping; `fs.watch` on `symbiote/` and git's
    refs; merges and asks from memory; a safety read every 60 s.
  - The viewer reads the stream and falls back to polling when `/api/events` answers 404.
  - `push-shared.patch` makes it one stream per browser.
- **Fake agents** (the e2e harness): Playwright specs for cost, delays, tabs, merges and the
  reliability cases. Polling is the same build with `SPIKE_PUSH=off`.

### What polling costs on this repository

Each read, as the person's running Symbiote answered it (5 tries each):

| Read | Size | Time | CPU (own + git and `claude agents`) |
|---|---|---|---|
| `/api/reviews` | 50 KB | 1.25–1.38 s | about 1.5 s (0.5 s + 1.0 s) |
| `/api/workspaces` | 5.9 KB | 0.11–0.26 s | 0.18 s (0.05 s + 0.12 s) |
| `/api/nucleus`, `/api/scribe`, `/api/merges`, `/api/mcp/asks` | 0.3 KB, 0.3 KB, 13 B, 11 B | under 6 ms | — |
| `/api/status` (the nexus's probe, every 2 s) | 121 B | 11 ms | 13.5 ms |

- **While agents worked**, the view used **5.5 s of CPU a minute itself and 12 s in its
  children** for the first 11 minutes. That is 17.5 s a minute, 29 % of one core, and it
  matches one page reading every 5 s: 12 × (1.5 s + 0.18 s).
- **Over 40 minutes it averaged 14.9 s a minute**: 3.9–25.6 s in each 5-minute window, as pages
  stopped reading or a second one read too.
- **`/api/reviews` is 85 % of it.** It runs git for every ref of every review, one after
  another, although its answer only changes when a ref or a review file changes.
- **Live time**: the workspace agents alone were live 2.6–8.8 hours a day over the last 10 days.
  Nucleus, Scribe and open terminals count too, so this is a floor. Four live hours are about
  70 minutes of CPU a day, for each open page.
- **The nexus** itself uses 0.12 s of CPU a minute; its probes cost each view about 0.4 s.

### Cost per minute with fake agents (one tab, 60 s a phase)

The `callers` fixture with 3 workspaces. The fake Claude Code is a Node script: its children's
CPU is not the real one's.

| | Phase | Requests | KB | View CPU | Children CPU | React commits | Components rendered |
|---|---|---|---|---|---|---|---|
| Polling | an agent working | 90 | 97.7 | 430 ms | 670 ms | 16 | 1,186 |
| Polling | none working | 31 | 26.2 | 40 ms | 0 | 4 | 10 |
| Push | an agent working, nothing changing | 1 | 0.9 | 40 ms | 70 ms | 4 | 10 |
| Push | none working | 1 | 2.3 | 80 ms | 70 ms | 6 | 208 |

- **Polling's requests**: 12 reads a minute of each of the five while an agent works, and 30
  of `/api/mcp/asks` always. Push's one request a minute is `/api/usage`, the status bar's own
  read.
- **Renders**: every polling read replaces every object, so about 99 components render each
  time; push renders only when something changed.
- **Push's 208 renders while idle** are one change: the phase starts by setting the fake's
  state with no hook. Nothing triggered, so it went out with the 60 s safety read (see the
  real agents above).
- **With real agents, push recomputes about as often as polling reads.** The hooks wrote 18 times
  a minute. Push saves the reviews read, the idle reads and the unchanged renders, not the
  workspaces read.

### Delay until a change shows (fake agents, the page's own clock)

`push.spec.ts`: each change at a random moment, 8 trials with an agent working and 4 with none;
the median, then the longest. "Never" is not shown in 20 s.

| Change | Agent working? | Polling | Push (watch + ping) | Ping only | Watch only |
|---|---|---|---|---|---|
| An agent's state: it waits on a permission | yes | 2.6 s (4.8 s) | 154 ms (216 ms) | 154 ms | 151 ms |
| | no | never, 0 of 4 | 124 ms (154 ms) | 154 ms | 150 ms |
| The agent's commit | yes | 1.9 s (4.5 s) | 160 ms (176 ms) | 164 ms | 148 ms |
| | no | never, 0 of 4 | 148 ms (173 ms) | 163 ms | 144 ms |
| The person's commit, in a terminal | yes | 4.2 s (5.0 s) | 144 ms (187 ms) | 2 of 8 | 149 ms |
| | no | never, 0 of 4 | 118 ms (185 ms) | 3 of 4 | 138 ms |
| A review written by another process | yes | 2.3 s (4.0 s) | 132 ms (155 ms) | never, 0 of 8 | 134 ms |
| | no | never, 0 of 4 | 107 ms (115 ms) | 2 of 4, at 18–20 s | 133 ms |
| An ask from an agent through `symbiote mcp` | yes | 0.8 s (1.7 s) | 61 ms (94 ms) | 84 ms | 58 ms |
| | no | 1.6 s (1.9 s) | 54 ms (66 ms) | 78 ms | 56 ms |

- **Polling** reads every 5 s while an agent works, and an agent's state also waits for the 2 s
  cache of Claude Code's list. With no agent working it reads nothing but the asks: the other
  changes show when the page is next focused or shown.
- **Push's 150 ms** for an agent's change is mostly the hook's own process (the fake runs it as
  Claude Code does), then a 30 ms wait for more triggers and the workspaces' recompute. An ask
  comes from memory: 54–61 ms.
- **Ping only** misses what no hook writes. The person's commits showed only when another
  trigger's read happened to follow, and reviews from another process only at the 60 s safety
  read.
- **Watch only** was as fast as both together, for every change: the hooks' own writes to the
  threads and the activity are file events.

### A merge's steps

`merge.spec.ts`: an approved branch merged with a 4 s check. Each step's time is the server's
own log line (`merge <state>`). Steps of a few milliseconds (`merging`, `ready`) were seen by
neither.

| Step | Polling, the tab that clicked | Polling, another window | Push, either |
|---|---|---|---|
| checking | 1.5 s | not seen in 20 s | 31 ms |
| landed | 0.56 s | not seen in 20 s | 51 ms |

The other window reads nothing while no agent works. Today it learns of a merge only when
focused.

### A hook's time with the ping

`hook-time.mjs`: 60 runs of the built `agent-hook.js` per case, a Stop event, against a copy of
this repository's 112 workspace records and a stand-in view.

| Ping | View running | View hung (SIGSTOP) | No view | Stale record |
|---|---|---|---|---|
| none (`main`) | 24–25 ms | 25 ms | 26 ms | 25 ms |
| HTTP, answer awaited (150 ms cap) | 43 ms | 193 ms | 28 ms | 42 ms |
| HTTP, answer not awaited | 43 ms | 44 ms | 28 ms | 43 ms |
| UDP datagram | 28 ms | 27 ms | 26 ms | 28 ms |
| Bare TCP POST, answer awaited | 28 ms | 179 ms | 26 ms | 28 ms |
| **Bare TCP POST, done when written** | **28 ms** | **28 ms** | **25 ms** | **28 ms** |

Medians. Every run exited 0. Every ping to a running view arrived: 60 of 60 in each variant.
`node:http` alone is most of HTTP's 17 ms: the same request written on a bare socket costs
3 ms.

### File watching

`fswatch.mjs`, `fswatch-rename.mjs` and `fswatch-plain.mjs`, Node 26:

| | WSL2's own disk (ext4) | `/mnt/c` (9p) |
|---|---|---|
| An append: from the write to the event | 0.13 ms median, 0.30 ms p99, 0 of 100 missed | **no event, 100 of 100 missed** |
| A file in a folder made after the watch started | seen | not seen |
| Writes by rename to one file (git's refs, Symbiote's records), recursive watch | the 1st and 2nd seen, **the 3rd missed** | not seen |
| The same, one plain watch per folder | 10 of 10 seen | — |
| A commit in a worktree (`refs/heads/`), `pack-refs`, a commit after it | all seen | not seen |
| A watch on a folder not there yet | recursive: no error, never fires; plain: throws `ENOENT` | — |
| Writes from Windows (`cmd.exe`) | — | not seen |
| Events in all | — | **0** |

- **Watch budget**: main's `symbiote/` has 133 folders, against `max_user_watches` 1,048,576 and
  `max_user_instances` 8,192, of which this user had 36 in use.
- **Not checked**: macOS (FSEvents) and native Windows (ReadDirectoryChangesW).

### Real agents: the hooks against Claude Code's list

Symbiote takes an agent's state from `claude agents --json --all` (decision 99).

- **A start or a prompt after idle**: the hook's write and the list saying busy fell within
  0.1–0.3 s, 7 of 7.
- **A Stop**: the report and the list saying idle fell within 0.1–0.3 s, 7 of 11.
- **In the other 4 Stops the list stayed busy**: for 39 s, 232 s and 373 s until the agent's
  next turn, and for at least 200 s to the end of the watch. In three of them Claude Code's own
  "waiting for your input" notice came 60 s after the report. The agents' prompts show they ran
  background tasks. For those minutes Symbiote said "working" while the agent waited on the
  person, with polling as with push. That is a gap in decision 99's source, not push's.
- **Rate**: with three agents working, the hooks wrote 18.3 times a minute, about 6 per agent.
  Grouped into windows of 1 s that is 14 recomputes a minute; of 2 s, 11.
- **What a tool's start or end changes**: a working agent's card, not Claude Code's state. A
  recompute for one needs no `claude agents` run.

### Reliability cases

| Case | Polling | Push |
|---|---|---|
| A burst: 120 hook events in 1.2 s, ending on a question | shown 0.8 s after the last hook; equal to a fresh read | shown 80 ms after; 577 triggers made 26 reads and 8 pushes; equal to a fresh read |
| The stream cut by the server, then a change (5 times) | — | shown 1.1 s after the cut each time (`retry: 1000`); the whole state sent again |
| The server stopped 20 s (SIGSTOP), a change meanwhile | shown 81 ms after it resumed | 95 ms |
| A restart on the same port (down 3.4 s) | shown 3.7 s after it was back, at the next read | 0.75 s; the whole state sent again |
| A restart on a new port | The nexus loads the new address into the tab's frame (`frame.src`); a browser tab or the app's window stays on the old port | the same |
| A tab really hidden 40 s, an agent working (headed Chromium behind another tab, raw CDP) | nothing read in 40 s | the change in 122 ms |
| 3 frames of one view, 2 hidden as the nexus hides its tabs, an agent working | hidden frames say `visible`: 91 requests a minute each | 1 a minute each, 4 streams |
| 1–8 tabs of one view in one browser | every request answered in 18–22 ms | **one stream per tab: the 6th tab's request stalled 8 s, and the 7th tab never loaded** |
| The same, one stream per browser (`push-shared.patch`) | — | 8 tabs, 1 stream, requests in 24–43 ms; a change in all 8 in 239–252 ms; once the stream's tab closed, another took it, and all 7 got the next change in 134 ms |
| Windows' `curl.exe` through WSL2's localhost relay | — | each event within 1 ms of WSL's own client, 41–46 ms after the write |
| The server's own stop | — | the prototype's UDP socket kept the process alive after SIGINT and SIGTERM. Fixed: every listener must close with the server |
| A frozen page; the app's window hidden | not reproduced | not reproduced |

On the last row: `Page.setWebLifecycleState` left the page's timer ticking (200 ticks in 20 s),
and Playwright reports a hidden app window, like its own pages, as visible.

**Learned**:
- **Chrome holds at most 6 connections per host, and an `EventSource` keeps one.** One stream
  per tab blocks a view at its 6th tab. Terminals (`AgentTerminal.tsx`) and merge logs
  (`MergeLog.tsx`) already hold one each today. Six of them open across tabs of one view would
  stall it with polling too (inferred from the rule measured, not tried).
- **Node's recursive `fs.watch` on Linux is not usable here** (Node 26):
  - it missed the 3rd write by rename to the same file, which is how git writes a ref and how
    Symbiote writes records;
  - on a folder not there yet it threw nothing and never fired.

  One plain watch per folder saw 10 of 10 renames and throws `ENOENT` on a missing folder.
- **`/mnt/c` (9p under WSL2) gives no file events at all**, from WSL or from Windows.
- **Agents start with a clean environment**: the hook never saw `SYMBIOTE_CACHE_DIR`, so it could
  not find the view's record. The cache folder must be on the hook's command line.
- **Claude Code's list can stay busy for minutes after a Stop hook** (4 of 11 Stops, 39–373 s):
  the state source and the hooks disagree. A server that only reacts to hooks misses the
  list's change.
- **Hidden iframes say `visible`**: each of the nexus's hidden tabs polls as a shown one does.
- **`node:http` takes about 15 ms to load in a hook**; the same POST on a bare socket costs 3 ms.
- **Playwright keeps every page visible**, Electron's included. A hidden tab needed Chromium
  started by hand and raw CDP (`hidden-tab.mjs`).
- **My own traps, for the next spike**:
  - the row's text for a hook's question is "Permission to run …", not "Waiting:";
  - a delay test that changes something right after a read measures the whole polling period;
  - `pkill -f` killed my own shell twice.

### Recommendation: push, with one stream per browser

Polling's delay alone did not argue for push: decision 374 weighed a median 2.1 min wait
against a 5 s read. The cost was not measured then. It is 17.5 s of CPU a minute per reading page on
this repository while agents work, and a page shows nothing that changes while none works. Push
fixes both. The design:

1. **One server-sent stream**, `GET /api/events`. A GET passes the server's Host and
   cross-site checks like every read, and writes stay POSTs (decision 112's rule). No WebSocket:
   no measurement needed one.
2. **One stream per browser.** The tab holding a Web Lock named for the server's address opens
   it and relays over a BroadcastChannel. A tab that joins asks the holder for the whole state.
   When the holder closes, the next waiting tab takes the lock. Without a lock or a
   BroadcastChannel, each tab opens its own stream; when the stream answers 404 (an older
   server), it polls as today.
3. **The whole state on every connect**, then only the parts whose JSON changed; `retry: 1000`,
   a keep-alive comment every 25 s.
4. **Triggers on the server**:
   - **from memory**, at once: merges, asks, and the server's own writes (a review finished, a
     workspace started);
   - **from files**: one plain watch per folder over `symbiote/`, git's `refs/heads/` and
     `packed-refs`, adding folders as they appear;
   - **from hooks**: a bare TCP POST to `/api/events/ping`, done once written. The hook finds
     the view in the registry, through the cache folder given on its command line. On a disk
     with file events, watching alone was as fast for every change; the ping is how a
     repository on `/mnt/c` hears its agents;
   - **Claude Code's list**, read on the server every 5 s while an agent is live. It is pushed
     only when it changes, and costs about 1.5 s of CPU a minute (0.125 s a read);
   - **a safety read** of everything every 60 s while a page is connected.
5. **Recompute only the part a trigger touches**, at most once a second each:
   - a tool's start or end recomputes the workspaces from files, with no `claude agents` run;
   - a ref or a review file recomputes the reviews;
   - cache `/api/reviews` by the refs' tips and the review files: that alone is 85 % of
     today's cost, and is worth doing even before push.
6. **In the viewer**, unchanged parts keep their identity, and each reader subscribes to the
   part it shows.
7. **The nexus** keeps its 2 s read: 0.12 s of CPU a minute, 0.4 s for each view. Pushing
   `/api/symbiotes` from a watch on `<cache>/running/` can come later.
8. **Codex and Hermes** run no hooks. Codex's app server sends events (V27a) that can trigger;
   the server's slow read covers Hermes.

### Milestone outline

V83 and decisions from 625 were free on every branch on 2026-10-30; check again at plan time.

- **V83a — the stream.**
  - `/api/events` with the whole state on connect, the in-memory triggers, the safety read, and
    `/api/reviews` cached by refs.
  - The viewer reads the stream, keeps unchanged parts, and polls when it gets a 404 or
    `?poll`.
  - e2e: every change kind shown in under 500 ms; polling's specs still pass with `?poll`.
- **V83b — one stream per browser.** The lock and channel relay, and a holder's heartbeat on the
  channel: a tab that hears nothing for 30 s opens its own stream (a frozen holder). e2e: 8 tabs,
  the holder closing, a terminal open in each.
- **V83c — changes from outside.**
  - The per-folder watcher.
  - The hooks' ping, with the cache folder written into `claude-settings.json`'s command.
  - The server's read of Claude Code's list while an agent is live.
  - Codex's app server events.
  - e2e: a commit from a terminal, a review from another process, a state change with no hook.
- **V83d — measured and written down.** On this repository:
  - CPU a minute while agents work (from 14.9 s on average, 17.5 s a page; target under 3 s);
  - requests a minute per tab (from 90; target about 0);
  - the delays.

  Then the docs and decisions.

**Risks**:
- A stream that goes quiet without closing (sleep, a relay): the keep-alive, the safety read,
  and "Symbiote did not answer" after 60 s with no keep-alive.
- A frozen tab holding the lock: the heartbeat above.
- Watch limits on a very large `symbiote/`.
- `/mnt/c` and other disks without file events: the hooks' ping and the safety read only.

### Not checked

- macOS (FSEvents) and native Windows file watching.
- A real laptop sleep.
- Chrome freezing a background tab (Energy Saver, Memory Saver).
- The app's window hidden or minimized.
- Firefox and Safari.
- A repository on `/mnt/c` end to end (only `fs.watch` was tried there).
- Codex and Hermes agents.
- The nexus with several views, each with a busy agent (one view in 3 frames was measured).
- Terminals and merge logs open in several tabs, against the 6-connection rule.
