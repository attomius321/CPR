---
name: regression-check
description: Runs Symbiote on pinned commits of real repositories (ky, zod, vite, the Angular 11 RealWorld app, Bitwarden, Qwik) and compares a branch's edges, findings and run time with main's. Use after any change to analysis code — packages/core extraction, references, detectors, the TypeScript adapter, or a framework plugin — before reporting it done or asking to merge, and to measure what a plugin changes on real commits.
---

# Regression check

Fixtures prove what you thought of; these comparisons catch what you did not (a JSDoc
`{@link}` crash, a union printed in another order, a project boundary in the wrong folder).

## Sets (`scripts/regression/sets.json`)

| Set | Comparisons | Plugins | Use for |
|---|---|---|---|
| `r1` | 29: ky, zod, vite ×6, RealWorld Angular 11 ×8, 3 experiments | none | every analysis change |
| `bitwarden` | 10 template-touching commits | angular | references, Angular plugin, anything big-repo |
| `bitwarden-projects` | 8 commits spanning 3+ projects | angular | multi-project work (W1, V7) |
| `qwik-docs` | 30 commits of Qwik's monorepo | qwik | Qwik plugin, TSX/props logic |

One run (4 cores): `r1` ≈ 3 min, `bitwarden` ≈ 7 min, `qwik-docs` ≈ 6 min; a comparison needs
two. Run them in the background and keep working.

## Workflow

Copy and track:

```
- [ ] 1. Clone the sets' repos (once per machine)
- [ ] 2. Build a baseline worktree of main
- [ ] 3. Build this checkout
- [ ] 4. Run each set on both, compare
- [ ] 5. Explain every difference; fix and repeat until each one is intended
- [ ] 6. Record the result (journal entry, commit message)
- [ ] 7. Remove the baseline worktree
```

**1. Clone** into `$SYMBIOTE_REGRESSION_DIR` (default `~/.cache/symbiote-regression`). Blobless clones;
the RealWorld experiment branches are recreated from `scripts/regression/patches/`:

```sh
node scripts/regression/setup.mjs r1 bitwarden qwik-docs   # or: all
```

**2. Baseline** — a detached worktree, so `main` stays free to check out:

```sh
git fetch origin main
git worktree add --detach /tmp/symbiote-base origin/main
(cd /tmp/symbiote-base && pnpm install --frozen-lockfile --offline && pnpm build)
```

Compare against the branch's merge-base instead of `main` when `main` has moved on with
analysis changes of its own.

**3–4. Run and compare**:

```sh
pnpm build
node scripts/regression/run.mjs --set r1 --symbiote /tmp/symbiote-base --out /tmp/r1-base.json
node scripts/regression/run.mjs --set r1 --out /tmp/r1-head.json
node scripts/regression/compare.mjs /tmp/r1-base.json /tmp/r1-head.json
```

To measure a plugin's effect instead (same build, plugin off then on):

```sh
node scripts/regression/run.mjs --set qwik-docs --no-plugins --out /tmp/q-off.json
node scripts/regression/run.mjs --set qwik-docs --out /tmp/q-on.json
node scripts/regression/compare.mjs /tmp/q-off.json /tmp/q-on.json
```

**5. Read the output.** `compare.mjs` prints only comparisons that differ (edges `-`/`+`,
findings `-`/`+`, errors), then totals and the time ratio after/before.

- No plugin involved and nothing meant to change: expect `identical`. Anything else is a
  regression until explained.
- A plugin or a detector change: every finding that disappears must be one the change is meant
  to remove (a router export, a template use); inspect every new one in the source.
- An `ERROR` line is a crash: reproduce it with a fixture test first (red), then fix.
- Time: plugins have a budget of +5 % on their set; core changes should not slow `r1`. The first
  run on new clones also creates Symbiote's worktrees (`r1`: 159 s, then 92 s): time only warm runs.
- The clones have no `node_modules`, so totals differ from journal figures measured on installed
  clones (`r1`: 927 edges here, 932 in W1's notes). Compare only runs made on the same clones.
  Library-typing features (Angular A3) need `npm ci` in the clone to show their effect.

**6. Record** the totals in the journal entry's "Verification" (e.g. "29 comparisons identical:
932 edges, no finding changed; Bitwarden 10 identical") and in the commit message.

**7. Clean up**: `git worktree remove --force /tmp/symbiote-base`.

## Adding a comparison

Add `[repo, head]` (base = `head~1`) or `[repo, base, head]` to a set in `sets.json`; new repos
need a `url`. A local-only experiment becomes a patch: `git format-patch --stdout base..branch >
scripts/regression/patches/<repo>-<name>.patch` plus a `branches` entry. Keep sets stable: changing
one makes earlier results incomparable, so add a new set for a new purpose.
