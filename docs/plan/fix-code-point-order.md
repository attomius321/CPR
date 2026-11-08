# Fix — Graph order that does not depend on the machine's locale

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding C3)

**Status:** planned (2026-11-06), to be built on branch `fix/code-point-order` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/code-point-order` · **Size** S · **Depends on** none ·
**Plan** P17 of 51 (the audit's order)

## The brief

**What happens**: core sorts with `String.prototype.localeCompare` and no locale, so the order
follows the process's locale (`LANG`). One change can produce graph JSON in a different order on
CI and on a laptop: its changes, context, edges, findings and projects.

**How to reproduce**: two files `src/ö.ts` and `src/z.ts` compare differently under `LANG=sv_SE`
(z before ö) and `LANG=en_US` (ö before z). Run `node -e "console.log(['ö','z'].sort((a,b)=>a.localeCompare(b)))"`
under both.

**Where to look**: the 10 calls in `packages/core/src`:
- `diff.ts:179,182` (`byLocation`)
- `pipeline.ts:394` (context), `:577` (edges)
- `detectors.ts:49-50` (findings)
- `projects.ts:156` (projects: `docs/graph-schema.md:94` says "sorted by folder")
- `fs-diff.ts:39`
- `lang/typescript/configs.ts:187`
- `git/branches.ts:142` (the Git page's remotes, not the graph)

**Out of scope**: the viewer's sorting (it sorts for display, in the person's browser), and
choosing a new order. The order must stay what `main` gives on an `en_US` machine, CI's.

**Done when**: core passes one fixed comparator everywhere. The graph JSON of every `r1`
comparison is byte-identical to `main`'s on `en_US`, and the same under `LANG=sv_SE` and `LANG=C`.

## Evidence

- **Code**: 10 `localeCompare` calls counted in core, none with a locale argument.
- **Correction to the audit's suggested fix**: "compare by code point" changes today's order for
  plain ASCII too. ICU puts `a.ts` before `B.ts`, where code point puts `B` (66) before `a` (97).
  Punctuation orders differently as well. Real repositories mix case (`README.md`,
  `CHANGELOG.md`, `Ky.ts`), so goldens and graph JSON would move.
- **The contract**: `docs/graph-schema.md` promises an order only for projects ("sorted by
  folder", line 94), and names no collation. The viewer re-sorts what it shows. So the order is
  stable output, not contract. Still, keep it, so diffs of graph JSON and goldens stay clean.

## Approach

- One comparator in core, `compareText` (`packages/core/src/text-order.ts`):
  `new Intl.Collator('en', { usage: 'sort' }).compare`, created once. A fixed locale keeps
  today's `en_US` order and stops following `LANG`.
- Replace the 10 calls. `branches.ts:142` may keep the person's locale, since it is UI order;
  decide and say which in the commit.
- Node ships full ICU (`process.versions.icu`). Note in a comment that the order can still move
  with an ICU upgrade. Code point is the only order that never moves; it is rejected above for
  the churn.

## Tests first

`packages/core/test/text-order.test.ts`:
1. `['src/z.ts', 'src/ö.ts', 'src/B.ts', 'src/a.ts'].sort(compareText)` equals what `en_US` ICU
   gives: `['src/a.ts', 'src/B.ts', 'src/ö.ts', 'src/z.ts']`. Run it under
   `LANG=sv_SE.UTF-8 npx vitest run …`: with `localeCompare` it fails, since ö sorts last.
2. A pipeline case: `analyzeDirectories` on a fixture with `ö.ts` and `z.ts` changed gives the
   same `changes` order under `LANG=sv_SE.UTF-8` and `LANG=en_US.UTF-8`. Add a vitest project or
   an `env` that sets `LANG`; check that Node's ICU picks it up (`Intl.DateTimeFormat().resolvedOptions().locale`).

## Verification

- `pnpm check`, `pnpm build`.
- `regression-check`, the `r1` set against `main`: all 29 identical, edges, findings and order.
  Also `bitwarden` and `qwik-docs`: references sort through `pipeline.ts:577`.
- Goldens in `packages/core/test/__snapshots__/`: no diff expected. If one appears, read it
  before `-u` (CLAUDE.md); a diff means the collator differs from `main`'s default.
- No schema change and no `SCHEMA_VERSION` bump: no field changes (`packages/core/CLAUDE.md`).

**Risks**

| Risk | Mitigation |
|---|---|
| CI's runner locale is not `en_US` today, so its graphs already differ | Fixing the locale makes CI and laptops agree from now on |
| A new ICU changes the order | Rare; goldens would show it in review |
