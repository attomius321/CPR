# Journal: V107 — Back after following a link

[Index](../JOURNAL.md) · [Plan](../plan/v107-back-in-the-panel.md)

## V107 spike — no way back (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

In 5 of 5 walks, getting back to a finding after following a user from the panel meant picking the
finding again ([shot](../../spikes/graph-usability/shots/p13-no-way-back-dark.png)).

## V107 — Back in the panel; its rows on one line (2026-11-12)

Built in its workspace, `feature/v107-back-in-the-panel`, from `main` at `fd27f94`. The person's
brief added the panel's neighbour rows on one line (decision 999) to the planned Back (982).

**Learned**:
- **The rows did not all wrap.** A long identifier has nowhere to break: it ran past its row
  (the list wider than its card) instead. What wrapped were names with spaces, a rule's selector
  (3–4 centred lines at 336 px: a button centres its text), a template's `Foo template`. The e2e
  test therefore checks that each row ends inside its list as well as its height. Without the
  fixture's stylesheet the test would have passed on `main`'s heights.
- **The Resizer's narrowest is 16 px under the default** (320 and 336 px at 1440 px wide): the
  chip's words (about 117 px) left a name about 10 characters at both. Under a 440 px list the chip
  is its eye-off icon, by a container query on `.neighbours`.
- **One effect clears the trail** for every pick from elsewhere: the sidebar, the canvas, j/k, Esc,
  a draft and `g` each call `setSelected` themselves. Wiring each would miss the next one added.
- **A canvas click after a pick from the panel** waits for the view to hold still, and the symbol
  clicked must be one that pick draws: an unchanged pick's view drew 4 of the change's symbols.
- **`test/fixtures` was in the viewer's typecheck**: a fixture that keeps a call to a removed method
  (as core's `detectors`) failed it. Excluded, as core's fixtures are.

**Verified**: tests first. `test/trail.test.ts` (4) failed with no helpers. `e2e/panel-trail.spec.ts`
(3) passes; its rows test fails with `main`'s `DetailPanel.css` (a row past its list).
`e2e/review.spec.ts` and `e2e/resize.spec.ts` pass beside it. Shots at 320, 336 and 480 px, dark
and light, 1x, in `docs/images/v107-back-in-the-panel/`. `pnpm check`: 3,653 unit tests. `pnpm build`.
`pnpm test:e2e`: 483 of 486 viewer tests passed at load average up to 27; the 3 others,
`map-labels.spec.ts`, failed again alone at load 5. V96's spec and V109's first view merged
separately: the `projects` fixture's warning now opens the page focused on it. With `wholeFirst`,
as V109 gave the other specs, they pass (3 of 3), in a commit of its own. The nexus's 32 passed.

**Not verified**: real graphs (the change is the panel's CSS and its state, not the layout); the
app's window (Electron); Alt+← there is not the browser's Back. A finding's
message in the panel is still cut past the panel's edge when it holds a long name (on `main`
too): out of the brief's scope.
