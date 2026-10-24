# Journal: V8 — A smooth viewer

[Index](../JOURNAL.md) · [Plan](../plan/v8-smooth-viewer.md)

## V8 spike — a smooth viewer (2026-10-12, branch `milestone/v8a-zoom-labels`)

Reported "flaky and laggy". Every interaction a reviewer does was scripted in Chromium on real
graphs (`scripts/viewer/interactions.mjs`), profiled on an unminified build, and re-run with one
cost removed at a time. Plan in PLAN.md (V8a–V8e).

**Learned**
- The biggest single cost of zooming was one line: `--symbiote-zoom` set on the page root on every
  zoom frame. An inherited custom property restyles every element below it — 12,788 on Qwik's
  map — though only about 130 labels read it. A stylesheet rule aimed at the labels restyles
  only them, but they still re-laid out their text each frame (`font-size` changes); scaling them
  with a transform from fixed sizes removes that too. Each change alone gained little; together
  they came within reach of the variable frozen (Qwik zoom-out blocking 507 → 190 ms, frozen 150).
- React Flow's `onlyRenderVisibleElements` checks every edge on every frame of a pan, zoom or
  `fitView` animation; edges are 38–52 % of the map's page elements.
- "Flaky" had a concrete part: on the map, frame names (V7b) are drawn over file boxes and take
  the pointer — 9–23 % of the spots on file boxes zoom into the whole project instead.
- On Qwik `f7ed58cfc` a j step's 300 ms glide got 4 frames: the canvas jumps in steps. Layout
  runs on the main thread (1.9 s there), and a context toggle lays out again (769 ms frame).
- Measuring traps: timings varied 3× between runs on this machine — compare medians of 3–5 rounds
  back to back; Long Tasks miss style and layout work, long animation frames (LoAF) include it;
  `getByLabel('Context')` matched "Mark InitContextMenuItems reviewed" too (use `exact`).

**Verification**: baselines (median of 3) in PLAN.md V8's table; the prototype for V8a measured
with medians of 5 against the variable frozen, edges hidden and both.

## V8a — Map labels (2026-10-12, branch `milestone/v8a-zoom-labels`)

Zooming no longer restyles the whole page: the map's labels are scaled by a transform from fixed
sizes, and the zoom value lives in a stylesheet rule for them alone, written only on the map.

**Learned**
- Two costs hid in one line, and each fix alone gained little: an inherited custom property on the
  root restyles every element below it; a font size that follows the zoom re-lays out its text
  on every frame. Scoping the variable halved the cost, the transform alone changed nothing,
  both together came near the "variable frozen" bound.
- A label's computed font size no longer says how big it looks: the e2e check that project names
  read twice as big as file names now compares drawn sizes (bounding boxes).

**Verification**: tests first — `nextMapZoom` (on the map, once per value, nothing off it); e2e:
a map file name keeps its size on screen while the map zooms further out (passing before and
after) and nothing is set on the page root (red before). `interactions.mjs` against `main`'s
build, two alternating runs of 3 rounds: zoom out ×20 blocked 102–103 → 32–40 ms (Bitwarden
`cbf86c2`), 451–466 → 193–219 ms (Qwik `f7ed58cfc`); zoom in on Qwik 107–115 → 0–5 ms; nothing
else moved beyond noise. Map screenshots before and after match. 408 unit tests, 35 e2e.

Merged into main (2026-10-12).

## V8b — Map clicks (2026-10-12, branch `milestone/v8b-map-clicks`)

On the map, a click on a file box now always lands on the file: frames (names included) never take
the pointer there, and a click on an empty part of a frame reaches the canvas, which zooms into the
frame under it.

**Learned**
- The bug came from V7b's choice to draw frames above files on the map so their names stay
  readable, and to let the name take clicks. Layering for reading and for clicking must be decided
  separately: the frame can be on top and still give every click to what is below.
- A test that measures where clicks land (`elementFromPoint` on each box's corners and middle)
  found it on the four-file fixture; nothing checked it before.

**Verification**: tests first — `projectAt` (inside a frame, between frames, without frames); e2e:
every spot of every file box on the fixture's map reaches the file (4 boxes failed before), a
click on a frame's empty edge zooms into it. Real maps, `main` → V8b: Bitwarden `737ee3f` 91 →
100 %, `cbf86c2` 77 → 100 %, Qwik `f7ed58cfc` 88 → 100 % of file-box clicks reach the file;
timings unchanged within noise. 409 unit tests, 35 e2e.

Merged into main (2026-10-13).

## V8c — Edges (2026-10-13, branch `milestone/v8c-edges`)

On the map, one edge per pair of linked file boxes stands for their symbols' edges, heavier the
more it stands for; while the view of a change with more than 400 edges moves, only the selected
symbol's edges are drawn. Zooming out on Qwik `f7ed58cfc` blocked 466 ms, now 15 ms.

**Learned**
- React Flow's `onMoveStart` comes with every press (d3-zoom starts a gesture on mousedown), so
  a click looked like a move and blinked every edge. The view's first real change is `onMove`.
- An animation interrupted by the next one (j during a glide) reports its end after the next
  has started (xyflow defers `onMoveEnd` with a timer): the end of a move must wait a little and
  be cancelled by the next `onMove`.
- React Flow hands `onNodeClick` to every node and the minimap's `nodeClassName` to every minimap
  node. Inline functions re-render thousands of nodes on each canvas render; harmless while the
  canvas rendered on selection only, costly once it renders at each move's start and end.
- React Flow draws no edge to a node without handles: file boxes needed unseen ones. They cost
  nothing measurable at open (alternating benchmarks, within ±15 % noise).
- A long animation frame is reported after it ends. `interactions.mjs` read open's frames too
  early and missed the last, longest one at random: it showed V8c's open 3× worse than main
  (Qwik 835 → 2,304 ms) when both were the same (2,222 vs 2,348 once fixed). Read performance
  entries only once the page is idle, and check a regression with a second method (here, opening
  each build in turn, 5 rounds) before fixing it.

**Verification**: tests first — `fileEdges` (pairs, sides, weights, summaries, projects) and
`edgesToDraw` (off the map, moving, the map, the limit counting what would be drawn); e2e on a
generated change with 421 edges: two file edges on the map, only the selection's edges during a
held drag and all back after, a press without movement keeps them all, a small graph unchanged.
Real graphs, `main` → V8c, blocked ms: zoom out ×20 Qwik 466 → 15, Bitwarden `cbf86c2` 100 → 23;
j ×8 Qwik 862 → 78, `cbf86c2` 98 → 0; select Qwik 576 → 115; map edge elements Qwik 6,681 →
1,378, `cbf86c2` 2,733 → 871; open and context unchanged within noise. Screenshots: the same map
with fewer, heavier lines. 415 unit tests, 38 e2e.

Merged into main (2026-10-13).

## V8e spike — where layout time goes (2026-10-13, branch `milestone/v8e-layout-worker`)

`layoutFlow` alone, in Node: 187–981 ms for the default view of the three measured changes,
47–227 ms with context off, up to 841 ms with Qwik's largest group opened. Moving the data a
worker needs costs little next to it: the graph once (6–39 ms to send), each layout back
(4–42 ms to receive). So a worker frees 0.2–1 s of main thread per layout. React drawing the new
layout stays on the main thread; V8e measures that part separately. V8d is deferred: V8c already
met its targets (j ×8 on Qwik 78 ms blocked, select 115 ms).

## V8e — Layout in a worker (2026-10-13, branch `milestone/v8e-layout-worker`)

Layouts are made in a Web Worker. The page stays usable while one is made: the change list and
findings show at once on opening, the last layout stays drawn with "Laying out…" until the next
arrives, and a view seen before (the last 8) comes back at once. Opening Qwik `f7ed58cfc` blocked
the page 2,568 ms, now 620 ms; context on 1,147 → 284 ms.

**Learned**
- What remains is React drawing a new layout: one frame of 157–693 ms (Qwik's first layout,
  `cbf86c2`'s 404-user group with ~750 more nodes). The worker removed the computing, not the
  drawing; drawing in parts would be the next step for very large views.
- Every effect that moves the view for a new layout (fitting a project, the focus, an opened
  group) must wait for that layout to be drawn: run against the old one, it moved the view twice.
  The canvas skips its fit while a layout is pending.
- The options object must keep its identity while the view is the same (a memo): the effect
  that asks for a layout depends on it, and a cached answer sets state.
- On the map a group lies under its file box, which takes clicks (V8b): a scripted click at the
  group zoomed into the file instead. The measuring script dispatches the click on the node.
- Holding the worker script back (`page.route`) makes "the change list shows before the first
  layout" testable without timing.

**Verification**: tests first — `layoutKey` (same view, any set order; views told apart),
`LayoutCache` (one request per view, a late answer kept and not drawn, least recently used
dropped), `workerLayouts` (answers out of order, worker failure, no worker); e2e: with the worker
held back the change list shows and the canvas says "Laying out…", then symbols; a view laid out
before comes back without the note. Real graphs, `main` → V8e, blocked ms: open — Bitwarden
`737ee3f` 557 → 233, `cbf86c2` 856 → 307, Qwik 2,568 → 620; context on 223 → 51, 256 → 92,
1,147 → 284; the largest group 265 → 173, 1,010 → 600, 1,340 → 322. A timeline of opening Qwik:
no long frame while the worker lays out. 423 unit tests, 40 e2e.

Merged into main (2026-10-13). V8 closed with it: V8a, V8b, V8c and V8e merged, V8d deferred
(V8c already met its targets). Left for later: drawing a large new layout in one frame (up to
693 ms), a faster layout than dagre for very large clusters, the map on a canvas.
