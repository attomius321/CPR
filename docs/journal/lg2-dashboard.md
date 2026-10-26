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
