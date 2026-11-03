# Journal: Fix — loadings that stood still

[Index](../JOURNAL.md)

## Fix — loadings that stood still (2026-11-03, branch `fix/static-loadings`)

The person: some loadings are static and should be a loader; check them across the app. Their
screenshot: a workspace's step at work, its hexagon holding the loader arc, not turning. Then: the
review page's loading lines feel static too, and "everything that should be moving as a loading,
should be a loading".

**Learned**:
- **The arc turned in one place.** `SpinIcon` was drawn still; the one rule that turned it was
  `.sidenav .ws-row-icon.spinning .icon`. Every other place that drew it stood still: a
  workspace's pipeline step at work (the screenshot), the merge page's pill, steps, merger agent
  and "live" label, the status bar. `RunningIcon` (V88: "drawn still") was the icon of every run
  status label, the review page's running step, the Graph tab while it builds and the Overview's
  working row. Only the state dots' comet and the Hive Run tab's `.run-spinner` moved by
  themselves.
- **The review page's bar was a picture of progress**: its running segment a fixed gradient, 55 %
  amber, whatever the step's time. Nothing measures a step's progress, so it now sweeps a band
  instead of claiming a fill; the measured bars (a pipeline step against its last run, a merge's
  commands) already move with their numbers and stay as they were.
- **58 "…ing…" phrases in the viewer and 5 in the nexus were words alone**: loading lines
  ("Loading graph…", "Reading the diff…", "Listing workspaces…") and busy buttons ("Working…",
  "Pushing…", "Cleaning up…"), plus the workspaces' and Git's placeholder outlines, which did not
  pulse. Three came from pure modules (Compare's "Finding where … forked…", a conflicted file's
  "Resolving…", Hive's check "reading…"): each now carries a flag (`finding`, `resolving`,
  `reading`) its renderer draws as a loading.
- **A loading line is not a live region by default.** Giving every `Loading` `role="status"` broke
  9 workspace e2e tests that find the page's one status line by its role ("Looking for it…" became
  a second one); the lines had none before. `Loading` takes `status` for the one that had it
  ("Laying out…").
- **Fixed at the cause**: the arc turns by its own class (`.icon.spin`, `ui/loading.css`), not by
  where it sits; the sidenav's rule is gone. `RunningIcon` stays the still icon of a count or a
  past event (the Overview's figures, the day's feed); the status bar's arc turns only while its
  count is above 0. Everything still holds without motion (`prefers-reduced-motion`), as the
  sidenav's arc did.

**Verification**: `test/loading.test.ts` (7 tests), red first on `main`'s code for the right
reasons: the arc has no `spin` class and no rule turns it, a run label's icon is still, 58 bare
phrases, the bar's running segment and the outlines have no animation (`Loading` a stub that drew
words alone). Green after. The nexus's `page.test.ts` the same way (5 bare phrases; `loading`,
`spin` among the viewer's classes it uses). e2e: `analyzing.spec.ts` checks the bar's sweep, the
running step's arc, the head's label and the Graph tab's icon each have an animation, and none
under reduced motion; `workspaces.spec.ts` the pipeline's step at work and "Stopping the agent…"
turn (`icon-spin`); the sidenav's two checks moved from `state-spin` to `icon-spin`. `pnpm check`:
226 files, 3,068 tests. `pnpm test:e2e`: 422 of 424 in the viewer, the two
`terminal-view.spec.ts:165` (a known flake under load) and `nucleus-activity.spec.ts:63` (its
report after a restart, not shown in 15 s); both 3 of 3 alone; the nexus 20 of 20. Pictures of
the review page while it analyzes (both themes, every animation paused at 200 and 700 ms: the
band at the running segment's start, then its middle; the run label's and the Graph tab's arcs at
different angles) and Git's "Listing commits…" (the arc 1.15 em before the words, on their line).
Not verified: the desktop app's window (the pictures are headless Chromium).
