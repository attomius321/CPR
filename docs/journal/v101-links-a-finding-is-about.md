# Journal: V101 — Draw the links a finding is about

[Index](../JOURNAL.md) · [Plan](../plan/v101-links-a-finding-is-about.md)

## V101 spike — links Focus does not draw (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

90 of the 405 symbols with findings (22 %) are linked only by type references, which the canvas
hides by default, so Focus draws them alone. On Bitwarden 737ee3f, Focus on the warned constructor
drew 1 card while the panel listed 8 links
([shot](../../spikes/graph-usability/shots/p04-focus-draws-no-users-dark.png)). 2,290 of 6,624
changed symbols (35 %) have some links hidden.

Built on `feature/v101-links-a-finding-is-about` (next entry).

## V101 — the links a finding is about (2026-11-11, branch `feature/v101-links-a-finding-is-about`)

Focus lays out every kind of link in the picked symbol's neighbourhood, type references whatever
the toggle. Outside Focus, the layout carries the type references between drawn symbols, after
placement, and a pick raises its own, as its calls. The detail panel marks a user or use that is
not on the canvas and, when Focus would draw them, says to press `f`. The legend names the dotted
line. Decisions 971–972.

**Learned**:
- **Focus's set was right; the layout dropped it.** `neighbourhood` already held every kind of
  link. The edge filter dropped the type references, and `drawnSymbols` then dropped every
  unchanged neighbour only they linked: Bitwarden's constructor kept 1 of its 9, `MergerOptions` 2
  (itself and `merger`, a changed one, drawn with no edge).
- **A collapsed group is not on the canvas for a pick it is not linked to.** On Bitwarden, 5 of
  the constructor's 8 uses (`OrganizationService`, `I18nService`…) are grouped under a spec's
  `createComponent` and a story's `default`, far from the pick. Counting them as on the canvas,
  the first build marked 2 while the canvas drew 1 edge. Only the pick's own groups count now.
- **React Flow's `hidden` is not free.** `useVisibleEdgeIds` checks every edge it is given for
  visibility, hidden ones too; the wrapper only returns null after. The hidden type references are
  a list of their own, never handed over but for the pick's.
- **The plan's "out while moving" would blink.** 4 of the 5 walked graphs are under
  `MOVING_EDGE_LIMIT` and draw every edge while moving: keeping the pick's type references out
  would hide only them on every pan. They stay, as its calls do.
- **Dots cost a moving view; the count of edges did not.** With the refactor's `AgentKind`
  picked, its 30 raised type references made a drag 2.3 times as long as `main`'s (1,542 against
  673 ms), with no long frame to show for it: each frame about 39 ms instead of 17. Without
  `stroke-dasharray` the drag took 672 ms, and `main` drags `startViewServer` with 97 solid
  raised calls in 689–707 ms. React Flow 12 draws each edge in an `<svg>` of its own, inside the
  viewport it moves; a raised edge with `will-change: transform` is a layer that moves with it:
  672 ms. `interactions.mjs` missed it: its pick has few type references. Counting edges was not
  enough; timing a drag with the worst pick found it.
- **The type references between drawn symbols are few.** 9 on the small fix, 40 on Bitwarden, 41
  on Qwik, 121 on the feature, 472 on the refactor; at most 30 for one symbol (the refactor's
  `AgentKind`).

**Verification**: tests first. `flow.test.ts`'s five V101 cases and `review.test.ts`'s two failed
as not functions or `undefined` (`layoutView`, `hiddenEdges`, `onCanvas`); the narrowed `onCanvas`
case failed again on the first build (a member of another symbol's group counted). The two e2e
tests in `review.spec.ts`, on the detectors fixture, failed on `main`'s code: Focus on `Shape`
drew 3 of its 5 cards, a pick raised 0 type references. `pnpm check`: 3,499 unit tests. `pnpm
build`. `pnpm test:e2e`: the viewer's 455 and the nexus's 32 passed. A first full run had 2
failures in `pick.spec.ts` (V99's zoom tests, timing under load): 32 of 32 passed alone
(`--repeat-each 4`), and the canvas's height at their 1440 × 900 is `main`'s.

Real graphs, `main`'s `git archive` build against this branch's: Focus on Bitwarden's
constructor draws 9 cards and 8 edges (1 and 0 before), on `MergerOptions` 9 and 9 (2 and 0);
the panel marks 7 of each's 8 links outside Focus. Every layout's nodes, edges and file edges are
identical to `main`'s on the five graphs. While a view moves, React Flow is handed 0.7–2.0 more
edges per pick on average, 30 at most. A 40-step drag with the worst pick (`AgentKind`) took
1,542 ms before the raised edges' layer and 672 ms after (`main` 671–675); `interactions.mjs`,
three alternated runs per build on Bitwarden and the refactor, equal within noise. Shots of both
Focus views and the panel, both themes, before and after: `docs/images/v101-links-a-finding-is-about/`.

Not verified: the app's window (Electron, software compositing on WSL); every timing and shot is
headless Chromium. A layer per raised edge costs memory: a pick shows at most its degree in view
(97 on the refactor), not measured beyond the drag's time.
