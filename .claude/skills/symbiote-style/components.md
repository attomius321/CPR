# Components

Symbiote's controls as plain CSS on its tokens ([tokens.md](tokens.md)). Class names here are examples: Symbiote's class names are global (plain CSS, in
parts beside their components), so check a name is not taken before using it
(`grep -rn '^\.name' packages/viewer/src --include='*.css'`), and restyle the existing class
where one already plays the role.

## Base

Every text is sized from the type scale (`--size-*`, [tokens.md](tokens.md)), never a px value:
`test/tokens.test.ts` fails on one. Sizes below are the tokens' values.

```css
body {
  background: var(--bg);
  color: var(--text);
  font: var(--size-body)/1.45 var(--sans);
  letter-spacing: 0; /* fractional tracking rounds into uneven gaps at 1× on Linux (V37) */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* The browser gives controls `letter-spacing: normal`; `font: inherit` does not reset it. */
button, input, textarea, select {
  font: inherit;
  letter-spacing: inherit;
}

button:not(:disabled) {
  cursor: pointer;
}

/* Thin, neutral scrollbars. */
* {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--muted) 34%, transparent) transparent;
}
```

A theme switch flips every token at once; transitions then fade parts of the page at different
speeds. A class that sets every `transition: none !important` for one frame around the switch
avoids it: add it in `setTheme` (`src/shell/theme.ts`) if a transition shows.

## Buttons

The variants, in priority order: primary (the one affirmative action in a flow), secondary,
outline (standalone toolbar actions), ghost (icon buttons, row triggers, Cancel), link, danger.

```css
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font-weight: 500;
  white-space: nowrap;
  transition:
    background-color 150ms,
    color 150ms,
    border-color 150ms;
}
.btn .icon { width: 16px; height: 16px; }
.btn:disabled { opacity: 0.5; pointer-events: none; }

.btn-primary { background: var(--primary); box-shadow: var(--primary-shine); color: var(--primary-text); }
.btn-primary:hover { background: var(--primary-hover); }   /* darker: a lighter blue loses white's 4.5:1 */

.btn-secondary { background: var(--raised); }
.btn-secondary:hover { background: color-mix(in srgb, var(--raised) 80%, transparent); }

.btn-outline { border-color: var(--line); background: var(--input-bg); box-shadow: var(--shadow-lift); }
.btn-outline:hover { border-color: color-mix(in srgb, var(--muted) 35%, transparent); background: var(--hover); }

.btn-ghost { color: var(--muted); }
.btn-ghost:hover { background: var(--hover); color: var(--text); }

.btn-danger { background: color-mix(in srgb, var(--error) 60%, transparent); color: #fff; } /* dark; light: var(--error) */

.btn-sm { height: 28px; padding: 0 10px; gap: 4px; font-size: var(--size-small); }   /* in a 36 px toolbar */
.btn-xs { height: 24px; padding: 0 8px; gap: 4px; font-size: var(--size-small); }    /* in a 28 px row */
.btn-icon { width: 28px; height: 28px; padding: 0; }                     /* 24 px in rows */
```

- Cancel, Dismiss, Close and Discard are ghost: no colour, no keycap. Danger only loses data.
  Symbiote's class is `.button.ghost` (V37: they were text links beside a filled button).
- One primary per view. A Save that is disabled until a change stays primary, at 50 %.
- Match the button to its row: never a 32 px button in a 28 px row.

## Text fields

Decision 246 (V37): a quiet edge at rest, the 3:1 `--edge` on hover, the focus colour and a soft
ring on focus. The 3:1 edge on every field at rest, with a 2 px outline over it on focus, was what
made the fields look old. Every field has a visible label.

```css
.field {
  height: 32px;                   /* 28 px in a toolbar or beside 28 px buttons */
  padding: 0 10px;
  border: 1px solid var(--field-line);  /* ~1.5:1 */
  border-radius: 8px;
  background: var(--input-bg);
  box-shadow: var(--shadow-lift);
  transition: border-color 150ms, box-shadow 150ms;
}
.field:hover:not(:focus, :disabled) { border-color: var(--edge); }
.field:focus-visible { outline: none; border-color: var(--focus); box-shadow: 0 0 0 3px var(--ring); }
.field[aria-invalid='true'] { border-color: var(--error); }
textarea.field {
  height: auto;
  padding: 8px 10px;
  line-height: 1.45;
  field-sizing: content;          /* grows with its text: no grip */
  min-height: calc(3lh + 18px);   /* `field-sizing` ignores `rows`: give their height here */
  max-height: 50vh;
  resize: none;
}
```

Mono only for what is literal: a branch name or a prompt in a field is in the text's font.

A search *button* that opens a palette is not a text field: no border,
`background: color-mix(in srgb, var(--text) 5%, transparent)`, hover 8 %, icon in `--faint`,
keycaps shown on hover only.

Form anatomy: the label (14 px, 500) and a description (13 px,
`--muted`) 4 px apart, then the control 8 px below; metadata such as "561 of 8,000 characters"
below the control in 12 px `--muted`; sections 12 px apart.

## Checkbox, switch, toggle

Native checkboxes with `accent-color` look like the operating system's. Keep the `<input>` (its
role, label and the e2e selectors stay) and draw it:

```css
input[type='checkbox'] {
  appearance: none;
  display: inline-grid;
  place-content: center;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid var(--edge);
  border-radius: 4px;
  background: var(--input-bg);
  box-shadow: var(--shadow-lift);
}
input[type='checkbox']::after {
  content: '';
  width: 12px;
  height: 12px;
  background: var(--primary-text);
  /* lucide "check" (ISC) */
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E") center / contain no-repeat;
  transform: scale(0);
}
input[type='checkbox']:checked { border-color: var(--primary); background: var(--primary); }
input[type='checkbox']:checked::after { transform: scale(1); }
input[type='checkbox']:focus-visible { outline: none; box-shadow: 0 0 0 3px var(--ring); }
```

A view toggle in a toolbar (the diff's Focus, Context, Type references) reads better as a toggle
button: `aria-pressed`, 28 px, 8 px radius, `--muted` text; hover `--hover` and `--text`; pressed
`--raised` and `--text`. That changes its role: update the specs' selectors in the same commit.

A switch (an on/off setting): track 36 × 20 px, round, off `color-mix(in srgb, var(--muted) 30%,
transparent)` with a 1 px `--edge` border (Symbiote's 3:1 for a control's edge), on `var(--text)`;
thumb 14 px, `var(--bg)`, `--shadow-lift`, moved 16 px when on.

## Stepper (one of a few ordered levels)

An agent's effort (`EffortStepper.tsx`): a choice among a handful of ordered levels, dragged.
Keep the browser's `<input type="range">` (drag, arrows, Home/End, the slider role) with
`aria-valuetext` naming the level; draw the rail and its stops behind it, and the stops' words
under it, clickable. Neutral: no fill when the first stop is not "less" (an agent's own level).

```css
.effort-rail {                 /* behind the input: centred on the handle's line */
  position: absolute; top: 6px; left: 8px; right: 8px; height: 4px;
  border-radius: 9999px;
  background: color-mix(in srgb, var(--muted) 30%, transparent);
}
.effort-rail > span {          /* a dot per stop, at 100% * i / last */
  position: absolute; top: -1px; width: 6px; height: 6px; margin-left: -3px;
  border-radius: 9999px; background: var(--faint);
}
.effort-range { appearance: none; height: 16px; background: transparent; }
.effort-range::-webkit-slider-thumb {        /* and ::-moz-range-thumb */
  appearance: none; width: 16px; height: 16px; border-radius: 9999px;
  background: var(--primary);
  box-shadow: 0 0 0 1px var(--edge), var(--shadow-lift);
  cursor: grab;
}
.effort-range:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--focus);
}
.effort-stops > span {         /* 12 px --muted words; the current one --text, 500 */
  position: absolute; transform: translateX(-50%);
}
```

The handle's centre runs half its width in from either end: place the dots and words on that
line, and keep the first and last words inside the edges (`translateX(-8px)`,
`translateX(calc(8px - 100%))`). Under `.workspace-field input` (a text field's rule) the range
input needs a more specific selector to drop the border, padding and shadow.

## Rows and lists

One recipe for every list: the sidenav, the change list, branches, findings, menus' items.

```css
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 28px;          /* 32 px for the sidenav's pages */
  padding: 0 8px;
  border-radius: 8px;
  color: var(--muted);
  font-weight: 500;          /* nav; list rows 400 */
  transition: background-color 150ms, color 150ms;
}
.row .icon { color: var(--faint); stroke-width: 1.75; }          /* on lucide's 24-unit icons */
.row:hover { background: var(--hover); color: var(--text); }
.row[aria-current='page'],
.row.selected { background: var(--selected); color: var(--text); }
.row[aria-current='page'] .icon,
.row.selected .icon { color: var(--accent); stroke-width: 2.25; }  /* nav: 1.75 idle, 2.25 active */
.row.cursor { box-shadow: inset 0 0 0 1px var(--selected-line); }  /* j/k cursor, apart from selection */
```

- Selection and the current page are washes of the accent (V42); the current page's icon in
  `--accent`; the hover a wash of the text. A state shows as a dot (6–8 px,
  round), a lucide icon or a tinted badge at the row's start or end, never as the row's background
  or a coloured side bar.
- Actions that belong to a row appear on hover and on focus within; keep them visible on touch:
  gate the hiding with `@media (hover: hover)`.
- Numbers, counts, keycaps and times align right in `font-variant-numeric: tabular-nums`.
- Names in sans; mono only for what is literal: SHAs, code, a path shown as code.

Section header (sidenav "Workspaces", a group "In progress 17"): 32 px, 13 px weight 600 in
`--muted`, a count after it; its actions (add, filter) as 24 px ghost icon buttons on the right.

Workspace card: 10 px radius, 8 × 10 px padding; hover `--hover` and current `--selected`, as
every row (V37: a hover of `--raised` at 40 % vanished in light, and a border and shadow made the
current card a box). First line: status dot and name (14 px, 500). Second:
branch in 13 px `--muted` sans, a repository chip. Third, when there is one: the agent's last line
in 13 px `--muted`, its time right-aligned in 12 px `--faint`.

## Chips, badges, counts, keycaps

```css
.chip {            /* metadata: a ref, a project, a kind */
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--raised);
  color: var(--muted);
  font: 500 var(--size-caption)/18px var(--sans);
}
.badge {           /* a state: --badge is the state's token */
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 18px;
  padding: 0 8px;
  border: 1px solid color-mix(in srgb, var(--badge) 25%, transparent);
  border-radius: 9999px;
  background: color-mix(in srgb, var(--badge) 10%, transparent);
  color: var(--badge);
  font: 500 var(--size-caption)/1 var(--sans);
}
.count {           /* "Pinned 3", "Changes 0/35" */
  min-width: 18px;
  height: 16px;
  padding: 0 5px;
  border-radius: 9999px;
  background: var(--raised);
  color: var(--muted);
  font: 500 var(--size-caption)/16px var(--sans);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border: 1px solid color-mix(in srgb, var(--line) 80%, transparent);
  border-radius: 4px;
  background: color-mix(in srgb, var(--raised) 70%, transparent);
  color: var(--muted);
  font: 500 var(--size-caption)/1 var(--sans);
  box-shadow: var(--shadow-lift);
}
```

- Diff counts (`+13 −0 ~22`): coloured numbers in 13 px tabular, no box.
- HEAD and the current branch stand out by a success badge and weight, not a solid fill.
- Keycaps: trailing in tooltips and menu items; on a row only while it is hovered or focused.
  Never on Cancel.

## Tabs

Segmented (two to four views of one thing: Changes / Findings, Dark / Light / System):

```css
.segmented { display: inline-flex; height: 32px; padding: 3px; border-radius: 10px; background: var(--raised); }
.segmented > button {
  flex: 1;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--muted);
  font-weight: 500;
}
.segmented > button:hover { color: var(--text); }
.segmented > button[aria-selected='true'] {
  border-color: color-mix(in srgb, var(--text) 15%, transparent);
  background: var(--input-bg);   /* light: var(--bg) with var(--shadow-lift) */
  color: var(--text);
}
```

Line tabs (a page's sections): no track, `--muted` labels, the active one in `--text` with a 2 px
underline in `--text` (not blue) 5 px below; the strip's own bottom hairline in `--line`.

## Menus, popovers, tooltips, dialogs

Floating surfaces are the only ones with blur and large shadows: a handful of elements at a time.

```css
/* The glass is a layer behind the items: a backdrop-filter on the menu would make it the
   containing block of a fixed submenu (V31c). */
.menu {
  isolation: isolate;
  min-width: 176px;
  padding: 4px;
  border: 1px solid var(--menu-line);
  border-radius: 11px;
  box-shadow: var(--menu-shadow);
  color: var(--text);
  animation: float-in 150ms ease-out;
}
.menu::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: var(--menu-bg);
  backdrop-filter: blur(40px);
}
.menu-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 8px; font: 450 var(--size-small)/17px var(--sans); }
.menu-item .icon { width: 14px; height: 14px; color: var(--muted); }
.menu-item:hover, .menu-item:focus-visible { background: var(--menu-hover); outline: none; }
.menu-item.danger { color: var(--error); }
.menu-item.danger:hover { background: color-mix(in srgb, var(--error) 20%, transparent); }
.menu-label { padding: 4px 8px; color: var(--muted); font: 600 var(--size-caption) var(--sans); }
.menu-separator { height: 1px; margin: 4px -4px; background: var(--line); }
@keyframes float-in { from { opacity: 0; } }   /* no scale: menus measure their own box */
@media (prefers-reduced-motion: reduce) { .menu { animation: none; } }
```

- Popover (arbitrary content: a form, a picker, the "?" help): `--panel`, 1 px `--line`, 10 px
  radius, 14 px padding, `--shadow-floating`.
- Tooltip (names an icon-only control; never teaches or warns): inverted, `background: var(--text);
  color: var(--bg)`, 8 px radius, 6 × 12 px padding, 13 px text, shown after 400 ms, above with a
  4 px gap; a keycap may trail. Until Symbiote has one, `title` is acceptable.
- Help (V37, `Help.tsx`): the one way to explain. A 24 px ghost icon button (`HelpIcon`, lucide's
  circle-help) beside what it explains — a title, a field's name, a submit button. Hover (300 ms)
  or focus shows the tip, a click keeps it until a click elsewhere or Escape (which the page then
  does not get). The tip is a popover (`.help-tip`: `--panel`, `--line`, 10 px radius, 10 × 12 px
  padding, 13 px, at most 340 px wide) drawn on `document.body` and placed `fixed` by `placeTip`
  (`tips.ts`: under the button, left edges aligned, 8 px inside the window, above when it fits
  only there). It is always in the document, hidden, as the button's `aria-describedby`.
  What goes behind it: explanation — what a page or setting is, where something is saved or
  goes, keys. What stays on the page: states, warnings, errors, notices, loading lines,
  placeholders, an empty state's one line.
- Dialog: overlay `--overlay` with `backdrop-filter: blur(2px)`; box `min(512px, 100% - 32px)`
  wide, 20 × 24 px padding, 10 px radius, 1 px `--menu-line`, `--dialog-bg`,
  `backdrop-filter: blur(40px)`, `--dialog-shadow`, faded in over 200 ms; title 16 px weight 600, description 14 px
  `--muted`; footer right-aligned, ghost Cancel then the primary. Size it to its input: a
  confirmation stays compact, a brief or a prompt gets a large dialog or a page.

## Shell

- Sidenav: `--side`, 240 px, `--line` on its right. From the top: the brand row (36 px, as the
  toolbars), the pages as 32 px rows, a section header per group, the workspace cards, a footer
  of 24 px ghost icon buttons above a hairline.
- Toolbar or page head: 36 px, `--side`, `--line` below; the page's title in 16 px weight 600;
  actions on the right as 28 px ghost or outline buttons with icons; view toggles grouped.
- Status bar: 24 px, `--side`, `--line` above, 13 px; each segment a button (2 × 4 px padding, 4 px
  radius, hover `color-mix(in srgb, var(--raised) 70%, transparent)`). Usage bars: 4 px high,
  round, track `--raised`, fill `--added` under 80 %, `--warning` from 80 % or when the vendor
  warns, `--removed` at 100 % or a reached limit (V29c's tones: the person wants the colours, not
  grey).
- Brand: the koi S (`KoiMark`, `ui/koi-mark.png`) at 24 px before the name; 20 px in the title bar.
- Terminal: `#02040a` (the koi's deepest water) edge to edge, dark in both themes; its theme in
  `workspaces/terminal.ts`.
- Empty state: a 28 px icon in `--faint`, a 14 px weight 500 line, 12 px `--muted` text, and the
  action that fills it (a primary or outline button).

## The graph

Keep the viewer's rules (layout independent of selection, the map's fixed label sizes, nothing
costly on thousands of nodes). Within them:

- Canvas `--bg`; project frames `color-mix(in srgb, var(--text) 12%, var(--line))` 1 px, 14 px
  radius, fill `color-mix(in srgb, var(--text) 2%, transparent)`; context frames dashed, fainter.
- File boxes: `--panel`, 1 px `--line`, 10 px radius; the name in mono 12 px weight 500 (a path is
  literal).
- Symbols: a 9 % ground and a 1 px edge at 55 % of the kind's colour, text in `--text`, 8 px
  radius. Selected: `outline: 2px solid var(--accent)`, offset 1 px (no size change).
  Reviewed: dimmed; mixing the text tokens toward the surface (`color-mix(in oklab, …)`) is a fixed
  step on any background, where `opacity` fades with what is behind.
- Edges in `--faint`, the selected symbol's in `--text`; removed edges dashed in `--removed`.
- Zoom controls and the minimap: one floating card (`--panel`, `--line`, 10 px radius,
  `--shadow-lift`) of 28 px ghost icon buttons; the minimap's mask `rgb(0 0 0 / 60%)` dark.
- The legend and the key strip: candidates for a "?" popover (progressive disclosure). That moves
  information: ask the user first.

## Icons

lucide's set, drawn in `src/ui/icons.tsx` (no `lucide-react`): copy a path from lucide.dev, keep its
24-unit viewBox (give `Icon` a `viewBox` prop), `stroke-width: 2` scaled by the 16 px box (1.33 px
drawn; Symbiote's own 16-unit icons use 1.6), round caps and joins, colour from the text. Sizes: 16 px,
14 px in menus and dense rows, 12 px in chips, 28 px for an empty state. Keep one credit line for
lucide (ISC) in `icons.tsx`. One icon per meaning, the same everywhere: `Search`, `Settings`,
`History`, `GitBranch`, `GitCommitHorizontal`, `GitMerge`, `Plus`, `X`, `ChevronRight`,
`PanelLeft`, `CircleHelp`, `Loader2` (spinning), `Check`, `TriangleAlert`, `Info`, `CircleX`.
