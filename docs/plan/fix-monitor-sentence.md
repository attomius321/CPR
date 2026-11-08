# Fix — The Monitor's sentence on a small repository

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V11)

**Status:** planned (2026-11-06), to be built on branch `fix/monitor-sentence` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/monitor-sentence` · **Size** S · **Depends on** none · **Plan** P34
of 51 (the audit's order)

## The brief

**What happens**: on a repository of two source files the Monitor says "14 lines of code in 2
files. Half of it is in 1 file (50 %); the largest file holds 50 %." The two clauses say one thing
twice. The first percentage is a share of the **files**, but it sits next to "half of it" (the
lines), so it reads as a share of lines.

**How to reproduce**: a `symbiote view` in a repository of two `.ts` files (the e2e's `callers`
fixture), then `/monitor`. Unit level: `headline(concentration(node), 'lines of code')` for a
folder of two files.

**Where to look**:
- `packages/viewer/src/monitor/codemap.ts:161-181` (`concentration`).
- `:193-206` (`headline`: "Half of it is in N files (P %)"; when `tenth === 1`, "the largest file
  holds P %").
- `packages/viewer/test/codemap.test.ts:105-125` (two expected sentences).
- Decision 325 (the concentration in words).

**Out of scope**: the treemap; the heat steps; larger repositories' sentences, unless they say the
same thing twice too.

**Done when**:
- When the files holding half are the largest tenth, one clause about concentration, not two.
- Any percentage of files reads as files ("1 of 2 files"), never as a bare "(50 %)" after "half of
  it".
- The existing cases in `codemap.test.ts` keep their meaning.

## Evidence

Reproduced in the audit's own view on a scratch repository: the line above, word for word
(`monitor: ["14 lines of code in 2 files. Half of it is in 1 file (50 %); the largest file holds
50 %."]`). An earlier run, 13 lines, said "(50 %)" then "54 %".

## Approach

In `headline`:
- When `c.half === c.tenth` (the files holding half are exactly the largest tenth: on 2 files,
  whenever one holds half), say only the largest-files clause:
  "The largest file holds 54 %." (or "the largest 2 files hold…").
- Otherwise keep both, and write the first as "Half of it is in 6 of 20 files (30 %);".

## Tests first

`codemap.test.ts`:
- Two files of 7 and 6 lines → `['13 lines of code in 2 files.', 'The largest file holds 54 %.']`.
  Red today.
- The existing 20-file case expects "in 6 of 20 files (30 %)".

## Verification

`pnpm check`; `e2e/monitor.spec.ts`; a screenshot of `/monitor` on this repository and on the
scratch repository, both themes.
