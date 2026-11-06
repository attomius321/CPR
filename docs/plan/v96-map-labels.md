# V96 — Project names never cover file names on the map

[Index](../PLAN.md) · [Journal](../journal/v96-map-labels.md)

**Status:** planned (2026-11-06), to be built on branch `feature/v96-map-labels` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

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
