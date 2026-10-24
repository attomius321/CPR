# Journal: Fix — usage keeps Symbiote's own last read, reads every 5 min; a program's output read to its end

[Index](../JOURNAL.md)

## Fix — usage keeps Symbiote's own last read, reads every 5 min; a program's output read to its end (2026-10-21, branch `fix/usage-keeps-live-numbers`)

Asked: "sometimes, the claude hourly session disappears, and the chatgpt hourly session does not
exist"; then "Make the query for usage every 5 minutes instead of one" and "No claude copy
code...show the last monitored value from the real usage".

**Learned**:
- **Claude's usage endpoint refuses reads close together.** Two `symbiote view`s of this repository,
  each reading every minute while asked: 4 reads in 90 s answered 200 (06:41:53 and 06:43:23,
  both servers in the same second each time), the next pair 429, and the 5-minute back-off began
  again. No `retry-after` was read. Its limit is not documented and was not measured further.
- **Through a 429, the bar showed Claude Code's copy**, from 20:16 the day before (the last time
  its `/usage` was opened): its 5-hour window had reset, so only `wk 22%` was left, while the live
  numbers were 30–35 % and 18 %. 34 of 46 answers in 12 minutes, logged from both servers, were
  that copy. `usageService` meant to keep the last numbers on a 429
  (`read.subscription ?? (read.backoff ? last : null)`), but the reader always gave the copy.
- **Codex has no 5-hour window on the Go plan.** `account/rateLimits/read` answers one window,
  43,200 min at 0 %, `secondary: null`, in `rateLimits` and `rateLimitsByLimitId` alike; its
  sessions carry the same. An unstarted window's `resetsAt` moves with each read (now + 30 days).
- **At 5 minutes the 429 back-off (5 minutes) delays nothing**: the next read is due then anyway.
  It is kept for a shorter interval; its test gives one of 60 s.
- **The usage spec's Codex first read, open since V29c, was Symbiote losing a program's output.** Codex
  was missing from the first answer in 3 of 7 full e2e runs on this branch. A spec that only
  loads the page and reads that answer found it in 2 of 8 runs at 8 workers. Logged with a file
  write per step it never failed (0 of 48 runs); logged in memory, it did (2 of 128):
  `codex app-server daemon start` had exited 0 with 0 of its 252 bytes, so no socket, no app
  server, and the sessions' fallback found none in the test's `CODEX_HOME`. `runProgram` answered
  at the exit plus one tick ("let the last chunks already written arrive"); under load the output
  came later. Real use had the same window: Codex hidden until its daemon is looked for again a
  minute later, and at 5-minute reads until the next read.
- **A service a program starts can hold its output**, as `runProgram`'s comment said: it now
  answers when the output closes, or 1 s after the exit while it is held. Symbiote's end stays open:
  closed, the service's next write would end it (`SIGPIPE`).

**Changed**: Claude Code's copy is no longer read. Each live read is kept in Symbiote's cache
(`usage/claude.json`, shared by every `symbiote view` on the machine; written to a temporary file and
renamed into place), with the account's `accountUuid`; a failed read gives that last read for the
same account, without the windows reset since, and why. In memory, a failed read, or a copy older
than the numbers kept (Codex's sessions), keeps the last numbers. The hover says "Read 12 minutes
ago, not since: Claude's usage asked to wait (429)" and the bar shows the age. The vendors are read
at most every 5 minutes (decision 175); the page still asks `symbiote view` every minute.

**Verification**: unit tests red before: the day-old copy over live numbers (the copy's `wk 22`
in place of `5h 30 · wk 18`), the 5-min interval (red with 60 s), the hover and the bar's age,
Claude Code's copy shown on a 429 and on an expired token, nothing kept in the cache, another
account's read; `runProgram`'s output written after the exit (red: `early` without ` late`),
and a child holding the output 5 s (answered within 3 s). An e2e test red on the previous build:
a `symbiote view` started while the endpoint answers 429 shows the last read an earlier run kept,
with its age and why (the build showed no Claude). The first-answer spec, 128 runs at 8 workers
each way: the old `runProgram` 4 without Codex, the new 0. Real `codex` runs, 10 each: the same
medians as at the exit (daemon start 46 ms, `login status` 42 ms), with all their output.
`pnpm check` 1,054 tests, build, e2e 158 of 158 in two runs after a forced rebuild.

Real use, a fresh `symbiote view` asked every 30 s like a page: on the 5-min build, for 21 min, its
first read 429 (just after the two 60-s servers'), then 3 of 3 live (5h 40, 44, 47 %); on the
final build, for 11 min, 07:09:26 live and 07:14:26 429, through which the bar kept
`5h 47% · wk 20%` with its age and the 429's note. `~/.cache/symbiote/usage/claude.json`: 301 bytes,
the account's id and the subscription, no token.

Not verified: `claude --bg` (it starts a real session), which may now answer up to 1 s after it
exits if its background process holds the output; the servers already running keep the old code
until restarted.

Merged into main (2026-10-21), after N1, no conflicts. `main` verified after the merge: frozen
install, 1,054 unit tests, format, lint, typecheck, build, 158 of 158 e2e.
