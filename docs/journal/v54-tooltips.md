# Journal: V54 — Tooltips drawn by Symbiote, one form per context

[Index](../JOURNAL.md) · [Plan](../plan/v54-tooltips.md)

## V54 spike — what the viewer's tooltips are (2026-10-25, branch `feature/tooltips-revamp`)

Counted on `main` at `da991b5`: 122 `title` attributes in 41 files of `packages/viewer/src`, 2 SVG
`<title>`s (History's lane arrows), React Flow's own on the canvas's three buttons and its
minimap; Symbiote draws only the 25 `Help` tips (V37) and the terminal's link hint (V38). A
preview of the proposed forms, each context in both themes, was made with the real tokens and
shown with the plan.

**Learned**:
- **A `title` cannot be shown in a screenshot**: headless Chromium draws no native tooltip, so the
  "before" of 124 of them is a description, not a picture.
- **The style already had the recipe** (`components.md`: inverted, 8 px, 13 px, 400 ms, a key cap)
  with "until Symbiote has one, `title` is acceptable".
- **An inverted tip cannot reuse the theme's state colours**: dark's `--added` (`#81b88b`) is about
  2:1 on the light tip. The other theme's are 3.95–6.08:1 (dark) and 8.17–9.76:1 (light).
- **React Flow sets `title` itself** on `Controls`' buttons and draws a `<title>` in `MiniMap`: the
  buttons have to be ours (`ControlButton`) for no native tip to be left.
- **17 e2e checks read `title`**; they move with the code.

## V54 — tooltips drawn by Symbiote (2026-10-25, branch `feature/tooltips-revamp`)

One `Tooltips` on the page draws every element's `data-tip` (set with `tip()`), in the style's
inverted recipe and in the form of its context: pages and actions with their keys as caps, the
whole of a cut text over its cut letters, states after a dot of their colour, dates written out,
ids and paths in mono, the usage's windows. 125 call sites in 44 components replace 122 `title`
attributes, 2 SVG `<title>`s, 5 titles set by a spread and React Flow's own on its canvas buttons;
Help's popover moved to the menus' glass and the terminal's link hint to the tip's shape.
Decisions 397–402.

**Learned**:
- **Class names are global, and a test did not see it**: the tip's `code` modifier met the diff's
  `.code` (the source excerpt's black ground) and painted a symbol's tip black on black. Every e2e
  check passed (text, font, place); a screenshot showed an empty box. Modifiers are now
  `tooltip-…`, and the spec compares the tip's ground with `--tip-bg`.
- **A `title` was a name, not only a tip**: in the folded rail a page's link has its words hidden,
  and its `title` was all that named it. Removing it left "link" with no name; a screenshot script
  asking for `getByRole('link', { name: 'Scout' })` timed out on it. The links carry `aria-label`.
- **`textContent` counts hidden words, `innerText` does not**: "the tip says what the element
  shows" has to read `innerText`, or the rail's tips (whose labels are `display: none`) are
  skipped as repeats.
- **Prettier writes `font: 500 var(--size-small) / 18px var(--sans)`**, spaces around the slash,
  and the type-scale guard then reads `18px` as a raw size: write the four properties apart.
- **Chromium 153 fires `pointerover` on disabled buttons** (probed: a text-only one and one with
  an SVG): their tips (why it is disabled) work through the window's listener.
- **An agent's terminal scrolls all the time**: hiding the tip on any `scroll` would have hidden it
  everywhere while an agent printed; only a scroll of what holds the tip's element hides it.
