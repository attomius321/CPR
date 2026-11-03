# V91 — Redesign step 4: the Overview pages, normal mode and Hive

[Index](../PLAN.md) · [Journal](../journal/v91-redesign-overview.md)

**Status:** built (3 November 2026), on branch `feature/redesign-overview` (the workspace's, from
`main` at `705f20d`); the person's OK with choices 1 Respond, 2 exact by day, 3 fold Done, 4 a key
free on every page.

**Problem** (the brief: "Add the new Overview page, first in the sidenav, in both modes"). The
designs are on `main`: `spikes/normal-redesign` and `spikes/hive-redesign`, proofs 01-overview and
01-overview-light. V88 built the tokens and the shared parts, V89 the workspace page, V90 a
review's pages. Today, on `705f20d`:

| | Today | Measured |
|---|---|---|
| What waits for the person | Only the sidenav's cards | — |
| Hive's work | Each workspace's page; no page shows all of it | 42 Hive records, 3.0 MB with their event logs |
| `/` | Moved to `/git` | 10 e2e spec files open `/` (22 calls) |
| Merged today | The merge queue keeps landed entries until they are removed | 0 entries in this repository's queue; 73 first-parent merges into `main` in 7 days (7–13 a day) |
| Hive's spend | A running total per workspace (`HiveSpend`), in the detail read only; the list carries none | A review's cost is timed (its `review` event); the writer's count (`spent.writer`) has only its last read's time |
| The records | 156 workspace records, 144 threads (3.1 MB) | — |

**Goal**: one Overview page, first in the sidenav, the page `/` opens, drawn by Hive mode: normal
mode's proof (figures, the inbox with one action a workspace, agents at work, the merge queue,
merged today, usage, today's events) and Hive's (five figures, a stopped workspace with why, in
flight with stage tracks, landed today, limits, events), in both themes. Every figure is derived
from what Symbiote or git records; what a proof shows that is not recorded is said below, not
drawn. No page but the sidenav's Done group changes; first paint of `/` and `/git` no slower than
`main`.

## The page and its address (decisions 848–850)

- **`/overview`**, first in the sidenav in both modes; `/` alone is moved there (it was moved to
  `/git`). Git stays at `/git`. The app's window and the nexus open `/`: the Overview. A diff
  opened from it goes back to it ("Overview"); the start page's way back and a removed card's
  fall back to it, not to Git.
- **Its key: `t`** (today). Every keydown handler of the viewer was read, the diff's pages
  included: `a c d f g h i j k m n o p r s v w x`, `P`, `/` and `[` are taken (`v` is V90's
  Viewed, `o` Git's and a review's open); `t` is bound nowhere.
- **One page, one address, two bodies**: `useHive()` picks normal mode's or Hive's.
- **"Today" is the local calendar day** (the person's choice): from the browser's local midnight
  (`setHours(0, 0, 0, 0)`). The 7 days of a figure's bars step back by calendar days, never by
  24 hours, so a 23- or 25-hour day is one day. The page gives the server `since` (local
  midnight six days ago): the server never guesses the time zone. A timer to the next midnight
  works today out again; it reads nothing by itself.

## What each section reads, and how often (decision 851)

| Read | When | Feeds |
|---|---|---|
| `useWorkspaces` (the list, reviews, merges), as today | On mount and focus; 5 s while an agent works or Hive is at work; 1.5 s while a merge runs | The inbox, agents at work, merging, in flight, stopped, the head's line, the counts |
| **New** `GET /api/workspaces/day?since=` | On mount; again when the list's read shows something moved (a key of each workspace's state, step, round and landing, each merge's state); at local midnight. No timer of its own | Events, merged today and this week, landed today, defects, time to merge or land, spend |
| `/api/usage` | The status bar's read, once a minute, moved into one shared reader | Usage, the Limits' gauges |
| `/api/hive/pacing`, `/api/hive/landing`, `/api/hive/reviewer/*` | Once on mount (Settings changes them; leaving Settings mounts the page again) | The Limits' facts |

**The day read (decision 852)** reads records and writes none:

- **Events since `since`**: each listed workspace's thread (its asks, reports and the person's
  prompts) and every Hive record's event log (`hive/<branch>.jsonl`). A file not modified since
  `since` is not read.
- **Hive's records** touched since `since` or in flight, cleaned-up workspaces' too: started,
  step, round and rounds, note, landings, push, each review's kept findings and cost, `spendOf`,
  and the writer's spend since `since` (below).
- **Merges into the default branch**: git's first-parent merges since `since`
  (`git log --first-parent --merges`), each matched to its branch by the merger's subject
  (`Merge <branch>: …`) or its second parent's branch, and pushed when `origin/<default>` holds
  it; the queue's fast-forward landings from the list's merges.
- **Each branch's start**: the `created` of open and finished workspace records.

## Normal mode (decisions 853–855)

The head: "N things wait for you · N agents at work · N merges in the queue"; Ask Nucleus, and
Start a workspace as its one primary.

| Figure | From |
|---|---|
| Waiting for you | The inbox's rows; note: answers · reviews |
| Agents working | The `working` group; note: their agents' names |
| **To review** (the proof's Findings to read is not recorded) | The review group's workspaces; note: their commits, those since the person's review |
| Merged this week, 7 bars | git's first-parent merges and the queue's fast-forward landings, by local day; note: today's, and where they went |
| Time to merge, median | Each merge matched to a workspace: its time minus the workspace's `created`, this week |

**The inbox** (decision 854): each workspace that needs the person, the oldest first, with one
action, each the way the workspace page or the sidenav card already does it:

| Row | Action | The way |
|---|---|---|
| Plan ready, asks, interrupted | **Respond** | `respondTo`, the sidenav card's: the workspace on its terminal. Approve plan stays under the plan (V89); none in the inbox (choice 1) |
| Ready for review, commits since the review | **Review** | The head's `POST /api/reviews`, moved to one `openReview()` both call |
| Approved, its tip the approved commit | **Merge into** | `MergeControl` |
| A merge that waits for the person | **Open** | The merge's page |
| Finished without commits | **Read** | The workspace |

Agents at work (what each does, its agent and model, a ticking time); Merging (the queue's
entries not landed, a stage track Merge · Check · Land from a pure `mergeSteps`, approved by the
person or by Hive); Merged today (decision 855: its commit, pushed, the time; a fast-forward
outside the queue has no record, its tip says); Usage (each window, when it resets, agents
running); Today (events, the newest first; a report named by V89's `planAnswered`: "Plan ready",
else "Answered with a report" or "Ready for review").

## Hive mode (decisions 856–857)

The head: what Hive does and where it lands (the merge queue or a request); Turn off Hive
(secondary, red words: the question Settings asks, its component moved out of `HivePage.tsx`) and
New goal (Start a workspace) as the one crimson primary.

| Figure | From |
|---|---|
| In flight | Hive's workspaces writing, checking, reviewing or landing; note: each stage's count |
| Landed today, 7 bars | Landings with outcome `landed` ended each local day, and requests merged (HV8); note: all pushed, or how many not |
| Defects caught | Kept findings of today's `review` events; note: proven by failing tests |
| Time to land, median | Each landing today: from its record's `started` to its push (else the landing's end) |
| Spend today | Reviews: the cost of each `review` event today. The writer: its transcripts' growth since local midnight (choice 2, below). Note: per landing on average |

**The writer's spend by day** (choice 2, measured in the spike): Claude Code writes a
`cost-state` line, its session's total so far, at each turn's end; it has no time of its own.
Its time is that of the nearest line before it with a `timestamp`. On this repository's 14 Hive
writers' transcripts, all 63 such lines follow one (41 a `turn_duration`, the turn's end), and no
total ever shrinks. A transcript's spend today is its last total minus its last total before
midnight (0 when none); the writer's, their sum.

**A stopped workspace** (decision 857): one callout for each stuck one, three at most then "and N
more": its title, a pill "Stopped · round of rounds", its note; Read why opens its Review tab
(step 5 renames it Run). In flight: the stage track from V89's `hiveSteps`, the live words of
`liveWords`, round, a ticking time, spend; All kinds filters by kind. Landed today: rounds,
defects, the merge and its push, spend, the time; an answered spike "Spike · answered". Limits:
the usage gauges with where Hive pauses and when they reset; budget and rounds per workspace, the
reviewer, how Hive lands. Events: Hive's of today, in words.

## Shared parts and the sidenav (decisions 858–859)

- The kits' figure, table, feed, facts and gauge in `src/ui/` under names not yet taken, for
  step 5 to reuse; the page in `src/overview/` (its components and CSS; pure `day.ts`,
  `normal-overview.ts`, `hive-overview.ts`, `events.ts`), each part listed in `styles.css`.
- Normal mode's sidenav folds its Done group, "Done" and its count, the fold kept in the browser
  (choice 3). Hive's sidenav waits for step 5.

## What the proofs show that is not recorded

- A review's findings ("Findings to read", "1 error · 2 warnings" on a row, "Ready for review, 3
  findings"): found when a review is opened, kept per graph, not per workspace. Commits instead.
- "2 rounds of review" on a merge: the list has the last verdict only. Who approved instead.
- A merge without a merge commit, outside the queue: no time is recorded. Not counted.

## Verification

1. **Pure derivations, tests first, seen failing**: `day.ts` (23:59:59.999 and 00:00 local with
   `TZ` set; the 7 days over a 25-hour day), each figure, the inbox's rows and actions, in flight,
   stopped, landed today, the medians, spend, the events' words; the writer's spend by day from
   transcript lines.
2. **The day read**: a CLI test on real git and records (a file older than `since` skipped, merges
   matched to branches, a cleaned-up Hive record, the writer's spend since `since`); its time on
   this repository's records, under 30 ms.
3. **e2e** (`overview.spec.ts`): Respond focuses the terminal, Review opens the review, Merge into
   queues; Hive's sections from seeded records; no workspaces; the page in `page-frame.spec.ts`
   and `targets.spec.ts`; the specs that open `/` for Git open `/git`.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`; first paint of `/` and `/git`, 10 runs on the
   branch and on `main`.
5. **Audit at 1×, both themes, both modes**: no workspaces, one, many, Hive on with none in
   flight, a stopped one, the budget reached, a narrow window; before and after beside the proofs.

**Risks**

| Risk | Mitigation |
|---|---|
| The day read grows with the records | Files skipped by their time; measured |
| Specs assume `/` is Git | Updated in the commit that moves `/` |
| Ticking times render the page | Clocks in components of their own, as V89's `Since` |
| A transcript's total across a resume | `writerTranscripts` as Hive counts it today: the same paths |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V91a | Pure derivations and their tests | `day.ts`, `normal-overview.ts`, `hive-overview.ts`, `events.ts` |
| V91b | The day read | `GET /api/workspaces/day`, its test |
| V91c | The page, both modes; the address, key, sidenav | `src/overview/`, `pages.ts`, `Sidenav.tsx` |
| V91d | e2e, audit, screenshots, docs | specs, `docs/images`, journal |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 848 | The Overview's address and the start page (replaces V66's `/` → Git) | **`/overview`, first in the sidenav; `/` moved there; key `t`** | the brief; `t` is the one mnemonic letter no page binds |
| 849 | Two modes | **One page and address; `useHive()` picks the body** | the proofs: one place in the sidenav |
| 850 | "Today" | **The local calendar day, from the browser's midnight; days stepped by the calendar** | the person; a 25-hour day is one day |
| 851 | How often the page reads | **The list's read as it is; the day read on change and at midnight; usage shared; settings once** | the person: no new polling where not needed |
| 852 | Where the day's facts come from | **`GET /api/workspaces/day?since=`: threads, Hive's events and records, git's merges; reads only** | 0 queue entries against 73 merges; spend and defects are in records the list does not carry |
| 853 | Normal mode's figures | **Waiting, Agents working, To review, Merged this week, Time to merge** | Findings are not recorded per workspace |
| 854 | The inbox's actions | **Respond, Review, Merge into, Open, Read: each the existing way** | the brief: no second way |
| 855 | Merged today | **git's first-parent merges and the queue's fast-forwards** | the queue keeps none here |
| 856 | Hive's figures; Spend today | **The five of the proof; the writer by its transcripts' growth since midnight** | the person's choice 2; 63 of 63 lines timed |
| 857 | Stopped | **A callout each, three at most; Read why to its Review tab** | the proof; step 5 renames the tab |
| 858 | The kits' parts | **In `src/ui/`, shared; the page in `src/overview/`** | step 5 reuses them |
| 859 | The sidenav's Done | **Folded, "Done" and its count, kept in the browser** | the person's choice 3; not "today": no day is recorded for every merge |

**Not in V91 (later)**: Hive's sidenav groups and two-line rows, the Run tab, Settings' Hive page,
Start in Hive mode, turning Hive on (step 5); normal mode's Merge and Start screens; findings
recorded per workspace.

## As built (V91)

- **The day read** is as planned. Two things were added to reach its cost:
  - Each file's parse is kept until the file changes.
  - The default branch and the records' place are asked of git again only after a minute.

  Warm reads on this repository's records went from 105 ms to 30–34 ms. The first read after a
  start takes 365 ms: the writers' transcripts are read whole once, then from where the last read
  ended.
- **A merge's branch** comes from the merger's subject (`Merge <branch>: …`) or git's own
  (`Merge branch '<branch>'`). The plan also named the second parent's branch: dropped. Git does
  not record it, and naming it costs a `name-rev` a merge. A person's `Merge V90: …` names no
  workspace, so its subject is shown whole.
- **The Done group** keeps its group icon (V44: every group has one), then a button with its name,
  count and a chevron. The proof has only the chevron.
- **Removals fall back to the Overview.** A merge removed from its page and a workspace cleaned up
  from its page or card land there, as the start page's way back does. Before, they went to Git.
- **Read why** is a link to the workspace's Review tab (`/?branch=…&review`), which the shell
  opens in place.
- **The Limits card** shows "Rounds per workspace" only when a Hive record states its round cap: no
  setting holds it. The reviewer shown is the project's model and level, else Symbiote's default
  (Opus, high).
- **The kits' faint words** (notes, branches, times) are `--muted`: `--faint` is for marks only
  (V87, decision 765).
- **Row heights** come from two new tokens, `--height-table-row` (54 px) and `--height-table-line`
  (40 px). The table head uses `--height-tab`.
- **Landed today counts landings only.** An answered spike is listed under Landed today but not
  counted in the figure, which the proof's 5 includes.

**Results.**
- **Unit tests** (all written first and seen failing on stubs):
  - 34 for the Overviews' derivations. The day-boundary tests run in Bucharest and Los Angeles.
    The 25-hour day's cases also fail on a 24-hour step, checked by swapping one in.
  - 6 for the day read, on real git and records.
  - 2 for its server route, seen failing without it.
- **`pnpm check`**: 2,992 tests in 217 files.
- **e2e:**
  - `overview.spec.ts` (4 tests).
  - The Overview in `page-frame.spec.ts` (both modes) and `targets.spec.ts` (empty, and with a
    review waiting).
  - The specs that expected `/`, a removal or the window to land on Git, updated.
- **First paint**: medians of 8 rounds, alternating `main`'s build and the branch's, on a clone of
  this repository with its records (147 workspaces, 14 Hive records), at load 2. `/` on `main` is
  Git; on the branch it is the Overview, drawn once its list is read.

  | | main | branch |
  |---|---|---|
  | `/` content drawn | 224 ms (Git's rows) | 120 ms (the Overview's inbox) |
  | `/` first contentful paint | 92 ms | 84 ms |
  | `/git` content drawn | 232 ms | 225 ms |
  | `/git` first contentful paint | 88 ms | 92 ms |

  An earlier 6 rounds, at load 10 during an e2e run, gave the same picture except for `/`'s first
  contentful paint (main 80 ms, the branch 100 ms). At load 2 that gap is gone. `/git`'s 4 ms
  either way is within the runs' spread (88–100 ms).
