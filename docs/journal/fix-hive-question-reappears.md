# Journal: Fix — Hive's question drawn again after the arrival folded it

[Index](../JOURNAL.md)

## Fix — Hive's question drawn again after the arrival folded it (2026-11-03, branch `fix/hive-question-reappears`)

The person, in the app: turning Hive on from the question, the dialog folds away as designed,
then is drawn again for about a second, then disappears.

**Learned**:
- **A View Transition's layers end before the arrival does.** V92's arrival (decision 874) folds
  the question, fades its dim and lifts the Mind, its glow and the ring only in the transition's
  layers; the live elements stay at full opacity. The transition ends at 1.18 s (the reveal and
  the ring, its longest) and takes its layers with it, while `arrive()` closes the question and
  removes the Mind, glow and ring only in `finally`, after the pill has lit (1.54 s). For those
  0.36 s the live elements are drawn as they are: the whole question and its dim over Hive's page
  (frames 1200–1500 ms, each 50 ms, under Playwright's clock).
- **Hiding the question showed the next layer of the same fault**: with the question and its dim
  out, the frames 1200–1500 ms still drew the Mind, its glow and the ring at full strength. All five
  live elements end at opacity 0 in their layers (`hive-fold`, `hive-undim`, `hive-lift`,
  `hive-light`, `hive-ring`), so none may be drawn after its layer ends.
- **The fix is the cause's**: each live element goes out (a 0 s `hive-folded` animation to
  opacity 0 under `data-hive-arriving`) at the moment its layer ends, the layer already at 0 then:
  the question 0.53 s, the Mind and glow 0.84 s, the dim 0.86 s, the ring 1.18 s. Moving `close()`
  to `transition.finished` instead would race React's commit against the frame that drops the
  layers. The five holds start in the same frame as the six layers' animations (and the pill's):
  one `startTime` for all, in 3 of 3 unpaused runs.
- **A frame-exact test needs the whole page still**: the arrival's animations paused the moment
  `data-hive-arriving` is set (a `MutationObserver` on `document`: the init script runs before
  there is a `documentElement`), the transition's `finish()`ed once t passes them (its layers then
  go, as at 1.18 s), the pill's once t passes 1.54 s (`close()` then runs). A cancelled
  pseudo-element animation `finish()`ed again comes back in `getAnimations()`: skip idle and
  finished ones. After 1.54 s Alpha Ceph's own play (V86) starts in the sidenav and moved 11 px of
  its icon between two pictures: masked.
- **The five designed frames reproduce byte for byte** only with the clock installed at a fixed
  time and paused at a fixed time before the question opens: the question's art runs on the fake
  `requestAnimationFrame`, whose phase otherwise follows the real time before `pauseAt`. The
  temporary repository's name, head and Hive's `since` are rewritten in the API's answers
  (`page.route`); a screenshot mask is drawn under a View Transition's layers and hides nothing.

**Verification**: the new e2e (`hive-pages.spec.ts`, "the question is never drawn again once it
folded") draws each frame every 50 ms from 550 to 1700 ms twice, as it is and with what is gone by
then hidden (the question; from 0.86 s its dim, the Mind and glow; from 1.18 s the ring), and
compares the pixels; `.hq` is gone at 1700 ms. Red first on `main`'s stylesheet: frames 1200–1500
drawn; red with the question's rules alone: 1200–1500 (the layers); green with the fix, 5 of 5 runs
of the file. The five designed frames (260, 560, 800, 1000, 1600 ms, a spec in the ignored
`coverage/`): byte for byte `main`'s in 3 runs of the fix against 5 of `main` (one of `main`'s
own 1600 ms frames differed from its other four by 5 px of Alpha Ceph's icon).

In the app (Electron 44, a private Xvfb, 1440 × 900, each animation frame from the click to 1.8 s
logged in the page): on `main`'s build, 21 frames after the transition's layers ended (from
1.26–1.29 s to 1.61–1.62 s after the click, 3 runs) drew the question, its dim, the Mind, its glow
and the ring at opacity 1, and a screenshot at 1.31–1.45 s shows the whole question over Hive's
page; with the fix, 0 such frames in 3 runs, and the screenshot at 1.27–1.39 s shows Hive's page
alone. `pnpm check`: 225 files, 3,060 tests. `pnpm test:e2e`: 423 of 424 in the viewer, the one
`terminal-view.spec.ts:165` (an agent's attach count, a known flake under load; 6 of 6 alone);
the nexus 20 of 20. Not verified: WSLg's own display (the app measured on Xvfb).

Merged into main (2026-11-03).
