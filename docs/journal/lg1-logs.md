# Journal: LG1 — Symbiote's logs

[Index](../JOURNAL.md) · [Plan](../plan/lg1-logs.md)

## LG1 spike — what Symbiote keeps when it breaks, and pino's cost (2026-10-25, branch `feature/logging-system`)

Read on `main` at `278b3e7`: where each process writes, and what is kept of an error. Then pino
10.4.0 installed in a scratch folder (outside the repository) and timed with Node 26.8.2 on this
machine: its import, 10,000 lines against `appendFileSync`, an error with a cause, and a process
that throws or rejects right after it opens its log (5 runs each).

**Learned**:
- **Nothing is kept today**: 0 `console.*` calls in six packages, 0 handlers for uncaught errors,
  no error boundary. A request that throws is answered `500` with the message alone
  (`server.ts:236`). From the desktop app, the server's stderr is an 8 KB tail read only if the
  server ends before it serves (`desktop/src/launcher.ts:71–80`): after that, a crash's stack goes
  nowhere.
- **pino is cheap**: 13 packages, 2.6 MB installed; import 13.0–14.0 ms; 10,000 lines of ~111
  bytes in 19.6–22.5 ms, against 26.8–28.9 ms for `appendFileSync`, which also blocks each time.
  An error with a `cause` is written with both stacks ("caused by: Error: inner").
- **The trap: `flushSync()` before the file is open.** With `pino.destination({ dest, sync: false })`
  the file opens asynchronously, and `flushSync()` throws "sonic boom is not ready yet" until it
  has. A crash in a process's first milliseconds would lose its own line. Opening the file with
  `openSync(file, 'a')` and handing pino the descriptor (`{ fd, sync: false }`) makes it ready at
  once.
- **`uncaughtExceptionMonitor` records without changing anything**: a throw and an unhandled
  rejection, each right after start, both wrote a `fatal` line (level 60) with the stack, and the
  process still exited 1, as with no listener.
- **Volume**: the shell polls every 1.5–5 s while something is live (`useWorkspaces.ts`) and the
  usage every 60 s, so a request line each would be thousands a day; requests belong at `debug`.

## LG1 replan — the logs read by another app (2026-10-25, branch `feature/logging-system`)

The person's answer to the first plan: "So i want the logs t o be seen from another app, in case
of Symbiote crashes, that is the whole point." The Logs page inside Symbiote is dropped: a crash
is when Symbiote's pages are gone. The viewers that read a folder of JSON lines on their own were
compared from Docker Hub and GitHub on 2026-10-25, nothing pulled or run yet.

**Learned**:
- **The machine already runs a Docker stack**: Docker 29.0.1 (Docker Desktop, Compose 2.40.3),
  several self-hosted services up for 42 hours, 31 GB of memory, ports 3000 and 3100 free.
- **Sizes**: Grafana 13.2.4 483 MB, Loki 3.7.9 48 MB, Alloy 1.21.2 224 MB (compressed, amd64);
  VictoriaLogs 1.53.0 14 MB and vlagent 12 MB. Licences: Grafana and Loki AGPL-3.0, Alloy and
  VictoriaLogs Apache-2.0, lnav BSD-2-Clause. Logdy's last push is 2025-08-25.
- **vlagent reads pino's lines with no setup**: `-fileCollector.glob`, checkpoints across
  restarts, `msg` and `time` found by itself; it loses lines with `copytruncate` rotation, one
  more reason to never rename or truncate a file.
- **The format changes for readers outside Symbiote**: ISO time and the level as a word (pino's
  `timestamp` and `formatters.level`), so Loki's level detection, lnav and a person reading the raw
  file need no mapping from `30`/`50` and epoch milliseconds.
- **A death without a word**: a process killed or out of memory runs no handler, so its parent
  has to record how it ended (the server for an analysis child, the app for its server).

## LG1 spike — Grafana, Loki and Alloy on this machine (2026-10-25, branch `feature/logging-system`)

`ops/logs/` (Loki 3.7.9, Alloy 1.21.2, Grafana 13.2.4) run as a Compose project of its own on
random ports, reading a folder in WSL's home with lines of today and of 13 days ago, an error with
a stack and a line that is not JSON. Docker Desktop 29, Compose 2.40.3, WSL2.

**Learned**:
- **Size on disk**: the images unpack to 1.94 GB (Grafana), 945 MB (Alloy) and 47 MB (Loki), 2.9
  GB in all, against 755 MB downloaded.
- **At rest**: Alloy 40 MiB, Loki 89 MiB, Grafana 289 MiB (418 MiB), each under 1 % CPU. Loki is
  ready 32 s after `up`.
- **Fast enough to watch a crash**: a line appended is in Loki 1.34 s later (three runs alike); a
  new day's file 5.3 s later (Alloy looks for new files every 5 s). A folder in WSL mounted into
  Docker Desktop is followed with no setting.
- **The trap: old lines are taken but not found.** Loki took the 13-day-old lines (no discard;
  `reject_old_samples_max_age` raised to 30 days) but no query returned them: a query over 3 h ago
  does not ask the ingester's memory, only the store, which has them after a flush, 30 min of
  quiet by default. `query_ingesters_within: 0`, in the YAML or as the flag, did not change it on
  3.7.9 (the effective `/config` does not even list it). `POST /flush` made them appear at once;
  `ingester.chunk_idle_period: 1m` makes it so on its own: the old lines showed 66 s after `up`.
  So a viewer started after a crash, or after days stopped, shows the files it missed within
  about a minute and a half.
- **A stack reads as lines**: `| json | line_format "{{.process}} · {{.msg}}\n{{.err_stack}}"`
  turns the escaped `\n` of `err.stack` into real lines. A line that is not JSON is kept as text,
  `detected_level=unknown`.
- **Grafana 13 signs in anonymously only as a viewer** ("auth.anonymous.org_role is deprecated,
  only viewer role is supported"). A viewer has `datasources:explore`, `datasources:query` and
  `dashboards:read`: enough to read. Logs Drilldown (`grafana-lokiexplore-app` 3.0.0) comes
  installed.

## LG1a — the lines: @symbiote/log, the CLI, the server, the app and the pages (2026-10-25, branch `feature/logging-system`)

`@symbiote/log` (pino 10.4, MIT) writes every Symbiote process's lines into
`<cache>/logs/<YYYY-MM-DD>.jsonl`, synchronously, one `write` a line; `watchUncaught` records
uncaught errors as `fatal`. `bin.ts` opens it for every command, the server writes a line per
request and takes the pages' errors at `POST /api/logs`, the runner writes each analysis and how a
child that died ended, terminals and merges their programs and states, the desktop app its own
lines and the end of a server it started, `ui/report.ts` the pages' errors. Decisions 349–357 and
366.

**Learned**:
- **Write synchronously**: 2.6–3.1 µs a line with pino on a descriptor opened to append, against
  2.0–2.3 µs asynchronously. At Symbiote's few lines a second the difference is nothing, and it
  buys what logging is for here: a line is on disk when the call returns, so a crash loses
  nothing in flight (the async destination's `flushSync()` threw "sonic boom is not ready yet"
  until its file was open, the spike's trap), and lines from several processes stay whole.
- **A top-level throw is a rejection**: in an ES module, an error thrown at the top level reaches
  `uncaughtExceptionMonitor` with origin `unhandledRejection`, since the module's evaluation
  rejects. `bin.ts` awaits `run(…)` at its top level: a command that throws is written as an
  unhandled rejection (the real crash run's `listen EADDRINUSE` is one).
- **pino's `err` serializer** takes any object with a `message` for an Error and writes its
  constructor's name as `type`: a page's `{ name: 'TypeError', … }` became `type: "Object"`. The
  pages' errors go through a child logger whose `err` is written as sent.
- **A repeated `process` key**: a pino child logger adds its bindings after the parent's, so
  `log.child({ process: 'viewer' })` would write `"process":"view",…,"process":"viewer"`.
  `Log.as(name)` makes a second logger on the same file instead.
- **What a path carries**: a request line's path held a terminal's whole ID
  (`/api/terminals/<32 hex>/in`), the capability that keeps other sites out of it; written short
  now. Found reviewing the diff, with `pruneLogs` rejecting on a file it may not remove (EISDIR in
  the test), which `view` did not catch: an unhandled rejection would have ended the server.
- **Order with the ready line**: a Ctrl+C sent the moment `view` printed its address lost the
  `view started` line (written after it, and `view`'s Ctrl+C handler is set later still). It is
  written first now; `view stopped` still needs `view` to have set its handler, as before.

**Verification**: tests first, each red for its reason (not a function, no line, 405, the whole
ID written, EISDIR), then green; 1,609 unit tests (37 new). `e2e/report.spec.ts` (written after the
reporter, so not seen red): an error thrown and a promise rejected in History are `viewer` lines
beside the server's `view started`. `symbiote diff` on 12 ky and zod pairs, `main`'s build against
the branch's: graph, stderr and exit code identical, 12/12. Start cost +7 to +15 ms.

Not verified: React's `onUncaughtError` path in a browser (no page throws while it renders on
purpose; the reporter's rules are unit-tested, the wiring is not); the hooks and the Codex runner
write nothing (left out, as planned).

## LG1b — the viewer: Grafana, Loki and Alloy, and real crashes read back (2026-10-25, branch `feature/logging-system`)

`ops/logs/`: the Compose file, Alloy's pipeline, Loki's config, Grafana's data source and the
Symbiote dashboard; `pnpm logs:up`, `logs:down`, `logs:check`; the README's "Symbiote's logs".
Then real crashes with everything of its own (a Compose project, a log folder, a cache, a config
folder for the app's record, an Xvfb display), read back with no Symbiote process left.

**Learned**:
- **Grafana 13 and the anonymous viewer**: it may only be a viewer, and the viewer was sent from
  Explore and Logs Drilldown back to the home page although `/api/access-control/user/permissions`
  lists `datasources:explore`. `GF_USERS_VIEWERS_CAN_EDIT=true` lets both open; nothing can be
  saved (the dashboard is provisioned).
- **Grafana fetches and updates its plugins**: its preinstalled plugins (Logs Drilldown 3.0.0
  among them) are downloaded at its first start, about 14 s after it answers, and were updated at
  every start (tempo 13.2.4 → 13.3.0): `GF_PLUGINS_PREINSTALL_AUTO_UPDATE=false`. So the viewer
  needs the internet once.
- **A provisioned dashboard is read again every ~10 s**: a screenshot taken at once showed the old
  rows while the API already served the new expression.
- **Alloy keys its read positions by the path in the container**: a second check on a new folder,
  with the volume of a first one that had stopped, skipped the new file's first bytes and found
  nothing. `logs:check` starts from nothing; a person's viewer never meets it (the files only
  grow, under one folder).
- **`process.exit` skips `finally`**: the first `logs:check` failed with its stack left running.
  Its failures throw now, and the stack is removed whatever happens.
- **This machine's Chromium 153 draws no frames headless**: `requestAnimationFrame` never ran (0
  frames in 2.5 s with every flag tried: `--disable-gpu`, SwiftShader, no GPU compositing), so
  Playwright's clicks waited for "stable" forever: 38 failures in the first 73 e2e tests, on `main`
  as on the branch. The cached headless shell of Chromium 147 draws 62 frames a second: the suite
  ran on it through a configuration outside the repository (241/241 on the branch; `main` 239/240,
  the intro's WebGL flaky under load: 84/84 on both when the intro and app specs ran alone, three
  times each).
- **`r1`'s zod commits are gone**: none of its six is reachable from any branch of zod now, and a
  short SHA cannot be fetched; `setup.mjs` would stop on them. The comparison took zod's six latest
  source commits instead. The set needs new zod commits (not done here).

**Verification**: `pnpm logs:check` (a second stack on a temporary folder: today's lines in Loki as
soon as it is ready, 30 s after `up`; a 13-day-old line 40–52 s later; the crashes panel's rows
with their stacks; Grafana with Loki, the dashboard and Drilldown). Real crashes, read back from
Loki with every Symbiote process gone and seen on the dashboard (dark and light) and in Drilldown:
a page's error, an analysis killed (`kill -9`, 15 ms in), a second `symbiote view` on a taken port
(`fatal`, `listen EADDRINUSE` with its stack), the desktop app's server killed (`server ended`,
`SIGKILL`). At rest: Alloy 40 MiB, Loki 89–109 MiB, Grafana 267–289 MiB.

Not verified: the viewer after a reboot (`restart: unless-stopped` with Docker Desktop starting
at login); a day's file of real use (only test runs were written here).
