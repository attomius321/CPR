# Journal: LG2 — A readable logs dashboard

[Index](../JOURNAL.md) · [Plan](../plan/lg2-dashboard.md)

## LG2 spike — what the dashboard shows of two days of real lines (2026-10-26, branch `feature/grafana-dashboard`)

The person's log folder (`~/.cache/symbiote/logs`, 2026-10-25 and 26: 7,878 lines, 1.4 MB) read
with `jq`, and LG1's dashboard screenshot from their running stack (Grafana 13.2.4, Loki 3.7.9)
over 2 days. Then the queries a fuller dashboard needs, run on their Loki and through Grafana's
`/api/ds/query`.

**Learned**:
- **The tests write into the person's folder**: `app.spec.ts`'s `appEnv` copies `process.env`
  and never sets `SYMBIOTE_LOG=off`, so the desktop app and the servers it starts write there.
  124 of the 131 problems shown are theirs (62 `page did not load`, `ERR_CONNECTION_REFUSED`; 62
  `refused`, `/tmp/symbiote-notes-*`), and 1,326 `app started` lines in 2 days. Joined on `pid`,
  the person's own servers wrote 4,424 lines and 7 problems.
- **`code` is two things**: an exit code on `server ended` and `analysis ended`, Chromium's
  network error (`-102`) beside `description` on `page did not load`. The template's
  `(exit {{.code}})` is right for the first and wrong for the second.
- **Requests are most of a server's lines**: 3,238 of the person's server's 4,424 (73 %); 1,488 of
  all 3,201 are `POST /api/terminals/<id>/paths`, at `info`. p50 1 ms, p90 37 ms, p99 1.8 s, max
  252 s.
- **LogQL does what the panels need on 3.7.9**: `sum by (level, process, msg)` after `| json msg`;
  `quantile_over_time(0.95, … | unwrap ms [2d]) by (route)` with `label_format route=` and
  `regexReplaceAll` taking the terminal's ID out of a path; `substr 0 1 .status` for the status
  class. Analyses: median 4.1 s over 41.
- **Grafana runs a panel's query for the anonymous viewer**: `POST /api/ds/query` with the
  panel's target and `$__range` in it answers 200 with the frames. The check can run each panel as
  the dashboard does; only the dashboard's own variables are the check's to fill in.

## LG2 — the tests' lines out, the dashboard in sections (2026-10-26, branch `feature/grafana-dashboard`)

`app.spec.ts` runs the app and its servers with `SYMBIOTE_LOG=off` (LG2a). The dashboard in five
sections, a colour a level, one row template in every list; `dashboard.test.ts` in `pnpm check`;
`logs:check` writing a line for every panel and running all of them through Grafana (LG2b).
Decisions 441–444.

**Learned**:
- **A row taller than its panel opens at its end**: Grafana 13's list calls react-window's
  `scrollToItem(0)` with alignment `auto`, which scrolls a too-tall item to show its bottom. The
  problems panel opened 444 px down, mid-stack, with no row header in sight (LG1's dashboard did
  too, whenever the newest error had a long stack). Rows now show a message's first line and a
  stack's first six lines; the whole of both are in the row's details.
- **Loki's templates have `regexReplaceAll` but no `regexFind`**; `$1` in its replacement passes
  through Grafana, which leaves a `$name` it has no variable for as it is. `int`, `divf` and
  `printf` work: `2.5 s` for 2,500 ms.
- **A sparkline's sum is not a count**: summing a range query's buckets gave 4,539 lines where the
  24 h held 4,504; Grafana aligns the start to the step and the first bucket ends before the
  range. The tiles are instant counts, with no sparkline.
- **`insertNulls` did not cut the response time's lines on 13.2.4**: points joined across hours
  without a request. Points only, as the slowest analysis.
- **What fits at 1440 px with Grafana's menu open**: a tile is ~160 px, so "Analyses done" was
  cut; a third of the width wraps a logs row and cuts a table's routes.
- **`logs:check` shares the dashboards folder with the checkout**: a check running while the JSON
  is regenerated reads the new file. One run failed on a tile renamed under it.
- **Decision numbers taken twice**: `feature/complete-revamp` (V61) took 437–440 from the same
  `main` while LG2 was built: LG2's are 441–444 (its plan commit still says 437–440).

**Verification**: tests first, each red for its reason: `dashboard.test.ts` 5 of 8 red on LG1's
dashboard (no sections, no level colours, a coloured 0, two templates, no Server section), then
green; `pnpm logs:check` red (12 panels missing), then green: 17 panels through Grafana, the counts,
kinds, classes and rows the written lines say. `app.spec.ts` with its cache in a temporary folder:
55 lines a run before, no folder after, 19/19. `pnpm check`: 1,880 tests. The person's 7,975 lines
in a second stack: dark and light, 1440×900, 1440 tall, 1920×1080, the Server section open, the
two links followed; a crash in purple in the check's stack.

Not verified: the person's own stack (it reads `main`'s checkout); other Grafana versions; the
full e2e suite (only `app.spec.ts` changed).
