# V99 — A picked symbol lands readable

[Index](../PLAN.md) · [Journal](../journal/v99-picks-land-readable.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v99-picks-land-readable` in its
own workspace; written by the graph usability spike (`spike/graph-usability`). Not started.

**Kind** feature (milestone) · **Branch** `feature/v99-picks-land-readable` · **Size** S ·
**Depends on** none · **Rank** 1 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**: a pick brings the picked symbol to a reading zoom whenever its name would be
drawn under 11 px on screen. A pick is a finding, a row of the change list, `j`/`k`, or a name in
the detail panel. Today only a pick made while the canvas is on the map does this. The reading
zoom puts a name at the person's body size, set by Settings' Text size: 15 px by default, which
is zoom 1.25 for the graph's 12 px names. The first fit, Focus and an opened group fit no closer
than that zoom. A pick that is already readable and in view still moves nothing.

**Where to look**:
- `packages/viewer/src/diff/Canvas.tsx`: `FIT_OPTIONS` (:81), `READING_ZOOM` (:83), the pick's
  effect (:205–229, `onMap ? READING_ZOOM : zoom` at :222), the fits with `maxZoom: 1.1` (:154,
  :166, :205, :206).
- `src/shell/text-size.ts` (the size chosen: compact, default, large) and `src/ui/base.css:526`
  (`.react-flow`'s own scale: names 12 px).
- `src/graph/mapzoom.ts` (`MAP_ZOOM`, 0.45).
- Decision 886 (V93) and the viewer's `CLAUDE.md`: a pick never moves the layout, only the view.

**Out of scope**: the layout and the graph's own type sizes (decision 438); the map's labels
(V96).

**Done when**:
- On the `callers` fixture zoomed to 0.6, clicking a finding leaves the picked name at least 15 px
  on screen; with Text size compact, 14 px; large, 16 px.
- At zoom 1.3, a pick that is in view moves nothing; one out of view pans at 1.3.
- From the map, a pick lands at the reading zoom, not at 1.
- Bitwarden 737ee3f's select stays near today's 63 ms (`scripts/viewer/interactions.mjs`).

## Problem (the spike's G1, G2, G3)

Measured on the last 26 merges into `main` with code and an 84-graph sample
([spike](../../spikes/graph-usability/README.md)):

- On 24 of 26 merges the first view draws names under 11 px (median zoom 0.16, 1.9 px).
- A pick zooms only from the map (decision 886). Between zoom 0.45 and 0.92 it stays where it is:
  5 of 26 merges open in that band, and so does any view zoomed out by hand. On the small fix
  (`fix/e2e-flakes`), the picked `MergerOptions` stays at 5.9 px
  ([shot](../../spikes/graph-usability/shots/p03-pick-keeps-the-zoom-dark.png)).
- From the map, a pick lands at zoom 1: names 12 px, 3 px under the person's 15 px body text
  ([shot](../../spikes/graph-usability/shots/p02-graph-type-at-zoom-1-dark.png)). Settings' Text
  size does not reach the graph.
- In the walks, "follow callers" took 6–21 wheel notches to make a name readable.

**Goal**: every pick shows the picked symbol at the size the person reads, with no wheel.

## Design

- **The reading zoom** is the body size over the graph's name size: `readingZoom(size)` returns
  14 / 12, 15 / 12 or 16 / 12 for compact, default and large. A pure function in
  `src/graph/mapzoom.ts` beside `MAP_ZOOM`, with a test.
- **A pick**: in the effect at `Canvas.tsx:205`, the name on screen is `zoom × 12`. If it is under
  11 px, the view centres the symbol at the reading zoom (`setCenter`, 300 ms as today). If it is
  readable and in view, nothing moves (886's framing kept). If it is readable and out of view, it
  pans at the person's zoom, as today.
- **Fits**: `FIT_OPTIONS.maxZoom` and the three `maxZoom: 1.1` become the reading zoom. A small
  change then opens with names at 15 px instead of 12.
- **Nothing else moves**: decoration only; the layout is untouched.

## Verification

1. Unit (red first): `readingZoom` for the three sizes; a pure `pickView(zoom, shown)` that says
   stay, pan or zoom, for 0.3, 0.6, 1.0 and 1.3, shown or not.
2. e2e (`graph.spec.ts` or a new spec): the `callers` fixture zoomed to 0.6, a finding clicked,
   the picked `.symbol-name`'s on-screen height at least 15 px; at 1.3 the viewport unchanged.
3. Real graphs: `interactions.mjs` on Bitwarden 737ee3f and the refactor's merge (eb807773),
   against `main`'s build, 3 rounds: select within ±30 %.
4. Shots of the small fix's pick, both themes, before and after.

**Risks**

| Risk | Mitigation |
|---|---|
| The person chose "no zoom to the symbol" (886) | Only unreadable picks move; a readable pick in view still moves nothing |
| `j` through many symbols zooms on each | It zooms once; later picks are readable and only pan when out of view |
| A fit at 1.25 shows less of a small change | Small changes fit whole anyway; only the largest zoom is capped higher |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 966 | A pick's zoom (amends 886) | **A pick whose name would be under 11 px on screen comes to the reading zoom; a readable pick in view moves nothing; a readable pick out of view pans at the person's zoom** | 5 of 26 merges open where a pick stays at 5–11 px; 886's framing kept where it reads |
| 967 | The reading zoom | **The body size over the graph's 12 px name size, from Settings' Text size (1.17, 1.25, 1.33); the first fit, Focus and a group's reveal fit no closer than it** | The person reads 15 px; zoom 1 gave 12 px and ignored Text size |
