# V100 — Findings where the reviewer looks

[Index](../PLAN.md) · [Journal](../journal/v100-findings-where-you-look.md)

**Status:** planned (2026-11-10), to be built on branch `feature/v100-findings-where-you-look` in
its own workspace; written by the graph usability spike (`spike/graph-usability`). Not started.
Includes [fix-finding-counts](fix-finding-counts.md): its brief is part 1 below.

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
| 969 | Settled signature changes | **`signature-changed` findings that are compatible or leave no user untouched fold into one row per project, below the rest, opened on a click** | 303 of 352 infos are such; on the refactor they buried 2 warnings |
| 970 | Findings on the map | **A symbol's findings badge stays on the map, scaled by transform like file names; its file's name takes the worst severity's colour** | The map, the first view of 19 of 26 merges, drew no finding |
