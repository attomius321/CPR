# V26 — A merger: approved branches merged by Symbiote, an agent only for conflicts

[Index](../PLAN.md) · [Journal](../journal/v26-merger.md)

**Status:** V26a and V26c merged into main (2026-10-20, from branch `milestone/v26-merger`). V26b dropped (2026-10-20, decision 164): every conflict goes to the merger agent.

**Problem** (asked: "I want a merger agent, who specializes in merging branches"; "I don't like the
idea of the workspace's own agent doing it … it already has polluted context … we need to optimise
token generation also"; "I need to have the possibility to choose which branch merges into which.
Most of my working projects are old, and they have master … or I need to merge into another
branch"; "the merger agent needs a skill for that … does he need a heavy skill?"). Since V17 an Approve is a note for the branch's agent, and `symbiote/AGENTS.md`
tells that agent to merge. A workspace's agent works in a linked worktree while the default branch
is checked out in the main checkout, so `AGENTS.md` tells it not to merge there, and the merge
comes back to the person. Measured (2026-10-19):

| What | Measured |
|---|---|
| A workspace agent's context at its last turn (Claude Code session files, the 6 sessions of this repository's 5 workspaces) | **66K–474K tokens** (median ~215K); 28–432 turns. A merge run in that session would carry it on every turn |
| Last merges on the default branch that conflict when replayed, plus merges of the default branch into the branch before it (where conflicts are usually resolved) | This repository: **11** conflicting (73 merges). Bitwarden: **21** (80 merges; 11 of them the `jslib` submodule). Qwik: **7** (80). Vite: 0 (10) |
| `git merge-tree --write-tree` on those merges (no checkout, index or ref touched) | median 2–3 ms, max 760 ms |
| What conflicts | Here 16 of 18 files are docs (`JOURNAL.md` 10, `PLAN.md` 4, `README.md` 2). Bitwarden: `messages.json` 30, the `jslib` submodule 11, code 5 |
| Conflict regions where the ancestor had nothing, both sides only added (git's diff3 style) | Here 16 of 20 regions; Bitwarden 31 of 46; Qwik 3 of 12 |
| "Keep both" (the first parent's addition, then the second's) where the additions share no lines but blank lines and lone brackets | Applicable to **7** conflicts (here 6, Bitwarden 1). Equal to what was committed in 5; in the 2 others, the merge added an unrelated entry, or the same keys came in the other order (still valid JSON, 435 keys). Refused for **5** whose additions overlap (one side already had the other's keys): keeping both would have duplicated them |
| What an agent would need to read for the other conflicts | The conflict regions with 3 lines around: **0.6K–5.8K tokens** (11 conflicts here, median ~1.3K) |

What causes it:
- The merge is given to the agent that wrote the branch: the most expensive context there is, and
  one that cannot do the merge where it works.
- Nothing does the merge that needs no judgement (most of them), so every merge waits for a person
  or an agent.

**Goal**: Approve, then **Merge**. Symbiote merges the approved commit in a worktree of its own, runs
the project's check, and moves the default branch. No agent and no tokens when the merge is clean.
A conflict whose sides only added, without overlap, is resolved by a rule (dropped: V26b, decision
164). Anything else goes to a fresh agent that starts from the conflict alone, never the
workspace's agent. Every resolution is reviewed by the person in Symbiote before the branch moves. Unchanged: the workspace's agent, reviews,
and `symbiote diff`/`symbiote pr`.

## The merge (cli: `merges.ts`, beside `workspaces.ts`)

- **A queue per repository**, kept in Symbiote's cache. An entry is a branch, the approved commit
  (`head` of the Approve verdict, V17), the branch to merge into (`into`, the default branch), and
  a state: `queued` → `merging` → `checking` → `needs-you` (a resolution to review, or a failure
  to read) → `ready` → `landed` | `failed`. One merge at a time. The next starts from the default
  branch the last one produced, and its conflict check is made again.
- **Symbiote's merge worktree** in its cache (`git worktree add --detach`, as the CLI's other worktrees),
  reset for each entry to the tip of `into`. The person's checkout is never used to merge: it may
  hold their work.
- **Clean**: `git merge --no-ff -m "Merge <branch>: <title>" <approved sha>` (the workspace's
  title, else the branch's last subject), then the check (below). Passed: `ready`.
- **Landing**: the default branch moves only by fast-forward to the merge commit. If it is checked
  out in a worktree (usually the main checkout), Symbiote runs `git -C <that worktree> merge --ff-only
  <merge>` there. git refuses if local changes would be overwritten, and nothing changes then: the
  entry stays `ready` with git's words, and **Land** tries again. If it is checked out nowhere,
  `git update-ref refs/heads/<into> <merge> <old>`: refused if it moved meanwhile. If `into` moved
  since the merge started, the entry goes back to `queued` (merged again on the new tip).
  `merge.push: true` pushes after landing. It is off by default.
- **The check**: `merge.checks` in `symbiote/config.json`, else the command guessed at `into` (V24b).
  The last 60 lines of its output are kept with the entry. No check (none guessed, none set):
  the entry says so and waits for the person at `ready`, never landed unasked.
- **After landing**, the workspace offers Clean up as today (V18b). Landing does not clean up.

## Into which branch

- **Merge into ▾**: the person picks the target from the repository's branches (local, and remote
  ones as a local branch of the same name). Preselected, in order: the branch the workspace
  started from (its record's `from`, V18), the Approve verdict's `into` (V17), then the default
  branch (`origin/HEAD`, else `main`, else `master`, as `defaultBranch` finds it today). An old
  project on `master`, or work merged into `develop` or a release branch, is the same path.
- The queue entry records its target. Everything above applies to any target: the merge worktree
  starts at its tip, landing fast-forwards it in the worktree that has it checked out, else
  `update-ref`. One merge at a time per repository, whatever the target, since two targets can be
  checked out in one checkout over time.
- `symbiote merge <branch> [--into <target>]`.

## Conflicts: a rule, then an agent

The rule was dropped (V26b, decision 164): every conflict goes to the merger agent.

- ~~**Keep both**~~ (no tokens): every conflicting file is text, and each region's ancestor side is
  empty. Two additions that share no lines (blank lines and lone brackets aside) are kept in
  parent order. Two equal additions are kept once. A `.json` file must still parse. Anything else
  is not resolved by the rule. The result goes to the check and then to the person (below).
- **The merger agent** for the rest, and for a clean merge whose check failed. A new session each
  time (Claude Code `--bg` or `codex exec`, as V18 and V20a start them) in the merge worktree, with
  the conflicts left in the files. Its prompt, made by Symbiote, holds only:
  - for each conflicting file, its regions with 3 lines around (not whole files);
  - the symbols both sides changed in those files, from Symbiote's own analysis of the two sides
    against their merge base (name, kind, what each side did);
  - each side's title and goal from its record, or its last commit subject: a line or two each;
  - the check command, and when it failed, the end of its output.

  It must resolve the markers, run the check, and stop. **Its instructions** (the "skill") are
  Symbiote's, written into that prompt, the same for Claude Code and Codex, and short (target: 1K
  tokens): edit only the listed files and only between markers; keep what both sides meant; never
  commit, push or switch branches; run the check; report one line per region; and when both sides
  cannot be kept, stop with "needs you" and why, never pick one. Not a Claude Code skill file in the
  repository: the workspaces' agents would load it too, and Codex does not read those. A project
  can add its own merge rules in `symbiote/merge.md` (optional, short), which only the merger is given. It never commits, pushes, or touches
  another branch. Edits outside the merge worktree are denied (permission mode `acceptEdits`, the
  worktree its only folder; Codex `-s workspace-write`). Symbiote commits its result as the merge.
  `merge.model` picks the model (default: a smaller one, Claude Code `sonnet`; Codex its
  configuration's). `merge.agent` picks the agent (default: `agent.kind`).
- **A submodule pointer, a binary file, or a file deleted on one side** is not given to anyone:
  `needs-you`, with both sides named.

## Reviewing a resolution (viewer)

- A resolved conflict (rule or agent) is `needs-you`. **Review** opens Symbiote's review of the merge
  commit against the first parent, as a branch review (V15). Only the symbols in the conflicting
  files are listed first. Approve → `ready` → landing. Request changes → the merger agent again
  with the person's comments added (a new session, the same small context plus the comments).
- A clean merge with a passing check needs no review: Approve was the yes.

## Where it shows (viewer)

- Workspaces gets a **Merging** section above "Needs you", with one row per queue entry: branch,
  state, the check's time or its failure, and Review, Land, Retry or Remove. It is shown only
  while the queue has entries. A merger agent's thread and terminal open in the panel, as a
  workspace's do.
- **Merge** on an approved workspace (its panel) and on an approved branch review (the Review tab):
  "Merge into main" enters the queue. It is offered only when the verdict is Approve and the
  branch's tip is the approved commit.
- `symbiote merge <branch>` does the same from a terminal and prints each state until landed or
  `needs-you`.

## Agents' instructions

- `symbiote/AGENTS.md` no longer tells an agent to merge on Approve. An approval is for Symbiote's merger.
  The branch's agent is not woken for it. A conflict found on the branch before the review (V17's
  merge check) is still the branch's agent's to fix.

## Verification

1. **Tests first** (red before):
   - the queue's states and order;
   - a clean merge, its check passed and failed;
   - landing: a fast-forward in the checkout that has `into`, refused by local changes (nothing
     changes), `update-ref` when `into` is checked out nowhere, and `into` moved meanwhile
     (back to `queued`);
   - keep-both: this section's cases as fixtures (two journal entries; JSON keys; overlap
     refused; equal additions kept once; JSON that would not parse refused);
   - the agent's prompt from a fixture conflict (its regions, symbols, titles, the instructions,
     `symbiote/merge.md` when there; nothing else), and the instructions' size (≤ 1K tokens);
   - the target: preselected from the workspace's `from`, then the verdict, then the default
     branch; a repository on `master`; a merge into a branch that is not the default, landed in
     the worktree that has it;
   - submodule and binary → `needs-you`;
   - `AGENTS.md`;
   - e2e: Merge, the Merging rows, the review of a resolution, Land.
2. **Replays**: the 11 conflicting merges here and Bitwarden's 21, replayed through the merger in
   throwaway clones. Rule: each resolution it makes equals what was committed, or differs only in
   order or extras. Agent (real Claude Code, `sonnet`): resolved or `needs-you` per conflict, the
   check's result, and tokens per run (input and output, from the session file).
3. **Tokens**: a merger run's input against the 66K–474K context of a workspace agent. Target:
   the median run under 20K tokens of input in all.
4. **Nothing else changes**: `symbiote diff` output as `main`'s on this repository's last 5 merges; the
   existing e2e green.
5. **Real use**: two workspaces in a throwaway repository: one clean (merged, checked, landed in
   the checkout that has `main`, with an unrelated local change there), one conflicting (the
   agent, its review, landed).

**Risks**

| Risk | Mitigation |
|---|---|
| Moving `main` behind the person's checkout leaves it stale (its files no longer match its branch) | Never `update-ref` a checked-out branch: fast-forward in that checkout, which git refuses when it would overwrite. Tested with local changes |
| Keep-both is wrong when the two additions are the same thing written twice | Overlapping additions refused (5 of 12 measured); JSON must parse; the person reviews every resolution |
| The agent "resolves" by dropping one side | The person reviews only the conflicting files' symbols. The check runs first |
| A check that takes minutes holds the queue (this repository's check + build + e2e ≈ 2.5 min) | One merge at a time is the point: the next one must be checked on the result. Its time is shown; Remove takes an entry out |
| A project with no check command | Never landed unasked: `ready` waits for Land |
| Two `symbiote view`s on one repository | The queue file is locked while a merge runs; the second shows the queue read-only |

**Order** (changed 2026-10-19): V26a (the clean path, landing, no agent) first: it is most merges
and fixes the main gap on its own. Then V26c (the merger agent, for every conflict), then V26b
only if the replays show the agent slow or wrong where both sides only added: keep-both applied
to 6 of 11 conflicts here but 1 of 21 on Bitwarden and 0 of 7 on Qwik, and every resolution is
reviewed either way. V26b was built after V26c, then dropped (decision 164).

## Milestones

| # | Milestone | Output |
|---|---|---|
| V26a | Merge, check, land | Merge into ▾ (any branch; preselected from the workspace's `from`, the verdict, the default branch), the queue, Symbiote's merge worktree, `--no-ff` merge of the approved commit, `merge.checks`, landing by fast-forward or `update-ref`, `merge.push`; Merge on an approved workspace or branch review; the Merging rows; `symbiote merge`; `AGENTS.md` without merging |
| ~~V26b~~ | ~~Keep both~~ | Dropped (decision 164): every conflict goes to the merger agent. Was: the rule (empty ancestor, no shared lines, JSON parses), its result checked and reviewed |
| V26c | The merger agent | A fresh session from the conflict alone (regions, both sides' symbols, titles, check output; Symbiote's short instructions and `symbiote/merge.md`), `merge.model`, `merge.agent`, confined to the worktree; its resolution reviewed; tokens per run measured |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 142 | Who merges | **Symbiote, and a fresh agent only for what needs judgement; never the workspace's agent** | The workspace's context is 66K–474K tokens and holds nothing a merge needs. A conflict is 0.6K–5.8K tokens |
| 143 | Where | **A merge worktree in Symbiote's cache** | The person's checkout may hold their work, and the workspace's worktree has its branch checked out |
| 144 | How `main` moves | **Fast-forward only: in the checkout that has it, else `update-ref` with the old value** | Never stale, never forced; git refuses rather than overwrite |
| 145 | Push | **Off by default (`merge.push`)** | Other projects may not want Symbiote to push. This repository turns it on |
| 146 | Clean merges | **No agent, no review: Approve was the yes** | Most merges are clean. A plain merge plus the check can be explained line by line |
| 147 | Conflicts | **Rule, then agent; every resolution reviewed before landing** (the rule dropped: decision 164) | Measured: the rule was right on 7 of 7 and refused 5. A wrong merge costs more trust than a slow one |
| 148 | The agent's model | **`merge.model`, default `sonnet`** | Resolving a few regions with their symbols needs less than building a feature; the person can raise it |
| 149 | Into which branch | **Any, picked at Merge; preselected: the workspace's `from`, the verdict's `into`, the default branch** | Old projects use `master`, others `develop` or release branches. Work goes back where it started from |
| 150 | The merger's skill | **Light: ~1K tokens of Symbiote's own instructions in its prompt, plus an optional `symbiote/merge.md`** | What a conflict needs is assembled per conflict. A heavy skill would be read on every run, which is the cost V26 removes. A skill file in the repository would reach the workspaces' agents too, and Codex does not read it |

## V26a as built

What differs from the plan, and why:

- **The git steps are in core** (`git/merging.ts`: reset the merge worktree, merge, fast-forward,
  push), the queue in the CLI (`merges.ts`), as `worktrees.ts` and `workspaces.ts` split them.
- **The merge worktree keeps ignored files** between merges (`git clean -d` without `-x`):
  installed dependencies stay, so a check does not start from nothing each time. It does not link
  the main checkout's `node_modules` as `symbiote diff`'s worktrees do. pnpm's workspace links would
  resolve into the main checkout, and the check would test the wrong code.
- **A check guessed from `package.json` runs its package manager's install first** (`pnpm
  install`, then `pnpm run check`). Without it, the first merge of every JS project fails on
  missing dependencies. `merge.checks` replaces both.
- **A conflict is `needs-you` with its paths**, and the merge is aborted. Until V26b/V26c resolve
  conflicts, Retry merges again once the branch is fixed and approved again.
- **A merge waiting at `ready` holds later merges into the same branch.** They would be merged on
  a tip that is about to move, then merged again. A conflict or a failure holds nothing (since
  fix/merger-queue-wrong-behaviour they hold it too: both may still land).
- **The queue follows other processes**: listing it merges what is queued, so a `symbiote merge` in a
  terminal is merged by a `symbiote view` that is open, or by itself. While one process merges, the
  other's `symbiote merge` follows the entry through the queue file.
- **The approval's text** (Copy for the agent, Send the verdict) says Symbiote merges it and the agent
  should not. `symbiote/AGENTS.md` loses "Approved in a linked worktree". Its conflict section keeps the
  branch's agent resolving on the branch.
- **This repository's `symbiote/config.json`** sets `merge.checks` (install, check, build, e2e) and
  `merge.push: true` (decision 145).

**V26a results**: 831 unit tests, 115 e2e. `symbiote diff` unchanged on the last 5 merges. A real
merge of this branch in a clone of this repository: merged and checked (install, check, build,
e2e) in 188 s; the landing refused by an untracked file the merge brings, with nothing changed;
landed in 278 ms once it was removed, a local change kept. Found that way: `merge.push` was read
after landing, from the config the landing brought; it is read before now.

## V26c as planned (2026-10-19)

Measured first: a Claude Code `-p` run with Symbiote's own system prompt (`--system-prompt`), tools
limited and no MCP servers took 2,349 input tokens and 2.9 s for a one-line answer (`sonnet`).
Claude Code's Edit needs the file read first: for this repository's `JOURNAL.md` (3,000+ lines)
that is ~100K tokens, the cost V26 is to remove.

- **The agent writes no file.** It is given the conflict and answers, for each numbered region,
  the text that replaces it (or "needs you" and why), as JSON in its last message. Symbiote writes each
  answer between that region's markers, checks no markers are left, commits the merge (its
  message `Merge <branch>: <title>`), and runs the check. Read-only tools only: Claude Code
  `--tools Read,Grep,Glob` (it may look at a file when the region is not enough), Codex `-s
  read-only`. One run, `claude -p` or `codex exec`, waited for: no session to follow, and its
  usage comes with its answer.
- **Its prompt**: Symbiote's instructions (≤ 1K tokens, the system prompt for Claude Code), then
  `symbiote/merge.md` when there, both sides' titles (the workspace's title and goal, else the last
  commit subjects), and each region in git's diff3 style (ours, the ancestor, theirs) with 3
  lines around. The symbols both sides changed in the conflicting files, by Symbiote's analysis of
  each side against the merge base, limited to those files.
- **Not given to anyone**: a file deleted on one side, a submodule pointer, a binary file:
  `needs-you`, as before.
- **The review is the regions.** A resolved merge waits at `needs-you` with each region: the two
  sides, the ancestor, and the answer, plus the check's result. Approve → `ready` → landed.
  Request changes → a new run with the person's words and the earlier answer.
- **A clean merge whose check failed** stays `failed` (not given to the agent): there is no region
  to answer, and the fix belongs on the branch.

| # | Question | Decision | Why |
|---|---|---|---|
| 151 | How the agent changes files | **It does not: it answers each region's text, Symbiote writes it** | Edit would read whole files (~100K tokens for this repository's journal); the answer is confined by construction; the review is region by region |
| 152 | Which run | **One `claude -p` / `codex exec` run, waited for, read-only tools** | Bounded, its usage in its answer; nothing to attach to or clean up |
| 153 | A failed check after a clean merge | **`failed`, not the agent's** | No region to answer: what fails is the branch's code, fixed on the branch and reviewed again |
| 164 | V26b, keep both by rule | **Dropped: every conflict goes to the merger agent** | Asked ("Remove this feature from the plan … any conflict should be resolved by the agent", 2026-10-20), after V26b was built and tried on real merges. In the replays the rule was right where it applied, but a rule cannot see meaning: run file by file, it would have kept two `PLAN.md` rows that both claim V21 (Symbiote `01161fa2f`; the agent stopped and asked) and a changelog's entries twice under two headings (vite `67a8f8022`); each guard added for such a case is another rule to explain. The agent sees what both sides were for. Branch `milestone/v26b-keep-both` deleted |

**V26c results**: 852 unit tests, 117 e2e. This repository's 11 conflicting merges replayed with
the real Claude Code (`sonnet`): 5 equal to what was committed, 1 equal but for indentation, 1
equal in the regions (its note flagged the test the committed merge also changed), 1 both kept
in the other order, **2 wrong** (lines kept twice; a replaced paragraph kept and a duplicate ID),
1 "needs you", rightly. Input tokens: median 10.0K (5.5K–59K), 7–49 s a run. Both wrong ones
duplicate text: a duplicate-lines warning on the review is the next precision step; keep-both
by rule (V26b) would have refused both (additions that share lines; an edit of the same lines).

**Not in V26 (later)**: a duplicate-lines warning on a resolution's review (both wrong answers in the replays kept text twice); Bitwarden's and Qwik's conflicts replayed; Codex as the merger with a real Codex; several merges at once (each on its own worktree), squash or rebase merges
(`merge.style`), resolving submodule pointers, lockfiles regenerated instead of merged (none
conflicted in the merges measured).

**After V26: a resolution's failed check** (`fix/fix-merger`, JOURNAL). Asked: "it should display
what actually happened… not assume the merge was incorrect because of a test". The merger agent
resolved `docs/JOURNAL.md`'s one region right (merge `26b2676`: both entries kept). Install,
`pnpm check` and the build passed, and `pnpm test:e2e` failed 1 of 189 on the known flaky keys spec.
The row turned red, Approve was gone and the server refused it. Request changes asked the agent to
redo a right answer, and Retry ran it and every check again. V26c's design had the resolution wait
"plus the check's result. Approve → ready → landed". The block came with V26c's code and no
decision. Now the check's result goes with the resolution as a fact. The row is the person's
turn, "Resolved 1 region (sonnet) · its check failed (pnpm test:e2e): review it". The page says
what ran ("pnpm install, pnpm check and pnpm build passed; pnpm test:e2e failed after 2 min
31 s"). Approve lands it, and ready and landed keep saying the check failed. **Check again** runs
the failed check again on the same merge commit, with its resolution kept and no agent. A clean
merge whose check failed is unchanged (decision 153).

| # | Question | Decision | Why |
|---|---|---|---|
| 242 | A resolution whose check failed | **The person decides: Approve lands it; the row says what passed and what failed** | The check judges the merge, not the resolution: here a flaky e2e failed a right one. Red and no Approve left only ways out that throw a right answer away. The person reads the regions and the check's output, as V26c planned |
| 243 | Running a failed check again | **Check again: the same merge commit, in Symbiote's merge worktree reset to it, through the queue; no agent** | A flaky check wants the check again, not a new resolution (tokens, and maybe another answer). Through the queue: one merge or check at a time per repository |
