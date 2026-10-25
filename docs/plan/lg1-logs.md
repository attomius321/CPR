# LG1 — Symbiote's logs: lines written by every Symbiote process, read on a Logs page

[Index](../PLAN.md) · [Journal](../journal/lg1-logs.md)

**Status:** planned (2026-10-25), on branch `feature/logging-system` (a workspace started in
Symbiote, from `main` at `278b3e7`); waiting for the person's OK. Nothing is built yet.

**Problem** (asked: "This application needs a logging system, and a way to see the logs. For the
moment, i need to log Symbiote only logs, in order to debugg easier and catch uncatched errors.
First, propose an open source system for logging, and a way to visualize those, better if those
are under the same app"). Today, on `main` at `278b3e7`:

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

**Goal**: every Symbiote process writes its lines to one local folder, in a standard format, and
records every uncaught error with its stack before it ends. A **Logs** page in Symbiote's sidenav
(`/logs`, key `l`) reads them: filter by level, by process and by text, follow new lines live,
open a line to see its stack, copy it to give to an agent. The sidenav counts new errors on the
page's entry. Unchanged: what every command prints to stdout and stderr, the exit codes, the graph
JSON and the analysis (`packages/core` is not touched). An uncaught error still ends its process
as it does today: LG1 records it and changes nothing else.

## The proposal: which open-source system

Two parts: a library that writes the lines, and a way to read them.

**Writing: [pino](https://github.com/pinojs/pino)** (MIT, 10.4.0 of 2026-10-02). Measured in the
spike (Node 26.8, this machine):

| | pino 10.4 | Alternatives considered |
|---|---|---|
| Size | 13 packages, 2.6 MB installed | winston: more packages and slower by pino's own benchmarks (not measured here); [LogTape](https://logtape.org) 2.4: no dependencies, also runs in browsers, a smaller community; our own writer: no dependency, and every part below written and kept by us |
| Cost | import 13–14 ms; 10,000 lines in 20–23 ms, written off the event loop | `appendFileSync`: 27–29 ms for the same lines, blocking the server each time |
| Format | one JSON object a line (NDJSON), the format pino-pretty, lnav, Grafana Loki and Vector read without setup | |
| Errors | `err` with `type`, `message`, `stack` and the `cause` chain ("caused by: …") | |
| A crash | `flushSync()` writes what is pending before the process ends: a throw and a rejection at start both recorded, exit code 1 kept | |
| Secrets | `redact` paths built in | |

**Reading: a Logs page in Symbiote**, the same app, as asked. The alternatives:

| | Where | Verdict |
|---|---|---|
| **A Logs page in Symbiote** | the sidenav, beside Monitor | **chosen**: nothing to install or run; live; reads the folder directly; can link a line to Symbiote's own pages |
| Grafana + Loki (+ Alloy to ship the files) | three services in Docker, a browser tab | powerful, but a hosted-style stack for one person's local lines, against "local and fast beats hosted" |
| lnav, pino-pretty | a terminal | good for a quick look, outside the app; they read pino's files as they are, so the README names them |
| Logdy, Dozzle | a separate web app | another program to run beside Symbiote |

Because the files are pino's standard format, choosing the page does not close the others: lnav,
pino-pretty or a Loki can read the same folder later with no change in Symbiote.

## The files

- **Folder**: `SYMBIOTE_LOG_DIR` when set, else `<cache>/logs`, the cache by the CLI's rules
  (`SYMBIOTE_CACHE_DIR`, `XDG_CACHE_HOME`, `~/Library/Caches/symbiote` on macOS, else
  `~/.cache/symbiote`): `~/.cache/symbiote/logs/` here.
- **One file per local day**, `2026-10-25.jsonl`. Every Symbiote process appends to it; each line
  says which (`process`, `pid`). A process that runs past midnight moves to the next day's file.
- **Kept 14 days**: older files removed when `symbiote view` or the app starts.
- **Level** `info` by default; `SYMBIOTE_LOG_LEVEL=debug|info|warn|error` changes it;
  `SYMBIOTE_LOG=off` writes nothing and creates no folder.
- **Never on stdout or stderr**: commands print exactly what they print today (the app reads
  `Symbiote viewer: <url>` from stdout; CI reads stderr).
- **A line** is pino's: `{"level":50,"time":1792934431985,"pid":90848,"process":"view","msg":"request failed","method":"GET","path":"/api/workspaces","status":500,"err":{"type":"Error","message":"…","stack":"…"}}`.
  Levels are pino's numbers (10 trace, 20 debug, 30 info, 40 warn, 50 error, 60 fatal). Fields used
  across processes have one name: `process`, `repo`, `method`, `path`, `status`, `ms`, `branch`,
  `pair`, `page`, `err`.
- **Never in a line**: request bodies, prompts and briefs, terminal input or output, file contents,
  environment variables and tokens. pino's `redact` blanks `*.token` and `*.authorization` as a
  guard; a test posts a body and checks it is in no line.

## What is recorded

| Process (`process`) | Lines |
|---|---|
| Every Node process: `view`, `diff`, `pr`, `merge`, `app` | **an uncaught exception or unhandled rejection**: `fatal`, with its stack and `origin`, flushed synchronously by an `uncaughtExceptionMonitor` listener. That listener changes nothing: Node still ends the process with 1, Electron's main still shows its dialog |
| `view`, the server | started (version, repository, address) and stopped; a `5xx` answer as `error` with method, path and stack; every request at `debug` (method, path, status, ms); an analysis started, done (ms, symbols) or failed, and the warnings its child printed; a workspace started, stopped or removed; an agent's or terminal's process ending with an error; a merge queued, landed or failed (its step); a checkout done or refused; a plugin that does not load; a usage read that fails (`warn`); Scout or Scribe failing |
| `diff`, an analysis `symbiote view` starts | its uncaught error (its stderr still goes to the server, as today) |
| `app`, the desktop app's main process | started (version, Electron, from `symbiote view` or the desktop); a page that does not load; a renderer gone or unresponsive; a preload error; a server it started ending after it served, with that server's last stderr lines, kept at last |
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
  `readLogs(dir, query)` (a day's lines by level, process and text, newest first, a page at a time,
  a torn line skipped); `logDays(dir)`; `pruneLogs(dir, days, now)`; the line's type `LogLine`.
  Depends on `pino@10.4.0`, pinned as the CLI pins its own. A package because two programs write:
  the CLI and the app. The app cannot import the CLI (the CLI depends on the app) nor
  `@symbiote/core` (ts-morph). The viewer imports its **types** only, as it does the Monitor's.
  A log that cannot open (folder not writable, disk full) is a logger that writes nothing: logging
  never stops Symbiote.
- **`packages/cli`**: `bin.ts` opens the log for every command (`process` is the command) and
  watches uncaught errors; `logs.ts` (new), the server's `/api/logs…`; `server.ts` logs `5xx`
  answers and requests and routes `/api/logs…`; each service of `main.ts` gets a child logger
  for the lines above.
- **`packages/desktop`**: `main.ts` opens the log (`process: 'app'`) and logs the window's and
  server's events.
- **`packages/viewer`**: `src/logs/` (new) with `LogsPage.tsx`, `LogsPage.css`, `logs.ts` (pure:
  the query, a line's text and fields, the levels' names) and `report.ts` (the pages' errors:
  dedup and cap, pure parts tested); `shell/PageBoundary.tsx`; the route in `shell/pages.ts`, the
  entry in `Sidenav.tsx`, the key in `Shell.tsx`; a `LogsIcon` in `ui/icons.tsx`. The reporter is
  installed in `main.tsx`, on every page (the shell's and a diff's), never on a `?graph=` page,
  which has no server.

**The server's API** (absolute addresses, like `/api/history`: a diff's page posts its errors
too):

| Address | What |
|---|---|
| `GET /api/logs?day=&level=&process=&q=&before=` | `{ on, file, days, lines, older?, end }`: a day's lines newest first, 500 at a time; `older` reads on; `end` is where the stream starts |
| `GET /api/logs/stream?day=&from=` | server-sent `lines` as the day's file grows, read every second (V46's merge-log stream, the same way); refused from another site |
| `GET /api/logs/summary` | `{ errors, warnings, since }`: lines at those levels since the page was last opened |
| `POST /api/logs/seen` | the page was opened: kept in `<logs>/seen.json`, so a crash before a restart still counts |
| `POST /api/logs` | a page's error: `{ level, msg, err?, componentStack?, page }`, 32 KB at most, with the write header and from the same site; the server adds `process: 'viewer'` and writes 60 a minute at most |

## The Logs page

- **Header**: "Logs", the day (a select of the days kept, today first), the day's counts
  ("2 errors · 5 warnings"), and the file's path with a Copy button.
- **Filters**: the level as `.scopes` (All · Warnings and errors · Errors); the processes as
  chips (Server, Analysis, App, Pages, Commands); a `.search-input` over the message and the
  fields' values.
- **Lines**, newest first, new ones arriving at the top while today is shown: the time
  (`14:02:11.348`, mono), the level as `.badge-error`/`.badge-warning`/`.badge-info` (debug in
  muted text), the process, the message, then the main fields in muted mono
  (`GET /api/workspaces · 500 · 12 ms`). A line with an error shows its message in the row.
- **A line opened** (click or Enter): its stack and causes in mono, its other fields as
  name–value rows, and **Copy** (the line as JSON, ready to paste to an agent).
- **States**: empty ("Nothing at this level on this day"), logs off ("Logs are off:
  `SYMBIOTE_LOG=off`"), the server not answering.
- **The sidenav**: a Logs entry after Monitor, with a count of errors since the page was last
  opened (`.page-count`, as the workspaces that need you), read every 15 s from
  `/api/logs/summary`; it clears when the page opens.
- **A page that throws**: a boundary around the shell's main area shows "This page stopped:
  <message>" with Reload and a link to Logs, and logs the error. The sidenav keeps working, so
  Logs can be opened. A diff's page gets the same boundary around its canvas and panels.

Its look follows the `symbiote-style` skill (tokens, controls, no new colours).

## Verification

1. **Tests first** (red before):
   - `packages/log/test/`: the folder by environment and platform; the day's file and a line's
     fields; levels and `SYMBIOTE_LOG=off` (no folder made); an error's stack and causes;
     `readLogs` by level, process, text and page, with a torn line skipped; `pruneLogs` by age;
     a child process that throws and one that rejects at start: exit code 1 as without logging,
     and a `fatal` line with the stack in the file.
   - `packages/cli/test/logs.test.ts`: a route that throws gives `500` and an `error` line with
     method, path and stack; `POST /api/logs` writes a `viewer` line; refused without the
     header, from another site or over 32 KB; the cap; `GET /api/logs` filters and pages; the
     stream sends new lines; `summary` and `seen`; a posted body found in no line.
   - `packages/viewer/test/logs.test.ts`: the query, a line's text, the dedup and the cap.
   - `packages/viewer/e2e/logs.spec.ts`: the server's start line on `/logs`; a page error appears
     live with its stack; the filters; the sidenav's count after an error, cleared on opening;
     a page that throws shows the boundary and the sidenav still opens Logs. Every other spec
     keeps checking that there were no page errors.
2. **Nothing else changes**: `pnpm check` and every existing test; `symbiote diff` on ky and zod
   (`regression-check` repositories): graph JSON, stdout and stderr byte for byte as `main`'s;
   with `SYMBIOTE_LOG=off`, no folder. Tests never write into `~/.cache`: vitest runs with
   `SYMBIOTE_LOG=off` unless a test gives a folder; the e2e harness gives each server its own.
3. **Real use**: `symbiote view` here and the desktop app. Each kind of error once: an analysis
   child killed (`kill -9`), an error thrown in a page, the server killed under the app. Each must
   be on the Logs page with what is needed to find its cause.
4. **Viewer**: `pnpm test:e2e`; `viewer-check` screenshots of the Logs page at 1x in both themes,
   with every page checked for spacing (the shell changed); first paint of `/history` against
   `main`'s.
5. **Cost**: `symbiote view`'s start and a `symbiote diff` on zod against `main` (expected
   +~15 ms, the import); lines and bytes for a day of use at `info`.

**Risks**

| Risk | Mitigation |
|---|---|
| Several processes append to one file: a partial write could tear a line | each write is whole lines on a file opened to append; the reader skips a line it cannot parse, as the merge log's does |
| `debug` floods the file (the shell polls every 1.5–5 s) | `info` by default; requests only at `debug`; 14 days kept |
| A page's error in a loop floods the server | the reporter sends a repeated message once per 10 s, with how many times it came, and 30 lines a minute at most; the server takes 60 a minute |
| A secret in a line | fields named by convention, `redact`, the test on posted bodies |
| An error before the log opens (a failed import) | not recorded; it stays on stderr as today |
| The tests' lines in the person's folder | `SYMBIOTE_LOG=off` in vitest, a folder per e2e server |
| The new package and pino in the app's resolution | the app loads `@symbiote/log` from the workspace like any dependency; checked by a real app run |

**Order**: LG1a first (the files are useful alone: `lnav ~/.cache/symbiote/logs/*.jsonl`), then
LG1b. Each ends green and is committed and pushed.

## Milestones

| # | Milestone | Output |
|---|---|---|
| LG1a | The lines | `@symbiote/log`; the CLI, the server and the app write; uncaught errors recorded; the folder kept 14 days; README |
| LG1b | The Logs page | the pages' errors reported; `/api/logs…`; the Logs page; the sidenav's count; the page boundary |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 349 | Which library writes the lines? | **pino 10.4** | standard NDJSON other tools read; 10,000 lines in 20 ms off the event loop; stack and causes; a synchronous flush on a crash (spike) |
| 350 | Where are they read? | **a Logs page in Symbiote** | the same app, as asked; nothing else to run; the format leaves lnav, pino-pretty or Loki open |
| 351 | Where are the files? | **`<cache>/logs`, one file per local day, every process appending, 14 days kept** | no renames between processes (rotating by size would have several processes renaming one file); a day is how one looks for "what happened this morning" |
| 352 | How are uncaught errors caught? | **`uncaughtExceptionMonitor`, then a synchronous flush; the process ends as today** | recording must not change behaviour; continuing after an uncaught exception is unsafe (Node's docs) |
| 353 | How do the pages' errors reach the file? | **posted to `POST /api/logs`, deduplicated and capped; no logger in the bundle** | one writer per machine process; the bundle stays as it is |
| 354 | What does a page that throws show? | **a boundary in the shell's main area: the message, Reload, a link to Logs** | today the whole window goes blank, sidenav included, so Logs could not even be opened |
| 355 | Which levels? | **`info` by default, `SYMBIOTE_LOG_LEVEL`, `SYMBIOTE_LOG=off`; tests off** | requests every few seconds belong at `debug`; the person's folder holds only real use |
| 356 | Where does the code live? | **a package, `@symbiote/log`** | the CLI and the app both write and neither can import the other's code |
| 357 | What is never logged? | **bodies, prompts, briefs, terminal input and output, file contents, environment, tokens** | the folder is local, but a line is pasted to agents and into issues |

**Not in LG1 (later)**: the hooks and the Codex runner; a level switch in Settings; sending lines
anywhere off the machine; the agents' and the analyzed repository's logs; traces
(OpenTelemetry); a pass over the set-aside `catch` blocks.
