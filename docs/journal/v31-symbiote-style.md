# Journal: V31 — Symbiote's style, beyond its colours

[Index](../JOURNAL.md) · [Plan](../plan/v31-symbiote-style.md)

## V31 spike — what the look needs, beyond its colours (2026-10-21, branch `milestone/v31-symbiote-style`)

Asked: "The interface still not feel well...feel oldish with a new look." Read a reference app's
style guide, tokens and component primitives, and its screenshot; recorded as Symbiote's own style, the
`symbiote-style` skill (merged into main 2026-10-21; renamed on this branch: "It is our own style from
now").

**Learned**:
- **V29b took the reference's colours, not its rules.** The style is "monochrome and quiet":
  neutral chrome lifted above the darkest content (`#171717` over `#0a0a0a`, 1.10:1; Symbiote's sidenav
  over its page was 1.04:1), colour for state only, selection a 10 % wash of the text. Symbiote's blue (`--moved`) is on
  49 lines: 2 the moved kind, 12 states, 35 an accent (links, picks, cursors, pressed toggles).
- **The dated parts are controls and states**: 6 native checkboxes, 8 coloured side bars,
  bordered mono chips, a solid HEAD badge, radii of 2–12 px in seven sizes where the style has
  four steps.
- **The reference's values do not all pass Symbiote's contrast floors**: region lines of 7 % white are
  1.15:1 on the canvas (Symbiote's floor 1.2), an input edge of 15 % white about 1.5:1 (Symbiote's 3:1), a
  light muted text 4.16:1 on a chip (Symbiote's 4.5). The skill's tokens take 11 values to the nearest
  neutral that passes, checked by `palette-check.mjs` with `tokens.test.ts`'s rules.
- **Font and layout constraints carry over**: Geist stays, and no system mono stack may be
  named (V29a); node widths are estimated from characters, so the chrome's 0.01em letter-spacing
  stays off the graph.

**Measured** on `main` (`e659928`), Bitwarden `737ee3f` with the Angular plugin, three runs: first
paint 267–322 ms, select 73–90 ms, mark reviewed 33–34 ms, pan 63 fps. Screenshots of the shell
with three workspaces, History, Settings, Start and the V30b diff, dark and light, kept for the
comparison.

## V31a–b — the style's tokens, the shell and the diff page (2026-10-21, branch `milestone/v31-symbiote-style`)

The tokens: the content darkest, the chrome lifted, a white page in light. Blue is a
state; selection, links and pressed controls are neutral. Checkboxes drawn, badges round and
tinted, no coloured side bars, 8–14 px radii, key caps, thin scrollbars. The sidenav's rows,
groups and cards, the page heads, the status bar (V31a); the diff's bar, findings, change list,
canvas chrome and detail panel (V31b).

**Learned**:
- **The dark theme gives the sidenav and the panels one colour** (`#171717`): a hover painted
  with `--panel` on a panel did not show. 13 hover and selected rules used a surface token; all now
  use `--hover` (a wash of the text) and `--selected`.
- **"Blue is a state" needed a list, not a rule**: 14 of 49 `--moved` uses are states (the moved
  kind, an agent working, "since", the current lane); the guard test names their selectors, and
  found 29 accent rules on `main`.
- **Restyling `.link` reaches buttons that are not links**: Settings' placeholders are insert
  buttons, now code chips.
- **The window's title-bar buttons follow `--side`** (N1c): `app.spec.ts` pinned V29b's value;
  the only e2e change outside the look spec.
- **A side bar is part of a node's content box**: the symbol's 3 px bar became a 1 px edge with
  2 px more padding, so its labels keep their width and the layout is untouched.

**Verification**: tests first, red on `main` (7 unit, 3 e2e); `pnpm check` 1,075 tests; e2e 168
of 168. Against `main`'s build, alternated, Bitwarden `737ee3f`: first paint 266–272 → 268–272 ms,
select 74 → 73–89 ms, mark reviewed 34 → 33 ms, pan 63 fps both, 3,134 elements both; labels cut
short as j walks 40 changes 21 of 75 both; `/history` first rows 93–122 → 93–96 ms. Screenshots
before and after, dark and light. Not verified: Windows and macOS rendering; the Electron window
beyond its e2e; real agents in the restyled workspace.

## V31c — History, menus, dialogs and selects in the style (2026-10-21, branch `milestone/v31-symbiote-style`)

History's refs are names in the text's font on quiet chips, HEAD a success tint instead of a solid
fill; menus are a blurred glass, dialogs float over a dimmed and blurred page with a ghost Cancel;
selects have a drawn chevron; every radius is on the style's scale.

**Learned**:
- **`backdrop-filter` makes a containing block**, as `transform` does: with the blur on the row
  menu, its `position: fixed` submenu was placed from the menu, not the window, and opened off
  screen (y 1,467 in a 900 px window); 10 e2e tests in checkout, reviews and merges failed. The
  glass now sits on a `::before` behind the items.
- **Animate floating surfaces by opacity only**: the menus measure their own box to stay in the
  window, and a scale would change it while they open.
- **An inline block that hides its overflow** takes its bottom edge as its baseline: the commit
  chip in a dialog's heading rose above the line once its border went.
- **One slow run is not a regression**: select read 88–106 ms on V31c in a run right after the
  e2e suite; five alternated rounds with `main` and V31b put it at 73–74 ms (88 once).

**Verification**: tests first, red (the radius scale, 14 off; History's names, HEAD's tint, the
menu's glass in the look spec); `pnpm check` 1,076 tests; e2e 169 of 169. Bitwarden `737ee3f`, 5
rounds alternated: first paint 265–289 (`main`) → 261–295 ms, select 74 → 73–88 ms, mark reviewed
33 → 33–34 ms; `/history` first rows 92–121 → 93–96 ms. Screenshots before and after, dark and
light. Not verified: Windows and macOS rendering; the blur's cost on a slow GPU (two layers, only
while a menu or dialog is open).

Merged into main (2026-10-21), with V31a–b, from branch `milestone/v31-symbiote-style`: `pnpm check`
1,076 tests, build, e2e 169 of 169 on `main`. Decisions 212–217 confirmed by the person.
