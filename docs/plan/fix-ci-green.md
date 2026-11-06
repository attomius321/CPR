# Fix — CI green again: the review-place test's git identity, lint's heap on macOS

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding R1)

**Status:** planned (2026-11-06), to be built on branch `fix/ci-green` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

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
