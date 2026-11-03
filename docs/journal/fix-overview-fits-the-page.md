# Journal: Fix — The Overview fits the page: its cards scroll, not the page

[Index](../JOURNAL.md)

## Fix — The Overview fits the page: its cards scroll, not the page (2026-11-03, branch `fix/overview-fits-the-page`)

The person: the Overview scrolls as a whole page; its cards grow with their rows, the columns run
past the window and the figures scroll away. They want no page scroll: everything in the main
area, each card whose rows do not fit scrolling inside itself under its head.

**Learned**:
- **The cause was the grid's flex, not the cards' content.** `.overview-grid` was `flex: 1 0 auto`
  and every card `flex: none`, so the body grew to all the rows: with the proofs' records six
  times over (24 waiting, 12 agents, 6 merges, 18 merged today, 24 events; `manyRows` in
  `e2e/overview-data.ts`) the body was 3,799 px in an 802 px main area at 1440×900, 6,987 px at
  1280×800 (one column).
- **How the height is shared, and why.** The columns fill what the figures leave; an
  `OverviewCard`'s body scrolls under its head, a table's labels sticky. A list card of two rows
  or more keeps its rows while there is room. Without room, every list card but the inbox (Hive:
  in flight) is cut first, to a head and 1.5 rows (the half row says there is more), and only
  then does the inbox lose rows: it is the one list whose rows are the person's actions; the
  others are status the figures already count, or history. In flexbox that is a shrink factor of
  1,000 on the others against 1 on the inbox: a factor under 1 on the inbox alone would shrink it
  by only that fraction of what is left once the others freeze at their minimum. The last card
  of each column (Merged today, Today; Hive's Landed today, Events) takes the rest, so the
  Overview ends 12 px over the area's edge as every page does (`page-frame.spec.ts` now measures
  its bottom). A card with no list (usage, limits, a stopped workspace), or a list of one row or
  none, keeps its content's height: the minimum on Merging's one row had stretched it with 27 px
  of blank.
- **A column's minimum cannot be said in CSS.** A flex column's intrinsic height is its items'
  content heights, not their minimums, so the grid row cannot be sized to them. With the grid row
  cut to the area, the one-column layout at 1280×800 drew the work cards over the usage row
  (Merged today hidden under it), and the body's scroll height did not show it. So when even the
  minimums do not fit, that column scrolls by itself; the page never does, and the figures and
  the other column stay.
- **One column (under 1,100 px of main area):** the work cards, then usage (Hive: limits) at
  340 px and the events beside it in one row as tall as the usage (`contain: size` keeps the
  events' rows out of the row's height). Six cards stacked would need ~1,030 px at their
  minimums.
- **Where it fits**, the lowest window height (10 px steps) at which neither the page nor a
  column scrolls, cards cut to their minimum allowed: at 1440 px wide, 740 px with many rows,
  710 with the proofs' records (Hive 730 and 680); at 1280 px wide (one column) 940 and 910
  (Hive 1,060 with three stopped cards over in flight, and 890). Common sizes 1440×900,
  1920×1080 and 1366×768 fit in both modes with many rows.

**Verification**: two new e2e tests in `overview.spec.ts`, red first on `main`'s stylesheet (the
body 3,799 px in 802; no card with a list of its own): with many rows, in both modes at 1440×900,
1920×1080 and 1366×768, no page scrollbar, every list scrolls in its card with its head and its
table's labels kept, each card inside the main area, and every list card but the inbox (Hive: in
flight) at its minimum; with the proofs' records and with none, at 1920×1080, each card its
content's height (Merging's one row too: red with the empty-only rule) and the last card of each
column at the bottom. `page-frame.spec.ts` measures the Overview's bottom in both modes. Seen at
1x in both themes: normal mode many, as the proof and empty; Hive many, as the proof and with
nothing in flight; at 1440×900, 1920×1080, 1366×768, 1280×900, 1280×800 and 1440×700 (screenshots
in the ignored `packages/viewer/coverage/overview-fit/`). `pnpm check`: 225 files, 3,060 tests.
`pnpm test:e2e`: 425 of 426 in the viewer; the one, `nucleus-activity.spec.ts:63` (the Activity
tab's "Answered"), failed once in the full run and 1 of 9 alone on this branch, 0 of 9 on `main`;
the Nucleus page shares no code or CSS with the Overview. The nexus 21 of 21. Not verified: the
app's own window (Electron) and real scrollbars (headless Chromium hides them; a card's scrollbar
takes its width from the rows only while it scrolls).
