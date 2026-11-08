# Fix — The Overview at 1024 px: five figures on one row, every list a row at least

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V6)

**Status:** planned (2026-11-06), to be built on branch `fix/overview-narrow` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/overview-narrow` · **Size** S · **Depends on** none · **Plan** P27 of
51 (the audit's order)

## The brief

**What happens**: in a 1024×700 window the Overview's five figures wrap to four plus one. The fifth
("Time to merge") takes a row of its own (~100 px), so "Waiting for you" shows 1.5 of its rows and
"Agents at work" shows its head and no row. The head's line is cut ("6 merges in…").

**How to reproduce**: `serveWorkspaces()` with `mockOverview(page, normalMocks())`
(`packages/viewer/e2e/overview-data.ts`), viewport 1024×700, open `/overview`.

**Where to look**:
- `packages/viewer/src/ui/figures.css:9-12`: `.figures` is
  `grid-template-columns: repeat(auto-fit, minmax(176px, 1fr))`. Five need 880 px. At 1024 the main
  area is ~764 px wide (the sidenav takes ~260), so the card holds four.
- `packages/viewer/src/overview/Overview.css:1-15` (the page never scrolls; how list cards are cut),
  `:46-50` (the figures' card), `:124-135` (the one-column layout under 1,340 px).
- `packages/viewer/e2e/overview.spec.ts:342-346`: `FIT_SIZES` checks 1440×900, 1920×1080 and
  1366×768, none narrower.

**Out of scope**: the two-column layout above 1,340 px; Hive's Overview beyond the same figures
rule; the inbox's row design.

**Done when**:
- At 1024×700, normal and Hive mode, the five figures share one row.
- Every list card shows its head and at least one full row ("Agents at work" included).
- The head's line is never cut mid-word without an ellipsis.
- `FIT_SIZES` includes 1024×700 and passes, and `page-frame.spec.ts` passes unchanged.

## Evidence

Reproduced at 1x, light theme, normal mode's records:
[overview-1024x700.png](../images/chore-improvement-audit/overview-1024x700.png). Measured: the
figures card is two rows, ~200 px tall.

## Approach

- **Five columns from ~640 px of card**: `.figures` becomes
  `repeat(auto-fit, minmax(128px, 1fr))`. Check that each figure still fits its number, unit and
  line at 128 px, with Geist at 15 px (`--size-*`). Its words (`nothing to answer or review`) may
  wrap to two lines: allowed, the card is one row.
- Two figures keep a sparkline ("Merged this week"); at 128 px it shrinks or hides. Decide from a
  screenshot.
- **The head's line**: `text-overflow: ellipsis` on the line under the title, if
  `ui/page.css` does not already give it one, so it ends with "…" rather than a cut letter.
- Keep `Overview.css`'s rules: the page never scrolls. A card is cut to its minimum, a head and
  1.5 rows, before the inbox loses one. With the figures one row shorter, "Agents at work" gets
  its rows back with no change to those rules.

## Tests first

1. `overview.spec.ts`: add `[1024, 700]` to `FIT_SIZES`. Red today: "Agents at work" has no visible
   row.
2. A new assertion in the same spec: at 1024×700 every `.overview-card.figures .figure` has one `y`
   (one row). Red today.

## Verification

- `pnpm check`, `pnpm build`, `pnpm test:e2e`; `page-frame.spec.ts` unchanged.
- Screenshots at 1024×700, 1366×768 and 1440×900, normal and Hive, both themes (the `ui-audit`
  rule: every page at 1x).

**Risks**

| Risk | Mitigation |
|---|---|
| A figure's number and unit no longer fit at 128 px ("1.8 h median") | Measure the widest real value; the unit may wrap under the number |
