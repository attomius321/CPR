# Journal: V88 — Redesign foundation: both modes' colours and the shared parts

[Index](../JOURNAL.md) · [Plan](../plan/v88-redesign-foundation.md)

## V88 spike — what the kits change, counted (2 November 2026, branch `feature/redesign-foundation`)

Counted on `42b3b57` the uses the brief names, and ran the kits' token values through the rules of
`packages/viewer/test/tokens.test.ts` (text 4.5:1 and states 3:1 on the four grounds, lanes on the
ground and raised, lines 1.2:1).

**Learned**:
- **Amber is mostly "waiting for you"**: of 45 `--warning` uses, 28 mean the person's turn, 13 a
  real warning, 1 a pause; the agent's turn is drawn in cyan (`--moved`, `--info`) today.
- **Hive's identity hides in `--error`**: 9 of 41 uses are Hive's tile, mark, state and warning box.
- **The kits pass but for one line**: the light `--line` on the grey ground is 1.17 (normal) and
  1.15 (Hive); the spike measured it on a white card (1.28). Darkened to `#dadee7` and `#dcdce2`
  (1.23 each).
- **No page shows the stage track's steps today**: Hive's head says them in a sentence ("Hive
  drives it: round 2 of 3"), normal mode nowhere. The component is built and placed later.
