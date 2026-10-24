# V23 — Branches that need you, first in the branches panel

[Index](../PLAN.md) · [Journal](../journal/v23-branches-that-need-you.md)

**Status:** merged into main (2026-10-18, from branch `feature/sort-branches-by-last-agent-action`,
a feature started in Symbiote; approved in Symbiote at `4321040`). Planned as V22 with decisions 119–120,
which `main` took meanwhile. As built and results: "As built (V23)" below.

**Problem** (asked: "sort the commits from Commits page by last agent action...so i can see the
branches that need my attention at the top", then "we need to sort the Branches from the left side
of the commits page"). The branches panel (V10b, decision 92) lists Local with the checked-out
branch first, then by name. A feature's branch sits where its name falls:

- On this repository (22 local branches, 70 remote, 2 open features) the features are 3rd and
  4th only because `chore/` and `feature/` sort before `fix/` and `milestone/`; a feature named
  `milestone/v22-…` would be the 23rd of 23 local entries.
- The panel says what each feature needs (its mark: `?`, `●`, `⚙`), but not which agent acted
  last: the person reads every entry to find the one that just stopped.
- Claude Code gives no time of a session's last activity: `claude agents --json --all` (2.1.302)
  lists `startedAt`, `state` and `status` only. Symbiote's thread (`symbiote/threads/<branch>.jsonl`, V18c's
  hooks) has a time for every report (a turn ended) and every question or permission asked.
  Not everything there is the agent's: on this repository `chore/update-readme`'s last entries
  are an `idle_prompt` notice a minute after its report and, three days later, a `/clear` (an end
  and a start).
- The commit rows cannot take this order: they are the graph (`git log --topo-order`, each commit
  above its parents, lanes drawn from it), and a feature without commits sits on its base's row.
- `/api/features` on `main`'s build: 34 ms (median of 20; 32–36 ms) on a clone of this
  repository with its two features.

**Goal**: in the panel's Local list, the features that need the person come first, the one whose
agent acted last on top; then the features whose agent works, the same way; then the other
branches as today (the checked-out one, then by name). Each feature's entry shows how long ago its
agent acted. Without open features the panel is as today; Remotes, the commit rows and the
features view do not change.

## When an agent last acted (core, CLI)

- `FeatureSummary.lastAction?: string` (core, a type only): the time of the thread's newest
  `report` or `asks` entry; else when its agent last started (`agent.started` in the record);
  absent with neither (no agent was found).
- Prompts are the person's or Symbiote's; notices (Claude Code's `idle_prompt` comes a minute after a
  report) and sessions' starts and ends (`/clear` writes both) are not the agent handing the turn
  back. None of them counts.
- `thread.ts`: `lastAction(entries)`. `summary()` reads a feature's thread once, for it and for
  `turnEnded` (read today only when a session is blocked with nothing named).
- No graph change: no schema bump.

## The order (viewer)

- `features.ts`: `featuresFirst(features, reviews)` — the branches of the open features that need
  the person (`featureNext`'s `needs-you`), then those whose agent works, each newest
  `lastAction` (else `created`) first, ties by name. Merged features and gone branches are left
  out: they need nothing.
- `branches.ts`: `TreeOptions.first?: readonly string[]` — those local branches first, in that
  order; then the checked-out branch, then by name. The filter keeps the order. A name that is
  not a local branch is ignored. Remotes do not change.
- `BranchesPanel`: a short muted age after a feature's name (`now`, `4m`, `2h`, `3d`), titled with
  the time in full. It ticks once a minute in its own component; the panel is not drawn again.
- The commits page computes `first` from `useFeatures` (read on load, when the page is back in
  view, and every 5 s while an agent works or waits).

## Verification

1. **Unit** (red first): `lastAction` (reports and questions count; prompts, notices, starts and
   ends do not; the newest wins; none, none); the server's `/api/features` carries it, and
   `agent.started` without a thread; `featuresFirst` (needs-you before working, newest first,
   `created` without `lastAction`, merged and gone left out); `branchTree` with `first` (in that
   order, then the checked-out branch, then by name; the filter; unknown names ignored); without
   `first`, the existing tests unchanged; the age's text.
2. **E2E** (`features.spec.ts`, the fake Claude Code): two features — the one that reported last
   is on top of Local, then the other, then `main`; the other reports and moves on top; a working
   one goes below those that need you; the age is shown. Every existing spec passes,
   `branches.spec.ts` unchanged.
3. **Real data**: a clone of this repository with copies of its feature records and threads (not
   the checkout: `symbiote view` from a branch's build rewrites `symbiote/claude-settings.json` to that
   build's hook); screenshots light and dark, 1440 and 900 px; no page errors.
4. **Cost**: `/api/features` within 5 ms of `main`'s; with a 5,000-entry thread, measured; if
   reading it costs more than that, read the file's end only.
5. **Nothing else changes**: no analysis code (no regression sets); `pnpm check`, build, e2e.

**Risks**

| Risk | Mitigation |
|---|---|
| The order moves while the person reads (read every 5 s while an agent works or waits) | Only features move, when one acts or changes state; the age says why |
| A long thread read every 5 s per feature | Measured on 5,000 entries; the file's end only, if it costs |
| Features started before V18c have no thread | `agent.started`, else `created` |
| The checked-out branch is no longer first | It keeps its ●; only open features go above it, as asked |

**Order**: the type and `lastAction` with their tests; the server; `featuresFirst` and
`branchTree`; the panel and its age; the e2e; the real-data check.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V23 ✅ | Branches that need you, first | `lastAction` on each feature (its thread's newest report or question); `featuresFirst`; `branchTree`'s `first`; the panel's order and ages; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 120 | What "the agent's last action" is | **Its thread's newest report or question; else when its agent last started; else when the feature was made** | Claude Code lists a session's start only. Those two entries are the agent handing the turn back; prompts are the person's, and notices and `/clear` came minutes to days after the agent's last act on this repository's thread. |
| 121 | Where the order shows | **The branches panel's Local list: features that need you, then working ones, newest action first; then the checked-out branch and the rest by name. Remotes, rows and the features view as they are** | Asked ("sort the Branches from the left side of the commits page"). Rows are graph order; a pushed feature's remote branch stays in its folder; the features view keeps its order until asked. |

**Not in V23 (later)**: the features view's order (started order today); other branches by date;
a toggle between orders; the remote branches.

## As built (V23)

- **The thread's end only** (`readThreadEnd`, its last 256 KB, the line cut there dropped), as
  the plan allowed if reading cost: a 5,000-entry thread (9.9 MB) took 9.6 ms whole, for each
  feature on every read of the list; its end 0.6 ms at any length, with the same last action. The
  longest entry in this repository's threads is 6.3 KB. The thread view still reads it whole.
- **`featuresFirst` gives each branch with its time** (`{ branch, at }`): the order and the age
  come from the same value.
- **The e2e's last step** is a permission asked, then answered, not a second report then an
  answer: once no agent works or waits, the page stops reading the list every 5 s (V18b), and a
  change shows only when the page is back in view.
- **Names are cut sooner**: the age takes about five characters of the 260 px panel
  (`milestone/v10b-branches-panel` fits on `main`'s build, not beside `55m`). The full name is the
  entry's title, as before.

**Results (V23)**. Tests first: 6 unit tests failed before the code (`lastAction`, the list's
`lastAction`, `featuresFirst`, `shortAge`, `branchTree`'s `first`, then `readThreadEnd`); a
seventh, no `lastAction` without an agent, guards what was already true. The new e2e test fails
on `main`'s build at its first order. Now 730 unit tests and 103 e2e.

On a clone of this repository with copies of its feature records and threads, and two made-up
features (a plan ready 55 minutes ago on `milestone/v10b-branches-panel`, a permission asked 5
minutes ago on `fix/thread-markdown`), in Chromium at 1440 × 900:

| | `main`'s build | This branch |
|---|---|---|
| Local entries of the three open features | 4th, 10th, 12th of 22 | 1st, 2nd, 3rd: the permission (5m), the plan (55m), then this feature at work (19m), then `● main` |
| `/api/features`, median of 20 (three runs, back to back) | 33.2–34.1 ms | 33.5–34.0 ms |
| Page errors (light, dark, the 880 px overlay) | none | none |

The real `chore/update-readme` thread's last action is its report (2026-10-15 11:06), not the
idle notice a minute later or the `/clear` three days after; merged since, it keeps its place by
name.

Not verified: a feature list of dozens of features; Firefox and Safari; Windows and macOS; a real
Claude Code session acting while the page is open (the e2e fake runs Symbiote's real hooks).
