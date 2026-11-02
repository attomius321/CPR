# V85 — Hive's honeycomb as the background, and a compact look like VS Code's

[Index](../PLAN.md) · [Journal](../journal/v85-hive-honeycomb-compact.md)

**Status:** merged into `main` on 2026-11-01 (built 2026-10-31), on branch `feature/hive-honeycomb-background` (a
Hive workspace started in Symbiote, from `main` at `cd1956a`). Its "As built" and results below. The person approved the plan with its
recommendations ("Good, go for it") after three rounds of mockups: a white light sidenav, then
smaller type, then VS Code's density.

**Problem** (asked: "after the transition animation to Hive mode, after you confirm the dialog to
Hive, the animation background with the hexagons to remain in the background of the application.
Those look very nice"; then, on the mockups: "make the font sizes smaller, like in VSCode … should
look at least more professional", "we should change everything to look more professional like
VSCode. So we should tweak the density also").

| What | Today (`main` at `cd1956a`) |
|---|---|
| The arrival's honeycomb | Drawn on a canvas over the window for 1.9 s (`ARRIVAL.end`), removed at its end (`hive-arrival.ts:66`); nothing of it stays |
| Hive's ground | `--bg` `#070506` behind opaque cards (`--side` `#0d090a`, V72): only the page's margins, gutters, head, the sidenav and empty space show it |
| Light Hive's sidenav | Ink: the whole dark set (decision 615) |
| Type (`--size-*`) | 12 / 13 / 14 / 15 / 17 px; the graph 11 / 12 / 13 / 14 / 16 (V61, decision 438) |
| Heights | Hard-coded: `height: 32px` 16 times, `28px` 12, `min-height: 32px` 9, `28px` 9, `40px` 6, `48px` 5 … in 16 stylesheets; buttons, inputs and sidenav rows 32 px, a card's head 48 px, the page's head 44 px; Git's rows 28 px (a constant) |
| Layout tokens | `--page-pad` 16, `--page-gap` 16, `--card-pad` 16, `--field-label-gap` 8, `--field-gap` 20 |

VS Code, read from its own build on this PC (`D:\Microsoft VS Code`, `workbench.desktop.main.css`
and the size tokens in `workbench.desktop.main.js`): `.monaco-workbench { font-size: 13px }`;
`fontSize.body1` 13, `label1` 12, `body2`/`label2` 11, `label3` 10, `heading3/2/1` 13 / 18 / 26;
the editor 14 px on Windows and Linux (12 on macOS); list rows 22 px (`getHeight(){return 22}`);
buttons `padding: 4px 8px` (about 26 px); a pane's header 11 px bold; the status bar's items 22 px;
spacing tokens 2–40 px; radii 2 / 4 / 6 / 8 / 12. The Claude desktop app's code is not on this
machine (only its logs), so it was not measured.

**Goal.**
1. With Hive on, the honeycomb of the arrival's shutter stays as the app's background: ink with
   faint crimson etched outlines (dark), crimson outlines on white (light). No seam between the
   arrival's last frame and the background; there from the first render after a reload. With Hive
   off, nothing of it, as on `main`.
2. Every page compact like VS Code: 13 px body, 26 px controls, 22 px rows, 35 px card heads,
   tighter margins; in both modes.

**Unchanged**: the arrival's timings and drawing; the colours and fonts; the graph's layout and
its type; the title bar's 38 px (the window's own).

## Part 1 (V85a): the honeycomb

- **One lattice.** The shutter's tile layout in `arrivalScene` (`hive-art.ts`) moves into a pure
  `combLattice(width, height, at)` — the centres and `r = max(16, min(width, height) / 26)` —
  which the arrival calls. A unit test proves the tiles are the arrival's.
- **One SVG path, drawn once** (`shell/hive-comb.ts`, pure; `shell/HiveComb.tsx`, mounted by the
  Shell): a fixed layer under the page (`.hive-comb`, `z-index: -1`, `aria-hidden`, no pointer),
  an ink (or white) rectangle and every etched hexagon (radius `r − 1.5`, 1 px) in one `<path>`:
  about 450 hexagons at 1440 × 900. Not a canvas (an SVG stays crisp at every pixel ratio and is
  never redrawn); not a `<pattern>` or a CSS tile (they round the tile's size, and the error adds
  up across the window: the lattice would drift from the arrival's last frame).
- **Resize** keeps the centre and radius and adds tiles to cover the new size: the comb never
  "breathes" while the window is dragged.
- **The hand-over**: `arrive()` hands the scene's centre and radius to the comb at the swap (the
  frame covering the window), so the comb is laid under the shutter; the boom opens each tile onto
  the same lattice; the canvas goes at its end as today. After a reload, the comb is centred on
  the window's middle (the arrival's own rule without a question).
- **Where it shows** (A, decision 703): the ground. In Hive, the sidenav's background colour is
  transparent (its gloss stays). Cards, the status bar, the title bar, menus, dialogs, a diff's
  graph canvas and the terminals keep their own grounds. The narrow drawer stays opaque (it lies
  over the page). Cards at 80 % let through 2.4 % of the crimson: invisible; lower costs contrast.
- **Light Hive** (decision 704): the sidenav takes the page's light set (no longer the dark one;
  615 kept for the Hive question only), transparent over the comb; the comb is white with the
  crimson (`#c8102e`) at 16 %.
- **No traces** (705): they lead into the Mind's ring, which is gone.
- **Hive off**: the comb is unmounted (inside the fade that runs); no rule matches: as on `main`.
- **Colours** are tokens (`--hive-comb-ground`, `--hive-comb-line`) in `ui/hive.css`, read by the
  layer; its rules in `shell/hive-comb.css`, listed in `styles.css` after `hive.css`.
- **Contrast** on a line's pixel (dark `#280609`, light `#f6d9de`): text 16.9 / 14.8 : 1, muted
  8.8 / 5.8, `--faint` 4.45 / 3.24 (the test's minimums: 4.5 text, 3 faint). The line's colour joins
  Hive's backgrounds in `tokens.test.ts`.

## Part 2 (V85b): compact like VS Code

| | VS Code | Today | V85b |
|---|---|---|---|
| `--size-caps / caption / small / body / title` | 11 / 11–12 / 12 / 13 / 13–26 | 12 / 13 / 14 / 15 / 17 | **11 / 11 / 12 / 13 / 16** |
| code in diffs and files (`--size-code`, new) | 14 | 14 (`--size-small`) | **13** |
| terminals (`--size-term`, new) | 14 | 15 | **14** |
| controls (`--control-h`, new): button, input, select | ~26 | 32 | **26** |
| rows (`--row-h`, new): lists, Git's rows | 22 | 28 | **22** |
| sidenav rows (`--nav-row-h`, new) | 22 | 32 | **26** |
| `--card-head` | 35 (tabs) | 48 | **35** |
| `--page-head` | — | 44 | **36** |
| `--page-pad / --page-gap / --card-pad` | 8–12 | 16 / 16 / 16 | **12 / 8 / 12** |
| `--field-label-gap / --field-gap` | — | 8 / 20 | **4 / 14** |
| status bar (`--status-h`, new) | 22 | 19 | **22** |

- Every hard-coded height becomes a token (or a step derived from one: `calc()`); Git's row
  height constant follows `--row-h`. A guard in `tokens.test.ts` refuses `height`/`min-height` in
  px from 22 up outside the tokens' block, as it refuses font sizes in px.
- The rule "nothing under 12 px but uppercase labels" becomes "nothing under 11 px" (`--size-caps`
  and `--size-caption` at 11); the test pinning the scale takes the new values. The graph's block
  keeps V32's sizes (its layout estimates node widths from them).
- Fixed widths sized for 15 px text (time columns, steppers) are rechecked page by page.

## Verification

1. **Tests first** (red): `combLattice` equals the arrival's tiles; the path covers the window;
   a resize keeps centre and radius; the comb's line as a Hive background (both themes); the light
   sidenav's set; the new scale and height tokens; the px-height guard.
2. **E2E** (`hive.spec.ts`): Hive on at load, the comb there with the first render, centred on
   the window; turned on through the question, the comb centred on the question's art and the
   canvas gone; turned off, no comb; Hive off, no `.hive-comb` and the sidenav's background as
   `main`'s; light, the sidenav light over the comb; narrow, the drawer opaque. `page-frame.spec.ts`
   measures the new margins.
3. **No seam**: the arrival recorded frame by frame; the ground's pixels compared between the last
   frame with the canvas and the first without, both themes.
4. **Cost**: first paint of `/git` with Hive on and off against `main`'s build (`git archive`),
   alternated, 3 rounds (`scripts/viewer/measure.mjs`); the graph's pan with Hive on; the arrival at
   2560 × 1440.
5. **Every page, both themes, 1x** (`viewer-check`, `symbiote-style`): Git and its panes and
   dialogs, Start, a workspace's tabs, Workspace history, Alpha Ceph, Skills, Monitor, Settings and
   Hive's page, a diff's Files and Graph, the narrow drawer; text zoomed 3× for uneven gaps.
6. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| A fixed full-window layer costs on WSL's software compositor | measured (pan, first paint); else the comb as the shell's own background |
| The question's art is not at the window's middle: after a reload the lattice is offset from the arrival's | only on a reload; nothing moves while watched |
| 11–13 px Geist renders thin at 1x on Linux; the person once found 14 px too small | the person chose it on real-size mockups; letter gaps checked zoomed; the scale is one token block to raise |
| Many e2e tests measure positions and heights | expected: each fixed to the tokens, not to new numbers |
| `feature/hive-live-progress` also changes Hive's CSS | the comb's rules in their own file; `hive.css` gets one rule |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V85a | The honeycomb | `combLattice`, the comb layer, the hand-over, light's white sidenav, tests |
| V85b | Compact | the scale and height tokens, every page on them, the guard, e2e updated |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 701 | What stays after the arrival | **The shutter's last frame: the art's ink and the etched outlines (lamp crimson at 12 %, 1 px, radius r − 1.5), on the arrival's own lattice** | the person's words; no seam needs the same tiles |
| 702 | How it is drawn | **One inline SVG path from a shared pure lattice, drawn once; a resize adds tiles** | crisp at any pixel ratio, never redrawn; a pattern or tile drifts from the canvas's tiles |
| 703 | Where it shows | **The ground: margins, gutters, heads, the sidenav; cards opaque; chrome, menus, dialogs, the graph's canvas and the terminals keep theirs** | 80 % cards show 2.4 % of the line; a still comb under a panning graph reads as the graph's |
| 704 | Light Hive | **The sidenav takes the page's light set (615 kept for the question only), the comb white with crimson outlines at 16 %** | asked: "keep the sidenav white also, with honeycomb behind" |
| 705 | Traces | **None** | they end at a Mind that is gone |
| 706 | The hand-over and a reload | **At the swap, the scene's centre and radius; after a reload, the window's middle** | the arrival's own rule without a question |
| 707 | Hive off | **The comb unmounted; the narrow drawer opaque** | off is `main`'s look |
| 708 | The type scale | **11 / 11 / 12 / 13 / 16; nothing under 11 px** | VS Code's 13 / 12 / 11; the person chose it on mockups |
| 709 | Code and terminals | **`--size-code` 13, `--size-term` 14** | VS Code's editor and terminal 14; code beside 13 px words |
| 710 | Controls | **`--control-h` 26 px** | VS Code's buttons ~26 |
| 711 | Rows | **`--row-h` 22 (lists, Git), `--nav-row-h` 26 (the sidenav)** | VS Code's 22; the sidenav's icons need a little more |
| 712 | Heads | **`--card-head` 35, `--page-head` 36, the status bar 22** | VS Code's tabs 35, status bar 22 |
| 713 | Margins | **`--page-pad` 12, `--page-gap` 8, `--card-pad` 12, fields 4 / 14** | VS Code's 8–12 spacing |
| 714 | Guard | **No px height from 22 up outside the tokens (`tokens.test.ts`)** | 16 stylesheets held their own heights |
| 715 | The graph | **Keeps V32's type and its node sizes** | its layout estimates widths from them |

**Not in V85**: a moving background; translucent cards; the graph's density; the title bar's
height; Claude desktop's measures.

## As built (V85)

- **Light Hive's outlines are 13 %, not 16 %** (704): at 16 % the `--context` state was 2.88:1 on a
  line's pixel (`#f6d9de`); 13 % (`#f8e0e4`) keeps it at 3.04 and `--faint` at 3.42. The tokens test
  found it; the person chose 16 % on a mockup.
- **The comb's colours are opaque tokens** in `ui/base.css`'s Hive blocks (`--hive-comb-ground`,
  `--hive-comb-line`: the lamp's 12 % over the ink is `#280609`), so the contrast test reads them
  as backgrounds.
- **One layer at the root, its lattice kept for the tab** (706, round 1 of Hive's review): the
  layer is mounted once in `main.tsx`, not in the shells (a diff's page has its own,
  `diff/DiffShell.tsx`, and states outside it while it loads). A commit's review is a new document
  (`window.location.assign`), so the lattice is kept in `sessionStorage`: a review, a page back
  and a reload draw the arrival's tiles; a new tab with Hive on centres on its window; Hive off
  forgets it. Before, opening a review moved the honeycomb from the question's art (y 375.6) to the
  window's middle (y 450). In the app on Linux, `#root`'s rounded ground (`frame.css`) is clear in
  Hive and the layer takes the corners. The heads that paint their own ground clear over it (a
  diff's, the Monitor's: round 1 found the Monitor's, `rgb(7, 5, 6)` over the comb); a merge's
  sticky head, opaque so its log scrolls under it, takes the comb's ground.
- **Height tokens by step, not by role** (710–712): `--height-row` 22, `--height-control` 26,
  `--height-tall` 28, `--height-tab` 30, `--height-bar` 34, `--height-top` 40, each the step below
  V72's 28/32/36/40/44/52 px; 48 px heads are `--card-head`. A sidenav entry is 28 px
  (`--height-tall`), not the 26 planned: it was 36. Squares' widths moved with their heights.
- **The terminal's 14 px is `TERMINAL_FONT_SIZE`** in `workspaces/terminal.ts` (xterm takes a
  number), not a `--size-term` token.
- **The guard refuses 28 to 56 px** (714): a guard on every px height refused the arcs, panes and
  editors' heights too. The title bar's 38 px stays the window's.
- **Padding inside the heads**: 4 px round a 26 px control in a 35 px head (the heads had 8); the
  page's head lines 20 and 16 px (they were 22, 2 and 20); chips on a head's second line 16 px; a
  merge's head chips 20 px; a workspace's tabs 4 px over 30 px tabs, 10 px each side.

**Results.**

| What | `main` (`cd1956a`) | V85 |
|---|---|---|
| The hand-over: the shutter's line pixels on the honeycomb's (a trace-free strip, 1440 × 900) | — | 143 of 143 |
| First contentful paint of `/git`, Hive on, median of 15, two runs | 80, 84 ms | 84, 84 ms |
| The same, Hive off | 76 ms | 76 ms |
| The first commit row, Hive on (after a poll: an upper bound), two runs | 167, 173 ms | 171, 186 ms |
| The arrival at 2560 × 1440, 3 runs | 59.5–60 fps; a 33 ms frame in 1 of 3 | 59–59.5 fps; a 33 ms frame in 3 of 3 |
| Body text, a control, a row, a card's head | 15, 32, 28, 48 px | 13, 26, 22, 35 px |

The arrival's one long frame in each run is likely the frame the honeycomb mounts in, under the
full cover. Tests: `hive-comb.test.ts` (5), the tokens' contrast on the comb and the density
tokens and guard, `hive.spec.ts` (the hand-over, a resize, a reload, a diff's page, the narrow
drawer, off, light, reduced motion), 16 e2e checks moved to the tokens; `pnpm check` 2,653 tests;
`pnpm test:e2e` 372 viewer and 20 nexus tests.
