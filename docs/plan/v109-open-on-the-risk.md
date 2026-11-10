# V109 — Open the graph on the riskiest finding

[Index](../PLAN.md) · [Journal](../journal/v109-open-on-the-risk.md)

**Status:** planned (2026-11-10), after V99–V101; written by the graph usability spike
(`spike/graph-usability`). Not started. Before starting, ask the person whether they still zoom
before their first pick once V99–V101 are in.

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
| 986 | The Graph page's first view (amends V93's first fit, 886–890) | **With a warning or an error: the first such finding's symbol, focused, at the reading zoom, its panel open; otherwise the whole change; one key between the two, remembered in the browser** | 24 of 26 first views were unreadable; to be confirmed after V99–V101 |
