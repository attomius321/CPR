# V107 — Back after following a link

[Index](../PLAN.md) · [Journal](../journal/v107-back-in-the-panel.md)

**Status:** built, ready for review (2026-11-12), on branch `feature/v107-back-in-the-panel` (the
workspace's, from `main` at `fd27f94`); planned 2026-11-10 by the graph usability spike
(`spike/graph-usability`). The person's brief added the panel's rows on one line (decision 999).

**Kind** feature (milestone) · **Branch** `feature/v107-back-in-the-panel` · **Size** S ·
**Depends on** none · **Rank** 9 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**: the detail panel remembers the picks followed from it. A Back button in the
panel's head, and Alt+←, return to the previous pick. A pick from the sidebar (a finding, a row)
starts a new trail.

**Where to look**:
- `packages/viewer/src/diff/App.tsx` (`selected`, `setSelected`); `src/diff/DetailPanel.tsx` (its
  head, `onSelect` from the neighbour lists and a finding's related symbols).
- `src/diff/useDiffKeys.ts` (keys; Alt is ignored there today, `event.altKey` returns early).
- `src/ui/tip.ts` (`tip()`) for the button's tip, with its key.

**Out of scope**: the browser's history; Forward.

**Done when**: an e2e test picks a finding, follows a user from the panel, presses Back (button,
then Alt+←), and finds the finding's symbol picked again; a pick from the sidebar clears the
trail.

**Added by the person's brief (2026-11-12)**: the panel's neighbour rows (Used by, Still used by,
Used before by, Uses, No longer uses, Changed members) stay one line each at every width the
Resizer allows. What does not fit is cut with an ellipsis, the full name and place in a tip,
never wrapped. Which part gives way first is a decision of this plan. Wrapping elsewhere in the
panel (findings, the code) is out of scope unless the same rule fixes it for free.

## Problem (the spike's G14)

A name in the panel's "Used by" or "Uses" picks that symbol, and nothing returns to the one before.
In 5 of 5 walks, getting back to the finding after following a user meant finding and picking it
again ([shot](../../spikes/graph-usability/shots/p13-no-way-back-dark.png)).

**Goal**: following a link costs one step there and one step back.

**The rows (the brief's)**: as the panel narrows, a row's name, a `.link` button in a flex row,
wraps. Measured on this plan's fixture at the default 336 px: a rule's selector
(`.ledger-report .quarterly-summary .account-balance-row:hover`) took 3–4 centred lines; a long
identifier, with nowhere to break, ran past the row's end instead
([before](../images/v107-back-in-the-panel/before-dark-336-rules.png)). The Resizer's narrowest
is 320 px (`min(320px, 45vw)`), 16 px under the default: a row has about 294 px for its icon,
name, chip, place and Open.

## Design

- A trail in `App.tsx`: picks made through the panel's `onSelect` push the current pick; a pick
  from the sidebar, `j`/`k` or the canvas clears it. Back pops it. Pure helpers (`pushTrail`,
  `backTrail`) in `src/diff/review.ts`, with a test.
- The Back button shows only with a trail, left of the panel's kind, with its tip naming the
  previous symbol and the key.
- Alt+← is read before `useDiffKeys`' early return for modifier keys.

- **The rows (decision 999)**: each row stays one line. The place (`file:line · kind`) gives way
  first, down to nothing (a flex-shrink weight that takes the whole cut until it is gone). Then
  the name is cut with an ellipsis. Open and the row's icon stay whole. The name's tip is the name
  whole, then its place on a second line, in mono (`tip()`). "Not on the canvas" keeps its words
  while the list is 440 px or wider (a panel of about 450 px). Narrower, it is lucide's eye-off,
  the words its tip: the words (about 117 px) would leave a name about 10 characters at 320 px. A
  container query on `.neighbours` decides, so no width is measured in script.

## Verification

1. Unit (red first): the trail's push, back and clear.
2. e2e as in "Done when"; no page errors.
3. e2e: at the Resizer's narrowest (Home on its handle, 320 px) every row of every list is one line
   high and ends inside its list, a long name is cut (`text-overflow: ellipsis`, scrolled wider
   than drawn), its tip the full name and its place. It must fail with `main`'s CSS.
4. Screenshots of the panel at 320, 336 and 480 px, dark and light, 1x.

**Risks**

| Risk | Mitigation |
|---|---|
| Alt+← is the browser's Back in a tab | `preventDefault` only while the panel has a trail; otherwise the browser's |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 982 | Returning after following a link | **The panel keeps a trail of picks followed from it; Back (its head, Alt+←) returns; a pick from elsewhere clears it** | In 5 of 5 walks the way back was to find and pick the finding again |
| 999 | A neighbour row narrower than its content | **One line always: the place gives way first, then the name is cut with an ellipsis; Open stays whole; "not on the canvas" is its icon under a 440 px list; the name's tip is the name and its place** | Wrapped names were unreadable to the person. The place is in the tip and in the panel's head once picked; the name is what a reviewer reads. Open is an action, and the chip says why a click moves nothing on the canvas, but its words cost a third of the row at the default width |

## As built

- **The trail's state is a hook**, `useTrail.ts` beside `App.tsx`, around the pure `pushTrail`,
  `backTrail` and `trailBack` in `review.ts`. A pick that leaves the trail's end is found by one
  effect (`trail.at !== selected`), not by changing each caller: the sidebar, the canvas, j/k,
  Esc, a draft and `g` all reach `setSelected` directly. A link followed from a pick the trail is
  not at starts a new trail (`pushTrail`), so a dropped trail never comes back. One edge is left:
  picking from the sidebar the symbol already picked changes nothing, so its trail stays. The
  finding's "on <symbol>" link in the panel is a followed link too.
- **Back is `.panel-back`**, Close's recipe (a row's height, square, muted, hover wash), first in
  the head's line. `BackIcon` was already drawn (the title bar's); `EyeOffIcon` is new, lucide's.
- **Alt+← is read before the modifier keys' early return** in `useDiffKeys`, only on the Graph
  page, with a trail, outside a text field; `preventDefault` only then.
- **`test/fixtures` is left out of the viewer's typecheck** (`tsconfig.json`'s `exclude`):
  `panel-trail` keeps a call to the removed method, as `detectors` does in core, whose fixtures are
  not typechecked either.
- **Not fixed: a finding's message in the panel is cut, not wrapped, past the panel's edge** when
  it holds a long name (seen in the 320 px shots, on `main` too). Out of scope by the brief; the
  rows' rule does not reach it.

## Results

Unit: `test/trail.test.ts`, 4 tests, failed with no helpers first. e2e: `e2e/panel-trail.spec.ts`,
3 tests on the fixture `packages/viewer/test/fixtures/panel-trail`: Back by its button and by
Alt+← (two links deep), the trail cleared by the sidebar, `j` and the canvas, and an old trail
not coming back with its pick; and the rows at 320 px. With `main`'s `DetailPanel.css` the rows
test failed: `printAnnualLedgerSummaryWithEveryAccountBalanceIncluded`'s row ran past its list.
`pnpm check` (3,653 unit tests), `pnpm build`; `pnpm test:e2e`: 486 viewer tests, the 3 of
`map-labels.spec.ts` after a fix of their own (they opened on V109's first view), and the nexus's
32.

Shots, 1x, headless Chromium (`docs/images/v107-back-in-the-panel/`): the rule's users before
([dark](../images/v107-back-in-the-panel/before-dark-336-rules.png),
[light](../images/v107-back-in-the-panel/before-light-336-rules.png)) and after
([dark](../images/v107-back-in-the-panel/after-dark-336-rules.png),
[light](../images/v107-back-in-the-panel/after-light-336-rules.png)) at 336 px; users not on the
canvas at 320 px ([dark](../images/v107-back-in-the-panel/after-dark-320-away.png),
[light](../images/v107-back-in-the-panel/after-light-320-away.png)) and at 480 px with the chip's
words ([dark](../images/v107-back-in-the-panel/after-dark-480-away.png)); Back's tip
([dark](../images/v107-back-in-the-panel/after-dark-336-back.png)) and a cut name's
([light](../images/v107-back-in-the-panel/after-light-320-name-tip.png)).
