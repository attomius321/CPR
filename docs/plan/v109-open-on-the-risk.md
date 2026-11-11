# V109 — Open the graph on the riskiest finding

[Index](../PLAN.md) · [Journal](../journal/v109-open-on-the-risk.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v109-open-on-the-risk` (the
workspace's, from `main` at `bc24845`); planned 2026-11-10 by the graph usability spike
(`spike/graph-usability`). The plan asked to check first that the person still zooms before their
first pick once V99–V101 are in; the person started this workspace to build it, after V99–V101
merged.

**Kind** feature (milestone) · **Branch** `feature/v109-open-on-the-risk` · **Size** M ·
**Depends on** V99, V100, V101 · **Rank** 12 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**: when a change has a warning or an error, the Graph page's first view is its
riskiest finding: that symbol with everything linked to it (Focus, with type references from
V101), at the reading zoom (V99), its panel open. One key (`F`, or Esc then `f`) shows the whole
change as today. A change with only infos, or none, opens as today.

**Where to look**:
- `packages/viewer/src/diff/App.tsx` (`selected`, `focus`, `tab`'s first value: Findings when
  there are findings).
- `src/diff/Canvas.tsx` (the first fit, :184–203).
- Decisions 886–890 (V93: the first layout fitted whole, at most at 1×) and 431 (a review opens on
  Files: unchanged; this is the Graph page's first view).

**Out of scope**: the Files page's first file (V102).

**Done when**:
- The feature's merge opens Graph on `Route` with its 12 users drawn, readable, the panel open.
- One key shows the whole change; reloading with `?view=graph` keeps the person's last choice.
- A change with no warning opens as today.

## Problem (the spike's G1)

On 24 of the last 26 merges into `main` with code, the first view draws names under 11 px; 19
open on the map ([shot](../../spikes/graph-usability/shots/p01-first-view-feature-dark.png)). The
first screen tells a reviewer where the change is, not what is risky in it.

**Why last**: once V99–V101 exist, the riskiest finding is one click away and lands readable with
its links. This plan then saves about 3 s per review, and gives up the whole-change view the person
chose in V93. It is worth building only if the person still zooms before the first pick.

## Design

- On the first layout of a change whose findings include a warning or an error, `App.tsx` picks
  the first such finding's symbol and turns Focus on, before the first fit. The canvas fits the
  focused view at the reading zoom.
- The whole change is one key away, and the choice is kept in the browser (`stored.ts`), so a
  person who prefers the whole view keeps it.

## Verification

1. e2e: a fixture with a warning opens focused on its symbol; one with infos only opens whole.
2. Real graphs: first paint on the feature's and the refactor's merges against `main`
   (`measure.mjs`), 3 rounds.
3. Shots, both themes.

**Risks**

| Risk | Mitigation |
|---|---|
| The person loses the overview chosen in V93 | One key back, remembered per browser; only when there is a warning |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 986 | The Graph page's first view (amends 886's first fit, and 966 for the first fit and Focus) | **With a warning or an error: the first such finding's symbol (the first error the Findings tab lists, else its first warning), focused, its panel open, readable: when the whole fit would draw its name under 11 px, the first fit and Focus's fit bring it to the reading zoom instead. Otherwise, or once the person chose it, the whole change fitted. `F` goes to the whole change from any pick and to the riskiest finding from the whole; the choice is kept in the browser, and the page opens on it next time** | 24 of 26 first views were unreadable; as built, see below |

## As built

Built as planned, decision 986, with the changes below. Tests first: `test/first-view.test.ts`
(12 tests) failed with no module, and `e2e/first-view.spec.ts` failed 5 of its 6 tests on the
build before the change: nothing was picked on open. The sixth, a change with only notes opening
whole, passed before and after, as it should. Two came later: F from another pick (with the key's
rule below) and a head's pill clicked on Files.

- **The first view is set while App renders, not in an effect.** `useFirstView.ts` picks the
  riskiest symbol and turns Focus on the first time the Graph page shows a graph, with nothing
  picked yet. Set in an effect, the worker would lay out the whole change first, and the canvas
  would fit and draw it before the focused view. A pick carried from Files (V104's `g` on a line)
  is the person's and is kept; a pill clicked on Files opens the Graph page on the risk too.
- **The riskiest finding is the Findings tab's**: its first error, else its first warning
  (`riskiest` in `diff/first-view.ts`, over `foldFindings`' list), so the head's first pill and
  the tab's first row are about it. A finding whose symbol the graph does not hold is skipped.
- **Readable, also when the focus is wide.** The plan's "fits the focused view at the reading
  zoom" became a rule shared by the first fit and Focus's fit (`unreadablePick` in
  `Canvas.tsx`): the focused view is fitted whole, at most at the reading zoom, unless that fit
  would draw the pick's name under 11 px; then the pick comes to the reading zoom, its neighbours
  around it (966's rule). Applied to the first fit only, the next run of the canvas's effect took
  Focus's branch and fitted the whole neighbourhood again: `callers` at 1440 × 900 landed at
  0.838 (10 px). A pick carried from Files lands readable on its first fit by the same rule.
- **The pick's first move is a fit, not `setCenter`.** React Flow's own first fit (its `fitView`
  prop) waits for the nodes to be measured and landed after a move made in the canvas's first
  frame: 1.25 was undone, back to 0.903. A `fitView` of the pick's node clamped to the reading
  zoom replaces the queued fit's options, so the view lands once.
- **F's rule**: from any pick, the whole change; with nothing picked, the riskiest finding. A
  flip of the kept choice alone could leave F doing nothing visible (after Esc, with the whole
  change shown and the risk kept). The canvas frames the new view as its first (`framing`,
  animated). F does nothing on a change with no error or warning: it has one first view.
- **F lives in `useFirstView.ts`, not `useDiffKeys.ts`**, which V108's workspace was editing
  side by side; its listener has the same guard (no field typed in, no modifier). The key is in
  the Graph page's help and in the reference's keys. Moving it into `useDiffKeys` is a later
  tidy-up.
- **31 e2e tests in 15 specs assumed the whole first view** (`callers`, `detectors`, `projects`
  and the pull requests all have an error or a warning). None tests the first view, so each now
  starts from it as a person who keeps it does: `wholeFirst(page)` in the e2e harness.
- **A native tooltip in the panel** (a separate commit): the panel's code rows had a `title`,
  written as a shorthand in a spread that the unit guard did not read. `tooltips.spec.ts` found it
  once the panel opened on the first view. The guard reads a shorthand now, and the rows take
  `tip()`.

**Results.** Measured at the person's screen, 2560 × 1440, 1x, in headless Chromium, `main`'s
build (`bc24845`, from `git archive`) against this branch's, on the graph usability spike's 26
merges with code (made again with the CLI, each merge's second parent against its first from
their merge base):

| | `main` | V109 |
|---|---|---|
| First views with names at 11 px or more | 4 of 26 | 17 of 26 |
| First views on the map | 18 of 26 | 5 of 26 |
| Merges with a warning (none has an error) | 13 | 13, each opened on it: zoom 0.929–1.25 (median 1.25), from 0.058–0.272 (median 0.131) |
| Merges with only infos, or none | 13 | 13, first views identical (zoom and nodes) |

- **The feature's merge** (`11610c73`) opens on `Route` at 1.076, names at 12.9 px, `Route` and
  its 12 users in view, the panel open
  ([before](../images/v109-open-on-the-risk/feature-first-view-before-dark.png),
  [after](../images/v109-open-on-the-risk/feature-first-view-after-dark.png); light:
  [before](../images/v109-open-on-the-risk/feature-first-view-before-light.png),
  [after](../images/v109-open-on-the-risk/feature-first-view-after-light.png)). On `main` it opened
  on the map at 0.179 (2.1 px). The refactor (`eb807773`) opens on `version` at 0.929 (11.2 px),
  Bitwarden's `737ee3f` on its first warning at 1.219.
- **11 of the 13 risks show their whole focused neighbourhood**; 4 of them draw one to three
  symbols (an orphan with no user, or a removed symbol and its one user). On 2, Focus's whole
  fit would draw names under 11 px (`291ef48c`: 0.856, 10.3 px; `98e28e23`: 0.736, 8.8 px), so
  the pick comes to 1.25 with 7 of the 16 symbols its focus draws in view, and 3 of 13 (966's
  reading zoom, not a floor at 11 px).
- **First paint** (`scripts/viewer/measure.mjs` of each build, alternated, 3 rounds, median):
  the feature's merge 322 → 202 ms, the refactor 870 → 275 ms, Bitwarden 309 → 275 ms; page
  elements 3,717 → 530, 10,446 → 477, 3,122 → 491. The whole change is laid out when `F` asks for
  it: 84, 314 and 72 ms to it drawn (median of 3), landing on `main`'s first fit (0.179, 0.058,
  0.206). With the whole change kept, the three open exactly as on `main`.
- **Tests**: `test/first-view.test.ts` (12), `test/tooltips.test.ts` (the shorthand guard),
  `e2e/first-view.spec.ts` (8); 31 tests in 15 specs start from the whole change
  (`wholeFirst`). `pnpm check` (3,547 unit tests), `pnpm build`; `pnpm test:e2e`: 474 of 475
  viewer tests and the nexus's 32, the one failure a 500 ms timing test under other workspaces'
  load that passed alone (the journal).
