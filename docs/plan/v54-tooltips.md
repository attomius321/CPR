# V54 — Tooltips drawn by Symbiote, one form per context

[Index](../PLAN.md) · [Journal](../journal/v54-tooltips.md)

**Status:** merged into `main` on 2026-10-25 (built 2026-10-25), on branch `feature/tooltips-revamp` (a workspace started
in Symbiote, from `main` at `da991b5`; `main` merged in at `e4da160`, with V55's two new `title`s
moved over). The person OK'd the plan with "1. Yes 2. Yes 3. As you recommend": the style's
inverted tip as previewed, a cut text's tip only when it is cut, and the state dots kept. Built
as planned, with the changes under "As built".

**Problem** (asked: "All tooltips look like rubbish atm. Each tooltip represent something, make it
at the current standards of UI, with rounder corners, nice font size, colors, etc. These should be
done it each tooltip context."). Counted on `main` at `da991b5`:

| Tooltip | Where | How it is drawn |
|---|---|---|
| 122 `title` attributes | 41 files: sidenav, title bar, toolbars, rows, marks, the graph's nodes, the status bar | by the window system: square, its own font, no theme |
| 2 SVG `<title>`s | History's lane arrows | the same |
| React Flow's own | the canvas's zoom and fit buttons (`title`), the minimap (`<title>`) | the same |
| 25 `Help` tips | page and field help (V37) | Symbiote's popover: `--panel`, 10 px |
| 1 link hint | an agent's terminal (V38) | Symbiote's: light, 8 px |

- A `title` tooltip cannot be styled: Chromium and Electron hand it to the window system, which
  draws it after about a second in a system font, square, grey or yellow, in neither theme.
- Their texts pack a name, a description and a key into one string ("History: every branch's
  commits (h)"), and a date is the browser's raw `toLocaleString()` ("25/10/2026, 17:02:16").
- The style already says what a tooltip is (`components.md`: inverted, 8 px radius, 13 px, 400 ms,
  a key cap trailing) and "until Symbiote has one, `title` is acceptable": Symbiote has none.

**Goal**: every tooltip in the viewer is Symbiote's own, in the style's recipe, and takes the form
of what it explains: a page or an action with its key, the rest of a cut text, a state with its
colour, a date written out, the usage's windows, a symbol's id. No `title` is left. **Unchanged**:
what each tooltip says (only its form and the date's format), the Help's behaviour (V37), layout
(a tip floats on `document.body`), the graph's frame rate.

## One tooltip for the viewer (`ui/Tooltip.tsx`, `ui/tips.ts`)

- An element asks for a tip with data attributes, set through a typed helper `tip()`:
  - `data-tip`: the text. Lines after the first (`\n`) are the tip's body, in its muted colour.
  - `data-tip-keys`: keys as caps (`Alt+←` → `Alt` `←`), trailing the first line.
  - `data-tip-side`: `right` (the sidenav), `bottom` (the title bar), else `top`, flipped when it
    does not fit.
  - `data-tip-tone`: `ok`, `bad`, `warn` or `info`, a dot before the text.
  - `data-tip-code`: the text in Geist Mono (ids, paths, SHAs, commands that are not on screen).
- `Tooltips`, mounted once in `main.tsx`, listens on the document: `pointerover`/`pointerout`,
  `focusin`/`focusout` (`:focus-visible` only). One listener, not one per element: the graph has
  thousands of nodes and must not get a handler or a state each (the viewer's rules).
- Shown after 400 ms of rest (the style's delay and the terminal hint's, V38); within 300 ms of
  the last tip hiding, the next one shows at once (moving along a toolbar or the sidenav).
- Hidden on pointer down, wheel, scroll, Escape (which the page then does not get), the window's
  blur, and when its element leaves the page; a changed `data-tip` changes the shown text.
- One element on `document.body`, `role="tooltip"`, `pointer-events: none` (V37: a tip shown by a
  hover must let the pointer through); while shown, its element is `aria-describedby` it. Where a
  `title` was an element's only name (an icon-only mark), the element gets an `aria-label`.
- Placement (`tips.ts`, pure, unit-tested): centred on the side asked, 6 px off, 8 px inside the
  window, on the visible part of a wide element (a project frame's band can be wider than the
  window); flipped to the other side when it fits only there. Faded in by opacity (no scale: the
  tip measures its own box).

## Each context's form

| Context | Form |
|---|---|
| Sidenav pages, Start | right of the item; name and key on the first line, what it holds below |
| Title bar, toolbars, icon buttons | one line, the key as caps; under the title bar's buttons |
| A text that is cut (paths, subjects, branches, briefs) | the whole text, **only when it is cut**, in the text's own font, its letters aligned with the row's |
| States and marks (reviews, findings, agent state, merges) | a dot in the state's colour, then the words |
| Times | "Sat 25 Oct 2026, 17:02", tabular figures |
| Usage in the status bar | above it: the plan as head, a line per window, the read's age |
| The graph (symbols, files, frames, groups) | the id in mono, above; hidden as the canvas moves |
| History's lane arrows, the canvas's buttons, the minimap | as the toolbars'; the three React Flow buttons drawn as `ControlButton`s of ours, the minimap's `<title>` dropped (its name stays an `aria-label`) |
| Help (25) | stays a popover: the floating surfaces' glass (as the menus), 11 px radius, 12 × 14 px padding, code as chips |
| A link in the terminal | the tip's shape, light in both themes (the terminal is black in both) |

## Tokens (`ui/base.css`)

- Dark: `--tip-bg: #e3e8f2` (the terminal hint's), `--tip-text: #05080f` (16.31:1),
  `--tip-muted: #4b5672` (5.95:1). Light: `#0b1220`, `#ffffff` (18.72:1), `#a3aec4` (8.39:1).
- Key caps on the tip: a 8–12 % wash, their text 6.55:1 (dark) and 8.65:1 (light).
- State dots in the other theme's state colours, so they keep 3:1 on the inverted tip: dark
  3.95–6.08:1, light 8.17–9.76:1.
- The system-light block equals light (the existing test). `tokens.test.ts` gets the tip's pairs.

## Verification

1. **Tests first** (red for the right reason):
   - `test/tips.test.ts`: each side, centring, the visible part of a wide element, the flip,
     the window's margins.
   - `test/tooltips.test.ts`: no `title=` on an HTML or SVG element and no SVG `<title>` under
     `src/` (components' own `title` props pass).
   - `test/tokens.test.ts`: the tip's text, muted text and key caps 4.5:1, its dots 3:1.
   - `e2e/tooltips.spec.ts`: a sidenav page's tip right of it with its key after the delay, the
     next one at once, gone on leave, Escape and pointer down; keyboard focus shows it; a cut path
     shows its whole text and an uncut one none; a symbol's id; hidden on the canvas's wheel; no
     `[title]` and no `svg title` on History, a diff, Start, Settings, Scout, Skills, the Monitor
     and a workspace. The 17 e2e checks of `title` read `data-tip`.
2. `pnpm check`, `pnpm build`, `pnpm test:e2e`.
3. **viewer-check** on Bitwarden `737ee3f`: first paint, select, mark reviewed and pan frames per
   second against `main`'s build (the document's `pointerover` runs while the canvas moves).
4. **Screenshots** of each context, 1440 × 900 at 1×, dark and light; every page checked for
   uneven spacing.

**Risks**

| Risk | Mitigation |
|---|---|
| A tip left on screen when its element is re-rendered away | checked while shown (`isConnected`); hidden on pointer down |
| Screen readers lose a `title`'s name or description | `aria-label` where it was the only name; `aria-describedby` while shown |
| The listener costs frames on a big graph | one cheap `closest()` per `pointerover`; measured on Bitwarden |
| Electron's drag regions take no pointer events | the title bar's tips are on its `no-drag` buttons |
| Tests that read `title` | moved to `data-tip` in the same commit as the code |

**Order**: tokens and tests, the tooltip, then the regions one commit each (shell, History, a diff
and the graph, workspaces, the other pages), Help and the terminal hint, the docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V54 | Tooltips drawn by Symbiote | `ui/Tooltip.tsx`, the tokens, 124 tips moved, Help and the terminal hint restyled |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 397 | How the viewer shows a tooltip | **No `title`: elements carry `data-tip…`, one `Tooltips` on the document draws them** | the window system draws a `title`; a listener per element would cost the graph |
| 398 | Its colours | **The style's inverted tip: light in dark, navy in light; light in the terminal in both** | the style's recipe (`components.md`), the person's "Yes" to the preview |
| 399 | A tip that repeats its element's text | **Shown only when the text is cut, in its font** | a tip saying what is on screen is noise; the person's "Yes" |
| 400 | States in tips | **A dot in the state's colour, the other theme's colours** | a mark's colour says the state; 3:1 on the inverted tip |
| 401 | Help | **Stays a popover, in the floating surfaces' glass** | it explains (paragraphs, a list), kept by a click; tips name |
| 402 | Timing | **400 ms, then at once within 300 ms of the last; gone on pointer down, wheel, scroll, Escape** | the style's 400 ms; along a toolbar each tip waiting again is slow |

**Not in V54 (later)**: tips on touch (a long press); a tip's own arrow; the Monitor's hover
readout (a panel, not a tip).

## As built (V54)

- **Escape is the page's too**: the plan said Escape would hide the tip and stop there, as Help's
  does. A hover tip is shown without asking; holding back the page's Escape (leave compare mode,
  close a dialog) while the pointer rests on a button would make the key look broken. It hides the
  tip and goes on.
- **A tip with keys always shows**: "Start" beside the Start button says nothing, "Start Ctrl
  Enter" does. Words the element shows whole (by `innerText`, so the folded rail's hidden names
  do not count) are skipped only when the tip has no keys.
- **Long elements take their tip by the pointer**: a resize handle as high as the window, a row,
  a frame's band (over 240 px along the tip's side) placed it far from the pointer at their
  middle; the tip goes by the pointer's place instead (`byPointer`).
- **Class names are global**: the tip's `code` modifier met the diff's `.code` rule, which painted
  a symbol's tip the page's black, text and ground alike (seen in the screenshots, not in the
  tests). The modifiers are `tooltip-code`, `tooltip-cut`, `tooltip-warm`; the e2e spec checks a
  symbol's tip is drawn in `--tip-bg`.
- **The folded rail's links lost their names** with their `title` (their words are hidden there):
  the pages' links and the brand carry an `aria-label`. Found by a screenshot script that asked
  for the Scout link by role in the rail.
- **Spread titles**: five elements took a `title` by a spread (`{...(note ? { title: note } :
  {})}`) or by a menu action's `title`; the guard reads spreads too.
- **React Flow**: its `Controls` set `title` on each button, so the zoom and fit buttons are
  `ControlButton`s of ours in its drawings, named "Zoom in", "Zoom out", "Fit the view" (its
  "Zoom In", "Zoom Out", "Fit View" before); its minimap's `<title>` is dropped with its label
  (`ariaLabel=""`), a picture with no name.
- **Briefs**: a workspace's brief was its link's and its heading's `title` in full; its tip is
  `briefTip`: the first line as the head, then one paragraph of at most 240 characters, without
  Markdown's marks.
- **A finding's badge** said "2 error"; it says "2 errors" (and "1 info").

**Results.**

- **No `title` left**: 125 `tip()` call sites in 44 components (122 `title`s, 2 SVG `<title>`s,
  spread titles, React Flow's own); V55's 2 moved in the merge. The guard
  (`test/tooltips.test.ts`, TypeScript's parser) and the e2e sweep (no `[title]` or `svg title`
  on History, Start, Scout, Skills, the Monitor, Settings, a workspace and a diff) both pass.
- **Tests**: `tips.test.ts` +11 (placement), `tooltips.test.ts` 7 (guard, `tip`, `longDate`,
  `briefTip`), `tokens.test.ts` +2 per theme (the tip's contrast, its ground pinned);
  `e2e/tooltips.spec.ts` 6; 36 e2e checks that read a `title` read `data-tip`.
- **Bitwarden `737ee3f`** (Angular plugin, 1,419 nodes), `scripts/viewer/interactions.mjs`,
  medians of 5 runs alternated with `main`'s build (main / branch, ms): open 310 / 312, open a
  group 110 / 114, select a change 61 / 63, pan zoomed in 520 / 520, mark reviewed 9 / 9, context
  on 79 / 80, next project 29 / 30; no frame blocked by the change. Page elements 3,147 / 3,146
  (the minimap's `<title>` gone).
- **Screenshots**, 1440 × 900 at 1×, dark and light: the sidenav (open and folded, a page and a
  card), a toolbar's keys, Start with Ctrl Enter, a cut path, a review mark, a date, the usage, a
  symbol's id, a finding, the canvas's buttons, Help (keys, kinds, Settings), the terminal's link
  hint; History, a workspace, a diff and Settings whole.
