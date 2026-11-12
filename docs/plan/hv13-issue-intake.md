# HV13 — Issues come in: a label watch and a start queue

[Index](../PLAN.md) · Journal: none yet; measured in
[the chore's journal](../journal/chore-hive-issue-loop-gaps.md)

**Status:** planned (2026-11-12) by the chore `chore/hive-issue-loop-gaps` (from `main` at
`a47dda3`); not started. It needs [HV12](hv12-issue-loop-real-run.md)'s real run, and the parts of
[HV7](hv7-steadier-loop.md) listed under "What it needs from HV7".

**Problem**. Until HV13, an issue reaches Hive only through a click on the Issues page or a call
to Nucleus (HV10). Hive's North Star is "goals in, verified work landed" with no person in the
loop, and IS1 left "a watcher, a start queue" for later. Three measurements shape the watch:

- **A label alone proves nothing.** On vite, 52 of 138 label events on the 100 newest open issues
  were set by the issue's own author from outside the project, through vite's issue forms
  (`pending triage` 50 times, `documentation` twice). A watch that trusts a label trusts anyone.
- **GitLab says who set a label only with a token.** `resource_label_events` answered 401 without
  one on 5 of 5 gitlab-runner issues (2026-11-12).
- **Issues come faster than Hive can work.** In the last 30 days, 38 issues opened on vite and 62
  on gitlab-runner are still open. A Hive workspace in this repository took from 16 minutes to
  4.8 hours to land, and its writer spent $17.86 at the median (the chore's journal).

What several workspaces at once cost, from [HV7's runs](hv7-steadier-loop.md):

- With four workspaces at once, the load average was 19 to 37 on 32 cores. A whole check took
  13 to 21 % longer, and 3 of 5 checks failed on timing tests that no change touched.
- An Opus writer at `xhigh` spent about $16 an hour.
- `hive.budget` cannot see a writer before its first stop, and first turns alone came to $24
  to $26.

**Goal**: With the watch on, an issue that someone with write access labels `symbiote` (the
name can be changed) comes into Hive by itself. Hive classifies it, then starts it, asks, or
refuses, within limits the person sets. The limits cover how many issues are worked at once, how
many start a day, and what the classifier may spend. Hive off pauses the watch and the queue, and
Hive on resumes them. With the watch off, everything works as in HV12.

## The watch

- **`hive.issues.watch`** in `symbiote/config.json`, off by default: `label` (`symbiote`) and
  `every` (60 s, as HV8's request watch, `REQUEST_POLL_MS` at
  `packages/cli/src/hive-runner.ts:64`). Settings' Hive page sets both.
- **The read**: the open issues with the label, most recently updated first (GitHub's
  `labels=`, GitLab's `labels=`). Each read is conditional, through IS1's cache of ETags: an answer
  of 304 costs nothing from GitHub's limit (IS1's measurement).
- **Who set the label**: for each issue not yet in the queue, Symbiote reads the last event that
  added the label and its actor. That is GitHub's `GET /repos/{o}/{r}/issues/{n}/events` (a
  `labeled` event), or GitLab's `resource_label_events`, which needs a token. Then it reads the
  actor's access: GitHub's `GET /repos/{o}/{r}/collaborators/{user}/permission` must answer
  `admin`, `maintain` or `write`; on GitLab, a member's access level must be Developer (30) or
  above. Otherwise, the issue is left out and recorded once: "labelled by someone without write
  access".
- **Without a token on GitLab**, the watch cannot tell who set a label. It stays off, and Settings
  says why.

## The queue

- Issues wait in the order their label was set. The queue is kept in the issues' records
  (`symbiote/issues/`), so that a restart or Hive off loses nothing.
- One classification runs at a time. An issue taken on its current snapshot starts a workspace
  (HV10) while fewer than `hive.issues.atOnce` workspaces from issues are open. The default is 1.
- `hive.issues.perDay` (default 5) caps the starts in a day. `hive.issues.classifyPerDay` (default
  20) caps the classifications, so a flood of labels cannot spend the subscription.
- The Issues page shows the queue: each issue's place, why it waits (at once, the day's cap, a
  pause, the precision bar), and when it was labelled.

## Limits

- **HV5's gate**: classifications and starts go through the one gate before every agent Hive
  starts (`paced`, `packages/cli/src/hive-round.ts:338`, decision 796). At or over
  `hive.usage.pauseAt`, they wait for the window's reset with everything else.
- **The classifier's cost** is counted in each issue's record and in a day's total, shown with
  the queue.
- **`hive.budget`** holds for each workspace, as today. HV7's first part makes it see the writer
  from its first minute.
- **The precision bar** (HV9, decision 1010): while the classifier's model has not met the bar,
  the watch classifies and shows its decisions, and a person's **Start in Hive** starts work.

## What changes an issue's place

- **Edited** after its snapshot: classified again before a start (HV9).
- **Asked**: a new comment from the author or a member makes Symbiote classify it again. A comment
  from anyone else does not.
- **The label removed**: a waiting issue leaves the queue. A workspace already started goes on,
  until it lands or Hive or the person stops it.
- **Closed on the forge**: a waiting issue leaves the queue. A started workspace goes on, and HV11
  writes nothing more to a closed issue.

## Hive off and on

Hive off pauses the watch and the queue: no read, no classification, no start. A running
classification finishes and is recorded. Hive on resumes them from the records, and issues
labelled meanwhile come in the order of their labels. The dialog for Hive off (decision 771)
lists the waiting issues among what stops.

## What it needs from HV7

The watch starts work while no person watches the first turn. Three of HV7's parts must be built
first:

- the budget sees a writer from its first turn;
- Hive off stops what the writer started;
- trust is said before a start, so a new clone does not wait unseen.

HV7's other parts (a flaky check run again, checks at once, no second check at landing) help, but
the watch does not wait for them: `hive.issues.atOnce` at 1 keeps the load of one workspace.

## Verification

1. **Unit tests, red first**, on recorded answers from vite (its `pending triage` events) and
   gitlab-runner:
   - the label's setter on GitHub and GitLab: an author's form label left out, a maintainer's let
     in, no token on GitLab;
   - the queue's order and caps, and a pause holding a classification;
   - each change of place, and Hive off and on.
2. **The runner**: a fake forge whose labels arrive while Hive works one issue; the second waits,
   then starts; the day's caps.
3. **e2e**: the queue on the Issues page; the watch in Settings.
4. **Real**: a day of the watch on HV12's scratch repository and project, with issues labelled by
   the person and by a second account without write access.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| A form or an outsider sets the label | the label's actor and their access are checked; 52 of 138 vite labels came from forms |
| A flood of labelled issues | one at once by default, 5 starts and 20 classifications a day |
| Hive works while no one watches its spend | HV7's budget from the first turn first; HV5's pause; the caps |
| The watch spends GitHub's rate limit | conditional reads; one read a minute and two per new issue |
| A workspace runs on after its issue is closed | it goes on, and nothing more is written to the issue |

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV13a | The watch | the read, the label's setter, Settings; tests |
| HV13b | The queue and its limits | the order, the caps, the gate, changes of place, Hive off and on, the Issues page; tests |
| HV13c | A day on the scratch forges | the journal's numbers |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 1027 | What brings an issue in with no click? | **A label (`symbiote` by default) set by someone with write access to the repository; the label's last setter and their access are read from the forge** | 52 of 138 vite labels were set by outside authors through issue forms |
| 1028 | How is it watched? | **`hive.issues.watch`, off by default; the labelled open issues read every 60 s through IS1's conditional cache; GitLab needs a token, or the watch stays off** | GitHub's 304 costs nothing; GitLab answered 401 for label events without a token |
| 1029 | In what order, and how many? | **The order of the labels; one classification at a time; `hive.issues.atOnce` workspaces from issues, 1 by default; 5 starts and 20 classifications a day by default** | Four workspaces at once made checks 13 to 21 % slower and failed 3 of 5 on timing tests (HV7) |
| 1030 | Which limits hold? | **HV5's one gate for classifications and starts; `hive.budget` per workspace; the classifier's cost per issue and per day, shown; work starts with no click only past HV9's bar** | Within limits beats faster |
| 1031 | What changes a waiting issue? | **An edit: classified again; an ask answered by the author or a member: classified again; the label removed or the issue closed: out of the queue; a started workspace goes on** | Only the author and the project's people can move an issue on |
| 1032 | Hive off and on? | **Off pauses the watch and the queue, a running classification finishes; on resumes them from the records; Hive off's dialog lists the waiting issues** | Decisions 690 and 771: Hive off stops everything and says what |
| 1033 | What must come before it? | **HV12's real run, and HV7's budget from the first turn, Hive off stopping what writers started, and trust said before a start** | Unattended starts need limits that see the first turn |

**Not in HV13 (later)**: webhooks in place of polling (Symbiote runs on the person's machine, with
no address a forge can reach); several repositories in one queue; priorities from labels; issues
from projects other than `origin`'s.
