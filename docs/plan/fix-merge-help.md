# Fix — `symbiote merge --help` names every default target in order

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S6)

**Status:** planned (2026-11-06), to be built on branch `fix/merge-help` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/merge-help` · **Size** S · **Depends on** none · **Plan** P24 of
51 (the audit's order)

## The brief

**What happens**: `symbiote merge --help` says `--into` defaults to "the branch its workspace
started from, else the one the approval names, else the default branch". The code first takes
the branch the workspace is reviewed against (V65, decision 473), then those three.

**How to reproduce**: `node packages/cli/dist/bin.js merge --help`, then compare with `targets`
in `packages/cli/src/merges.ts:454-463`.

**Where to look**:
- `packages/cli/src/main.ts:338-339` (`MERGE_HELP`'s `--into`).
- `packages/cli/src/merges.ts:458-463`: `[workspace?.against, workspace?.from, verdict?.into,
  await defaultBranch(…)]`.
- `docs/reference/commands.md:130`: already right ("the branch the workspace is reviewed
  against, else …").
- `docs/area/merger.md:268-269` lists this as a known trap, "not fixed".

**Out of scope**: the order itself (decision 473 stands), the Merge into menu in the viewer.

**Done when**: the help names the four in the code's order, `docs/area/merger.md`'s trap is gone
(the area page changes in the same commit as the code it describes, CLAUDE.md), and a test pins
the order.

## Evidence

- **Code**: read in `merges.ts:458-463` and `main.ts:338-339`. `docs/area/merger.md` records the
  same gap.

## Approach

- Rewrite the `--into` line: "Branch to merge into (default: the branch it is reviewed against,
  else the one its workspace started from, else the one the approval names, else the default
  branch)". Keep the 90-column wrap of the options table.
- Remove the trap at `docs/area/merger.md:268-269`, and check the page's "Checked against the
  code" line.

## Tests first

`packages/cli/test/main.test.ts`, near the activity help test (`:604`):
`symbiote merge --help` matches `/reviewed\s+against[^]*started\s+from[^]*approval[^]*default/`.
It fails today (no "reviewed against").

## Verification

- `pnpm check`, `pnpm build`; read the help at 80 columns.
- `grep -n "into" docs/area/merger.md docs/reference/commands.md`: the three texts agree.
