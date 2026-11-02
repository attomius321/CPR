# Tokens

Symbiote's tokens (`packages/viewer/src/ui/base.css`), their roles and values in both themes and
both modes: the redesign's kits since V88 (the person's mockup V61–V87, the koi's colours
V42–V60). Ratios: the lowest over the backgrounds `test/tokens.test.ts` checks (WCAG 2).

## Where the colours come from (V88)

The redesign's two kits, on `main`: `spikes/normal-redesign` (normal mode: cool ink with a breath
of blue, the S's violet) and `spikes/hive-redesign` (Hive Control: warm neutral ink, crimson as
Hive's identity only). Their READMEs hold the direction, their proofs (`proofs/06-kit.webp`,
`proofs/07-kit.webp`) the token and component sheets. The violet is the S's
(`scripts/desktop/logo.png`). A new colour starts from these.

## Surfaces, text, lines (tested; `#rrggbb`)

Cards are `--panel` on the page's `--bg`; the chrome (sidenav, status bar, title bar) is `--side`.
In light the ground is grey and the cards white (V88; the page was white and the cards grey).
Code, a terminal's page, the graph's canvas stay `--bg` inside a card.

| Token | Role | Dark | Light | Lowest ratio dark / light |
|---|---|---|---|---|
| `--bg` | The page's ground, the graph's canvas, code and pre inside a card | `#090a0d` | `#f3f4f7` | — |
| `--side` | Sidenav, status bar, title bar | `#0d0f13` | `#f9fafc` | — |
| `--panel` | Cards and their heads | `#0e1015` | `#ffffff` | — |
| `--raised` | Chips, counts, a secondary button, the page head's tile | `#171a21` | `#eef0f5` | — |
| `--line` | Region hairlines, a card's edge | `#23262e` | `#dadee7` | 1.26 / 1.23 (≥ 1.2; the kit's light `#e0e3eb` is 1.17 on the ground) |
| `--line-2` | A secondary button's edge, the stage track's links | `#2e323b` | `#d0d4de` | — |
| `--edge` | A field's edge on hover; a checkbox's edge | `#5c6373` | `#7f8aa3` | 3.16 / 3.15 on bg, side, panel (≥ 3) |
| `--text` | Text | `#eef0f5` | `#0f1320` | 15.27 / 16.24 |
| `--muted` | Secondary text, idle nav and its icons, placeholders | `#a3aabb` | `#525c71` | 7.48 / 5.89 (≥ 4.5) |
| `--accent` | Current page, selection, links on hover, the page head's icon | `#9886ff` | `#5b3fd9` | 5.96 / 5.83 (≥ 4.5) |
| `--faint` | Marks only: icons, separators, disabled (V87) | `#767d8d` | `#747e95` | 4.22 / 3.57 (≥ 3) |
| `--focus` | Focus ring (the accent) | `#9886ff` | `#5b3fd9` | 5.96 / 5.83 (≥ 3) |

## The primary and the accent (V61; V88, decision 819)

| Token | Dark | Light | |
|---|---|---|---|
| `--primary` | `#7c68fc` | `#5b3fd9` | One constructive action a page; checked boxes, the picked tab's line |
| `--primary-text` | `#0b0a1a` | `#ffffff` | 4.89 / 6.65 on the primary (≥ 4.5, tested). White on the dark violet is 4.01 |
| `--primary-hover` | `#8a78fd` | `#4e33c6` | Dark: a step lighter, dark words gain (5.77); light: a step darker |
| `--hive-primary` / `--hive-primary-hover` | `#c8102e` / `#b00d28` | the same | Turn on Hive (`.button.hive`) in normal mode: white words 5.88 / 7.16 |
| `--accent` | `#9886ff` | `#5b3fd9` | Its roles only (a guard in `tokens.test.ts`): `aria-current`, selected, checked, focus, a link under the pointer, `::selection`, the page head's icon |
| `--tab-picked` | transparent | transparent | A picked line tab: no ground since V88, its line says it |

## States (tested, ≥ 3:1 on the four backgrounds; V88, decision 813)

One set in both modes, as CI reads them; always an icon and a word with the colour
(`StatusLabel`). `--you` and `--hive-text` are read as text (≥ 4.5).

| Token | Means | Dark | Light | Lowest dark / light |
|---|---|---|---|---|
| `--run` | In progress, the agent's turn: working, merging, checking, Hive at work | `#f2b33d` | `#8f5b00` | 9.36 / 5.03 |
| `--you` | The person's turn: waiting for you, to review, a plan to answer, asked | `#9886ff` | `#5b3fd9` | 5.96 / 5.83 |
| `--ok` | Passed, landed, merged, done | `#3fcf8e` | `#137a4a` | 8.73 / 4.71 |
| `--error` | Failed, stopped, a real error | `#ff6166` | `#cf2330` | 5.93 / 4.68 |
| `--warning` | A real warning only: a check's, usage near its limit, advice, stale, conflicts | `#f2b33d` | `#8f5b00` | 9.36 / 5.03 |
| `--info` | Paused, information | `#5cc8d8` | `#0a7383` | 8.88 / 4.86 |
| `--hive` | Hive's identity (the mark, the Hive group's icon, its Settings tile), never a state | `#e5243f` | `#c8102e` | 3.86 / 5.16 |
| `--hive-text` | Hive's words and marks on a page (its On label, its tile's icon) | `#ff8090` | `#b30f2a` | 7.25 / 6.10 |

Guards in `tokens.test.ts`: `--you` only in rules whose selector names the person's turn (wait,
ready, review, ask, respond, plan…), `--warning` only where it names a warning. `--you` is the
accent's value: what waits for you has the colour of the button that answers it (normal kit's
decision); it is a state token of its own so the accent's guard still holds.

A change's kinds keep VS Code's colours (V42) and are not states: `--added #81b88b / #587c0c`,
`--removed #c74e39 / #ad0707`, `--modified #e2c08d / #895503`, `--moved #3fc5d6 / #0a7d8c`,
`--context` (`--faint`'s value). A state drawn with one of them before V88 (done in `--added`,
failed in `--removed`, working in `--moved`) takes `--ok`, `--error`, `--run`.

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
text's `rgb(15 19 32)` in light, not pure white or black.

```css
/* dark */
--hover: color-mix(in srgb, var(--text) 5%, transparent);        /* a wash of the text */
--selected: color-mix(in srgb, var(--accent) 14%, transparent);   /* a wash of the accent (V42) */
--selected-line: color-mix(in srgb, var(--accent) 40%, var(--line));
--input-bg: rgb(220 226 238 / 4%);
--field-line: color-mix(in srgb, var(--text) 15%, transparent);  /* a field at rest, ~1.5:1 (decision 246) */
--ring: color-mix(in srgb, var(--focus) 30%, transparent);       /* a focused field's 3 px ring */
--lifted: rgb(220 226 238 / 9%);                                 /* the choice in a segmented control */
--tab-picked: transparent;                                       /* a picked line tab: its line only (V88) */
--shadow-lift: 0 1px 2px rgb(0 0 0 / 30%);
--shadow-floating: 0 16px 40px rgb(0 0 0 / 50%);
--primary-shine: inset 0 1px 0 rgb(255 255 255 / 22%);           /* the primary's lit top edge */
--ground-arc: rgb(124 104 252 / 30%);                            /* the arcs: Start (V63), an analysis (V71) */
--menu-bg: rgb(13 15 19 / 82%);
--menu-line: rgb(220 226 238 / 12%);
--menu-hover: rgb(220 226 238 / 10%);
--menu-shadow: 0 16px 34px rgb(0 0 0 / 50%), inset 0 1px 0 rgb(220 226 238 / 6%);
--dialog-bg: rgb(13 15 19 / 96%);
--dialog-shadow: 0 24px 72px rgb(0 0 0 / 60%), inset 0 1px 0 rgb(220 226 238 / 8%);
--overlay: rgb(3 4 6 / 62%);
--chevron: url("data:image/svg+xml,…stroke='%23a3aabb'…");      /* a select's arrow, in --muted */
--added-ground: color-mix(in srgb, var(--added) 16%, transparent);
--added-gutter: color-mix(in srgb, var(--added) 30%, transparent);
--removed-ground: color-mix(in srgb, var(--removed) 18%, transparent);
--removed-gutter: color-mix(in srgb, var(--removed) 32%, transparent);

/* light */
--hover: color-mix(in srgb, var(--text) 5%, transparent);
--selected: color-mix(in srgb, var(--accent) 10%, transparent);
--selected-line: color-mix(in srgb, var(--accent) 35%, var(--line));
--input-bg: #ffffff;
--field-line: color-mix(in srgb, var(--text) 16%, transparent);
--ring: color-mix(in srgb, var(--focus) 25%, transparent);
--lifted: #ffffff;
--tab-picked: transparent;
--shadow-lift: 0 1px 2px rgb(15 19 32 / 6%);
--shadow-floating: 0 10px 24px rgb(15 19 32 / 16%);
--primary-shine: inset 0 1px 0 rgb(255 255 255 / 18%);
--ground-arc: rgb(91 63 217 / 16%);
--menu-bg: rgb(255 255 255 / 82%);
--menu-line: rgb(15 19 32 / 13%);
--menu-hover: rgb(15 19 32 / 7%);
--menu-shadow: 0 12px 28px rgb(15 19 32 / 20%), inset 0 1px 0 rgb(255 255 255 / 14%);
--dialog-bg: rgb(255 255 255 / 96%);
--dialog-shadow: 0 20px 60px rgb(15 19 32 / 26%), inset 0 1px 0 rgb(255 255 255 / 8%);
--overlay: rgb(15 19 32 / 45%);
--chevron: url("data:image/svg+xml,…stroke='%23525c71'…");
--added-ground: color-mix(in srgb, var(--added) 13%, transparent);
--added-gutter: color-mix(in srgb, var(--added) 26%, transparent);
--removed-ground: color-mix(in srgb, var(--removed) 11%, transparent);
--removed-gutter: color-mix(in srgb, var(--removed) 22%, transparent);
```

The test keeps the selection further from its ground than the hover on `--bg` and `--side`
(composited, by contrast), in both themes: hover 5 % of the text, selection 14 % (10 % light) of
the accent; in Hive a neutral wash of the text, 9 % (8 % light).

A state tint is mixed from its state, never a new hex: `color-mix(in srgb, var(--ok) 12%,
transparent)` for a fill, `28%` for its edge (the status label's).

## Hive mode (V82; V88, decisions 812, 814, 815)

While Hive mode is on (`data-hive="on"` on `<html>`, written by the server), Hive Control's warm
ink over each theme, no red in its surfaces (tested: red no more than 2 over green or blue in
every neutral). Three blocks after the themes in `ui/base.css`: dark Hive
(`:root[data-hive]:not([data-theme='light'])`, also the question's `.hive-ink`), light Hive and
its system-light copy (equal, tested; the same names as dark Hive's). The theme's dark block also
matches `.hive-ink`: the question needs the whole dark set, not only Hive's names. Change a
theme's surface or words and check Hive's still pass (`tokens.test.ts`, "Hive mode").

| Token | Hive dark | Hive light | Lowest dark / light |
|---|---|---|---|
| `--bg` / `--side` / `--panel` / `--raised` | `#09090b` / `#0e0e11` / `#0f0f12` / `#18181d` | `#f3f3f5` / `#f9f9fa` / `#ffffff` / `#f0f0f3` | — |
| `--line` / `--line-2` / `--edge` | `#24242b` / `#2f2f37` / `#64626c` | `#dcdce2` / `#d3d3da` / `#85838d` | 1.24, 3.19 / 1.23, 3.37 |
| `--text` / `--muted` / `--faint` | `#f3f2f5` / `#a6a4ae` / `#7b7983` | `#121216` / `#595762` / `#7c7a85` | 15.86, 7.20 / 16.43, 6.23 |
| `--accent`, `--focus` | `#ff8090` (`--hive-text`) | `#b30f2a` | 7.36 / 6.12 |
| `--primary` / `--primary-hover` | `#c8102e` / `#b00d28`, white words | the same | 5.88 / 7.16 |
| `--selected` | text 9 % | text 8 % | a neutral wash: crimson is not a surface |

Crimson is Hive's identity only (decision 814): the mark, the Hive group's icon, its Settings
tile, the On label, the picked tab's line, one constructive primary a page. In progress is amber,
failure red, never crimson. States, lanes, kinds of work and type are the theme's. Gone since V88
(decision 815; a guard in `tokens.test.ts`): `--hive-red`, `--hive-gloss`, `--hive-sheen`,
`--hive-streak`, `--hive-glow`, `--hive-comb-*`. The art's own colours (`.hive-art`) are in
`ui/hive.css`: it is always drawn on ink.

## Outside the tokens

Kept in step by hand, each with a comment pointing here: the terminal's theme
(`workspaces/terminal.ts`, `#050608`, a step under the canvas, its selection violet `#2c2757`;
`AgentTerminal.css`, its link hint `#090a0d` on `#e6e9ef`; `MergeLog.css`); the app's window
background and title bar (`packages/desktop/src/frame.ts`, `test/frame.test.ts`); the app's start
page (`packages/desktop/start/start.css`, its own copy of the tokens and sizes); the taskbar's
waiting dot (`packages/desktop/src/badge.ts`, `--you`'s violet since V88).

## Type scale (V32, V61, V87; on `:root`, both themes)

V29b's dense 13 px was too small to read; V32's 14 px still too small for the person's eyes (V61:
15 px). V85 took VS Code's 13 px and the person found it too small the next day on their 27-inch
2560 × 1440 screen at 100 % (a px is 0.233 mm there): V87 (decision 760) is their design B,
15 px body and nothing under 12 px (Windows' minimum). Every font size in the stylesheet is one of
these (`test/tokens.test.ts`), a multiple of one (`calc`), `inherit` or an `em`; every line height
is its size and a leading (`calc(var(--size-small) + 4px)`), never px, so Settings' text size
(below) moves the lines with the text.

| Token | Value | Role |
|---|---|---|
| `--size-caps` | 12 px | Uppercase labels (a symbol's kind), one-glyph marks |
| `--size-caption` | 13 px | Captions, chips, badges, counts, key caps, category labels |
| `--size-small` | 14 px | Secondary: buttons, menu items, paths, the status bar |
| `--size-body` | 15 px | Rows, nav, tabs, body text, editors |
| `--size-title` | 18 px | Titles: a page's, a dialog's, a symbol's name in its panel |
| `--size-code` | 14 px | Code: a diff's lines, a file, a commit's message in mono |

**Text size** (V87c, decision 763): Settings → Appearance moves the scale a step, the text only
(`:root[data-text-size]`, set before the first paint from `symbiote.viewer.text-size`; the app
keeps it). Compact is 12 / 12 / 13 / 14 / 17, code 14 (the person's design A); Large 13 / 14 / 15 /
16 / 19, code 15. 16 px is the largest text a 24 px row holds: a larger step is a density change.

The graph keeps V32's 11/12/13/14/16 (decision 438) at every text size: `.react-flow` declares them
again in `ui/base.css`, so a node's estimated width (`flow.ts`, 9.4 px a character), a frame's
name band (10 px a character) and every layout stay as they were; the graph zooms. The terminal
takes a number (`terminal.ts`'s `TERMINAL_FONT_SIZE`, 14; decision 762). The map's project names
are `calc(2 * var(--size-body))`, on the graph's scale.

## The page frame (V72, V85, V87; on `:root`, both themes)

One value for both themes, in `ui/base.css` beside the type scale. Every page's CSS takes its
spacing from these; `e2e/page-frame.spec.ts` measures the result on every page. V85 tightened them
to VS Code's density; V87 (decision 761) made rows and small controls 24 px, WCAG 2.2's target
size (2.5.8, checked on every page by `e2e/targets.spec.ts`), and the rest a step for 15 px text.

| Token | Value | What it sets |
|---|---|---|
| `--page-pad` | 12 px | The main area's left, right and bottom edges to the cards, and the head's padding |
| `--page-gap` | 8 px | Between two cards; a `Resizer` with `gutter` is this gap |
| `--page-head` | 40 px | The head's two lines: the title (22 px) and the line under it (18 px) |
| `--card-pad` | 12 px | A card's edge to its words, in its head and its body; a dialog's and a terminal's too |
| `--card-head` | 37 px | A card's head, its hairline included |
| `--field-label-gap` | 4 px | A label to its field |
| `--field-gap` | 14 px | A field to the next label; a form's last field to its buttons |
| `--height-row` | 24 px | A list's row (Git's too: `ROW_HEIGHT`), a small control, an icon button |
| `--height-control` | 28 px | Buttons, inputs, selects, a list's taller row |
| `--height-tall` | 30 px | A page's actions, a sidenav entry |
| `--height-tab` | 32 px | Tabs and kinds in a head, a tile |
| `--height-bar` | 36 px | A bar over a card |
| `--height-top` | 40 px | The sidenav's top, the Monitor's bar |

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
| Page, dialog or panel title | 18 px, weight 600 |
| Terminal | Geist Mono 14 px |
| Page head | 64 px: 12 px, two lines (40 px), 12 px, on the page's ground (V87; 60 in V85, 76 in V72) |
| Line tabs | 32 px in a 37 px card head, the picked one's line 3 px on the hairline |
| Status bar | 24 px, 14 px text |
| Rows | 24 px (WCAG 2.2's targets), 30 px nav |
| Buttons | 28 px in toolbars and forms, 24 px in rows and sidenav cards |
| Icons | 16 px; 18 px in the sidenav's pages; 14 px in menus and dense rows; 12 px in chips |
| Sidenav | 300 px at first (V79; 264 from V61, 240 before); the mark 32 px in a 52 px brand row |
| Cards' margins and gutter | 12 px from the main area's edges, 8 px between cards (V85; 16 in V72) |
| Motion | colours 150 ms; menus fade in 150 ms, dialogs 200 ms, by opacity only |

Letter-spacing is 0 everywhere but uppercase labels (V37). At 1× on Linux Chromium puts glyphs on
whole pixels: V29b's 0.01em on the chrome (0.13–0.14 px a letter) added up into uneven gaps ("n o
commits"), and fractional tracking on titles (−0.01em) and the nav (−0.025em) did the same. Form
controls take `letter-spacing: inherit` (the browser gives them `normal`, which `font: inherit` does
not reset). The graph's node widths are estimated from characters (`nodeWidth`, 9.4 px a character):
measure labels cut short (viewer-check) before tracking anything.
