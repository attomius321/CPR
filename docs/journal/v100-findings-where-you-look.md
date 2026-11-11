# Journal: V100 — Findings where the reviewer looks

[Index](../JOURNAL.md) · [Plan](../plan/v100-findings-where-you-look.md)

## V100 spike — findings out of sight (2026-11-10, from spike/graph-usability)

The graph usability spike ([its answer](../../spikes/graph-usability/README.md)) measured this on
real changes, served by `symbiote view` at 2560 × 1440, 1x, both themes.

In 84 graphs, the head and the Findings tab disagree on 33 of the 37 with findings; on 14 the head
shows nothing. 352 of 407 findings are infos, and 303 of those are signature changes with nothing
left to update. On the map, the first view of 19 of 26 merges, no finding is drawn: `map.css:71`
hides a symbol's badge ([shot](../../spikes/graph-usability/shots/p05-map-hides-findings-dark.png)).

Not started.

## V100 — findings where the reviewer looks (2026-11-11, branch `feature/v100-findings-where-you-look`)

The head now counts what the Findings tab lists: one pill per severity, infos as "notes". A pill
opens the tab at its severity, from either page. A `signature-changed` info that is compatible,
or whose users were all updated, folds into one row per project below the rest. On the map, a
file's name takes the colour of its worst listed finding, and its symbols' counts are drawn at
their cards' corners. Decisions 968–970. It includes fix-finding-counts.

**Learned**:
- **On the map, a file box is drawn above its cards, and its name with it.** The plan kept the
  card's own count visible there. Built that way, 26 of the 43 counts at the five walked first
  views were under a file's name, at 2560 × 1440 and 1440 × 900. On the refactor, at 0.05 and
  0.06, all 9 were.
  The box now draws its symbols' counts after its name (`FileData.counts`, `.map-count`). A count
  can hide one letter of a name already cut.
- **What the map shows should be what the head counts.** Coloured by every finding, 27 of the
  refactor's file names took a colour, 26 of them cyan for settled infos, and its one amber name
  was lost among them. Coloured by the listed findings, 5 names take a colour and 5 counts are
  drawn, not 66.
- **The fold leaves every warning listed.** On the five changes, 80 of 105 findings fold; all 11
  warnings stay. Every folded finding is an info: the detector makes a compatible change, or one
  with every user updated, an info. The fold also asks for an info, in case that changes.
- **A diff of the merge is not the review the spike walked.** `symbiote diff eb807773^1
  eb807773^2` gives the refactor 1 warning and 65 infos. The spike's review of the branch listed a
  second warning, `removed-still-referenced` on `version`. No detector changed since; the review
  started at another base. The unit test counts what the diff gives.
- **`callers`' info is a settled change.** fix-finding-counts' brief asked for "· 1 info" in the
  head. With the fold, the head stays "1 error · 1 warning" and the tab reads "Findings 2", with
  `add` in a fold: both count what is listed.

**Verification**: tests first. 12 unit tests failed on `main`'s code: `foldFindings` and
`findingPills` were not functions, the layout gave no file severity or counts, `MAP_LABELS` was not
exported. `e2e/findings.spec.ts` (4 tests) failed on `main`'s build: "Findings 3", not 2, on
`callers`; no "1 note" pill on `detectors`; the map's count hidden at 0.2, in both themes. All pass
now. `angular-v11.spec.ts` changed with the behaviour: its `getHeroes` info is settled, so the tab
reads 2 and the info is in the fold. `pnpm check`: 3,478 unit tests. `pnpm build`. `pnpm test:e2e`:
the viewer's 450 and the nexus's 32 passed, `page-frame.spec.ts` and `targets.spec.ts` among them
(the pills are buttons now, 24 px tall). A first run failed only `angular-v11.spec.ts`, changed
above. `interactions.mjs` on Bitwarden and the feature's merge, `main`'s build against this one,
alternated, two runs of 3 rounds: zoom out ×20 and zoom in ×10 blocked 0 ms with no long frame on
both; open, select and mark within run-to-run noise (Bitwarden select 64 and 65 ms on `main`, 64 and
77 ms here). Shots at 1440 × 900, 1x, both themes, before and after
(`docs/images/v100-findings-where-you-look/`): the refactor's head, tab and first view, and the
feature's map at 0.16 around `Route`.

Not verified: the app's window (Electron); every shot is headless Chromium. A pill's keyboard
path (Tab to a pill, Enter) was not tested on its own: the e2e clicks.

