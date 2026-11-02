# Journal: V85 — Hive's honeycomb as the background, and a compact look like VS Code's

[Index](../JOURNAL.md) · [Plan](../plan/v85-hive-honeycomb-compact.md)

## V85 plan — mockups and VS Code's measures (2026-10-31, branch `feature/hive-honeycomb-background`)

Mockups at 1440 × 900, 1x, both themes, made over this branch's `symbiote view` in a scratch
repository with Hive on: the comb injected as an SVG layer and prototype CSS by a Playwright script,
nothing in the repository changed. Three rounds with the person: the ground with opaque cards
(chosen), see-through cards, traces; light Hive's sidenav ink (refused: "keep the sidenav white
also, with honeycomb behind"); type at 15, 14 and 13 px; then VS Code's density.

**Learned**:
- **See-through cards show nothing at a readable opacity**: at 80 % a card lets 2.4 % of the
  comb's 12 % crimson through, invisible; it would read only near 50 %, which lowers every card's
  text contrast.
- **Smaller type alone is not VS Code's look**: every control and row stays 32 px whatever the
  type (measured: sidenav row, button, input 32 px at 15, 14 and 13 px), so the letters shrink in
  boxes that do not; VS Code's rows are 22 px and its buttons ~26.
- **VS Code's sizes are in its build**: `.monaco-workbench { font-size: 13px }` in
  `workbench.desktop.main.css`; `fontSize.body1` 13, `label1` 12, `body2`/`label2` 11 and the
  spacing tokens registered in `workbench.desktop.main.js`. The Claude desktop app's code is not on
  this machine.
- **Copying a theme's custom properties onto one element copies its sizes too**: the light
  sidenav mock kept 15 px text under a 13 px scale until `--size-*` and the layout tokens were left
  out of the copy.
- **Git's rows are 28 px in code**, not CSS: moving every CSS height a step down left them as they
  were.

## V85a — the honeycomb, built (2026-10-31, branch `feature/hive-honeycomb-background`)

The arrival's shutter kept behind the page while Hive is on (decisions 701–707): `combLattice` in
`ui/hive-art.ts`, shared by the arrival and the background; `shell/hive-comb.ts` (the path, pure,
and where the lattice is laid); `shell/HiveComb.tsx` in both shells; its rules in
`shell/hive-comb.css`; light Hive's sidenav light.

**Learned**:
- **16 % crimson outlines on white fail a state's contrast on a line's pixel**: `--context`
  (`#78839c`) was 2.88:1 on `#f6d9de`; 13 % (`#f8e0e4`) keeps it at 3.04 and `--faint` at 3.42. The
  test caught it, not the mockup: light Hive's outlines are 13 %, not the 16 % the person saw.
- **A diff's page has a shell of its own** (`diff/DiffShell.tsx`): the layer in `Shell.tsx` alone
  left every diff without the honeycomb; the screenshots showed it, an e2e checks it now.
- **A fixed layer at `z-index: -1` paints under an in-flow block's background**: in the app on
  Linux, `#root` carries the window's rounded ground (`frame.css`), which would hide the layer;
  in Hive it is clear and the layer takes the corners.
- **The hand-over matches to the pixel**: frames of the turn-on at 1440 × 900, the shutter's
  covered frame against the first frame without its canvas, on a strip of ground no trace crosses:
  143 of 143 of the canvas's line pixels fall on the honeycomb's; the SVG's 1 px lines are
  crisper (478 pixels over the threshold against 143), the canvas being drawn at 0.83× and
  stretched: a slight sharpening as the tiles open, as the plan expected.
- **`pkill`-style matching kills your own shell**: `pgrep -f 'port 4791'` matched the command
  that ran it (exit 144); find the view's PID by its full command line.

**Verification**: tests first (red: `hive-comb.test.ts` with no module; the tokens' comb lines
missing); `pnpm check` 2,651 tests; `hive.spec.ts` 6 of 6 (the hand-over, a resize, a reload, a
diff's page, the narrow drawer, off, light, reduced motion).

## V85b — the compact look, built (2026-10-31, branch `feature/hive-honeycomb-background`)

VS Code's type and density on every page (decisions 708–715): the scale 11/11/12/13/16 and
`--size-code` 13; the terminal 14; height tokens (`--height-row` 22, `--height-control` 26,
`--height-tall` 28, `--height-tab` 30, `--height-bar` 34, `--height-top` 40), every control, row and
bar on them (69 rules in 26 stylesheets, squares' widths with them); `--card-head` 35,
`--page-head` 36, `--page-pad` 12, `--page-gap` 8, `--card-pad` 12, fields 4 / 14; Git's rows 22.

**Learned**:
- **A token's height is a minimum; the padding inside decides**: the heads kept 8 px of padding
  round a 26 px control (43 px against 35), the page's head its 22 + 2 + 20 px lines (44 against
  36), a workspace's tabs 7 px over a 30 px tab (38), the diff's and the merge's chips 20 and 22 px
  in a 16 and 20 px line. `page-frame.spec.ts` found each one; screenshots alone did not.
- **`calc(var(--card-pad) - 14px)` goes negative** when the pad shrinks: a workspace's tabs lost
  their inset (15 px, not 13) silently; the tabs' own padding came down with it.
- **A guard on every px height refuses layout too**: arcs (1,560 px), panes (180 px), editors
  (240 px). It refuses 28 to 56 px, the controls', rows' and bars' range, but the window title bar.
- **Sixteen e2e checks held the old numbers** (16 px margins, 48 px heads, 15 px body, 32 px
  fields, 28 px rows, 16 terminal cells for 144 px): each now names the token it measures.

**Verification**: tests first (red: the scale, the density tokens, the guard); `pnpm check` 2,653
tests; `pnpm test:e2e` 372 viewer and 20 nexus tests (the first full run found 16 checks on the
old numbers, then the heads and chips above).
First contentful paint of `/git` against `main`'s build (`git archive`), alternated, 15 loads each:
Hive on 80 / 84 ms then 84 / 84 ms (main / V85), Hive off 76 / 76 ms; the first row, an upper bound
after a poll, 167 / 171 and 173 / 186 ms. The arrival at 2560 × 1440: 59–59.5 fps against
59.5–60, one 33 ms frame in each of 3 runs against 1 of 3 on `main` (likely the honeycomb mounting
under the cover). Every page of the scratch repository's view (Git, Start, Settings and Hive's
page, Monitor, Skills, Alpha Ceph, History, a diff's Files and Graph) at 1440 × 900, 1x, both
themes, Hive on and off.

Not verified: the app's own window (its rounded corners over the honeycomb), a GPU, WSLg's display;
the graph's pan with Hive on (`measure.mjs` serves the bare page, without the shell); a workspace's
and a merge's page in screenshots (their frames measured by `page-frame.spec.ts` only).

## V85 — Hive's running review, round 1 (2026-10-31, branch `feature/hive-honeycomb-background`)

The reviewer proved three defects at `e8d986c` with failing tests; two are fixed, their tests kept
in `e2e/hive-comb.spec.ts`, the third left out.

**Learned**:
- **A head that paints its own ground hides the comb**: the Monitor's (`.monitor-bar`,
  `background: var(--bg)` in `HistoryPage.css`) was an opaque band in both themes; the audit's
  screenshots showed it and nobody looked for it. It clears in Hive as a diff's head does; every
  other `PageHead` was checked: none paints one.
- **A commit's review is a new document**: Git opens it with `window.location.assign`, so the
  lattice the arrival laid, held by the module, was gone, and the layer's unmount (leaving `Shell`
  for `DiffShell`) forgot it too. The honeycomb jumped from the question's art (y 375.6) to the
  window's middle (y 450) and stayed there. The lattice is kept per tab in `sessionStorage` now,
  forgotten when Hive turns off; the layer is mounted once at the root. A reload keeps the
  arrival's tiles too (`hive.spec.ts` changed: only a new tab centres on its window).
- **Left out: "Hive off: every page as on main, 15 px body"**: it holds the brief's first words;
  the person asked afterwards for VS Code's type and density on every page ("we should change
  everything to look more professional like VSCode … tweak the density also") and approved the
  plan that applies it in both modes (decisions 708–715).

**Verification**: the reviewer's two tests red at `e8d986c` (the Monitor's head `rgb(7, 5, 6)` and
white; the review's lattice at y 450), green after; `pnpm check` 2,653 tests; `pnpm test:e2e` 374
viewer and 20 nexus tests.

Merged into main (2026-11-01).
