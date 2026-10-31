# Journal: Fix — a commit's menu opens at once

[Index](../JOURNAL.md)

## Fix — Review out of a commit's menu, no wait for every branch review (2026-10-31, branch `fix/git-right-click-on-commit`)

Asked: "Right clicking on a commit now in git page is so slow... waits too much until the
dropdown is opened." A commit's menu (right-click, "⋯", `c`, `r`) opened only once three reads
had answered: `api/refs`, `api/status` and `api/reviews`. On this repository's running
`symbiote view`, three times each: refs 8–9 ms, status 16–17 ms, reviews **1.5–2.2 s**. The
reviews read is `branchReviews().list()` (`packages/cli/src/reviews.ts`): for each of the 113
reviewed branches, one after another, the review's file, its workspace's record, and about five
git processes (`cat-file -e` for the review's head, two `rev-list` for the commits since, then
`cat-file -e` and `merge-base --is-ancestor` for whether the approval was merged): about 570 in
a row. It grows with every review made, so the menu got slower as the reviews piled up. The menu
read it only for its Review submenu (V15): the notes "2 reviewed · 1 commit since" and which
branch was the default.

The person does not use the row's Review: it is gone, with its `r` key. A branch is still
reviewed from its workspace (**Review**) or from the branches panel (right-click a branch,
**Review**), which never read the list. The menu now waits for refs and status only. The badges'
marks still come from the same list, read when the page opens and when it comes back into view,
in the background: 1.5 s there delays only the marks.

Not changed: `api/reviews` still costs 1.5 s on this repository. Running the branches in
parallel, or one git call for all of them, would shorten it; that is the server's cost and the
marks', not the menu's, and is left for its own fix.

**Verification**: an e2e test (`checkout.spec.ts`) holds every `api/reviews` read the page makes
after it has listed, right-clicks a commit and expects the menu: before the fix no menu item ever
appeared (the menu waited on the held read; 0 elements for 5 s); after, the menu's nine items.
The specs that started a review from the row's menu (`reviews.spec.ts`, `merges.spec.ts`) start
it from the branches panel; the default branch's review (`main` with an unpushed commit) works
from there too. `reviewChoices` and its unit tests are gone; the marks' tests stay.

Measured in Chromium, right-click to the menu drawn, six commits each, on a clone of this
repository with its 113 reviews copied in (one CLI, `SYMBIOTE_VIEWER_DIR` set to main's bundle,
then to this branch's): main 604–1,259 ms (median 636), this branch 53–70 ms (median 66). The
clone has fewer local branches than the checkout, so its reviews read took 0.6–0.9 s against the
checkout's 1.5–2.2 s: on the checkout the menu waited that long.

`pnpm check`: 2,524 unit tests. E2E: 360 of 362 viewer specs and the 20 of nexus; the two that
failed are `commits.spec.ts`'s Git keys help (it still said "r reviews", fixed, 12/12 since) and
`workspaces.spec.ts:959` (a sidenav card 7 px off mid-transition under the full run's load; 3/3
alone, nothing of the Git page).
