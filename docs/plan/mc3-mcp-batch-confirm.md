# MC3 — One Confirm for many actions, mark merged, and the gaps Nucleus hit

[Index](../PLAN.md) · [Journal](../journal/mc3-mcp-batch-confirm.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/mcp-batch-confirm` (the workspace's, from
`main` at `bc24845`); the person's OK the same day ("Yes. everything recommended": the batch bar as
in the mockup, B for a lapsed Confirm, fix-mcp-annotations built here).

**Problem** (the brief: seven changes found while Nucleus drove 15 workspaces on 2026-11-09–11).
Measured on the person's records (`symbiote/nucleus-activity.jsonl`, the running view's
`/api/workspaces`, `mark-merged.mjs` without `--write`), read only:

| # | What happens today | Measured |
|---|---|---|
| 1 | Each start or clean-up is its own Confirm; a caller holds one ask at a time (`mcp-confirm.ts:29-33`) | Since 2026-11-09: 23 Confirms, 21 of them starts. 5 runs of starts asked within 5 minutes of each other: 2, 2, 2, 3 and 3 starts. 9 merged workspaces wait for a clean-up today: 9 Confirms |
| 2 | Only a workspace's agent marks merged work | The dry run lists 9 merged rows still "built, ready for review" (V99–V106 and a fix), 0.39 s |
| 3 | An MCP Approve leaves the queue empty | Neither path queues on Approve. On the page, Approve records the verdict (`reviews.ts:526-576`) and the person's **Merge into** press queues it (`MergeControl.tsx:54` → `POST /api/merges`): V100's verdict at 07:02:14, its merge `checking` 3 s later. Through the MCP the same two steps are two Confirms: `finish_review` at 21:34:27, `queue_merge` at 21:34:35 (spike/graph-usability) |
| 4 | `queue_merge` on a branch nobody approved in Symbiote is refused ("not approved", `merge-targets.ts:71-77`); nothing needs a workspace | Nucleus read refactor/layout-flow and refactor/workspace-tabs as "not workspaces, so nothing ever queued them" and started a workspace to merge them (2026-11-10 18:22) |
| 5 | `overview`'s `needsYou` lists every workspace in `ready` | Today 9 entries, all 9 merged workspaces. The page's inbox leaves them out (they are in the Done group) |
| 6 | A Confirm unanswered for 10 minutes ends with "nothing was done", and the page shows nothing after | 5 Confirms ever lapsed, all starts. Each time the person came back and typed "again" (or "Try again", "Start again"): 15, 16, 18, 19 and 607 minutes after the ask. Each cost a turn of Nucleus and a second Confirm |
| 7 | A just-started workspace reads `needs-you, interrupted` | feature/v99 on 2026-11-10: `start_workspace` answered `needs-you`, `interrupted: true` at 21:43:13.462, 0.3 s after the prompt was recorded and 0.4 s before the session's first request. Claude Code lists the new session `working` with status `idle`, and `agentState` reads that pair as an Esc (`claude-code.ts:266-270`). Nothing recorded an interrupt: Claude Code writes one into the transcript (`interruptedMessageId`, "[Request interrupted by user…]"), and that transcript has none |

**Goal**: three starts are one Confirm; nine clean-ups are one Confirm; the person unticks what they
do not want; the agent learns per item what was done. Merged work is marked behind a Confirm. An
MCP Approve queues its merge in the same Confirm, on any branch. `needsYou` lists what waits. A
lapsed Confirm is still in front of the person. A state is what Symbiote or the agent recorded.

**What must not change**: a `start_workspace` or `clean_workspace` call with today's arguments
asks and answers as today, word for word; every other tool as today; the page's Approve and
**Merge into** as today; NU8's setting starts without a Confirm, and is recorded.

## 1. One Confirm for many (decisions 987–989)

**The tools.**

- `start_workspace` takes `workspaces`: a list of 2 to 10 briefs, each with today's fields
  (`kind`, `title`, `branch`, `parts`, `planFirst`, and optionally `agent`, `effort`, `model`,
  `from`). The schema's top-level `required` goes (a client's check cannot say "these fields, or
  `workspaces`"; the Claude API refuses `oneOf` at the top of a tool's schema). The code checks
  either shape, as it checks each field today: one shape or the other, never both.
- `clean_workspace` takes `branches`: 2 to 20 workspaces' branches; `unmerged` applies to all.
- Each item is checked before the person is asked, as a single call is (today's test "checks an
  asked call before asking"). An item that cannot be done (a branch that exists, a clean-up with
  files not committed, not merged without `unmerged`) is listed as **Can't** with the reason, and
  not done. If none can be done, the call is refused before asking, as today.
- One ask, with items. `McpAsk` gains `items?: { id, words, cant? }[]` (types in core); the
  ask's own words name the batch ("Start 3 workspaces"). `McpAnswer` gains `items?: string[]`,
  the ticked ids; absent means all.
- On the yes, the ticked items run in the listed order, one at a time (a start holds `exclusive`
  as today). Each one's end is pushed to the page as it lands (`onAsks`, V94a).
- The answer: `{ results: [{ branch, outcome, workspace?, error? }] }`, `outcome` one of
  `started`, `cleaned`, `failed`, `declined`, `cant`. An error result only when nothing was done.
- One ask per caller stays: a batch is one ask.

**The Confirm on the page** (the person's to OK; screens in
[the mockup](#the-mockup)). The ask bar stays where it is (the shell's `asks` row, decision 361:
on whatever page the person is), and grows a list:

- Its head as today: who asks, what ("Start 3 workspaces"), the time left, **Decline all** and
  **Confirm 3**.
- One row an item: a tick (ticked), the branch, then the rest in muted words (the title and the
  agent, model, effort and plan first it starts with, decision 584; or "merged into main" for a
  clean-up). The words line up in columns. Ten rows show; more scroll inside the bar.
- Unticking a row strikes its branch through and counts down the primary: **Confirm 2**.
  "Unticked ones are declined when you confirm." With none ticked, Confirm is off and **Decline
  all** is the way.
- A **Can't** row: its tick off and disabled, its reason under its words in the error colour.
- While it runs: the ticks become states (`StatusLabel`): Starting (turning), Started, Failed,
  Declined; the head counts "1 of 2 started". The buttons are off.
- At the end: all done, the bar goes (the new cards in the sidenav say it). Anything failed or
  left out as **Can't**, the bar stays as "Nucleus asked: …, 1 started, 1 failed, 1 declined"
  with each row's state and reason, and **Close**.
- A single ask (today's) draws as today.

**Recorded** (NU2, decision 607; NU8, decision 785). The `confirm` lines carry `items` (words, and
at the end each one's answer and outcome). The Activity tab draws a batch as one Confirm milestone
whose detail lists each item and its outcome. Nucleus's batch start with the setting on, or Hive
on, starts every item without asking and is recorded as one `skipped` line with its items.

## 2. Mark merged (decision 990)

- A new asked tool, `mark_merged`, listed only where `symbiote/config.json` sets `merged`:
  `{ "list": "<command>", "write": ["<command>", …], "message": "Docs: merged" }`. Symbiote runs
  on other repositories; the scripts are this one's. This repository sets
  `list: node scripts/plan/mark-merged.mjs`, `write: [mark-merged.mjs --write,
  consolidate.mjs --write]`, as the milestone skill's "Marking merged work" says.
- Before asking: the `list` command runs at the target's tip (default branch; `into` to name
  another) in a worktree of Symbiote's cache, never the person's checkout. Its lines make the
  Confirm's words: "Mark 9 rows merged on main (V99, V100, …), commit 'Docs: merged' and push
  main". Nothing to mark: refused, nothing asked.
- On the yes: the `write` commands in that worktree, one commit (subject `message`, the IDs in its
  body), landed as the merger lands (`git merge --ff-only` in the checkout that has the target,
  else `update-ref` with the old value), then pushed as `merge.push` says (true here). The answer
  gives the commit, what was marked, the script's notes (rows it left for a person), and whether
  it was pushed.
- Refused while a merge into the same target is past `queued` and not landed: moving the target
  would merge it again and run its check again (The merger, "Order between merges").
- A checkout whose local changes git refuses to move: nothing lands, the commit is kept and
  named, and the answer says why. The person's files are never touched.

## 3. An Approve through the MCP queues its merge (decision 991)

- The cause: Approve is a record on both paths (V17, V26: "Symbiote pushes nothing on Approve");
  the page's queueing was the person's **Merge into** press, which needs no Confirm because the
  person pressed it. Through the MCP the same two steps were two Confirms.
- `finish_review` with `approve`, on a branch whose verdict has an `into`, asks once: "Approve
  spike/x at abc1234 and merge it into main". The yes records the verdict, then queues the merge:
  the same two service calls, in the same order, as the page's two presses and Hive's landing
  (`reviews.finish`, then `merges.enqueue`), in one function, `approveAndQueue`, shared by the
  MCP's tools. `into` and `strategy` as `queue_merge` takes them; `merge: false` only records.
- Checked before asking as `queue_merge` is: the target exists, a fast-forward can be taken, the
  branch is not queued already. The answer gives the verdict and the queue entry.
- The page does not change: Approve, then **Merge into ▾** (target and strategy picked there).

## 4. `queue_merge` on any branch (decision 992)

- Nothing in the merger needs a workspace; it needs an approval of the tip. `queue_merge` on a
  branch with no approval asks once: "Approve refactor/layout-flow at f09eb55 (not reviewed in
  Symbiote) and merge it into main", through `approveAndQueue`. The verdict's summary says it was
  approved through `queue_merge`, `via` the caller. The check is `merge.checks`, as for every
  merge; the entry's title is the commit's subject.
- The tools' `branch` says "a branch" where it is any branch (`review`, `finish_review`,
  `queue_merge`, `merges`); `workspace`, `thread`, `reply`… keep "a workspace's branch".

## 5. `needsYou` without merged workspaces (decision 993)

- `overview` leaves a merged workspace out of `needsYou`, as the page's inbox does. Its
  `workspaces` counts count them as `merged`, not under their agent's state.

## 6. A Confirm that lapses (decision 994: the person chose B)

The record: the person wanted every lapsed start, and came back 15–19 minutes later four times
out of five. Three ways:

| | What happens | Lapsed asks caught (of 5) | Cost |
|---|---|---|---|
| A. Wait 30 minutes | The call is held 30 minutes; Codex's `tool_timeout_sec` raised to 1,860 + 60 | 4 (not the 607-minute one) | A Codex Nucleus polls the held call (MC1: ~430K cached input tokens a 10 minutes); an agent of the person's through `symbiote mcp` may time out first and read as "gone" |
| **B. It stays, lapsed (recommended)** | After 10 minutes the call ends as today, but its answer says the ask stays on the person's bar. The bar keeps it, muted, "Nucleus asked at 14:02 … No answer in 10 minutes: nothing done yet", **Dismiss** and **Confirm**, until answered, dismissed, or 24 hours. Confirm then checks each item again and does it. `overview` lists lapsed asks and what became of them; a new ask from the same caller with the same words replaces its lapsed copy | 5 | Nucleus learns of a late yes from `overview` or `wait`, not in its ended call |
| C. Both | A, then B | 5 | A's cost |

Recorded: a late yes is a second `ended` line on the same ask (`answer: 'late'`), a dismissal
`'dismissed'`; the Activity tab says "Confirmed after it lapsed" and "Dismissed".

## 7. A state recorded, not guessed (decision 995)

- `interrupted` only from Claude Code's record: the transcript's newest user entry carries
  `interruptedMessageId`. `transcriptReader` (`workspace-running.ts`) already reads each
  transcript's end on a list (cached by size and time) and learns it there, read before
  `agentState`.
- `working` with status `idle` and no such entry reads `working`: the turn was submitted and has
  not begun. With it: `needs-you`, `interrupted`, as today. Hive's own guard for the same moment
  (`hive-writing.ts:19-25`) stays; it is now not needed, and is left for Hive's area.

## SC1 lands after MC3 without rework (decision 996)

SC1 (decisions 930–932) gives the Confirm's routes a page secret and Nucleus an identity of its
own. MC3 adds no route: a batch's answer, a dismissal and a late Confirm are bodies of
`POST /api/mcp/answer`; the lapsed asks and the results are in `GET /api/mcp/asks` and the
stream's `asks`. SC1b's refusal of those two routes covers them all. Who counts as Nucleus is still
read in one place (`startsAtOnce`, by `caller.via`), so SC1c changes `callerOf` and nothing here.
The routes snapshot (`server-routes-*.txt`) must not change.

## MCP schemas and fix-mcp-annotations (decision 997)

MC3 changes four of the 25 schemas (`start_workspace`, `clean_workspace`, `finish_review`,
`queue_merge`) and adds `mark_merged`. [fix-mcp-annotations](fix-mcp-annotations.md) (planned)
changes every schema: `annotations` required on each tool, `additionalProperties: false`, an
unknown argument refused before anything runs. Built apart, the two collide in `mcp-tools.ts` and
the tools snapshot. Built here, whole, as its plan says (the person's choice), and its index row
says it is built by MC3.

## Verification

1. **Tests first** (red before, `packages/cli/test/mcp.test.ts`, `workspaces.test.ts`, a new
   `mark-merged.test.ts`; viewer `test/`):
   - 1: three starts, one ask with three items; one unticked: two started, one declined; one that
     fails at the start: `failed` with its reason, the others done; a **Can't** item never done; a
     single call answers today's text; the record's `items`; NU8 on: no ask, one `skipped` line.
   - 2: on a temp repo with a bare remote and a config whose commands write a docs file: the
     Confirm's words list the rows; the commit lands on `main` in the checkout and is pushed;
     refused while a merge into `main` is checking; refused by local changes, nothing lost.
   - 3: `finish_review` approve: one ask, then a verdict and a queued entry; `merge: false` only
     the verdict.
   - 4: `queue_merge` on a branch with no workspace and no approval: one ask, approved and queued.
   - 5: `overview` with merged and waiting workspaces: only the waiting.
   - 6: a lapsed ask stays listed; a late yes checks again and does it; a dismissal ends it;
     recorded both ways.
   - 7: Claude Code listing `working`/`idle` after a start with no marker: `working`; with the
     marker: `needs-you`, `interrupted`. Today's test "reads a turn interrupted with Esc as waiting for the person" encodes
     the guess and changes to need the marker.
2. **Nothing else changes**: the tools snapshot (`test/__snapshots__/mcp-tools.json`) updated on
   purpose, its diff read in the journal; the routes snapshots unchanged; every existing MCP test
   passes as is.
3. **The bar**: an e2e spec over the fake agent (`serveWorkspaces`): three starts in one Confirm,
   one unticked; nine clean-ups with one **Can't**; a failure that stays; a lapsed ask (Playwright's
   clock). Screenshots in both themes at 1x; `targets.spec.ts` (the tick's target is its row,
   30 px); `tokens.test.ts`'s guards.
4. **A real run**: an MCP client over the e2e fake starting three workspaces with one Confirm and
   cleaning up several with another (a real Nucleus run from this worktree writes into the main
   checkout's `symbiote/`: only with the person's OK).
5. `pnpm check`, `pnpm build`, `pnpm test:e2e` (unset `WAYLAND_DISPLAY` here).

**Risks**

| Risk | Mitigation |
|---|---|
| `start_workspace`'s schema loses its `required` | The code checks both shapes; a test per missing field, as today's |
| A batch starts several agents at once on the person's quota | Each one listed in the Confirm with its model and effort; 10 at most |
| A late Confirm acts on a changed repository | Each item checked again before it runs; a **Can't** says why |
| `mark_merged` moves `main` under a merge | Refused while a merge into the target is under way |
| A config's commands run on the person's machine | As `merge.checks` do: only what is committed in the repository's `symbiote/config.json` |
| e2e flakes under other workspaces' load (intro, settings) | Run alone and in full, reported, not patched (the journal of fix/e2e-flakes) |

**Order**: 7 and 5 first (small, no UI); then the server's batch ask and the lapse (1, 6); the
tools (1, 3, 4, 2); the bar and the Activity tab; docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| MC3a | 7 and 5: `interrupted` from the transcript; `needsYou` without merged | Two tests red then green |
| MC3b | The batch ask and the lapse in `mcp-confirm.ts` and `mcp.ts`; core's types; the record | Unit tests; a single ask unchanged |
| MC3c | The tools: `workspaces`, `branches`, `approveAndQueue` for `finish_review` and `queue_merge`, `mark_merged`; the schemas (and fix-mcp-annotations, if chosen) | Unit tests; the snapshot's reviewed diff |
| MC3d | The bar's list, states and lapse; the Activity tab's batch | e2e, screenshots both themes |
| MC3e | Docs: `commands.md`'s MCP tools, `configuration.md`'s `merged`, the Reviews and merger area pages, the journal | — |

**Decisions** (proposed, then OK'd by the person on 2026-11-11):

| # | Question | Decision | Why |
|---|---|---|---|
| 987 | Many actions, one Confirm | **`start_workspace` takes `workspaces` (2–10), `clean_workspace` `branches` (2–20); one ask with items, each checked first; the answer per item: started or cleaned, failed with its reason, declined, can't** | Five runs of 2–3 starts, each start its own Confirm, 9–71 s apart; nine clean-ups would be nine |
| 988 | The batch on the page | **The ask bar grows a list: a tick a row, ticked; Confirm n and Decline all; each row's state while it runs; it stays with Close only when something failed** (the person's OK) | One place for every ask (361); a failure is never lost, a success shows as its card |
| 989 | Batches, NU8 and the record | **A batch is recorded as one Confirm with its items; Nucleus's batch start without a Confirm when the setting or Hive says so, recorded as one `skipped` line** | NU2 and NU8 hold per item |
| 990 | Marking merged | **`mark_merged`, asked, listed where `symbiote/config.json` sets `merged` (`list`, `write`, `message`); run in the cache's worktree at the target's tip, landed as the merger lands, pushed as `merge.push` says; refused while a merge into the target is under way** | The scripts are this repository's; the person's checkout is never written; a moved target re-runs a merge's check |
| 991 | An MCP Approve | **Queues its merge in the same Confirm, by `reviews.finish` then `merges.enqueue` (`approveAndQueue`), as the page's Approve and Merge into presses do; `merge: false` only records** (V17's 82: Approve means merge) | The page's two presses need no Confirm; the MCP's two needed two |
| 992 | `queue_merge` on a branch with no approval | **Asks once to approve its tip and merge it; no workspace needed; the repository's `merge.checks`** | The merger never needed a workspace; Nucleus made one to merge two branches |
| 993 | `overview`'s `needsYou` | **No merged workspace; counted as `merged`** | 9 of its 9 entries were merged; the page's inbox leaves them out |
| 994 | A Confirm unanswered for 10 minutes | **B: the call ends at 10 minutes; the ask stays on the bar, lapsed, confirmable or dismissable, for 24 hours; a late yes checks again and does it** (the person chose B of A, B and C) | 5 of 5 lapsed asks were followed by "again", 15–607 minutes later |
| 995 | `interrupted` | **Only from Claude Code's transcript (`interruptedMessageId`); `working` and `idle` without it is `working`** | The state is what is recorded; the guess read a start as an Esc |
| 996 | SC1 after MC3 | **No new route: answers, dismissals and late yeses through `/api/mcp/answer`; asks, lapsed and results through `/api/mcp/asks` and the stream** | SC1b and SC1c then need nothing of MC3 |
| 997 | fix-mcp-annotations | **Built in MC3, whole** (the person's choice, 2026-11-11) | Both change `mcp-tools.ts` and the tools snapshot |

**Not in MC3**: Nucleus's shell gate (`nucleus-shell.ts`); SC1 itself; the graph; a one-press
"Approve and merge" on the Review tab; batches of other asked tools (`restart_agent`, merges'
actions); Hive's interrupted-turn guard.

**Results.** Each of the seven with tests red first, then green (the journal lists them).
`pnpm check`: 3,592 unit tests in 258 files, lint, types and format; `pnpm build`; `pnpm
test:e2e`: the viewer's 469 and the nexus's 32 passed (a first full run failed 1 of 469: the
fake's Esc, fixed). The tools/list snapshot updated on purpose, read per listing: 26 tools with
annotations; the routes snapshots unchanged. Through Nucleus's bridge and the fake agent: three
starts in one Confirm, one unticked, two started; their clean-up in another, one kept as "can't";
a lapse confirmed late, another dismissed. A real `mark_merged` of this repository's docs in a
scratch clone: dry run 452 ms (20 files, 9 rows), marked in 506 ms, one commit, landed, pushed.
The measured cases: `needsYou` 9 of 9 merged entries now 0; v99's start reads `working`; three
starts were three Confirms 9–71 s apart, now one; nine clean-ups one.

## The mockup

Prototype markup over a real `symbiote view` (this branch's build, its tokens and fonts), at 1x,
1440 px wide: `packages/viewer/coverage/mc3-mockup/shots/` (not committed), and on the review
page. `1-start-asking`, `2-clean-asking`, `3-start-working`, `4-start-results`, `5-lapsed`,
`6-single-today`, each `-dark` and `-light`.

## As built (MC3)

- **`mark_merged`'s setting is `merged.commands` (and `message`), with no `list` command.** The
  Confirm's words come from running the commands themselves in the cache's worktree at the
  target's tip, which changes nothing of the person's: it names the files they change and whether
  the commit is pushed. One contract, nothing parsed from a script's output, and the person
  confirms the change itself. The commit's body is what the commands printed, which for this
  repository is the IDs `mark-merged.mjs` marked (CLAUDE.md: "the IDs in the body").
- **A batch takes 1 to 10 starts and 1 to 20 clean-ups**, not 2 to: a list of one is a batch too.
  A batch with a failure or a "can't" stays on the bar after it is done.
- **The record has a fourth Confirm stage, `done`**: what a batch's items or a late yes came to,
  written once they are done. `ended`'s answer adds `late`, `dismissed` and `replaced`; an
  `expired` end keeps its words "No answer in time" in the tab and the export, since older records'
  lapses were not kept.
- **`finish_review` refuses an approval of a branch in the queue already**, before asking
  (`merge: false` records it alone), and `into`/`strategy` on anything but an approval that merges.
- **A named wait outranks the recorded Esc.** A session that lists `working`, idle and a
  `waitingFor` reads `needs-you` with what it waits for; before, it also carried `interrupted`.
  The e2e fake now does what Claude Code does: every hook gets a `transcript_path`, and its Esc
  writes Claude Code's marker there and drops the wait it named. Four unit tests and one e2e
  assertion that encoded the guess say what is recorded now (decision 810's, three of Hive's,
  `agentState`'s; Hive's tests still guard that a message is not the writer asking).
- **`suggest_settings` lists every field of a start** (fix-mcp-annotations): it takes
  `start_workspace`'s whole brief by design (decision 583), and unknown arguments are refused now.
- **`SYMBIOTE_ASK_MS`** shortens the ask's 10 minutes for the viewer's e2e, as
  `SYMBIOTE_HIVE_REQUEST_MS` does Hive's poll; the bar says the wait from the ask's own times.
- **The asks were compared by their IDs** on the page (`useAsks`): a batch's row changing state
  would never have redrawn. They are compared whole.
- **`mcp.test.ts`'s fakes moved to `mcp-fakes.ts`** unchanged; MC3's tests are in files of their
  own (`mcp-batch`, `mcp-approve`, `mcp-marks`, `mark-merged`).
- **Not built**: a screenshot of a batch being done (a state of a second or two), and the same
  guess on Nucleus's own page (`page-agent-conversation.ts:70` reads `working` and idle as
  interrupted): the brief names a workspace's state; a fix of its own.
