# Fix — A failed merge says why, in its log line

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S7)

> What holds now: [The merger](../area/merger.md). This plan is kept as it was written.

**Status:** planned (2026-11-06), to be built on branch `fix/merge-failure-reason` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/merge-failure-reason` · **Size** S · **Depends on** none ·
**Plan** P14 of 51 (the audit's order)

## The brief

**What happens**: when a merge fails, Symbiote's log line is `merge failed` with `branch`, `into`
and `state` only. The logs app (Grafana) then shows "merge failed feature/x → main" and nothing
about why.

**How to reproduce**: queue a merge whose check fails (`merge.checks: ["false"]` in a scratch
repository's `symbiote/config.json`), let it run under `symbiote view`, then read the day's
`<cache>/logs/<day>.jsonl`. The `merge failed` line has no reason.

**Where to look**:
- `packages/cli/src/main.ts:986-998` (`mergeStates`): it adds `message` when the entry has one.
- `packages/cli/src/merges.ts:678-690`: a failed check sets `check.failed` (the command) and
  `check.output` (`lastLines`, `merges.ts:213`), and **no** `message`.
- Git's failures do set `message`: `merges.ts:529`, `:570`, `:1054`, `:1103`.

**Out of scope**: the merge page (it already shows the check's output), Grafana's dashboard
panels, the merge record's shape (`MergeEntry` in `packages/core/src/merges.ts`).

**Done when**: every `merge failed` line carries why. That is `message` when git failed;
`failed` (the command) and the last lines of `output` when the check failed. A unit test proves
both.

## Evidence

- **Measured**: all 21 `merge failed` lines in `~/.cache/symbiote/logs` (2026-10-25 to
  2026-11-05) carry only `branch`, `into` and `state`. Over the same days 113 merges landed. The
  dashboard's "Crashes, errors and warnings" panel shows "merge failed
  feature/nx6-nexus-explorer → main".
- **Code**: the comment on `mergeStates` says "a failure as a warning, with its words". The words
  of a failed check live in `entry.check`, which the line never reads.
- **Correction to the audit's suggested fix**: the record does keep the reason of a failed
  check (`check.failed`, `check.output`). Only the log line drops it. No new record field is
  needed.

## Approach

- In `mergeStates`, for `state === 'failed'`:
  - add `check: entry.check.failed` and `output`: the last 5 non-empty lines of
    `entry.check.output`, ANSI codes stripped, at most 1,000 characters;
  - keep `message` as today.
- Make `mergeStates` testable: export it from a small module (`merge-log-line.ts`, files named
  area first, decision 344). Do not test it through `main.ts`'s whole `run`.
- Keep `pino`'s fields flat (`check`, `output`), so Loki's `| json` and the dashboard's queries
  read them.

## Tests first

`packages/cli/test/merge-log-line.test.ts`, with a fake `Logger` that records calls:
1. A failed check (`check.failed: 'pnpm test'`, `check.output: '…\nFAIL a.test.ts\n'`) logs
   `warn` with `check: 'pnpm test'` and the output's tail. It fails today: no such fields.
2. A git failure (`message: 'no branch main'`) logs `message`. It passes today: keep it green.
3. The same state twice logs once. It passes today.

## Verification

- `pnpm check`, `pnpm build`.
- A real `symbiote view` on a scratch repository with `merge.checks: ["sh -c 'echo boom; exit
  1'"]`: queue an approved branch, then read the log line. It must hold `check` and `boom`.
- `pnpm logs:check`: the dashboard's queries still pass, since the lines only gain fields.
- `docs/area/merger.md`: add the log line's fields if the page lists them (`grep -n "log"
  docs/area/merger.md`).
