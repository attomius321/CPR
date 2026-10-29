# Journal: V76 — The Review tab's layout: sections, labels, a Merge into that fits

[Index](../JOURNAL.md) · [Plan](../plan/v76-review-tab-layout.md)

## V76 spike — the Review tab at the sidebar's width (2026-10-29, branch `feature/review-merge-layout`)

A scratch repository (`main`; `agent`, which merges cleanly; `conflict`, which does not; two
branches of 46 and 50 characters) served by `symbiote view` from `main`'s build (5c34635), the
Review tab screenshot on the Files and Graph pages at 300 and 480 px of sidebar, dark and light,
before and after an approval, with the sidebar's elements measured in the page.

**Learned**:
- **A select is as wide as its longest option.** Merge into's branch dropdown was 423 px in a
  298 px panel (the 50-character branch), so the tab's list scrolled sideways (435 px of content)
  and `main` ran off the card. Nothing in `controls.css` bounds a select's width.
- **The sidebar scrolls though it hides its overflow.** On the Graph page the three tabs take
  325 px; clicking Review scrolls the `overflow: hidden` sidebar to show it (`scrollLeft` 26), and
  every row under the tabs loses 26 px at its left. The Files page, the review's default, has two
  tabs (169 px) and does not.
- **Merge into is the workspace head's row, wrapped.** `.merge-control` is a wrapping flex row
  made for the head; in a 268 px column the button, the branch dropdown and the strategy dropdown
  fall onto three ragged lines.

## V76 — the Review tab in sections, Merge into's dropdowns in the sidebar (2026-10-29, branch `feature/review-merge-layout`)

The Review tab in three sections with heads — Comments, Your review, Merge — 16 px in, a hairline
between them; the summary labelled, the radios under a Verdict legend, what finishing recorded in
a box of its state's tint; Merge into a grid whose dropdowns never outgrow the panel; the sidebar's
tab strip scrolling on its own. Decisions 557–560.

**Learned**:
- **A grid track of `minmax(0, 1fr)` is not enough for a select**: a grid item's automatic
  minimum is its min-content width, which for a select is its longest option. The select needs
  its own `min-width: 0` (and `width: 100%`) to fill the track and no more.
- **Stacked beside the button, the second dropdown was too narrow at the default width**: 160 px,
  "with a merge c…". A container query on the Merge section puts it under both below 300 px of
  section. A container's layout containment makes it the containing block of `position: fixed`
  descendants (the trap the start page met); the section has none, as the tooltips and `Help`
  draw on `document.body`.
- **The shrink rule did nothing in a workspace's head**: in that flex row the state's words have
  `min-width: 0` and shrank first, to "Approved: as…". The dropdown needed a cap (240 px).
- **A fieldset's legend takes no part in its flex `gap`**: Chromium draws it outside the
  fieldset's anonymous content box, so its space under it is a margin.
- **`$!` after `cd … && node … &` is the subshell's PID**, not node's: stopping it left the
  scratch `symbiote view` serving the old build on its port, and the next one failed with
  `EADDRINUSE` while the screenshots came from the old server. `(exec env … node …) &`, then the
  PID from `pgrep -f` of node's own command line.

**Verification**: V76's e2e (`reviews.spec.ts`, "the Review tab in sections at the sidebar's width")
red first for the right reason (the sidebar slid 22 px; with soft checks: no sections, no label),
green after at 300 and 480 px of sidebar. `pnpm check`: 2,205 tests. `pnpm build`. `pnpm test:e2e`:
339 viewer and 15 nexus tests passed. Screenshots before (5c34635's build) and after, 1440 × 900 at
1×, dark and light: the Files and Graph pages at 300 and 480 px, the clean and the conflicting
branch, before and after Approve, a long branch picked, a fast-forward the target cannot take, a
GitHub pull request before and after posting, a workspace's review and its head; the tab's words at
3× for uneven gaps between letters.

Not verified: the native list of options when open (headless Chromium does not draw it: it is
the browser's, as wide as its longest name); the desktop app's window (the page is the browser's).

## V76c — Files and Graph at the review head's end (2026-10-29, branch `feature/review-merge-layout`)

Asked after V76b: the switch between Files and Graph somewhere static. It was the second of the
head's right-aligned actions: the Graph page's toggles moved it 293 px left at 1440 px, and where
the Graph page's actions wrapped under the title (under ~850 px of main area) and the Files page's
did not, 46 px down too. `PageHead` takes an `end`, kept on the title's line at every width; the
diff page puts the switch there, the window's buttons after it under `symbiote pr`. Decision 568.

**Learned**:
- **Last of the actions was not enough.** It held the switch's x at every width the actions fit
  beside the title, but the head decides to wrap the actions under the title by their width,
  which differs page to page: at 700 px the switch sat at y 59 on Files and y 105 on Graph. The
  end is outside the box that wraps.
- **Under 640 px the comparison means nothing**: the diff's page is wider than the window, and a
  click on a tab scrolls it sideways to show the tab, so the same switch reads 10–50 px apart.
  `main` does the same; the test stops at 700.
- **Decision numbers moved under the branch**: 561–567 were taken meanwhile by V77 in another
  workspace (`feature/workspaces-history`); this one is 568.

**Verification**: V76c's e2e (`files.spec.ts`, "the Files and Graph switch stays put") red first
(the keys' help after the switch, 36 px), green at 1440, 820 and 700 px. The switch measured on
both pages at 1440, 1100, 820, 760, 700, 660 and 640 px: one place each. Screenshots of the head,
both pages, dark and light, at 1440, 1100, 820 and 700, and under `symbiote pr`. `pnpm check`:
2,205 tests. `pnpm test:e2e`: 340 viewer and 15 nexus tests passed.
