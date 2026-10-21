# Tokens

CPR's tokens (`packages/viewer/src/styles.css`), their roles and values in both themes. Ratios:
the lowest over the backgrounds `test/tokens.test.ts` checks (WCAG 2), from `palette-check.mjs`.

## Surfaces, text, lines (tested; `#rrggbb`)

| Token | Role | Dark | Light | Lowest ratio dark / light |
|---|---|---|---|---|
| `--bg` | Canvas: graph, History's rows, page content | `#0a0a0a` | `#ffffff` | — |
| `--side` | Sidenav, toolbars, status bar | `#171717` | `#fafafa` | — |
| `--panel` | Panels beside the canvas, file boxes, cards | `#171717` | `#fafafa` | — |
| `--raised` | Chips, counts, segmented track | `#262626` | `#f0f0f0` | — |
| `--line` | Region hairlines | `#2a2a2a` | `#e5e5e5` | 1.25 / 1.21 (≥ 1.2) |
| `--edge` | A text field's, select's or checkbox's edge | `#737373` | `#8a8a8a` | 3.78 / 3.31 (≥ 3) |
| `--text` | Text | `#fafafa` | `#0a0a0a` | 14.50 / 17.37 |
| `--muted` | Secondary text, idle nav, placeholders | `#a1a1a1` | `#666666` | 5.86 / 5.04 (≥ 4.5) |
| `--faint` | Idle icons, captions on hover rows | `#7c7c7c` | `#8a8a8a` | 3.63 / 3.03 (≥ 3) |
| `--focus` | Focus ring | `#a1a1a1` | `#737373` | 5.86 / 4.16 (≥ 3) |

A light grey near white (`#f5f5f5`) is 1.09:1 on white: a hover or a cursor drawn with it
vanishes. Hence `--raised` `#f0f0f0` and the mixes below for hover and selection.

## States (tested, ≥ 3:1 on the four backgrounds)

| Token | Dark | Light | Lowest dark / light |
|---|---|---|---|
| `--added` | `#81b88b` | `#587c0c` | 6.60 / 4.28 |
| `--removed` | `#c74e39` | `#ad0707` | 3.30 / 6.56 |
| `--modified` | `#e2c08d` | `#895503` | 8.76 / 5.48 |
| `--moved` | `#4493f8` | `#0969da` | 4.88 / 4.56 |
| `--context` | `#7c7c7c` | `#8a8a8a` | 3.63 / 3.03 |
| `--error` | `#ff6568` | `#e40014` | 5.27 / 4.28 |
| `--warning` | `#eab308` | `#9a6700` | 7.89 / 4.27 |
| `--info` | `#4493f8` | `#0969da` | 4.88 / 4.56 |

History's lanes, ≥ 3:1 on `--bg` and `--raised`. Dark: `--lane-1 #b66dff`, `--lane-2 #40b0a6`,
`--lane-3 #ffb000`, `--lane-4 #dc267f`, `--lane-5 #ce9178`, `--lane-6 #8ccf3e` (lowest 3.33,
`--lane-4` on `--raised`). Light: `#8250df #0a7f6f #bc4c00 #bf3989 #4d7a00 #9a6700`.

## Other tokens (not in the contrast test; may be translucent)

Each is in the dark block, the light block and the system-light block (the test checks that light
and system-light are equal and that both themes have the same names).

```css
/* dark */
--hover: color-mix(in srgb, var(--text) 8%, transparent);
--selected: color-mix(in srgb, var(--text) 10%, transparent);
--selected-line: color-mix(in srgb, var(--text) 18%, var(--line));
--primary: #e5e5e5;                                              /* the one affirmative action */
--primary-text: #171717;
--input-bg: rgb(255 255 255 / 4.5%);
--lifted: rgb(255 255 255 / 7%);                                 /* the choice in a segmented control */
--shadow-lift: 0 1px 2px rgb(0 0 0 / 5%);
--shadow-floating: 0 10px 24px rgb(0 0 0 / 18%);
--menu-bg: rgb(0 0 0 / 72%);
--menu-line: rgb(255 255 255 / 14%);
--menu-hover: rgb(255 255 255 / 14%);
--menu-shadow: 0 16px 34px rgb(0 0 0 / 40%), inset 0 1px 0 rgb(255 255 255 / 4%);
--dialog-bg: rgb(23 23 23 / 96%);
--dialog-shadow: 0 24px 72px rgb(0 0 0 / 55%), inset 0 1px 0 rgb(255 255 255 / 6%);
--overlay: rgb(0 0 0 / 55%);
--chevron: url("data:image/svg+xml,…stroke='%23a1a1a1'…");      /* a select's arrow, in --muted */
--added-ground: color-mix(in srgb, var(--added) 16%, transparent);
--added-gutter: color-mix(in srgb, var(--added) 30%, transparent);
--removed-ground: color-mix(in srgb, var(--removed) 18%, transparent);
--removed-gutter: color-mix(in srgb, var(--removed) 32%, transparent);

/* light */
--hover: color-mix(in srgb, var(--text) 5%, transparent);
--selected: color-mix(in srgb, var(--text) 8%, transparent);
--selected-line: color-mix(in srgb, var(--text) 18%, var(--line));
--primary: #171717;
--primary-text: #fafafa;
--input-bg: transparent;
--lifted: #ffffff;
--shadow-lift: 0 1px 2px rgb(0 0 0 / 5%);
--shadow-floating: 0 10px 24px rgb(0 0 0 / 18%);
--menu-bg: rgb(255 255 255 / 82%);
--menu-line: rgb(0 0 0 / 14%);
--menu-hover: rgb(0 0 0 / 8%);
--menu-shadow: 0 12px 28px rgb(0 0 0 / 22%), inset 0 1px 0 rgb(255 255 255 / 14%);
--dialog-bg: rgb(255 255 255 / 96%);
--dialog-shadow: 0 20px 60px rgb(0 0 0 / 28%), inset 0 1px 0 rgb(255 255 255 / 8%);
--overlay: rgb(0 0 0 / 55%);
--chevron: url("data:image/svg+xml,…stroke='%23666666'…");
--added-ground: color-mix(in srgb, var(--added) 13%, transparent);
--added-gutter: color-mix(in srgb, var(--added) 26%, transparent);
--removed-ground: color-mix(in srgb, var(--removed) 11%, transparent);
--removed-gutter: color-mix(in srgb, var(--removed) 22%, transparent);
```

A state tint is mixed from its state, never a new hex: `color-mix(in srgb, var(--added) 10%,
transparent)` for a fill, `25%` for its edge.

## Shape, type, size (both themes)

| | Value |
|---|---|
| Radius: chip, key cap, checkbox | 4 px |
| Radius: button, input, select, row, tooltip, menu item | 8 px |
| Radius: dialog, popover, workspace card, segmented track, file box | 10 px |
| Radius: menu | 11 px |
| Radius: card, project frame | 14 px |
| Radius: badge, count, dot, switch, progress | 9999 px (or 50 %) |
| Body | 13 px / 1.45, letter-spacing 0.01em, antialiased |
| Nav row, button label, tab | 13 px, weight 500 (nav letter-spacing −0.025em) |
| Secondary, paths, menu items, status bar | 12 px (menu items weight 450, line 17 px) |
| Captions, chips, section counts | 11 px, weight 500 |
| Category label (menus, settings groups) | 11 px, weight 600, `--muted` |
| Section header (sidenav "Workspaces") | 12 px, weight 600, `--muted` |
| Page or dialog title | 14–16 px, weight 600 |
| Toolbar / page head | 44 px high (decision 213) |
| Status bar | 24 px, 12 px text |
| Rows | 28 px dense, 32 px nav |
| Buttons | 28 px in toolbars and forms, 24 px in rows |
| Icons | 16 px; 14 px in menus and dense rows; 12 px in chips |
| Sidenav | 240 px |
| Motion | colours 150 ms; menus fade in 150 ms, dialogs 200 ms, by opacity only |

Letter-spacing widens text: CPR's node widths are estimated from characters (`nodeWidth`, 9.4 px a
character, with slack). `0.01em` is on the chrome (`body`) and `letter-spacing: 0` on
`.react-flow`; measure labels cut short (viewer-check) before changing either.
