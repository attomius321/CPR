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
