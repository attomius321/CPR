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
