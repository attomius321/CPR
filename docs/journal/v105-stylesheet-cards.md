# Journal: V105 — Stylesheet rules as one card per file

[Index](../JOURNAL.md) · [Plan](../plan/v105-stylesheet-cards.md)

## V105 spike — stylesheet rules as symbols (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

On the last 26 merges into `main` with code, 2,487 of 5,425 changed symbols (46 %) are CSS rules, on
17 merges; 33–94 % on the 7 redesign merges. They drew the largest block on the feature's map
([shot](../../spikes/graph-usability/shots/p15-stylesheet-rules-dark.png)).

## V105 — a stylesheet as one card, one row and one item (2026-11-11, branch `feature/v105-stylesheet-cards`)

A file whose changed symbols are all stylesheet symbols, two or more, is one card on the canvas,
its symbols out of the layout and their links on the card, opened in place like a group; one row
of the change list, one item of the progress and of `j`/`k`, one mark for all its rules.
Decisions 979–980. Built in `graph/flow.ts` (`stylesheetFiles`, `foldStylesheets`), a new
`StylesheetNode`, `diff/review.ts` (`reviewItems`) and `Sidebar.tsx`; `App.tsx`,
`DetailPanel.tsx` and `useDiffKeys.ts`, V104's files this round, are untouched.

**Learned**:
- **The card takes the whole file, before neighbours are counted.** On `main`, each of
  IssuesPage.css's 62 rules had a "uses" group of its own
  ([shot](../images/v105-stylesheet-cards/feature-pick-before-dark.png)). Folded before
  `summarize`, the card is one changed node, so its 79 tokens are one group; and a graph with no
  card lays out as before, since the fold hands back the nodes and edges in view untouched.
- **The links are the bulk.** V88's graph has 11,288 references between stylesheet symbols and
  1,098 from code into them. One link per neighbour and direction took its default view from
  4,700 laid-out edges to 1,019, and its open from 914–929 ms to 480–513.
- **A pick inside a card must not open it.** A group of neighbours opens when one of its members
  is picked (its members are in `hidden`, and `App.tsx` opens whatever holds a pick). Done for
  cards, the first `j` into a stylesheet would put its block back and leave it there; a review
  walked with `j` would end with every card open. The card is ringed instead, and brought into
  view (`drawnAs`).
- **One item means one mark everywhere.** `j` stops on a stylesheet at its first rule; `r` there
  would mark that rule alone, and the row read as not reviewed, with no way to see which rules
  were. Every mark of one of its rules marks them all; the marks stay per rule, by fingerprint.
- **"3 symbols" read wrong** for core's markup fixture's tokens.css, three custom properties: a
  card counts `rules` or `variables` when its symbols are one kind.

**Verification**: tests first. `flow.test.ts`'s 10 V105 cases: 8 failed for the right reasons
(no card, no merged link, no ring), 2 guards passed on `main`'s code; `review.test.ts`'s 4 failed
(no `stylesheet` entry, the progress counting rules, `j` on every rule, a one-rule mark). A pick's
groups inside a card came later, red first. The snapshot of layouts without stylesheets
(`test/__snapshots__/layouts-without-stylesheets.json`: core's four golden graphs with no
stylesheet and the hub graph, four views each) was written on `main`'s code before any change,
and still matches. The three new e2e tests in `stylesheets.spec.ts` (core's markup fixture)
failed on `main`'s build: no card, "changed symbols", `j` on every rule. `pnpm check`: 3,525
unit tests. `pnpm build`. `pnpm test:e2e`: the viewer's 461 and the nexus's 32 passed, first run.

Real graphs, `main`'s `git archive` build (f790c0c) against this branch's.
`scripts/viewer/layout-compare.mjs` (new: two builds' layout workers in Node): the 28 graphs with
no stylesheet change (r1's 26 real commits, the small fix 4cbcae0c, Bitwarden 737ee3f), 3 views
each, 84 of 84 identical; `main` against itself, 0 differences. On the feature's merge
(11610c73): one card for IssuesPage.css, 212 changed symbols become 151 changes, 437 nodes laid
out become 340. On V88's (98e28e23): 28 cards hold 433 of 519 changed symbols, 7 stylesheets of
one changed symbol are drawn as it; 114 changes; 1,112 nodes become 414; first-view page elements
10,688 to 5,234. `interactions.mjs`, two runs of three rounds per build, alternated: on V88 open
914–929 → 480–513 ms, the overview pan 945–952 → 511–512, select 199–203 → 79–80, Context on
608–629 → 87–88 (440–499 ms blocked → 0); the feature and Bitwarden equal within noise.
Shots, both themes, before and after: `docs/images/v105-stylesheet-cards/`.

Not verified: the app's window (Electron); every timing and shot is headless Chromium. Bitwarden
and the r1 set change no stylesheet: the cards were measured on this repository's merges only,
and SCSS only through core's fixtures. Stylesheets in a monorepo's frames were seen on V88 (3
projects), not tested apart. A person reviewing with the cards: not yet.

