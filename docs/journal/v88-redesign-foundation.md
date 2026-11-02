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

## V88 — the kits' colours, shared states and parts; no honeycomb (2 November 2026, branch `feature/redesign-foundation`)

Both modes' tokens from the kits in dark, light and the system's light; one set of states (amber
the agent's turn and in progress, violet the person's, green passed, red failed, cyan paused);
`StatusLabel`, `StageTrack`, the buttons, the page head's tile and `.card-head` on every card's
head, from `src/ui`; the honeycomb, sheen, streak, glow and gloss removed. Decisions 812–821.

**Learned**:
- **`--panel` was `--side` in disguise.** The two were equal since V61, and 28 card grounds used
  `--side`, 11 `--bg`. The kits' light theme flips the grounds (grey page, white cards): the first
  after-shots showed Hive's Review tab as a grey pane in a white card. Cards are `--panel` now,
  and the rings and hollow fills that stand a mark off a card follow it.
- **Amber meant three things.** 45 `--warning` uses: 28 the person's turn, 13 real warnings, 1 a
  pause, and 3 rules that were neither (a crown, a tile). Two guards now keep `--you` and
  `--warning` to selectors that name their meaning; two real warnings needed their selectors
  named (`merge-check-head`, `merge-control-why`).
- **The arrival needed less than feared.** Without the comb and the streak it is the Mind, the
  shutter closing, the swap and the shutter opening onto the page; `data-hive-arriving` stays
  (Alpha Ceph's e2e reads it), the wait for CSS animations went with them.
- **Two copies of the tokens live outside the viewer**: the desktop app's window and title bar
  (`frame.ts`) and its start page (`start/start.css`); both changed with `test/frame.test.ts`.
