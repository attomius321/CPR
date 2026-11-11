# Journal: V96 — Project names never cover file names on the map

[Index](../JOURNAL.md) · [Plan](../plan/v96-map-labels.md)

## V96 spike (2026-11-06, from chore/improvement-audit)

The improvement audit opened Bitwarden 737ee3f's graph (Angular plugin; 31 files, 86 changed
symbols, 6 projects) with `scripts/viewer/measure.mjs --shot`, at 1440×900 and 1x, three rounds.
The timings were first paint 307–340 ms, select 103–104 ms, mark reviewed 34 ms, pan 63 fps, no
page errors.

In the shot, at the opening zoom (a map):
- "desktop" covers the file name "vault-l…" in its frame's first row
  ([shot](../images/chore-improvement-audit/bitwarden-map-desktop-label.png)).
- "storybook", a context-only frame, is drawn over a file label inside its small frame
  ([shot](../images/chore-improvement-audit/bitwarden-map-storybook-label.png)).
- "@bitwarden/components", also context only, runs out of its frame over another label.

The cause, from the code: on the map a name is ~28 px on screen (`map.css:145-162`) while a frame
keeps 46 graph px over its first row (`flow.ts:161`), ~9 px on screen at zoom 0.2. A context
frame's name has no width clamp (`map.css:164-168`).

Not started.

## V96 — project names as tabs, file names under them faint (2026-11-11, branch `feature/v96-map-labels`)

On the map a project's name is now a tab on its frame's top edge, half outside, on the panel's
ground, inside the frame's width (938). A file name a tab is still over is drawn at 35 % once the
zoom rests (939). `mapLabels` (`graph/map-labels.ts`) gives each file box the zoom below which a
name covers it. It runs in the layout worker after `layoutFlow`; map.css compares that zoom with
`--symbiote-cut`. A frame draws its files' findings counts, above its name (998, amends 970).
`layoutFlow` is unchanged.

**Learned**:
- **Chromium on Linux rounds each glyph to whole pixels at the map's sizes.** Geist Mono at 14 px
  is 8 px a character, not 8.4. Geist at 28 px draws "desktop" 112 px wide, 3 % more than its
  advances measured at 100 px. A width table measured at one size does not hold at another. The
  table is measured at the sizes drawn: 28 px at weight 600, 14 px at 500. Each entry is the
  larger of the whole pixels and the exact advance, rounded up: it holds where glyphs are not
  rounded too.
- **`main`'s 0.62 em a character is an average of 0.50 to 0.68** on 31 real project names. Good
  enough to size a name; not to say which file names it covers. The name's box is now set to the
  measured width, so what the model sees is what is drawn.
- **The fit left the padding out.** `frame-width / name-length / 17.36` sized the text to the
  frame and the box ran 16 px (scaled) past it: "@bitwarden/common" crossed its frame's edge.
- **A frame's node is drawn above its files'** (2001 over 2000), so a count a file box draws can
  never be above its frame's name: one of Bitwarden's 6 was under "@bitwarden/vault". The frame
  draws them now.
- **CSS can compare two numbers.** `clamp(0.35, 1 + (cut − cover) × 10⁶, 1)` is 1 at or above
  `cover` and 0.35 below. It reads `--symbiote-cut` only, which changes when the zoom rests. So
  the plan's pass at rest in `Canvas.tsx` (another workspace's file this week) was not needed.
- **Rows of frames are 80 graph px apart**, not 30 (`CLUSTER_GAP`, not dagre's `nodesep`). At
  Qwik's opening zoom (0.122) that is 10 px on screen, against half a tab's 20.5. A tab in the
  second row reaches the bottom of the frame above: "vnode-diff.ts" is faint under "qwik-docs" and
  "qwik-e2e".
- **A measuring script that pans by dragging can click.** A press with no move zoomed into a file,
  and the visits after it measured at 0.14 instead of 0.3: three names were reported covered that
  were not. `scripts/viewer/map-labels.mjs` now zooms from the fitted view at each frame's corner
  (the point under the pointer stays put) and checks the zoom at each visit.

**Verification**: tests first. `test/map-labels.test.ts` (15) and `e2e/map-labels.spec.ts` (3)
failed on `main`'s code for the right reason. The e2e draws the `projects` fixture's four frames
at 0.3 and 0.12: four file names were drawn whole under a name at each zoom, none faint. Both
pass now. `scripts/viewer/map-labels.mjs` ran on Bitwarden 737ee3f (Angular plugin) and Qwik
65661bf49 (Qwik plugin), with `main`'s build and this one. At the opening view, 0.3 and 0.2,
every frame visited:
- file names drawn whole under a name: 7, 5, 6 → 0 on Bitwarden; 2, 1, 1 → 0 on Qwik;
- names past their frame's edge: 3, 1, 2 → 0 on Bitwarden; none on Qwik before or after;
- counts under a name: 1 → 0 at Bitwarden's opening view.

`mapLabels` costs 0.4–1.0 ms a layout (median, in the worker) against `layoutFlow`'s 9–43 ms on
the same views. V105's layout snapshot passes untouched. `measure.mjs` alternated with `main`'s build, 10 rounds each on
Bitwarden: first paint 345 and 348 ms, select 103 and 109 ms, mark 50 and 52 ms, pan 63 fps
(medians). `interactions.mjs` alternated: zoom out and in, select and mark the same on both, no
blocked time. `pnpm check`: 3,550 unit tests. `syntax.test.ts`'s 50 ms budget for 2,000 lines
failed once (81 ms) under two other workspaces' runs; it passed 5 times alone and in the next
whole check. `pnpm build`. `pnpm test:e2e`: the viewer's 470 and the nexus's 32, none failed or
flaky. The first full run failed `projects.spec.ts`'s ratio of a name's height to a file name's
(1.406, checked at 1.45): the fit now counts the name's padding, so it is checked at 1.35.

Not verified: the app's window (Electron); every shot is headless Chromium on Linux. macOS draws
glyphs at fractional advances; the width table keeps the exact advance too, so a name is never
measured narrower than drawn there, but it was not run. Settings' text sizes were not shot: the
graph keeps its own sizes at every text size (decision 438).

