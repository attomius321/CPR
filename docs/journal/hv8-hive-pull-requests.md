# Journal: HV8 — Hive lands through a pull or merge request

[Index](../JOURNAL.md) · [Plan](../plan/hv8-hive-pull-requests.md)

## HV8 plan — a pull or merge request at a workspace's end (2026-11-02, branch `feature/hive-pull-requests`)

Read HV4's plan, journal and the merger's page, the runner's landing (`hive-runner.ts`: `land`,
`follow`, `landingFailed`), the queue's sync of a Hive target (`merges.ts`, `syncTarget`) and the
forge package. The forge reads a request and posts a review, as `symbiote pr` needs; it cannot open,
find or update one, nor say whether it can be merged. The view server already analyzes a pair in a
child process (`RunDiff`), which the graph review can use.

**Learned**:
- **HV5–HV7 are planned rows**, so this takes its own ID, HV8, linked from HV4's "later" line.
- **Decision numbers**: the highest on `main` and every branch was 787 (NU8); HV8 takes 788–793.
- **GitHub computes `mergeable` lazily**: `null` on the first read after a push. A conflict is
  acted on only when the forge says so for Hive's tip.

Not verified: everything; nothing is built.
