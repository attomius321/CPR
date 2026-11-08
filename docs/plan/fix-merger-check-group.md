# Fix — The merger's check runs in a process group: stopped at its timeout and with Symbiote

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding S2)

**Status:** planned (2026-11-06), to be built on branch `fix/merger-check-group` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/merger-check-group` · **Size** S · **Depends on** none · **Plan** P11
of 51 (the audit's order)

## The brief

**What happens**: the merger runs `merge.checks` with `runShell`, which spawns `sh -c` without a
process group of its own. At the 60-minute timeout, `child.kill()` signals only `sh`. A compound
check such as `pnpm check && pnpm build && pnpm test:e2e` keeps its children running: pnpm, vitest
and browsers. `close` waits for every holder of the pipe, so the entry can stay "checking". When
`symbiote view` stops, nothing ends a check either.

**How to reproduce**:
- Set `merge.checks` to `["sh -c 'sleep 600 & wait'"]`.
- Shorten `CHECK_TIMEOUT_MS` (a test seam), queue a merge and wait past the timeout.
- `pgrep -f 'sleep 600'` still finds it, and the entry is not failed.

**Where to look**:
- `packages/cli/src/programs.ts:101-132`: `CHECK_TIMEOUT_MS`, `runShell` (`spawn(command, { shell: true })`,
  `setTimeout(() => child.kill(), …)`).
- `programs.ts:135-175` (`GroupRun`, `runGroup`) and `:279` (`killGroup`): Hive's way since HV2,
  decision 654.
- `packages/cli/src/merges.ts:367` (`runCheck = runShell`), `:376` (the `RunCheck` seam), and
  `:670` (the check's run).
- How `symbiote view` ends: the server's close path, which stops Hive's group today
  (`hive-runner.ts`'s use of `killGroup`).

**Out of scope**: Hive's checks (already grouped); the check's commands; Windows process groups
(`killGroup` already handles `win32`).

**Done when**:
- The merger's check runs through `runGroup`.
- At its timeout the whole group gets SIGTERM, then SIGKILL after the grace, and the entry fails
  with "timed out after 60 min".
- Stopping `symbiote view` (SIGINT) ends a running check's group. Read what the entry says on the
  next start today, and keep that.
- No process of the check is left: `pgrep` finds none.

## Evidence

Code (finding S2): `programs.ts:104-132` spawns with `shell: true` and no `detached`, and the timer
calls `child.kill()`. `runGroup`'s doc comment (`:153-157`) states the problem it solved for Hive:
"Hive off or a resume after a killed `symbiote view` ends whole, its children (`pnpm`, `vitest`, a
browser) with it." The merger never moved to it.

## Approach

- Make `RunCheck` return what `runGroup` gives (`{ done, kill }`), or wrap `runGroup` in a
  `RunCheck`-shaped adapter, so `merges.ts`' seam stays.
- Keep the running group in the merge queue's state, and give the queue a `stop()` that kills it.
  Call it from `symbiote view`'s shutdown, next to where Hive's group is ended today. Find that
  place with `grep -n killGroup packages/cli/src/hive-runner.ts`.
- Keep `runShell` only where one-shot commands need it, or remove it if the merger was its last
  user. `grep -rn runShell packages/cli/src` decides.

## Tests first

- `packages/cli/test/programs.test.ts` (new):
  - a `RunCheck` built on `runGroup`, with a 200 ms timeout, given
    `sh -c 'sleep 30 & echo $! > pid; wait'`, ends with code `null`;
  - the pid in `pid` is no longer alive.
  With `runShell` today the grandchild lives on.
- `merges.test.ts`: a merge whose check outlives a short timeout ends `failed` with the timeout in
  its message, and closing the queue during a check leaves no child.

## Verification

- `pnpm check`, `pnpm build`.
- `pnpm test:e2e`: `merges.spec.ts`, `merge-send.spec.ts`.
- By hand, on a scratch repository with its own `SYMBIOTE_CACHE_DIR`: `merge.checks:
  ["sleep 600"]`, queue a merge, Ctrl+C `symbiote view`, and `pgrep -f 'sleep 600'` finds none.
