# Journal: V10b — Branches panel: every branch a click away

[Index](../JOURNAL.md) · [Plan](../plan/v10b-branches-panel.md)

## V10b spike — what a branches panel holds (2026-10-14, branch `milestone/v10b-branches-panel`)

Measured on this repository and the regression clones before refining V10's plan for the
panel, with `listRefs` (as the row menu calls it) and the commits page's order. Tips sit deep:
the median remote tip is row 155 here, 691–16,397 elsewhere (Bitwarden 9,165, its deepest
37,633), and only 4–74 tips per repository are in the first 200 rows — a branch cannot be
reached by scrolling. Bitwarden's 1,591 remote branches nest up to 3 folders deep (105 folders),
but 519 are in none: closed folders still leave a 624-entry list, so the filter is what makes it
short. Names: median 18–29 characters, p90 up to 58, the longest 133, against about 35 that fit
in 260 px. `listRefs` takes 4–23 ms. This repository has 14 local branches (13 tracking one),
the clones one each. The plan: tips' rows from the kept listing (`/api/history/refs`), Local and
Remotes by nested folder with a filter, a click to the tip row.

## V10b — Branches panel (2026-10-14, branch `milestone/v10b-branches-panel`)

A panel left of the commits lists local branches (ahead/behind, gone) and remote ones by nested
folder, with a filter and the review marks badges show; a click puts the cursor on the branch's
tip row anywhere in the history. `GET /api/history/refs` gives each tip's row in the kept
listing. From "This branch", a branch it does not list switches to every branch first. `/`
focuses the filter, Enter there goes to the first branch listed; under 900 px a "Branches"
button opens the panel over the rows.

**Learned**:
- The viewer blurs any text field on Escape (`App.tsx`), before a field's own handler can keep
  focus: the plan's "Escape clears, then leaves" lost to it in the first e2e run. Following the
  app's rule keeps the filter and the change list's search alike. A `type="search"` field also
  clears itself on Escape in Chromium; the filter is `type="text"`, as the search is.
- A panel beside the rows took 260 px from them, and rows with two long branch badges then
  pushed their date out of view at 900–1,100 px. Badges never shrank; `main` showed the same at
  800 px. Measuring each visible row's date against the list's edge, per width, found it; the
  screenshots at 1440 px did not.
- Chromium reads a large `style.top` back rounded (`1.20426e+06px` for 1,204,256 px) while
  drawing it exactly: read a deep row's place from its box, not its style.
- `requestAnimationFrame` before focusing: under 900 px the filter is not displayed until the
  panel opens, and focusing it in the same task does nothing.

**Verification**: tests first — 6 unit tests failed before the code; 7 of 7 new e2e tests fail
on `main`'s build. 619 unit tests, 82 e2e. Bitwarden (1,591 remote branches): the panel drawn
44–61 ms after the first rows, 628 entries; no animation frame over 50 ms while filtering or
going to the deepest tip (row 37,633, 89–94 ms to its row drawn with details); first rows as
`main`'s. Rows clipped from 800 to 1,920 px on this repository, Bitwarden and Qwik: 0 (before
the badge fix, 3–8 between 900 and 1,100 px). Not verified: Windows, macOS, Firefox, Safari.

Merged into main (2026-10-14). `main` verified after the merge: 619 unit tests, build, 82 e2e.
