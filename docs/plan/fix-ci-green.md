# Fix — CI green again: the review-place test's git identity, lint's heap on macOS

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding R1)

**Status:** built (2026-11-08), on branch `fix/ci-green` in its own workspace (from `main` at
a12c1d9); written by the improvement audit (`chore/improvement-audit`).

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
- **Not done here (decided, no one to ask mid-run)**: what CI shows past the old failures. Each
  fails only on a runner, in code this fix does not touch, and needs a fix verified where it
  fails (a Mac for four of them); guessing through CI pushes would not be a fix. Listed below.

## Results

| Measure | Before | After |
|---|---|---|
| `GIT_CONFIG_GLOBAL=/dev/null pnpm test` | 1 failed, 3,456 passed | 3,457 passed |
| NX1 test, `HOME` and `XDG_CONFIG_HOME` empty | fails (the cache place) | passes |
| `pnpm lint` with a 2,048 MB heap | aborts, exit 134 | (unchanged: CI gives it 4,096 MB) |
| `pnpm test:e2e`, global config hidden | 9 of the 12 CI failures run here fail | viewer 437 of 438 (below), nexus 32 of 32 |

ESLint's heap (`node --trace-gc node_modules/eslint/bin/eslint.js .`, this machine, 46 s): 3,180 MB
in use at its peak, 2,377 MB live after the last full collection; the process's maximum resident
size 3,398 MB (`/usr/bin/time -v pnpm lint`). The live set alone is over 2 GB, so no collector
tuning would have saved the macOS job. **The peak is 78 % of the new 4 GB limit**: a chore to
lint per package (or with `parserOptions.projectService` scoped per package) is proposed, not
done here, since it changes what `pnpm check` runs.

**CI on the branch** (runs 42489538024 and 42491731701 on GitHub):

| Job | Before (main) | Run 1 | Run 2 (e2e identity) |
|---|---|---|---|
| ubuntu · node 22 | unit test fails | **green** | **green** |
| ubuntu · node 24 | unit test fails | unit green; e2e 13 of 438 fail | unit green; e2e **2** of 438 fail |
| macOS · node 24 | lint out of heap | lint green; unit 9 fail | lint green; unit 6 fail |

Not green, and why, each for a fix of its own:

- **e2e, ubuntu · 24, both runs, pass locally**: `app.spec.ts:191` (the window is not `visible`
  on the runner's Xvfb) and `events.spec.ts:400` (V94c, the server restarted on its port: the
  2-minute test timeout).
- **e2e, any machine**: `workspaces.spec.ts:2293` (V67) failed 1 run in 6 on `main`'s e2e files,
  1 in 3 here: the merger is caught "Queued … main moved: fast-forwarding again" instead of
  "Cannot fast-forward". Passed in both CI runs.
- **unit, macOS, both runs** (hidden since 2026-10-13 behind lint's crash):
  `events.test.ts` ×3 (V94a/c: FSEvents names a watched folder itself, `activity/activity`, so a
  page gets extra `touched` paths and a second read); `terminal.test.ts` › loadPty (macOS's
  `/bin/sh` is bash: `running()` says `bash` at an idle prompt); `desktop/launcher.test.ts` ›
  startServer (`/var` against `/private/var`, a test's path); `hive-runner.test.ts`, 5 s
  timeouts on 4 tests in run 1 and a different 1 in run 2 (the 3-core runner, 479 s for the suite).
