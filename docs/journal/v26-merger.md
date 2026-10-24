# Journal: V26 — A merger: approved branches merged by Symbiote, an agent only for conflicts

[Index](../JOURNAL.md) · [Plan](../plan/v26-merger.md)

## V26 spike — what merging takes, and what it would cost an agent (2026-10-19, branch `milestone/v26-merger`)

Asked: a merger agent, not the workspace's own ("it already has polluted context … optimise token
generation"). Measured:

- **A workspace agent's context** at its last turn, from Claude Code's session files for this
  repository's 5 workspaces (6 sessions): 66K–474K tokens, 28–432 turns. A merge run in that
  session would be carried on top of it.
- **Conflicts**, replaying with `git merge-tree --write-tree` (2–3 ms median) the last merges on
  the default branch and the merges of the default branch into each branch before it. The second
  matters: of the last 73 merges here, 5 conflict when replayed, and 6 more conflicts were
  resolved on the branch before its merge, so the final merge replays clean. Here 11, Bitwarden
  21 (80 merges; 11 the `jslib` submodule), Qwik 7, Vite 0.
- **Most conflicts are both sides adding.** In git's diff3 style, the ancestor's side is empty in
  16 of 20 regions here (journal and plan entries), 31 of 46 on Bitwarden (`messages.json` keys),
  3 of 12 on Qwik.
- **"Keep both" needs a guard.** Taken blindly, it was refused or wrong where one side's addition
  already held the other's (a branch that had merged the other side's keys before): it would
  duplicate them. With the guard "the additions share no lines but blank lines and lone brackets",
  it applied to 7 conflicts and was right on 7: 5 equal to what was committed (blank lines
  aside), 1 where the merge also added an unrelated entry, 1 with the same keys in the other order
  (valid JSON, 435 keys). It refused 5.
- **What an agent would read** for a conflict: its regions with 3 lines around, 0.6K–5.8K tokens
  (11 conflicts here, median ~1.3K). That is 1–3 % of a workspace agent's context.
- **Landing is the risky step.** The default branch is checked out in the main checkout. Moving its
  ref from elsewhere would leave that checkout's files behind its branch. A fast-forward made in
  that checkout (`merge --ff-only`) moves both, and git refuses when local changes would be lost.

Planned as V26 (PLAN.md): Merge, check and land with no agent (V26a); keep-both by rule (V26b); a
fresh merger agent from the conflict alone, every resolution reviewed (V26c).

## V26a — Merge, check, land (2026-10-19, branch `milestone/v26-merger`)

Approve, then **Merge into ▾** (the Review tab, a workspace's panel, or `symbiote merge <branch>`):
Symbiote merges the approved commit with `--no-ff` in a worktree in its cache, runs the check
(`merge.checks`, else the V24b guess at the target's tip), and moves the target by fast-forward
in the worktree that has it checked out, else by `update-ref` from the value it was merged on.
The Merging section heads Workspaces while the queue has entries. `symbiote/AGENTS.md` no longer
tells an agent to merge an approval.

**Learned**:
- **A function named `process` shadows Node's global** in the module, and TypeScript said so only
  as "Property 'pid' does not exist on type '(entry) => Promise<void>'".
- **A guessed package script fails in a fresh worktree**: Symbiote's merge worktree has no
  `node_modules`. Linking the main checkout's, as `symbiote diff`'s worktrees do, would make pnpm's
  workspace links resolve into the main checkout, so the check would run the wrong code. So a
  `package.json` guess runs its package manager's install first, and the worktree keeps ignored
  files between merges.
- **A merge waiting at `ready` must hold the next one into the same branch.** Otherwise the next
  is merged on a tip about to move, lands first, and the first is merged again.
- **`git merge --ff-only` in the checkout that has the branch** refuses with "Your local changes
  to the following files would be overwritten by merge", and leaves the branch and the files
  as they were. That is the landing's guard, tested with a change to a file the merge brings.
- **The config was read after landing**, from the checkout the landing had just changed. In the
  real run below, the branch brought this repository's `symbiote/config.json` (`merge.push: true`)
  into a clone whose own config said `false`, and Symbiote pushed the clone's `main` to its `origin`,
  this checkout. Local `main` moved to the test merge; it was put back with `update-ref` from
  that value (GitHub's `main` was never pushed to). Now the push is decided before landing, with
  a test: a landing that brings a pushing config does not push.

**Verification**: tests first — 22 merger tests red (no module), then 4 more (`symbiote merge` ×2, the
install before a guessed package script, the push decided before landing), each red first; the
routes with a fake merger; the viewer's row text and actions (3). 831 unit tests, lint,
typecheck, build; 115 e2e (Merge and Land from a branch review and from a workspace, a conflict
named and removed; the V17 review texts updated). `symbiote diff` on this repository's last 5 merges,
`main`'s build and this one: the same graph JSON (45–731 nodes) but for `stats.durationMs`.
Real use, a clone of this repository merging this branch into its `main` with
`merge.checks` (install, check, build, e2e): merged on `d17fc40`, checked in 188 s, then the
landing was refused ("untracked working tree files would be overwritten by merge:
symbiote/config.json") with `main` and the files as they were; with that file removed, `--land`
fast-forwarded the checkout in 278 ms, its unrelated `.nvmrc` change kept. Not verified: the
merge of a real workspace from a `symbiote view` with a real agent; V26b and V26c.


## V26c — The merger agent (2026-10-20, branch `milestone/v26-merger`)

A conflict goes to one `claude -p` (or `codex exec`) run in Symbiote's merge worktree, read-only:
Symbiote's instructions (1,410 characters, ~350 tokens) as its system prompt, then the sides'
titles, the symbols both changed, `symbiote/merge.md`, and each region in diff3 style with 3 lines
around. It answers each region's text as JSON, or `needsYou`. Symbiote writes the answers, commits
the merge, runs the check; the Merging section shows each region (both sides, the ancestor,
what was written) with Approve and Request changes.

**Learned**:
- **Claude Code's Edit reads the whole file first.** This repository's `JOURNAL.md` is ~100K
  tokens, so an agent that edits would cost more than the workspace agent V26 avoids. An agent
  that answers text per region reads only the regions; it may still read a file (Read, Grep,
  Glob) when a region is not enough, and one did (59K tokens, below).
- **A one-line `claude -p` costs 2,349 input tokens** with `--system-prompt` (Claude Code's own
  replaced), `--tools` limited and `--strict-mcp-config`: the floor of every run.
- **The e2e fixtures would have run the developer's own Claude Code**: the merger finds
  `claude` on PATH. Every e2e `symbiote view` now starts with `SYMBIOTE_CLAUDE` and `SYMBIOTE_CODEX` pointing
  nowhere, and a spec that wants an agent passes a fake.
- **Some merges change lines outside the conflict** (a test adapted to the other side, an ID
  renumbered). The agent cannot, by design: it said so in its note once, and kept two equal IDs
  once. The check and the review are what catch them.
- The 12 prompt and answer tests were written with the module, not seen red; the 7 flow tests
  and the server's routes were red first.

**Verification**: 852 unit tests, 117 e2e (a resolution asked again, approved and landed; one
left to the person, nothing merged). **Replays**: this repository's 11 merges whose parents
conflict (of 79), each through `symbiote merge` in a clone with the real Claude Code (`sonnet`), no
check, compared with the merge that was committed:

| Result | Merges |
|---|---|
| Equal to what was committed (blank lines aside in 2) | 5 |
| Equal but for a list's indentation (33 lines, `git diff -w` empty) | 1 |
| Equal in the regions; the committed merge also changed a test outside them, which the agent's note asked to check | 1 |
| Both sides kept, in the other order, one paragraph in the other side's words | 1 |
| Wrong: two lines kept twice (1); a README paragraph the target had replaced kept, and two plan rows with one ID (1) | 2 |
| "Needs you": a README section moved on one side, changed on the other; it named the three changes and where they belong | 1 |

Input tokens per run: 5.5K–59K, **median 10.0K** (target: under 20K); output 0.9K–10K; 7–49 s
per run. A workspace agent's context was 66K–474K. Not verified: Bitwarden's and Qwik's
conflicts; Codex as the merger with a real Codex.

Merged into main (2026-10-20).

## V26b — keep both by rule, built and dropped (2026-10-20, branch `milestone/v26b-keep-both`, deleted)

Asked: "he should just merge the 2", on the merger's e2e screenshots (the fake agent's first
answer there drops a side on purpose). V26b was built (a rule before the agent: every region an
addition on both sides, no line in common, in code whole top-level blocks, JSON still parsing),
then tried on real merges, then dropped: "any conflict should be resolved by the agent". Every
conflict goes to the merger agent, as V26c built it (decision 164).

**Learned**:
- **Where the rule applies, it is mostly docs.** The last 200 merges of Symbiote, Bitwarden, Qwik, zod,
  vite and CPython (952 merges, 171 conflicting, replayed with `git merge-tree --write-tree` in
  diff3 style): it wrote 8 (Symbiote's journal 6 of 11, CPython's `Misc/NEWS` 2), 6 equal to the
  committed merge.
- **A rule cannot see meaning.** File by file it would have kept two `PLAN.md` rows that both
  claim V21 (Symbiote `01161fa2f`; the committed merge renumbered one), a changelog's entries twice
  under two headings (vite `67a8f8022`), and statements added inside a method in the wrong order
  (Bitwarden `0da4f7df7`). Each needed its own guard.
- **The real merger agent on this repository's 11 conflicting merges**, through `symbiote merge` with
  Claude Code 2.1.303 (`sonnet`) and a conflict-marker check: of the 5 the rule left to it, 3
  landed (2 equal to the committed merge, blank lines aside in one; 1 missing a line the committed
  merge changed outside the regions, as V26c found), and 2 stopped rightly with "needs you" (a
  README section rewritten on one side; two milestones both numbered V21). 10.0K–56.3K input
  tokens, 9.9–49.3 s a run. `main` moved only on `--approve`.
