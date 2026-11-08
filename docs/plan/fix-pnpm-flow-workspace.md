# Fix — pnpm-workspace.yaml in flow style

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding C2)

**Status:** planned (2026-11-06), to be built on branch `fix/pnpm-flow-workspace` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/pnpm-flow-workspace` · **Size** S · **Depends on** none ·
**Plan** P16 of 51 (the audit's order)

## The brief

**What happens**: a `pnpm-workspace.yaml` written in YAML's flow style
(`packages: ['apps/*', 'libs/*']`) gives no workspace patterns. Two things follow:
- `workspacePaths` (`project.ts:312`) maps no package to its sources in the analyzed revision,
  so cross-package imports resolve through `node_modules`: the checkout's version, on both
  sides of a diff.
- `projects.ts:56` finds no declared projects.

**How to reproduce**: a fixture whose root has `pnpm-workspace.yaml` = `packages: ['libs/*']`
and `libs/a/package.json` named `@x/a`. `workspacePatterns(root)` returns `[]`. With the block
form (`packages:\n  - 'libs/*'`) it returns `['libs/*']`.

**Where to look**:
- `packages/core/src/workspace.ts:19-26`: the line reader. `^packages\s*:` sets `inPackages`,
  then only `- item` lines are read.
- `workspace.ts:41-50` (`globRegExp`) escapes `.+^${}()|[]\` but not `?`, so `?` stays a regex
  quantifier, and it does not expand braces (`{apps,libs}/*`).
- Users: `packages/core/src/projects.ts:56-57`, `packages/core/src/lang/typescript/project.ts:313-315`.

**Out of scope**: a full YAML parser as a new runtime dependency (CLAUDE.md: a new one needs a
recorded reason), `package.json` `workspaces` (already read as JSON).

**Done when**:
- Flow sequences on the `packages:` line, one-line and multi-line, give their patterns.
- A `?` in a glob matches one character.
- `{a,b}` expands.
- The block form gives exactly what it gives today.

## Evidence

- **Code**: read in `workspace.ts:19-26`. A flow sequence never yields an item line.
- Not measured on a real repository. The six regression repositories use the block form or
  `package.json` `workspaces`; check with `grep -n packages ~/.cache/symbiote-regression/*/pnpm-workspace.yaml`.

## Approach

- After `packages:`, if the rest of the line starts with `[`, read until the matching `]`, which
  may span lines. Split on commas outside quotes, then unquote `'…'` and `"…"`.
- Comments (`#`) outside quotes end a line, as today.
- In `globRegExp`: map `?` to `[^/]` and expand `{a,b}` before splitting. Keep `**` as today.
- Keep it in `workspace.ts`, pure, with no new dependency.

## Tests first

`packages/core/test/workspace.test.ts` (new; the module has no test of its own), calling
`workspacePatterns` on temp folders:
1. `packages: ['apps/*', "libs/*"]` → `['apps/*', 'libs/*']`. It fails today (`[]`).
2. A flow sequence over three lines with a trailing comma and a comment. It fails today.
3. The block form with a `!` exclusion. It passes today: keep it green.
4. `workspaceMatcher(['lib?/*'])` matches `libs/a`, not `libs2/a`. It fails today (`?` is a
   quantifier).
5. `workspaceMatcher(['{apps,libs}/*'])` matches `apps/a` and `libs/b`. It fails today.

## Verification

- `pnpm check`, `pnpm build`.
- `regression-check`, the `r1` set against `main`: identical, since none of its repositories
  uses the flow form. Goldens in `packages/core/test/__snapshots__/` must not change; no graph
  JSON change, so no schema bump.
- A fixture pair under `packages/core/test/fixtures/diff/` with a flow-style workspace and a
  cross-package call: the edge resolves to the package's `src/`, not to `node_modules`.
