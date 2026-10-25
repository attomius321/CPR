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
