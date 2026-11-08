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
