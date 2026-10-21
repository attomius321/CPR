---
name: orca-theme
description: CPR's look after Orca (stablyai/orca) — monochrome, quiet chrome on a black canvas, lifted neutral panels, colour only for state, Geist, 8 px controls, lucide-style icons. Gives the tokens (dark and light, contrast checked), plain-CSS recipes for every control, the patterns that make a screen look dated, and how to verify a restyle. Use when restyling the viewer, adding or changing any UI in packages/viewer (styles.css, a page, a control, the graph's nodes), when a screen "looks old", or when the user mentions Orca, the theme, the look or styling.
---

# Orca theme

CPR's viewer took Orca's colours in V29b (tokens, Geist, density) but kept older habits: one flat
black for every surface, GitHub blue as the accent, native checkboxes, 3 px coloured side bars,
bordered mono chips, underlined tabs. The result reads as an old app in new colours. This skill is
the rest of Orca's design language, translated to CPR's single stylesheet.

Source: [stablyai/orca](https://github.com/stablyai/orca) (MIT), read at `5dd5294` (2026-10-21):
`docs/STYLEGUIDE.md` (roles and rules), `src/renderer/src/assets/main.css` (token values),
`src/renderer/src/components/ui/*.tsx` (shadcn new-york-v4 primitives on a neutral base). To look
again: `git clone --depth 1 https://github.com/stablyai/orca` into the scratchpad and read those
three; `docs/assets/readme-hero.jpg` is the app as it looks.

- Tokens, dark and light, with their contrast: [tokens.md](tokens.md)
- Plain-CSS recipes for each control: [components.md](components.md)
- Try a palette against CPR's contrast rules before editing: `node .claude/skills/orca-theme/palette-check.mjs`
- Screenshot a running `cpr view`'s pages, dark and light: `node .claude/skills/orca-theme/shots.mjs
  http://127.0.0.1:<port> <out dir> /history /settings …` (`--width`, `--theme`)

## The language in six rules

1. **Monochrome and quiet.** Neutral greys carry the chrome. Colour is for state only: diff kinds,
   findings' severity, an agent's status, git lanes. Reach for muted/raised/line before a colour.
2. **The content is darkest; the chrome is lifted.** Canvas `#0a0a0a` (the graph, History's rows,
   the terminal is `#000`); sidenav, panels, toolbars and the status bar `#171717`; chips and
   selected rows `#262626`. Never one black for everything.
3. **Selection is neutral.** Active row: a 10 % wash of the text colour and a brighter border. The
   focus ring is grey. Blue is `--moved`/`--info`, a state; it is not the accent.
4. **Hierarchy by weight and opacity, not by colour or size.** 13 px for rows and nav, 12 px
   secondary, 11 px captions; weight 500 for labels and buttons, 600 for headings; idle nav text at
   60 % of the text colour, its icon at 30 %.
5. **Soft geometry.** Controls and rows 8 px radius, cards 14 px, menus 11 px, badges round. Lines
   are hairlines. Three elevations only: hairline, a slight lift (`0 1px 2px`), floating.
6. **Recede and frame.** CPR hosts a graph, diffs and a terminal: its own UI frames them. Show the
   frequent actions; put the rare ones in a menu, a "?" or a hover.

## What CPR keeps where Orca differs

These are CPR decisions recorded in `docs/PLAN.md`/`JOURNAL.md`. They win over Orca.

- **Fonts**: `'Geist Variable', monospace` and `'Geist Mono Variable', monospace`, nothing else
  (V29a/V29b: a family name the system lacks cost 283–900 ms on Linux). Orca's mono stack (SF Mono,
  Menlo, Consolas…) must not be copied. Prefer an icon to a new symbol glyph.
- **Contrast** (`packages/viewer/test/tokens.test.ts`): text and muted ≥ 4.5:1 on the four
  backgrounds; states, `--faint`, `--focus` ≥ 3:1; a text field's edge (`--edge`) ≥ 3:1, where
  Orca's 15 % white input border is ~1.5:1; region lines ≥ 1.2:1, where Orca's 7 % white is 1.15:1
  on the canvas. The tested tokens are `#rrggbb`; translucent values go in new tokens only.
- **No new runtime dependency** without a reason in PLAN.md: no Tailwind, shadcn, Radix,
  lucide-react or tw-animate. Translate class lists into rules in `packages/viewer/src/styles.css`;
  draw icons in `src/icons.tsx` from lucide's paths (ISC; keep a one-line credit there).
- **Layout never depends on selection, hover or review state** (viewer `CLAUDE.md`). A selected or
  hovered node may change colour, background, outline or box-shadow; never border width, padding
  or font size. Node widths are estimated from characters (`nodeWidth`); a font-size change in a
  node is a layout change: measure it and update the layout tests knowingly.
- **The map** (below 45 % zoom): labels keep fixed sizes, scaled by `--cpr-zoom`. No transitions,
  shadows or `backdrop-filter` on graph nodes or edges: they are drawn by the thousand and repaint
  on every pan frame. Blur and floating shadows are for a handful of elements (menus, dialogs).
- **Theme blocks**: dark (`:root, :root[data-theme='dark']`), light, and the system-light media
  block, which must equal light (a test compares them).

## What makes a screen look old, and the fix

Found on `main` (`30cbd54`) at 1440×900; each line names a place to start.

| Dated pattern | Where | Orca's way |
|---|---|---|
| One black for every surface (`--bg #0b0b0c`, `--side #111113`: 1.04:1 apart; Orca's 1.10:1) | every page | Canvas `#0a0a0a`, chrome `#171717` (tokens.md) |
| Blue as the accent: picks, links, selected nodes, checkboxes (`var(--moved)` on 49 lines) | History, Settings' `{branch}` tokens, "← History", graph selection | Neutral selection (components.md, *List rows*); links in text colour, underlined on hover |
| Native checkboxes (`accent-color`) | diff toolbar: Focus, Context, Type references (`App.tsx`); `StartPage.tsx` | Toggle buttons (pressed state) or a switch |
| 3 px coloured left border on a row (8 rules) | findings, notices, merges | Neutral row; state as a dot, an icon or a tinted badge |
| Bordered chips, blue mono text (`origin/…`, branch refs) | History rows | Quiet chip: `--raised`, muted text, 4 px radius, no border |
| Filled saturated pill (`HEAD → main` solid green, V11's `.ref-head`, `.head-chip`) | History | Success tint: 10 % fill, 25 % border, the state colour as text; HEAD still stands out |
| Underlined tabs with a heavy rule | Changes / Findings | Segmented control, or the line variant in the text colour |
| Mono for names (branch list, nav) | History's branches | Sans for names; mono only for the literal: SHAs, code, a path in code |
| Letters as buttons and hints (`x`, `?`, `h`, `s` beside nav items) | toolbars, sidenav | lucide-style icons; keycaps on hover or in the tooltip |
| Always-visible legend and key strip | diff page bottom | Behind "?" or a hover (a behaviour change: ask the user first) |
| Grey disabled-looking primary (`Save`) | Settings | Primary: `#e5e5e5` fill, `#171717` text, weight 500 |
| Project frames: border at 28 % of the text colour, 12 px radius | graph | Card frame: `--line` mixed with 12 % text, 14 px radius; the map's fixed label sizes stay |

## Workflow

A restyle is a milestone: plan it with the `milestone` skill (PLAN section, branch, tests first,
JOURNAL). Use this checklist inside it.

```
- [ ] 1. Read JOURNAL's V29b entry and the viewer CLAUDE.md; open Orca's hero image beside CPR
- [ ] 2. Screenshot before: the pages you touch, 1440×900, dark and light: shots.mjs on
         `cpr view [<base> <head>] --no-open --port <n>` (a diff is served at the
         `/diff/<base>..<head>/` its log prints); measure.mjs --shot for real graphs
- [ ] 3. Tokens first: palette-check.mjs with the new values, then the expected values in
         test/tokens.test.ts (red), then styles.css (green)
- [ ] 4. Components region by region (shell, History, a diff's panels, the graph, Settings,
         workspaces, dialogs), one commit each, by the recipes in components.md
- [ ] 5. pnpm check, pnpm build, pnpm test:e2e (look.spec.ts asserts fonts, theme, card height)
- [ ] 6. viewer-check on Bitwarden 737ee3f: first paint, select, mark reviewed, pan fps against
         main's build, back to back; /history first rows
- [ ] 7. Screenshots after, same views; send them to the user beside the before ones
- [ ] 8. JOURNAL: what changed, numbers, what was not verified; README screenshots if retaken
```

When this skill is silent: find the nearest Orca primitive in `components/ui/` and translate its
classes; if Orca has none, match CPR's adjacent control; if neither answers, ask the user before
inventing a value.
