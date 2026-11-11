# Journal: V109 — Open the graph on the riskiest finding

[Index](../JOURNAL.md) · [Plan](../plan/v109-open-on-the-risk.md)

## V109 spike — the first view (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

24 of the last 26 merges open with names under 11 px, 19 on the map
([shot](../../spikes/graph-usability/shots/p01-first-view-feature-dark.png)). Once V99–V101 exist,
the riskiest finding is one click away and readable; this then saves about 3 s a review. To be
confirmed with the person first.

Not started.

## V109 — the Graph page opens on the riskiest finding (2026-11-11, branch `feature/v109-open-on-the-risk`)

A change with an error or a warning opens its Graph page on the first one the Findings tab lists:
its symbol picked and focused, its links and type references drawn, its panel open, its name
readable. `F` shows the whole change from any pick, and the riskiest finding from the whole; the
browser keeps the last choice and the page opens on it. A change with only notes, or none, opens
as before. Decision 986, amending 886's first fit and 966 for the first fit and Focus.

**Learned**:
- **React Flow's first fit lands after a move made in the canvas's first frame.** The `fitView`
  prop is queued until the nodes are measured. A `setCenter` to the risk at 1.25 was undone at
  once, back to the whole fit (0.903 on `callers` at 1440 × 900, `?graph=`). A `fitView` call
  replaces the queued fit's options: the pick's first move is a fit of its node, clamped to the
  reading zoom, and the view lands once.
- **A rule for the first fit alone did not hold.** With Focus on, any later run of the canvas's
  effect (the canvas's size arriving) fitted the whole neighbourhood again, at 0.838 (10 px).
  The readable floor is now Focus's too: when the whole fit would draw the pick under 11 px, the
  pick comes to the reading zoom. On the person's screen the three walked risks fit readable
  anyway (1.076, 0.929, 1.219); the floor is for small windows and wide neighbourhoods.
- **A first view set in an effect costs a whole layout.** The worker would lay out and the canvas
  fit and draw the whole change before the focused view. Set while App renders (once per graph),
  the first layout asked for is the focused one.
- **31 e2e tests in 15 specs started from the whole change without saying so.** Every e2e
  fixture drawn on the Graph page but two has an error or a warning. They now state it
  (`wholeFirst`), as a person who keeps the whole view does.
- **The open panel showed a native tooltip.** Its code rows had `{ onClick, title }` in a spread,
  a shorthand the unit guard did not read, and no spec opened the panel before hovering. Fixed in
  its own commit, the guard first.
- **Esc then `f` faster than the whole layout fits nothing**, as on `main`: when the layout
  arrives Focus is off and nothing is picked, so no branch of the canvas's effect fits it. A
  person is slower than the worker; `F` fits whatever the timing.
- **A pick at 820 px moves the page switch 100 px** (674 to 774), with or without V109: the
  panel narrows the head. Seen in `files.spec.ts`, left as it is.

**Verification**: tests first. `test/first-view.test.ts` (12 tests) failed with no module;
`e2e/first-view.spec.ts` failed 5 of its first 6 tests on the build before the change (nothing
picked on open), the sixth (only notes, opened whole) passing before and after. It has 8 now: F
from another pick, and a pill clicked on Files. The tooltip guard failed on `DetailPanel.tsx:492`
before its fix. The first full e2e run failed 31 tests in 15 specs, all on changes with an error
or a warning that the specs drew whole; they now start from the whole change (`wholeFirst`), and
the 15 specs passed again together. `pnpm check`: 3,547 unit tests. `pnpm build`. `pnpm test:e2e`:
474 of 475 viewer tests passed; `events.spec.ts:201`, a 500 ms timing test, failed while other
workspaces ran theirs (load average 19–24) and passed alone 3 times over (12 of 12). The nexus's
32 passed.

Real graphs, at 2560 × 1440, 1x, `main`'s `git archive` build against this one, on the spike's 26
merges with code: names at 11 px or more in 4 first views on `main`, 17 on V109; 13 merges have a
warning and all 13 open on it at 0.929–1.25 (from a median of 0.131, all on the map); the other 13
first views are identical. The feature's merge opens on `Route` at 1.076, its 12 users in view.
First paint (`measure.mjs`, alternated, 3 rounds, median): 322 → 202 ms (feature), 870 → 275 ms
(refactor), 309 → 275 ms (Bitwarden `737ee3f`); `F` then draws the whole change in 84, 314 and
72 ms, at `main`'s first fit. Shots of the feature's first view, both themes, before and after
(`docs/images/v109-open-on-the-risk/`).

Not verified: the app's window (Electron); every shot and timing is headless Chromium. The
spike's walk itself (about 3 s saved a review) was not timed again. On 2 of the 13 risks Focus's
whole fit is under 11 px (0.856 and 0.736), so the pick comes to 1.25 with half or fewer of its
neighbours in view; a floor at 11 px instead of the reading zoom would keep more of them, and is
the person's call.

