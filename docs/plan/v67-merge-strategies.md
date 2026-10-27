# V67 — Merge strategies: a merge commit, or a fast-forward to the approved commit

[Index](../PLAN.md) · [Journal](../journal/v67-merge-strategies.md)

**Status:** ready for review (2026-10-27), on branch `feature/review-merging-strategies`. Its
"As built" and results below.

**Problem** (asked: "I need more merging strategies… sometimes I would like that branch that I
would normally merge into, to just fast forward to my commit from the workspace branch"). The
merger (V26a, decision 146) always lands with `git merge --no-ff`: every landing adds a merge
commit, even when the target has nothing the branch lacks. Measured on this repository's `main`
(2026-10-27, first-parent history, last 200 commits):

| What | Measured |
|---|---|
| Merges on `main` | 159 |
| …whose first parent (the target's tip then) was in the second (the branch): a fast-forward was possible | **118 (74 %)** |
| Merges made by Symbiote's merger (`Merge <branch>: <title>`) | 74 |
| …of which a fast-forward was possible | **44 (59 %)** |
| Fast-forward-able merges whose branch had taken `main` in (a merge commit on the branch) | 11 |

What causes it: `mergeInWorktree` (core `git/merging.ts`) runs `merge --no-ff` and nothing else;
nothing in the queue entry, the request or Merge into ▾ says how a merge is to land.

**Goal**: at Merge, the person picks how it lands: **with a merge commit** (today, the default)
or **by fast-forward** (the target moves to the approved commit itself; no new commit). The
fast-forward is checked and landed as a merge is. **Unchanged**: a merge with a merge commit,
every state and action it has, and an entry queued before (no strategy: a merge commit).

## The strategy (cli: `merges.ts`; core: `merges.ts`, `git/`)

- `MergeStrategy = 'merge' | 'fast-forward'` (core `merges.ts`). `MergeEntry.strategy?` and
  `MergeRequest.strategy?`: absent is `merge`, so older entries and requests read as today.
- **A fast-forward is possible** when the target's tip (local, else a remote's, as `tipOf`)
  is in the approved commit. **Already there** when the approved commit is in the target: the
  entry lands at once, "already in main", as a merge does today.
- **Its run** (`mergeOne`): no merge. Symbiote's merge worktree is reset to the approved commit,
  `merge` is set to it, and the check runs there (`checkMerge`, unchanged): it checks the very
  code reviewed. A passing check lands it; a failed one is `failed`; no check waits at `ready`.
- **Landing is today's** (`landEntry`, `fastForwardBranch`): `merge --ff-only` in the checkout that
  has the target, else `update-ref` from the tip it was checked on; local changes there refuse it
  and nothing moves; a target moved meanwhile goes back to `queued`; `merge.push` after.
- **The target moved and cannot fast-forward** (an earlier merge landed while it waited):
  `needs-you`, `behind` set to the target's commits the approved commit lacks, the message
  "main has 2 commits feature/x does not: it cannot fast-forward. Merge with a merge commit, or
  bring main into the branch and review it again". Never a merge commit unasked. **Merge commit
  instead** (`POST /api/merges/merge-commit`, `Merger.mergeCommit`) queues it again as a merge.
  It holds later merges into its target as any `needs-you` does (fix/merger-queue-wrong-behaviour).
- **Queueing refuses** a fast-forward the target cannot take now (409, the same words).
- `merge.strategy` in `symbiote/config.json` (`merge` or `fast-forward`; anything else ignored):
  what is preselected; else `merge`.

## Which targets can fast-forward

`MergeTargets.fastForward?: string[]`: the targets whose tip is in the approved commit, from one
`git for-each-ref --merged <approved>` over local and remote branches (core
`branchesIn(repo, sha)`), each name mapped to the tip `tipOf` would take. Not one
`merge-base --is-ancestor` per branch: Bitwarden lists 1,591 branches (V65). `MergeTargets.strategy`:
the preselected strategy.

## Where it is picked

- **Merge into ▾** (`MergeControl`, the workspace panel and the Review tab): `[Merge into] [main ▾]
  [with a merge commit ▾]`, its options "with a merge commit" and "by fast-forward". By
  fast-forward on a target that cannot take it: the button disabled, a line under it says why.
  The button's tip says what happens ("main moves to 1a2b3c4 itself: no merge commit").
- **The merge page**: the head says "by fast-forward" beside its target; the states say it
  ("Queued: 1a2b3c4 into main, by fast-forward"; "Landed: main is at 1a2b3c4, fast-forward");
  the title line for a fast-forward says no merge commit is made. A `needs-you` fast-forward
  offers **Merge commit instead** and Remove.
- `symbiote merge <branch> --strategy merge|fast-forward`; MCP `queue_merge { strategy }`, and
  `merges` with a branch says which targets can fast-forward.

## Verification

1. **Tests first** (red before), `packages/cli/test/merges.test.ts`:
   - a fast-forward lands the approved commit itself (`main` = `T`, no merge commit), the checkout's
     files with it; the check ran in the merge worktree at `T`;
   - queueing refuses one the target cannot take (the target has a commit the branch lacks);
   - the target moved while it waited (another merge landed first): `needs-you` with `behind`,
     `main` where the other left it; Merge commit instead lands it with a merge commit;
   - a target checked out nowhere (`update-ref`), and one only a remote has;
   - local changes in the checkout refuse it, nothing moves, Land tries again;
   - already in the target: landed, "already in";
   - its check failed: `failed`, `main` unchanged;
   - targets: `fastForward` lists exactly the targets that can; `strategy` from `merge.strategy`;
   - `readMergeConfig` reads `merge.strategy`; unknown values ignored.
   Also `server-requests` (the strategy parsed and refused when unknown), the CLI's
   `--strategy`, MCP's `queue_merge`, and the viewer's `merges.ts` texts and buttons.
2. **Nothing else changes**: every existing merger, server, CLI and MCP test passes unchanged.
3. **Viewer**: e2e in `merges.spec.ts` — by fast-forward on an approved workspace lands it and
   the page says so; the button disabled with its line when the target moved; Merge commit
   instead. `viewer-check` screenshots of the control and the merge page, both themes, 1x;
   the `symbiote-style` skill for the select.
4. **Real use**: in a throwaway clone of this repository, `symbiote merge --strategy
   fast-forward` of an approved branch with this repository's `merge.checks` (install, check,
   build, e2e), timed; then again with `main` moved.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`. No analysis code changes: no regression set.

**Risks**

| Risk | Mitigation |
|---|---|
| A fast-forward lands commits whose history the person did not want on the target (the branch's own merge commits, WIP commits) | It is picked per merge, never the default unless `merge.strategy` says so; the approved commit is the reviewed one either way |
| The target moves while the fast-forward is checked | `landEntry` already sends it back to `queued`; at its turn it fast-forwards again or waits for the person — never a merge commit unasked |
| A stale `fastForward` list (the target moved after the panel read it) | Queueing checks again, and the run checks again |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V67 | Fast-forward as a merge strategy | `strategy` on the entry and request, the fast-forward run, `behind` and Merge commit instead, `merge.strategy`, `fastForward` in the targets, the pick in Merge into ▾, `--strategy`, MCP |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 485 | What a fast-forward lands | **The approved commit itself: the target moves to it, no new commit; only when the target's tip is in it** | What was asked; git's `--ff-only`. Anything else would land a commit nobody reviewed |
| 486 | A fast-forward the target can no longer take | **Wait for the person (`needs-you`), saying how far it moved; Merge commit instead is one click** | Precise beats complete: a merge commit unasked is not what was picked. Holding the target as any `needs-you` does keeps the order |
| 487 | The check on a fast-forward | **Runs, on the approved commit, in Symbiote's merge worktree, before landing** | Decision 146 lands unasked only what passed the check; here it checks exactly the code reviewed |
| 488 | Where the strategy is picked | **Per merge, in Merge into ▾ (and `--strategy`, MCP); preselected from `merge.strategy`, else a merge commit** | "Sometimes": a choice each time, today's default kept; a project that wants a linear history sets it once |
| 489 | Squash and rebase | **Not offered** | Asked for fast-forward only (2026-10-27). A squash leaves the branch unmerged to git (workspace "merged", Clean up's `branch -d`, Review's "merged into" would each need another rule); a rebase rewrites the reviewed commits (`AGENTS.md`'s Never) and can conflict at every commit |

**Not in V67**: squash and rebase (decision 489); "fast-forward when possible, else a merge
commit" (git's `--ff`): a strategy that changes what lands by itself; a Settings row for
`merge.strategy`.

## As built (V67)

- **The git step is one function in core** (`git/merging.ts` `tipsIn`): the tips of local and
  remote branches in the approved commit, from one `for-each-ref --merged`. The rest is the CLI's
  (`merges.ts` `fastForwardOne`), beside `mergeOne`; the landing (`landEntry`,
  `fastForwardBranch`) is unchanged but for its words.
- **A target that cannot fast-forward is an icon in Merge into ▾**, not a line under it.
  Screenshots at 1440 px: the control sits in the workspace's one-row head, and a line of text
  there wrapped the head's actions to a second row, so the head changed height with the picked
  target. It is a warning icon now, named "release cannot fast-forward", whose tip says why and
  what to do; the button is disabled. In the Review tab's column the control wraps as before:
  "Merge into main", then the strategy.
- **The strategy select costs the head about 180 px**: at 1440 px with the changes panel open,
  "Approved: ask your agent to me…" reads "Appro…" and the title and branch lose a word each
  (screenshots of the head with and without it). Kept as planned: the labels were agreed; the
  title and state already give way first.
- **Words where nothing is merged**: an unchecked fast-forward says "Not checked", not "Merged,
  not checked"; its title line "No merge commit: a fast-forward to 1a2b3c4, the approved commit"
  (true in every state, unlike "main moves to"); a ready one whose target moved, "main moved:
  fast-forwarding again from its tip"; its log's step "Fast-forward main to 1a2b3c4". The merge
  page said a waiting fast-forward's reason twice (its state and the needs-you message): the
  state alone says it.
- **Merge commit instead from a terminal or an agent**: `symbiote merge <branch> --strategy merge`
  on a fast-forward that waits, and MCP's `queue_merge { strategy: 'merge' }` on one, ask for it
  (no new flag or tool). MCP's `merges` lists each entry's `strategy` and `behind`, and with a
  branch, `targets.strategy` and `targets.fastForward`.
- **A request naming no strategy takes `merge.strategy`** (`enqueue`), so `symbiote merge` and MCP
  follow the project's default as Merge into ▾ preselects it; an entry records `strategy` only
  for a fast-forward, as the codebase leaves absent fields absent.

**Results.** Tests first, red for the right reason (no strategy yet: each merged with a merge
commit, or the function missing): 14 in `merges.test.ts` and 2 of its CLI tests, 1 in
`server.test.ts`, 2 in `mcp.test.ts`, 4 in the viewer's `merges.test.ts`; 2 e2e in
`workspaces.spec.ts` (written after the viewer's code, so not seen red). Every earlier merger,
server, CLI and MCP test passes unchanged.

Real use, a throwaway clone of this repository at `main` (`8048a91`), a branch adding a journal
line, approved, then `symbiote merge trial/ff --strategy fast-forward` from this branch's build:

| Run | Checks | Result |
|---|---|---|
| 1 | install, check, build, e2e (this repository's `merge.checks`) | install 0.3 s, `pnpm check` 84.5 s, build 4.1 s passed; `pnpm test:e2e` failed 3 of 309 after 306 s (intro, a merge spec, a review spec: `main`'s own, under load from this session's other runs). `failed`, `main` still `8048a91`: right |
| 2 | install, check, build | passed in 84.3 s; `main` fast-forwarded to `7c297d3` in the checkout in under 0.1 s: 1 commit on `main`, no merge commit; the checkout's uncommitted `symbiote/config.json` kept |
| 3 | another branch from `8048a91`, after run 2 moved `main` | refused at queue time: "main has 1 commit trial/moved does not: it cannot fast-forward. Merge with a merge commit, or bring main into the branch and review it again", exit 1 |
