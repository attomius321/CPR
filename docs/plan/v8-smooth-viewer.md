# V8 — A smooth viewer

[Index](../PLAN.md) · [Journal](../journal/v8-smooth-viewer.md)

**Status:** planned (2026-10-12); V8a merged into main (2026-10-12, from branch
`milestone/v8a-zoom-labels`); V8b merged into main (2026-10-13, from branch
`milestone/v8b-map-clicks`); V8c merged into main (2026-10-13, from branch
`milestone/v8c-edges`); V8e merged into main (2026-10-13, from branch
`milestone/v8e-layout-worker`). **V8 closed (2026-10-13)**; V8d deferred (V8c met its targets).

**Problem** (asked: "it works really flaky and laggy. What are our options to improve the client
side viewer?"). Measured with `scripts/viewer/interactions.mjs` (new: every interaction a
reviewer does, scripted in Chromium; "blocked" sums long animation frames over 50 ms; median of
3 rounds) on today's viewer:

| Interaction | Bitwarden `737ee3f` | Bitwarden `cbf86c2` | Qwik `f7ed58cfc` |
|---|---|---|---|
| Open: took / blocked / worst frame | 674 / 310 / 262 ms | 885 / 148 / 198 ms | 2,082 / 610 / 660 ms |
| Zoom out ×20: blocked / worst frame | 30 / 63 ms | 164 / 122 ms | 603 / 134 ms |
| Next change (j) ×8: blocked / worst | 0 / 0 ms | 38 / 80 ms | 731 / 149 ms |
| Select a change: blocked / worst | 6 / 56 ms | 55 / 105 ms | 362 / 205 ms |
| Context on: blocked / worst frame | 111 / 161 ms | 212 / 236 ms | 874 / 769 ms |
| Map: file-box clicks reaching the file | 91 % | 77 % | 87 % |
| Map: page elements (edges, symbols) | 4,021 (1,417, 1,629) | 7,131 (2,733, 2,780) | 12,788 (6,681, 4,157) |

What causes it, found by profiling (CPU profiles of an unminified build) and by removing one cost
at a time (medians of 5):

1. **The map labels' zoom variable**: `--symbiote-zoom` is set on the page root on every zoom frame;
   an inherited custom property restyles every element under it, though only map labels read
   it. Frozen, zoom-out blocking fell 94 → 14 ms (Bitwarden `cbf86c2`) and 507 → 150 ms (Qwik).
2. **Edges**: with `onlyRenderVisibleElements`, React Flow checks every edge's bounding box on
   every frame of a pan, zoom or animation (`isEdgeVisible`, `nodeToBox` lead the profiles), and
   edges are 38–52 % of the map's elements. Edges hidden plus the variable frozen: zoom-out
   blocking −75 to −90 %, j −39 to −67 %.
3. **Selection**: each j re-renders the whole change list and decorates every node, then animates
   the view for 300 ms; on Qwik the animation gets 4 frames — the canvas jumps in steps, and a
   selection starts moving 670 ms after the click.
4. **Layout on the main thread**: 1.9 s for Qwik `f7ed58cfc` (dagre on its biggest cluster,
   1.3 s); toggling context lays out again (worst frame 769 ms).
5. **Frames on the map catch clicks** (V7b): a frame's name is drawn above its files and takes
   the pointer; 9–23 % of the spots on file boxes zoom into the whole project instead.

**Goal**: no freeze a reviewer notices on Bitwarden-sized changes (no frame over 100 ms while
zooming, panning, pressing j or selecting), Qwik-sized ones usable (blocking halved or better),
the UI never frozen while laying out, and every click on the map landing on what is under the
pointer. Nothing a reviewer sees changes, apart from what each part says.

## V8a — map labels (A)

- Map labels (`.file-name`, `.project-name`) keep fixed font sizes and grow with `transform:
  scale(1 / zoom)` instead of `font-size: calc(13px / zoom)`: a scale needs no text layout.
  The frames' ring (`box-shadow`) keeps its width the same way.
- The zoom value lives in a one-rule stylesheet aimed at those elements (`.file-name,
  .project-frame, .project-name { --symbiote-zoom: … }`), not on the page root, so a change restyles
  them alone; it is only updated while the canvas is a map (below 45 %) or crossing into it.
- Prototype (medians of 5, zoom out ×20): Bitwarden `cbf86c2` 94 → 34 ms blocked, Qwik 507 →
  190 ms; either change alone gained little (the scale alone nothing, the scoped rule half).

## V8b — map clicks (B)

- On the map a frame never takes the pointer, its name included; a click on an empty part of a
  frame reaches the canvas, which finds the frame under it (`screenToFlowPosition`) and zooms
  into it, as a click on a file box zooms into the file. Off the map, a click there deselects
  as today.

## V8c — edges while moving, edges on the map (C)

- While the view moves (`onMoveStart` to `onMoveEnd`, programmatic animations included), React
  Flow gets only the selected symbol's edges; all edges come back when it stops.
- On the map, symbols' edges give way to one edge per pair of linked file boxes (pure, in
  `layoutFlow`: count, sides, crossing projects), drawn heavier by count; symbols' edges come back
  above 45 %. Expected: Qwik's map from 1,670 edges to its file pairs, a few hundred.

## V8d — lighter selection (D)

- The change list's rows are memoized: a selection or a mark re-renders the two or three rows it
  touches, not hundreds; nodes keep their identity unless their decoration changed (today's rule).
- A selection moves the view only when the symbol is out of view (or within a margin of the
  edge); on graphs too large to animate smoothly (a node count measured in V8d), it jumps
  instead of gliding in steps.

## V8e — layout in a worker (E)

- `layoutFlow` (pure; dagre and types only) runs in a module Web Worker. The previous layout
  stays drawn, with a small "laying out…" note, until the next arrives; requests are numbered so
  a late answer never replaces a newer one; recent layouts are kept by their options (context,
  type references, focus, project, opened groups), so toggling back is instant.
- Opening: the sidebar and findings show while the first layout runs.

**Refined before building (2026-10-13; built after V8c, V8d deferred: V8c met its targets).**
Measured in Node (median of 3), `layoutFlow` per view, and the cost of moving data between
threads (V8 serialization, as structured clone does):

| View | Bitwarden `737ee3f` | Bitwarden `cbf86c2` | Qwik `f7ed58cfc` |
|---|---|---|---|
| Default | 217 ms | 187 ms | 981 ms |
| Context off | 67 ms | 47 ms | 227 ms |
| Type references on | 217 ms | 321 ms | 1,021 ms |
| One project (the largest) | 108 ms | 215 ms | 183 ms |
| The largest group opened | 217 ms | 273 ms | 841 ms |
| The graph to a worker, once (send) | 6 ms | 39 ms | 9 ms |
| A layout back (receive) | 4–11 ms | 5–39 ms | 10–42 ms |

In the browser (V8c's results): Qwik opens with 2,348 ms blocked (worst frame 1,575 ms) and
context on blocks 1,279 ms (1,181 ms); `cbf86c2` 942 and 253 ms. Part of that is React drawing
the new layout, which stays on the main thread.

- `src/layout-worker.ts`: a module worker that holds the graph and answers `{ id, options }`
  with `layoutFlow`'s result (its Maps and Sets cross threads as they are).
- `src/layouts.ts`: `layoutKey(options)` (the same view gives the same key, whatever the order
  of its sets); a cache of the last 8 layouts by key that knows the view last asked for (an
  answer for an older one is kept, never drawn); a runner whose requests are numbered and whose
  answers are matched by number; if the worker fails, layouts run on the main thread as today.
- App: the layout memo becomes `useLayout(graph, options)` → the layout to draw and whether a
  newer one is coming. A cached view is drawn at once. The canvas fits a project, the focus or a
  group only once the layout asked for is drawn, so the view moves once. A "Laying out…" note
  shows while one is coming; on opening, the header, change list and findings show at once and
  the canvas says "Laying out…".
- Not in V8e: a faster layout (dagre still takes 1 s on Qwik, off the main thread now); React
  drawing a new layout (measured and reported separately).

## Verification

1. **Unit tests** (red first): the zoom value set only on the map (V8a),
   the frame under a point (V8b), file-pair edges and the moving-edges filter (V8c), the
   selection-moves rule (V8d), layout requests and their order (V8e).
2. **Nothing else changes**: every e2e spec unchanged except where a part changes behavior
   (map clicks); screenshots of the map and a selection before and after.
3. **Real graphs**: `scripts/viewer/interactions.mjs` on Bitwarden `737ee3f`, `cbf86c2` and
   Qwik `f7ed58cfc`, against `main`'s build, back to back, 3 rounds; each part's targets below.
4. **Targets**: V8a — zoom out ×20 blocked ≤ 60 ms (Bitwarden `cbf86c2`), ≤ 300 ms (Qwik).
   V8b — 100 % of map file-box clicks reach the file. V8c — zoom out ×20 on Qwik ≤ 150 ms blocked;
   map edges' elements on Qwik ≤ 1,500. V8d — j ×8 on Qwik ≤ 250 ms blocked, one movement per
   step; select a change ≤ 150 ms. V8e — no frame over 200 ms on the main thread while laying out
   (open, context, groups, project) on any of the three.

**Risks**

| Risk | Mitigation |
|---|---|
| Timings vary ±30 % and more between runs (a 3× spread was seen) | Medians of 3–5 rounds, back to back against `main`; targets with margin. |
| Scaled labels blur (a raster scaled up) | No `will-change` on labels, so they are painted at the final scale; screenshots on the map. |
| Edges popping in after a move feel worse than lag | Only the selected symbol's edges stay during a move; check in the browser; fall back to drawing all edges if it reads badly. |
| A worker makes layout asynchronous: tests and the reveal/fit effects assume it is immediate | Requests numbered; the canvas fits after the layout it asked for arrives; e2e waits on nodes, as today. |

**Order**: V8a → V8b → V8c → V8d → V8e, each on its own branch from the previous, each merged
after its checks and the user's agreement.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V8a ✅ | Map labels | Labels scaled by a transform, the zoom value in a stylesheet for them only, updated only on the map. |
| V8b ✅ | Map clicks | Frames never take the pointer on the map; a click on an empty frame area zooms into it. |
| V8c ✅ | Edges | Only the selection's edges while moving; one edge per linked file pair on the map. |
| V8d (deferred) | Lighter selection | Memoized change-list rows; the view moves only for a symbol out of view, without stepped animation on large graphs. |
| V8e ✅ | Layout in a worker | `layoutFlow` off the main thread, numbered requests, recent layouts kept. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 37 | How map labels follow the zoom | **A transform from fixed sizes; the zoom value in a stylesheet rule for the labels only, updated only on the map** | The root variable restyled every element on every frame; measured −64 % zoom blocking, near the frozen bound. |
| 38 | What takes clicks on the map | **File boxes; frames never** (an empty frame area zooms in through the canvas) | Frame names caught 9–23 % of file-box clicks. |
| 39 | Which edges are drawn | **While moving (over 400 edges drawn): the selection's; on the map: one per linked file pair** | Per-frame visibility checks over every edge; edges are up to half the map's elements. Smaller changes keep every edge (V8c). |
| 40 | When a selection moves the view | **Only when the symbol is out of view; no stepped animation on large graphs** | Qwik's 300 ms glide ran in 4 frames: a jumping canvas. |
| 41 | Where layout runs | **A Web Worker; the last layout drawn until the next arrives** | 1.9 s of frozen UI on Qwik; a toggle froze it for 769 ms. As built (V8e): no long frame while a layout is made; drawing it is one frame of 0.2–0.7 s. |

## As built — V8a

- As planned: map labels keep fixed sizes (13 px, 10 px for unchanged files, 26 px for project
  names) and are scaled by `transform: scale(1 / zoom)`; the frame name's fit to its frame's
  width became a clamp on the scale (`--frame-width` is now unitless). `mapZoomStyle`
  (`src/mapzoom.ts`) owns a one-rule stylesheet for `.file-name, .project-frame, .project-name`
  and writes the zoom there only below `MAP_ZOOM`; `MAP_ZOOM` moved there from `App.tsx`.
- Screenshots of Bitwarden `cbf86c2`'s map before and after: the same labels, sizes and places.

**Results (V8a)**, `interactions.mjs` against `main`, two alternating runs of 3 rounds each,
blocked ms (main → V8a): zoom out ×20 — Bitwarden `737ee3f` 13–35 → 0, `cbf86c2` 102–103 → 32–40
(−65 %), Qwik `f7ed58cfc` 451–466 → 193–219 (−55 %); zoom in ×10 — Qwik 107–115 → 0–5; select a
change — Qwik 342–395 → 280–283. Open, j and context toggles unchanged (V8d, V8e). Map clicks
unchanged (V8b). No page errors; 408 unit tests, 35 e2e.

## As built — V8b

- As planned: on the map nothing of a frame takes the pointer (`.react-flow__node-project *`); the
  canvas's click handler asks `projectAt` (flow.ts) for the frame under the point and zooms into
  it, else deselects. A click on a project's name now reaches what is under the name — usually
  a file box, sometimes the frame's empty top. Off the map, nothing changed.
- README: "a click inside a frame, off its files, zooms into the project".

**Results (V8b)**: file-box clicks reaching the file on the map, `main` → V8b: Bitwarden
`737ee3f` 91 → 100 %, `cbf86c2` 77 → 100 %, Qwik `f7ed58cfc` 88 → 100 %; timings unchanged
within noise; no page errors; 409 unit tests, 35 e2e.

## As built — V8c

- As planned, with three changes:
  - A moving view drops edges only when more than 400 would be drawn (`MOVING_EDGE_LIMIT`):
    smaller changes keep every edge while moving, so nothing pops in (the risk above). Bitwarden
    `737ee3f` (354 edges) never drops them; `cbf86c2` (683) does off the map, not on it (290
    file pairs).
  - A move starts with the view's first change (`onMove`), not with React Flow's start, which
    comes with every press: a click blinked every edge. It ends 100 ms after React Flow's end
    unless the view moves again: an animation interrupted by the next one (j pressed during a
    glide) reports its end after the next has started.
  - Edges have no invisible click path (`interactionWidth: 0`; nothing uses edge clicks or
    hovers): 3 elements per edge instead of 4.
- File boxes have two unseen React Flow handles: React Flow draws no edge between nodes without
  them. A file pair's edge is `edge-files` with a weight (`edge-files-1`…`4` for 1, 2–3, 4–9, 10+
  symbol edges; 3–12 px), its edges' side when they all share one, and `edge-cross` when one of
  them crosses projects.
- Found while measuring: the canvas's click handlers and the minimap's class function were new
  on every render, and React Flow hands them to every node and minimap node. With two more canvas
  renders per move, thousands of nodes re-rendered for an edge change. Now stable.
- Found while measuring: `interactions.mjs` read open's long frames as soon as the first symbol
  was painted, but a frame is reported after it ends: the last and longest one was missed at
  random (main's open on `737ee3f`: 135 ms in one run, 454 ms in another). It now reads them
  once the page is idle. Open numbers above (V8 table, V8a, V8b) are undercounted.

**Results (V8c)**, `interactions.mjs` against `main`, back to back, median of 3, blocked ms
(main → V8c):

| Interaction | Bitwarden `737ee3f` | Bitwarden `cbf86c2` | Qwik `f7ed58cfc` |
|---|---|---|---|
| Zoom out ×20 | 10 → 0 | 100 → 23 | 466 → 15 |
| Next change (j) ×8 | 0 → 3 | 98 → 0 | 862 → 78 |
| Select a change | 19 → 5 | 78 → 19 | 576 → 115 |
| Pan, overview | 0 → 0 | 0 → 0 | 228 → 11 |
| Mark reviewed (r) | 0 → 0 | 0 → 0 | 42 → 25 |
| Open | 443 → 478 | 755 → 942 | 2,222 → 2,348 |
| Context on | 133 → 201 | 301 → 253 | 1,149 → 1,279 |
| Map: edge elements | 1,417 → 406 | 2,733 → 871 | 6,681 → 1,378 |
| Map: page elements | 4,022 → 3,131 | 7,132 → 5,512 | 12,789 → 7,700 |

- Targets met: Qwik zoom out 15 ms blocked (≤ 150), its map's edge elements 1,378 (≤ 1,500).
  Worst frames on Qwik: zoom out 129 → 61 ms, j 191 → 109 ms, select 320 → 101 ms. On both
  Bitwarden changes no frame over 70 ms while zooming, panning, pressing j or selecting.
- Open and context: not changed by V8c, within noise. Open alternated build by build, 5 rounds
  each on `cbf86c2`, read 806 → 980 ms in one run and 929 → 868 ms in the next; a build without
  the file boxes' handles 864 and 887 ms. They are V8e's.
- Screenshots of the map and of a selection on the map (`cbf86c2`, Qwik), main and V8c: the
  same picture, with fewer, heavier lines.
- No page errors; 415 unit tests, 38 e2e.

## As built — V8e

- As planned. `useLayout` (App) asks `workerLayouts` for the view (`layoutKey`) unless
  `LayoutCache` has it; the worker bundle is 57 kB (dagre and `flow.ts`). The canvas skips its
  fit while a layout is pending, so a project, the focus or an opened group is fitted once, when
  its layout is drawn. A `Panel` says "Laying out…" over the canvas; before the first layout the
  canvas's place says it.
- `interactions.mjs` gained "open a group" (the largest drawn, clicked on the node itself: on
  the map a file box lies over it) and "close it", and waits for a new layout to be drawn.
- Not changed: how long a layout takes (Qwik's still 1 s, now in the worker) and drawing it,
  which stays on the main thread as one long frame.

**Results (V8e)**, `interactions.mjs` against `main`, back to back, median of 3, blocked ms
(worst frame), main → V8e:

| Interaction | Bitwarden `737ee3f` | Bitwarden `cbf86c2` | Qwik `f7ed58cfc` |
|---|---|---|---|
| Open | 557 (405) → 233 (283) | 856 (647) → 307 (345) | 2,568 (1,731) → 620 (630) |
| Open the largest group | 265 (294) → 173 (157) | 1,010 (777) → 600 (412) | 1,340 (1,309) → 322 (271) |
| Close it | 208 (258) → 122 (172) | 552 (602) → 350 (400) | 1,049 (1,087) → 247 (292) |
| Context off | 32 (82) → 0 (0) | 57 (107) → 5 (55) | 424 (388) → 124 (149) |
| Context on | 223 (252) → 51 (95) | 256 (303) → 92 (137) | 1,147 (1,106) → 284 (302) |

- Timeline of opening Qwik (one run): the change list shows at 230 ms (main: 1,185 ms, after a
  955 ms frame); the worker lays out with no long frame on the page; one 693 ms frame draws the
  layout; symbols at 1,565 ms (main: 2,440 ms, after a 1,798 ms frame). Context off: 270 ms of
  "Laying out…" with no long frame, then a 290 ms frame to draw (main: one 512 ms frame); context
  back on, a view seen before: no note, one 322 ms frame (main: 945 ms).
- Target: no frame over 200 ms while laying out — met; drawing a new layout is still one frame
  of 157–693 ms (worst: Qwik's first layout; `cbf86c2`'s 404-user group, ~750 more nodes, 412 ms).
- Other interactions unchanged within noise; no page errors; 423 unit tests, 40 e2e.

**Not in V8 (later)**: drawing the map on a canvas (option F) or as one element per file
("F-lite"); a faster layout for very large clusters (dagre's 1.3 s on Qwik moves off the main
thread in V8e, but stays 1.3 s); drawing a large new layout in parts rather than one frame
(V8e: up to 693 ms); V8d (lighter selection), deferred.
