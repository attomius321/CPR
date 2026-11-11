# V96 — Project names never cover file names on the map

[Index](../PLAN.md) · [Journal](../journal/v96-map-labels.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v96-map-labels`; planned
2026-11-06 by the improvement audit (`chore/improvement-audit`).

**Kind** feature (milestone) · **Branch** `feature/v96-map-labels` · **Size** M · **Depends on**
none · **Plan** P28 of 51 (the audit's order)

## The brief

**What to change**: on the map (zoom under `MAP_ZOOM`, 0.45), a project frame's name is drawn over
the file names in its frame's first row, and a small frame's name runs out of its frame over its
neighbours' labels. Make every project name and every file name readable at once.

**Where to look**:
- `packages/viewer/src/graph/map.css:135-168`: on the map the name is `2 × --size-body` scaled by
  `clamp(0.5 / zoom, frame-width / name-length / 17.36, 1 / zoom)`, about 28 px on screen.
  A context frame's name (`.project-frame.context`) is `1 / zoom` at body size, with no clamp to
  its frame.
- `packages/viewer/src/graph/flow.ts:161-162`: `FRAME_PAD` top 46 and `LIGHT_FRAME_PAD` top 34
  graph px.
- `flow.ts:389-414` (frames sized and packed), `:816` (`packFrames`, dagre `nodesep` 30,
  `ranksep` 90).
- `packages/viewer/src/graph/ProjectNode.tsx` (`--frame-width`, `--name-length`) and
  `src/graph/mapzoom.ts` (`--symbiote-zoom`, `--symbiote-cut`, `CUT_REST_MS`).
- The viewer's `CLAUDE.md`, "Rules": the map's label rules (fixed sizes scaled by `1 / zoom`, never
  a font size per zoom, a cut laid out only once the zoom rests); layout never depends on
  selection.

**Out of scope**: the symbol view above `MAP_ZOOM`; frame placement (`packFrames`' rows); file
boxes' own labels apart from where a project name meets them; the minimap.

**Done when**:
- On Bitwarden 737ee3f (Angular plugin) at the opening zoom, no project name's box intersects a
  file name's box, and every project name is inside its frame's width, measured in the page.
- The same holds at three map zooms (opening, 0.3, 0.2).
- Bitwarden's first paint, select, mark and pan are within 10 % of today's.

## Problem (asked: "find what can be improved"; finding V7 of the audit)

On Bitwarden 737ee3f with the Angular plugin, 86 changed symbols in 31 files across 6 projects, at
the opening zoom (`scripts/viewer/measure.mjs --shot`):

| Frame | What is covered | Shot |
|---|---|---|
| desktop | the name covers the file name "vault-l…" in its first row | [bitwarden-map-desktop-label.png](../images/chore-improvement-audit/bitwarden-map-desktop-label.png) |
| storybook (context only) | the name is drawn over a file label inside its small frame | [bitwarden-map-storybook-label.png](../images/chore-improvement-audit/bitwarden-map-storybook-label.png) |
| @bitwarden/components (context only) | the name runs out of its frame over another label | (same run) |

Why:
1. On the map a name is ~28 px on screen while the frame keeps 46 graph px over its first row. At
   zoom 0.2 that is ~9 px on screen, so the name falls on the first row's file names.
2. A context frame's name has no width clamp: `1 / zoom` at body size, however narrow its frame.
3. The layout is zoom-free, as it must be (layouts are made per view in a worker, V8e). The space
   cannot be made in the layout for one zoom.

**Goal**: on the map, each project name is readable (its size today, or smaller only to fit its
frame) and no file name is drawn under one. Off the map nothing changes, and a single-project
graph has no frames, so it is unchanged.

## Design

### The name band on the map

- On the map the name sits **on the frame's top edge, half outside**, like a tab: its box is
  `translateY(-50%)`, its ground `--panel`. The frame's first row then loses at most half the
  name's height, not all of it.
- Frames are ≥ 30 graph px apart (`nodesep`), so a tab's top half at 28 px screen fits between
  rows only above ~zoom 0.5. That is why the second rule is needed.

### File names give way under a project name

- Once the zoom rests (`CUT_REST_MS`, the moment the file-name cut is laid out today), a pure
  function `coveredLabels(frames, fileBoxes, zoom)` (new, `src/graph/map-labels.ts`) gives the
  file boxes whose name box meets a project name's box at that zoom. Those file names get a class,
  `under-name`, drawn at 35 % opacity and without pointer, and their box keeps its click.
- The rects are graph coordinates scaled by the zoom: no DOM reads, as the cut does today. Cost
  target under 1 ms on Bitwarden's map: 31 files, 6 frames.
- Above `MAP_ZOOM` the class is removed: the symbol view's frames have room (46 px pad at zoom ≥
  0.45).

### Every name inside its frame

- A context frame's name gets the same width clamp as a changed frame's:
  `min(1 / zoom, frame-width / name-length / 17.36)`, with no 0.5 floor. A frame narrower than its
  name cuts it with an ellipsis at the frame's width (`max-width: calc(var(--frame-width) * 1px)`
  before the scale).
- The full name stays in the band's tip.

### Why not reserve the space in the layout

A taller `FRAME_PAD.top` on the map (~140 graph px at zoom 0.2) would make every frame taller off
the map too, or make the layout depend on zoom. The viewer's rules exclude both: layouts are per
view, in a worker, and zoom is not part of a view.

## Verification

1. **Unit** (red first): `test/map-labels.test.ts`. Two frames and file boxes with known rects: at
   zoom 0.2 the first-row file under the name is covered and the second row is not; at zoom 0.45
   none is; a context frame narrower than its name gets its name cut to its width.
2. **e2e**: `large-graph.spec.ts` (or a new `map-labels.spec.ts`) on a fixture with 3 projects
   whose first row has a file. On the map, no `.project-name` box intersects a visible
   `.file-name` box (one `evaluate` of bounding boxes), at two zooms.
3. **Real graph**: `scripts/viewer/measure.mjs` on Bitwarden 737ee3f, 3 rounds against `main`'s
   build (viewer-check skill): first paint 307–340 ms, select 103–104 ms, mark 34 ms, pan 63 fps
   today; each within 10 %. `scripts/viewer/interactions.mjs` for zoom: long frames on zoom end
   no worse than `main`'s.
4. **Screenshots**: Bitwarden's map at the opening zoom, both themes, before and after, at the same
   crops as the audit's.
5. **Nothing else changes**: `flow.test.ts`, `layouts.test.ts` and every graph spec as they are;
   layouts identical (`coveredLabels` is decoration, not layout).

**Risks**

| Risk | Mitigation |
|---|---|
| Dimmed file names hide the file the reviewer wanted | 35 %, not hidden; its tip and click unchanged; zooming in clears it |
| The pass after the zoom rests costs frames on large maps | Pure rects, no DOM reads; measured on Bitwarden and Qwik; budget 1 ms |
| A tab half outside the frame meets the frame above it | Frames are ≥ 30 px apart; at small zooms the tab overlaps the gap, not files; the screenshots show it |

**Order**: the context frame's clamp first (smallest, fixes storybook and components), then the
tab, then `coveredLabels`.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V96a | Context frames' names clamped to their frame | CSS in `map.css`; the e2e assertion for width |
| V96b | The name as a tab on the frame's edge | `map.css`; screenshots |
| V96c | File names under a project name give way | `src/graph/map-labels.ts` (pure, tested), `Canvas.tsx` sets the class at the zoom's rest; viewer-check numbers |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 938 | Where a project's name goes on the map | **On the frame's top edge, half outside, its ground the panel's; a context frame's name clamped to its frame's width as a changed frame's is** | Bitwarden: the name covered the first row's file names; a context name ran out of its frame |
| 939 | A file name under a project's name on the map | **Dimmed to 35 % once the zoom rests, from rects in graph coordinates (no DOM reads); its box keeps its click and tip** | The layout cannot make room per zoom (V8e); hiding would lose the file |

**Not in V96 (later)**: a collision pass between file names themselves (they are cut to their
boxes already); moving frames apart on the map.

## As built

Built as planned, decisions 938–939, with one more (998) and the changes below. Tests first:
`test/map-labels.test.ts` (15) and `e2e/map-labels.spec.ts` (3), on the `projects` fixture's four
frames. On `main`'s build the e2e failed for the right reason: at 0.3 and at 0.12, four file
names were drawn whole under a project's name, and none was faint. Both pass now.

- **No pass at rest in `Canvas.tsx`: each file carries the zoom it is covered from.**
  `Canvas.tsx` is another workspace's this week (V109), and a pass at rest would write a class to
  nodes. Instead `mapLabels` (`graph/map-labels.ts`) runs once a layout is made, in its worker
  (`layoutOf` in `layouts.ts`, and its main-thread fallback). It gives each file box `cover`: the
  zoom below which a project's name meets its name, or comes within 2 px of it on screen. Names
  only grow as the zoom goes down, so `cover` is found by halving between the canvas's least
  zoom (0.05) and `MAP_ZOOM`. `map.css` compares it with `--symbiote-cut`, the zoom once it rests:
  `opacity: clamp(0.35, 1 + (cut − cover) × 10⁶, 1)`, a step. Nothing runs while the view moves
  or when it rests, and no class is written. The plan's `coveredLabels(nodes, zoom)` is kept for
  the tests: the `cover`s agree with it at every map zoom. The layout itself is unchanged:
  `layoutFlow` is as it was, and V105's snapshot of layouts passes untouched.
- **A name's box is its measured width.** `main`'s fit counted 0.62 em a character. Geist draws
  0.50 to 0.68 on the 31 project names of Bitwarden, Qwik and the fixtures. A model built on the
  average would miss file names at the end of a long name. `nameWidth` sums Geist's advances,
  measured in Chromium at the sizes the map draws: 28 px at weight 600, 14 px at 500. Chromium on
  Linux rounds each to whole pixels; each entry is the larger of that and the exact advance,
  rounded up. So a width is never narrower than drawn: 1–5 % wider at 28 px, 3–9 % at 14 px.
  The name's box is set to that width (`--name-width`, written by `ProjectNode`), its text
  centred. What the file names give way to is then exactly the box drawn. A file's name is Geist
  Mono, 0.6 em a character (8 px of 8.4 at 14 px on Linux): 0.6 is counted.
- **The fit counts the name's padding.** `main`'s `frame-width / name-length / 17.36` left the
  16 px of padding out, so a fitted name ran past its frame. `--fit` is now the frame's width
  over the name's whole box. A changed frame keeps its floor, half its size (14 px on screen).
  Under the floor, the name is cut with an ellipsis at the frame's width once the zoom rests:
  "@bitwarden/common" ran out of its frame on `main`. `projects.spec.ts` read the libs/ui name
  at 1.45 times a file name's height or more; it is 1.406 now, checked at 1.35.
- **A frame draws its files' findings counts (decision 998, amends 970).** On the map a frame's
  node (z-index 2001) is drawn above its files' (2000), so a count drawn by a file box can never
  be above a name. At Bitwarden's opening view, one of the 6 counts was under
  "@bitwarden/vault". `mapLabels` moves a framed box's counts to its frame, at the same corners,
  and `ProjectNode` draws them after its name (`MapCounts`, shared with `FileNode`). A box in no
  frame draws its own, as before.
- **A context frame's name has the panel's ground and a ring too** (`main`: no ground). As a tab
  on the frame's edge, the frame's ring would otherwise cross its letters.
- **The gap between rows of frames is 80 graph px, not 30.** The plan took dagre's `nodesep`;
  `placeInRows` puts `CLUSTER_GAP` (80) between rows. At Qwik's opening zoom, 0.122, the gap is
  10 px on screen and half a tab 20.5 px. So a tab in the second row reaches a file name at the
  bottom of the frame above: "vnode-diff.ts" under "qwik-docs" and "qwik-e2e", now faint. The
  risk's "the tab overlaps the gap, not files" holds only above about zoom 0.25.
- **Bitwarden opens at 0.118, not 0.2.** The plan's three zooms are measured as named: the
  opening view, 0.3 and 0.2.
- **A context frame's name has no floor, as planned.** "@bitwarden/components" is a frame 47 px
  wide at Bitwarden's opening view: its name is drawn 5 px high, inside the frame. On `main` it
  was 14 px, drawn over its neighbour's label. Zooming in makes it readable.
- **The measure** is `scripts/viewer/map-labels.mjs`: in the page, each project name's box
  against every file name's and every count's. At a given zoom it visits each frame in turn,
  zooming from the fitted view at the frame's top-left corner. It counts four things: file names
  drawn whole (opacity ≥ 0.9) under a name, the faint ones, names past their frame's edges, and
  counts under a name (hit-tested with every element taking the pointer).

| # | Question | Decision | Why |
|---|---|---|---|
| 998 | Findings counts on the map, in a frame | **The frame draws its files' counts, at their cards' corners, above its name (amends 970's "its box draws its symbols' counts")** | A frame's node is drawn above its files': at Bitwarden's opening view a count was under "@bitwarden/vault" |

## Results

Bitwarden 737ee3f (Angular plugin; 6 frames, 60 file names drawn at the opening view) and Qwik
65661bf49 (Qwik plugin; 3 frames, 39 file names), 1440 × 900, 1x, `main`'s build and this one
(`scripts/viewer/map-labels.mjs`). At 0.3 and 0.2 every frame is visited.

| | `main`: opening; 0.3; 0.2 | V96: opening; 0.3; 0.2 |
|---|---|---|
| Bitwarden: file names drawn whole under a project's name | 7; 5; 6 | 0; 0; 0 |
| Bitwarden: file names faint under a name | — | 6; 3; 4 |
| Bitwarden: project names past their frame's edge | 3; 1; 2 | 0; 0; 0 |
| Bitwarden: findings counts under a name | 1 of 6; 0; 0 | 0; 0; 0 |
| Qwik: file names drawn whole under a project's name | 2; 1; 1 | 0; 0; 0 |
| Qwik: file names faint under a name | — | 2; 1; 2 |
| Qwik: project names past their frame's edge | 0; 0; 0 | 0; 0; 0 |

The opening view's zoom is the same on both builds: 0.118 on Bitwarden, 0.122 on Qwik. Of the
seven names covered at Bitwarden's opening view on `main`, two are now clear:
"vault-list.component.html" under "desktop" (the audit's first finding) and "toast.service.ts"
under "@bitwarden/components". The other five are faint. One more is faint:
"vault-item-event.ts", at the bottom of "web", which the tab of "@bitwarden/common" in the row
below reaches. On Qwik, "suspense.tsx" is clear, "generate-llms.ts" is faint, and "vnode-diff.ts"
at the bottom of the frame above is newly faint.

Nothing costs more. `measure.mjs`, `main`'s build and this one alternated, Bitwarden 737ee3f, 10
rounds each while the machine was quiet (3 earlier rounds, under two other workspaces' runs, are
left out: first paint 620–845 ms on both):

| | `main` | V96 |
|---|---|---|
| First paint, median (range) | 345 ms (322–392) | 348 ms (333–368, one round 3,264) |
| Select, median (range) | 103 ms (91–129) | 109 ms (102–134) |
| Mark reviewed | 50 ms | 52 ms |
| Pan | 63 fps | 63 fps |

The one first paint of 3,264 ms did not come back in five more rounds of this build (333–369 ms).
`interactions.mjs` on Bitwarden, `main`, V96, `main`, V96, 3 rounds each: zoom out ×20 1,032–1,033
ms and zoom in ×10 532–533 ms on both, with no blocked time and no long frame; select 62–65 ms,
mark 7–9 ms, open 313–358 ms on both. Qwik the same. On the map, the file boxes' elements fall
from 426 to 420 and the frames' rise from 42 to 48: Bitwarden's 6 counts are drawn by frames.
`mapLabels` costs 0.4–1.0 ms a layout (median), in the worker, against `layoutFlow`'s 9–43 ms
for the same views.

Shots of the opening view, at 1x
([before](../images/v96-map-labels/bitwarden-map-before-dark.png),
[after](../images/v96-map-labels/bitwarden-map-after-dark.png); light:
[before](../images/v96-map-labels/bitwarden-map-before-light.png),
[after](../images/v96-map-labels/bitwarden-map-after-light.png)), and at 2x the audit's crops:
"desktop" and "@bitwarden/vault"
([before](../images/v96-map-labels/bitwarden-map-before-top-dark.png),
[after](../images/v96-map-labels/bitwarden-map-after-top-dark.png); light:
[before](../images/v96-map-labels/bitwarden-map-before-top-light.png),
[after](../images/v96-map-labels/bitwarden-map-after-top-light.png)), "storybook"
([before](../images/v96-map-labels/bitwarden-map-before-storybook-dark.png),
[after](../images/v96-map-labels/bitwarden-map-after-storybook-dark.png); light:
[before](../images/v96-map-labels/bitwarden-map-before-storybook-light.png),
[after](../images/v96-map-labels/bitwarden-map-after-storybook-light.png)),
"@bitwarden/common" and "@bitwarden/components"
([before](../images/v96-map-labels/bitwarden-map-before-bottom-dark.png),
[after](../images/v96-map-labels/bitwarden-map-after-bottom-dark.png); light:
[before](../images/v96-map-labels/bitwarden-map-before-bottom-light.png),
[after](../images/v96-map-labels/bitwarden-map-after-bottom-light.png)), and Qwik's second row
([before](../images/v96-map-labels/qwik-map-before-bottom-dark.png),
[after](../images/v96-map-labels/qwik-map-after-bottom-dark.png); light:
[before](../images/v96-map-labels/qwik-map-before-bottom-light.png),
[after](../images/v96-map-labels/qwik-map-after-bottom-light.png)).

