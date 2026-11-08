# Chore — e2e specs poll instead of fixed waits

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding Q4)

**Status:** planned (2026-11-06), to be built on branch `chore/e2e-waits` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/e2e-waits` · **Size** S · **Depends on** none · **Plan** P47 of
51 (the audit's order)

## The brief

**What to change**: `packages/viewer/e2e` has 27 `waitForTimeout` calls in 15 specs. Most are
deliberate "nothing happens in this time" windows and stay. The ones that wait for something to
finish race on time under other workspaces' load: replace them with a poll on what they wait for.

**Where to look** (read for this plan; each with what it waits for):

| Spec:line | Wait | What it waits for | Change |
|---|---|---|---|
| `large-graph.spec.ts:126` | 400 ms | the zoom-out to end, then a label's height | poll the height until two reads agree (`expect.poll`) |
| `large-graph.spec.ts:174` | 400 ms | "the pan to the selection is animated" | `settledBox()` from `projects.spec.ts:28` |
| `pan.spec.ts:36` | 500 ms | "Let the opening fit settle" | poll the viewport's transform until it stops |
| `workspaces.spec.ts:1197`, `:1200` | 200 ms each | a hover's CSS transition, before and after | emulate `reducedMotion: 'reduce'` for the test, or read the colour with `expect.poll` |
| `edges.spec.ts:126`, `:147` | 300 ms | nothing: "a press that does not move the view leaves every edge drawn" | keep; add a comment that it is a negative window |

The others (`alpha-ceph`, `events`, `hive`, `tooltips`, `activity`, `nucleus`,
`skills`, `intro`, `projects.spec.ts:31` inside `settledBox`) are negative windows or clocks the
spec controls; check each and leave a one-line comment where there is none.

**Out of scope**: `intro.spec.ts`'s timing tests (a known flake under load, with its own plan in
memory: run alone, do not patch); any change to the viewer's code; the fast-forward flake (P32).

**Done when**:
- The five racing waits are polls; `grep -c waitForTimeout` drops by 5.
- Every remaining `waitForTimeout` has a comment saying it is a negative window or why the time.
- The touched specs pass 10 times in a row under load (`--repeat-each 10` while another
  `pnpm test:e2e` runs).

## Evidence

**Measured**: 27 calls (`grep -n waitForTimeout packages/viewer/e2e/*.ts`). The audit counted
`edges.spec.ts:126,147` among the racing ones; read again for this plan, they are negative
windows (the assertion is that nothing changed), so they stay. No flake of these specs was seen in
the audit's run (430 of 431 passed); the risk is the pattern, as AR1 found for other specs.

## Approach

Use the helpers that exist: `settledBox` (`projects.spec.ts:28-40`) moves to `e2e/symbiote.ts` or
a small `e2e/settle.ts` so other specs import it; `expect.poll` for values.

## Tests first

The specs are the tests. Before the change, run each touched spec with `--repeat-each 10` under
load and record the result (it may pass: then the change is preventive, say so).

## Verification

- `pnpm build`; `pnpm test:e2e`; the touched specs with `--repeat-each 10`, alone and under load.
- Their run time before and after (a poll is usually faster than a fixed wait).
