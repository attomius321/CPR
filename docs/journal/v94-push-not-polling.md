# Journal: V94 — Push instead of polling: one server-sent stream per browser

[Index](../JOURNAL.md) · [Plan](../plan/v94-push-not-polling.md)

## V94 spike — what polling costs now, and every reader that polls (2026-11-03, branch `feature/v94-push-not-polling`)

Builds on the spike of 30 October ([journal](spike-push-instead-of-polling.md)). Read-only against
the person's running `symbiote view` of this repository (port 41429, built from `main`): each read
fetched three times, the view's CPU from `/proc` for two minutes (the spike's `cpu.sh`), the records
counted. Then every reader in `packages/viewer/src` that reads again on its own, on today's `main`
(V88–V93 included).

**Learned**:
- **Polling grew with the records.** `/api/reviews` 1.7–2.8 s and 55 KB (1.25–1.38 s and 50 KB on
  30 October): 141 reviews, of whose branches only 14 refs are left. Its code runs `isCommit` and
  `isAncestor` for every approved verdict on every read. `/api/workspaces` 0.23–0.37 s, 11 KB, for
  3 open workspaces of 156 records. The view used 20.4 s of CPU a minute (7.9 s its own, 12.6 s its
  children's) with 2 agents working; the spike measured 17.5 s per reading page.
- **Readers keyed on the list's object read with every poll.** A workspace's thread, changes, Hive
  detail and activity, MergeControl (`version={list}`), Nucleus's activity (`[read]`) and the
  findings (`[readAt]`, V93) read again each time the list is read, changed or not. Kept objects
  make them read only on a change, with no change to them but the findings' key.
- **The hook already lives in the cache** (decision 721, after the spike): `claude-settings.json`
  names `<cache>/hooks/<content>/agent-hook.js`. A new module the hook runs must join `HOOK_FILES`.
- **A view in a worktree serves the main checkout's `symbiote/`**: the registry's `root` is not
  always the records' folder's parent, so the ping needs the folder in the record.
- **Terminals cannot each keep a stream** once there is one per browser: 8 tabs with a terminal
  each would hold 9 connections against Chrome's 6. The terminal already resets and draws again
  after a reconnect, so a replay on a new holder's stream fits it.
- **Decisions free**: the highest on any branch is 896; no branch uses V94.

## V94a — the stream, `/api/events`, and `/api/reviews` cached (2026-11-03, branch `feature/v94-push-not-polling`)

`packages/cli/src/events.ts` serves the shell's six reads as server-sent events: `retry: 1000`,
the stream's ID, the whole state, then the parts whose JSON changed, and `alive` every 25 s. Its
first triggers: records this process writes whole (`writeFileWhole` tells its listeners, so a
write is news on a disk with no file events too), the server's own write requests, and asks held
or let go. `/api/reviews` keeps what git said of each review under a key of what it depends on.
The viewer's store (`shell/events.ts`) keeps the object of each part that did not change;
`useWorkspaces`, `useAsks`, the findings and History's reviews read from it, and poll as before
without a stream. Decisions 897–901.

**Learned**:
- **A trigger during a page's first read was lost.** The page counted as listening only once its
  state was sent, so an ask held meanwhile was dropped until the safety read: the MCP ask spec
  failed beside three other specs' load and passed alone. A page whose state is being read now
  counts as listening; a unit test with a slow read was red without it.
- **The reviews' cost was the approvals'.** On the test repository a list with nothing changed ran
  4 git calls before the cache and 0 after; a branch that moved runs `commitsBetween` for its
  review alone. On this repository's 141 reviews (14 refs left) most calls were each approved
  verdict's `isCommit` and `isAncestor`.
- **Polling's specs of an agent's progress need V94c**: with only the in-memory triggers, what an
  agent's hooks and commits change shows at the 60 s safety read.

## V94b — one stream per browser, terminals' output on it (2026-11-03, branch `feature/v94-push-not-polling`)

The tab holding the Web Lock `symbiote-events:<host>` opens the stream and relays it on a
`BroadcastChannel`; a tab that joins says `hello`; the holder beats every 10 s and a tab that
hears nothing for 30 s opens its own. A terminal listens on the browser's stream
(`POST /api/events/listen`); two tabs showing one terminal get one copy; a new holder's stream is
listened on again, and the terminal draws the replay anew as after a reconnect. Decisions
902–903.

**Learned**:
- **"A terminal in each of 8 tabs" was never possible**: Symbiote opens at most 4 terminals at once
  (V21: 140 MB each); the 5th tab's `POST /api/workspaces/terminal` answered 409. The e2e opens the
  workspace's terminal in 4 tabs, the Overview and Git in the other 4: one stream, every read under
  2 s, the holder closed, another opened the stream, each terminal typed into after.
- **A shell's tab named what runs in it only because polling made a new list every 5 s** while a
  terminal was open. Pushed, the list does not change when `sleep` starts: a shown shell whose
  output stops for 500 ms reads its tabs again.
- **The fake lock manager granted the lock twice** when two tabs asked in one tick (the first
  relay tests failed on it, not on the store): a lock is taken at the request, granted after.
- Not test-first here: the store's relay was written before its tests; the tests' first failures
  were the fake's.

## V94c — changes from outside (2026-11-03, branch `feature/v94-push-not-polling`)

`events-watch.ts` watches with one plain `fs.watch` per folder the records' folders (`reviews/`,
`workspaces/`, `threads/`, `activity/`, `hive/` and its own files), git's `refs/heads/`,
`refs/remotes/` and `packed-refs`. The hook pings each view of its records' folder
(`events-ping.ts`, a bare TCP POST, done once written), found in the registry by its new
`symbiote` field through `--cache=<dir>` on the hook's command line. Claude Code's list is read on
the server every 5 s while a Claude agent is live; a hook's thread entry reads it at once, before
the workspaces. Codex's app server is heard on one quiet connection while a Codex agent is live.
`SYMBIOTE_EVENTS=off` turns the stream off. Decisions 904–907.

**Learned**:
- **One read a second was too slow for the 500 ms target**: a change behind any other read (the 5 s
  live read, a tool's hook) waited up to a second — 801 ms for an agent's commit in the first e2e
  run. Reads are now at most every 250 ms per part.
- **A state change took two reads**: the workspaces read took Claude Code's list from its 2 s cache
  while the fresh read ran beside it. On a thread's entry the list is read first, and the
  workspaces with it: an agent asking showed in 460 ms before, 108–111 ms after.
- **Codex needs no subscription to be heard**: V27a probed that a connection that started or
  resumed no thread hears only status changes. `CodexServer.watch` holds one while a Codex agent
  is live; a daemon that does not answer leaves its parts to a read every 5 s.
- **`?poll` was lost on the way**: the shell moves `/` to `/overview` before the first reader asks
  the store, and the query went with it. The store reads `?poll` as the module loads.
- **Two e2e specs had leaned on polling's lag**: the merge page shows Files first once a merge has
  a resolution (V93), and push brings that state before the log's next 250 ms read, so the log was
  hidden when the spec read it; a model change appended to a transcript with no hook showed only
  because the list was read every 5 s (a real answer comes with its tool's or its turn's hook).
  Both specs now act as a person and an agent do.
- **Polling's new objects hid files that change without the list**: Nucleus's activity (a
  Confirm), a thread or an activity can change while its part's JSON does not; their readers were
  keyed on the part's object, new every 5 s. The stream's `touched` event names such a file.
- **Decision 161 still holds, on the server**: Scribe's turn, typed in its terminal, writes no
  record, so nothing announced it; Claude Code's list is read every 5 s while a terminal is shown
  and 10 s after.
- **The Codex watch was let go between two pages** (a reload: no page listening for a moment), and
  what changed then was never read: it is kept while a Codex agent is listed, and reads the Codex
  parts once when it opens.
- **`hive-pacing.spec.ts`'s Settings test fails from 23:00 to midnight, with or without V94**: the
  pause ends "tomorrow at 00:50" and its pattern wants "at HH:MM". Not fixed here.
- **A tab that joined a holder with no stream waited 30 s**: the holder answered `hello` only while
  streaming, so beside an older `symbiote view` (or `SYMBIOTE_EVENTS=off`) a second tab read nothing
  and spun its skeletons until its own stream failed (`alpha-ceph.spec.ts`'s new tab, under
  polling). The holder answers with its status.
- **The fake merger is `claude` itself**: a list read at each page's open ran it as a merger run
  and took the merger's answers (5 merge specs failed). The list is read at a page's open, and
  while a terminal is shown, only when a Claude agent is listed; with none, the workspaces' read
  takes it as before.

## V94d — measured on a copy of this repository, and written down (2026-11-04, branch `feature/v94-push-not-polling`)

`spikes/push-instead-of-polling/v94/measure.mjs` starts a build's `symbiote view` on a copy of this
repository (a clone and a copy of `symbiote/`: 156 records, 3 open with Claude agents, 141
reviews, Hive off), opens one headless page on the Overview, runs that build's `agent-hook.js` 18
times a minute with a clean environment (15 tools, 3 notices), and reads the view's CPU from
`/proc`. `main` (45424c6) polling: 15.8 s of CPU a minute, 95.9 requests; V94 pushed: 3.1 s
(3.0 s in a second run), 8.4 requests (6.0), none of them the polled reads; the same page with
`?poll`: 3.5 s, 112.3 requests. The plan's Results have the table and the delays.

**Learned**:
- **The first push measurement was 4.0 s a minute, over the target**: logging shims on `PATH`
  counted the view's programs. `claude agents` ran 19 times a minute where the live read accounts
  for 12: the workspaces' reads between two live reads took the list from a 2 s cache, then ran
  it again. The stream's read is now kept 6 s. Each workspace's commits were counted again at
  every read (4–5 git commands): now only when its base, `from`, `against`, tip or any ref moved.
  3.2 s, then 3.0–3.1 s.
- **What is left is mostly the price of the design**: about 1.5 s of Claude Code's list every 5 s
  (decision 906, as the spike estimated) and `git status` in each open worktree at each read of the
  list (51 runs in 1.5 minutes here). Keeping a Claude workspace's status until its hooks write
  would save about 0.6 s, but an edit nothing records would show up to a minute late to every
  reader: not done.
- **The caches are most of the saving even for polling**: V94 with `?poll` cost 3.5 s, `main`
  15.8 s. The reviews' cache alone took 139 git runs out of each first list on this copy.
- **The 139 ancestor checks at a view's start are the reviews' first list** (141 reviews, most of
  them approved); after it, none while nothing moves.

- **The list's first read only set its baseline**, so a change made before it was swallowed: Scribe
  working right after the person's prompt never showed (`skills.spec.ts`, red alone after the read
  was gated on a Claude agent being listed). The first read counts as news, but a page's opening's,
  whose parts are read just after. `look.spec.ts`'s row order failed in the three full runs before
  this fix and passed in the one after (a just-started row in another group fits it).

**Verification**: tests first throughout but where the V94b entry says; `pnpm check` 3152 tests;
`events.spec.ts`: 8 tabs, every change kind, a merge's steps, the server stopped and restarted.
The full e2e suite, with `SYMBIOTE_EVENTS=off`: 427 passed, `events.spec.ts`'s 4 skipped, the
nexus's 21 passed; with push, the last run: 430 of 431, the Split terminal test failing once and
passing alone (3 of 3) and with `look.spec.ts` under 6 workers (72 of 72); in the run before,
`workspaces.spec.ts`'s fast-forward merge failed once the same way. `viewer-check` on
Bitwarden `737ee3f`: first paint 296–316 ms against `main`'s 300–322, select 102–104 (88–104),
mark reviewed 34 (33–35), pan 62–63 fps, the same 3,124 elements, no page errors.

Not verified: the person's own view on this build (it would write `symbiote/claude-settings.json`;
the after-number comes when the person runs it); macOS and Windows file events; a repository on
`/mnt/c` end to end; a laptop's sleep; Firefox and Safari; Codex against a real daemon (V27a's
probe and the fake).

Merged into main (2026-11-04).
