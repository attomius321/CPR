---
name: symbiote-style
description: Symbiote's style — the koi's colours (deep-water chrome lifted above the darkest content, one koi-blue accent, colour otherwise for state), Geist, 8 px controls, lucide-style icons. Gives the tokens (dark and light, contrast checked), plain-CSS recipes for every control, the patterns that make a screen look dated, the traps met applying it, and how to verify a restyle. Use when restyling the viewer, adding or changing any UI in packages/viewer (its CSS, a page, a control, the graph's nodes), when a screen "looks old", or when the user mentions the style, the theme, the look or styling.
---

# Symbiote's style

The viewer's look since V31: one stylesheet, its tokens on `:root` (`ui/base.css` in
`packages/viewer/src/`), every control drawn the same way on every page (`ui/controls.css`).
The stylesheet is in parts beside what they draw (`history/HistoryPage.css` beside
`HistoryPage.tsx`), listed in cascade order by `styles.css`. V29b gave Symbiote its colours, font and
density; V31 the rest: lifted chrome, neutral selection, drawn controls, one radius scale; V37
quiet fields, no tracking, a hover apart from the selection, and help behind a "?"; V42 the koi's
colours, sampled from the intro: the water for the chrome, the white koi for the text, their blue
light for the primary and one accent.

- Tokens, dark and light, with their contrast: [tokens.md](tokens.md)
- Plain-CSS recipes for each control: [components.md](components.md)
- Try a palette against Symbiote's contrast rules before editing: `node .claude/skills/symbiote-style/palette-check.mjs`
- Screenshot a running `symbiote view`'s pages, dark and light: `node .claude/skills/symbiote-style/shots.mjs
  http://127.0.0.1:<port> <out dir> /history /settings …` (`--width`, `--theme`)

## The style in six rules

1. **Quiet, in the koi's colours.** The koi's deep water carries the chrome: navy-tinted
   neutrals, not greys. Colour is for state — diff kinds, findings' severity, an agent's status,
   git lanes — and for one accent, the koi's blue light, in named roles (rule 3). Reach for
   muted/raised/line before a colour.
2. **The content is darkest; the chrome is lifted.** Canvas `#05080f`, the intro tile's abyss (the
   graph, History's rows; the terminal is `#02040a`); sidenav, panels, toolbars and the status bar
   `#0f1626`; chips and the segmented track `#1c2539`. Never one black for everything.
3. **The accent marks what a person acts with.** The primary action (`--primary`, the koi's blue,
   white text), focus, what is checked, the current page, the selection (a 16 % wash of
   `--accent`), the selected node, a link under the pointer. Never a state: moved and info are cyan
   (V42), and a guard in `tokens.test.ts` keeps `--accent` to its roles. The hover stays a wash of
   the text.
4. **Hierarchy by weight and opacity, not by colour or size.** 14 px for rows and nav, 13 px
   secondary, 12 px captions, nothing smaller but uppercase labels (the `--size-*` scale, V32);
   weight 500 for labels and buttons, 600 for headings; idle nav text in `--muted`, its icon in
   `--faint`.
5. **Soft geometry.** Controls and rows 8 px radius, dialogs 10 px, menus 11 px, cards 14 px,
   badges round. Lines are hairlines. Three elevations only: hairline, a slight lift
   (`0 1px 2px`), floating.
6. **Recede and frame.** Symbiote hosts a graph, diffs and a terminal: its own UI frames them. Show the
   frequent actions; put the rare ones in a menu. Explanation goes behind a "?" (`Help.tsx`, a
   tooltip on hover or focus); states, warnings and errors stay on the page.

## Constraints the style keeps

Decisions recorded in `docs/PLAN.md`/`JOURNAL.md`; a new look must keep them.

- **Fonts**: `'Geist Variable', monospace` and `'Geist Mono Variable', monospace`, nothing else
  (V29a/V29b: a family name the system lacks cost 283–900 ms on Linux). No system font stack.
  Prefer an icon to a new symbol glyph.
- **Type** (V32): every font size from the `--size-*` scale on `:root`, never a px value (the same
  test). V29b's 13 px body with 10–11 px captions was too small to read; do not go back under 12 px.
- **Contrast** (`packages/viewer/test/tokens.test.ts`): text, muted and the accent ≥ 4.5:1 on the
  four backgrounds; white on the primary and its hover ≥ 4.5:1; states, `--faint`, `--focus` ≥
  3:1; `--edge` ≥ 3:1 (a field on hover, a checkbox); region lines ≥ 1.2:1. The tested tokens are `#rrggbb`; translucent values go in other tokens.
  A text field at rest has the soft `--field-line` (~1.5:1, decision 246, the person's choice):
  its label names it, and hover and focus bring the 3:1 edge and the ring.
- **Letter-spacing 0** but uppercase labels (V37): fractional tracking rounds into uneven gaps
  between letters at 1× on Linux.
- **No new runtime dependency** without a reason in PLAN.md: no CSS framework, component kit or
  icon package. Write rules in the part beside the component (a shared control's in
  `src/ui/controls.css`); draw icons in `src/ui/icons.tsx` from lucide's paths (ISC; keep a
  one-line credit there).
- **Layout never depends on selection, hover or review state** (viewer `CLAUDE.md`). A selected or
  hovered node may change colour, background, outline or box-shadow; never border width, padding
  or font size. Node widths are estimated from characters (`nodeWidth`); a font-size change in a
  node is a layout change: measure it and update the layout tests knowingly.
- **The map** (below 45 % zoom): labels keep fixed sizes, scaled by `--symbiote-zoom`. No transitions,
  shadows or `backdrop-filter` on graph nodes or edges: they are drawn by the thousand and repaint
  on every pan frame. Blur and floating shadows are for a handful of elements (menus, dialogs).
- **Theme blocks**: dark (`:root, :root[data-theme='dark']`), light, and the system-light media
  block, which must equal light (a test compares them).

## What makes a screen look dated, and the style's answer

What V31 replaced, measured on `main` before it; the same patterns tend to come back with new UI.

| Dated pattern | The style's answer |
|---|---|
| One black for every surface (page and sidenav 1.04:1 apart) | Canvas `#05080f`, chrome `#0f1626` (1.11:1) |
| Blue for everything: picks, links, selected nodes, checkboxes, states (before V31) | One accent in named roles (V42), states in their own colours; links in the text colour, the accent and an underline on hover |
| Neutral greys with no colour of Symbiote's own (V31–V41) | The koi's palette (V42): navy-tinted chrome, the koi's blue for the primary and the accent |
| Native checkboxes and selects | Drawn controls; the `<input>` and `<select>` stay |
| A 2–4 px coloured left border on a row | A neutral row; the state as a dot, an icon or a tinted badge |
| Bordered chips, mono text for names | Quiet chips: `--raised`, muted text, 4 px radius, no border; names in sans |
| A filled saturated pill (HEAD's) | A success tint: a 12 % fill and a 30 % edge, the state colour as text |
| Underlined tabs with a heavy rule (the diff's sidebar until V42) | A segmented control, or line tabs in the text colour |
| Letters as buttons and hints | lucide-style icons; key caps on hover or in the tooltip |
| A grey, disabled-looking main action | The primary: the koi's blue `#3c6fd6`, white text, its top edge lit (`--primary-shine`) |
| Radii of seven sizes | The scale: 4, 8, 10, 11, 14 px and round |
| Uneven gaps between letters ("n o commits") at 1× (V37) | `letter-spacing: 0`; controls `inherit` |
| A 3:1 edge on every field, a 2 px outline over it on focus, a resize grip (V37) | `--field-line` at rest, `--edge` on hover, `--focus` and a 3 px `--ring`; textareas `field-sizing: content` |
| Hover and selection 2 points apart (8 and 10 %) (V37) | Hover 5 %, selection 10 % (`tokens.test.ts` keeps them 3 apart) |
| Help as paragraphs, `title`s and a `ⓘ` (V37) | One `Help` button: a tooltip on hover or focus, kept by a click |
| Folder tabs; capitals for section headings (V37) | Flat buttons, the picked one `--selected`; sentence case and a round count |

## Traps found applying it (V31)

- **`--panel` equals `--side`** in the dark theme. A hover or selection painted with a surface
  token (`--panel`, `--raised`) vanishes or jumps: use `--hover` and `--selected` (V31a moved 13
  rules).
- **Guards in `test/tokens.test.ts`**: `--moved` only in state rules (an allowlist of selectors:
  add a new state there, never an accent), `--accent` only in its roles (`ACCENT_ROLES`: add a
  role's selector, never a state's), no coloured side bar (`border-left` 2–4 px or an inset
  bar; a blockquote's `--line` is allowed), no `accent-color`, every radius on the scale
  (`inherit` passes). They read every `.css` under `src/`.
- **The cascade is `src/styles.css`'s list**: a part later in it wins at equal specificity. Add a
  new part to the list, never as an import in its component (`test/styles.test.ts` refuses one:
  Vite would order it by the module graph). Two places where the list's order matters today:
  `ui/markdown.css` after `workspaces/Workspace.css` (a thread's report is
  `.thread-text.markdown`), `shell/Shell.css` after `shell/Sidenav.css` (the narrow shell hides
  the sidenav).
- **Colours pinned in e2e**: `look.spec.ts` (page and chrome) and `app.spec.ts` (the window's
  title-bar buttons take `--side`). A token change updates them, nothing else should. Outside the
  viewer's tokens, kept by hand (tokens.md, *Outside the tokens*): the terminal's theme, the app's
  window and title bar (`frame.ts` and its test), the app's start page (`start.css`).
- **A lighter primary on hover loses its text** (V42): every blue lighter than `#3c6fd6` takes white
  under 4.5:1. The hover is a step darker (`--primary-hover`); a ghost button resets the primary's
  lit edge (`box-shadow: none`), or a white line shows on its top.
- **The koi S does not read under 24 px** (V39, V42): the mark is an image (`ui/koi-mark.png`, the
  app's icon cropped to its tile, 48 px) at 24 px, 20 in the title bar; never 16.
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
  own Playwright config, kept outside the repository (ESLint scans any `.ts` in `packages/`), with
  a `package.json` of `{"type":"module"}` beside it (`e2e/symbiote.ts` uses `import.meta`).
- **Form controls do not inherit letter-spacing** (V37): Chromium sets `normal` on them, and
  `font: inherit` does not reset it. Check with a computed style, not by eye.
- **A floating tip inside the page is clipped or misplaced**: `container-type` (the start page),
  `transform` and `backdrop-filter` make a containing block for `position: fixed`, and scrolling
  panels clip. `Help` draws its tip on `document.body`; tests find it by role, not inside a region.
- **A tip shown by a hover must let the pointer through** (`pointer-events: none` until a click
  keeps it): it covers the field under its button, and a test (or a person) moving there is
  stopped by it.
- **`field-sizing: content` ignores `rows`**: give the rows' height as a `min-height` (`lh` units).
- **A help button inside a `<label>`** joins the field's accessible name: put the name in its own
  `<label htmlFor>` and the button beside it (`.field-label`).

## Workflow

A restyle is a milestone: plan it with the `milestone` skill (PLAN section, branch, tests first,
JOURNAL). Use this checklist inside it.

```
- [ ] 1. Read JOURNAL's V29b and V31 entries and the viewer CLAUDE.md
- [ ] 2. Screenshot before: the pages you touch, 1440×900, dark and light: shots.mjs on
         `symbiote view [<base> <head>] --no-open --port <n>` (a diff is served at the
         `/diff/<base>..<head>/` its log prints); measure.mjs --shot for real graphs
- [ ] 3. Tokens first: palette-check.mjs with the new values, then the expected values in
         test/tokens.test.ts (red), then src/ui/base.css (green)
- [ ] 4. Components region by region (shell, History, a diff's panels, the graph, Settings,
         workspaces, dialogs), one commit each, by the recipes in components.md
- [ ] 5. pnpm check, pnpm build, pnpm test:e2e (look.spec.ts asserts fonts, theme, card height)
- [ ] 6. viewer-check on Bitwarden 737ee3f: first paint, select, mark reviewed, pan fps against
         main's build, alternated; /history first rows
- [ ] 7. Screenshots after, same views; send them to the user beside the before ones
- [ ] 8. JOURNAL: what changed, numbers, what was not verified; README screenshots if retaken
```

When this skill is silent: match Symbiote's adjacent control and the six rules; if that does not
answer, ask the user before inventing a value.
