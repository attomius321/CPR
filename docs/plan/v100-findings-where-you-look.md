# V100 — Findings where the reviewer looks

[Index](../PLAN.md) · [Journal](../journal/v100-findings-where-you-look.md)

**Status:** built, ready for review (2026-11-11), on branch `feature/v100-findings-where-you-look`
(the workspace's, from `main` at 7e4a36e); planned by the graph usability spike
(`spike/graph-usability`). Includes [fix-finding-counts](fix-finding-counts.md): its brief is part
1 below.

**Kind** feature (milestone) · **Branch** `feature/v100-findings-where-you-look` · **Size** S–M ·
**Depends on** none · **Rank** 2 of 12
([the spike's order](../../spikes/graph-usability/README.md#ranked-improvements))

## The brief

**What to change**:
1. **The head counts what the Findings tab counts.** Today the head counts only errors and
   warnings, and the tab counts every severity. The head gets one pill per severity it finds
   ("2 warnings · 3 notes"), and a click on a pill opens the Findings tab at that severity.
2. **Settled signature changes fold.** In the Findings tab, a `signature-changed` finding whose
   change is compatible, or whose users are all updated (`untouched` 0), folds into one row per
   project ("62 signature changes, nothing left to update"), below the other findings. A click
   opens the fold.
3. **The map shows findings.** On the map, a symbol with findings keeps its count badge, scaled
   like the file names. Its file's name takes the worst severity's colour.

**Where to look**:
- `packages/viewer/src/diff/DiffHead.tsx:166` (`FindingPills`: errors and warnings only).
- `src/diff/Sidebar.tsx:19` (`SEVERITY_ORDER`), `:135` (the tab's count), `:271` (the list),
  `:426` (`FindingRow`).
- `src/graph/map.css:71` (`.react-flow.map .symbol > *` hides the badge with the rest of the
  card) and the label rules after it; `src/graph/mapzoom.ts:5` (`LABELS`: the elements scaled by
  `1 / --symbiote-zoom`).
- `docs/graph-schema.md:256` (`signature-changed`'s `data`: `compatibility`, `untouched`).
- Decisions 839 (the head's pills), 37 (map labels by transform only, never a font size per zoom).

**Out of scope**: what a finding is and its severity. Core's detectors keep 21 infos that read
"N of M users not updated" in the sample. Whether those should be warnings is a detector question
for later.

**Done when**:
- On `callers`, the head and the tab give the same numbers, by severity.
- On the refactor's merge (eb807773), the tab lists its 2 warnings and its unsettled infos, with
  the settled ones in a fold per project.
- On feature/issues-page's map at zoom 0.16, `Route`'s block shows its warning badge, and
  `pages.ts`'s name is in the warning's colour.
- No restyle on zoom frames (`interactions.mjs`' zoom rows within ±30 % of `main`).

## Problem (the spike's G5, G6)

- The head and the tab disagree on 33 of 37 graphs with findings in the sample. On 14, the head
  shows nothing while the tab says N
  ([shot](../../spikes/graph-usability/shots/p06-head-vs-findings-tab-dark.png)).
- 352 of the 407 findings are infos. 303 of them are signature changes with nothing left to
  update: 165 compatible, 138 with every user updated. On the refactor, 65 infos sit under 2
  warnings, and the tab reads 67
  ([shot](../../spikes/graph-usability/shots/p06-findings-flood-dark.png)).
- The map is the first view of 19 of the last 26 merges. It draws no finding:
  `map.css:71` hides the badge
  ([shot](../../spikes/graph-usability/shots/p05-map-hides-findings-dark.png)).

**Goal**: the count the reviewer sees first is the one they can act on, and every finding can be
seen at any zoom.

## Design

- **Pills**: `FindingPills` counts the shown findings by severity, with infos as "notes". Each
  pill is a button that sets the sidebar's tab to Findings and scrolls to the first finding of
  its severity. The folded findings are counted in the fold's row, not in a pill.
- **The fold**: a pure `foldFindings(findings, projects)` in `src/diff/review.ts`. It returns the
  rows to list and the folds per project. The rule for folding is `rule === 'signature-changed'`
  and (`data.compatibility === 'compatible'` or `data.untouched === 0`). Tested on the five
  walked graphs' findings.
- **The map's badge**: `.react-flow.map .symbol-count` stays visible, out of the card's hidden
  children, and joins `LABELS` in `mapzoom.ts`. It is scaled by transform, never by font size
  (decision 37). The file name's colour is a class set in the layout from `countFindings`
  (`flow.ts:1128`), the same for every zoom.

## Verification

1. Unit (red first): `foldFindings` on the five graphs' findings (counts above); the pills' counts
   on `callers`.
2. e2e: the head and the tab agree on `callers`; a pill click opens Findings; the map at 0.2
   shows a `.symbol-count` with a non-zero box.
3. Real graphs: `interactions.mjs` (zoom out ×20, zoom in ×10) on Bitwarden and the feature's
   merge against `main`, 3 rounds.
4. Shots: the head, the folded tab and the map, both themes.

**Risks**

| Risk | Mitigation |
|---|---|
| A fold hides a finding someone needed | The fold says how many, by project, and opens on a click |
| A badge on every symbol crowds the map | Only symbols with findings: 8 of 349 symbols drawn on the feature's map |

## Proposed decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 968 | What the head counts (amends 839) | **Every severity the tab lists, a pill each ("notes" for infos), each pill opening the Findings tab at it** | The head and the tab disagreed on 33 of 37 graphs |
| 969 | Settled signature changes | **`signature-changed` infos that are compatible or leave no user untouched fold into one row per project, below the rest, opened on a click; the head and the tab's count count what is listed** | 303 of 352 infos are such; on the refactor they buried 2 warnings |
| 970 | Findings on the map | **A file's name takes its worst listed finding's colour, and its box draws its symbols' counts at their cards' corners, scaled by transform like the names; a settled change colours and counts nothing there** | The map, the first view of 19 of 26 merges, drew no finding; drawn by the cards, 26 of 43 counts were under a file's name |

## As built

Built as planned, decisions 968–970, with the map's counts drawn by the file box (970, below).
The rows above say what was built: 969 adds "infos" and what the counts count, 970 the box and
the listed findings. Tests first: 12 unit tests and the 4 of `e2e/findings.spec.ts` failed on
`main`'s build for the right reasons, then passed. `foldFindings` and `findingPills` were not
functions; the layout had no file severity or counts; `MAP_LABELS` was not exported. On
`callers` the tab read "Findings 3", not 2. On `detectors` the head had no "1 note" pill. On the
map at 0.2 the count was hidden.

- **The pills** (`FindingPills` in `diff/DiffHead.tsx`) come from `findingPills` in
  `diff/review.ts`, over the findings the tab lists. Each is a button around its `StatusLabel`,
  24 px tall for WCAG 2.5.8. A click opens the Findings tab, and the Graph page from the Files
  page. The sidebar then scrolls the first finding of that severity to the list's top and focuses
  it. A note's icon is its row's (`HelpIcon`), not the paused icon of the `info` tone.
- **The fold** (`foldFindings`) asks `settled`, which lives in `graph/flow.ts`: `review.ts`
  imports `flow.ts`, and the other way would be a cycle. The rule also asks for an info. Today's
  detector makes every such finding an info, and a warning must not fold if that changes. A
  finding's project is its symbol's path's (`projectOf`). The fold's row names its project when
  the change list is by project, as a finding's row does. The tab's count is what it lists, and
  the tab opens first only when it lists a finding (before: when the graph had any).
- **The fixture**: `test/fixtures/findings/` holds the five walked changes' findings (without
  `related`) and projects, made with this branch's CLI. The refactor's merge, as
  `symbiote diff eb807773^1 eb807773^2`, has 1 warning and 65 infos. The spike's review of the
  branch listed a second warning, a `removed-still-referenced` on `version`, which this diff does
  not give. No detector changed since; the review's base was another. The test counts what the
  diff gives.
- **The map (970) differs from the design in two ways**:
  - *The file box draws the counts, not the card.* The plan kept the card's `.symbol-count`
    visible and scaled it. Built that way first, 26 of the 43 counts at the five first views (two
    screen sizes) were under a file's name. On the map React Flow draws a file box above its
    cards (z-index 2000, so a click zooms into the file), and its name with it. So each file box
    now carries its listed symbols' counts and their cards' top-right corners
    (`FileData.counts`). `FileNode` draws them after its name, as `.map-count`, on the map only;
    the card's own count is hidden there as before. A count over a name can hide one letter of a
    name already cut, such as "hive…" on the refactor's first view.
  - *Only what the head counts.* A file name's colour and the counts come from the listed
    findings. A settled change colours no name and draws no count on the map; its card keeps its
    count (decision 835). On the refactor, 5 names are coloured, not 27, and 5 counts are drawn,
    not 66.
- `.map-count` joins `MAP_LABELS`, now exported for a unit test: every rule in `map.css` that
  reads `--symbiote-zoom` or `--symbiote-cut` aims at one of the labels. The colour is a class set
  by the layout (`findings-<severity>`), the same at every zoom.

## Results

The five walked changes, as `symbiote diff` of each (the unit test's fixture); the head and the
tab at 1440 × 900, 1x.

| Change | `main` (7e4a36e): head; tab | V100: head; tab; folds |
|---|---|---|
| `callers` (fixture) | 1 error · 1 warning; 3 | 1 error · 1 warning; 2; 1 |
| The refactor's merge (eb807773) | 1 warning; 66 | 1 warning · 4 notes; 5; 61 (`@symbiote/cli`) |
| The small fix (fix/e2e-flakes) | nothing; 6 | 4 notes; 4; 2 |
| The feature (feature/issues-page) | 1 warning; 8 | 1 warning · 3 notes; 4; 4 (cli 1, forge 2, viewer 1) |
| Bitwarden 737ee3f, Angular plugin | 7 warnings; 9 | 7 warnings; 7; 2 (`web`) |
| Qwik 65661bf49, Qwik plugin | 2 warnings; 16 | 2 warnings · 3 notes; 5; 11 (core 10, e2e 1) |

The head and the tab disagreed on 5 of 5 changes and agree on 5 of 5. 80 of the 105 findings
fold; all 11 warnings stay listed.

| Measure | `main` | V100 |
|---|---|---|
| The feature's map at 0.16: `Route`'s count | hidden, 2.6 px | 16 × 16 px, amber, on its block's corner |
| The same: `pages.ts`'s name | `--text` | `--warning` (rgb 242 179 61 dark, 143 91 0 light) |
| Counts drawn at the five first views, 2560 × 1440 and 1440 × 900 | 0 | 44; 30 of them over a file's name, drawn above it |
| The refactor's map: coloured file names; counts | none; none | 5; 5 (1 amber, 4 cyan) |
| `interactions.mjs`, zoom out ×20 and zoom in ×10, Bitwarden and the feature, 2 runs of 3 rounds alternated | 0 ms blocked, no long frame | the same |
| Bitwarden: open; select; mark | 344, 388; 64, 65; 8, 9 ms | 359, 419; 64, 77; 8, 9 ms |
| The feature: open; select; mark | 360, 405; 59, 67; 9, 8 ms | 392, 372; 66, 60; 10, 8 ms |
| Map elements of the file boxes (Bitwarden; the feature); clicks reaching the file | 420; 392; 100 % | 426; 396; 100 % |

Shots, 1440 × 900, 1x: the refactor's head, tab and first view
([before](../images/v100-findings-where-you-look/refactor-before-dark.png),
[after](../images/v100-findings-where-you-look/refactor-after-dark.png); light:
[before](../images/v100-findings-where-you-look/refactor-before-light.png),
[after](../images/v100-findings-where-you-look/refactor-after-light.png)); the feature's map at
0.16 around `Route`
([before](../images/v100-findings-where-you-look/issues-map-before-dark.png),
[after](../images/v100-findings-where-you-look/issues-map-after-dark.png); light:
[before](../images/v100-findings-where-you-look/issues-map-before-light.png),
[after](../images/v100-findings-where-you-look/issues-map-after-light.png)).

Cost: none measured. The layout adds a pass over the findings and the drawn symbols. On the map,
the file boxes draw one element per listed symbol (6 on Bitwarden's), which reads the zoom with
the names.

