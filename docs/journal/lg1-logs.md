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
