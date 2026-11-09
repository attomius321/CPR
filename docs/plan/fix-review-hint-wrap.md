# Fix — The review's comment hint keeps "(c)." on one line

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V8)

> What holds now: [Reviews](../area/reviews.md). This plan is kept as it was written.

**Status:** planned (2026-11-06), to be built on branch `fix/review-hint-wrap` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/review-hint-wrap` · **Size** S · **Depends on** none · **Plan**
P21 of 51 (the audit's order)

## The brief

**What happens**: in a review's sidebar (a workspace's review, or a pull request's), with no
comment yet, the hint wraps after the key chip. The line ends "…in its panel ( c", and ")."
stands alone on the next line.

**How to reproduce**: start a workspace with the e2e fake agent, commit, press **Review**. The
Files page's sidebar is at its default width (the `Resizer`'s default; clear the browser's
`symbiote.viewer.widths`). Both themes, 1x.

**Where to look**:
- `packages/viewer/src/diff/ReviewTab.tsx:141-146`: `…in its panel (` then `<kbd>c</kbd>).`.
  JSX drops the line break, so the text is `(` + `<kbd>` + `).`.
- `packages/viewer/src/ui/controls.css:436-447`: `kbd` is `display: inline-block`. An atomic
  inline is a break opportunity on both sides, so the line can break between the chip and `).`.
- The same shape: `packages/viewer/src/shell/Sidenav.tsx:410`, "Start one (<kbd>n</kbd>): …".

**Out of scope**: the hint's words, the sidebar's width, `kbd`'s look.

**Done when**: at any sidebar width, `(c).` stays together (and `(n):` in the sidenav's empty
state). Nothing else in the review tab moves.

## Evidence

- **Reproduced**: [shot](../images/chore-improvement-audit/review-hint-wrap.png), light theme,
  1x, enlarged 2×, from the audit's workspace tour (`review-files-light.png`).

## Approach

- Wrap the bracket, the chip and the punctuation in one `<span className="keep">`, with `.keep {
  white-space: nowrap }` in `ui/controls.css`. Check the name is free first: `grep -rn '^\.keep'
  src --include=*.css`.
- Apply it in both places found: `ReviewTab.tsx:143-144` and `Sidenav.tsx:410`. Then search for
  more: `grep -rn -B1 "^\s*<kbd" src --include=*.tsx`.
- Not `display: inline` on `kbd`: its padding and border are drawn as a chip (the style skill).

## Tests first

`packages/viewer/e2e/reviews.spec.ts` (or `review.spec.ts`): with the sidebar at 240, 280 and
320 px (the `Resizer`'s keys), the `.review-empty` paragraph's `kbd` and the text node after it
share one line box: the `)`'s `Range` top equals the `kbd`'s, ±2 px. It fails today at the
default width.

## Verification

- `pnpm check`, `pnpm build`, `pnpm test:e2e`.
- `viewer-check`: a screenshot of the review tab with no comment, both themes, at the default
  width and at the narrowest, and the sidenav's empty state.
- The `symbiote-style` skill: no new spacing value, no new colour.
