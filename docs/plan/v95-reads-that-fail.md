# V95 — Reads and saves that say when they fail

[Index](../PLAN.md) · [Journal](../journal/v95-reads-that-fail.md)

**Status:** planned (2026-11-06), to be built on branch `feature/v95-reads-that-fail` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

## The brief

**Kind** milestone · **Branch** `feature/v95-reads-that-fail` · **Size** M · **Depends on** P09
(`fix/server-words`: refusals in words) first · **Plan** P08 of 51 (the audit's order)

**What to change**: the viewer drops a failed read or save without a word. Some tabs then spin
forever, the sidenav falls back to its skeleton on one 500, review marks and drafts are lost with
no sign, and Hive's log tail freezes after one error. Give the viewer one way to read, which knows
loading, value and error, and use it where reads are written by hand today. Show "not saved" for
review state. Reconnect every stream.

**Where to look**:
- **Forever "loading"**: `src/workspaces/ThreadTab.tsx:18-26` (a non-OK answer becomes `null`) and
  `:61` ("Reading its messages…"); `ActivityTab.tsx:46`; `src/nucleus/NucleusActivity.tsx`.
- **The skeleton again**: `src/workspaces/useWorkspaces.ts:96-99` (`read`: non-OK → `null`) and
  `:110-132` (`refresh` replaces the list); `src/shell/Sidenav.tsx:387` (`skeleton-card`).
- **Saves lost**: `src/diff/store.ts:25-40` (`PUT` with `.catch(() => undefined)`, `ok` never read;
  one `pagehide` listener added per `serverStore()`).
- **A failure kept**: `src/diff/DetailPanel.tsx:51-61` (`fetchSource` keeps a rejected promise for
  the session; `FilesPage.tsx:114` already deletes it on failure).
- **Streams**: `src/workspaces/HiveRunTab.tsx:85-101` (`useLogTail`: `onerror` closes, no
  reconnect); `StepLog.tsx:19,133` (reconnects after `RECONNECT_MS`).
- **Analysis polling**: `src/history/api.ts:122-130` (`fetchGraph`: a network error is `missing`)
  and `src/diff/useDiffGraph.ts:145-147` (polling stops).
- **The hand-written reads**: `useThread`, `useTools` (`activity/api.ts`), `useMergeCheck`
  (`WorkspaceFacts.tsx`), `useFindings`, `useNucleusActivity`, `useChanges`
  (`ChangesPanel.tsx`), `useCheckout` (`StatusBar.tsx`). The viewer has 26
  `.catch(() => {})` and 13 `ok ? … : null`.

**Out of scope**:
- The shell's own error page (P07).
- A file that is not a graph (P06).
- Shape checks of what a read returns (P45).
- New data or endpoints.

**Done when**:
- Every read listed above shows, on a failed answer, the error in words (`serverWords`) with a
  Retry, in the place its value would be, and keeps the last value it had when it had one.
- No tab spins on a 404 or 500.
- A review mark or draft that does not reach the server says "Not saved" beside the review's
  progress and retries; a reload does not lose what was shown as saved.
- `useLogTail` reconnects as `StepLog` does.
- A network error while a diff is analyzed keeps polling.

## Problem

From the audit (finding V4: Code, each path read; V5's raw JSON and V2's server page are their own
fixes):

| Where | What a failure does today |
|---|---|
| ThreadTab, ActivityTab, NucleusActivity | 404/500 → `null` → "Reading its messages…" forever |
| `useWorkspaces` | one 500 → the list `null` → the sidenav's skeleton cards |
| `diff/store.ts` | a failed `PUT` of marks or drafts → dropped, no sign |
| `DetailPanel.fetchSource` | one rejected read → "none" for that symbol until reload |
| `HiveRunTab.useLogTail` | one stream error → the tail frozen |
| `fetchGraph` | a network blip mid-analysis → `missing` → polling stops |

The audit's tour, with every `/api/**` route held or answering 500, showed the shell pages in this
state (finding V2's screenshots). The rows above were read in code, not run one by one.

## Goal

A person always sees one of three things where data goes: the data, "Reading…", or what went
wrong and Retry. A save that did not land is visible. What the pages show when everything works
does not change by one pixel.

## The read

- **`src/ui/useRead.ts`**, pure at its core (`read-state.ts`, unit-tested): `useRead<T>(url | null,
  { touched?, keep? })` returns `{ value?, error?, loading, retry }`.
  - A non-OK answer is an error with `serverWords`; a thrown fetch is "unreachable".
  - With `keep`, the last value stays while an error shows, which the sidenav needs.
  - Aborted on unmount (`AbortController`), not "live" flags.
- **`ui/ReadError.tsx`**: the error's words and Retry, `StatusLabel` tinted as a warning, sized to
  sit in a card's body.
- **Moved to it**: the eight hooks listed. Each keeps its exact output when the read succeeds.

## Saves

- `diff/store.ts`: a queue per state name that reads `ok`. A failed write stays pending and is
  retried with backoff (1, 2, 4… 30 s). `useReview` exposes `saving | saved | failed`.
- The review tab's progress line shows "Not saved — retrying" while failing.
- One `pagehide` listener for the module, not one per store.
- The `keepalive` flush checks the body's size: over 60 KB it sends a plain `PUT`, since the
  browser refuses a keepalive body over 64 KB.

## Streams

`useLogTail` takes `StepLog`'s reconnect, through one shared helper (`ui/stream.ts`).

## Verification

1. **Unit** (red before): `test/read-state.test.ts` (each transition, keep, retry), and
   `test/store.test.ts` (a failed `PUT` is retried and reported, and one listener for two
   stores).
2. **e2e** (red before), a new `e2e/failures.spec.ts`:
   - `/api/workspaces/thread` → 404 shows the error, then 200 after Retry shows the thread;
   - `/api/workspaces` → 500 once keeps the sidenav's rows;
   - `PUT /api/state/review` → 500 shows "Not saved", and after it heals, "saved";
   - the Hive log stream closed once comes back.
3. **Nothing else changes**: every existing spec passes. `page-frame.spec.ts` and
   `targets.spec.ts` cover the new cards.
4. **Look**: both themes at 1×, with the `symbiote-style` skill.
5. **Cost**: first paint on `/git` and on Bitwarden's graph within noise of today (the audit:
   fixtures 44–130 ms, Bitwarden 307–340 ms).

**Risks**

| Risk | Mitigation |
|---|---|
| A hook moved to `useRead` changes when it reads (its `touched` key) | Each hook's reads counted in its spec before and after (`page.on('request')`) |
| Retrying saves floods a broken server | Backoff to 30 s; one queue per name |
| Fifteen files touched conflict with other workspaces | Land V95a (the hook) alone; move the hooks in small commits, one area at a time |

**Order**: the pure read state and `useRead`, then the tabs that spin, then the sidenav, then
saves, then streams.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V95a | `read-state.ts`, `useRead`, `ReadError`; ThreadTab, ActivityTab, NucleusActivity moved | no forever-spinning tab |
| V95b | The remaining hooks; the sidenav keeps its rows on an error; `fetchGraph` keeps polling | the 26 `.catch(() => {})` reviewed, each kept for a reason or removed |
| V95c | Saves: the store's queue, "Not saved", one `pagehide`, keepalive's size | marks never lost silently |
| V95d | `useLogTail` reconnects through `ui/stream.ts` | Hive's tail survives a restart |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 935 | How a page reads | **One `useRead` with loading, value and error; a non-OK answer is an error in the server's words, never `null`** | 13 hand-written `ok ? … : null` made "failed" look like "loading"; ThreadTab spins forever on a 404 |
| 936 | A failed read where data was shown | **The last value stays, with the error beside it** | One 500 put the whole sidenav back on skeleton cards |
| 937 | A failed save | **Kept pending, retried with backoff, and shown as "Not saved" until it lands** | Review marks and drafts were dropped with `.catch(() => undefined)` |

**Not in V95 (later)**: checking the shape of each answer (P45); offline queueing across reloads;
the nexus page's reads.
