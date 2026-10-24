# RM2 — The Monitor's look: long files in heat, the folder in view as the heading, a way back

[Index](../PLAN.md) · [Journal](../journal/rm2-monitor-styling.md)

**Status:** planned (2026-10-24), on branch `feature/monitor-styling` (a workspace started in
Symbiote, from `main` at `f6e5408`); the plan OK'd by the person with one change: "COlour: by nr
of lines, per file.. the file should have different colors..like normal (current) -> yellow ->
orange -> red. The rest is ok".

**Problem** (asked: "current monitor lacks the centric element. needs some styling so it would be
easier to go through the elements..color the section of files based on their number of files,
also need a move back button, or keybinding"). The Monitor (RM1) at 1440 × 900, scale 1, both
themes, on this repository (`f6e5408`, the root and `packages/viewer/src`) and Bitwarden's clients
(`51450a5`, `libs/common/src`):

- **Nothing draws the eye.** With Source alone (the default) every tile has one fill, `--raised`:
  `workspaces`, `diff` and `history` read as one block, and in the light theme the tiles are
  `#e9eef7` on white (1.19:1). A 2,218-line file and a 40-line one differ only by area.
- **Where one is, is a 14 px crumb** in the weight of the links beside it.
- **Back is hidden**: Backspace goes up a folder, but only the "?" tip says so; the page has no
  control for it (the title bar's Back is the desktop window's, and goes back in history, not up).

Lines of code per Source file, measured with `scanCodebase` at each repository's `HEAD`:

| | Symbiote | Bitwarden | Qwik |
|---|---|---|---|
| Source files | 294 | 6,305 | 1,821 |
| Median / 90th / 99th percentile / largest | 99 / 398 / 1,122 / 2,218 | 31 / 186 / 606 / 7,778 | 42 / 251 / 1,077 / 7,968 |
| Files of 250 lines or more (their share of the lines) | 59, 20 % (60 %) | 402, 6.4 % (41 %) | 183, 10 % (58 %) |
| … 500 or more | 19, 6.5 % (32 %) | 112, 1.8 % (21 %) | 78, 4.3 % (42 %) |
| … 1,000 or more | 5, 1.7 % (14 %) | 26, 0.4 % (10 %) | 28, 1.5 % (26 %) |

So steps at 250, 500 and 1,000 lines (each the double of the one before) mark a tenth to a fifth
of the files, and the few over 1,000 lines stand out.

**Goal**: in the Monitor, a file's colour says how long it is — its usual colour, then yellow,
orange and red; the folder in view is the page's heading, with a Back button; sections stand apart
and light up under the pointer. Unchanged: the layout (`layoutTreemap`'s tiles), the numbers, the
list's ranking, the kinds' colours (one click away), every other page.

## The colour of a file: its lines

- **Four steps by a file's own lines** (the `code` count the area already uses): under 250 its
  usual fill (the kind's, RM1); 250–499 yellow, 500–999 orange, 1,000 or more red. The same steps
  at every folder: a file keeps its colour when one zooms in. A pure `heatOf(lines)` in
  `codemap.ts` gives the step (0–3); `HEAT` holds the bounds for it and the legend.
- **Only files are coloured.** Frames, folders drawn whole and the "N smaller files" tile keep
  their fills: a folder's colour would be a sum or a maximum, and both mislead.
- **Tokens** `--heat-1`, `--heat-2`, `--heat-3` in the three theme blocks of `ui/base.css`:
  washes of yellow, orange and red into the panel in the dark theme, light tints in the light one,
  `#rrggbb` so `tokens.test.ts` holds them: `--text` at least 4.5:1 on each, and each step further
  from the usual fill than the one before. On a heat tile the lines are written in `--text`, not
  `--muted`: held to 4.5:1 the muted grey left the light theme's orange and red too pale to tell
  apart (`#fedabd`, `#fdd4d4`).
- **The list** takes the same colours: a file's bar is its step's, a folder's stays neutral; in
  "Largest files" the long ones lead in red.
- **A legend** beside the chips: "Lines in a file" and four swatches, "under 250", "250", "500",
  "1,000+".

## Colour: Lines or Kind

A segmented control, **Colour: Lines · Kind**, Lines by default. Kind is RM1's picture exactly
(every file in its kind's fill, the chips' swatches the legend). Under Lines a short file keeps its
kind's fill, so with Tests on a short test still reads as a test. Not kept across reloads, like the
chips. RM1 kept heat for change frequency (decision 326); hotspots (RM3) can be a third choice
here with the same ramp.

## The folder in view as the heading

```
 Monitor (?)                                                           main · 51450a5
 [Source 491,285] [Tests] [Docs] [Data] [Other] [Set aside]   Colour [Lines | Kind]
                                       Lines in a file  ■ under 250  ■ 250  ■ 500  ■ 1,000+
 (←)  All files / libs / common / src
      56,392 lines of code in 1,006 files. Half of it is in 56 files (6 %); …
 ┌ platform · 28 % ─────────┐ ┌ auth · 13 % ──────┐ ┌ tools · 9 % ──
```

- The folder's name at `--size-title`, weight 600, `--text`; the folders above it as links in
  `--muted`, at the body size, before it. The headline under it: its numbers in `--text`, its
  words in `--muted`.
- **Sections stand apart**: a child of the folder in view (a level-1 frame) has a 2 px border of
  the canvas around it, files inside 1 px, so the gap between sections is wider than between
  files. A border inside the tile's box: the layout does not change.
- **A section lights up under the pointer**: pointing at any tile inside it outlines the section
  (`--edge`) and lights its name band, so one sees what a click on the band opens. `layoutTreemap`
  gives each tile its `section` (the level-1 tile holding it, its own id at level 1); the
  outline is a class on one tile, set on hover like today's `hovered`.

## Back

- A **Back** icon button (`BackIcon`, `.icon-button`) before the heading: up one folder,
  disabled at All files; its tooltip names where it goes and the key ("Back to common
  (Backspace)").
- **Backspace** goes up, as today. **Escape** lets go of the picked file, and with none picked
  goes up. The "?" says both.

## Verification

1. **Tests first** (red before):
   - `test/codemap.test.ts`: `heatOf` at 0, 249, 250, 499, 500, 999, 1,000 and 7,968 lines.
   - `test/treemap.test.ts`: each tile's `section` is its level-1 ancestor, its own id at level 1.
   - `test/tokens.test.ts`: `--text` at least 4.5:1 on each heat step in both themes, the steps
     further from `--raised` one after the other.
   - `e2e/monitor.spec.ts` (its repository gains a 520-line and a 1,000-line file): the files'
     steps by class, the legend; Kind gives the kinds back; Back disabled at All files, up one
     folder elsewhere, its tooltip; Escape lets go first, then goes up; Backspace still works.
2. **Screenshots** before and after: Symbiote (root, `packages/viewer/src`) and Bitwarden
   (`libs/common/src`), 1440 × 900 and 820 × 900, scale 1, both themes; zoomed 3× on text for
   uneven gaps; the other pages once, to see the new tokens move nothing.
3. **Nothing else changes**: `pnpm check`, `pnpm build`, every e2e spec. No analysis code: no
   `regression-check`. The layout's cost is unchanged (colour and the section outline are classes;
   no layout on hover).

**Risks**

| Risk | Mitigation |
|---|---|
| Heat reads as an error or a warning | Only on files, washes not solid fills, a legend that says "lines in a file"; the states' own tokens are not used |
| Data and docs files are long by nature (Bitwarden's `messages.json`) | They are off by default; on, their length is what the colour says |
| The steps suit one repository and not another | Measured on three: 6–20 % of files at 250 or more, 0.4–1.7 % at 1,000; the bounds are named in the legend |
| ID or decision numbers taken by another workspace | Checked on every branch (`RM2` free, decisions to 331) and again before finishing |

**Order**: the pure step and the tokens, then the treemap's and the list's colours, then the
heading and Back.

## Milestones

| # | Milestone | Output |
|---|---|---|
| RM2 | The Monitor's look | Heat by lines, Colour: Lines · Kind, the heading, sections apart, Back and Escape; tests; screenshots |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 332 | What colour says | **A file's lines of code**, in four fixed steps: its kind's fill under 250, yellow from 250, orange from 500, red from 1,000 (decision 326 changed: kind is one click away) | The person's choice; the steps measured on three repositories mark a tenth to a fifth of the files, and fixed steps keep a file's colour at every zoom |
| 333 | Kind | **A segmented control, Colour: Lines · Kind**, Lines by default; short files keep their kind's fill | RM1's picture stays one click away; hotspots (RM3) can take a third choice |
| 334 | Where one is | **The folder in view as the heading** (its name at the title size), sections 2 px apart, a section outlined under the pointer | The page had no focal element; the treemap's sections ran together |
| 335 | Back | **A Back button before the heading, Backspace, and Escape** (letting go of a picked file first) | Backspace was only in the "?"; Escape is the drill-down's usual way out |

**Not in RM2 (later)**: hotspots (colour by how often a file changed, RM3); remembering the
colour choice; tiles as keyboard stops (the list stays the keyboard's way).
