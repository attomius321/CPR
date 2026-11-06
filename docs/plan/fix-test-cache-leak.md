# Fix — Tests analyze in a cache of their own; orphaned analysis slots are pruned

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding R3)

**Status:** planned (2026-11-06), to be built on branch `fix/test-cache-leak` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/test-cache-leak` · **Size** M (S for the leak, M for the pruning) ·
**Depends on** none · **Plan** P10 of 51 (the audit's order)

## The brief

**What happens**: every `pnpm check` leaves 2 analysis folders (`symbiote-test-*`) in the person's
real cache, `~/.cache/symbiote/worktrees`. Their repositories were temporary and are gone. Nothing
ever removes a slot. A repository's linked worktrees also each get a slot set of their own, though
they share one git object store.

**How to reproduce**: `ls ~/.cache/symbiote/worktrees | grep -c symbiote-test-`, run
`pnpm test`, count again: 2 more.

**Where to look**:
- `packages/core/test/plugins.test.ts:71,73`: two `analyzeGit` calls without `cacheDir`, so
  `defaultCacheDir()` is the person's. The other caller, `pipeline.test.ts`, passes one.
- `vitest.config.ts:24`: `env` sets only `SYMBIOTE_LOG: 'off'`.
- `packages/core/src/git/repo.ts:33-38`: `id` = `basename(root)` + hash of `commonDir`, so each
  worktree's basename makes a new slot set.
- `packages/core/src/git/worktree.ts:14-23` (`defaultCacheDir`) and the slot code below it (`tryLock`,
  `isStale`, `:105-125`).

**Out of scope**: the slot lock's race (P12); the analysis itself; Hive's and the merger's folders in
a slot set (`hive-review`, `merge`): keep them, but prune them by the same rule.

**Done when**:
1. `pnpm test` leaves `~/.cache/symbiote/worktrees` unchanged (count before = after).
2. Worktrees of one repository share one slot set: a second worktree analyzes in
   `<repo>-<hash>`, not `<worktree-folder>-<hash>`.
3. A slot set whose repository is gone (each slot's `.git` points at a missing `gitdir`), and that
   nobody has locked or touched for 1 hour, is removed. This runs at `symbiote view`'s start (in the
   background) and with `symbiote cache prune`, which prints what it removed. Its git worktree
   entries are pruned too.

## Evidence

Measured on the person's machine (2026-11-06):
- `~/.cache/symbiote/worktrees` held 649 folders and 3.5 GB. 631 of them were `symbiote-test-*`
  (42 MB), dated every day since 2026-10-21. The audit's own `pnpm check` added 2; a vitest run with
  `SYMBIOTE_CACHE_DIR` set added 0.
- The person asked to clean them. 630 orphans were removed on 2026-11-06, and 1 was kept because it
  was written that hour.
- One repository, five slot sets with the same hash: `Symbiote-e8cf43a060b0` (685 MB),
  `feature-hive-mode-setting-…` (73 MB), `feature-ui-improvements-…`,
  `feature-ui-improvements-v2-…` and `refactor-codebase-refactoring-readability-…` (20–27 MB each).
- The main checkout's `git worktree list` holds 17 cache checkouts.

## Approach

- **The leak**:
  - `vitest.config.ts`: `env.SYMBIOTE_CACHE_DIR` set to a folder in `os.tmpdir()` made once per run
    (`globalSetup` creates it and removes it at the end).
  - `plugins.test.ts`: pass the `cacheDir` its sibling tests pass.
- **The slot's name**: `repo.ts` takes the name from the main worktree, the folder of
  `commonDir`'s parent for a normal repository. Keep the hash of `commonDir`. A cache made before
  the change keeps working: old sets are orphans of nothing and get pruned once unused (1 hour).
- **Pruning**: `pruneSlots(cacheDir)` in `worktree.ts`. For each set, if every slot's gitdir is
  missing and no lock is held or newer than 1 hour, remove the set (`rm -rf` of the set's folder
  only, after checking it is under `<cache>/worktrees/`). Then `git worktree prune` in the
  repository when it still exists. It is called by `symbiote view` at start, not awaited, and by a
  new `symbiote cache prune`.

## Tests first

- `packages/core/test/worktree.test.ts`:
  - two worktrees of one repository get one `id` (fails today: two ids);
  - `pruneSlots` removes a set whose gitdir is gone, keeps one whose repository exists, and keeps
    one locked by a live pid (all fail today: no function).
- A vitest `globalTeardown` check, or a test, that the person's `~/.cache/symbiote/worktrees`
  count is unchanged. Measure it once by hand, as in "How to reproduce".

## Verification

- `pnpm check` twice: the count is unchanged.
- `regression-check` r1 against `main`: identical graphs (the slot's name does not enter the graph).
- `node packages/cli/dist/bin.js cache prune` on a copy of a cache with orphans: lists and removes
  them, keeps the rest.
- Docs: `docs/reference/commands.md` (the new command), `configuration.md` (what the cache holds).
