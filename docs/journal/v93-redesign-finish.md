# Journal: V93 — Redesign finished: every page as its proof

[Index](../JOURNAL.md) · [Plan](../plan/v93-redesign-finish.md)

## V93 spike — the app beside the proofs (3 November 2026, branch `feature/redesign-finish`)

Rendered `main`'s build (`eb5f9e4`) at 1440 × 900, 1×, with the e2e harness and the V91 and V92
records (`e2e/overview-data.ts`, `e2e/hive-pages-data.ts`): both Overviews, the Merge page, Start
and Settings' Hive mode page, both themes; and read V89's and V92's after-shots beside the proofs.

**Learned**:
- **The sidenav differs on every screen**: 300 px against 260, normal mode's cards up to five lines
  (about 150 px) against two (about 52 px). At 900 px the app shows the merge and two waiting cards;
  the proof shows all nine rows and Done today.
- **No step built the status bar's left side**: the proofs draw the branch, what waits and what
  works there; the app shows only the usage.
- **The Merge page is V26's**: the merger records the check's commands, its total time and its
  output, not each command's time, when it started, or how long the merge took. The review record
  keeps every verdict (`verdicts`), so "your review, 2nd" and the approval's words need only a read.
- **Findings per workspace exist only in a graph**: graphs live in `symbiote view`'s memory (eight
  kept, `Diffs`), so a workspace's findings can be shown when its change was analyzed in this run,
  not otherwise, without starting an analysis.

## V93 — every page as its proof (3 November 2026, branch `feature/redesign-finish`)

Built decisions 875–893 as planned, and 894–896 that the pairs found: the sidenav at 260 px with
two-line rows in both modes, the status bar's left side, normal mode's Merge and Start, the
pipeline card (Hive's in Hive's words), a 300 px side card, the head's ‹› and ⋯, a review as proof 03
frames it with Open ↗ and our own syntax colours, Settings' list, the 52 px rail, and the composer.
The merger records each check command's time and result and the merge's time; the review list
serves which verdict approved; the server serves findings per workspace from graphs it analyzed;
the activity counts a turn's tool calls. Every proof sits beside the app in both themes on a review
page, each difference fixed or kept with why (`docs/plan/v93-redesign-finish.md`, As built).

**Learned**:
- **The steps in a card cost the terminal nothing** where they matter: the terminal view keeps them
  in the head. The side card's 44 px came back from the sidenav's 40: 102 × 39 against 103 × 39.
- **A second fit is not free**: fitting the first drawn layout again when React Flow's own fit had
  already framed it cost Bitwarden 7–9 ms of first paint every run. Comparing the viewport first
  took it back (332–355 ms against `main`'s 341–361).
- **V90's zoom to a pick hid two faults**: React Flow fitted before the worker's layout came, and
  a wide change (five files in a row) fits only as the map. Without the zoom the canvas showed a
  half-cut change; it now fits once the layout is drawn, and a pick on the map comes to 1×.
- **Hive's stop was read from the list's summary**, which carries no check: the pipeline showed it
  on Write. The run's record has it.
- **Shared names keep hurting**: `.hint` carries 24 px of padding for a page's hint, which made
  the composer's foot 82 px; History's and Nucleus's tabs, straight in `.workspace-views`, lost
  their style with V89's `.workspace-tabs .stab`, unseen until the README's shots.
- **Specs that read a row's words broke on the rows**: the Stop button, the bar under Thread, the
  tabs' first word, Settings' head and the review's widths each needed their spec to follow; each
  follows the proof and says so.

**Verification**: tests first for the new logic (`row-words`, `merge-steps`, `start-next` (written
with its code), `workspace-steps`' pipeline, `hive-pipeline` (seen red: no module, then a stop on
Write), Settings' Hive group (red), the tokenizer, the merger's and reviews' new fields,
`activityOf`'s tool count (red), a paused step (red)); `pnpm check`: 3,060 unit tests; `pnpm build`; `pnpm test:e2e`:
the first full run 413 passed and 9 failed (7 real, each fixed: a use's Open read as its name, a
paused step, the head's 2 px in two specs, Hive's group order, the pacing spec's head steps;
`codex.spec.ts:148` and `terminal-view.spec.ts:165` passed alone); the second, the viewer's 422
passed and 1 failed, `terminal-view.spec.ts:165`, which passed alone (6 of 6); the nexus's 20
passed. Costs against `main`'s own build, alternated: a key's echo median 4 ms both; first
paint of /overview and /git within noise (52–64 ms both); Bitwarden select 97–101 ms (114–132),
mark 33–34 ms (36–69), pan 62–63 fps (63); the arrival 59.5 fps both; the tokenizer 2.8 ms for
2,000 rows. The README's 15 viewer screenshots retaken (34–85 KB each, quantized).

**Not verified**: the app's window (Electron) itself: every shot is headless Chromium; a real
Claude Code session in the terminal shots (the e2e fake prints its size); Codex's tool count on a
real app server (its fake's items only); the arrival's frames in the app (headless only, as V92).

Merged into main (2026-11-03).
