# CPR Journal

Everything we run into while building CPR: discoveries, decisions made on the way, gotchas,
measurements and open issues. Newest milestone last. The plan ([PLAN.md](./PLAN.md)) holds the
settled design; this file holds the story and the evidence.

Branch flow: each milestone is built on `milestone/<id>-<name>`, then merged into `main` with a
merge commit.

---

## M0 — Scaffolding (2026-10-01)

**Discoveries**
- TypeScript `latest` on npm is **7.0** (the Go port). typescript-eslint 8.x supports only
  `typescript >=4.8.4 <6.1.0`, so our own toolchain is pinned to **TS 6.0.x**.
- **Vitest 5** requires Node `^22.12 || ^24 || >=26`. Node 20 is EOL (April 2026). Minimum Node
  is now 22.12.
- **pnpm 12** is a rewrite with a stricter CLI: `pnpm -s` (silent) is rejected
  (`error: unexpected argument '-s'`). Use `pnpm run <script>`.
- `pnpm/action-setup` is superseded by **`pnpm/setup`** for pnpm ≥ 11; it installs pnpm, Node
  (`runtime: node@<v>`) and runs a frozen install in one step. Current majors:
  `actions/checkout@v7`, `pnpm/setup@v3`.
- **ESLint 10** enables `preserve-caught-error`: errors thrown inside `catch` must pass
  `{ cause }`.
- TS 6.0 deprecates `baseUrl`, `moduleResolution: node`, `target: es5` (errors unless
  `ignoreDeprecations: "6.0"`); TS 7 removes them.

**Decisions**
- Dev typecheck uses `paths` to point `@cpr/core` at its sources (no build needed); the build
  config resolves through `node_modules` like at runtime. Vitest uses an alias for the same.
- Prettier ignores Markdown so the docs keep hand-written tables.

## M1 — Git layer (2026-10-01)

**Discoveries**
- ts-morph 28 bundles **TypeScript 6.0.2**. Tested a TS 4–style project (`target: es5`,
  `moduleResolution: node`, `baseUrl` + `paths`): it loads, path aliases resolve, but the three
  options raise deprecation diagnostics → load projects with `ignoreDeprecations: "6.0"`.
- TS 7.0 ships its compiler API only under `typescript/unstable/*` (`sync`, `async`, `ast`).
  It has `Checker.getSymbolAtLocation`, `getAliasedSymbol`, `getReferencesToSymbolInFile`,
  talking to the Go binary over IPC. ts-morph does not support it → spike S1 after M4.

**Decisions**
- Worktrees are a **slot pool** (`<cache>/worktrees/<repo-id>/<role>-<n>`) instead of one
  checkout per SHA: bounded disk, and `git checkout --detach` only rewrites changed files.
  Slots are locked with pid files; dead-pid locks are taken over.
- `cpr diff` resolves user refs with `rev-parse --verify --end-of-options <ref>^{commit}`, so a
  ref can never be read as an option; every later git call uses resolved SHAs.

**Gotchas**
- `git worktree prune` is global: it would also clear the user's own stale worktree entries.
  `git worktree add --force` replaces the stale registration of *our* path only.
- `child_process` reports a missing `cwd` and a missing `git` binary both as `ENOENT`.
- Git prints real paths; on macOS `/var` → `/private/var`. Compare slot paths after `realpath`.
- Parse `git diff --name-status -z` by index, not `Array.shift()` (quadratic on big diffs).
- Pass `--no-relative --no-ext-diff --no-color` so user git config (`diff.relative`,
  `diff.external`, `color.ui=always`) cannot change the output we parse.

**Open**
- Slots appear in `git worktree list` of the user's repo. Consider a `cpr cache clean` command.
- Stale-lock takeover has a narrow race if two runs recover the same dead lock at once.

## M2 — Symbol extraction (2026-10-01)

**What landed**
- `LanguageAdapter` interface (`load`, `extract`, `matches`) and the TypeScript adapter on
  ts-morph **28.0.0** (pinned exact).
- Project loading: root `tsconfig.json` (following `references` recursively), or, with no
  tsconfig, every source file with default options (`allowJs`, `moduleResolution: Bundler`).
  Every project gets `ignoreDeprecations: "6.0"` and `noEmit`.
- Extraction walks the compiler AST directly (not ts-morph wrappers) for speed.

**Decisions**
- Interfaces, type aliases and enums put their **whole declaration in the signature hash** and
  have no body: changing a type's shape is a contract change, so it should feed the
  `signature-changed` blast radius (North Star: "who is affected").
- Static members are always `Class.static:name` (stable IDs).
- `exported` is hashed as a flag, not the `export` keyword, so `export function f` and
  `function f; export { f }` hash the same.
- A class's body hash is its sorted member-name list plus static blocks/index signatures; member
  edits show on the member, not the class.
- Hashes are the first 16 hex chars of SHA-256 over the token stream.

**Discoveries**
- `typeToString` with `UseAliasDefinedOutsideCurrentScope` prints `User`, not
  `import("/abs/path").User`. We still strip the revision root from type text, because base and
  head live in different checkout folders.
- `node.getChildren()` includes JSDoc nodes as children; they must be skipped explicitly.
- ts-morph's `getSourceFile('relative/path')` resolves against the process cwd, not the project.
- Building a ts-morph project with lib files costs ~0.3–0.5 s even for one file; the extraction
  test file takes ~9 s for 15 projects.

**Gotchas**
- Prettier was reformatting Vitest file snapshots → `**/__snapshots__` is now in
  `.prettierignore`.
- `typescript-eslint`'s `no-unsafe-assignment` flags destructuring `ts.readConfigFile` results
  (`config: any`); cast the result type.

**Open**
- Redundant parentheses (e.g. Prettier wrapping multi-line JSX in `return (…)`) count as body
  changes. Fine while both sides use the same formatter.
- TS 6.0 may default `types` to `[]` (no automatic `@types/*`); verify in M4 when
  `node_modules` is linked into worktrees.
- CommonJS export patterns are not extracted yet.
- One project for the whole repo uses the root config's options; per-package path aliases in
  monorepos may resolve poorly (revisit in M4).

## M3 — Symbol diff and moves (2026-10-01)

**What landed**
- `diffSymbols` (language-neutral): added / removed / modified{signature, body, moved} /
  unchanged, with move matching by git file rename → identical declaration → identical
  non-trivial body (≥ 10 tokens), and members following their container.
- `analyzeGit` / `analyzeDirectories` pipeline: changed files → slots → projects → extract →
  diff. Projects are skipped entirely when no source file changed.
- `listChangedFilesInDirectories` for fixtures (exact-content rename detection).
- `cpr diff` now prints changed symbols per file (`+` added, `-` removed, `~` modified,
  `→` moved) and takes `--project`.

**Decisions**
- Moves require a unique candidate on both sides (North Star: precise beats complete).
- A rename is a signature change (the name is part of the contract); a pure file move is not.
- `SymbolDecl.bodySize` (normalized body tokens) exists so tiny bodies (`{}`) never prove a move.

**Dogfood (CPR on itself, M1 → M2: 25 files, 106 symbols)**: ~1.0 s end to end.

**Bugs found by dogfooding**
- Crash `Cannot read properties of undefined (reading 'escapedName')` in
  `getSignatureFromDeclaration`: a `.js` file in a TS project without `allowJs` is not part of
  the program, so its node was never bound. Fixes: force `allowJs: true, checkJs: false`, and
  read source files back from the built program (only the program's copy is bound). Checker
  queries now degrade to `?` instead of crashing. Regression test:
  `fixtures/extract/esm-outside-config`.
- CLI tests wrote worktree slots into the real `~/.cache/cpr`, leaving orphans for deleted temp
  repos. Tests now set `CPR_CACHE_DIR`.

**Open**
- Worktrees have no `node_modules`, so types from dependencies infer as `any` (M4).
- Files the program drops are skipped silently; surface them as analysis warnings (M6).
- Orphan slots of deleted repos accumulate in the cache → `cpr cache clean`.

## M4 — References and edges (2026-10-01)

**What landed**
- `LanguageAdapter.incoming / outgoing / warnings`; `EdgeRef` (one side) and `Edge` (merged,
  `side: base | head | both`, sites per side).
- Incoming via the language service's `findReferences`; outgoing by resolving every identifier.
  Kinds: `call` (incl. JSX elements, decorators, tagged templates), `new`, `extends`,
  `implements`, `type-reference`, `reference`.
- Enclosing-symbol naming (`enclosingSymbolId`) shares helpers with extraction (`syntax.ts`), so
  reference endpoints always match extracted IDs. Top-level code is `file#(module)`.
- Externals `<package>#<name>`, unresolved calls `unknown:<callee>`, lib globals skipped.
- Pipeline: both sides' references, base→head ID renaming for moves, context nodes,
  `--depth`, warnings. `cpr diff` shows `· used by N` per changed symbol.
- Loader: all tsconfigs in the repo, workspace packages → sources via `paths`, `node_modules`
  symlinked into slots, changed files added before the program is built.

**Decisions**
- Workspace packages come only from declared workspaces (`package.json#workspaces`,
  `pnpm-workspace.yaml`). Mapping every `package.json` would let a fixture named like a real
  package hijack imports.
- Externals are named by the resolved declaration's package (`@ts-morph/common#ts…` for
  `import { ts } from 'ts-morph'`); simple, but not the specifier the user wrote.
- ts-morph's `resolutionHost` only exposes the legacy `resolveModuleNames` (no ESM/CJS mode), so
  we generate `paths` instead of hooking resolution.

**Bugs caught by tests**
- `ts.isObjectLiteralElementLike` also matches class `MethodDeclaration`: method calls vanished
  from outgoing edges. Check `ts.isObjectLiteralExpression(decl.parent)` instead.
- `extract()` used to add missing files on demand; that rebuilds the program and invalidates
  every node held so far. Files now go to `load({ files })`.

**Dogfood (CPR on itself, M3 → M4 branch: 38 files, 115 changed symbols, 606 edges)**
- 3.7 s end to end. Per side: load 1.4 s (301 program files, mostly lib + ts-morph `.d.ts`),
  extract 0.17 s, incoming 0.6 s (549 refs), outgoing 0.3 s (1334 refs).
- Cross-package edge `packages/cli/src/main.ts#diff → packages/core/src/pipeline.ts#analyzeGit`
  works through the workspace `paths` mapping.
- Moves `extract.ts#hasModifier → syntax.ts#hasModifier` detected (signature changed: now
  exported).

**Open**
- One option set per repo: fixture tsconfig path aliases (`@app/*`) don't apply → their imports
  show up as externals. Per-config projects would fix it.
- Many external type-reference nodes (`@ts-morph/common#ts.ArrowFunction`, …); the viewer
  should group externals by package.
- `via` (barrel hops) not recorded.
- TS 6.0 `types` default: still unverified whether `@types/*` load automatically.

## S1 — TypeScript 7 spike (2026-10-01)

Full write-up: [spikes/ts7/README.md](../spikes/ts7/README.md).

**Numbers**

| Project | Files | Symbols | Load ts-morph → TS 7 | Search ts-morph → TS 7 | Use sites agree |
|---|---|---|---|---|---|
| CPR `packages/core` | 226 | 156 | 1075 → 156 ms | 496 → 141 ms | 588 vs 587 |
| zod `packages/zod` | 380 | 2517 | 1521 → 404 ms | 13 858 → 8 721 ms | 30 421 vs 30 396 |

**Discoveries**
- `new API({ cwd })` spawns the bundled `tsgo`; `updateSnapshot({ openProjects: [tsconfig] })`
  gives projects with `program` and `checker`.
- `checker.getReferencedSymbolsForNode(node, pos)` needs the **identifier** node
  (`getTouchingToken` from `typescript/unstable/ast`); a `SourceFile` returns nothing.
- References come back as `NodeHandle`s; `handle.resolve()` fetches the AST node lazily.
- ts-morph reports JSDoc `{@link X}` references; TS 7 does not.
- Per-symbol search cost on zod: ~5.5 ms (ts-morph, in-process) vs ~3.5 ms (TS 7, IPC).

**Decision:** stay on ts-morph for v1 (PLAN decision #9). Revisit when the API is stable or
offers batched reference search; load time is where TS 7 wins most.

**Also learned:** CPR's own reference search cost scales with symbols × files; on zod a
whole-package sweep (2.5k symbols) takes ~14 s with ts-morph. Real PRs touch far fewer
symbols, but M7 must measure big PRs.

## M5 — Detectors (2026-10-01)

**What landed**
- `runDetectors` (language-neutral) with three rules; findings numbered `f1…` by severity.
- Adapter: `dangling(revision, removed)` scans head files (text prefilter on the name) for
  identifiers that no longer resolve: alias to nothing (import of a removed export), unknown
  name, or property missing on a typed receiver → `resolved`; JS files or `any` receivers →
  `unknown`. `exposure(revision, symbol)`: `override` (an inherited member of the same name),
  `default-export`, `entry-export` (exported from the package's source entry).
- `cpr diff` prints a Findings block.
- Default ignores (`fixtures/`, `__fixtures__/`, `__snapshots__/`, `generated/`,
  `*.generated.*`) and `.cprignore`.

**Decisions**
- A dangling name only counts for a removed symbol when the head symbol using it already used
  the removed one in base (or imports it from the removed symbol's file). This keeps
  `canvas.clear()` in an untyped JS file from being blamed when it never resolved anyway.
- Orphan rule skips overrides (called through the base type) and reports an orphan class once.
- Signature "updated" = the user changed in this PR (or is top-level code of a changed file).

**Dogfood (CPR on itself, M1 → M5)**
- Before ignores: ~20 `orphan-added` warnings, all from test fixtures (fixture code is never
  called). After default ignores: 0 false orphans.
- Editing a string constant (`DIFF_HELP`) was reported as a **signature** change because a
  `const` has a literal type. Inferred types of variables, properties and default expressions
  are now widened (`getBaseTypeOfLiteralType`): new value = body change.
- Remaining finding is real: `parse` gained a `const` type parameter (its one caller updated).

**Open**
- `analyzeGit` decides whether to check out slots before reading `.cprignore` (fixture-only
  changes still cost a checkout).
- The dangling scan reads every head file containing the name; fine for removed symbols with
  distinctive names, slower for `get`/`run`.

## M6 — Graph JSON and CLI (2026-10-01)

**What landed**
- `buildGraph(analysis)` → graph JSON v0.1.0: `revisions` (+ `from`), `files` (with
  `ignored`), `nodes` (changed + context), `edges` (`e1…`), `findings`, `stats` (+ `edges`,
  `durationMs`), `warnings`.
- JSON Schema (draft 2020-12) at `packages/core/schema/graph.schema.json`, exported from the
  package; golden graphs for three fixture pairs are validated with Ajv and snapshotted.
- CLI: `--json`, `--out <file>`, `--fail-on <error|warning|info>`; exit codes 0/1/2.
- CI dogfoods every push: `cpr diff HEAD~1` on CPR itself (`fetch-depth: 2`).

**Decisions**
- Folder comparisons keep `sha`/`mergeBase`/`from` as `null` rather than inventing values.
- Context nodes carry only the side they were resolved on (head when possible); unchanged
  symbols in changed files carry both.
- Ajv's 2020 build: `import { Ajv2020 } from 'ajv/dist/2020.js'` (named export) works with
  NodeNext; the default import is the CJS namespace.
- `SCHEMA_VERSION` moved into `graph.ts` next to the types it versions.

## M7 — Dogfood on ky, zod, vite (2026-10-01)

Script: `node scripts/dogfood.mjs <repo> [count] [--json]` (each recent commit touching TS,
`C~1 → C`, full pipeline, phase timings).

**Repos**
- **ky** (87 TS files): small, `npm install` done → dependency types available.
- **zod** (515 TS files, workspaces): its lockfile belongs to the `nub` package manager; pnpm
  and npm both failed → analyzed **without `node_modules`** (realistic for CI without install).
- **vite** (601 TS files + 1k playground files, 38 tsconfigs, **no root tsconfig**): `pnpm
  install --ignore-scripts`.

**Bugs found and fixed**
1. **Crash** on 3/15 zod commits: `Cannot read properties of undefined (reading 'kind')`.
   `import * as z` resolves `z` to the module, whose declaration is a `SourceFile` with no
   parent. Outgoing resolution now skips module declarations. Regression test:
   `refs/app/src/namespace.ts`.
2. **Noise**: `signature-changed` warned on every interface change, e.g. ky adding the optional
   `maxResponseSize?` listed all 5 type users as "not updated". New compatibility check
   (shapes: params/returns, members) → `compatible` / `additive` / `breaking` / `unknown`; only
   possibly-breaking changes with untouched users **in other files** warn.
3. **Slow extraction** on zod (2.5 s of 7 s): inferred return types computed twice per function,
   printed untruncated. Now cached, truncated, and only computed for symbols whose syntax
   differs between the sides (two-pass extraction): `extract` 2.5 s → 0.35–1.9 s.
4. **Slow loading** on vite (7.7 s per side): no root tsconfig → we globbed 2,724 files, with
   playgrounds. Now: configs below the root are loaded (ignore-aware), `examples/` and
   `playground/` are default ignores → 932 files, 2.9 s.
5. Messages: top-level code shows as `file (top level)` instead of `(module)`; user lists are
   capped at 5 (`and N more`).

**Results after fixes**

| Repo | Commits | Per commit | Findings (warning / info) | Warnings judged |
|---|---|---|---|---|
| ky | 10 | 0.8–3.1 s | 1 / 12 | 1 true (`InternalOptions` lost `Required<…>`) |
| zod | 15 | 2.8–6.4 s | 4 / 10 | 4 defensible (union members removed/added, return type changed) |
| vite | 12 | 4.5–7.0 s | 0 / 3 | — |

No `removed-still-referenced` or `orphan-added` false positives showed up on these histories
(merged commits compile, so removed symbols are rarely still used).

**Open / next**
- Loading both programs is ~70 % of the time → reuse one program across sides (incremental).
- Union-aware compatibility (adding a union member is additive, removing one breaks producers).
- zod's `docs/`, `bench/` configs load into the program; per-repo `.cprignore` can trim them.
- Commits only exercise "merged and green" code; PR heads with real mistakes would exercise
  `removed-still-referenced` better (phase 3, `cpr pr`).

## V1 — Viewer app (2026-10-01)

**What landed**
- `packages/viewer`: Vite 8 + React 19 + `@xyflow/react` 12 + `@dagrejs/dagre` 3. Loads a graph
  from `?graph=<url>`, from `./api/graph` (for `cpr view`), or a dropped/chosen JSON file.
- `toFlow(graph, { typeReferences, context })` (pure, unit-tested on the engine's golden graphs):
  symbols colored by tone (added, removed, modified, moved, context, external, unknown), delta
  tags, finding badges, edges styled by side (added green, removed dashed red, kept gray) and
  kind (type references and unknown calls dotted). Type references hidden by default
  (decision #3); context can be hidden.
- Symbols are boxed by file (packages and dynamic calls get their own boxes).
- Root `pnpm build` now also builds the viewer.

**Discoveries**
- dagre's compound-graph layout let clusters overlap (nodes of other files inside a file's
  box). Replaced with a **two-level layout**: each file's symbols laid out alone, then the boxes
  as nodes connected by cross-file edges. Boxes can't overlap by construction.
- React Flow 12: `colorMode="system"` themes controls/minimap for dark mode; children of a
  parent node are positioned relative to it and must come after it in the nodes array.
- dagre node labels are `any` after layout; a small typed `placement()` helper keeps lint clean.
- Edge labels made big graphs unreadable; kind is encoded by line style instead.
- Screenshots via Playwright with the preinstalled Chromium
  (`executablePath: '/opt/pw-browsers/chromium'`; the bundled revision doesn't match
  `@playwright/test` 1.63).

**Observed**
- A real ky commit (25 changed symbols, 58 context) is readable when zoomed, but the overview
  is dense → V4 adds focus (jump to finding, neighbourhood only).
