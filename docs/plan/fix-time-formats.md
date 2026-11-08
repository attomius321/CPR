# Fix — Durations in one format across the Overview and the Run tab

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding V11)

**Status:** planned (2026-11-06), to be built on branch `fix/time-formats` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/time-formats` · **Size** S · **Depends on** none · **Plan** P38 of
51 (the audit's order)

## The brief

**What happens**: a duration is written three ways.
- The Overview: "Time to land 18 min median".
- A landed Hive workspace's head: "Time 3:04:00 brief to landed".
- A live one: "18:38 since the brief".

"3:04:00" and "18:38" are clock forms. A finished span written as a clock reads like a time of
day, and "18:38" is not obviously minutes.

**How to reproduce**: Hive's recorded pages (`e2e/hive-pages-data.ts`, `mockHivePages`):
`/?branch=feature/discount-code&run` (landed) and `fix/payment-webhook-retry` (live), and
`/overview` with `hiveMocks()`.

**Where to look**:
- `packages/viewer/src/workspaces/hive-live.ts:8-14` (`clockWords`: `m:ss` or `h:mm:ss`) and
  `:17` (`aboutWords`: "~40 s", "~7 min", "~1 h 5 min").
- `src/overview/words.ts:8-15` (the median: "18 min median", "2.4 h median").
- Every `clockWords(` use: `merge-steps.ts:68,111,117,230,232,244,303,305`,
  `row-words.ts:152`, `hive-live.ts:31,70,98`.
- The heads: `Workspace.tsx:907`, `HivePipeline.tsx:85`.

**Out of scope**: running clocks (a check running, a row's live timer): a ticking `m:ss` is right
there.

**Done when**:
- A finished span (brief to landed, brief to stop, from your OK to landed, a step's or a check's
  time once done) is written in words: "3 h 4 min", "18 min", "42 s".
- Live, counting spans keep the clock form.
- The rule is written once, beside `clockWords`, and tested.

## Evidence

Reproduced in the audit's Hive shots: `hive-run-landed` ("3:04:00 brief to landed"),
`hive-run-live` ("18:38 since the brief") and `hive-overview` ("18 min median").

## Approach

- A `spanWords(ms)` beside `clockWords`, on `aboutWords`' scale without the "~": "42 s",
  "18 min", "3 h 4 min".
- Use it where the span is over: `merge-steps.ts:244` ("passed in …"), `:305` (landed), the heads'
  `landed` and `ended` cases, step times once done (`:111`, `hive-live.ts:98`).
- `clockWords` stays for what ticks.
- The Overview's median keeps its figure and unit form ("18" "min median"); `spanWords` agrees
  with it.

## Tests first

`test/hive-live.test.ts` (or the module's test): `spanWords` for 42 s, 18 min and 3 h 4 min.
`merge-steps` and the head's pure tests expect "3 h 4 min brief to landed" for a landed record.
Red today.

## Verification

`pnpm check`; `e2e/hive-pages.spec.ts` and `merges.spec.ts` (their expected texts change: read
each diff); screenshots of the Run tab landed, live and stopped, and of a merge page.
