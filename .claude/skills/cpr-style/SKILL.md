---
name: cpr-style
description: CPR's style — monochrome, quiet chrome lifted above the darkest content, colour only for state, Geist, 8 px controls, lucide-style icons. Gives the tokens (dark and light, contrast checked), plain-CSS recipes for every control, the patterns that make a screen look dated, the traps met applying it, and how to verify a restyle. Use when restyling the viewer, adding or changing any UI in packages/viewer (styles.css, a page, a control, the graph's nodes), when a screen "looks old", or when the user mentions the style, the theme, the look or styling.
---

# CPR's style

The viewer's look since V31: one stylesheet (`packages/viewer/src/styles.css`), its tokens on
`:root`, every control drawn the same way on every page. V29b gave CPR its colours, font and
density; V31 the rest: lifted chrome, neutral selection, drawn controls, one radius scale.

- Tokens, dark and light, with their contrast: [tokens.md](tokens.md)
- Plain-CSS recipes for each control: [components.md](components.md)
- Try a palette against CPR's contrast rules before editing: `node .claude/skills/cpr-style/palette-check.mjs`
- Screenshot a running `cpr view`'s pages, dark and light: `node .claude/skills/cpr-style/shots.mjs
  http://127.0.0.1:<port> <out dir> /history /settings …` (`--width`, `--theme`)

## The style in six rules

1. **Monochrome and quiet.** Neutral greys carry the chrome. Colour is for state only: diff kinds,
   findings' severity, an agent's status, git lanes. Reach for muted/raised/line before a colour.
2. **The content is darkest; the chrome is lifted.** Canvas `#0a0a0a` (the graph, History's rows,
   the terminal is `#000`); sidenav, panels, toolbars and the status bar `#171717`; chips and
   selected rows `#262626`. Never one black for everything.
3. **Selection is neutral.** Active row: a 10 % wash of the text colour and a brighter border. The
   focus ring is grey. Blue is `--moved`/`--info`, a state; it is not the accent.
4. **Hierarchy by weight and opacity, not by colour or size.** 13 px for rows and nav, 12 px
   secondary, 11 px captions; weight 500 for labels and buttons, 600 for headings; idle nav text in
   `--muted`, its icon in `--faint`.
5. **Soft geometry.** Controls and rows 8 px radius, dialogs 10 px, menus 11 px, cards 14 px,
   badges round. Lines are hairlines. Three elevations only: hairline, a slight lift
   (`0 1px 2px`), floating.
6. **Recede and frame.** CPR hosts a graph, diffs and a terminal: its own UI frames them. Show the
   frequent actions; put the rare ones in a menu, a "?" or a hover.

## Constraints the style keeps

Decisions recorded in `docs/PLAN.md`/`JOURNAL.md`; a new look must keep them.

- **Fonts**: `'Geist Variable', monospace` and `'Geist Mono Variable', monospace`, nothing else
  (V29a/V29b: a family name the system lacks cost 283–900 ms on Linux). No system font stack.
  Prefer an icon to a new symbol glyph.
- **Contrast** (`packages/viewer/test/tokens.test.ts`): text and muted ≥ 4.5:1 on the four
  backgrounds; states, `--faint`, `--focus` ≥ 3:1; a text field's edge (`--edge`) ≥ 3:1; region
  lines ≥ 1.2:1. The tested tokens are `#rrggbb`; translucent values go in other tokens.
- **No new runtime dependency** without a reason in PLAN.md: no CSS framework, component kit or
  icon package. Write rules in `styles.css`; draw icons in `src/icons.tsx` from lucide's paths
  (ISC; keep a one-line credit there).
- **Layout never depends on selection, hover or review state** (viewer `CLAUDE.md`). A selected or
  hovered node may change colour, background, outline or box-shadow; never border width, padding
  or font size. Node widths are estimated from characters (`nodeWidth`); a font-size change in a
  node is a layout change: measure it and update the layout tests knowingly.
- **The map** (below 45 % zoom): labels keep fixed sizes, scaled by `--cpr-zoom`. No transitions,
  shadows or `backdrop-filter` on graph nodes or edges: they are drawn by the thousand and repaint
  on every pan frame. Blur and floating shadows are for a handful of elements (menus, dialogs).
- **Theme blocks**: dark (`:root, :root[data-theme='dark']`), light, and the system-light media
  block, which must equal light (a test compares them).

## What makes a screen look dated, and the style's answer

What V31 replaced, measured on `main` before it; the same patterns tend to come back with new UI.

| Dated pattern | The style's answer |
|---|---|
| One black for every surface (page and sidenav 1.04:1 apart) | Canvas `#0a0a0a`, chrome `#171717` (1.10:1) |
| Blue as the accent: picks, links, selected nodes, checkboxes | Neutral selection (components.md, *Rows and lists*); links in the text colour, underlined on hover |
| Native checkboxes and selects | Drawn controls; the `<input>` and `<select>` stay |
| A 2–4 px coloured left border on a row | A neutral row; the state as a dot, an icon or a tinted badge |
| Bordered chips, mono text for names | Quiet chips: `--raised`, muted text, 4 px radius, no border; names in sans |
| A filled saturated pill (HEAD's) | A success tint: a 12 % fill and a 30 % edge, the state colour as text |
| Underlined tabs with a heavy rule | A segmented control, or line tabs in the text colour |
| Letters as buttons and hints | lucide-style icons; key caps on hover or in the tooltip |
| A grey, disabled-looking main action | The primary: `#e5e5e5` fill, `#171717` text in dark |
| Radii of seven sizes | The scale: 4, 8, 10, 11, 14 px and round |

## Traps found applying it (V31)

- **`--panel` equals `--side`** in the dark theme. A hover or selection painted with a surface
  token (`--panel`, `--raised`) vanishes or jumps: use `--hover` and `--selected` (V31a moved 13
  rules).
- **Guards in `test/tokens.test.ts`**: `--moved` only in state rules (an allowlist of selectors:
  add a new state there, never an accent), no coloured side bar (`border-left` 2–4 px or an inset
  bar; a blockquote's `--line` is allowed), no `accent-color`, every radius on the scale
  (`inherit` passes).
- **Colours pinned in e2e**: `look.spec.ts` (page and chrome) and `app.spec.ts` (the window's
  title-bar buttons take `--side`). A token change updates them, nothing else should.
- **Restyling `.link`** reaches every link-styled button: Settings' placeholders are insert
  buttons, drawn as code chips, not links.
- **A node's border is part of its content box**: the symbol's 3 px side bar became a 1 px edge
  with 2 px more padding, so labels keep their width.
- **`backdrop-filter` makes a containing block** for `position: fixed` descendants, as
  `transform` does: on a menu it sent the fixed submenu off screen. Put the glass on a `::before`
  behind the content (`isolation: isolate` on the menu, the layer at `z-index: -1`). Fade floating
  surfaces by opacity only: the menus measure their own box to stay in the window.
- **An inline block that hides its overflow** takes its bottom edge as its baseline: a chip in a
  heading needs `vertical-align`.
- **Screenshots of workspaces** need e2e's `serveWorkspaces` (a fake agent): a spec run with its
  own Playwright config, kept outside the repository (ESLint scans any `.ts` in `packages/`).

## Workflow

A restyle is a milestone: plan it with the `milestone` skill (PLAN section, branch, tests first,
JOURNAL). Use this checklist inside it.

```
- [ ] 1. Read JOURNAL's V29b and V31 entries and the viewer CLAUDE.md
- [ ] 2. Screenshot before: the pages you touch, 1440×900, dark and light: shots.mjs on
         `cpr view [<base> <head>] --no-open --port <n>` (a diff is served at the
         `/diff/<base>..<head>/` its log prints); measure.mjs --shot for real graphs
- [ ] 3. Tokens first: palette-check.mjs with the new values, then the expected values in
         test/tokens.test.ts (red), then styles.css (green)
- [ ] 4. Components region by region (shell, History, a diff's panels, the graph, Settings,
         workspaces, dialogs), one commit each, by the recipes in components.md
- [ ] 5. pnpm check, pnpm build, pnpm test:e2e (look.spec.ts asserts fonts, theme, card height)
- [ ] 6. viewer-check on Bitwarden 737ee3f: first paint, select, mark reviewed, pan fps against
         main's build, alternated; /history first rows
- [ ] 7. Screenshots after, same views; send them to the user beside the before ones
- [ ] 8. JOURNAL: what changed, numbers, what was not verified; README screenshots if retaken
```

When this skill is silent: match CPR's adjacent control and the six rules; if that does not
answer, ask the user before inventing a value.
