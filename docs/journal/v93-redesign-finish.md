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
