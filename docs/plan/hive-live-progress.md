# Feature — Hive's live progress on the card and the workspace page

[Index](../PLAN.md) · [Journal](../journal/hive-live-progress.md)

**Status:** built, ready for review (2026-10-31), on branch `feature/hive-live-progress` (the
workspace's, from `main` at `cd1956a`). The person's answers to the plan's three questions: 1, an expected time only
from a passing check of the same commands; 2, Hive's cards a sidenav group of their own, "in the
hive animation style, with that hexagonal background"; 3, every run's log kept. And: "Keep it full
working … Avoid the risks, or resolve them if those are necessary."

**Problem** (the person, 2026-10-31: "There is no clear feedback for Hive: running the check... It
should be more visible in the card, and in the Workspace page." And: "Keep in mind that each
repository have its own commands for review process."). While Hive checks or reviews a workspace,
its card says only "Hive: running the check" or "Hive: reviewing" with ⚙ under Working
(`packages/viewer/src/workspaces/workspaces.ts:461–466`); the Review tab says "Running the check,
round 1 of 3" and shows only finished checks and reviews. Measured in Hive's records of this
repository:

| Fact | Measured |
|---|---|
| Hive's checks (`pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, `pnpm test:e2e`) | 7 checks, 405–449 s each: about 7 minutes with no word of where it is |
| A running review (chore/hive-north-star) | 124 s, 18 tool calls; its stream 234 KB, 140 lines |
| The reviewer's stream | written to the cache only once the reviewer ends (`hive-review.ts`: `writeFile(request.log, answer.stdout)`) |
| The running check in the record | `{pid, started, at}`; `started` is rewritten at each command: the check's start is lost; which command runs is not recorded |
| A check's output | kept only as its last 60 lines once it ends (`lastLines`) |
| The card's time | the writer's `activity.since`, not Hive's step |

**Goal**: while Hive checks, the card and the page say which of the repository's check commands
runs, for how long (ticking), against the last check's time in that repository when there is one,
and the round; the Review tab lists each command done (✓ and its time), running (its elapsed time)
or waiting, and shows the output as it comes. While Hive reviews, the card and the page say so with
the elapsed time and what the reviewer runs now, from its own stream. Hive's steps are a state of
their own on the card, in a sidenav group "Hive" with Hive's hexagons. Every run's log is kept and
can be read again from its round.
**Unchanged**: Hive off, and every workspace Hive does not drive: as on `main`. Hive's loop (when it
checks, reviews, sends or lands) is not changed.

## The record (decisions 693, 694)

Hive's runner (`hiveRunner` in `packages/cli/src/hive-runner.ts`, in the `symbiote view` that holds
`symbiote/hive/runner.lock`) is the only writer of `symbiote/hive/<branch>.json`.

- **The running check** (`HiveFile.check`) gains `commands` (all of them, in order), `step` (the
  index of the command running), `since` (that command's start), `done` (`{ms, ok}` of each command
  ended) and `log`; `started` is the check's own start from now on (it was each command's).
- **A check ended** (`HiveCheck`) gains `commands`, `steps: {command, ok, ms}[]` and `log`.
- **The running review** (`HiveFile.review`) gains `log`; **a review ended** (`HiveReview`) gains
  `log`.
- Optional fields: a record written before this reads as before.
- **No new race** (decision 694). The runner rewrites a record whole (`writeFileWhole`: a temp file
  renamed), from several paths of one process: the tick, a check running beside it, a review's
  `onPid`. A path that writes from a copy it read earlier would undo what the tick wrote meanwhile.
  So: the check's per-command write, which already exists, reads the record again and writes only
  while it is still `checking` this check (as `onPid` already does for a review), queued one after
  another; a review's phase and what it runs now are **not** written in the record at all: they are
  in its log, which only that review appends to. The record names the log once, with the pid it
  already writes.

## The live logs (decisions 695, 696)

- One log per check and per review, `symbiote/hive/<branch>/logs/<id>.jsonl`, beside the record and
  the kept tests (`r<round>/`), `<id>` the run's start and 6 random hex digits. Every run's log is
  kept (the person's answer 3): the merge log's limit per step (the first 512 KB and the last
  512 KB of its output) keeps one at about 1–2 MB at most. They go with Hive's record of the
  workspace.
- **The merge log's format and writer** (`MergeLogLine`, `mergeLogs` in `merge-log.ts`, V46a), the
  step generic: a merge's steps `merge | resolve | check | land`, Hive's `check | install | review
  | rerun`. A check: a step per command, titled with it, its output as it comes (`runGroup` gains an
  `onOutput`), its end. A review: its install commands in the copy, the reviewer (its stream's
  events as `claudeLine` reads them for the merger, V46b, through `spawnGroup`'s `onLine`), each
  finding's rerun. The reviewer's raw stream is still kept in the cache as HV3 keeps it.
- **`GET /api/workspaces/hive/log?branch=&log=&from=`**: a log as server-sent events, as
  `/api/merges/log` (`lines` from a byte offset, read again every 250 ms); a name that is not a
  log of that branch is refused.

## What the card and the page read (decision 697)

- `WorkspaceHive` (the card) and `WorkspaceHiveDetail` (the Review tab) gain `live`:
  - checking: `{kind: 'check', started, commands, step, since, done, log, expected?}`;
  - reviewing: `{kind: 'review', started, log, phase?, title?, doing?}`: the phase (`install`,
    `review`, `rerun`), its title and the reviewer's last tool call (`Bash: pnpm vitest run …`,
    `Read: src/x.ts`) from the last 32 KB of the running review's log, read only for a workspace in
    `reviewing`.
- **Expected time** (the person's answer 1): the latest *passing* check, in any Hive record of the
  repository, whose `commands` are the running check's: its time, and each command's from its
  `steps`. None (a first check, the commands changed, records before this feature): no expected
  time, the elapsed time only, never a guess.
- **No check set or found**: Hive reviews without one (decision 674, its note); the card and the
  head say "no check found" while it reviews.

## The card (decisions 698, 699)

- **A state of its own**: a `hive` tone, the hexagon as its mark, Hive's crimson, its dot pulsing
  as a working one's. The sidenav lists the cards in Hive's steps (checking, reviewing, reading the
  writer's turn) in a group "Hive" of their own, before Working; the writer at work stays under
  Working.
- **Hive's look** (the person's answer 2): the group and its cards on a honeycomb of hexagons, the
  hex shutter's, faint, with a slow streak of light passing over them as over Hive's pages
  (`ui/hive.css`); still under `prefers-reduced-motion`. In Hive mode's crimson while Hive is on;
  a Hive workspace's live state shows only while Hive is on.
- **The words**, the time ticking each second in the browser from the recorded start (the list's
  polling unchanged):

  | State | The card |
  |---|---|
  | Several commands, the last check's time known | `Checking 4/4: pnpm test:e2e · 4:12 of ~7 min` |
  | One command | `Checking: npm test · 0:42` |
  | A first check | `Checking 2/4: pnpm check · 1:10` |
  | Reviewing | `Reviewing · 1:05 · Bash: pnpm vitest run test/x.test.ts` |
  | Reviewing, no check set or found | `Reviewing · 0:35 · no check found` |
  | Reading the writer's turn | `Hive: reading its turn` |

  The round stays the card's hexagon fact (1/3). The card's time and the head's "· 12 min" are the
  Hive step's elapsed time. Folded, the card is its dot in Hive's tone and its tip says the words,
  ticking.

## The workspace page (decision 700)

- The head: the card's words, ticking.
- The Review tab, while Hive checks or reviews: a "Now" section first — its steps (each command ✓
  and its time, running and its elapsed time, waiting with "~2 min" when its last time is known; a
  check of one command its one step) and its log in a read-only terminal that follows the end,
  streaming; while reviewing, its install commands, "The reviewer" with what it runs now, and its
  reruns, the reviewer's thinking, words and tool calls in the terminal as the merge log shows the
  merger's.
- The rounds below: each check with its commands' times; each check and review a "Its log" that
  opens its kept log in the same view.
- One view for both logs: `MergeLog.tsx`'s steps and terminal become a component the merge log and
  Hive share; `logRuns` takes what runs and the commands instead of a `MergeEntry`.

## Verification

1. **Unit tests first, red**: the runner (a check of several commands and of one: the record's
   commands, step, since, done and log; its output in the log as it comes; the expected time from
   the same commands' last pass, none at first or after the commands change; no check found; a
   review's log with its phases and the reviewer's events; the guarded per-command write not undoing
   a tick's write); the log endpoint; the card's and the tab's words in every state; Hive off and a
   workspace Hive does not drive as on `main`; `logRuns`' merge cases unchanged.
2. **e2e** (`hive-loop.spec.ts`): a slow fake check of three commands (`sleep` and lines) — the
   card's command and ticking time, the "Hive" group, the folded tip, the tab's steps and its output
   arriving; a check of one command; a running review from a fake `claude` printing stream-json
   slowly — "Now: …" on the tab; the merge log's specs unchanged.
3. `pnpm check`, `pnpm build`, `pnpm test:e2e`.
4. **viewer-check and symbiote-style**: the card open and folded, the head, the Review tab, in both
   themes at 1x and 15 px; Hive off as on `main`.
5. **A real Hive run** of the branch's `symbiote view` in a scratch repository: the card and the
   tab on a real check and a real reviewer.

**Risks**

| Risk | Mitigation |
|---|---|
| A write from an old copy of the record undoes the tick's | Decision 694: no new record writes during a review; the check's per-command write read fresh and guarded |
| The merge log broken by the shared view | Its e2e specs unchanged and run; `logRuns` unit tests |
| A log growing without end | The merge log's 512 KB + 512 KB per step |
| The card's ticking costs renders | One timer for the live Hive lines only, each second, none while nothing runs |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 693 | What the record keeps of a running check | **Its commands, the one running and since when, those ended and their times, its log; `started` the check's start** | The card and the tab need where the check is; today's `started` lost the check's start |
| 694 | Writes beside the tick | **None new during a review (its phase is in its log); the check's per-command write reads the record again and writes only while it still runs that check** | A whole-record write from an old copy undoes the tick's; the person: avoid the risks |
| 695 | Where a run's output goes | **A log per check and review beside Hive's record, in the merge log's line format and limits, every run's kept** | The brief: "the check's output streamed to a file beside Hive's record"; the person's answer 3 |
| 696 | The reviewer's stream while it runs | **Its events into the review's log as they come (`claudeLine`), the raw stream kept as HV3** | HV3 wrote it only at the end; "what it runs now, from its kept stream" |
| 697 | The expected time | **The latest passing check of the same commands in the repository; else none** | The person's answer 1: never a guess |
| 698 | Hive's steps on the card | **A tone and group "Hive" of their own, before Working, with the hexagons of Hive's look** | The brief: "a state of its own, told apart from the writer working"; the person's answer 2 |
| 699 | The card's words | **The command, its place among several, the elapsed time against the expected; the reviewer's last tool call** | Whatever the repository's check is; one command has no "1/1" |
| 700 | The Review tab's live part | **The merge log's view shared: steps and a streaming terminal, for the running check or review and each kept log** | One way to read a run's log in Symbiote |

**Not in this feature**: controls (stop, skip, rerun a check); Hive's loop and its two runner flaws
(a message at landing reruns the check on an unchanged tip; a check's failure sent after the branch
merged); an expected time for the review.

## As built

- **The reviewer's answer is said, not shown** (found on real data). Run over a real reviewer's kept
  stream (chore/hive-north-star's review: 234 KB, 140 lines), its last call is `StructuredOutput`
  with the whole JSON answer: the card would have shown it as what the reviewer runs. It is the
  note "Writing its answer" in the log and on the card.
- **A shell command as typed** in a log's tool line: `Bash: pnpm vitest run …`, where the merge log
  showed `{"command":"…"}` (`toolInput` in `merge-agent.ts`). The merge log gets it too.
- **A new run's log starts empty** (found by e2e): when the check ended and the review began, the
  Review tab's Now kept the check's steps. `StepLog` resets its lines for a new log, and Now mounts
  one per log.
- **The guarded write (decision 694)**: reading the runner again, the tick writes nothing on a
  branch whose check this runner runs (it only watches it), so the old `current` copy undid nothing
  in practice. The check's write reads the record again and is guarded all the same; a test writes
  the record between two commands and finds its field kept.
- **The Hive group is a card of its own**, as Waiting for you's: a crimson hairline, the hexagons
  (a 26 × 45 px SVG tile as a mask over the crimson, 16 %), and a band of light crossing them every
  5 s; each card on a dark wash over them, so its words keep their contrast. Folded, the group keeps
  its band, and each card its dot with its time under it. A card's words are muted as every card's.
- **Times**: the card's and the head's on a clock (`4:12`, `of ~7 min`); the Review tab's steps in
  the merge log's own words (`7.4 s`, `2.1 min`), as the merge page shows them.
- **Not built: the real Hive run of the branch.** A real writer in a scratch repository stops at
  Claude Code's "not trusted" question in a folder an agent made; what it would have shown was
  checked otherwise: the real reviewer stream above, the real `pnpm` scripts of the e2e
  screenshots, and the runner's tests with real shell commands. This workspace's own Hive runs on
  `main`'s code until it lands.

**Results.**

| What | Measured |
|---|---|
| The card's read of a running review's log (905 KB: a 900 KB install, the real stream) | 4.2 ms the first time, 0.33 ms each read after |
| A real reviewer stream through `reviewerEvents` | 17 calls, 3 texts, 1 thinking; its answer said |
| `pnpm check` (format, lint, types, unit tests) | passes: 2,663 tests in 185 files. New: 7 in the runner, 1 for the reviewer's events, 1 for the log stream; the viewer's words (`hive-live.test.ts`, 7), a Hive run's steps (`merge-log`, 2), a Hive transition (1); `workspaces` updated for the group |
| `pnpm build`, `pnpm test:e2e` | pass: viewer 373 of 373, nexus 20 of 20 |
| e2e | 2 new in `hive-loop.spec.ts` (a slow three-command check then a running review; one command, then its expected time); `merges.spec.ts` unchanged, 17 of 17 with them |
| Screenshots | the card, the group, the folded rail and its tip, the head, the Review tab while checking and reviewing, a finished round's log: dark and light at 1×; Hive off: as on `main` |
