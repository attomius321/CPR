# Journal: V91 — Redesign step 4: the Overview pages

[Index](../JOURNAL.md) · [Plan](../plan/v91-redesign-overview.md)

## V91 spike — what the Overviews ask of the records (3 November 2026, branch `feature/redesign-overview`)

Read both proofs 01-overview against `705f20d`'s viewer, server and records, and this repository's
own records (`symbiote/`, the merge queue in the cache, git), read only.

**Learned**:
- **The merge queue does not say what was merged today**: it keeps a landed entry until the person
  removes it, and this repository's holds 0 entries, while git has 73 first-parent merges into
  `main` in 7 days (7–13 a day). Merged today and this week come from git.
- **Hive's spend is a running total**: `HiveSpend` per workspace, in the detail read only. A
  review's cost is timed by its `review` event; the writer's count only by its last read.
- **The writer's spend can be had by day**: Claude Code writes `cost-state`, the session's total,
  at each turn's end, with no time of its own. In the 14 Hive writers' transcripts all 63 such
  lines follow a line with a `timestamp` (41 a `turn_duration`, the turn's end; 6 an
  `away_summary`, 4 each an `api-request`, `queue-operation` and `assistant`, 2 each a
  `frame-link` and `attachment`), and no total shrinks. The next timed line comes 7 min later at
  the median (23 at the 90th percentile): the line before is the turn's end, not the one after.
- **Hive's events are recorded but not served**: `hive/<branch>.jsonl` (check, review with cost
  and kept findings, landed, stuck, pushed…), 2.4 MB over 42 files; nothing reads them yet.
- **Findings are not recorded per workspace**: a review's findings are worked out when it opens.
  The proof's Findings to read has no source.
- **Keys**: every keydown handler binds one of `a c d f g h i j k m n o p r s v w x`, `P`, `/`,
  `[`; `t` is free everywhere.
