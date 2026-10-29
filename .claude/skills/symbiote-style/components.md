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
.btn-primary:hover { background: var(--primary-hover); }   /* dark: lighter, its dark words gain (V61) */

.btn-secondary { background: var(--raised); }
.btn-secondary:hover { background: color-mix(in srgb, var(--raised) 80%, transparent); }

.btn-outline { border-color: var(--line); background: var(--input-bg); box-shadow: var(--shadow-lift); }
.btn-outline:hover { border-color: color-mix(in srgb, var(--muted) 35%, transparent); background: var(--hover); }

.btn-ghost { color: var(--muted); }
.btn-ghost:hover { background: var(--hover); color: var(--text); }

.btn-danger { background: color-mix(in srgb, var(--error) 60%, transparent); color: #fff; } /* dark; light: var(--error) */

.btn-sm { height: 28px; padding: 0 10px; gap: 4px; font-size: var(--size-small); }   /* in a sidenav card */
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

A switch (an on/off setting; V49, `input[type='checkbox'][role='switch']` in `ui/controls.css`):
the `<input type="checkbox">` with `role="switch"` (its label, the keyboard and `getByLabel` stay).
Track 36 × 20 px, round, off `color-mix(in srgb, var(--muted) 30%, transparent)` with the
checkbox's 1 px `--edge` border (Symbiote's 3:1 for a control's edge), on `--primary` as a checked
checkbox; thumb 14 px, `--primary-text`, `--shadow-lift`, moved 16 px when on. Its words before it,
the switch at the row's end.

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
  min-height: 28px;          /* 36 px for the sidenav's pages (V61) */
  padding: 0 8px;
  border-radius: 8px;
  color: var(--muted);
  font-weight: 500;          /* nav; list rows 400 */
  transition: background-color 150ms, color 150ms;
}
.row .icon { color: var(--muted); stroke-width: 1.75; }          /* on lucide's 24-unit icons; 18 px in the sidenav */
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

Section header (sidenav "Workspaces"): 15 px weight 600 in `--text`, a count after it; its action
(add) a 28 px raised square (`--raised`, a `--line` edge) on the right (V61). A group's header
("To review 1"): 15 px weight 500 in `--muted`, a round count.
A group of workspaces (V44) starts with its icon, 16 px in its state's colour (`--group-tone`),
the icon over the cards' dots and the name over their names; folded, the icon alone, its name in
`title`. Only the group has an icon: a card keeps its dot. V53: a working or starting dot is a
spinner, and a merge's at work (fix/merging-status): a comet, a 2 px ring whose tail fades in to a
round head, 11 px around the dot's 7 px place, so nothing moves (until then a plain ¾ arc); a
working card's line starts with its agent's mark, 14 px, in its vendor's colours (the one place a
non-state colour is on a card, the person's choice); every card's kind is a neutral `.chip` at the
start of its facts' row (V79; at the end of its name's row V53–V78).

Workspace card (V79, decisions 576–581): four rows on 20 px lines, 10 × 12 px in, 10 px radius,
6 px between cards, each on a 3.5 % wash of the text, 7 % on hover, the open one `--selected` (no
edge or shadow: V37's border and shadow made the current card a box). The dot, 10 px from the
words, on the first line of the name (15 px, 600, two lines then "…"), how long its state has
lasted in 13 px `--muted` at that row's end. What it does or what is next in 14 px `--muted`, two
lines then "…", the agent's mark before it while it works. Its facts' row: the kind chip (the open
one's in the accent, V61), then each fact as a 15 px icon and a number or a word in 14 px
`--muted` (commits, files not committed), the merge check in its state's colour ("clean" in
`--added`, "n conflicts" in `--removed`), each named in words in its tip and its `aria-label`.
Last, the branch in 14 px `--muted` sans and its review mark. Until V79 a card was three rows in
72 px, 1 px apart, each cut to one line: 5 of 9 names and 6 of 9 states read "…". Waiting for you
(V48, V61): the group an amber card (14 px radius, a 30 % `--warning` edge, a 5 % wash), each
workspace a card inside it (a 4 % wash of the text), what it asks on two lines at most, Respond
the primary at 28 px then its kind. A group's icon stands over its cards' dots and its name over
theirs. Folded, the rail draws the dots alone, without the wash.

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

Line tabs (V61, decision 445, the person's mockup): a workspace's views, the diff sidebar's Changes
/ Findings. A strip on the card's chrome, its bottom hairline in `--line`; tabs 40 px, 15 px
weight 500 in `--muted`, 8 px top corners; the picked one in `--text` on `--tab-picked` with a
3 px `--primary` line along its bottom, inset 8–10 px; a hairline divider before "+".

```css
.tabs { display: flex; gap: 2px; padding: 0 8px; border-bottom: 1px solid var(--line); background: var(--side); }
.tabs > button { height: 40px; padding: 0 12px; border: 0; border-radius: 8px 8px 0 0; background: none; color: var(--muted); }
.tabs > button:hover { background: var(--hover); color: var(--text); }
.tabs > button[aria-selected='true'] { position: relative; background: var(--tab-picked); color: var(--text); }
.tabs > button[aria-selected='true']::after {
  content: ''; position: absolute; right: 8px; bottom: 0; left: 8px; height: 3px;
  border-radius: 4px 4px 0 0; background: var(--primary);
}
```

Segmented (a mode, two to four of one thing: Files / Graph, All branches / This branch, Dark /
Light / System):

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
- Tooltip (V54, `ui/Tooltip.tsx`; names, never teaches or warns): **never a `title`** (the window
  system draws it: square, its own font, no theme; `test/tooltips.test.ts` fails on one). Give the
  element `{...tip(text, { keys, side, tone, code })}` (`ui/tip.ts`); one `Tooltips` on the page
  draws it. Inverted: `--tip-bg` (`#e3e8f2` dark, `#0b1220` light), `--tip-text`, 8 px radius,
  6 × 12 px padding, 13 px, the head in 500 and its other lines (`\n`) in `--tip-muted`; keys as
  caps trailing the head (`Alt+←` → `Alt` `←`); a state's dot (`tone`: ok, bad, warn, info) in the
  other theme's state colours. Shown after 400 ms, at once along a toolbar; above, 6 px off,
  flipped when it does not fit; `side: 'right'` beside the sidenav, `'bottom'` under the title bar.
  Its form follows its context: a page or action with its key, a cut text's whole text (only when
  cut, from its first letter, in its font), a state with its dot, a date written out (`longDate`),
  an id or path in mono (`code`). Class names are global: its modifiers are `tooltip-…`.
- Help (V37, `Help.tsx`; V54: in the menus' glass, 11 px, 12 × 14 px): the one way to explain. A 24 px ghost icon button (`HelpIcon`, lucide's
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

- Sidenav: `--side`, 300 px at first (V79; 264 since V61), `--line` on its right. From the top: the brand row (52 px: the
  round mark at 32 px, "Symbiote" at 17 px 600, the repository in `--muted`, the fold a 32 px
  raised square), the pages as 36 px rows with 18 px icons, the section header, the groups and
  their cards; at the bottom, Settings alone, a page's row over a `--line` hairline (6 × 8 px
  around it) that the list scrolls under, its icon at the rail's bottom when folded.
- Page head (V72, `ui/PageHead.tsx` and `ui/page.css`): every page's, on the page's ground
  (`--bg`), no line under it. The page's icon (28 px, `--accent`) in a 32 px square 16 px in,
  then the title (17 px, weight 600) with what goes beside it (its "?", a kind's chip, a merge's
  state), a `--muted` 14 px line under it, cut to one line. The actions sit at the right as
  32 px buttons; they go under the title when the title would keep less than 200 px. The head is
  76 px high, so the title stands at x 60 and the cards start at y 76 on every page. A
  workspace's icon is its kind's; a review's the eye; Start's the S; a merge's the merge icon.
- Panels as cards (V61; the frame since V72): under the head, each panel a card (`--line`
  hairline, 10 px radius, `overflow: hidden`), 16 px from each other and from the main area's
  sides and bottom (`--page-pad`, `--page-gap`); the content's card on `--bg`, a side panel's on
  `--side`. A `Resizer` between two cards takes `gutter`: it is the 16 px gap itself, its line in
  the middle. A strip that asks something of the person (a workspace waiting, failed) is a card
  of its own in its tone: a 30 % edge, an 8 % wash, the primary at its right.
- Inside a card (V72): the words start 16 px in (`--card-pad`), a list's row wash 8 px in with
  its words at 16. A card's head is 48 px with its hairline (`.card-head`): tabs stand on the
  hairline with the first tab's words 16 px in; a head of controls (Nucleus's model and effort,
  the Monitor's place) has its first control 16 px in. Git's rows card keeps its toolbar head,
  which wraps on a narrow card.
- Status bar: 24 px, `--side`, `--line` above, 13 px; each segment a button (2 × 4 px padding, 4 px
  radius, hover `color-mix(in srgb, var(--raised) 70%, transparent)`). Usage bars: 4 px high,
  round, track `--raised`, fill `--added` under 80 %, `--warning` from 80 % or when the vendor
  warns, `--removed` at 100 % or a reached limit (V29c's tones: the person wants the colours, not
  grey).
- Brand: the person's S (`SymbioteMark`, `ui/mark.png`, cut round by `scripts/desktop/icon.mjs`)
  at 32 px before the name, a `--line` ring.
- The app's title bar (N1c; fix/title-bar-desktop): 38 px of `--side`, `--line` under it, over
  the page a browser shows — Back and Forward at its left, the window's title in the middle
  (`--muted`, 14 px), the window's buttons at its end. Nothing of a page moves into it: the
  brand row, a page's tabs and its buttons stay where a browser has them (`title-bar.spec.ts`
  compares the two).
- Terminal: `#050608` (a step under the canvas) to its card's edges, dark in both themes; its
  theme in `workspaces/terminal.ts`.
- Composer under a thread ("To answer, open its terminal"): a field's frame (`--line`, 10 px,
  `--side`), its icon in a 28 px `--raised` tile, the words in `--muted`.
- Empty state: a 28 px icon in `--faint`, a 14 px weight 500 line, 12 px `--muted` text, and the
  action that fills it (a primary or outline button).
- A page that makes something (Start a workspace; the person's mockup since V63): the whole main
  area, as every page (V72: it was centred at 1,312 px). The head is the frame's, the S its icon,
  the buttons at the right (36 px, Cancel and Clear `secondary`, the primary with its icon).
  What is written is one card (14 px, `--panel`, `--line`, `--shadow-lift`) with the kinds as
  its 48 px head of tabs with icons (the picked one `--selected`, its words `--accent`, a 3 px
  `--primary` line on the hairline), each field's name with its "?" over it, a part's tools in
  its frame. The settings sit beside it (821 : 470 of the area, the run at least 380 px) as one
  card each, 16 px apart: an icon in `--accent` and a heading, a choice's control on the
  heading's line in the rows' control column (`--start-name`, 124 px), rows with the name in
  `--muted` at the left. Files are added in a dashed drop area (`--field-line`) with the button
  in it. The mockup's arc (`--ground-arc`) rings the head's S. A tall window makes the goal
  taller; the cards stay under the head.
- A page of settings (Settings and Skills): the frame's head, then the list (280 px, a card) and
  the open page (a card) to the area's bottom, each scrolling on its own, over the whole width
  (V72: Settings was centred at 1,400 px). A page is its heading (with its chip and "?") over
  its sections; a prebuilt agent's settings rows (`.settings-rows`: the name an `h3` in
  `--muted` 500) then a section per prompt. A setting of this browser's (the theme, the intro)
  is an entry of the list, not a control in the head.
- A page that waits (a diff's analysis, V71): one card (560 px at most) in the middle of the main
  area, a state rather than a page to work in (V72 left it centred). Its head is the start
  page's (the S lit, the title with its verb in `--muted`, a line, a state chip at the right); its steps as the merge log's rows with the sidenav's state dots
  (done `--added`, running working's cyan comet, to come an empty ring); its buttons Start's head
  actions (36 px, a 14 px icon). The arcs (`ui/ground.css`, `.ground` and `.ground-ring`, shared
  with Start) centred on the card and clear of it, over the whole area; a comet turns on the
  inner one while it runs — the ground's, not a state — still once it ended or without motion.

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
