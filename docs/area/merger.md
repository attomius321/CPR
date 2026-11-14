# The merger

[Index](../PLAN.md) · [Its decisions](../decisions.md#the-merger) · Checked against the code on
2026-11-14

This page says how Symbiote's merger works today. Read it before you change the merger. The plans
listed in the index under "The merger" say why each part was built, as it was decided then. If a
plan and this page disagree, trust this page: it was checked against the code. Change this page in
the commit that changes what it says.

## What the merger does

The *merger* is the part of Symbiote that merges an approved branch into a target branch, runs the
project's check on the result, and moves the target. It merges in a worktree of its own, never
in your checkout. It uses no agent and no tokens when the merge is clean. A conflict goes to a
fresh agent, the *merger agent*, never to the workspace's agent. You review every resolution
before it lands.

Terms used below:

- A *workspace* is a branch and a worktree that Symbiote made for one agent's task. Its record
  names the branch it started `from`, and `against`, a branch the person picked to review it
  against.
- The *main checkout* is the repository's first worktree, where the default branch is usually
  checked out.
- An *entry* is one merge in the merger's queue. Its state says where it is; `needs-you` means it
  waits for the person.
- *Hive mode* is Symbiote's autonomous mode, in which Symbiote drives a workspace with no person
  in the loop ([the North Star](../PLAN.md#hive-mode-fully-autonomous)).

## From Approve to landed

1. A person approves a branch in its Review tab. The verdict records the approved commit and the
   branch to merge into (see [Reviews](reviews.md)). Nothing is merged yet.
2. The person picks **Merge into ▾**, or runs `symbiote merge <branch>`. Symbiote queues an
   *entry*: the branch, the approved commit, the target and the strategy. Through Symbiote's MCP,
   an approval queues it in the same Confirm, and `queue_merge` on a branch nobody approved
   approves its tip first (MC3, decisions 991, 992; see [Reviews](reviews.md)). In Hive mode, Hive
   approves the commit it checked and reviewed and queues the entry itself, with no press (see
   [Hive's merges](#hives-merges)).
3. The merger takes one entry at a time per repository. It resets its merge worktree to the
   target's tip and merges the approved commit with `--no-ff`. The commit's subject is
   `Merge <branch>: <the workspace's title, else the approved commit's subject>`. A workspace
   started from an issue gives it the body `Closes #<n>` (HV10, decisions 1017, 1065), so the
   forge closes the issue when the merge reaches the default branch; the entry keeps it as
   `body`, and a merge the merger agent resolved keeps it too. (With the fast-forward strategy
   there is no merge commit, and no body: see [Strategies](#strategies).)
4. If the merge conflicts, the merger agent answers each conflicting region. Symbiote writes the
   answers, commits the merge and runs the check. The entry then waits at `needs-you` for the
   person, whether the check passed or not.
5. If the merge is clean, Symbiote runs the check. If the check passes, Symbiote lands the merge
   at once, and nobody has to act. If it fails, the entry is `failed`. If there is no check, the
   entry waits at `ready` until the person presses **Land**.
6. To land, Symbiote moves the target by fast-forward to the merge commit. Pushing is off by
   default: Symbiote pushes the target only if `merge.push` is `true`, or Hive queued the merge.

The states an entry goes through are `queued`, `merging`, `resolving`, `checking`, `ready`,
`needs-you`, `landed` and `failed` (`MERGE_STATES` in `packages/core/src/merges.ts`). `ready`
means merged and checked but not landed: no check ran, or git refused the landing. Entries run in
the order they were queued.

In normal mode's sidenav, a workspace with an entry in the queue shows only as the entry's row
under Merging (V93) while the entry is queued, runs, is `ready`, or is `needs-you` with no failed
check. Once git or the check failed (`failed`, or `needs-you` after a resolution's check failed),
the fix is the branch's agent's: the workspace's own card is back beside the entry's row,
**Send to the agent** opens the workspace, and the merge page's branch links to it
([the fix](../journal/fix-failed-merge-hides-workspace.md)).

## How the target branch moves

- **The target is checked out somewhere** (usually the main checkout): Symbiote runs
  `git merge --ff-only` in that worktree, so the branch and its files move together. If local
  changes would be overwritten, git refuses. The entry stays `ready` with git's message, and the
  person presses **Land** to try again.
- **The target is checked out nowhere**: Symbiote moves the ref with `git update-ref`, giving the
  old value, so a ref that moved meanwhile is refused.
- **The target moved since the merge**: the entry goes back to `queued` and is merged again on the
  new tip.
- **Pushing**: only with `merge.push: true`, or for a merge Hive queued, to the target's
  upstream, else to `origin`, never forced. Symbiote reads `merge.push` before it lands, because
  the landing can bring a different `symbiote/config.json` into the checkout.

## Hive's merges

An entry Hive queues has `by: 'hive'` (HV4). Every other entry is merged as above.

- **The target is brought up to its remote first**: Symbiote fetches the target's branch from its
  upstream (else `origin`) and, when the remote is ahead, fast-forwards the target to it, in the
  checkout that has it. If the two have diverged, the entry fails with `diverged` set, and nothing
  is merged. A fetch that fails is logged, and the merge goes on.
- **A conflict gets no merger agent**: the merge is aborted and the entry waits at `needs-you` with
  its files. Hive takes it out of the queue and asks the workspace's agent to merge the target
  into its branch.
- **No check**: the entry lands without one.
- **Landed**: the target is pushed whatever `merge.push` says, as a network run (ssh in batch
  mode, 120 s), never forced. A refused push is in the entry's `pushed`.
- **Hive follows the entry**: landed, it marks the workspace landed; `ready` because the person's
  checkout refused, it presses Land again each minute; `failed` or `needs-you`, it copies what
  failed and the log into its record, removes the entry (the target is free again), and tells the
  agent. The merge page marks the entry **by Hive** and offers no **Send to the agent** on it.
- **Landing through a request instead** (HV8): with `hive.lands: "request"` Hive queues nothing.
  It pushes the branch and opens a pull or merge request into the start branch on `origin`'s forge;
  the person's merge there lands it. Hive then fetches the start branch and fast-forwards it as a
  landing does (`--ff-only` in the checkout that has it; refused, tried again each minute). A
  request the forge cannot merge goes to the workspace's agent as a failed landing does (769).
  The merger and the queue take no part. A workspace started from an issue lands by
  `hive.issues.lands` instead, a request unless set to `queue` (HV10c, decision 1016); its
  request's description starts with `Closes #<n>.`.

## The check

The check is `merge.checks` in `symbiote/config.json`: one command, or a list run in order. If
there is none, Symbiote guesses one from the target's files, such as a package script after its
package manager's install. The merge worktree keeps ignored files, such as `node_modules`,
between merges.

Since V93 (decision 881) the merger also records, read only for the page, when the check started
(`check.started`), each command's time and result (`check.steps`: `command`, `ms`, `ok`) and how
long the merge step took (`mergeMs`). A command's expected time is derived in the viewer from the
last passing check of the same commands; nothing the merger does depends on these fields.

If no check is set or found, a clean merge waits at `ready` for **Land**, and a resolved one at
`needs-you`. A clean merge whose check fails is `failed`. The person can then **Retry**, **Send
to the agent** (Symbiote types the `merge.failed` prompt into the branch's workspace), or
**Remove** it.

## Conflicts and the merger agent

The merger agent is one run of Claude Code (`claude -p`) or Codex (`codex exec`) with read-only
tools. Its prompt holds each conflict region with 3 lines around it, both sides' titles, the
symbols both sides changed, and `symbiote/merge.md` if the project has one. The agent writes no
file. It answers each region's text, and Symbiote writes the answers between the markers. The
agent may ask a question instead; the person answers it on the merge page.

The person reviews the resolution on the merge page. Lines a side loses or doubles are red, and
lines the agent wrote are amber. Then the person picks one of these:

- **Approve** lands it, even when its check failed: the person read what failed.
- **Request changes** runs the agent again with the comments and its previous answers.
- **Check again** runs a failed check again. If the target has not moved, it checks the same
  merge commit; if it has, it merges again on the new tip.
- **Remove** takes the entry out of the queue.

## Strategies

A merge lands with a merge commit unless the person picks a fast-forward in **Merge into ▾**, or
sets `merge.strategy`. A fast-forward moves the target to the approved commit itself, with no new
commit. It is possible only if the approved commit already contains the target's tip. The check
still runs, on the approved commit. If the target
has commits the approved commit lacks, the entry waits at `needs-you`, saying how far the target
moved. **Merge commit instead** queues it again as a merge. Squash and rebase are not
offered.

## Order between merges

A merge into a branch waits while any other merge into that branch is in a state other than
`queued` or `landed`. It starts once that merge lands, is removed, or is queued again (**Retry**,
**Request changes**, **Check again**). The wait matters because the held merge may still land and
move the target. A merge made on the old tip would then have to be merged again. If Symbiote
stops during a merge, the entry is merged again from the start when Symbiote runs next.

## Where things are

| What | Where |
|---|---|
| The service: queue, merge, check, land | `packages/cli/src/merges.ts` (the queue's runner and the operations); the steps in `merge-run.ts` (merge, check), `merge-resolve.ts`, `merge-land.ts`, `merge-targets.ts`; settings and the project's check in `merge-config.ts` |
| The queue file and its lock | `<cache>/state/<repo-id>/merges.json`, `merges.lock` (`packages/cli/src/merge-queue.ts`) |
| Each entry's log, one JSON object a line | `<cache>/state/<repo-id>/merges/<id>.jsonl` (`packages/cli/src/merge-log.ts`) |
| The merge worktree | `<cache>/worktrees/<repo-id>/merge` |
| The merger agent's prompt and answer parsing | `packages/cli/src/merge-agent.ts` |
| Hive's landing: the approval, the queued entry, what Hive does with its end | `packages/cli/src/hive-landing.ts` (`landing`, `land`, `follow`) |
| Hive's landing by request (HV8): opened, reviewed, watched | `packages/cli/src/hive-forge.ts` (`openRequest`, `watchRequest`), `hive-request.ts`; the forge's calls in `packages/forge/src` |
| A merge commit's message and body (HV10) | `mergeMessage` in `packages/cli/src/merge-context.ts`; the body set in `enqueue` (`merges.ts`) from the workspace's `issue` |
| A target fetched, a push that never prompts | `fetchBranch`, `pushBranch` in `packages/core/src/git/sync.ts` |
| Settings: `merge.checks`, `push`, `strategy`, `agent`, `model`, `effort` | `symbiote/config.json`; defaults in [configuration](../reference/configuration.md) |
| A project's rules for the merger agent | `symbiote/merge.md`, committed with the project |
| **Merge into ▾** | `packages/viewer/src/workspaces/MergeControl.tsx` |
| Which workspaces show in the sidenav only as their Merging row | `mergingAlone` in `packages/viewer/src/workspaces/merges.ts` (`test/merges.test.ts`) |
| The merge page: state, files, log | `packages/viewer/src/workspaces/Merge.tsx` (its state, head and output card), its steps card `MergeStepsCard.tsx`, a conflict's files and regions `MergeFiles.tsx`; its words from `merge-steps.ts` (pure, `test/merge-steps.test.ts`); the pipeline card `ui/Pipeline.tsx` |
| HTTP | `/api/merges…` in `packages/cli/src/server-merges.ts`; the log as server-sent events |
| Command line | `symbiote merge <branch>`, with `--into`, `--strategy`, `--land`, `--approve` and `--again` |
| MCP tools | `merges`, `merge_log`, `queue_merge`, `land_merge`, `merge_resolution`, `retry_merge`, `recheck_merge`, `remove_merge`; `mark_merged` |
| Merged work marked in the docs (MC3): the repository's `merged` commands at the target's tip, one commit, landed as a merge lands | `packages/cli/src/mark-merged.ts`; its worktree `<cache>/worktrees/<repo-id>/marks`; the tool in `mcp-merges.ts` |

`<id>` is the entry's ID, a UUID. `<cache>` is `SYMBIOTE_CACHE_DIR`, else `~/.cache/symbiote` on
Linux. `<repo-id>` is the folder name Symbiote gives the repository there: its folder's name and a
short hash of its git folder's path, such as `Symbiote-e8cf43a060b0`
(`packages/core/src/git/repo.ts`).

## Decisions in force

The table gives each decision as it holds today. A decision's row in its plan can say otherwise,
when a later decision or a fix changed it.

| # | The rule now | Made in |
|---|---|---|
| 142 | Symbiote merges; an agent only for conflicts; never the workspace's agent | [V26](../plan/v26-merger.md) |
| 143 | The merge happens in a worktree in Symbiote's cache | V26 |
| 144 | The target moves by fast-forward only: in the worktree that has it, else `update-ref` with the old value | V26 |
| 145 | No push unless `merge.push`, or Hive queued the merge | V26, changed by [HV4](../plan/hv4-autonomous-landing.md)'s 768 |
| 146 | A clean merge needs no agent and no review: the approval was the yes | V26 |
| 147 | Every resolution is reviewed by the person before it lands | V26 (its rule step dropped by 164) |
| 148 | The merger agent's model is `merge.model`, by default `sonnet` for Claude Code | V26 |
| 149 | Any target can be picked; the preselected one is as 473 says | V26, changed by [V65](../plan/v65-review-against.md)'s 473 |
| 150 | The merger agent gets Symbiote's short instructions plus `symbiote/merge.md` | V26 |
| 151 | The merger agent changes no file: Symbiote writes its answers | V26 |
| 152 | One agent run, waited for, with read-only tools | V26 |
| 153 | A clean merge whose check fails is `failed`; the merger agent does not fix it | V26 |
| 164 | No "keep both" rule: every conflict goes to the merger agent | V26 |
| 242 | A resolution whose check failed: the person decides, and Approve lands it | V26 (a fix) |
| 243 | **Check again** reruns the check without an agent. Since the queue fix it reads the target's tip first, and merges again if the tip moved | V26 (a fix), changed by [the queue fix](../journal/fix-merger-queue-wrong-behaviour.md) |
| 313–316 | Each entry's log is a JSON-lines file in the cache, sent as server-sent events and drawn in a read-only terminal with its steps | [V46](../plan/v46-merger-logs.md) |
| 317 | A resolution lists its files; the first shown is the first that loses or doubles lines | V46 |
| 318 | A step's output is cut at 1 MB: its first 64 KB and its end | V46 |
| 319 | `merge.effort`, set in Settings; if absent, the agent's own level | V46 |
| 473 | The target is the branch reviewed against: the workspace's `against`, else its `from`, else the verdict's `into`, else the default branch | [V65](../plan/v65-review-against.md) |
| 485–489 | Fast-forward lands the approved commit, only if the target's tip is in it; otherwise `needs-you`; the check runs first; picked per merge; no squash or rebase | [V67](../plan/v67-merge-strategies.md) |
| 494–497 | The merge page uses the theme's colours; a conflict's files and the log are line tabs (the layout is 880's since V93) | [V69](../plan/v69-merge-page-mockup.md), changed by V93's 880 |
| 742 | **Send to the agent** sends a failed check to the branch's workspace, only when the person presses it | [AR2](../plan/ar2-defaults-from-ar1.md) |
| 880 | The merge page is proof 05's: head and pill, a pipeline card (Approved, Merge, Check, Land) with Queue and Time, the Steps, then Log, Changes and Conflicts as tabs; Take out of the queue only while queued | [V93](../plan/v93-redesign-finish.md), replaces 494–497's layout |
| 881 | The merger records the check's start, each command's time and result, and the merge step's time, for the page only | V93 |
| 882 | Which review approved: the review list serves the verdict's number and text ("your review, 2nd") | V93 |
| 743 | In this repository, `docs/JOURNAL.md` merges as a union (`.gitattributes`), so it no longer conflicts | AR2 |
| 767 | In Hive mode, Hive approves (`via: "hive"`) and queues the commit it checked and reviewed, into the branch the workspace started from; no Land | [HV4](../plan/hv4-autonomous-landing.md) |
| 768 | Hive's merges: the target brought up to its remote first, diverged stops it; pushed after landing whatever `merge.push` | HV4 |
| 769 | Hive's merges: no merger agent; a conflict or a failed check goes to the workspace's agent, twice at most | HV4 |
| 770 | Hive's merge refused by the person's checkout: Land again each minute | HV4 |
| 788 | `hive.lands`: the merge queue (the default) or a pull or merge request; with a request, no queue entry and no push of the start branch | [HV8](../plan/hv8-hive-pull-requests.md) |
| 789 | By request, the person's merge on the forge lands it: the start branch fetched and fast-forwarded (as 770); closed stops; cannot merge goes to the agent (as 769) | HV8 |
| 792 | By request with no `origin`, forge or token, or a refused push or open: stopped, never the queue instead | HV8 |
| 990 | `mark_merged` runs the repository's `merged` commands at the target's tip in the cache, makes their changes one commit and lands it as a merge lands (144), pushed as `merge.push` says; refused while a merge into that target is past `queued` and not landed | [MC3](../plan/mc3-mcp-batch-confirm.md) |
| 991–992 | An MCP approval queues its merge in the same Confirm; `queue_merge` approves an unapproved tip first | MC3 |
| 1016 | A workspace from an issue lands by `hive.issues.lands`: a request by default, whatever `hive.lands` says (amends 788) | [HV10](../plan/hv10-workspace-from-issue.md) |
| 1017, 1065 | A workspace from an issue: `Closes #n.` first in its request's description; `Closes #n` the body of every merge commit the queue makes of it; the subject unchanged; a fast-forward closes nothing | HV10 |

These no longer hold:

- **82's "the agent merges the approved commit"**: since V26 the merger merges it (142).
- **147's "rule, then agent"**: V26b's rule was dropped (164).
- **149's preselection** (`from`, the verdict's `into`, the default branch): the reviewed-against
  branch comes first since V65 (473).
- **681's Land** on a Hive workspace's Review tab: since HV4, Hive lands it itself (767).
- **147 and 164 for Hive's merges**: a conflict in a merge Hive queued goes to the workspace's
  agent, not the merger agent, and no person reviews a resolution (769).

## Traps

- **Land in the checkout that has the target.** Moving the ref from elsewhere leaves that
  checkout's files behind its branch. `merge --ff-only` there moves both, and git's refusal is
  the guard against losing local changes ([V26](../journal/v26-merger.md)).
- **Read the config before landing.** A landing can bring another `symbiote/config.json`. Read
  after landing, it once pushed a test clone's `main` (V26).
- **Do not link the main checkout's `node_modules` into the merge worktree.** pnpm's workspace
  links would resolve into the main checkout, and the check would run the wrong code (V26).
- **Hold every later merge into the same target.** A merge that waits at `ready` or `failed` and
  lands later moves the tip under the next one
  ([the queue fix](../journal/fix-merger-queue-wrong-behaviour.md)). So a Hive merge that failed
  must leave the queue, or it holds the target for everyone: Hive removes it before it tells the
  agent ([HV4](../journal/hv4-autonomous-landing.md)).
- **`git remote get-url` expands `insteadOf`**: a forge's address that git reaches elsewhere reads
  as that elsewhere. Hive's request reads `remote.origin.url` as written too, to know the forge
  ([HV8](../journal/hv8-hive-pull-requests.md)).
- **A merge commit needs a git user name**, which a test repository may lack: "Committer identity
  unknown" (HV4).
- **Read the target's tip before every start**, **Check again** included (the queue fix).
- **Moving a target under a merge runs that merge again**: the merger reads the target's tip
  before landing and merges again when it moved, check and all. So `mark_merged` waits while a
  merge into its branch is past `queued` (MC3).
- **The person's Claude Code hooks run in the merger's `claude -p`**: two `SessionStart` hooks a
  run here ([V46](../journal/v46-merger-logs.md)).
- **e2e tests must not find the developer's own agent.** The merger runs `claude` from `PATH`.
  Every e2e `symbiote view` sets `SYMBIOTE_CLAUDE` and `SYMBIOTE_CODEX` to nowhere (V26).
- **A merge can need changes outside the conflict** (a test adapted to the other side, an ID
  renumbered). The agent cannot make them, so the check and the person's review catch them (V26).
- **A correct resolution can still show red**, for example when both sides counted a number up
  ([the conflict view fix](../journal/fix-merge-viewer-on-conflict.md)).
- **This repository's full check runs e2e**, which fails under other sessions' load: 3 of 309
  tests at a load average of 20. The merge then fails and nothing lands
  ([V67](../journal/v67-merge-strategies.md)).
- **Every entry not landed once hid its workspace**, failed ones too: after a failed check the
  person had no card to open, and **Send to the agent** seemed to do nothing. `mergingAlone`
  (`packages/viewer/src/workspaces/merges.ts`) is the one rule
  ([the fix](../journal/fix-failed-merge-hides-workspace.md)).
- **A page's own read can be older than the stream's push.** After Land, the merge page read the
  five parts itself; its `/api/merges` answered "Queued" while the drain ran, then arrived after
  the stream had pushed "Cannot fast-forward", and put "Queued" back. The stream sends only what
  changed since it last sent, so the page stayed on Queued (workspaces.spec.ts:2303). A page's
  own read now never replaces a part pushed after it began (`useWorkspaces.ts`,
  [the fix](../journal/fix-e2e-flakes.md)).
- **A drain stopped by its lock or the queue's file waits for the next kick.** `kick()` catches
  what no entry holds; `symbiote view` logs it ("merger stopped", `onError`), and a read of the
  merges or any action kicks again.
- **`symbiote merge --help` lists the default target without the reviewed-against branch**, which
  the code checks first (`targets` in `merge-targets.ts`). Found while writing this page; not fixed.
