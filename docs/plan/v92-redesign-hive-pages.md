# V92 — Redesign step 5: Hive's pages

[Index](../PLAN.md) · [Journal](../journal/v92-redesign-hive-pages.md)

**Status:** merged into `main` on 2026-11-03; built (3 November 2026), on branch `feature/redesign-hive-pages` (the workspace's,
from `main` at `20c06e8`); the person's OK with choices 1 record `since`, 2 line counts, 3 the
reviewer's model and effort on the Hive mode page, 4 "New goal".

**Problem** (the brief: "Bring Hive mode's own pages to spikes/hive-redesign"). V88 built the
tokens and shared parts, V89 the workspace page (its steps inline in the head, decision 823), V90 a
review's pages, V91 the Overviews. Hive's own pages are still as HV3–HV8 left them, against
`spikes/hive-redesign`'s proofs:

| Page | Today (`20c06e8`) | The proof |
|---|---|---|
| A Hive workspace's Review tab | A sentence, then each round as badges and paragraphs, newest first, each the same weight | 02-run-live, 03-run-landed, 07-run-stopped: a Run tab, the round on a timeline, each check command with its time, the log's tail, a defect as a card, old rounds folded, a stopped or landed callout |
| The sidenav in Hive mode | Groups Hive and Done of V48 cards (up to five lines) | 01-overview: In flight, Stopped, Landed today; rows of two lines; a Hive pill by the project's name |
| Settings, Hive mode | A warning paragraph, the switch, then Hive lands by and pacing as paragraphs with controls | 04-settings (on), normal mode's 11-settings-hive (off): grouped rows, a name, one line of help, the control |
| Start, Hive on | Normal mode's page with a paragraph saying Hive drives it | 05-new-goal: New goal, Hive's check, Where and who, How Hive runs it |
| Turning Hive on | The question (circuit art, a paragraph, refusal as a list); the arrival: the Mind grows, a hex shutter closes, the look swaps, the shutter opens (decision 816) | 09-turn-on, 09-turn-on-refused: the art kept, the four steps, a readiness list; the arrival in 1.4 s as opacity, transform and one clip-path |

What the pages lack that the records have: each check command's time and the last passing
check's (`HiveCheck.steps`, `HiveLive.expected`, decision 693), the log's tail (decision 695),
each landing's commit and push, the spend and budget (HV5). What no read carries yet: each
commit's lines (the writer's "+34 −6"), the check Hive will run (the viewer never reads
`merge.checks`), and when Hive was turned on (`hive.json` holds `on` alone).

**Goal**: those five pages as their proofs, in both themes, from what Symbiote records; what Hive
does (its loop, check, reviewer, landing, pacing) unchanged. Normal mode's pages unchanged but
Settings' Hive mode page and the question it opens. First paint no slower than `main`.

## The Run tab (decisions 860–867)

- **Renamed** (860): a Hive workspace's tab is **Run**, `&run` in the address (`View` `'run'`);
  `&review` opens it too. Read why on the Overview (857) links to `&run`. A workspace started in
  normal mode keeps Review.
- **The round on a timeline** (861), from a new pure `workspaces/run-timeline.ts`: each round is
  a list of nodes on a vertical line — **Writer**, **Check**, **Running review**, **Land** — each
  done, running, waiting or failed, with its icon in its state's colour (amber in progress, green
  passed, red failed, faint waiting).
  - **Writer**: its commits in the round, those after the previous round's checked commit up to
    its own check's (`HiveCheck.at`), from the side card's changes read; their lines (added,
    removed: choice 2, below); its time from the round's start (the workspace's `created`, else
    the previous round's review or check end) to its check's `started`; what it did: "wrote the
    goal" in round 1, "fixed the proven defect(s)" after a review that kept findings, "fixed the
    failing check" after a failed check, else "went on".
  - **Check** (862): on its commit; each command with its time; while it runs, the running
    command's time against the last passing run's (`live.expected`) with a bar, `4:12 / ~7:00`.
    A failed command says "failed" in red.
  - **The log's tail** (863): while a check runs, its log's last 4 lines under the commands, read
    from `GET /api/workspaces/hive/log` on the tab's existing tick. **Full log** opens the kept
    log as today (`KeptLog`).
  - **Running review**: its verdict, model, effort, time and cost; its summary in quotes; "What it
    ran" as today.
  - **A proven defect is a card** (864): Proven, the defect, the test's name, its command, "rerun
    by Symbiote · exit N"; a dropped finding is one faint line with why.
  - **Land**: where and how, or what waits ("after an approval: merge queue into main, then
    push").
- **Older rounds fold** to one line each: the round, its verdict as a status (`1 defect proven`,
  `Check failed`, `Approved`), the first defect or the failed command, the check's time and the
  review's cost; a click opens it. The current round is open.
- **Stopped** (865): a red callout first: "Hive stopped after 3 rounds" (or the budget, or the
  note's words), why, the failing output's last lines, **Message the writer** — the page's
  crimson primary, which opens the Thread tab's composer focused (the one way to message the
  agent) — and **Full log**.
- **Landed** (866): a green callout: "Landed in main", the merge commit, what was pushed, when;
  by request, the request's link.
- **The side card on the Run tab** (867, amends 832 for Hive workspaces): **Run** (stage, writer,
  reviewer, lands in, pushed; landed or stopped and when), **Spend** (total, budget bar, writer
  and reviews), **Commits**, **Files**. Other tabs keep V89's.

## The sidenav in Hive mode (decisions 868, 869)

- **Groups** (868, supersedes 774's Hive and Done groups and 698's Hive group), from a new pure
  `hiveGroups()` in `workspaces.ts`:
  - **In flight**: writing, checking, reviewing, landing, paused for usage (its word cyan).
  - **Stopped**: stuck, the round cap, the budget reached.
  - **Landed today**: landed (`landing.ended`) or answered (`lastAction`) since the browser's
    local midnight (850), the newest first, the time at the row's end.
  - **Earlier**: landed or answered before today, folded as 859's Done, kept in the browser.
- **Rows of two lines** (869): the title; then the state's word in its colour, then round and
  live time faint (`Checking 4/4 · round 2 · 7:23`). The icon is the state's (amber spinner,
  red stop, green check, a speech bubble for an answered spike). The Hive pill (`● HIVE`, crimson)
  beside the project's name (amends 822), not in the rail.

## Settings' Hive mode page (decision 870)

One page in both modes, as grouped rows — a name, one line of help, its control:

- **The head**: Hive mode, On or Off, "for <project> since <when>" (choice 1); **Turn off Hive**
  (secondary, red words, 819) or **Turn on Hive mode** (crimson).
- **Off**: a callout says what Hive does, with the four steps' track. **On**: a note says Hive
  runs agents with full access to this machine, never force-pushes or deletes work, and what off
  and on again do.
- **Landing**: Lands through (Merge queue · Pull request, segmented); The check (its commands,
  from `merge.checks`, or that none is set); Pull and merge requests (origin and the token, when a
  request is the choice or a forge is found); Rounds (3 per workspace, read only).
- **Limits**: Pause by usage (select); Budget per workspace (`$` field).
- **Running reviewer**: Model and effort, two selects (choice 3: moved from the Reviewer page,
  which keeps its prompt and links here).
- **The foot**: which `symbiote/config.json` keys and `symbiote/hive.json` hold it.

## Start in Hive mode (decision 871)

- The head **New goal**, "Hive drives it from the brief to landed in <from>, and no step waits for
  you"; the primary **Start goal** (crimson) with its keys (choice 4).
- No plan first and no permissions (Hive's, 773). Under Done when: **Hive's check**, its commands
  as chips, "from merge.checks"; none set: a red line saying Hive will review without a check.
- The right column: **Where and who** (starts from, branch, agent: Claude Code, model and effort)
  and **How Hive runs it** (Write, Check with its number of commands, Review with the reviewer's
  model, Land with where and how; chips for the rounds, the budget, the pause).

## Turning Hive on (decisions 872–874)

- **Readiness** (872), a new pure `hiveReadiness()` in `hive-switch.ts`:

  | Item | Passes | Fails |
  |---|---|---|
  | A check is set | `check` in `/api/hive/state`: its commands, "from merge.checks" | No check: **blocks** |
  | No workspace in normal mode is open | `normal` empty | The workspaces named as chips: **blocks** |
  | Limits | always: "pauses at 90 % · $5.00 a workspace · 3 rounds" | — |
  | Full access | never passes: a warning, "its agents can run anything on this machine" | does not block |

  **Turn on Hive** is off while one blocks (the person's OK: stricter than today, which turns on
  without a check). The server still refuses only open normal-mode workspaces (772).
- **The question** (873): always Hive's ink (615); the circuit art as it is (`HiveJoining`, the
  same canvas and timings); "Turn on Hive mode for <project>"; one line; the four steps on a track;
  Before it starts; "Nucleus becomes Alpha Ceph, and its conversation starts again."; a foot with
  "Turn it off any time; nothing done is undone.", Cancel and **Turn on Hive**.
- **The arrival** (874, supersedes 816; replaces 632's and 673's shutter): 1.4 s, as the README
  times it:

  | When | What | How |
  |---|---|---|
  | 0–0.42 s | The steps arm one after another | CSS: each node's fill and stroke, the wires' `scaleX` |
  | 0.39–0.53 s | The question folds | opacity, `scale(0.95)` |
  | 0.38–0.84 s | The Mind lifts from the art and fades | a copy of the art's middle (128 px) in a layer of its own: transform, opacity; its glow a drawn layer's opacity, no `filter` while it moves (631) |
  | 0.54–0.86 s | The dim lifts | opacity |
  | 0.56–1.18 s | Hive's look opens in a growing circle behind a crimson ring | a View Transition: `::view-transition-new(root)`'s one `clip-path`; the ring a circle scaled by transform |
  | 1.16–1.54 s | The Hive pill lights | opacity, a sweep by `translateX` |

  The look swaps (`data-mode`) inside `document.startViewTransition`. Without the API it swaps at
  0.56 s with no circle. Reduced motion: at once, no animation. The canvas shutter
  (`arrive()`, `arrivalScene`, `Painter.arrival`) goes. Alpha Ceph's becoming (V86) runs after,
  as today.

## Reads (no record changes but one)

- **`symbiote/hive.json` records `since`** (choice 1): when Hive was last turned on, written with
  `on: true`, left out when off. `/api/hive` returns it. The one record change.
- **`/api/hive/state` gains `check`**: the commands Hive would run on the default branch's tip
  (`projectCheck()`, as the runner finds them) and where from; absent when none.
- **`WorkspaceCommit` gains `added` and `removed`** (choice 2): `git log --shortstat`'s counts in
  the changes read the side card already makes.

## Verification

1. **Unit, red first**: `run-timeline` (rounds, the writer's commits split by checks, its words,
   folding, a running check's times, stopped, landed); `hiveGroups` (before and after midnight,
   paused, the budget, answered, the order); `hiveReadiness` (no check, normal workspaces open,
   ready); the tab's address (`&review` → Run in a Hive workspace); the server's `since`, `check`
   and commit lines.
2. **e2e, red first**, with the fake agent and seeded records: the Run tab live, landed and
   stopped, Message the writer; the sidenav's groups; Settings on and off; Start in Hive mode; the
   question ready and refused; the arrival under Playwright's clock (frames at 260, 560, 800, 1000
   and 1600 ms; every animation finished by 1540 ms; reduced motion at once).
3. **The arrival's frames and fps**: filmed in the app (`film.mjs live`) beside the proof's
   frames; its frame times measured in the app on this machine (WSL, software rendering), today's
   and V92's.
4. **Audit at 1x, both themes** (`symbiote-style`): Hive off, on with none, writing, checking,
   reviewing, landing, stopped at the round cap, paused, budget reached, landed by request; a
   narrow window; reduced motion. Screenshots before and after beside the proofs.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`; first paint against `main` (`viewer-check`).

**Risks**

| Risk | Mitigation |
|---|---|
| View Transitions under software rendering stutter | Measured before building on it; else two stacked layers with the same timings |
| Turn on needs a check: e2e that turn Hive on in a fixture with none | Set `merge.checks` in those fixtures; the server is unchanged |
| `Sidenav.tsx` is 967 lines | Hive's rows in a component of their own |
| `hive-pacing.spec.ts:108` between 23:00 and midnight, `intro.spec` under load | Known flakes: rerun alone, report, no patch |

**Order**: plan; failing tests; the reads; the Run tab; the sidenav; Settings; Start; the question
and the arrival; verification and docs.

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 860 | A Hive workspace's Review tab (amends 857's target) | **Run, `&run`; `&review` still opens it; Read why links to it** | the README: nobody reviews by hand there |
| 861 | The round | **A timeline: Writer, Check, Running review, Land; the current round open, older ones one line each** | proofs 02, 03, 07 |
| 862 | A check command's time | **Its time; while it runs, against the last passing run's, with a bar** | `HiveLive.expected` (693) |
| 863 | The log's tail | **The running check's last 4 lines, on the tab's existing tick** | proof 02; no new polling |
| 864 | A proven defect | **A card: Proven, the defect, its test and command, the rerun's exit** | proof 03 |
| 865 | A workspace Hive stopped | **A callout: why, the failing output, Message the writer (the Thread's composer), Full log** | proof 07; one way to message |
| 866 | A landed workspace | **A callout: where, the merge, what was pushed, when** | proof 03 |
| 867 | The side card on Run (amends 832) | **Run, Spend, Commits, Files** | the proofs |
| 868 | Hive's sidenav groups (supersedes 774's Hive and Done; replaces 698's Hive group) | **In flight, Stopped, Landed today; Earlier folded** | proof 01; 850's today |
| 869 | Hive's rows and its pill (amends 822) | **Two lines; the Hive pill by the project's name** | kit.css `.ws`; proof 02 |
| 870 | Settings' Hive mode page | **Grouped rows: Landing, Limits, Running reviewer; the reviewer's model and effort moved there; "since"** | proofs 04, 11; choices 1, 3 |
| 871 | Start in Hive mode | **New goal, Start goal, Hive's check, Where and who, How Hive runs it** | proof 05; choice 4 |
| 872 | Readiness | **A check set and no normal-mode workspace block; limits shown; full access a warning** | the brief; only what Symbiote can know |
| 873 | The question | **The circuit art kept; the steps; Before it starts; Turn on Hive off while one blocks** | the person: "I like the animation from the dialog" |
| 874 | The arrival (supersedes 816; replaces 632's and 673's shutter) | **1.4 s of opacity, transform and one clip-path in a View Transition; at once with reduced motion** | the README's timings; 631 |

**Not in V92 (later)**: normal mode's Merge and Start screens (05-merge, 06-start); the pipeline
card of proofs 02, 03, 07 (V89's inline steps kept, the person's OK); the status bar's Hive line;
the terminal's theme.

## As built (V92)

- **No record changes at all**: `hive.json` already wrote `since` when Hive turned on (V82's
  `hiveRecord`); nothing read it. V92 adds `HiveRecord.since()` and serves it from `/api/hive`
  and `/api/hive/state`. The check is `projectCheck(repo, repo.root, 'HEAD')`, the runner's own;
  one that cannot be read is none. Each commit's lines are one `git log --no-walk --numstat`
  (`commitLineCounts` in core) beside the changes read's commit details.
- **The writer's time in the round Hive checks now** ends at the running check's start
  (`live.started`), not a recorded check's: the round has none yet.
- **Message the writer** opens the Thread tab and focuses its box (the one way to message), not the
  terminal: the person reads the stop first, then writes.
- **The sidenav's rows** are their own component (`shell/HiveSidenav.tsx`); the rail shows each
  row's state icon. With no workspace, In flight says "Nothing yet: start a goal" in place of the
  sidenav's "No workspaces yet". Earlier folds as 859's Done, kept under its own key.
- **Settings**: the Lands through choices read **Merge queue** and **Pull request**, as the proof;
  `landsByWords`, `forgeWords` and `onRefusal` went with the paragraphs they wrote. The reviewer's
  selects say their defaults short ("Opus 5.5 (default)", "High (default)"): the long labels
  wrapped the row. The shell's context carries the repository's name for "for <repo> since …".
- **Start**: in Hive mode Clear and the "Be specific" tip are left out, as the proof; Documents
  move under the brief. Normal mode's page is as it was.
- **The arrival's layers**: the question and its dim are named in both states, their old images
  never shown and their new ones live, so the steps arm inside the transition; the Mind, its glow
  and the ring are made in the update callback, new only. `data-hive-arrival` carries the
  transition's rules from its first frame, `data-hive-arriving` is set once it is ready (its
  animations exist). The pill's light runs on the live page inside the revealed circle. The ring
  is a 480 px layer scaled to the window's farthest corner, its line and light drawn a third as
  thick: a layer the window's size dropped 3–5 frames of the reveal in software (below).
- **The shutter's code went**: `arrivalScene`, `arrivalScale`, `combLattice` and the rest of
  `hive-art.ts`'s arrival, `Painter.arrival`, and their tests (decision 874 supersedes 816; 632's
  and 673's shutter replaced). The question's art is untouched.
- **A row waiting for the person's merge** (HV8) is the person's turn: "Waiting for your merge ·
  #12 on GitHub" in violet; the request's link is the Run tab's, not the row's.
- **The older Hive specs** (`hive`, `hive-loop`, `hive-pacing`, `hive-review`, `hive-request`,
  `alpha-ceph`) asserted HV4's cards, the Review tab, the shutter and the old question; they read
  the new pages now, and their repositories set a check.

**Results.**

- Tests first, seen failing: 4 unit files and 3 CLI tests (missing modules and functions), and
  8 of 8 e2e in `hive-pages.spec.ts` on missing elements. Now `pnpm check`: 220 files, 3,008
  tests pass. `pnpm test:e2e`: 418 passed, 5 failed on the first full run: four in
  `alpha-ceph.spec.ts` on the old question (updated, 8 of 8 then pass) and
  `codex.spec.ts:148`, a normal-mode Codex card V92 does not touch, which passes alone.
- **The arrival's frames** at 260, 560, 800, 1000 and 1600 ms, every animation paused at the
  same time, match the proof's frames (the review page shows them side by side); its last
  animation ends at 1,540 ms (e2e); reduced motion turns on with no transition (e2e).
- **Its frame rate in the app** (Electron 44, software compositing as on WSL, Xvfb, 1440 × 900,
  3 runs over the first 1.6 s): 58.8, 58.8 and 59.4 fps, the only slow frame the transition's
  capture at the click (33–50 ms). Main's shutter: 60.0 fps, none slow.
- **First paint** (Bitwarden `737ee3f`, `scripts/viewer/measure.mjs`, this branch and `main`'s
  own build at `20c06e8` alternated, 3 rounds): 334, 338, 321 ms against 355, 328, 325 ms.
- Screenshots before (main's build) and after, both themes, beside the proofs; more states
  (paused, budget reached, a request waiting, Hive on with none, 390 px):
  <https://claude.ai/artifact/FKeVN1DAvHw2jdGc2NJPia> (private until shared).
- Not done: a real Hive run (the e2e's fake agent and seeded records only); WSLg's own display
  (the app measured on Xvfb). The README's `docs/images/hive.png` and `hive-settings.png` show
  the pages before V92 and are out of date.
