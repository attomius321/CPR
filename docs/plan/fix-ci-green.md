# Fix — CI green again: the review-place test's git identity, lint's heap on macOS

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding R1)

**Status:** built (2026-11-08), on branch `fix/ci-green` in its own workspace (from `main` at
a12c1d9, `main` merged in at a95ccad); CI green on all three jobs (runs 42510596203 and 42514039113; run 42524539542 with macOS's unit
tests). Written by the
improvement audit (`chore/improvement-audit`).

**Kind** fix · **Branch** `fix/ci-green` · **Size** S · **Depends on** none · **Plan** P01 of 51 (the audit's order)

## The brief

**What happens**: CI on `main` has failed on every push since 2026-10-13, in all three jobs.
Ubuntu (Node 22 and 24) fails one unit test; macOS runs out of heap in `eslint .`. Nothing outside
this machine checks `main` any more.

**How to reproduce**:
- The test: `HOME=$(mktemp -d) npx vitest run packages/cli/test/main.test.ts -t "a record of its own server"`
  (no global git config, as on a CI runner).
- The heap: `NODE_OPTIONS=--max-old-space-size=2048 pnpm lint`; the macOS job's limit is ~2 GB.

**Where to look**:
- `packages/cli/test/main.test.ts:263-286`, the NX1 test that expects
  `symbiote: join(repo.root, 'symbiote')`.
- `packages/core/test/helpers/git-repo.ts:7-15`: the helper sets `GIT_AUTHOR_EMAIL` for its own
  git calls, but writes no `user.email` into the repository.
- `packages/core/src/git/branches.ts:227` (`userEmail`, run by the CLI with the test process's
  environment).
- `packages/cli/src/reviews.ts:135-148` (`reviewPlace`: no email, so the cache).
- `.github/workflows/ci.yml:34-37`; `package.json:12` (`"lint": "eslint ."`).

**Out of scope**: what `reviewPlace` does without an email (the cache, decided in V15); the other
CI steps; the Action (P03).

**Done when**:
- The CI run of the branch is green on all three jobs.
- The test passes with `HOME` and `XDG_CONFIG_HOME` pointed at empty folders.

## Evidence

Reproduced, from `gh run view` of the run of c2aa5c4 (2026-11-06):

```
FAIL packages/cli/test/main.test.ts > symbiote diff > says it runs while it runs, for Symbiote nexus: a record of its own server (NX1)
-   "symbiote": "/tmp/symbiote-test-RISjEd/symbiote",
+   "symbiote": "/tmp/symbiote-test-L1sKhB/state/symbiote-test-RISjEd-04e66f954606",
```

macOS · node 24: `eslint .` → "FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap
out of memory" after ~2,025 MB (exit 134).

`gh run list --branch main --status success --limit 1` gives 2026-10-13. Locally the test passes,
because the person's global git config has `user.email`. The test depends on the machine.

## Approach

- **The test**: give the test repository an identity of its own, with
  `repo.git('config', 'user.email', 'test@example.com')` in that `describe`'s setup. Better, do it
  in `createRepo` (`git-repo.ts`), so no test reads the developer's global config. Check which
  tests then change: any that expected the cache place should say so explicitly.
- **Lint**: give the step room, e.g. `NODE_OPTIONS=--max-old-space-size=4096` on the lint step in
  `ci.yml`. If the person prefers it in `package.json`, put it there (it then holds locally too).
  Measure the peak first: `/usr/bin/time -v pnpm lint` (Linux) for the maximum resident size.
- Do not split ESLint per package here: that changes what `pnpm check` runs.

## Tests first

- With `HOME` set to an empty folder (or `GIT_CONFIG_GLOBAL=/dev/null` in the test's environment),
  `main.test.ts` › "a record of its own server" fails today with the diff above. After the change it
  passes.
- If the helper changes, `pnpm test` shows any test that relied on the developer's identity; fix
  each by naming the identity it needs.

## Verification

1. `GIT_CONFIG_GLOBAL=/dev/null pnpm test`: passes. Locally that is how the CI runner is seen.
2. `pnpm check` and `pnpm build`.
3. Push the branch, then check `gh run list --branch fix/ci-green`: three green jobs, including
   the e2e step on ubuntu · node 24.
4. Record the lint peak (MB) in the journal.

| Risk | Mitigation |
|---|---|
| The e2e step on ubuntu · 24 then fails for its own reasons (never reached since 10-13) | Read its log. A spec that fails only in CI goes into its own fix; here, only report it |
| A 4 GB heap only postpones the problem | Record the peak; if it is near 4 GB, open a chore to lint per package |


## As built

- **The test, as planned**: `createRepo` writes `user.name` and `user.email` (`test@example.com`)
  into every test repository. The CLI under test runs git with the test process's environment,
  not the helper's, so only the repository's own config reaches it.
- **Added: no test reads the developer's git config.** `vitest.config.ts` sets
  `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` for every test, beside
  `SYMBIOTE_LOG: 'off'`; both `playwright.config.ts` files (viewer, nexus) set them for the e2e
  run. The NX1 test failed only on CI because a local run read `~/.gitconfig`; a helper fix alone
  would leave the next such test to pass here and fail there. With the vitest line alone, the NX1
  test fails locally with CI's diff (the failing test first).
- **One unit test named the identity it needs**: `branches.test.ts` › `userEmail` › "is the
  repository's user.email, or null" expected none; it now unsets the helper's. The tests that
  want the cache place (`reviews.test.ts`) already unset `user.email` themselves.
- **Added: the e2e harness's identity.** The first CI run reached the e2e step for the first time
  since 2026-10-13: 9 of its 13 failures were the same cause, `git commit`/`git merge` refused with
  "empty ident name (for <reviewer@example.com>)". `e2e/symbiote.ts` set `user.email` but no
  `user.name` in the agent-branch and workspaces repositories; it now names the reviewer
  ("Reviewer"). Reproduced locally first: the 9 failed with the global config hidden.
- **Lint in `ci.yml`, not `package.json`**: `NODE_OPTIONS=--max-old-space-size=4096` on the lint
  step. A developer's machine with 16 GB or more already gets a ~4 GB default (4,192 MB here),
  as Ubuntu's runners do; only the macOS runner (~2 GB) was short.
- **Added, at the person's word after the first report** ("remove the macOS tests, and fix e2e
  tests"):
  - `ci.yml` stopped running `pnpm run test` on macOS for runs 3 to 8; at "fix the rest" it runs
    there again, the six fixed (below, "macOS's unit tests").
  - **`symbiote view` ends on Ctrl+C with a page open** (`server.ts`, the cause of
    `events.spec.ts:400`). The harness's restart waited for the old server's exit, which never
    came. Probes in the server (it hung about 1 run in 10 here, pinned to one core) showed why: a
    connection busy when `close()` started (`/api/workspaces/day`) stayed open after its answer,
    and the page's stream asked again on it every second. Each ask got a 200 event-stream head
    with `Connection: keep-alive`, then its end, so Node kept the connection and `server.close()`
    never returned. Once `close()` starts, every request now gets 503 with `Connection: close`,
    and a connection is closed once its last answer is sent. The page treats a refused stream as
    lost and opens it again (`shell/events.ts`). A first try, `Connection: close` on each answer,
    was not enough: the stream's own head set `keep-alive` over it.
  - Specs that read what a fake writes a moment later now wait for it: `app.spec.ts:191` (the
    window is shown at Chromium's first paint, after the page is laid out), `nucleus.spec.ts:437`
    (the record is written after the agent starts), `codex.spec.ts:165` (the second run's call),
    `targets.spec.ts:38`, `page-frame.spec.ts`, `merge-send.spec.ts` and four tests of
    `workspaces.spec.ts` (a `prompted` helper; `approvedWorkspace` too): the report sent before
    the agent had its prompt ends no turn, so they wait for "Thinking", as `events.spec.ts` does.
    `look.spec.ts:458` waits for both cards to work, in one group, before it measures them.
  - Changes V94 left to the 60 s safety read: a file written in a worktree is no trigger, so
    `changes.spec.ts:139` reloads the page after its write, as a person does to see it at once.
  - `main` merged in (Hermes removed, decision 954): `hermes.spec.ts:29`, which failed in run 4
    for the same reason (the fake Hermes's writes trigger no read), went with it.

## Results

| Measure | Before | After |
|---|---|---|
| `GIT_CONFIG_GLOBAL=/dev/null pnpm test` | 1 failed, 3,456 passed | 3,457 passed |
| NX1 test, `HOME` and `XDG_CONFIG_HOME` empty | fails (the cache place) | passes |
| `pnpm lint` with a 2,048 MB heap | aborts, exit 134 | (unchanged: CI gives it 4,096 MB) |
| `pnpm test:e2e`, global config hidden | 9 of the 12 CI failures run here fail | viewer 436 of 436 after `main` merged in, nexus 32 of 32 |

ESLint's heap (`node --trace-gc node_modules/eslint/bin/eslint.js .`, this machine, 46 s): 3,180 MB
in use at its peak, 2,377 MB live after the last full collection; the process's maximum resident
size 3,398 MB (`/usr/bin/time -v pnpm lint`). The live set alone is over 2 GB, so no collector
tuning would have saved the macOS job. **The peak is 78 % of the new 4 GB limit**: a chore to
lint per package (or with `parserOptions.projectService` scoped per package) is proposed, not
done here, since it changes what `pnpm check` runs.

**CI on the branch** (GitHub Actions, runs 42489538024, 42491731701, 42503660837, 42505180039, 42508490356,
42510596203):

| Job | `main` | Run 1 | Run 2 (e2e identity) | Run 3 (server, macOS) | Run 4 (specs) | Run 5 (`main` in) | Run 6 |
|---|---|---|---|---|---|---|---|
| ubuntu · node 22 | unit test fails | green | green | green | green | green | **green** |
| ubuntu · node 24 | unit test fails | e2e 13 of 438 fail | e2e 2 fail | e2e 2 fail | e2e 1 fail | e2e 2 fail | **green** |
| macOS · node 24 | lint out of heap | unit 9 fail | unit 6 fail | green (no unit tests) | green | green | **green** |

Each run's e2e failures were different specs, all CI-only: run 1 `codex.spec.ts:165` and
`nucleus.spec.ts:437` among the identity failures; run 2 `app.spec.ts:191` and
`events.spec.ts:400`; run 3 `nucleus.spec.ts:437` and `targets.spec.ts:38`; run 4
`hermes.spec.ts:29` (gone with Hermes); run 5 `changes.spec.ts:139` and `workspaces.spec.ts:931`.
Each is fixed above. Run 6 (42510596203, 2026-11-08) is green on all three jobs: the first green
run since 2026-10-13. Run 7 (docs and `look.spec.ts` only) failed ubuntu · node 22 on one unit
test, `merges.test.ts` › "keeps the earlier runs when a merge runs again", at the 5 s timeout (1.6 s
here, the file's slowest): it now has 20 s, as the slow `hive-runner.test.ts` tests do. Run 8
(42514039113) is green on all three jobs.

`events.spec.ts:400` on one core, the spec alone: hung at runs 3, 14, 13 and 13 of four hunts
before; 40 of 40 passed after. `server.test.ts`'s new test (a request busy at close on a kept-alive
connection, then the client asking every 50 ms): `close()` never resolved before, now it does.

**macOS's unit tests**, at the person's "fix the rest" (runs 9 to 11, 42516848276, 42518402411,
42520033628). They failed in both runs that reached them, hidden since 2026-10-13 behind lint's
crash. Each by its cause:

- `terminal.test.ts` › loadPty: macOS's `/bin/sh` runs bash, so at its prompt the system names the
  foreground program `bash`, and `running()` said a shell's tab ran bash (a workspace's shells
  would have shown it). The started program's name as the system gives it at its first output is
  now the terminal's own too (`terminal.ts`, a new test with the fake pty).
- `events.test.ts` ×2 (`touched` paths, a second read of Claude Code's list): macOS's FSEvents
  also delivers changes made just before a watch, and names a watched folder by its own name
  (`activity/activity`). Where the system replays (`replays`, macOS), a change to a file last
  written before the watch of a folder watched from the start is not reported, and a folder's own
  name is the folder (`events-watch.ts`). Not on Linux: it dates files by a coarse clock, a tick
  behind, and would drop a write made just after. Not for a folder made later either, which no
  first read covered: run 10 showed it, a file in a new folder dropped as older than that folder's
  watch. Two new tests, each dating a file back with `utimes`.
- `events.test.ts` "at most once in `between`": the burst of 20 triggers 5 ms apart took over
  200 ms on the runner; `between` is 1 s in that test.
- `desktop/launcher.test.ts`: the test's folder as a real path (`/var` is `/private/var`).
- `hive-runner.test.ts`, a different few each run at 5 s: `vitest.config.ts` gives each test 20 s
  on macOS (the suite 403–479 s there, Ubuntu's 248 s), 5 s elsewhere.

Runs 11 to 13 (42520033628, 42521645869, 42524539542): macOS green with its unit tests from run 11
on. The e2e step on ubuntu · node 24 failed once more each run, a spec of its own each time, each
fixed: `terminal-view.spec.ts:165` (the split's resize redrew the fake's prompt between two typed
keys: the spec sends the line and reads the fake's `got: left`; its Focus test the same), then
`look.spec.ts:458` (rows measured mid-move: the gap is polled) and `workspaces.spec.ts:937`.
That last was the product's: **a summary typed before the saved review draft arrived was lost**,
`useReview` replacing the draft with the saved one; `withEarlyEdits` (`comments.ts`) keeps what
was typed then, with the saved comments, and saves the merge (unit tests first). **Run 13 is
green on all three jobs, macOS's unit tests included.**

**Symbiote's merge check of e8d595b** then failed `reviews.spec.ts:208`: after Finish, the review's
file still held the comment as a draft. Under load here it failed 3 runs in 5 with `withEarlyEdits`
and 0 in 20 without, so this branch caused it. Two fixes: `withEarlyEdits` takes a comment the
saved draft already has once, by its id (a comment saved before the load was answered came back
twice); and Finish drops a draft save still pending (`Store.cancel`, `onSending`). The trace
showed the summary's save, 300 ms after its typing, sent after Finish's request and landing over
the drafts Finish cleared. After both: 0 in 15 under the same load; `pnpm test:e2e` 436 and 32.

Also fixed at "fix the rest": `events.spec.ts:348` (V94c) read the server's log once, as soon as
the card said Landed, before the "merge landed" line was on disk; it now waits for both lines,
and the harness removes a server's cache with retries (ENOTEMPTY while it wrote its last lines).

Not fixed here: `workspaces.spec.ts:2303` (V67, 2293 before `main` came in) failed 1 run in 6 on
`main`'s e2e files and 3 in about 10 here before the server fix, while another job's e2e loaded
the machine; 0 in 62 after (alone, on one core, and on two cores shared with two busy loops), and
it passed in every CI run. The merger's code shows no path that leaves the entry queued; without a
failure to read, no change is made.
