# HV5 — Hive paces itself by usage: a pause until the window resets, a budget cap

[Index](../PLAN.md) · [Journal](../journal/hv5-usage-pacing.md)

**Status:** built, ready for review (2026-11-02), on branch `feature/hv5-usage-pacing` (the
workspace's, a Hive workspace, from `main` at `0a09ef5`); Hive drives it, so no OK was awaited.
Proved with fake usage reads and a fake usage endpoint; no real Hive run paused on real usage.

**Problem** (the brief: "Today a Hive workspace starts writers and reviewers whatever the
subscription's usage says"). Decision 690 promised "a usage or budget cap (HV5)" among Hive's hard
limits, and the North Star's "Within limits beats faster" names it. Nothing reads usage before
Hive starts an agent, and nothing counts what a workspace spent. Measured on this repository's
records (read only):

| Workspace | Writer, by Claude Code's `cost-state` | Running reviews | Total |
|---|---|---|---|
| HV8 (`feature/hive-pull-requests`, 2026-11-02) | $29.18 (one session, 13 starts) | 8 at xhigh, $18.02 ($1.35–$3.44 each) | $47.20 |

- **Where Hive starts an agent** (`hive-runner.ts`): the writer's first start is
  `workspaces.start` (`launch`, `claude --bg`); every message — a failed check, proven defects,
  "commit", a plan's OK, "no one answers", a resume after Hive off, a failed landing — is
  `deliver` → `workspaces.reply`, which stops and resumes the session; a failed writer's
  `restart` → `startAgent`; each running review is `reviewing` → `startReview` (`claude -p`).
  Four places, no check at any of them.
- **What usage Symbiote already reads** (`usage.ts`, V29c): Claude's windows from the endpoint
  Claude Code's `/usage` reads — the 5-hour session, the week, a model's own week (`scope`) — each
  with `usedPercent` and `resetsAt`. `usageService` keeps a copy for 5 min (at 60 s two views were
  refused), waits 5 min after a 429, and keeps the last numbers through a failure. Read now:
  13 % of the 5-hour window resetting at 16:10 UTC, 8 % of the week.
- **What a workspace spent**: each review's `cost` is in its record (`total_cost_usd` of
  `claude -p`). The writer's is in Claude Code's transcript: a `{"type":"cost-state",
  "totalCostUSD": …}` line written at each turn's end, cumulative through resumes (HV8's grew
  $1.78 → $14.87 → … → $29.18 over 24 lines in a 9.5 MB file; the last line of the file at rest).
  Symbiote reads neither as a sum.

**Goal**: before every agent Hive starts, one gate reads the subscription's usage and the
workspace's spend. At or over the threshold (90 % by default) Hive starts nothing for any of its
workspaces until the window resets, then goes on by itself; a workspace at its budget (off by
default) stops, with why. The card, the workspace's page, the Review tab and Settings say so.
**Unchanged under the threshold with no budget**: every gate, word and test of HV4 and HV8; normal
mode untouched.

## The gate (`hive-pacing.ts`, decisions 796–799)

- **One gate** (796), `hivePacing({ root, usage, now })`, one per `symbiote view`, shared by the
  runner and `workspaces.start`. The runner's `paced(where, record)` is the only way to a start:
  `deliver` (every message), `restart`, `reviewing` before `startReview`, and a writer held at
  its start. `workspaces.start` asks the same gate before `launch`. Not starts, so not gated: the
  check (a command, no subscription), landing and the merge queue, the request's watch, Hive off.
- **The usage** (797): `hive.usage.pauseAt` in `symbiote/config.json`, 1–100, default 90. Any
  window of Claude's subscription not reset yet at or over it pauses: of the windows over, the one
  that resets last is the pause's (`minutes`, `scope`, `percent`, `until` its `resetsAt`). While
  paused, the gate answers from its memory: no read until `until`, unless the threshold was raised
  past the pause's percent. After `until`, the next look reads again and goes on.
- **How fresh** (798): the gate reads through the view's `usageService` (one reader of the endpoint
  for the status bar and Hive): its copy stands while under 5 min old; older, the gate waits for a
  new read (still one at a time, the 429 wait kept). Never faster than every 5 min.
- **Unreadable** (799): the last live read stands 15 min from when it was read (its `at`), its
  reset windows dropped. Past that, or with no read at all (no token, the endpoint failing since
  the start), Hive pauses with "usage unknown" and why, and asks again at each look; the first
  read that succeeds decides. 15 min: the 5-hour window moves a few percent in that time, inside
  the threshold's 10 points; past that, stopping beats guessing. `"pauseAt": false` (an account
  without windows, say an API key) and `SYMBIOTE_USAGE=off` (the person's: nothing is read) turn
  the usage part off; the budget still holds.

## The record (decision 800)

- A workspace whose start the gate held gets `paused` in its record: `{ reason: 'usage' |
  'unknown', minutes?, scope?, percent?, pauseAt, until?, why?, since }`, and an event `paused`
  (once a pause); when the gate lets it start, `paused` is removed and the event is `goes-on`.
  The step stays; the message waits in the record (written before it is sent, as 653).
- **A writer held at its start**: `workspaces.start` makes the worktree and both records but no
  session; the workspace's agent is recorded as Claude Code in `auto` at the model and level
  asked, without `started`, and Hive's record has `unstarted: true`. The runner starts it with
  `startAgent` once the gate lets it (not counted as a restart, 773).
- **It survives Hive off/on and a restart**: off stops nothing more (nothing started); on again
  or a new runner primes the gate from the records' pauses whose `until` is to come.

## The budget (decision 801)

- `hive.budget` in `symbiote/config.json`: dollars per workspace, off (absent) by default.
- **Spend** = the writer's sessions by Claude Code's own count (the last `cost-state` line's
  `totalCostUSD` of each transcript the workspace's thread names; its last 256 KB read, again only
  when the file changed) + each running review's `cost`. Written in the record (`spent: { writer,
  at }`) at each turn's end and at each ask of the gate.
- At or over the budget, the gate stops the workspace (`stuck`): "its spend $20.40 reached its
  budget of $20.00 (the writer $14.10, 3 reviews $6.30): raise hive.budget in Settings, then
  send it a message to go on". A turn or review running finishes: at most one turn or one review
  ($5 at most, `REVIEWER_BUDGET_USD`) over.
- A writer's cost that cannot be read (no `cost-state` line: an older Claude Code) is said, and the
  reviews alone count.

## The viewer (decision 802)

- **The card** (from the record, in any step but `stuck`/`landing`/ends while Hive is on):
  "Paused: usage 92 % of the 5-hour window, goes on at 16:10"; the week: "of the week", a model's
  week: "of the week (Opus)"; unknown: "Paused: usage unknown (Claude's usage answered 429)". The
  time is the viewer's local time; another day: "goes on Sun 8 Nov at 23:00".
- **The workspace page**: the Review tab's head says the same; its new **Spend** part: "Spent
  $47.20: the writer $29.18, 8 reviews $18.02", and "of a $60.00 budget" with one.
- **Settings' Hive page**: a **Pacing** part under Hive lands by: **Pause at** (a number, %, or
  off) and **Budget per workspace** (dollars, or none), `PUT /api/hive/pacing`; it says when Hive
  is paused now, and when usage is not read (`SYMBIOTE_USAGE=off`).
- **Notices**: the status bar's line when a Hive workspace pauses ("Halve it paused: usage 92 % of
  the 5-hour window, goes on at 16:10") and when it goes on ("Halve it goes on").

## Verification

1. **The gate** (`hive-pacing.test.ts`, red first): under, at and over the threshold; the window
   that resets last; a reset window dropped; a copy older than 5 min read again; 15 min of
   failures then unknown; off by `false` and by `SYMBIOTE_USAGE=off`; the memory until `until`;
   a raised threshold; `cost-state` read from a transcript (the last one, a changed file read
   again).
2. **The runner** (`hive-pacing-runner.test.ts`, red first; the real runner, fake usage, never the
   endpoint): at or over the threshold no message delivered, no review started, no restart, no
   held writer started, and the record says paused with the window and reset; it goes on by itself
   after `until`; a turn running is not interrupted; the pause survives Hive off/on and a new
   runner; usage unknown after 15 min pauses and a successful read goes on; the budget stops with
   why; under the threshold with no budget, the same records as without a gate.
3. **Every HV4 and HV8 runner test unchanged** (`hive-runner.test.ts`, `hive-request-*.test.ts`).
4. **The start** (`workspaces.test.ts`): a paused gate holds the writer (`unstarted`), no
   `claude --bg`; the runner starts it after the pause.
5. **Viewer**: the words unit-tested (`hive-rounds`, `workspaces`, `transitions`); e2e with a real
   `symbiote view` and a fake usage endpoint: the paused card and Review tab, going on after the
   reset, Settings' threshold and budget written to `symbiote/config.json`, the spend in the Review
   tab; screenshots dark and light.
6. `tsc -p packages/cli`, `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| The usage endpoint refuses Hive's reads | One reader with the status bar, every 5 min at most, the 429 wait kept |
| A pause that never ends (an API-key account has no windows) | "usage unknown" says why; `pauseAt: false` turns the usage part off |
| A turn's cost not yet written when the gate asks | The `cost-state` line is written at the turn's end, before Hive reads the turn as ended |
| Tests reaching the real endpoint | The runner takes a usage function; tests pass fakes; the e2e a local fake endpoint |

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV5a | The gate | `hive-pacing.ts`: settings, the usage decision, the spend; `usageService`'s fresh read; tests |
| HV5b | The runner and the start | `paced` at every start, the record's `paused`, `unstarted`, `spent`; the budget's stop; tests |
| HV5c | The server and the viewer | `/api/hive/pacing`, the card, the Review tab, Settings, notices; e2e, screenshots |
| HV5d | Docs | configuration.md, README, the journal, PLAN.md |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 796 | Where usage is read | **One gate before every agent Hive starts: the writer's first start, every message delivered (a resume starts a turn), a restart, every running review. The runner's `paced` and `workspaces.start` ask the same gate; the check, landing, the merge queue and the request's watch are not starts** | The brief; HV8's lesson: one gate, not a check at each call site |
| 797 | When Hive pauses | **Any window of Claude's subscription at or over `hive.usage.pauseAt` (default 90 %) pauses every start of every Hive workspace until the latest reset among those windows; a turn, check or review running finishes; it goes on by itself at the first look after the reset** | The brief: "a pause until the window resets"; "Hive never interrupts work for usage" |
| 798 | How fresh a read must be | **The view's `usageService` copy while under 5 min old, else a new read before deciding; a pause holds until its reset without a read unless the threshold is raised past its percent** | Two views at 60 s were refused (V29c); a window's use only grows until it resets |
| 799 | Usage that cannot be read | **The last live read stands 15 min from its read; after that, or with none, Hive pauses with "usage unknown" and why, until a read succeeds. `hive.usage.pauseAt: false` and `SYMBIOTE_USAGE=off` turn the usage part off** | Never start blind for long; 15 min is a few percent of the 5-hour window, inside the 10-point margin; an account without windows needs a way out |
| 800 | What is recorded | **`paused` on each held workspace's record (reason, window, percent, threshold, until, why, since), events `paused` and `goes-on`; a writer held at its start: `unstarted`, started by the runner, not a restart; the gate primed from the records at on and at a new runner** | The brief: "the pause is recorded … and survives Hive off/on and a restart"; HV8's lesson: what the card shows comes from the record |
| 801 | The budget | **`hive.budget`, dollars per workspace, off by default: the writer's sessions by Claude Code's `cost-state` plus each review's `cost`; checked before each start; reached, the workspace stops with why; to go on, raise it and send a message** | The brief: "a stop, not a pause: stopping beats guessing"; Claude Code's own count, as the reviews' |
| 802 | What the person sees | **The card and the Review tab: "Paused: usage 92 % of the 5-hour window, goes on at 16:10" from the record; the Review tab's spend; Settings' Pause at and Budget; the status bar's notice at a pause and at going on** | The brief's words |
| 803 | The person's own start while Hive holds one (added while building) | **A message of the person's that reaches the writer while Hive holds its own drops Hive's, and the rounds start again (795's way); a held writer the person started (Start the agent) is theirs: no longer held, never started a second time** | Found by the screenshots: the held writer's page offers Start the agent, and the runner would then have started a second session at the reset |

**Not in HV5 (later)**: each role's model and effort in Settings (HV1's sketch put it in HV5; the
brief leaves it out); Codex and Hermes subscriptions (Hive starts Claude Code only); the merge
queue's check and the merger; Nucleus's and Alpha Ceph's own usage; pacing by the request's forge;
a cap across workspaces.

## As built (HV5)

- **The gate** (HV5a) as planned, in `hive-pacing.ts`: `readPacingConfig`/`setPacing`
  (`hive.usage.pauseAt` 1–100 or `false`, `hive.budget` dollars; the defaults written as no key),
  `usagePause` (pure: the windows not reset and at or over the threshold, the one that resets last;
  unknown past 15 min or with no read), `hivePacing` (the pause held in memory until its reset, a
  raised threshold reads again, primed from the records), and the spend (`costIn`,
  `transcriptCosts`, `writerTranscripts`, `spendOf`). `usageService.claude(maxAgeMs)` reads
  Claude's numbers alone, waiting for a new read once the copy is older than 5 min; the 429 wait
  and the one read at a time are the service's own.
- **The runner** (HV5b): `paced` is the one gate. `deliver` asks it only when a reply is about to
  be sent (a message already in the thread is not a start); `restart` after its cap check;
  `reviewing` after an approved commit goes to landing; `startHeld` for a writer the start held.
  A pause is written once (compared by reason, window, reset and why), the event `paused`; the
  first start after it removes it, `goes-on`. `moveTo` drops `paused` whenever the step changes, so
  a landed or stuck card never says paused; the card shows it only in `writing` and `reviewing`
  (`shownPause`).
- **The budget's stop** goes through `moveTo` (`stuck`, the message dropped), its event with the
  spend and the budget. The writer's spend is written to the record when it changes: at each turn's
  end and at each ask of the gate.
- **Not planned, decision 803**: the person's message while Hive holds its own (a pause of hours
  makes it likely) took the turn, and Hive's message would have been sent on top of it at the
  reset; now Hive's is dropped and the rounds start again. A held writer's page offers **Start the
  agent**; a writer started that way is the person's, and the runner no longer starts a second one
  (found by the screenshots, then a test, red first).
- **Settings** writes with `POST /api/hive/pacing`, as Hive's other settings do (the plan said
  `PUT`). The threshold is a select (never, 50–100 %, 90 % the default, the project's own value
  kept among them); the budget a dollars field with **Save**.
- **The card's pause** has the idle ring, not Hive's spinner: nothing runs. `workspaceNext` takes
  `now` for the time words; `transitionNotice` says a pause and its end though the card stays in
  Hive's group.
- **The e2e** reloads the page after a start made through the API: the workspaces list is not
  polled while no workspace is open.

**Results.**

- **Tests**: `hive-pacing.test.ts` 17 (the settings, the pause a read gives, the gate's memory, the
  spend, Settings' service and the request's parser); `hive-pacing-runner.test.ts` 12, red first
  (messages and reviews went while paused; a held writer started at once; no stop at the budget):
  no message, review, restart or held writer while paused, the record's `paused`, going on after
  the reset, nothing interrupted, the pause through Hive off/on and a new runner whose gate read
  nothing, unknown after 15 min and going on at a good read, the budget's stop by the writer's
  count and by the reviews', the person's message and the person's start, and the same steps,
  events and messages as no gate at all under the threshold; `usage.test.ts` 3 new. Every HV4 and
  HV8 runner suite unchanged and passing (`hive-runner.test.ts`, `hive-request-*.test.ts`).
  Viewer: `hive-pacing.test.ts` 10 (the words, the card, the Review tab's head, the notices,
  Settings' helpers).
- **e2e**: `hive-pacing.spec.ts` 3, a real `symbiote view` on a fake usage endpoint: held at 95 %,
  said on the card, the head and the Review tab, started by itself at the reset with the status
  bar's notice; Settings' threshold and budget written to `symbiote/config.json`; the spend
  against a budget. With the Hive, Settings, targets, page-frame and usage specs: 46 of 46.
- **Screenshots** (1440×900, dark and light): the paused workspace and its Review tab, Settings'
  Pacing part with Hive paused, the Review tab of a workspace stopped at its budget.
