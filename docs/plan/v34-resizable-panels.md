# V34 — Panels one can resize: the sidenav and a workspace's changes

[Index](../PLAN.md) · [Journal](../journal/v34-resizable-panels.md)

**Status:** merged into main (2026-10-22, from branch `feature/resize-left-right-panels`, a
workspace started in Symbiote; approved in Symbiote at `ca57f97`); the person agreed to the plan and
its limits (2026-10-22). Its "As built" and results below.

**Problem** (asked: "I would like to have the option to resize - drag - the left panel with the
pages and workspaces, and also from workspaces the right changes made"). On a diff, the review
sidebar and the detail panel can be dragged (`Resizer.tsx`, `e2e/resize.spec.ts`, widths kept in
the browser under `symbiote.viewer.widths`). The shell's two fixed columns cannot:

| Panel | Width on `main` | Where |
|---|---|---|
| The sidenav (pages and workspaces) | 240 px (`--sidenav-width`), 48 px folded | `.shell`'s grid, every page of `symbiote view` and a diff's page |
| A workspace's changes | 256 px (`.changes`), hidden under 1,200 px | right of the terminal (V29d) |

A workspace's long names and branches are cut at 240 px; a changes list of deep paths is cut at
256 px, and on a wide window the terminal does not need the rest.

**Goal**: both drag like the diff's panels: the same handle, keys (arrows, Shift for four steps,
Home and End), double-click for the default, widths kept in this browser. **Unchanged**: the
defaults, the folded rail (48 px, no handle), the narrow drawer (under 900 px, no handle), the
changes panel hidden under 1,200 px, the diff's panels.

## Design

- `Resizer.tsx` learns where its panel is when it is not a sibling, and takes limits: an optional
  `find` (the panel and what gives up the room), `min`, `max` and `room` (what the rest keeps; the
  canvas's 240 px by default). The diff's two handles keep their behaviour.
- **Sidenav**: a "Resize sidebar" separator in `.shell`'s grid, over the sidenav's right border
  (`grid-area: side`, at its end), in `Shell` and `DiffShell` while the sidenav is open. 180–480 px,
  and the main area keeps at least 480 px. The drag sets `--sidenav-open` on `.shell`, from which
  `--sidenav-width` comes unless folded: folding and opening keep the width. The title bar's left
  part follows `--sidenav-width` already.
- **Changes**: a "Resize changes panel" separator between the terminal and the panel in
  `.workspace-split`, setting `--changes-width`; 200 px up to what leaves the terminal 480 px.
  The terminal refits on its `ResizeObserver` (V21). Hidden with the panel under 1,200 px.
- **Widths** in one place, `src/widths.ts` (pure reading and merging, unit-tested): the entry
  `symbiote.viewer.widths` gains `sidenav` and `changes`; each writer merges its own field into
  what is stored, so the shell, a workspace and a diff never overwrite each other's.
- While dragging, the pointer stays a resize cursor and no text is selected (`.shell.resizing`).

## Verification

1. **Tests first**: `widths.test.ts` (reading, merging, bad values); `resize.spec.ts` — the
   sidenav on History and on a workspace: drag, limits (180, 480, the main area's 480), keys,
   double-click, kept across a reload and a fold; no handle folded or narrow; the changes panel:
   drag, limits, keys, double-click, kept; the terminal's columns follow.
2. `pnpm check`, `pnpm build`, every e2e; the diff's resize tests unchanged.
3. **viewer-check**: screenshots at 1440×900, dark and light, of History and a workspace at the
   narrowest and widest; `/history` first paint against `main`'s build.

**Risks**

| Risk | Mitigation |
|---|---|
| A sidenav at 180 px cuts cards and the repository's name badly | Screenshots at 180 px; the cards already cut with an ellipsis |
| Dragging the sidenav over a diff re-lays out or refits React Flow each frame | The width goes to the page only (no render until the drop, as today's handles); tried on a diff |
| Two pages writing the same storage entry lose a width | Merge on write; unit test |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V34 | Panels one can resize | The sidenav and a workspace's changes resized by drag and keys, kept in the browser |

**Decisions** (agreed with the person, 2026-10-22):

| # | Question | Decision | Why |
|---|---|---|---|
| 233 | How | **The diff's `Resizer`, generalised** | One handle, one look and one set of keys across the app |
| 234 | Limits | **Sidenav 180–480 px, main area at least 480 px; changes 200 px up to a 480 px terminal** | Agreed with the person; under 180 px the cards lose their state chip, and a terminal under 480 px is under 60 columns |
| 235 | Where widths live | **The browser, one entry for every panel**, merged on write | As the diff's panels: how wide panels read best is the person's, not the repository's |

## As built (V34)

- **The limits also hold in CSS**, not only while dragging: `--sidenav-width` is
  `min(--sidenav-open, max(180px, 100vw − 480px))` and the changes panel
  `min(--changes-width, 100cqi − 480px)`, so a width kept from a wider window never squeezes the
  main area or the terminal under 480 px in a narrower one.
- **The sidenav's handle is in `Shell` and `DiffShell`**, through `useSidenavWidth` in
  `Sidenav.tsx`; the handle sits in the grid's `side` area, at its end, over the border.
- **Found in the screenshots, not changed**: at 1440 px a sidenav wider than 240 px leaves the
  workspace under 1,200 px, where V29d hides its changes (decision 186). Left as it is: the
  threshold is the person's call (see the journal).

**Results.** Tests first: `widths.test.ts` (6, red: no module) and `e2e/panels.spec.ts` (7; on
`main`'s build 6 of 7 failed waiting for the handles, the narrow one passes on both). `pnpm check`
1,116 tests; e2e 180 of 180, `resize.spec.ts` (the diff's panels) unchanged. `/history` first
contentful paint, 6 rounds each, back to back: 24–60 ms (median 34) here, 28–68 ms (median 34)
on `main`. Screenshots at 1440×900, dark and light: a workspace at the defaults, the narrowest
(sidenav 180, changes 200) and the widest, and the handle on hover. Not verified: the desktop
app itself (Electron), other browsers, touch screens.
