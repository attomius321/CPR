# HV4 — Hive drives a workspace from start to end

[Index](../PLAN.md) · [Journal](../journal/hv4-autonomous-landing.md)

**Status:** planned (2026-11-01), on branch `feature/hv4-autonomous-landing` (the workspace's,
from `main` at `6aed550`, `main` merged in at `4cdce3b`); not started. The person's answers are in
the decisions below. Not built yet, by the person's choice: "Plan, but don't start implementing.
We don't have enough weekly session."

**Problem** (the brief: "Build HV4: autonomous landing"; the person, 2026-11-01: "the North star of
Hive mode is a fully autonomous system. From the start to the end"). A Hive workspace still waits
for the person at its start, along the way and at its end. Hive asks for landing and waits for
Land (decision 681), measured in Hive's records and `main`'s reflog (UTC):

| Workspace | Landing asked | `main` moved | Between |
|---|---|---|---|
| `feature/alpha-ceph-hive-name` | 12:26:11 | 13:37:51 | 71 min 40 s |
| `feature/hv3-running-reviewer` | 12:42:59 | 14:22:42 | 99 min 43 s |
| `chore/hive-north-star` | 14:43:19 | 14:51:10 | 7 min 51 s |
| `feature/hive-live-progress` | 16:25:15 | 16:36:06 | 10 min 51 s |
| `chore/check-timeout-comment` | 10:37:56 | never | over 14 h, still at `landing` |

Each includes the merge queue's own check after Land: approve to landed is a median 6.9 min, p90
11.0 min, over 72 merges (AR1). Before landing, the person's gates in this repository (AR1, 131
workspaces): plan first in 121, answered in a median 2.4 min; 29 permission prompts in 21
workspaces, answered in a median 69 s; AskUserQuestion 20 times. After landing:

| Fact | Measured |
|---|---|
| Merges into `main` that conflicted (AR1) | 53 of 148; with `docs/JOURNAL.md` merged as a union (AR2, decision 743), 17; 8 in code |
| The merger's resolutions (AR1) | 41, a median 5.7 min; the person confirmed them in a median 0.5 min |
| Merge checks (AR1) | 89; 12 failed, all on timing-sensitive e2e tests |
| `merge.push` in this repository | `true`: each landing pushes `main` today |
| The queue holds its target | while an entry is `ready`, `needs-you` or `failed` (`merges.ts`, `holding`); decision 717 counts `failed` as not landing, so a failed Hive landing would hold `main` |

**Goal**: in Hive mode a workspace goes from the person's brief to landed in the branch it started
from, pushed, with no step waiting for the person. The sidenav has two groups, Hive and Done.
**Unchanged with Hive off**, and for every workspace Hive does not drive: every gate, word and
group as on `main`.

## A Hive workspace from start to end

| Step | Today | HV4 |
|---|---|---|
| Start | The person (Start, or Alpha Ceph on their Confirm) | Unchanged: the brief is the input. Alpha Ceph's Confirm stays until HV7 |
| Hive on | Turns on whatever is open | Refused while a workspace started in normal mode is open and not merged (decision 772) |
| Plan first | Waits for the person's OK | Not offered on Start in Hive mode; a plan that comes anyway gets `hive.plan`, Hive's OK |
| Permissions | The mode picked on Start; a prompt waits | The writer in Claude Code's `auto` mode; anything that still asks gets `hive.decide` |
| Questions | Wait for the person | `hive.decide`: decide from the brief and the repository, say what you decided |
| The writer fails or never starts | "Its agent failed", waits | Started again once with `hive.resume`; a second failure stops |
| Check, review, rounds | Hive's (HV2, HV3, decisions 716–721) | Unchanged |
| Out of rounds, a turn Hive cannot see | `stuck`, read as waiting for the person | Stopped, with why (689); the person's message still starts the rounds again |
| Landing | Land | Hive approves and queues (decision 767) |
| A conflict | The merger's resolution waits for Approve | The writer merges the start branch in (decision 769) |
| The merge's check fails | Send to the agent, on the person's press (742) | `hive.land`, sent by Hive |
| The person's checkout in the way | `ready`, waits for Land | Retried each minute (decision 770) |
| Pushing | The person, or `merge.push` | The branch after each turn; the start branch after landing (decision 768) |
| Hive off | At once | Asks first while work is in flight, saying what stops and what goes on (decision 771) |
| The end | The person cleans up | Landed: the Done group; clean-up stays the person's |

## The merge queue for Hive's entries (`merges.ts`)

An entry Hive queues has `by: 'hive'` (`MergeEntry`, core types; no graph JSON change):

- **Its target** is the workspace's start branch (`from`), else the default branch.
- **Before the merge**: `git fetch` of the target's remote (its upstream, else `origin`). If the
  remote's target is ahead of the local one, the local one is fast-forwarded first (`--ff-only`
  where it is checked out, as a landing is); if they have diverged, the entry fails with why. Never
  a force, never a rebase.
- **A conflict**: no merger agent. The merge is aborted and the entry goes to `needs-you` with its
  files; the runner takes it from there.
- **No check found**: it lands without one (the person's answer B).
- **Landed**: the target is pushed to its upstream, else `origin`, whatever `merge.push` says (the
  person's answer 1). Never forced; a refused push is in `pushed` with git's words, and the log
  says it.
- **The person's checkout refuses the fast-forward** (their uncommitted changes in the way):
  `ready` with git's words, as today; the runner calls `land` again each minute.
- **The Merges page** marks Hive's entries and offers no Send to the agent on them (Hive sends).
- **Every other entry** is as on `main`: the merger, the approval, `merge.push`.

## Landing (`hive-runner.ts`)

At `landing` (the commit decision 716 checked and reviewed, at the branch's tip, the tree clean,
the writer not working), in the same tick:

- **The approval**: `reviews.finish` with `event: 'approve'` and `via: 'hive'` (`Verdict.via` gains
  `'hive'`), in the person's review file, the one the queue reads; its summary says what ran
  ("checked (4 commands, 7 min 12 s) and reviewed (approved) at abc1234, round 2").
- **The entry**: `merges.enqueue({ branch, into: from, by: 'hive' })`; its id in the record.
- **Each tick reads the entry**: landed → `landed`, with the merge and the pushes in the record,
  and a notice in the open window ("Hive landed <title> in main"); running → nothing; `ready` and
  refused → `land` again after a minute; `needs-you` or `failed` → below.
- **On whatever ran** (the person's answers 6 and B): the check and the review; the check alone
  (no sandbox, the reviewer failed twice); the review alone (no check found); neither. The record,
  the card and the approval's summary say which.
- **A message from the person during a landing** does not stop it.
- **A spike with no commits** ends at a new last step, `answered`: nothing to land.
- **Decision 717 stands** for entries that are not Hive's, the person's own Merge into.

**A landing that fails** (decision 769): a conflict, the merge's check failed, a fast-forward the
target outran, or the target diverged from its remote. Hive copies what failed into its record
(the files, the command and its last lines, the merge's log into Hive's logs), removes the entry
(the target is free for other merges), and sends `hive.land`: what failed, and whether the branch
causes it. If it does: merge the start branch in (`git merge <from>`, never a rebase), resolve or
fix, run the tests it touches, commit. If it does not (a timing test): say why and change nothing;
the unchanged commit goes straight back to landing (716), so only the merge's check runs again.
Each is one of the 2 merges of the start branch (690); the rounds start again; the third stops the
workspace, with why.

## Pushing the branch

`git push origin <tip>:refs/heads/<branch>` (`pushCommit`; git never asks for a password) after
each turn that ends with commits and a clean tree, before the check. Never forced; a refused push
is in the record (`pushed`), an event, and the Review tab; the loop goes on. No `origin`: nothing
pushed, said once. Never another branch, never a delete.

## No gate before landing (decision 773)

- **Plan first**: not offered on Start while Hive is on (its worth was the person's answer: in most
  of 109 answers they decided something, AR1). A plan that comes anyway (the MCP, a start from
  before) gets `hive.plan`: "Hive OKs your plan: build it now."
- **Permissions**: a Hive writer starts in Claude Code's `auto` mode, whatever Start picked
  (amends 658). Claude Code's classifier refuses a risky action rather than asking.
- **Anything that still asks** (a question, a permission; `needs-you`): Hive interrupts the turn
  with `hive.decide`: "No person answers in Hive mode: decide yourself from the brief and the
  repository, or do it another way inside your worktree, and say in your report what you decided
  and why." 3 a workspace; the fourth stops it.
- **A writer that failed or never started** is started again once (`hive.resume`); a second
  failure stops it.
- **A stop is a stop** (689): out of rounds, a turn Hive cannot see, the merges spent, the target
  diverged, the limits above. The card says "Stopped: <why>", not "waiting for you".

## Hive off and on (decisions 771, 772)

- **Off, with work in flight** (a Hive workspace writing, checking, reviewing or landing): a dialog
  asks first and lists each such workspace and what happens to it:
  - writing: its agent is stopped; on again, it is told to continue;
  - checking: the check is stopped; on again, it runs again;
  - reviewing: the review is stopped and its copy deleted; on again, a new review;
  - landing: the merge goes on, lands and pushes the target on its own; Hive records it once on
    again; a merge that fails meanwhile waits on the Merges page until then.
  Also what else changes: Alpha Ceph becomes Nucleus (V86). With nothing in flight, off at once, as
  today.
- **On**: refused while a workspace started in normal mode (no `hive: true`) is open and not
  merged. The question lists them, says to land or clean them up first, and its Turn on is off; the
  server refuses too (409, the same list). So in Hive mode every open workspace is Hive's or merged.
- **Hive off mid-landing in the runner**: nothing stops the queue; Hive's writers, checks and
  reviews stop and each step is kept, as today (655).

## The sidenav and the page in Hive mode (decision 774)

- **Two groups**: **Hive**, every workspace not done, in Hive's look (decision 698), and **Done**,
  landed or merged. No Working, Waiting for you, To review or Stopped. Folded, both as today's
  groups fold.
- **Hive's words on every card**, at work first, then stopped:
  - `Writing · 1/3` and the agent's last action, as today;
  - `Checking 2/4: pnpm check · 1:10 of ~7 min`; `Reviewing · 1:05 · Bash: …` (decision 699);
  - `Landing in main: checking the merge · 3:12`, `Landing in main: waiting for your checkout`;
  - `Stopped: <why>`.
  Done: `Landed in main · pushed`, or `not pushed: <why>`.
- **The head of a Hive workspace**: no Review, Land or Merge into (amends 681); the card's line.
- **The Review tab**: a Landing part per attempt (the approval, the merge's check, how it ended, its
  log), the merge's log under Now while it runs, the branch's and the target's pushes.
- **Git page**: the branch's verdict reads "Approved by Hive".

## The record

`HiveFile` gains, all optional (records from before read as before; a new step is skipped by an
older parser): `landing` (the entry in flight: id, into, queued), `landings` (each attempt: round,
commit, into, entry, outcome `landed | conflict | check-failed | cannot-fast-forward | diverged`,
files, the failed command and output, its log), `merges` (merges of the start branch so far),
`pushed` (the branch's last push and the target's: commit, at, ok, error), `landed` (into, merge,
at), `decided` (Hive's answers to questions and permissions), `restarted`. New step `answered`.
New message keys `hive.land`, `hive.plan`, `hive.decide`.

## Prompts and text (decision 775)

- `hive.start`: no person reviews, answers or approves in this workspace; decide yourself and say
  what you decided; Hive checks, reviews, lands it in `{into}` and pushes; keeps AR2's tests line
  (739) and "never push, merge, rebase or switch branches".
- New in Settings' Hive group: `hive.land` (`{why}` required, `{into}`, `{branch}`, `{command}`,
  `{output}`, `{merge}`, `{merges}`), `hive.plan`, `hive.decide`.
- `hive.nucleus` (V86): Hive lands and pushes; nothing waits for the person; Alpha Ceph does not
  approve, merge or clean up a Hive workspace.
- `symbiote/AGENTS.md`: `via: "hive"`; a workspace Hive drives is landed by Hive.
- The Hive dialog and its question (`HivePage.tsx:60–68`, `:153–156`), `README.md:418`,
  `configuration.md` (`:38`, `:178`, `:218–231`, `:291`): Hive lands and pushes; when to use Hive,
  in the person's words (2026-10-31): start a project in normal mode, turn Hive on once the
  repository has a check and tests you trust; the choice stays the developer's.
- `CLAUDE.md`'s "Which rules are which mode's": a Hive workspace's agent never asks the person;
  Hive pushes the branch and the start branch.
- `docs/PLAN.md`: the North Star's "until HV4" line; HV4's row; the merged rows marked ✅ (HV2,
  HV3, the North Star chore, live progress, the runner flaws' fix). Decisions 658, 681, 689 and
  690 say what HV4 changes, in their plans.

## Verification

0. **Measured first**: a `--bg` session in `auto` mode, what still asks (AskUserQuestion, a refused
   command); how `reply` with `stop` reaches a session waiting on a question; `git fetch` and push
   against a bare `origin`.
1. **Unit tests, red first** (`hive-runner.test.ts`, `merges.test.ts`; temp repositories with a
   bare `origin`, the fake writer, a real check command, the real merger):
   - from start (no plan first) to `landed` with no press: the approval `via: 'hive'`, the target
     and the branch on `origin`, the writer sent nothing after its last round;
   - `merge.push: false` and the target still pushed; a refused push recorded, never forced;
   - a conflict (the merger never called), the writer merges, landed; the third failure stops;
   - the merge's check failing: fixed by the writer; answered "not mine", the retry lands;
   - the target behind its remote (fast-forwarded first) and diverged (stopped);
   - the person's checkout in the way: retried, landed;
   - not reviewed, no check, neither: each lands, and the record says what ran;
   - a plan gets `hive.plan`; a question `hive.decide`, the fourth stops; a failed writer restarted
     once, then stopped;
   - Hive off mid-landing (the queue lands it, Hive records it once on); a killed runner mid-landing
     (no second entry);
   - Hive on refused with a normal-mode workspace open and not merged, allowed once it is merged;
   - **Hive off = `main`**; a workspace Hive does not drive untouched; the other entries' merges
     unchanged.
2. **Prompts**: the recorded start prompts byte for byte with Hive off; the new keys.
3. **Viewer**: unit tests of the two groups and every card's words, the head, the off dialog's
   list; e2e from start to Done with no press, the off dialog, Hive on refused; `pnpm check`,
   `pnpm build`, `pnpm test:e2e`; `viewer-check` on the sidenav (open and folded), the head, the
   Review tab, the Merges page, Settings' Hive page and both dialogs, both themes, V87's text sizes.
4. **A real run** in a scratch repository with its own `symbiote/` and a bare `origin`: one
   workspace from Start to Done with no press, `main` and the branch pushed; a second through a
   conflict. The person trusts the folder in Claude Code once first. About $2–4.

**Risks**

| Risk | Mitigation |
|---|---|
| Hive lands and pushes `main` with nobody watching | Hive off asks and stops new work; HV5's usage pacing before long unattended runs |
| A flaky merge check spends a merge of `main` (12 of 89 failed here) | The writer can answer "not mine"; 716 retries only the merge's check; the limit |
| Hive moves files in the person's main checkout | `--ff-only`, refused when their changes are in the way; the Hive dialog says so |
| A writer in `auto` does what the person would have refused | Claude Code's classifier; the worktree; the reviewer's copy and the limits unchanged |
| Hive on refused in this repository | Expected: it opens once no normal-mode workspace is open and not merged |

**Order**: the queue first (HV4a), then the runner (HV4b, HV4c), the switch (HV4d), the viewer
(HV4e), prompts and docs (HV4f), the real run (HV4g). Each part is committed with its tests.

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV4a | The queue for Hive's entries | `by: 'hive'`, the fetch, no merger, the target pushed; tests |
| HV4b | Landing in the runner | the approval, the entry followed, failures to the writer, the branch pushed, `answered` |
| HV4c | No gate before landing | `hive.plan`, `auto`, `hive.decide`, the restart, stops as stops |
| HV4d | Hive on and off | the off dialog's list, Hive on refused with normal-mode workspaces |
| HV4e | The viewer | the Hive and Done groups, the words, the head, the Review tab's Landing, the Merges page |
| HV4f | Prompts and docs | the keys, AGENTS.md, the dialogs, README, `configuration.md`, CLAUDE.md, PLAN.md |
| HV4g | The real run | As built, results, the journal |

**Decisions** (the person's answers, 2026-11-01):

| # | Question | Decision | Why |
|---|---|---|---|
| 767 | What lands, and when | **At `landing`, the commit at the branch's tip, on whatever ran (the check and the review, either alone, or neither): Hive approves it (`via: 'hive'`, the person's review file) and queues it (`by: 'hive'`) into the branch the workspace started from; no Land in Hive mode** | The person: not fully verified "should be automatically"; "land anyway if there are no tests"; the queue reads the person's file |
| 768 | Pushing | **The workspace's branch to `origin` after each turn with commits; the start branch after landing, whatever `merge.push`, after a fetch that fast-forwards it when behind; diverged stops the landing; never forced** (amends 690) | The person: "Pushing should be done back to the branch from where the workspace started, automatically in hive mode" |
| 769 | A landing that fails | **No merger for Hive's entries; the entry removed; `hive.land` to the writer: merge the start branch in and fix, or say it is not the branch's (716 retries); 2 merges of the start branch, the third stops** | The person's answer 2; AR1: 17 of 148 merges would still conflict, 12 of 89 merge checks failed on timing tests |
| 770 | The person's checkout | **`--ff-only` where the target is checked out, as today; refused: retried each minute, the card says why** | The person's answer 5 |
| 771 | Hive off | **Asks first while a Hive workspace writes, checks, reviews or lands, listing what stops and what goes on; a landing in the queue finishes on its own; nothing in flight: off at once** | The person: "Hive off needs a dialog that would say what would happen if i would turn it off during an active flow"; answer 7, "fully automatically" |
| 772 | Hive on | **Refused while a workspace started in normal mode is open and not merged; the question and the server list them** | The person: "Can't turn Hive mode on if there are workspaces in normal mode" |
| 773 | No gate before landing | **Plan first not offered in Hive mode, `hive.plan` for a plan that comes; the writer in `auto` (amends 658); `hive.decide` for anything that asks, 3 a workspace; a failed writer started again once; a stop is a stop, with why (689)** | The person: "a fully autonomous system. From the start to the end"; AR1: 121 of 131 plan first, 29 permission prompts, 20 questions |
| 774 | The sidenav in Hive mode | **Two groups: Hive (every workspace not done, Hive's words) and Done (landed or merged); no Review, Land or Merge into on a Hive workspace's head (amends 681)** | The person: "Only Done exists beside Hive in Hive mode" |
| 775 | What agents and people are told | **`hive.start`, `hive.land`, `hive.plan`, `hive.decide`, `hive.nucleus`, AGENTS.md's `via: "hive"`; the dialogs, README and `configuration.md` say Hive lands and pushes, and when to use Hive** | The brief; the person's words of 2026-10-31 |

The writer's tests (the brief's parked question) were settled by AR2 (decision 739): the failing
tests and those the change touches; Symbiote runs the whole check.

**Not in HV4 (later)**: pull or merge requests at a workspace's end; cleaning up a landed workspace
(the person's, from Done); Alpha Ceph's Confirm on a start (HV7); usage pacing (HV5); skipping the
queue's check when the merge's tree is the one Hive checked (about 6 min a landing here); Claude
Code's "not trusted" question in a new repository, answered once by the person.
