# Tokens

Orca's roles (`main.css`, shadcn names) mapped onto CPR's tokens (`packages/viewer/src/styles.css`).
Values are Orca's where they pass CPR's contrast tests (`test/tokens.test.ts`); where they do not,
the nearest neutral that does, marked †. Ratios: the lowest over the backgrounds the test checks,
from `palette-check.mjs` (WCAG 2).

## Surfaces, text, lines (tested; `#rrggbb`)

| CPR token | Role | Orca | Dark | Light | Lowest ratio dark / light |
|---|---|---|---|---|---|
| `--bg` | Canvas: graph, History's rows, page content | `background` | `#0a0a0a` | `#ffffff` | — |
| `--side` | Sidenav, toolbars, status bar | `sidebar`, titlebar = `card` | `#171717` | `#fafafa` | — |
| `--panel` | Panels beside the canvas, file boxes, cards | `card` | `#171717` | `#fafafa` | — |
| `--raised` | Chips, counts, segmented track, pressed toggle | `secondary`/`muted` | `#262626` | `#f0f0f0` † | — |
| `--line` | Region hairlines | `border` (7 % white) | `#2a2a2a` † | `#e5e5e5` | 1.25 / 1.21 (≥ 1.2) |
| `--edge` | A text field's or checkbox's edge | `input` (15 % white, 1.5:1) | `#737373` † | `#8a8a8a` † | 3.78 / 3.31 (≥ 3) |
| `--text` | Text | `foreground` | `#fafafa` | `#0a0a0a` | 14.50 / 17.37 |
| `--muted` | Secondary text, idle nav, placeholders | `muted-foreground` | `#a1a1a1` | `#666666` † | 5.86 / 5.04 (≥ 4.5) |
| `--faint` | Idle icons, captions on hover rows | 30–40 % foreground | `#7c7c7c` † | `#8a8a8a` † | 3.63 / 3.03 (≥ 3) |
| `--focus` | Focus ring | `ring` (`#737373` at 50 %) | `#a1a1a1` † | `#737373` | 5.86 / 4.16 (≥ 3) |

Orca's light `muted-foreground` `#737373` is 4.16:1 on `#f0f0f0`, under CPR's 4.5: hence `#666666`.
Orca's light `accent` `#f5f5f5` is 1.09:1 on white and its style guide warns the cursor vanishes:
hence `--raised` `#f0f0f0` and the mixes below for hover and selection.

## States (tested, ≥ 3:1 on the four backgrounds)

Diff kinds take Orca's git decorations (VS Code's palette); severities its status colours.

| CPR token | Orca | Dark | Light | Lowest dark / light |
|---|---|---|---|---|
| `--added` | `git-decoration-added` | `#81b88b` | `#587c0c` | 6.60 / 4.28 |
| `--removed` | `git-decoration-deleted` | `#c74e39` | `#ad0707` | 3.30 / 6.56 |
| `--modified` | `git-decoration-modified` | `#e2c08d` | `#895503` | 8.76 / 5.48 |
| `--moved` | `callout-note` (renamed is green in Orca, too close to added) | `#4493f8` | `#0969da` | 4.88 / 4.56 |
| `--context` | `git-decoration-ignored` | `#7c7c7c` † | `#8a8a8a` † | 3.63 / 3.03 |
| `--error` | `destructive` | `#ff6568` | `#e40014` | 5.27 / 4.28 |
| `--warning` | `status-warning` | `#eab308` | `#9a6700` † | 7.89 / 4.27 |
| `--info` | `callout-note` | `#4493f8` | `#0969da` | 4.88 / 4.56 |

History's lanes, dark: Orca's five `git-graph-lane-*` and one more, ≥ 3:1 on `--bg` and `--raised`:
`--lane-1 #b66dff`, `--lane-2 #40b0a6`, `--lane-3 #ffb000`, `--lane-4 #dc267f`, `--lane-5 #ce9178`,
`--lane-6 #8ccf3e` (lowest 3.33, `--lane-4` on `--raised`). Light: keep CPR's (`#8250df #0a7f6f
#bc4c00 #bf3989 #4d7a00 #9a6700`): Orca's light lanes include `#ffb000` and `#40b0a6`, under 3:1
on white.

## New tokens (not in the contrast test; may be translucent)

Add each to the dark block and to the light block, and to the system-light block (the test checks
that light and system-light are equal and that both themes have the same names).

```css
/* dark */
--hover: color-mix(in srgb, var(--text) 8%, transparent);        /* Orca nav hover: foreground/8 */
--selected: color-mix(in srgb, var(--text) 10%, transparent);    /* Orca active card */
--selected-line: color-mix(in srgb, var(--text) 18%, var(--line));
--primary: #e5e5e5;                                              /* the one affirmative action */
--primary-text: #171717;
--input-bg: rgb(255 255 255 / 4.5%);                             /* Orca: input/30 */
--shadow-lift: 0 1px 2px rgb(0 0 0 / 5%);                        /* shadow-xs */
--shadow-floating: 0 10px 24px rgb(0 0 0 / 18%);
--menu-bg: rgb(0 0 0 / 72%);
--menu-line: rgb(255 255 255 / 14%);
--menu-hover: rgb(255 255 255 / 14%);
--menu-shadow: 0 16px 34px rgb(0 0 0 / 40%), inset 0 1px 0 rgb(255 255 255 / 4%);
--dialog-bg: rgb(23 23 23 / 96%);
--dialog-shadow: 0 24px 72px rgb(0 0 0 / 55%), inset 0 1px 0 rgb(255 255 255 / 6%);
--overlay: rgb(0 0 0 / 55%);

/* light */
--hover: color-mix(in srgb, var(--text) 5%, transparent);
--selected: color-mix(in srgb, var(--text) 8%, transparent);
--selected-line: color-mix(in srgb, var(--text) 18%, var(--line));
--primary: #171717;
--primary-text: #fafafa;
--input-bg: transparent;
--shadow-lift: 0 1px 2px rgb(0 0 0 / 5%);
--shadow-floating: 0 10px 24px rgb(0 0 0 / 18%);
--menu-bg: rgb(255 255 255 / 82%);
--menu-line: rgb(0 0 0 / 14%);
--menu-hover: rgb(0 0 0 / 8%);
--menu-shadow: 0 12px 28px rgb(0 0 0 / 22%), inset 0 1px 0 rgb(255 255 255 / 14%);
--dialog-bg: rgb(255 255 255 / 96%);
--dialog-shadow: 0 20px 60px rgb(0 0 0 / 28%), inset 0 1px 0 rgb(255 255 255 / 8%);
--overlay: rgb(0 0 0 / 55%);
```

A state tint is mixed from its state, never a new hex (Orca's `status-*-background/border`):
`color-mix(in srgb, var(--added) 10%, transparent)` for a fill, `25%` for its border. Diff lines:
16 % fill and 30 % gutter for added, 18 % and 32 % for removed (Orca's `diff-*-ground/gutter`).

## Shape, type, size (shared by both themes)

| | Value | Orca |
|---|---|---|
| Radius: chip, keycap, checkbox | 4 px | `rounded`, `rounded-[4px]` |
| Radius: button, input, row, tooltip, menu item | 8 px | `rounded-md` (0.8 × 10 px) |
| Radius: dialog, popover card, workspace card, segmented track | 10 px | `rounded-lg` |
| Radius: menu | 11 px | `rounded-[11px]` |
| Radius: card, file box, project frame | 14 px | `rounded-xl` |
| Radius: badge, count, dot, switch, progress | 9999 px | `rounded-full` |
| Body | 13 px / 1.45, letter-spacing 0.01em, antialiased | Orca body 14 px; 13 px for sidebar items and dense rows |
| Nav row, button label, tab | 13 px, weight 500, letter-spacing −0.025em | `text-[13px] font-medium tracking-tight` |
| Secondary, paths, menu items, status bar | 12 px (menu items weight 450, line 17 px) | `text-xs`, `text-[12px] font-[450]` |
| Captions, chips, section counts | 11 px, weight 500 | `text-2xs` |
| Category label (menus, settings groups) | 11 px, weight 600, uppercase, 0.05em, `--muted` | style guide |
| Section header (sidenav "Workspaces") | 12 px, weight 600, `--muted` | `text-xs font-semibold text-muted-foreground/80` |
| Page or dialog title | 14–16 px, weight 600 | card title `text-sm`, dialog title `text-lg` (18 px), `font-semibold` |
| Toolbar / page head | 36 px high (V29b made them 44) | `.titlebar` 36 px, tab strip 32 px |
| Status bar | 24 px, 12 px text | `h-6 text-xs` |
| Rows | 28 px dense, 32 px nav | `h-7`; nav `py-1.5` |
| Buttons | 32 px default, 28 px in toolbars, 24 px in rows | `sm` 32, `xs` 24 |
| Icons | 16 px; 14 px in menus and dense rows; 12 px in chips | `size-4`, `size-3.5`, `size-3` |
| Sidenav | 240 px | `.sidebar` 240 px |
| Motion | colours 150 ms `cubic-bezier(0.4, 0, 0.2, 1)`; menus 150 ms fade + scale 0.98; dialogs 200 ms fade + scale 0.95 | Tailwind defaults, `tw-animate-css` |

Letter-spacing widens text: CPR's node widths are estimated from characters (`nodeWidth`, 9.4 px a
character, with slack). Scope `0.01em` to the chrome (`body`) and set `letter-spacing: 0` on
`.react-flow`, or measure labels cut short (viewer-check) before keeping it on nodes.
