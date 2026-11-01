# Journal: The milestone skill for workspaces

[Index](../JOURNAL.md)

## The milestone, regression-check and viewer-check skills for workspaces (2026-11-01, branch `chore/milestone-skill-workspaces`)

The `milestone` skill described work done by hand in the person's checkout: a
`milestone/<id>-<slug>` branch, the plan committed and pushed at once, and the merge and its
"Docs: <ID> merged" commit made by the agent. Most work now runs in Symbiote workspaces: 134
records, 124 of them started plan first, 5 in Hive. Since 2026-10-20, 119 of 132 merges into
`main` carry the merger's subject (`Merge <branch>: …`) and 13 the skill's. 75 plan Status lines
name a `feature/` branch and 25 a `milestone/` one.

Now:

- The `milestone` skill opens with "Where you are": outside a workspace, a workspace, a Hive
  workspace. For each it gives the branch, when the plan is committed, pushing, how the work
  reaches `main`, who marks it merged, and what to do with an unrelated bug. Hive's own rules stay
  in CLAUDE.md's "Which rules are which mode's", which HV4 changes. The ID families come from the
  index (24 prefixes; the skill listed 9). The templates name the workspace's branch.
- CLAUDE.md's Workflow: a workspace's own branch first; with plan first, nothing is committed
  before the OK; in a workspace the merger merges; merged work is marked on `main` by a script.
- `scripts/plan/mark-merged.mjs` (the person's choice of four): for every merged branch, ✅ in the
  index, the plan's Status and the journal's last line, on `main`, committed as "Docs: merged".
- `regression-check` and `viewer-check` build `main` from `git archive` in a folder of their own.
  A workspace may not add a worktree, and a fixed `/tmp/symbiote-base` is shared by sessions that
  run side by side. `viewer-check` runs the copy's own `measure.mjs`, and says what to do about a
  timing spec that fails under other workspaces' load and about Xvfb displays.

**Learned**:

- **The skill's text gave two answers wrong in every workspace.** A reader test
  (`spikes/skill-reader-test/`): a fresh `claude -p` (Opus, no tools, no settings) reads CLAUDE.md
  and the three skills and answers seven questions in four situations, twice. On `main`'s text it
  got 46 of 56. Plan-first and Hive agents committed the plan before the OK (4 of 4: "the
  milestone skill's step 'commit Plan <ID>, push' applies"). In every workspace the agent found
  nothing on who marks merged work (6 of 6: "the documents don't say who does it after a
  Symbiote merge"). The start prompt already settled the branch, the merge and the worktree.
- **The index falls behind on its own.** `chore/plan-index-status` fixed 70 rows by hand on
  2026-10-30. Two days later 23 more rows of merged branches said "ready for review" (V82–V87,
  HV2, HV3, NU2, NX4 and their fixes). There were 14 "Docs: … merged" commits for 132 merges
  since 2026-10-20.
- **A branch can be merged and still move on.** V40's branch got one commit after its merge that
  never reached `main`. The manual chore counted it merged by the merge's subject; the script
  lists it as a note, with the number of later commits, for a person to settle.
- **`measure.mjs` waits until killed on a graph with no changes** (ky `HEAD~1..HEAD`): it has
  nothing to open. Now in `viewer-check`.
- **Hive pushes a plan-first workspace to commit**: a turn that ends with no commit spends a
  round ("no commit on <branch>", `hive-runner.ts`). HV4 drops plan first in Hive (decision 773).
  Until then the skill sends a Hive workspace to its start prompt and Hive's messages.

**Verification**: tests first. `plan-mark-merged.test.ts` was red (no script), then 3 of 3; each
later fix got its case first (the Status phrasing, a row marked ✅ by hand whose Status fell
behind, a branch that moved on after its merge). The script on `main` as it was before the manual
chore (`c88b237`) marks the same index rows that chore marked, except V40 (a note) and two
duplicate rows the chore deleted, with the same merge dates in the Status lines, in 0.7 s. On
today's `main` it finds 23 rows to mark and 9 notes (spikes whose rows say "measured" or
"proposed"). The reader test on the new text: 56 of 56, twice (before and after trimming the skill
to 119 lines, from 90; $1.07 and $1.06). The `git archive` baseline installed and built in 4 s. `r1` on it
and on this branch: ky and zod identical (271 edges); vite and RealWorld are not cloned on this
machine, so 23 of 29 comparisons could not run, on either side. `measure.mjs` from the copy and
from the branch on ky `0d59458`: first paint 193 and 192 ms, no page errors. `pnpm check` and
`pnpm build` green.

Not verified: a real workspace agent working with the new skill (the reader test reads the docs
alone, without Claude Code's own instructions); the script's `--write` on today's `main` (it runs
there after this merges).
