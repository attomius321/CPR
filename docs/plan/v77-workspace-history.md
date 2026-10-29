# V77 — History: finished workspaces, their activity and brief

[Index](../PLAN.md) · [Journal](../journal/v77-workspace-history.md)

**Status:** planned (2026-10-29), on branch `feature/workspaces-history` (a workspace's branch).
Plan agreed by the person, with History a page of its own under Monitor ("History should be a new
page under Monitor!", then "Yes, keep the styling of the app.").

**Problem** (asked: "Would like to have a workspaces history, with their activity logs, and
brief."). Clean up (V18c) removes a workspace's worktree and agent sessions, and its branch once
merged, but keeps its record with `finished` set. Every list then hides it, and its address
(`/?branch=`) says "No workspace … It was cleaned up". What is still on disk for the person's
workspaces in this repository (`symbiote/`, 2026-10-29):

| What | Finished workspaces (of 97) |
|---|---|
| Record and brief (`workspaces/<branch>.json`) | 97 |
| Thread: prompts, reports, questions (`threads/<branch>.jsonl`) | 94 (Claude Code's hooks, Codex's runner) |
| Tool calls (`activity/<branch>.jsonl`, since V48f) | 40; 5.4 MB in all, the largest 485 KB |
| A review whose last verdict is Approve | 85; its commit is on `main` for 83 |
| Branch kept (cleaned up unmerged, or not yet deleted) | 14 |
| Commits recoverable (approved commit on `main`, or the branch) | 96 |
| Agent: Claude Code / Codex (app server) / Codex (runner) / Hermes | 93 / 2 / 1 / 1 |

What causes it, in three points:
- The list (`workspaces().list`) filters `finished` records out, and no page reads them.
- A finished workspace's reads go through its agent where the agent keeps its conversation:
  Codex's app server (V27a) and Hermes (V58) would be asked, or started, for a workspace whose
  sessions Clean up archived.
- The record keeps no trace of the branch's end: Clean up deletes a merged branch and does not
  write its tip or whether it was merged, so the Activity tab's commits (V73) are gone with it.

**Goal**: a **History** page in the sidenav, under Monitor (`h`): every finished workspace, the
newest first, and the one picked beside the list, read-only: its Activity (the V73/V74 timeline,
its commits in it), its Thread, its Brief and its Changes. **Kept**: the live workspaces, their
pages and the sidenav's groups as today; no agent is started or asked for a finished workspace;
the app's style (V61, V72): `PageHead`, cards on the ground, line tabs, the tokens.

## Server (V77a)

- **`GET /api/workspaces/history`** (`workspaces().history()`): the finished records as
  `WorkspaceHistoryEntry` rows (core, `workspaces.ts`), newest `finished` first: branch, kind,
  title, brief, created, finished, by, via, planFirst, the agent's kind, model and effort, and the
  outcome. Never a session, a thread or an activity file: records, reviews and one `git rev-list`
  of the default branch.
- **The outcome** (`outcomeOf`): the commit the workspace ended at is the tip recorded at Clean
  up, else the last Approve verdict's `head` (records before V77), else the branch's tip when it
  is kept. "Merged into `<into>`" when that commit is in the default branch (or the record says
  `merged`), "Branch kept" when the branch is there, else "Not merged".
- **`GET /api/workspaces/history?branch=`**: one finished workspace as a `WorkspaceSummary` with
  `finished` set, so the Activity, Thread and Brief tabs draw it unchanged: agent state
  `not-running` (no live strip), `worktree.exists` false, `tip` the commit it ended at, `ahead`
  its commits, `merged`. 404 for a branch with no finished record.
- **A finished workspace's reads** (`thread`, `tools`, `changes`) use only Symbiote's files and
  git: the thread from `threads/<branch>.jsonl`, the tools from `activity/<branch>.jsonl`; Codex
  on its app server and Hermes are never asked (their entry says their conversation is kept by
  the agent); its changes from its base (the fork point with the default branch, as Review
  computes it) to the commit it ended at, while git has it.
- **Clean up records** `tip` (the branch's tip when it was cleaned up) and `merged` in the record
  (`WorkspaceFile`), so the history no longer depends on the review.

## Viewer (V77b)

- **The page**: `Route` `{ page: 'workspace-history'; branch?; view? }` at `/workspace-history`
  (`/history` stays Git's old address, moved to `/git` since V66; Git's API is `/api/history`).
  The sidenav's pages read Git, Scout, Skills, Monitor, **History**, with a new `HistoryIcon`
  (lucide's `history`), its key `h`, on the rail too.
- **The frame** (V72): `PageHead` (the icon in the accent, "History", a line saying how many are
  finished), then two cards: the list, then the picked workspace, a `Resizer` (`gutter`) between
  them as Git's details have; under Git's breakpoint the second card goes below the first.
- **The list card**: a search field (title, branch, brief) and a kind filter in its 48 px head;
  rows by day of finishing ("Today", "Yesterday", a date), each the kind's icon, the title, the
  branch, the agent, how long it ran (created to finished) and the outcome as a tinted badge. The
  arrows move between rows; Enter picks one. With none: a workspace comes here when it is cleaned
  up.
- **The picked workspace's card**: its head as a workspace's (kind icon, title, branch, finished,
  outcome; Show in Git), line tabs Activity · Thread · Brief · Changes, Activity first. The tabs
  are the workspace page's components; Changes is the changes panel's list, read-only. No
  terminal, shell, reply box, Stop or Clean up.
- **Addresses**: `/workspace-history?branch=<b>&activity|thread|brief|changes` keeps the pick and
  the tab; `/?branch=<b>` of a finished workspace moves there instead of "No workspace".
- **Pure parts** in `workspaces/history.ts` (unit-tested): the day groups, the search, the
  outcome's and the duration's words.

## Verification

1. **CLI tests first** (red before; real git repositories): the list holds the finished records
   only, newest first; each outcome (recorded tip, approved commit on the default branch, branch
   kept, none); Clean up writes `tip` and `merged`; a finished workspace's thread and tools read
   its files with agents that throw when asked; `changes` of a merged, cleaned-up workspace lists
   its commits; the server's route answers and refuses what is not a GET.
2. **Viewer unit tests**: `history.ts`; `pages.ts` reads and writes the new route; the tokens and
   styles guards stay green.
3. **E2E** (`e2e/workspace-history.spec.ts`, `serveWorkspaces`): the sidenav's History and `h`
   open the page; search narrows the rows; the arrows move; a row shows the four tabs and no
   Terminal; the address keeps the pick through a reload; `/?branch=` of a finished workspace
   moves there; a workspace cleaned up in the spec appears in History. The page joins
   `page-frame.spec.ts`.
4. **Real data**: copies of the person's records, threads, activity and reviews in the job's tmp
   (nothing in `symbiote/` touched), served by this branch: the history's server time (target
   under 200 ms for 97), the page's first rows; screenshots at 1440×900 and 760 px wide, 1×, dark
   and light: the list, `layout-fixing` (the longest activity), one with no recorded calls, a
   Codex one; spacing checked on every page the sidenav change reaches.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`. No analysis change: no regression check.

**Risks**

| Risk | Mitigation |
|---|---|
| The list reads 97 records and reviews on every open | No thread or activity file; one `rev-list`; measured on the copies |
| A finished Codex or Hermes workspace starts its agent | Its reads never reach `viaCodex`/`viaHermes`; tests with agents that throw |
| An approved commit not in the default branch (2 of 85) | "Not merged" unless the branch is kept; its commits still listed while git has them |
| A branch name used again: the new record replaces the old, its files appended to | Not in V77 (none of the 97 collide); noted for a later fix |

**Order**: the server and its tests (V77a), then the page (V77b), then the e2e spec, the real
records and the docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V77a | History's API | `/api/workspaces/history` (list, one), finished reads from Symbiote's files, Clean up records `tip` and `merged` |
| V77b | The History page | Under Monitor (`h`): the list and the picked workspace's Activity, Thread, Brief and Changes; the old address moves there |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 561 | Where finished workspaces are listed | **A History page in the sidenav, under Monitor, key `h`** | The person's choice; a sidenav group of 97 cards would bury the live ones |
| 562 | What a finished workspace shows | **The list, the picked one beside it, read-only: Activity (first), Thread, Brief, Changes** | The brief asks for its activity and brief; Git's rows and details are the app's pattern for a list and its pick |
| 563 | Its address | **`/workspace-history?branch=…&<tab>`; a finished workspace's `/?branch=` moves there** | `/history` is Git's old address and `/api/history` Git's API; old links keep working |
| 564 | What a finished workspace's reads may touch | **Symbiote's files and git only; no agent asked or started** | Clean up archived its sessions; Codex's app server and Hermes would start for nothing |
| 565 | Where its commits come from | **Its base to the tip recorded at Clean up; else the approved commit; else the kept branch** | 96 of the 97 recoverable; precise: none when git has none |
| 566 | What Clean up records | **`tip` and `merged`** | The outcome without the review, from V77 on |
| 567 | The page's icon | **lucide's `history`, drawn in `icons.tsx`** | No clock in the set; the style draws icons from lucide's paths |

**Not in V77 (later)**: removing an entry from History; starting a finished workspace again;
landed merges (the merge queue's own entries); a branch name used again keeping both records.
