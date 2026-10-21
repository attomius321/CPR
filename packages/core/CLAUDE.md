# @symbiote/core

The engine. Language-neutral pipeline; everything TypeScript-specific sits behind
`LanguageAdapter` (`src/adapter.ts`) in `src/lang/typescript/`.

## How a run flows (`src/pipeline.ts`)

1. Revisions: `analyzeGit` resolves base/head (merge-base by default), lists changed files, and
   checks both out as cached worktrees (`src/git/`), linking `node_modules` (`src/deps.ts`).
   `.symbioteignore` comes from the working folder (`src/ignore.ts`).
2. `adapter.load` per side (`lang/typescript/project.ts`): one ts-morph project from the repo's
   tsconfigs; workspace packages mapped to their sources; per-file module resolution for repos with
   several projects (`configs.ts`, W1); plugins' virtual files added before the program exists.
3. Extraction twice (`extract.ts`): pass 1 without type inference on changed files; pass 2 infers
   only for symbols whose syntax differs (inference is the costly part). `diffSymbols` matches
   added/removed/modified/moved (`src/diff.ts`).
4. References around changed symbols (`references.ts`: `findReferences` incoming, a walk outgoing),
   context widened by `depth` hops, merged into edges per side.
5. Exposure, public API, dangling uses (`detect.ts`), then detectors (`src/detectors.ts`,
   compatibility in `src/compat.ts`).
6. Projects (`src/projects.ts`, V7): the app or library of each file the graph names — declared
   (workspace globs in `src/workspace.ts`, Nx, `adapter.projects` from plugins), packages,
   tsconfig folders, the root — read from head, base for base-only files. Then the graph
   (`src/graph.ts`), whose `projects` appears only with two or more.

## Rules

- **IDs** are `<repo-relative path>#<qualified name>`; top-level code is `file#(module)`; plugin
  templates are `…#(template)`. IDs must not depend on anything but the code at that place.
- **Hashes** (`extract.ts`, `tokens.ts`) ignore formatting and comments: build them from tokens,
  never from raw text. Never hash `checker.typeToString` output when a declared type node exists —
  it orders union members by type creation, which differs between the base and head programs.
- **Inference** only for symbols that need it (`infer(id)`); placeholders keep the syntactic pass
  cheap. Anything checker-based that must be seen in pass 1 (a plugin contract) has to be cheap.
- **References**: `findReferences` returns nodes without a parent for `{@link …}` in JSDoc — guard
  every walk up the tree. Class members: only code that could run on an instance counts (R1,
  `FamilyFilter`).
- **Detectors**: a finding needs a message a reviewer can act on, `related` symbols and `data`
  sites. Prefer silence to a guess; severities follow `docs/PLAN.md` §8 and decisions in §14.
- **Plugins** (`lang/typescript/plugins.ts`): `PLUGIN_API_VERSION` 1; adding an *optional* hook is
  compatible, changing one is not. Every call goes through `runHook`: a throwing hook disables the
  plugin for that revision with a warning. Without plugins the adapter must behave exactly as
  before — `test/plugins.test.ts` checks it.

## Graph JSON changes

1. `SCHEMA_VERSION` in `src/graph.ts`: minor for a new optional field or enum value, major
   otherwise.
2. `schema/graph.schema.json` and `docs/graph-schema.md` (fields, example, the history line).
3. Goldens in `test/__snapshots__/` (read the diff, then `npx vitest run packages/core -u`).
4. The viewer must still open older graphs (consumers ignore unknown fields).

## Tests

- Fixture pairs: `test/fixtures/diff/<case>/{base,head}`, `test/fixtures/refs`, `test/fixtures/extract`.
- Helpers: `test/helpers/extract.ts` (`extractSources`, `pair` — extract two versions of a file),
  `test/helpers/git-repo.ts` (`createRepo`, `tempDir` — real git repos), `test/helpers/tpl-plugin.ts`
  (a complete example plugin using every hook).
- Contract and per-JSX-site props logic: `test/contract.test.ts`; compatibility: `test/compat.test.ts`.
- After any change here, run the `regression-check` skill (`r1` at least) against `main`.
