# Journal: Fix — CI green again: the review-place test's git identity, lint's heap on macOS

[Index](../JOURNAL.md)

## Fix — CI green again (2026-11-08, branch `fix/ci-green`)

The improvement audit's P01 (finding R1). CI on `main` had failed on every push since
2026-10-13, in all three jobs. Plan, approach and results in
[its plan](../plan/fix-ci-green.md).

**Learned**:

- **The suite depended on the machine.** The CLI under test reads `git config user.email` with
  the test process's environment. `createRepo` set `GIT_AUTHOR_EMAIL` for its own git calls only,
  so the test repository had no identity, and the answer came from `~/.gitconfig`. A runner has
  none: `reviewPlace` chose the cache, and the NX1 test failed there and passed here. Hiding the
  developer's global and system config from every test (`vitest.config.ts`) makes a local run see
  git as CI does; the helper then gives each repository an identity of its own.
- **Only one test relied on the developer's identity** (the NX1 test), and only one on its
  absence (`userEmail` → null, which already hid the global config itself and now unsets the
  helper's email).
- **Typed ESLint holds every package's program at once.** `eslint .` peaks at 3,180 MB of heap
  in use, 2,377 MB live after its last full collection (3,398 MB resident). A 2,048 MB limit
  aborts it (exit 134), as on the macOS runner, whose default is ~2 GB; Ubuntu's and this
  machine's default is ~4 GB (4,192 MB). The CI step now gets 4,096 MB: **78 % used at the peak**.
  Proposed: a chore to lint per package before the code grows into that limit.
- **The e2e harness had the same hole.** Its agent-branch and workspaces repositories set
  `user.email` but no `user.name`; the specs' own `git commit`/`git merge` took the name from
  `~/.gitconfig`. On the runner, 9 of 13 e2e failures were "empty ident name". The Playwright
  configs now hide the global config too, and the harness names the reviewer.
- **Four weeks of red hid more.** Lint's crash stopped the macOS job before its tests, and the
  unit failure stopped Ubuntu's before e2e. Past them: 5 macOS unit tests fail in both runs
  (events ×3, terminal, launcher), hive-runner tests time out at 5 s there, and 2 e2e specs fail
  only on the runner (app.spec:191, events.spec:400). `workspaces.spec.ts:2293` is a race of its
  own, 1 in 6 on `main`. Each is listed with its cause in the plan's results, for a fix of its
  own: none is in code this fix touches, and four need a Mac to verify.

**Verification**: `GIT_CONFIG_GLOBAL=/dev/null pnpm test` 3,457 passed (before: 1 failed); the NX1
test passes with `HOME` and `XDG_CONFIG_HOME` empty; `pnpm check` and `pnpm build` pass;
`pnpm lint` passes with a 4,096 MB heap and aborts with 2,048 MB; `pnpm test:e2e` 437 of 438 in
the viewer (the V67 race) and 32 of 32 in the nexus. CI: ubuntu · node 22 green; ubuntu · node 24
green but for 2 e2e specs; macOS past lint, 6 unit failures (run 42491731701).

## Fix — CI green: `symbiote view` ends on Ctrl+C; the e2e specs wait for what they read (2026-11-08, branch `fix/ci-green`)

The person's word after the first entry: "remove the macOS tests, and fix e2e tests". Then `main`
merged in (Hermes removed, decision 954) and CI again. Run 42510596203 is green on all three
jobs, the first green run since 2026-10-13. What was built, run by run:
[the plan's As built and results](../plan/fix-ci-green.md#as-built).

**Learned**:

- **`events.spec.ts:400` was a real bug.** `symbiote view` could fail to end on Ctrl+C with a
  page open. A connection busy when `close()` started stayed open after its answer; the page's
  stream asked again on it every second, each answer a 200 event-stream head with
  `Connection: keep-alive` and its end, so `server.close()` never returned. Found with probes in
  the server, about 1 hang in 10 runs on one core. Logging to a file in the request path hid it
  (0 in 30): the probe that found it kept its lines in memory and wrote them only once a close
  had waited a second. A first fix, `Connection: close` on each answer, did not hold: the
  stream's own head set `keep-alive` over it. Now a closing server answers 503 with
  `Connection: close` and closes a connection once its last answer is sent. 40 of 40 runs after.
- **Each CI run failed different e2e specs**: 13, 2, 2, 1, 2, then none. Past the git identity,
  every one was a spec reading what a fake or the server writes a moment later: a window shown at
  first paint, a record written after the agent starts, a report sent before the agent's prompt
  (which ends no turn), two cards in different groups. A runner is slower than this machine, so
  the order these specs assumed broke there first.
- **V94 leaves some changes to the 60 s safety read**: a file written in a worktree, and Hermes's
  writes (now gone). Specs that saw them at once did so only through a read already under way;
  `changes.spec.ts` now reloads the page after its write.
- **macOS's unit tests are off in CI, not fixed**: 6 fail only there (the plan lists them, with a
  cause each). Two are product differences (FSEvents naming a watched folder, `/bin/sh` being
  bash), worth their own fix on a Mac.

**Verification**: `pnpm check` (3,416 tests after `main` merged in) and `pnpm build` pass;
`pnpm test:e2e` 436 of 436 and 32 of 32 here; `server.test.ts`'s new test fails on the old
`close()` and passes on the new one; CI runs 42510596203 and 42514039113 green on ubuntu · node
22, ubuntu · node 24 (e2e included) and macOS · node 24. Between them, run 7 timed out one slow
unit test on node 22 (`merges.test.ts`, 1.6 s here): it has 20 s now.

## Fix — the rest: macOS's unit tests, and what each CI run still showed (2026-11-08, branch `fix/ci-green`)

At the person's "fix the rest": macOS's six, `events.spec.ts:348`, and V67. CI run 42524539542 is
green on all three jobs with the unit tests running on macOS again. The causes, one by one:
[the plan's results](../plan/fix-ci-green.md#results).

**Learned**:

- **Two of macOS's six were the product's.** `/bin/sh` there runs bash, so a shell's tab said it
  ran bash; and FSEvents replays changes made just before a watch and names a watched folder by
  its own name, so pages read twice and got folders as `touched` paths. The rest were the tests'
  own (a `/var` path, a burst slower than its window, git-heavy tests over 5 s on a runner that
  took 403–479 s for the suite).
- **The replay rule needed two tries on the runner.** First it dropped a file in a folder made
  after the watch began (the folder's own watch started after the write: that folder had no first
  read, so every change in it is news). Then its own test's file, written in the same millisecond
  as the watch started, counted as newer: `Date.now()` drops the fraction macOS's file dates keep.
  It is macOS's only: Linux dates files by a coarse clock and would drop a write made just after.
- **One more of the e2e failures was a real bug**: a review summary typed before the saved draft
  arrived was replaced by it. Found because the runner's server answered late enough.
- **V67 did not fail again**: 0 in 62 runs since the server fix (alone, one core, two cores with
  two busy loops), and none on CI. With no failure to read, it is left as it is.

**Verification**: new unit tests failed first (the terminal's own name, the replay rule twice, the
draft's merge); `pnpm check` 3,422 passed (once a bubblewrap test timed out at load 13 here, 30 ms
alone, then all passed); `pnpm test:e2e` 436 and 32; CI run 42524539542 green on ubuntu · node 22,
ubuntu · node 24 and macOS · node 24. Not run: the `viewer-check` skill (the viewer change is the
draft's loading only, no layout or paint).

Then the merge check of e8d595b failed `reviews.spec.ts:208`, and this branch caused it (3 in 5
under load with `withEarlyEdits`, 0 in 20 without): a comment saved before the saved draft's answer
came back twice, and a summary's save pending at Finish landed after it, over the cleared drafts.
`withEarlyEdits` takes a comment once by its id, and Finish cancels a pending draft save. 0 in 15
after, under the same load.

Merged into main (2026-11-09).
