# Journal: V99 — A picked symbol lands readable

[Index](../JOURNAL.md) · [Plan](../plan/v99-picks-land-readable.md)

## V99 spike — picks that stay unreadable (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

On the last 26 merges into `main` with code, 24 open with names under 11 px (median zoom 0.16, 1.9
px). A pick zooms only from the map (decision 886): between zoom 0.45 and 0.92 it stays where it is,
and 5 of 26 merges open there. On the small fix (`fix/e2e-flakes`), the picked `MergerOptions`
stayed at 5.9 px ([shot](../../spikes/graph-usability/shots/p03-pick-keeps-the-zoom-dark.png)). From
the map a pick lands at zoom 1, where names are 12 px, under the person's 15 px. In the walks,
"follow callers" took 6–21 wheel notches to make a name readable.

Not started.

## V99 — a pick lands readable (2026-11-11, branch `feature/v99-picks-land-readable`)

A pick whose symbol's name would be drawn under 11 px now comes to the reading zoom. That zoom
puts the graph's 12 px names at the person's body size: 1.25 by default, 1.17 and 1.33 for
Compact and Large. A readable pick in view moves nothing, and one out of view pans at the
person's zoom. The first fit, Focus, a group's reveal and the map's clicks stop at the reading
zoom, not at 1 and 1.1. Decisions 966–967.

**Learned**:
- **A card at the reading zoom can be wider than the canvas.** `resize.spec.ts` failed in the
  first full run. Its change opens at 0.72, so the pick now comes to 1.25, where the card is
  310 px wide. The panel dragged to its limit leaves a 238 px canvas. The canvas centres the card,
  and the spec now says so. On `main` the same happened only from the map, where a pick came to 1×.
- **V93's map branch was a special case of the rule.** On the map a name is under 5.4 px, so
  `pickView` zooms there too. The rule needs no `MAP_ZOOM`.
- **A small change does not always reach 1.25.** `callers` opens at 1.25 at 1920 × 1080, but at
  1.22 at 1440 × 900, where it is wider than the canvas at 1.25. The fit's cap is a cap, not a
  target. The e2e checks both.
- **React Flow draws no node off screen.** A spec that asks for an off-screen node's box waits
  forever: `pick.spec.ts`'s `inView` counts the node first.

**Verification**: tests first. `mapzoom.test.ts`: `readingZoom` and `pickView` were red (not a
function), and a test reads the stylesheet's 12, 14, 15 and 16 px. `e2e/pick.spec.ts` had 8 tests.
Against `main`'s build 7 failed for the right reason: zoom 1 not 1.25, 7.2 px not 15, 0.6 not
1.25, 1.1 not 1.25. The 8th, 886's guard at zoom 1.3, passed on both. `pnpm check`: 3,466 unit
tests. `pnpm build`. `pnpm test:e2e`, first run: 444 passed and 2 failed. One was
`resize.spec.ts`, which now follows the reading zoom (above). The other was
`events.spec.ts:201`, a 500 ms timing test run while Bitwarden's graph was being made; it passed
alone. The second run, on a quiet machine: the viewer's 446 and the nexus's 32 passed.
`interactions.mjs` against `main`'s `git archive` build, alternated, two runs of 3 rounds:
Bitwarden select 64 and 63 ms on `main`, 64 and 65 ms on V99; mark 8 ms both. The refactor's merge
(eb807773): select 295–297 ms on `main`, 287 ms on V99. Shots of the small fix's pick, 2560 ×
1440, 1x, both themes: `MergerOptions` at 0.494 (5.9 px) on `main`, at 1.25 (15 px) here
(`docs/images/v99-picks-land-readable/`).

Not verified: the app's window (Electron), because every shot is headless Chromium. A Text size
changed in another tab while a canvas is open was read from the code, not tested.
