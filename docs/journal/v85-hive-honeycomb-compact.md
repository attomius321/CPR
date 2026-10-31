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
