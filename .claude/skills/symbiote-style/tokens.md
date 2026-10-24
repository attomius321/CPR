# Tokens

Symbiote's tokens (`packages/viewer/src/ui/base.css`), their roles and values in both themes: the
koi's colours since V42. Ratios: the lowest over the backgrounds `test/tokens.test.ts` checks
(WCAG 2), from `palette-check.mjs`.

## Where the colours come from (V42)

Sampled from the intro's koi (`packages/viewer/src/intro/*.webp`, the app's icon): the tile's
water — its centre `#05080f`, its body `#081828`, its lit rim `#334781`; the black koi's glow
`#3060b8`–`#4c82d2`; the white koi's halo `#a8c0e8`, shade `#c8d1e1` and body `#e8e8f8`. The
chrome is the water, the text the white koi, the primary and the accent the blue light. A new
colour starts from these, not from a neutral grey.

## Surfaces, text, lines (tested; `#rrggbb`)

| Token | Role | Dark | Light | Lowest ratio dark / light |
|---|---|---|---|---|
| `--bg` | Canvas: graph, History's rows, page content | `#05080f` | `#ffffff` | — |
| `--side` | Sidenav, toolbars, status bar | `#0f1626` | `#f6f8fc` | 1.11 over `--bg` (V31's step) |
| `--panel` | Panels beside the canvas, file boxes, cards | `#0f1626` | `#f6f8fc` | — |
| `--raised` | Chips, counts, segmented track | `#1c2539` | `#e9eef7` | — |
| `--line` | Region hairlines | `#232d43` | `#dce3ef` | 1.31 / 1.21 (≥ 1.2) |
| `--edge` | A field's edge on hover; a checkbox's edge | `#5f6c8c` | `#7f8aa3` | 3.45 / 3.26 (≥ 3) |
| `--text` | Text | `#eaeef7` | `#0b1220` | 13.16 / 16.08 |
| `--muted` | Secondary text, idle nav, placeholders | `#9aa5be` | `#56627a` | 6.19 / 5.27 (≥ 4.5) |
| `--accent` | The secondary colour: current page, selection, links on hover | `#7a9ee8` | `#2f62cc` | 5.74 / 4.82 (≥ 4.5) |
| `--faint` | Idle icons, captions on hover rows | `#717d99` | `#78839c` | 3.71 / 3.26 (≥ 3) |
| `--focus` | Focus ring (the accent) | `#7a9ee8` | `#2f62cc` | 5.74 / 4.82 (≥ 3) |

A light blue-grey near white (`#f5f7fb`) is about 1.07:1 on white: a hover or a cursor drawn
with it vanishes. Hence `--raised` `#e9eef7` and the mixes below for hover and selection.

## The primary and the accent (V42, decisions 279–280)

| Token | Dark | Light | |
|---|---|---|---|
| `--primary` | `#3c6fd6` | `#2f62cc` | The one affirmative action; checked boxes, the stepper's thumb |
| `--primary-text` | `#ffffff` | `#ffffff` | 4.73 / 5.62 on the primary (≥ 4.5, tested) |
| `--primary-hover` | `#3466cc` | `#2856b8` | A step darker: any lighter blue takes white under 4.5:1 (`#4375dc` is 4.36) |
| `--accent` | `#7a9ee8` | `#2f62cc` | Its roles only (a guard in `tokens.test.ts`): `aria-current`, selected, checked, focus, a link under the pointer, `::selection` |

## States (tested, ≥ 3:1 on the four backgrounds)

| Token | Dark | Light | Lowest dark / light |
|---|---|---|---|
| `--added` | `#81b88b` | `#587c0c` | 6.67 / 4.19 |
| `--removed` | `#c74e39` | `#ad0707` | 3.33 / 6.42 |
| `--modified` | `#e2c08d` | `#895503` | 8.85 / 5.36 |
| `--moved` | `#3fc5d6` | `#0a7d8c` | 7.41 / 4.17 |
| `--context` | `#717d99` | `#78839c` | 3.71 / 3.26 |
| `--error` | `#ff6568` | `#e40014` | 5.33 / 4.19 |
| `--warning` | `#eab308` | `#9a6700` | 7.97 / 4.18 |
| `--info` | `#3fc5d6` | `#0a7d8c` | 7.41 / 4.17 |

Moved and info are cyan since V42 (decision 281): the koi's blue is 6° of hue from V31's
`#4493f8`, and a moved node would have read as selected. What shares their hue goes with them: an
agent working, "since", History's current lane.

History's lanes, ≥ 3:1 on `--bg` and `--raised`. Dark: `--lane-1 #b66dff`, `--lane-2 #40b0a6`,
`--lane-3 #ffb000`, `--lane-4 #dc267f`, `--lane-5 #ce9178`, `--lane-6 #8ccf3e` (lowest 3.37,
`--lane-4` on `--raised`). Light: `#8250df #0a7f6f #bc4c00 #bf3989 #4d7a00 #9a6700`.

## Other tokens (not in the contrast test; may be translucent)

Each is in the dark block, the light block and the system-light block (the test checks that light
and system-light are equal and that both themes have the same names). The translucent ones are
tinted with the white koi's `rgb(170 195 240)` in dark and the navy text's `rgb(11 18 32)` in
light, not pure white or black.

```css
/* dark */
--hover: color-mix(in srgb, var(--text) 5%, transparent);        /* a wash of the text */
--selected: color-mix(in srgb, var(--accent) 16%, transparent);   /* a wash of the accent (V42) */
--selected-line: color-mix(in srgb, var(--accent) 40%, var(--line));
--input-bg: rgb(170 195 240 / 4.5%);
--field-line: color-mix(in srgb, var(--text) 15%, transparent);  /* a field at rest, ~1.5:1 (decision 246) */
--ring: color-mix(in srgb, var(--focus) 30%, transparent);       /* a focused field's 3 px ring */
--lifted: rgb(170 195 240 / 9%);                                 /* the choice in a segmented control */
--shadow-lift: 0 1px 2px rgb(0 0 0 / 20%);
--shadow-floating: 0 12px 28px rgb(1 4 10 / 40%);
--primary-shine: inset 0 1px 0 rgb(255 255 255 / 16%);           /* the primary's lit top edge */
--menu-bg: rgb(8 12 22 / 78%);
--menu-line: rgb(170 195 240 / 14%);
--menu-hover: rgb(170 195 240 / 13%);
--menu-shadow: 0 16px 34px rgb(1 4 10 / 50%), inset 0 1px 0 rgb(170 195 240 / 6%);
--dialog-bg: rgb(15 22 38 / 96%);
--dialog-shadow: 0 24px 72px rgb(1 4 10 / 60%), inset 0 1px 0 rgb(170 195 240 / 8%);
--overlay: rgb(2 5 12 / 62%);
--chevron: url("data:image/svg+xml,…stroke='%239aa5be'…");      /* a select's arrow, in --muted */
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
--shadow-lift: 0 1px 2px rgb(11 18 32 / 6%);
--shadow-floating: 0 10px 24px rgb(11 18 32 / 16%);
--primary-shine: inset 0 1px 0 rgb(255 255 255 / 18%);
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
(`workspaces/terminal.ts`, `#02040a`, the koi's deepest water, and `AgentTerminal.css`); the
app's window background and title bar (`packages/desktop/src/frame.ts`, `test/frame.test.ts`);
the app's start page (`packages/desktop/start/start.css`, its own copy of the tokens).

## Type scale (V32; on `:root`, both themes)

One step above V29b's dense 13 px, which was too small to read. Every font size in the stylesheet
is one of these (`test/tokens.test.ts`), a multiple of one (`calc`), `inherit` or an `em`.

| Token | Value | Role |
|---|---|---|
| `--size-caps` | 11 px | Uppercase labels (a symbol's kind), one-glyph marks |
| `--size-caption` | 12 px | Captions, chips, badges, counts, key caps, category labels: the smallest text |
| `--size-small` | 13 px | Secondary: buttons, menu items, paths, code, the status bar |
| `--size-body` | 14 px | Rows, nav, tabs, body text, editors |
| `--size-title` | 16 px | Titles: a page's, a dialog's, a symbol's name in its panel, a frame's name |

Titles stay at 16 px: at 18 px a symbol's long name wrapped mid-word in its panel (Bitwarden), and
a frame's name outgrew the band `flow.ts` estimates at 10 px a character. The terminal takes a
number (`AgentTerminal.tsx`'s `FONT_SIZE`, 14). The map's project names are
`calc(2 * var(--size-body))`.

## Shape, type, size (both themes)

| | Value |
|---|---|
| Radius: chip, key cap, checkbox | 4 px |
| Radius: button, input, select, row, tooltip, menu item | 8 px |
| Radius: dialog, popover, workspace card, segmented track, file box | 10 px |
| Radius: menu | 11 px |
| Radius: card, project frame | 14 px |
| Radius: badge, count, dot, switch, progress | 9999 px (or 50 %) |
| Body | 14 px / 1.45, letter-spacing 0 (V37), antialiased |
| Nav row, tab | 14 px, weight 500 |
| Button label, secondary, paths, code, menu items, status bar | 13 px (menu items weight 450, line 17 px) |
| Captions, chips, badges, section counts, key caps | 12 px, weight 500 |
| Uppercase labels (a symbol's kind), one-glyph marks | 11 px |
| Category label (menus, settings groups) | 12 px, weight 600, `--muted` |
| Section header (sidenav "Workspaces") | 13 px, weight 600, `--muted` |
| Page, dialog or panel title | 16 px, weight 600 |
| Terminal | Geist Mono 14 px |
| Toolbar / page head | 44 px high (decision 213) |
| Status bar | 24 px, 13 px text |
| Rows | 28 px dense, 32 px nav |
| Buttons | 28 px in toolbars and forms, 24 px in rows |
| Icons | 16 px; 14 px in menus and dense rows; 12 px in chips |
| Sidenav | 240 px |
| Motion | colours 150 ms; menus fade in 150 ms, dialogs 200 ms, by opacity only |

Letter-spacing is 0 everywhere but uppercase labels (V37). At 1× on Linux Chromium puts glyphs on
whole pixels: V29b's 0.01em on the chrome (0.13–0.14 px a letter) added up into uneven gaps ("n o
commits"), and fractional tracking on titles (−0.01em) and the nav (−0.025em) did the same. Form
controls take `letter-spacing: inherit` (the browser gives them `normal`, which `font: inherit` does
not reset). The graph's node widths are estimated from characters (`nodeWidth`, 9.4 px a character):
measure labels cut short (viewer-check) before tracking anything.
