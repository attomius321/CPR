# Tokens

Symbiote's tokens (`packages/viewer/src/ui/base.css`), their roles and values in both themes: the
person's mockup since V61 (the koi's colours V42–V60). Ratios: the lowest over the backgrounds
`test/tokens.test.ts` checks (WCAG 2), from `palette-check.mjs`.

## Where the colours come from (V61)

Sampled from the person's mockup of a workspace (`docs/journal/v61-complete-revamp.md`): the
thread's ground `#090b0e`, the sidenav and the cards' chrome `#0d1015`, chips and raised squares
`#15181f`–`#1c1f26`, the text `#ffffff`/`#ecf4fe`, secondary text `#a3afc1`, "Respond" `#7d68fd`
with `#020214` words on it, the waiting amber `#f6b42b`. The violet is the new S's
(`scripts/desktop/logo.png`). A new colour starts from these.

## Surfaces, text, lines (tested; `#rrggbb`)

| Token | Role | Dark | Light | Lowest ratio dark / light |
|---|---|---|---|---|
| `--bg` | Canvas and the page's ground: graph, History's rows, a thread, gutters | `#090b0e` | `#ffffff` | — |
| `--side` | Sidenav, status bar, a card's chrome (tab strip, changes panel) | `#0d1015` | `#f6f8fc` | 1.03 over `--bg` (the cards' hairline carries the edge) |
| `--panel` | Panels beside the canvas, file boxes, cards | `#0d1015` | `#f6f8fc` | — |
| `--raised` | Chips, counts, segmented track, raised squares | `#171a21` | `#e9eef7` | — |
| `--line` | Region hairlines, a card's edge | `#1f232c` | `#dce3ef` | 1.21 / 1.21 (≥ 1.2) |
| `--edge` | A field's edge on hover; a checkbox's edge | `#5c6373` | `#7f8aa3` | 3.16 / 3.26 (≥ 3) |
| `--text` | Text | `#edf0f5` | `#0b1220` | 15.24 / 16.08 |
| `--muted` | Secondary text, idle nav and its icons, placeholders | `#a2abbc` | `#56627a` | 7.53 / 5.27 (≥ 4.5) |
| `--accent` | The secondary colour: current page, selection, links on hover | `#9886ff` | `#5b3fd9` | 5.96 / 5.71 (≥ 4.5) |
| `--faint` | Captions on hover rows, a group's icon at rest | `#737a8a` | `#78839c` | 4.05 / 3.26 (≥ 3) |
| `--focus` | Focus ring (the accent) | `#9886ff` | `#5b3fd9` | 5.96 / 5.71 (≥ 3) |

A light blue-grey near white (`#f5f7fb`) is about 1.07:1 on white: a hover or a cursor drawn
with it vanishes. Hence `--raised` `#e9eef7` and the mixes below for hover and selection.

## The primary and the accent (V61, decisions 437 and 440)

| Token | Dark | Light | |
|---|---|---|---|
| `--primary` | `#7c68fc` | `#5b3fd9` | The one affirmative action; checked boxes, the stepper's thumb, the picked tab's line |
| `--primary-text` | `#0b0a1a` | `#ffffff` | 4.89 / 6.65 on the primary (≥ 4.5, tested). White on the dark theme's violet is 4.01 |
| `--primary-hover` | `#8a78fd` | `#4e33c6` | Dark: a step lighter, dark words gain (5.77); light: a step darker, white gains |
| `--accent` | `#9886ff` | `#5b3fd9` | Its roles only (a guard in `tokens.test.ts`): `aria-current`, selected, checked, focus, a link under the pointer, `::selection`, the open workspace's kind |
| `--tab-picked` | text 4 % | `#ffffff` | A picked line tab's ground |

## States (tested, ≥ 3:1 on the four backgrounds)

| Token | Dark | Light | Lowest dark / light |
|---|---|---|---|
| `--added` | `#81b88b` | `#587c0c` | 7.60 / 4.19 |
| `--removed` | `#c74e39` | `#ad0707` | 3.79 / 6.42 |
| `--modified` | `#e2c08d` | `#895503` | 10.08 / 5.36 |
| `--moved` | `#3fc5d6` | `#0a7d8c` | 8.43 / 4.17 |
| `--context` | `#737a8a` | `#78839c` | 4.05 / 3.26 |
| `--error` | `#ff6568` | `#e40014` | 6.06 / 4.19 |
| `--warning` | `#f5b32a` | `#9a6700` | 9.42 / 4.18 |
| `--info` | `#3fc5d6` | `#0a7d8c` | 8.43 / 4.17 |

Moved and info are cyan since V42 (decision 281): the koi's blue is 6° of hue from V31's
`#4493f8`, and a moved node would have read as selected. What shares their hue goes with them: an
agent working, "since", History's current lane.

History's lanes, ≥ 3:1 on `--bg` and `--raised`. Dark: `--lane-1 #6aa8ff`, `--lane-2 #40b0a6`,
`--lane-3 #ffb000`, `--lane-4 #dc267f`, `--lane-5 #ce9178`, `--lane-6 #8ccf3e` (lowest 3.84,
`--lane-4` on `--raised`). Light: `#2f62cc #0a7f6f #bc4c00 #bf3989 #4d7a00 #9a6700`. The first
lane left purple for the blue the accent left (V61): `#b66dff` was 1.09:1 from the violet accent.

The Activity tab's kinds of work (V74, decisions 528–530), ≥ 3:1 on the four backgrounds and on
their own tile (a `--phase-wash` share of the colour over `--bg`: 16 % dark, 12 % light). One hue
in both themes, unlike lanes 5 and 6 (tan and olive, lime and brown), so the lanes could not be
reused. A phase's tile, its count, an event's icon, a raw line's chip take them; titles and
summaries keep the text's colours, and a status stays on its badge and the tile's ring.
Settings' list tints its groups' tiles with five of them (V81, decision 601: not git's, the
accent's violet, nor debug's, beside docs' amber), on a tile over `--side`: lowest 5.46 dark,
3.94 light; the open entry's `--accent` on them 4.83 / 5.27.

| Token | Kind | Dark | Light | Lowest dark / light |
|---|---|---|---|---|
| `--phase-explore` | Exploration | `#40b0a6` | `#0a7f6f` | 6.05 / 4.19 |
| `--phase-implement` | Implementation | `#6aa8ff` | `#2f62cc` | 6.44 / 4.74 |
| `--phase-docs` | Documentation | `#e0a548` | `#9a5b00` | 7.05 / 4.59 |
| `--phase-test` | Testing | `#8ccf3e` | `#4d7a00` | 7.95 / 4.37 |
| `--phase-visual` | Visual inspection | `#ec6fae` | `#bf3989` | 5.74 / 4.24 |
| `--phase-debug` | Debugging | `#f2815a` | `#c2410c` | 6.12 / 4.35 |
| `--phase-git` | Git, a commit | `#c08cff` | `#8a3fd1` | 6.29 / 4.75 |

Purple git is 22° of hue from the violet accent: the person's choice (their V73 mockup); the
accent keeps its roles.

## Other tokens (not in the contrast test; may be translucent)

Each is in the dark block, the light block and the system-light block (the test checks that light
and system-light are equal and that both themes have the same names). The translucent ones are
tinted with a cool white, `rgb(220 226 238)`, in dark (V42's white koi until V61) and the navy
text's `rgb(11 18 32)` in light, not pure white or black.

```css
/* dark */
--hover: color-mix(in srgb, var(--text) 5%, transparent);        /* a wash of the text */
--selected: color-mix(in srgb, var(--accent) 16%, transparent);   /* a wash of the accent (V42) */
--selected-line: color-mix(in srgb, var(--accent) 40%, var(--line));
--input-bg: rgb(220 226 238 / 4%);
--field-line: color-mix(in srgb, var(--text) 15%, transparent);  /* a field at rest, ~1.5:1 (decision 246) */
--ring: color-mix(in srgb, var(--focus) 30%, transparent);       /* a focused field's 3 px ring */
--lifted: rgb(220 226 238 / 9%);                                 /* the choice in a segmented control */
--tab-picked: color-mix(in srgb, var(--text) 4%, transparent);   /* a picked line tab's ground (V61) */
--shadow-lift: 0 1px 2px rgb(0 0 0 / 24%);
--shadow-floating: 0 12px 28px rgb(0 0 0 / 45%);
--primary-shine: inset 0 1px 0 rgb(255 255 255 / 22%);           /* the primary's lit top edge */
--ground-arc: rgb(124 104 252 / 30%);                            /* the arcs: Start (V63), an analysis (V71) */
--menu-bg: rgb(13 16 21 / 82%);
--menu-line: rgb(220 226 238 / 12%);
--menu-hover: rgb(220 226 238 / 10%);
--menu-shadow: 0 16px 34px rgb(0 0 0 / 50%), inset 0 1px 0 rgb(220 226 238 / 6%);
--dialog-bg: rgb(13 16 21 / 96%);
--dialog-shadow: 0 24px 72px rgb(0 0 0 / 60%), inset 0 1px 0 rgb(220 226 238 / 8%);
--overlay: rgb(3 4 6 / 62%);
--chevron: url("data:image/svg+xml,…stroke='%23a2abbc'…");      /* a select's arrow, in --muted */
--added-ground: color-mix(in srgb, var(--added) 16%, transparent);
--added-gutter: color-mix(in srgb, var(--added) 30%, transparent);
--removed-ground: color-mix(in srgb, var(--removed) 18%, transparent);
--removed-gutter: color-mix(in srgb, var(--removed) 32%, transparent);

/* light */
--hover: color-mix(in srgb, var(--text) 5%, transparent);
--selected: color-mix(in srgb, var(--accent) 12%, transparent);
--selected-line: color-mix(in srgb, var(--accent) 35%, var(--line));
--input-bg: transparent;
--field-line: color-mix(in srgb, var(--text) 16%, transparent);
--ring: color-mix(in srgb, var(--focus) 25%, transparent);
--lifted: #ffffff;
--tab-picked: #ffffff;
--shadow-lift: 0 1px 2px rgb(11 18 32 / 6%);
--shadow-floating: 0 10px 24px rgb(11 18 32 / 16%);
--primary-shine: inset 0 1px 0 rgb(255 255 255 / 18%);
--ground-arc: rgb(91 63 217 / 16%);
--menu-bg: rgb(255 255 255 / 82%);
--menu-line: rgb(11 18 32 / 13%);
--menu-hover: rgb(11 18 32 / 7%);
--menu-shadow: 0 12px 28px rgb(11 18 32 / 20%), inset 0 1px 0 rgb(255 255 255 / 14%);
--dialog-bg: rgb(255 255 255 / 96%);
--dialog-shadow: 0 20px 60px rgb(11 18 32 / 26%), inset 0 1px 0 rgb(255 255 255 / 8%);
--overlay: rgb(11 18 32 / 45%);
--chevron: url("data:image/svg+xml,…stroke='%2356627a'…");
--added-ground: color-mix(in srgb, var(--added) 13%, transparent);
--added-gutter: color-mix(in srgb, var(--added) 26%, transparent);
--removed-ground: color-mix(in srgb, var(--removed) 11%, transparent);
--removed-gutter: color-mix(in srgb, var(--removed) 22%, transparent);
```

The test keeps the selection further from its ground than the hover on `--bg` and `--side`
(composited, by contrast), in both themes: hover 5 % of the text, selection 16 % (12 % light) of
the accent.

A state tint is mixed from its state, never a new hex: `color-mix(in srgb, var(--added) 10%,
transparent)` for a fill, `25%` for its edge.

## Outside the tokens

Kept in step by hand, each with a comment pointing here: the terminal's theme
(`workspaces/terminal.ts`, `#050608`, a step under the canvas, its selection violet `#2c2757`;
`AgentTerminal.css`, `MergeLog.css`); the app's window background and title bar
(`packages/desktop/src/frame.ts`, `test/frame.test.ts`); the app's start page
(`packages/desktop/start/start.css`, its own copy of the tokens and sizes).

## Type scale (V32, V61; on `:root`, both themes)

Two steps above V29b's dense 13 px: V32's 14 px was still too small for the person's eyes (V61).
Every font size in the stylesheet is one of these (`test/tokens.test.ts`), a multiple of one
(`calc`), `inherit` or an `em`.

| Token | Value | Role |
|---|---|---|
| `--size-caps` | 12 px | Uppercase labels (a symbol's kind), one-glyph marks |
| `--size-caption` | 13 px | Captions, chips, badges, counts, key caps, category labels: the smallest text |
| `--size-small` | 14 px | Secondary: buttons, menu items, paths, code, the status bar |
| `--size-body` | 15 px | Rows, nav, tabs, body text, editors |
| `--size-title` | 17 px | Titles: a page's, a dialog's, a symbol's name in its panel |

Titles are 17 px, not 18: at 18 px a symbol's long name wrapped mid-word in its panel
(Bitwarden, V32). The graph keeps V32's 11/12/13/14/16 (decision 438): `.react-flow` declares them
again in `ui/base.css`, so a node's estimated width (`flow.ts`, 9.4 px a character), a frame's
name band (10 px a character) and every layout stay as they were; the graph zooms. The terminal
takes a number (`terminal.ts`'s `TERMINAL_FONT_SIZE`, 15). The map's project names are
`calc(2 * var(--size-body))`, on the graph's scale.

## The page frame (V72; on `:root`, both themes)

One value for both themes, in `ui/base.css` beside the type scale. Every page's CSS takes its
spacing from these; `e2e/page-frame.spec.ts` measures the result on every page.

| Token | Value | What it sets |
|---|---|---|
| `--page-pad` | 16 px | The main area's left, right and bottom edges to the cards, and the head's padding |
| `--page-gap` | 16 px | Between two cards; a `Resizer` with `gutter` is this gap |
| `--page-head` | 44 px | The head's two lines: the title (22 px) and the line under it (20 px) |
| `--card-pad` | 16 px | A card's edge to its words, in its head and its body; a dialog's and a terminal's too |
| `--card-head` | 48 px | A card's head, its hairline included |
| `--field-label-gap` | 8 px | A label to its field |
| `--field-gap` | 20 px | A field to the next label; a form's last field to its buttons |

## Shape, type, size (both themes)

| | Value |
|---|---|
| Radius: chip, key cap, checkbox | 4 px |
| Radius: button, input, select, row, tooltip, menu item | 8 px |
| Radius: dialog, popover, workspace card, a page's panel card, segmented track, file box | 10 px |
| Radius: menu | 11 px |
| Radius: a form's card, Waiting for you's card, project frame | 14 px |
| Radius: badge, count, dot, switch, progress | 9999 px (or 50 %) |
| Body | 15 px / 1.45, letter-spacing 0 (V37), antialiased |
| Nav row, tab | 15 px, weight 500 |
| Button label, secondary, paths, code, menu items, status bar | 14 px (menu items weight 450) |
| Captions, chips, badges, section counts, key caps | 13 px, weight 500 |
| Uppercase labels (a symbol's kind), one-glyph marks | 12 px |
| Category label (menus, settings groups) | 13 px, weight 600, `--muted` |
| Section header (sidenav "Workspaces") | 15 px, weight 600, `--text` |
| Page, dialog or panel title | 17 px, weight 600 |
| Terminal | Geist Mono 15 px |
| Page head | 76 px: 16 px, two lines (44 px), 16 px, on the page's ground (V72; 52 px since V61, 44 before) |
| Line tabs | 40 px in a 48 px card head, the picked one's line 3 px on the hairline |
| Status bar | 24 px, 14 px text |
| Rows | 28 px dense, 36 px nav |
| Buttons | 32 px in toolbars and forms, 28 in a sidenav card, 24 px in rows |
| Icons | 16 px; 18 px in the sidenav's pages; 14 px in menus and dense rows; 12 px in chips |
| Sidenav | 300 px at first (V79; 264 from V61, 240 before); the mark 32 px in a 52 px brand row |
| Cards' margins and gutter | 16 px from the main area's edges and between cards (V72; 8, 16 or 24 px before) |
| Motion | colours 150 ms; menus fade in 150 ms, dialogs 200 ms, by opacity only |

Letter-spacing is 0 everywhere but uppercase labels (V37). At 1× on Linux Chromium puts glyphs on
whole pixels: V29b's 0.01em on the chrome (0.13–0.14 px a letter) added up into uneven gaps ("n o
commits"), and fractional tracking on titles (−0.01em) and the nav (−0.025em) did the same. Form
controls take `letter-spacing: inherit` (the browser gives them `normal`, which `font: inherit` does
not reset). The graph's node widths are estimated from characters (`nodeWidth`, 9.4 px a character):
measure labels cut short (viewer-check) before tracking anything.
