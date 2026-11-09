# Fix — A diff's head and its Findings tab count the same findings

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V11)

> What holds now: [Reviews](../area/reviews.md). This plan is kept as it was written.

**Status:** planned (2026-11-06), to be built on branch `fix/finding-counts` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/finding-counts` · **Size** S · **Depends on** none · **Plan** P35 of
51 (the audit's order)

## The brief

**What happens**: on the `callers` fixture's diff the head shows "1 error · 1 warning" while the
Graph page's Findings tab says "Findings 3". The third is an info ("add changed its signature
compatibly…"), which the head never counts, so the two numbers disagree with nothing saying why.

**How to reproduce**: `serveFixture('callers')`, then the diff's Graph page (`?view=graph`): the
head's pills and the tab's count.

**Where to look**:
- `packages/viewer/src/diff/App.tsx:842-861` (`FindingPills`: error and warning pills only, as
  decision 839 says).
- `src/diff/Sidebar.tsx:135` (`Findings {graph.findings.length}`, every severity).
- `:19` (`SEVERITY_ORDER`, info included).
- Decision 839 (V90): "errors and warnings as pills".

**Out of scope**: what is a finding and its severity (core's detectors); the pills' look.

**Done when**: the head and the tab can be read together. Either the head adds a quiet "· 1 info"
after its pills, as text and not a pill, or the tab's count gets a tip "1 error, 1 warning,
1 info". Decided from a screenshot of both. Decision 839 still holds (pills for errors and
warnings only).

## Evidence

Reproduced in the audit at 1x on the `callers` fixture: the head said "1 error · 1 warning", the
tab "Findings 3" (light theme Graph page shot, kept in the audit's scratch).

## Approach

Recommended: the tab's count keeps every finding (it is the list's length), and the head adds
`· N info` in `--muted` after the pills when infos exist. It is text, so 839's "pills" stays
true, and the sums agree at a glance. The words go in `FindingPills` from the same `severity()`.

## Tests first

`e2e/reviews.spec.ts` or `files.spec.ts` on `callers`: the head's text contains "1 info" while the
tab says 3. Red today. A unit test is not needed: the count is a filter.

## Verification

`pnpm check`, `pnpm test:e2e`; screenshots of the Files and Graph heads, both themes; the head's
`end` stays on the title's line at 1,440 px (`page-frame.spec.ts`).
