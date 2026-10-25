# LG1 — Symbiote's logs: lines written by every Symbiote process, read by another app

[Index](../PLAN.md) · [Journal](../journal/lg1-logs.md)

**Status:** ready for review (2026-10-25), on branch `feature/logging-system` (a workspace started in
Symbiote, from `main` at `278b3e7`). Replanned after the person's answer to the first plan: "So i
want the logs t o be seen from another app, in case of Symbiote crashes, that is the whole point."
The first plan's Logs page inside Symbiote is dropped: the logs are read by an app that runs on
its own. This plan OK'd by the person ("1. Recommended 2. Yes 3. Yes. OK"): Grafana + Loki +
Alloy; the images pulled and run here for the spike; the hooks and the Codex runner left out, 14
days of files. As built and results under "As built (LG1)" below.

**Problem** (asked: "This application needs a logging system, and a way to see the logs. For the
moment, i need to log Symbiote only logs, in order to debugg easier and catch uncatched errors.
First, propose an open source system for logging, and a way to visualize those"). Today, on
`main` at `278b3e7`:

| What | Today |
|---|---|
| Lines Symbiote writes to any log | none: no log file, and 0 `console.*` calls in `cli`, `desktop`, `viewer`, `core`, `forge`, `monitor` |
| Handlers for uncaught exceptions or unhandled rejections | 0, in the server, the analysis child, the app's main process and the viewer |
| A request that throws | answered `500` with `String(error)`, the message without its stack; nothing kept (`server.ts:236`) |
| The server's stderr when the desktop app starts it | an 8 KB tail kept in memory, read only if the server ends before it serves (`desktop/src/launcher.ts:71–80`); everything written after that is dropped |
| A page that throws while it renders | no error boundary anywhere: React unmounts the whole window, sidenav included |
| Errors set aside on purpose | 180 empty `catch` blocks and 78 `.catch(() => …)` in `cli`, `desktop` and `viewer` |

So:

1. **When something breaks, nothing is left to read.** In the desktop app, which is how Symbiote
   is used day to day, even the server's stderr is lost once it serves.
2. **An uncaught error has no record at all.** Node prints its stack to a stderr nobody reads and
   the process ends. The viewer's errors stay in a DevTools console that is closed.
3. **Anything that reads the logs must not need Symbiote.** A crash is exactly when Symbiote's
   own pages are gone, so a viewer inside Symbiote would fail at the one moment it is needed.

**Goal**: every Symbiote process writes its lines to one local folder and records every uncaught
error with its stack before it ends. **Another app**, running on its own in Docker, reads that
folder and shows the lines: by level and by process, with each line's fields and stack, live,
and over time. It keeps working, and keeps its own copy, when every Symbiote process has died.
Unchanged: what every command prints to stdout and stderr, the exit codes, the graph JSON and the
analysis (`packages/core` is not touched). An uncaught error still ends its process as it does
today: LG1 records it and changes nothing else. The folder is the only contract between Symbiote
and the viewer: Symbiote never talks to the viewer, so the viewer can be stopped, replaced or
never installed.

## The proposal: which open-source system

Two parts: a library that writes the lines, and an app that reads them.

**Writing: [pino](https://github.com/pinojs/pino)** (MIT, 10.4.0 of 2026-10-02). Measured in the
spike (Node 26.8, this machine):

| | pino 10.4 | Alternatives considered |
|---|---|---|
| Size | 13 packages, 2.6 MB installed | winston: more packages and slower by pino's own benchmarks (not measured here); [LogTape](https://logtape.org) 2.4: no dependencies, a smaller community; our own writer: no dependency, and every part below written and kept by us |
| Cost | import 13–14 ms; 10,000 lines in 20–23 ms, written off the event loop | `appendFileSync`: 27–29 ms for the same lines, blocking the server each time |
| Format | one JSON object a line (NDJSON), which every viewer below reads | |
| Errors | `err` with `type`, `message`, `stack` and the `cause` chain ("caused by: …") | |
| A crash | `flushSync()` writes what is pending before the process ends: a throw and a rejection at start both recorded, exit code 1 kept | |
| Secrets | `redact` paths built in | |

**Reading: Grafana + Loki + Alloy, in Docker**, outside Symbiote. Alloy follows the folder, Loki
keeps the lines, Grafana shows them. Docker 29 (Docker Desktop, Compose 2.40) already runs here,
with other self-hosted services kept up for days. The candidates, as of 2026-10-25 (versions and
sizes from Docker Hub, licences and activity from GitHub; nothing pulled or run yet):

| | **Grafana 13.2 + Loki 3.7 + Alloy 1.21** | VictoriaLogs 1.53 + vlagent | lnav | Logdy 0.17 |
|---|---|---|---|---|
| Runs as | 3 containers | 2 containers | a terminal program | 1 binary |
| Download | 483 + 48 + 224 = 755 MB (compressed) | 14 + 12 = 26 MB | a package | a binary |
| Licence | AGPL-3.0, AGPL-3.0, Apache-2.0 | Apache-2.0 | BSD-2-Clause | Apache-2.0 |
| Reads the folder | Alloy: a glob, new day files found, positions kept across restarts | vlagent: a glob (`-fileCollector.glob`), checkpoints; finds `msg` and `time` by itself | opens the files | follows the files named at start |
| Keeps its own copy | yes (Loki) | yes | no | no (memory) |
| Reading | Logs Drilldown: lines by level and by process without writing a query, fields from the JSON, volume over time; Explore with live tail; dashboards; alerts | its own page: live tail, grouped by stream, a table with each entry's fields; LogsQL | a terminal UI, SQL over the lines | columns from the JSON, filters |
| Activity | pushed 2026-10-25 | pushed 2026-10-23 | pushed 2026-10-25 | last push 2025-08-25 |

**Recommended: Grafana + Loki + Alloy.** It is the best at the two things asked, seeing and
digging: Drilldown sorts the lines by level and process with no query, a click on a field filters
by it, and a dashboard can show errors over time per process. It is also the most documented
stack. It costs 755 MB of images, three services and Alloy's parsing pipeline to keep.
**VictoriaLogs** is the light choice, if preferred: 26 MB, two services, a simpler page of its
own. The rest of the plan is the same with either, since both read the same folder. lnav (or
`jq`) stays the way to read the files when Docker is not running; the README says how.

## The files: the contract

- **Folder**: `SYMBIOTE_LOG_DIR` when set, else `<cache>/logs`, the cache by the CLI's rules
  (`SYMBIOTE_CACHE_DIR`, `XDG_CACHE_HOME`, `~/Library/Caches/symbiote` on macOS, else
  `~/.cache/symbiote`): `~/.cache/symbiote/logs/` here.
- **One file per local day**, `2026-10-25.jsonl`. Every Symbiote process appends to it; each line
  says which (`process`, `pid`). A process that runs past midnight moves to the next day's file.
  Files are never renamed, so a reader following them never loses its place.
- **Kept 14 days**: older files removed when `symbiote view` or the app starts. Loki keeps its own
  copy longer (30 days).
- **Level** `info` by default; `SYMBIOTE_LOG_LEVEL=debug|info|warn|error` changes it;
  `SYMBIOTE_LOG=off` writes nothing and creates no folder.
- **Never on stdout or stderr**: commands print exactly what they print today (the app reads
  `Symbiote viewer: <url>` from stdout; CI reads stderr).
- **A line** is pino's, with the time as ISO text and the level as a word, so a person reading the
  raw file, Loki's level detection and lnav all read it as it is:
  `{"level":"error","time":"2026-10-25T14:02:11.348Z","pid":90848,"process":"view","msg":"request failed","method":"GET","path":"/api/workspaces","status":500,"err":{"type":"Error","message":"…","stack":"…"}}`.
  Fields used across processes have one name: `process`, `repo`, `method`, `path`, `status`,
  `ms`, `branch`, `pair`, `page`, `err`.
- **Never in a line**: request bodies, prompts and briefs, terminal input or output, file contents,
  environment variables and tokens. pino's `redact` blanks `*.token` and `*.authorization` as a
  guard; a test posts a body and checks it is in no line.

## What is recorded

| Process (`process`) | Lines |
|---|---|
| Every Node process: `view`, `diff`, `pr`, `merge`, `app` | **an uncaught exception or unhandled rejection**: `fatal`, with its stack and `origin`, flushed synchronously by an `uncaughtExceptionMonitor` listener. That listener changes nothing: Node still ends the process with 1, Electron's main still shows its dialog |
| A process that dies without a word (killed, out of memory) | its own handler cannot run, so **its parent records the end**: the server for an analysis child, the app for a server it started, with the exit code or signal and the last lines of its stderr ("JavaScript heap out of memory" is one) |
| `view`, the server | started (version, repository, address) and stopped; a `5xx` answer as `error` with method, path and stack; every request at `debug` (method, path, status, ms); an analysis started, done (ms, symbols) or failed, and the warnings its child printed; a workspace started, stopped or removed; an agent's or terminal's process ending with an error; a merge queued, landed or failed (its step); a checkout done or refused; a plugin that does not load; a usage read that fails (`warn`); Scout or Scribe failing |
| `app`, the desktop app's main process | started (version, Electron, from `symbiote view` or the desktop); a page that does not load; a renderer gone or unresponsive; a preload error; the server it started ending, as above |
| `viewer`, the pages | `window` errors and unhandled rejections, and React's `onUncaughtError`/`onCaughtError` with the component stack, posted to the server, which writes them |

**Not recorded** (later if wanted): the agents' hooks (`agent-hook`, `scout-hook`, `scribe-hook`)
and the Codex runner. Each hook runs once per agent event, is built never to throw, and imports
only Node's own modules to stay at ~25 ms an event (`thread.ts`); pino would add ~14 ms each time.
Also not recorded: the analyzed repository's own logs, the agents' output (their terminals show
it) and the merger's steps (V46 keeps its own log). LG1 adds lines at the services' edges; it does
not turn the 180 set-aside `catch` blocks into lines. That pass is better made from what the
first weeks of logs show.

## Code

- **`packages/log`, `@symbiote/log`** (new): `logsDir(env, platform, home)`;
  `openLog({ process, env })` → `{ log, file, close }` (a pino logger on the day's file, opened
  with `openSync` and handed to pino as a descriptor; see the journal's spike); `watchUncaught(log)`;
  `pruneLogs(dir, days, now)`. Depends on `pino@10.4.0`, pinned as the CLI pins its own. A
  package because two programs write: the CLI and the app. The app cannot import the CLI (the CLI
  depends on the app) nor `@symbiote/core` (ts-morph). A log that cannot open (folder not
  writable, disk full) is a logger that writes nothing: logging never stops Symbiote.
- **`packages/cli`**: `bin.ts` opens the log for every command (`process` is the command) and
  watches uncaught errors; `server.ts` logs `5xx` answers and requests, and takes the pages'
  errors at `POST /api/logs` (absolute, as `/api/intro`: a diff's page posts too; 32 KB at most,
  the write header and the same site, 60 a minute); `runner.ts` records an analysis child's
  abnormal end; each service of `main.ts` gets a child logger for the lines above.
- **`packages/desktop`**: `main.ts` opens the log (`process: 'app'`) and logs the window's events
  and the end of a server it started.
- **`packages/viewer`**: `src/ui/report.ts` (new): the pages' errors, a repeated message sent once
  per 10 s with how many times it came, 30 lines a minute at most (pure parts tested). Installed
  in `main.tsx` on every page, never on a `?graph=` page, which has no server. No new page.
- **`ops/logs/`** (new, outside the packages): `compose.yml` (Loki, Alloy, Grafana; images pinned;
  `restart: unless-stopped`; ports on `127.0.0.1` only; the folder mounted read-only),
  `alloy.alloy` (follow `*.jsonl`; take `time` as the line's time; `process` and `level` as
  labels, everything else stays in the line), `loki.yaml` (one process, files on a volume, 30 days,
  structured metadata on for Drilldown), Grafana's provisioning (the Loki data source, a
  "Symbiote" dashboard: errors and warnings over time by process, the latest errors with their
  stacks, all lines with level, process and text filters; signed in without a password, since it
  only listens on this machine). `pnpm logs:up`, `logs:down`, `logs:check` in the root
  `package.json`. The repository map in `CLAUDE.md` names the folder.

## Verification

1. **Spike first, before any Symbiote code** (after the person's OK, since it pulls 755 MB of
   images): the stack up on this machine, reading a folder of written lines. Measured: memory at
   rest (`docker stats`), seconds from a line written to the line in Loki, that a folder in WSL
   mounted into Docker Desktop is followed, that a new day's file is found, and that lines up to
   14 days old are taken (Loki refuses old lines by default: a week).
2. **Tests first** (red before):
   - `packages/log/test/`: the folder by environment and platform; the day's file and a line's
     fields (ISO time, level word); levels and `SYMBIOTE_LOG=off` (no folder made); an error's
     stack and causes; `pruneLogs` by age; a child process that throws and one that rejects at
     start: exit code 1 as without logging, and a `fatal` line with the stack in the file.
   - `packages/cli/test/logs.test.ts`: a route that throws gives `500` and an `error` line with
     method, path and stack; `POST /api/logs` writes a `viewer` line; refused without the
     header, from another site or over 32 KB; the cap; a posted body found in no line; an analysis
     child killed (`SIGKILL`) leaves a line naming the signal.
   - `packages/desktop/test/`: the app's lines for a server that ends (pure parts).
   - `packages/viewer/test/report.test.ts`: the dedup and the cap; `e2e/report.spec.ts`: an error
     thrown in a page ends up as a line in the server's folder. Every other spec keeps checking
     that there were no page errors.
3. **The viewer, end to end**: `pnpm logs:check` starts a second copy of the stack (its own
   Compose project, ports and a temporary folder), writes lines, and asks Loki for them until they
   come (a time limit). Not in `pnpm check`, which must not need Docker.
4. **Nothing else changes**: `pnpm check` and every existing test; `symbiote diff` on ky and zod
   (`regression-check` repositories): graph JSON, stdout and stderr byte for byte as `main`'s;
   with `SYMBIOTE_LOG=off`, no folder. Tests never write into `~/.cache`: vitest runs with
   `SYMBIOTE_LOG=off` unless a test gives a folder; the e2e harness gives each server its own.
5. **Real crashes, with Symbiote dead**: `symbiote view` here and the desktop app. Each once: an
   error thrown in a page, an analysis child killed, the server killed under the app, a server
   that throws at start. Then, with no Symbiote process left, each must be in Grafana with what is
   needed to find its cause. Screenshots of Drilldown and the dashboard for the person.
6. **Cost**: `symbiote view`'s start and a `symbiote diff` on zod against `main` (expected
   +~15 ms, the import); the stack's memory at rest; lines and bytes for a day of use at `info`.

**Risks**

| Risk | Mitigation |
|---|---|
| Several processes append to one file: a partial write could tear a line | each write is whole lines on a file opened to append; Alloy keeps a line it cannot parse as text, so it is still seen |
| Docker is not running when Symbiote crashes | the files do not need it: the stack reads them from its last position when it starts; lnav or `jq` read them without it (README) |
| A WSL folder mounted into Docker Desktop is not followed, or late | measured in the spike first; `SYMBIOTE_LOG_DIR` can point at any folder Docker sees |
| Loki refuses lines older than a week, or out of order between processes | its limits set in `loki.yaml`; checked in the spike with a 14-day folder |
| `debug` floods the files (the shell polls every 1.5–5 s) | `info` by default; requests only at `debug`; 14 days kept |
| A page's error in a loop floods the server | the reporter's dedup and cap; the server takes 60 a minute |
| A secret in a line | fields named by convention, `redact`, the test on posted bodies |
| Grafana open without a password | it listens on `127.0.0.1` only; the lines hold no secrets (above) |
| An error before the log opens (a failed import) | not recorded; it stays on stderr as today |
| The tests' lines in the person's folder | `SYMBIOTE_LOG=off` in vitest, a folder per e2e server, a temporary folder for `logs:check` |

**Order**: the spike (the stack on this machine), then LG1a, then LG1b. Each ends green and is
committed and pushed.

## Milestones

| # | Milestone | Output |
|---|---|---|
| LG1a | The lines | `@symbiote/log`; the CLI, the server, the app and the pages write; uncaught errors and silent deaths recorded; the folder kept 14 days |
| LG1b | The viewer | `ops/logs/`: Loki, Alloy and Grafana with the dashboard; `pnpm logs:up`, `logs:down`, `logs:check`; README |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 349 | Which library writes the lines? | **pino 10.4** | standard NDJSON every viewer reads; 10,000 lines in 20 ms off the event loop; stack and causes; a synchronous flush on a crash (spike) |
| 350 | What reads them? | **another app: Grafana + Loki + Alloy in Docker; nothing in Symbiote reads them** | asked: the logs must be seen when Symbiote has crashed; the best at seeing and digging; VictoriaLogs if a light one is preferred |
| 351 | Where are the files, and how are they written? | **`<cache>/logs`, one file per local day, every process appending, 14 days kept; ISO time, level as a word** | never renamed, so a follower never loses its place; a person reading the raw file and every tool read it as it is |
| 352 | How are uncaught errors caught? | **`uncaughtExceptionMonitor`, then a synchronous flush; the process ends as today; a silent death is recorded by the parent** | recording must not change behaviour; continuing after an uncaught exception is unsafe (Node's docs); a killed process cannot speak for itself |
| 353 | How do the pages' errors reach the files? | **posted to `POST /api/logs`, deduplicated and capped; no logger in the bundle** | one writer per machine process; the bundle stays as it is |
| 354 | Which levels? | **`info` by default, `SYMBIOTE_LOG_LEVEL`, `SYMBIOTE_LOG=off`; tests off** | requests every few seconds belong at `debug`; the person's folder holds only real use |
| 355 | Where does the code live? | **a package, `@symbiote/log`** | the CLI and the app both write and neither can import the other's code |
| 356 | What is never logged? | **bodies, prompts, briefs, terminal input and output, file contents, environment, tokens** | the folder is local, but a line is pasted to agents and into issues |
| 357 | How is the viewer kept? | **`ops/logs/` in this repository: a Compose file, pinned images, `127.0.0.1` only, `restart: unless-stopped`, Loki 30 days** | set up once with `pnpm logs:up`, then always there, Symbiote running or not; its config reviewed with the code that writes the files |
| 366 | How is a line written? (as built) | **synchronously, one `write` a line, on a descriptor opened to append** | 2.6–3.1 µs a line (measured); on disk when the call returns, so a crash loses nothing in flight and nothing needs flushing; whole lines however many processes append. 365 and below were taken by another workspace meanwhile |

**Not in LG1 (later)**: a Logs page inside Symbiote (useful while it runs; the person's point is
the other app); a boundary that keeps the sidenav when a page throws; Grafana alerts on a `fatal`;
the hooks and the Codex runner; a level switch in Settings; sending lines off the machine; the
agents' and the analyzed repository's logs; traces (OpenTelemetry); a pass over the set-aside
`catch` blocks.

## As built (LG1)

- **Synchronous writes** (decision 366), not pino's asynchronous destination: a line costs
  2.6–3.1 µs, nothing is in flight at a crash, and `watchUncaught` only logs (no flush). The
  spike's trap (`flushSync()` throws until an async-opened file is open) is gone with it.
- **The line's shape** as planned (ISO time, level as a word), written by pino with its own
  `timestamp` and `formatters.level`; `Log.as(name)` writes another program's lines into the same
  file: the server writes the pages' errors as `viewer`. pino's `err` serializer takes any object
  with a `message` for an Error and writes its constructor's name (`Object`) as `type`: the
  pages' errors go through a logger that writes `err` as sent.
- **Program names**: `analysis` for a `symbiote diff` that `symbiote view` started (it has an IPC
  channel), `diff` from a terminal; `view`, `pr`, `merge`, `app`, `viewer`, `cli`.
- **Uncaught errors**: thrown at an ES module's top level, an error arrives as
  `unhandledRejection` (the module's evaluation rejects): `bin.ts`'s `await run(…)` is such a
  place, so a command that throws is written as an unhandled rejection. In a callback it is an
  `uncaughtException`.
- **Requests**: writes at `info` except the chatty ones (`/api/terminals/<id>/in|resize`,
  `…/api/state/…`, at `debug` with the reads); a refusal's or failure's words (`answer`, 500
  characters). A terminal's ID is written short (8 characters): it keeps other sites out of the
  terminal while the server runs. `view started` is written before the address is printed.
- **A command's refusal** (`SymbioteError`) is a `warn` line, `refused`, with the command.
- **Terminals** write a program starting and ending (its name, never what it runs); **merges**
  their states through the merger's existing `onChange`; the **app** also writes Chromium's own
  processes ending badly (`child-process-gone`), and the launcher keeps a server's last 8 KB of
  stderr after it serves, for its `server ended` line.
- **The pages**: `ui/report.ts` hands an error React reports on to `window.reportError` after
  sending it, so the console and the e2e checks see it as before.
- **Loki**: lines read late were taken but found by no query until flushed (30 min of quiet by
  default); `query_ingesters_within: 0` changed nothing on 3.7.9. `ingester.chunk_idle_period: 1m`
  does: the 13-day-old lines show 66–82 s after `up` (Loki itself is ready after 30 s).
- **Grafana**: on port 3300 (3000 is a common default). Grafana 13 signs in anonymously only as a
  viewer, and sent the viewer from Explore and Logs Drilldown back to the home page although its
  API grants it `datasources:explore`: `viewers_can_edit` lets both open (it saves nothing, the
  dashboard is provisioned). It downloads its preinstalled plugins (Drilldown among them) at its
  first start and updated them at every start: updates are off.
- **The dashboard's rows** say how a process ended and the pair analyzed ("analysis ended
  cd1dba0..b28ba90 (SIGKILL)", "server ended (SIGKILL)"), a page error's message once.
- **`logs:check`** starts from nothing: Alloy keys its read positions by the path in the
  container, the same for every check's folder.

**Results.**

- Tests: 1,609 unit tests, 37 of them new (1,572 on `main`): the package 16 (two of them crash
  a child process), the CLI 14 (the server and the folder 10, the runner 3, the terminals 1), the
  launcher 1, the reporter 6. `pnpm check` green.
  `e2e/report.spec.ts` new; the whole e2e suite 241/241 on Chromium 147 (see the journal: this
  machine's Chromium 153 draws no frames, on `main` too).
- Nothing else changes: `symbiote diff` on 12 pairs (ky's 6 of `r1`, zod's 6 latest source
  commits: `r1`'s zod commits are reachable from no branch any more), `main`'s build against the
  branch's: graph (timing and version aside), stderr and exit code identical, 12/12.
- Real crashes, then every Symbiote process gone, read back from Loki and seen in Grafana: a
  page's error (`viewer`, its page and stack), an analysis killed (`analysis ended`, `SIGKILL`), a
  server whose port was taken (`fatal`, `listen EADDRINUSE` and its stack), the desktop app's
  server killed (`server ended`, `SIGKILL`, written by the app).
- The viewer: a line in Loki 1.3 s after it is written, a new day's file 5.3 s; Loki ready 30 s
  after `up`; Alloy 40 MiB, Loki 89–109 MiB, Grafana 267–289 MiB at rest; 2.9 GB of images.
- Cost: `symbiote --version` 228 → 237 ms and 238 → 245 ms, `symbiote view` until it serves 232
  → 243 ms and 230 → 245 ms (medians, two runs of the comparison): +7 to +15 ms, pino's import. A
  successful `symbiote diff` writes no line; a `view` start and stop two.

