# @symbiote/log

Symbiote's logs (LG1, `docs/plan/lg1-logs.md`): every Symbiote process writes its lines into one
local folder, which another app reads (`ops/logs/`: Alloy, Loki, Grafana). The folder is the only
contract: Symbiote never talks to that app. Node only; depends on `pino` and nothing else, so both
the CLI and the desktop app (which reads no `@symbiote/core`) use it.

## The files

- `logsDir`: `SYMBIOTE_LOG_DIR`, else `<cache>/logs` by core's `defaultCacheDir` rules (a CLI test
  keeps the two equal). One file per local day, `<YYYY-MM-DD>.jsonl`, appended by every process;
  never renamed or truncated, so a follower never loses its place. `pruneLogs` keeps 14 days.
- A line is pino's, with the time as ISO text and the level as a word:
  `{"level":"error","time":"…Z","pid":…,"process":"view",…,"msg":"…","err":{type,message,stack}}`.
  Changing that shape changes what `ops/logs/config.alloy` and the dashboard read.
- `openLog` writes each line synchronously in one `write` (2.6–3.1 µs a line): on disk when the
  call returns, whole however many processes append. Logging never stops a program: `off`, a
  folder that cannot be made or a failed write writes nothing.
- `watchUncaught` only watches (`uncaughtExceptionMonitor`): the process ends as without it. In
  an ES module, an error thrown at the top level arrives as `unhandledRejection`.

## Rules

- Never log request bodies, prompts, briefs, terminal input or output, file contents, the
  environment or tokens (decision 356); `REDACT` is a guard, not the rule.
- Tests: the root vitest config sets `SYMBIOTE_LOG=off`; a test that logs gives its own folder.
  `test/crash.test.ts` runs the sources in a child with Node's type stripping (`test/ts-hooks.mjs`).
