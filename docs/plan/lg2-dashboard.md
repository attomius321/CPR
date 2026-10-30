# LG2 — A readable logs dashboard: what went wrong, what Symbiote did, by level and section

[Index](../PLAN.md) · [Journal](../journal/lg2-dashboard.md)

**Status:** merged into `main` on 2026-10-26 (built 2026-10-26), on branch `feature/grafana-dashboard` (a workspace
started in Symbiote, from `main` at `3365699`). Plan OK'd by the person ("1. Yes 2. Yes": the e2e
fix in LG2, the requests in a section of their own). As built and results under "As built (LG2)"
below.

**Problem** (asked: "The current grafana dashboard is too simple..Make it more readable."). LG1's
dashboard, measured on the person's two days of real lines (`~/.cache/symbiote/logs`,
2026-10-25 and 26: 7,878 lines), as their running Grafana shows them over 2 days:

| What | Today |
|---|---|
| Problems that come from tests | **124 of 131 (95 %)**: 62 `page did not load` and 62 `refused` (`/tmp/symbiote-notes-*`), both from `packages/viewer/e2e/app.spec.ts`, whose `appEnv` never turns logging off. Also 1,326 `app started` in 2 days, and 310 of 337 `view started` from `/tmp/symbiote-e2e-*`. The 7 real ones: 5 `merge failed`, 1 `request failed`, 1 `refused` |
| The crashes panel's rows | 62 identical rows, `app · page did not load (exit -102)`: the template reads Chromium's network error code as an exit code and drops `description` (`ERR_CONNECTION_REFUSED`) |
| Colours | tiles fixed red, orange and yellow: **0 crashes is a large red 0**. The chart colours series by process and level from Grafana's palette (app error green, view error blue): a colour says nothing of severity. Over 2 days its bars are ~1 px wide |
| What Symbiote did | shown nowhere but in "Every line": 41 analyses (median 4.1 s), 37 merges landed and 5 failed, 435 agent terminals, 3,201 requests (p50 1 ms, p90 37 ms, p99 1.8 s, max 252 s) |
| Warnings | counted (68) but listed only in "Every line" |
| "Every line" | 41 % `request` lines (73 % of the person's own server's lines); it starts below the fold at 1600×1000; a note takes a 12×4 cell |

So: what the dashboard shows first is mostly the tests' noise, read through rows that say the
wrong thing, in colours that do not mean anything; and the other half of the question, what
Symbiote did, is not on it.

**Goal**: the dashboard answers, top to bottom, "is anything wrong?" (counts and their trend),
"what went wrong?" (problems over time by level, by kind, each with its stack), "what did
Symbiote do?" (analyses, merges, agents), "how is the server?" (requests, response times, slow
routes) and "what happened?" (every line but requests). A level has one colour everywhere; a row
says what happened. And the e2e tests write nothing in the person's folder. Unchanged: what
Symbiote writes (no line, field or level changes), Alloy, Loki, the compose file, the URL and the
dashboard's `uid`.

## LG2a — the tests stop writing into the person's folder

`app.spec.ts`'s `appEnv` (the app, and every server it or a spec starts with it) gets
`SYMBIOTE_LOG: 'off'`, as `e2e/symbiote.ts` already does for its servers (LG1: "tests never
write into `~/.cache`"). The test lines already written leave as they age: 14 days for the
files, 30 days in Loki.

## LG2b — the dashboard

`ops/logs/grafana/dashboards/symbiote.json`, in sections (Grafana rows):

```
[Process] [Level] [Text]     links: Logs Drilldown · Explore           [Last 24 h] [10 s]
── At a glance ───────────────────────────────────────────────────────────────────
 Crashes │ Errors │ Warnings │ Analyses │ Merges landed │ Agent terminals
── Problems ──────────────────────────────────────────────────────────────────────
 Problems over time (by level) │ Problems by kind (table: level, process, message, count)
 Crashes, errors and warnings, with their stacks
── Activity ──────────────────────────────────────────────────────────────────────
 Analysis time │ Merges: landed, failed, needs you │ Agent terminals by program
── Server (collapsed) ────────────────────────────────────────────────────────────
 Requests by status │ Response time p50/p95/p99 │ Slowest routes (table)
 Requests (their lines)
── Lines ─────────────────────────────────────────────────────────────────────────
 Every line but requests
```

- **At a glance**: a number with its trend (a sparkline) each; a count of 0 in the text colour,
  above 0 its level's colour (crashes, errors, warnings), the others never coloured as a state.
- **Colour means level**, the same everywhere: the bars, the tiles and the logs panels' level use
  Grafana's own log-level colours, so a level looks the same in a chart and in a row. What is not
  a problem (a program, a status class) gets a fixed colour by name, never by rank.
- **A row says what happened**: one line template, shared by the logs panels, names each line's
  subject: `page did not load ERR_CONNECTION_REFUSED http://…`, `merge landed feature/x → main`,
  `analysis done 56297b4..da95fba 5.0 s`, `terminal ended claude (exit 1)`; an exit code only
  where it is one. Stacks stay under their row.
- **Problems by kind**: `sum by (level, process, msg)` over the range, a table, largest first: 62
  identical rows are one row with its count.
- **Requests** leave "Every line" for the Server section, collapsed (Grafana runs a collapsed
  row's queries only when it is opened). Routes are grouped with a terminal's ID taken out
  (`POST /api/terminals/<id>/paths`); status classes by the status's first digit.
- **The note goes**: its words move into the panels' descriptions (the (i) by their titles) and
  the dashboard's links to Logs Drilldown and Explore.

Every query was run on the person's Loki 3.7.9 with the real lines before planning (`| json`
then `sum by` on an extracted field, `unwrap ms` with `quantile_over_time`, `label_format` with
`regexReplaceAll` and `substr`); Grafana's `/api/ds/query` answers the anonymous viewer, with
`$__range` filled in by Grafana.

## Verification

1. **Tests first** (red on today's dashboard):
   - `packages/log/test/dashboard.test.ts`, in `pnpm check` (no Docker): the JSON parses; panel
     IDs unique; panels inside 24 columns and not overlapping; every query on `symbiote-loki`;
     every `$variable` defined; one colour per level in every panel; the logs panels share one
     line template.
   - `pnpm logs:check`, extended: it writes lines for every panel (requests 200 and 500, an
     analysis, merges, terminals, a `page did not load`, a warning, a crash) and runs **every
     panel's queries through Grafana's `/api/ds/query`**, as the dashboard does: no error, and the
     numbers the lines say (1 crash, the kinds and their counts, requests by class); a
     `page did not load` row reads `ERR_CONNECTION_REFUSED`, not `exit -102`; no request in
     "Every line"; the stacks still under their rows.
2. **LG2a**: `app.spec.ts` with its cache in a temporary folder: lines written there before the
   fix, none after; the spec green.
3. **Real data**: a second stack from this worktree (its own Compose project, random ports)
   reading the person's folder read-only, their own stack left alone; screenshots before and
   after at 1440×900 and 1920×1080, dark and light, text zoomed; the stack removed after.
4. `pnpm check`, `pnpm build`; `docs/images/logs-dashboard.png` replaced.

**Risks**

| Risk | Mitigation |
|---|---|
| A panel's query fails only in Grafana (a variable, a `$__` macro) | `logs:check` runs every target through Grafana's own query API |
| Grafana rewrites an older schema on load and a field is lost | panels checked in Grafana after provisioning (screenshots, the API's dashboard) |
| Bars too thin or too many over long ranges | `maxDataPoints` on the bar charts; checked at 24 h and 2 days |
| The line template grows hard to keep | one template, the same string in each logs panel (the static test), each field's case listed in the plan |
| Queries over 30 days are slow | the tiles and tables are instant queries; the Server section runs only when opened |

**Order**: the plan; the failing tests; LG2a; LG2b; real data and docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| LG2a | The tests' lines | `app.spec.ts` writes no lines into the person's folder |
| LG2b | The dashboard | the sections, colours and rows above; `dashboard.test.ts`; `logs:check` running every panel |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 441 | What does the dashboard show, in what order? | **At a glance, Problems, Activity, Server (collapsed), Lines; requests only in Server** | the questions in the order they are asked; requests were 41 % of "Every line" |
| 442 | What does colour mean? | **A level only, the same in every panel (Grafana's log-level colours); 0 in the text colour; other series a fixed colour by name** | a red 0 read as an alarm; series coloured by process and level said nothing of severity |
| 443 | May tests write into the person's log folder? | **Never: the desktop specs run with `SYMBIOTE_LOG=off`, as the others** | 95 % of the problems shown were the tests' |
| 444 | How is the dashboard checked? | **Its structure in `pnpm check`; every panel's queries through Grafana in `logs:check`** | a broken dashboard fails silently in Grafana; the queries need Loki, which `pnpm check` must not |

**Not in LG2 (later)**: `/api/terminals/<id>/paths` requests at `debug` (1,488 of the 3,201
request lines; a change to the server, not the dashboard); Grafana alerts on a crash; a "hide
test runs" filter (not needed once the tests write nothing).

## As built (LG2)

- **Decisions 441–444**, planned as 437–440: `feature/complete-revamp` (V61, from the same `main`)
  took 437–440 meanwhile. The plan's commit (`2f86b20`) still says 437–440.
- **Tiles without a trend line.** A sparkline needs a range query, and the sum of its buckets is
  not the count: 4,539 lines where the 24 h held 4,504, since Grafana aligns the start to the step
  and the first bucket ends before the range. A tile is an exact instant count; the trend is the
  chart under it.
- **Tile names that fit**: `Analyses`, `Merged`, `Agents`. With Grafana's menu open, a tile is
  ~160 px wide at 1440 px, and "Analyses done", "Merges landed" and "Agent terminals" were cut.
- **A row shows a message's first line and a stack's first six, then `…`**; the whole of both are
  in the row's details. Grafana 13's list opens with react-window's `scrollToItem(0)` (alignment
  `auto`): a first row taller than its panel opens scrolled to its end, 444 px down on the real
  lines (the newest warning: a 3-line message, a 12-line stack). Loki's templates have no
  `regexFind`: `regexReplaceAll` with `$1`, which Grafana leaves as it is (no variable is named
  `1`); the static test skips such names. A failed request has both `err` and `answer` (the 500's
  answer is the error's text): its error's words first.
- **Activity**: one series, `Slowest analysis` (the median and the slowest were one point: about
  one analysis an interval); the merges full width (at a third, every row wrapped).
- **Server**: the response time as points, p50 and p95 (its lines joined points across hours
  without a request; `insertNulls` did not cut them on 13.2.4; p95 and p99 were two blues alike);
  the slowest routes full width (at a third, routes were cut and `slowest` hidden).
- **Colours**: Grafana 13's logs panel draws critical with the named `purple`, error and warning
  with its theme's error and warning text; the charts and tiles use `purple`, `red`, `orange`.
  Grafana writes a `fatal` line's level as `CRIT`.
- **Tables**: an instant query's value field is `Value #A` (`#B`, `#C` for the next queries).
- **`logs:check`'s lines** carry the check's token in a field of their own: the panels filter on
  `msg`.
- The JSON was written once by a scratch script (one template, five panels), then kept as JSON.

**Results.**

- LG2a: `app.spec.ts` wrote 55 lines a run into its cache's folder (21 `app started`, a
  `page did not load`, a `refused`); none after, no folder made; 19/19 both times.
- `dashboard.test.ts`: 8 tests, 5 red on LG1's dashboard, green now. `pnpm check`: 1,880 tests in
  134 files, green.
- `pnpm logs:check`: red on LG1's dashboard (12 panels missing); green now, all 17 panels' queries
  through Grafana: 1 crash, 3 errors, 2 warnings, five kinds with `page did not load` twice, 2xx 2,
  4xx 1, 5xx 1, the terminal's ID out of the route, each row's words, a 10-frame stack cut to six
  lines. Loki ready 30.1 s after `up`, the 13-day-old line 36–62 s later.
- The person's two days of lines (7,975) in a second stack: screenshots dark and light at 1440×900,
  1440 tall and 1920×1080; the Server section opened; Logs Drilldown and Explore followed from the
  dashboard. A crash in the check's stack: purple in the tile, the bar, the table and the row.
- The person's dashboard still shows the tests' lines already written until they age (14 days of
  files, 30 in Loki): 63 errors and 68 warnings over 2 days, 7 of them real.

Not verified: the person's own stack (it reads `main`'s checkout: the new dashboard ~10 s after
the merge); other Grafana versions than 13.2.4; other browsers than headless Chromium; the full
e2e suite (only `app.spec.ts` changed, run alone).
