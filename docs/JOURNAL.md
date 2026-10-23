# Symbiote Journal

Everything we run into while building Symbiote: discoveries, decisions made on the way, gotchas,
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
- Dev typecheck uses `paths` to point `@symbiote/core` at its sources (no build needed); the build
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
- `symbiote diff` resolves user refs with `rev-parse --verify --end-of-options <ref>^{commit}`, so a
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
- Slots appear in `git worktree list` of the user's repo. Consider a `symbiote cache clean` command.
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
- `symbiote diff` now prints changed symbols per file (`+` added, `-` removed, `~` modified,
  `→` moved) and takes `--project`.

**Decisions**
- Moves require a unique candidate on both sides (North Star: precise beats complete).
- A rename is a signature change (the name is part of the contract); a pure file move is not.
- `SymbolDecl.bodySize` (normalized body tokens) exists so tiny bodies (`{}`) never prove a move.

**Dogfood (Symbiote on itself, M1 → M2: 25 files, 106 symbols)**: ~1.0 s end to end.

**Bugs found by dogfooding**
- Crash `Cannot read properties of undefined (reading 'escapedName')` in
  `getSignatureFromDeclaration`: a `.js` file in a TS project without `allowJs` is not part of
  the program, so its node was never bound. Fixes: force `allowJs: true, checkJs: false`, and
  read source files back from the built program (only the program's copy is bound). Checker
  queries now degrade to `?` instead of crashing. Regression test:
  `fixtures/extract/esm-outside-config`.
- CLI tests wrote worktree slots into the real `~/.cache/symbiote`, leaving orphans for deleted temp
  repos. Tests now set `SYMBIOTE_CACHE_DIR`.

**Open**
- Worktrees have no `node_modules`, so types from dependencies infer as `any` (M4).
- Files the program drops are skipped silently; surface them as analysis warnings (M6).
- Orphan slots of deleted repos accumulate in the cache → `symbiote cache clean`.

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
  `--depth`, warnings. `symbiote diff` shows `· used by N` per changed symbol.
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

**Dogfood (Symbiote on itself, M3 → M4 branch: 38 files, 115 changed symbols, 606 edges)**
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
| Symbiote `packages/core` | 226 | 156 | 1075 → 156 ms | 496 → 141 ms | 588 vs 587 |
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

**Also learned:** Symbiote's own reference search cost scales with symbols × files; on zod a
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
- `symbiote diff` prints a Findings block.
- Default ignores (`fixtures/`, `__fixtures__/`, `__snapshots__/`, `generated/`,
  `*.generated.*`) and `.symbioteignore`.

**Decisions**
- A dangling name only counts for a removed symbol when the head symbol using it already used
  the removed one in base (or imports it from the removed symbol's file). This keeps
  `canvas.clear()` in an untyped JS file from being blamed when it never resolved anyway.
- Orphan rule skips overrides (called through the base type) and reports an orphan class once.
- Signature "updated" = the user changed in this PR (or is top-level code of a changed file).

**Dogfood (Symbiote on itself, M1 → M5)**
- Before ignores: ~20 `orphan-added` warnings, all from test fixtures (fixture code is never
  called). After default ignores: 0 false orphans.
- Editing a string constant (`DIFF_HELP`) was reported as a **signature** change because a
  `const` has a literal type. Inferred types of variables, properties and default expressions
  are now widened (`getBaseTypeOfLiteralType`): new value = body change.
- Remaining finding is real: `parse` gained a `const` type parameter (its one caller updated).

**Open**
- `analyzeGit` decides whether to check out slots before reading `.symbioteignore` (fixture-only
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
- CI dogfoods every push: `symbiote diff HEAD~1` on Symbiote itself (`fetch-depth: 2`).

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
- zod's `docs/`, `bench/` configs load into the program; per-repo `.symbioteignore` can trim them.
- Commits only exercise "merged and green" code; PR heads with real mistakes would exercise
  `removed-still-referenced` better (phase 3, `symbiote pr`).

## V1 — Viewer app (2026-10-01)

**What landed**
- `packages/viewer`: Vite 8 + React 19 + `@xyflow/react` 12 + `@dagrejs/dagre` 3. Loads a graph
  from `?graph=<url>`, from `./api/graph` (for `symbiote view`), or a dropped/chosen JSON file.
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

## V2 — `symbiote view` (2026-10-01)

**What landed**
- `symbiote view <base> [head] [--port] [--no-open]`: runs the same analysis as `diff`, serves the
  built viewer + `/api/graph` + `/api/source` on `127.0.0.1`, opens the browser, stops on
  Ctrl+C. Startup line: `15 files · 25 symbols changed · 3 findings` + URL.
- `startViewServer` (testable without a CLI process): static files confined to the viewer
  folder (`..` and `%2e%2e` refused), sources only for files the graph mentions, read with
  `git show <sha>:<path>` (`readFileAtRevision` in core).
- `CliContext` gained `openUrl` and `waitForExit` so tests drive the long-running command;
  `SYMBIOTE_VIEWER_DIR` points at another viewer build (tests, development).
- `diff` and `view` share option parsing and the analysis call.

**Decisions**
- Bind to `127.0.0.1` only and never serve arbitrary files: the server holds the repository's
  source.
- Context nodes carry only their head side, so base sources are served only for files that
  changed (or base-side symbols).

**Verified**: `symbiote view` on a ky commit served the viewer, the graph and the head/base sources.

**Gotcha**: `pkill -f "bin.js view"` also matches the shell running the command; kill by PID.

## V3 — Symbol detail panel (2026-10-01)

**What landed**
- Clicking a symbol opens a side panel: kind, status and delta tags, file (and where it moved
  from), findings about it and findings that mention it, old/new signature, a **line diff of
  just that symbol** (both line numbers, common indentation removed, tabs at width 2), and its
  users and callees as links that select and center the other symbol. Esc or a click on the
  canvas closes it.
- Pure helpers with tests: `symbolDetail` (neighbours by edge side, findings, mentions),
  `excerpt` (range → whole lines, dedented), `diffRows` (unified rows via the `diff` package).
- Sources come from `symbiote view`'s `/api/source`, fetched once per side and file; a graph opened
  from a file shows a hint instead.

**Verified end to end** (Playwright + Chromium against a real `symbiote view` on ky): an added method
shows its code as all-added rows; a modified method (`Ky.#retry`) shows the removed type
parameter in the signature and the exact changed lines.

**Gotcha**: Prettier collapses short import lists to one line, so scripted string edits of
`App.tsx` stopped matching; rewriting the file whole was simpler and clearer.

## V4 — Review flow (2026-10-01)

**What landed**
- Sidebar with two tabs: **Changes** (changed symbols in reading order, grouped by file, each
  with a "reviewed" checkbox and a progress bar `2/25`) and **Findings** (by severity; a click
  selects the symbol). Opens on Findings when there are any.
- Reviewed marks persist in `localStorage` per revision pair (`symbiote:reviewed:<base>..<head>`), so
  a new push starts fresh; storage failures (private windows) degrade to session-only.
- **Focus** mode (toggle or `f`): only the selected symbol and its 1-hop neighbourhood.
- Keyboard: `j`/`k` next/previous change, `r` toggle reviewed, `f` focus, `Esc` close. Ignored
  while typing in inputs.
- Detail panel: "Mark reviewed" button; classes and namespaces list their **changed members**
  instead of dumping their whole body; diffs longer than 300 lines collapse behind "Show all".
- Reviewed symbols are dimmed with a ✓ in the graph.

**Bugs caught by end-to-end screenshots**
- Focus left the canvas empty: React Flow's `fitView` prop only applies on mount. Re-fit after
  the node set changes, one animation frame later (nodes must be measured first).
- Selecting a class showed its entire body (1,000+ lines in ky's `Ky`); its members are
  separate symbols, so the class shows its changed members instead.

## V5 — Viewer dogfood (2026-10-01)

**What landed**
- Playwright end-to-end suite (`pnpm test:e2e`, `packages/viewer/e2e`): builds a git repo from
  the detectors fixture (base and head commits), starts the built `symbiote view`, and checks the
  summary badges, node tones, finding → panel → code diff → neighbour navigation, `j`/`k`/`r`
  with reviewed marks surviving a reload, and focus mode. Any page error fails a test.
- CI runs it on the Linux / Node 24 job (`playwright install --with-deps chromium`); locally the
  preinstalled `/opt/pw-browsers/chromium` is used when present.
- File box labels truncate from the start (`…/v4/mini/index.ts`), keeping the file name.

**Viewer performance on real commits** (headless Chromium, 4 cores)

| Commit | Symbol nodes | First render | Click → panel | Focus toggle |
|---|---|---|---|---|
| zod 413cce9a | 212 | 510 ms | 309 ms | 88 ms |
| vite 744269e5 | 192 | 432 ms | 214 ms | 111 ms |

The analysis (~7 s) dominates `symbiote view` startup; the UI itself is fast at this size.

**Observed while reviewing**
- Test files often show up as `… (top level)` users of a changed signature (describe/it blocks
  are module-level code). Informative, but they inflate "untouched" counts; a later option
  could separate test users.
- Closing the panel keeps the zoomed viewport; the fit-view button returns to the overview.

## Phase 3 kickoff — GitHub **and** GitLab (2026-10-01)

Request: "It should also work with GitLab." Phase 3 now targets both forges through a forge
adapter (PLAN §12, Phase 3 milestones). This session can only reach the GitHub API for
`attomius321/Symbiote` (no PRs there), and no GitLab instance, so both adapters are tested against
local mock servers; `GITHUB_API_URL` / `GITLAB_API_URL` point the CLI at them.

## G1 — `symbiote pr` for GitHub and GitLab (2026-10-01)

**What landed**
- New package `@symbiote/forge` (network code stays out of the engine): `parseRemote` (https, ssh,
  scp-like, credentials in URLs), `detectForge` (host name → `--forge` → `SYMBIOTE_FORGE`),
  `GitHubForge` (incl. Enterprise `https://<host>/api/v3`; token from `GITHUB_TOKEN`,
  `GH_TOKEN`, or `gh auth token`) and `GitLabForge` (nested groups, URL-encoded project path,
  `PRIVATE-TOKEN` or CI `JOB-TOKEN`). Errors say which token to set, or that access is missing.
- Core: `remoteUrl` (reads `remote.<name>.url` from config, before `insteadOf`), `fetchRefs`.
- `symbiote pr <n>` / `symbiote mr !<n>`: API → fetch head + target branch into `refs/symbiote/<forge>/<n>/…`
  → analyze → viewer (or `--summary` / `--json` / `--fail-on`). Graph gains optional
  `changeRequest` (schema + viewer header link).
- `CliContext.env` carries tokens and settings; the worktree cache also resolves from it.

**Decisions**
- Diff base matches what each forge shows: GitHub → merge-base(base, head); GitLab →
  `diff_refs.base_sha` as is (no extra merge-base).
- If the API's commit is no longer fetchable (force-push), fall back to the fetched ref.
- `remote.<name>.url` is read raw so `url.<x>.insteadOf` can redirect fetches (used by the
  tests: a bare repo stands in for github.com / gitlab).

**Testing**: local mock APIs for both forges (headers, mapping, 401/404 messages) and full
`symbiote pr`/`symbiote mr` runs against a bare "forge" repo whose `refs/pull/7/head` and
`refs/merge-requests/7/head` point at the feature branch.

**Open**: self-hosted forges on non-standard ports need `GITHUB_API_URL` / `GITLAB_API_URL`
(the remote's SSH port says nothing about the API's).

## G2 — Review from the viewer (2026-10-01)

**What landed**
- Forge adapters gained `submitReview(request, {event, body, comments[]})`. GitHub: one
  `POST …/reviews` (`commit_id` = the analyzed head, `side` RIGHT/LEFT). GitLab: a draft note
  per comment (text position with base/start/head SHAs and old/new path + line), the summary as
  a draft note, `bulk_publish`, then `approve` (with the head `sha`) or, for request changes, a
  "**Changes requested.**" marker and `unapprove`. If GitLab rejects a draft midway, the drafts
  already created are deleted, so no half review lingers.
- Server: `GET /api/capabilities` (`{sources, review: {forge} | null}`) and `POST /api/review`
  (`symbiote pr` only), with a JSON body limit and validation (event, sides, files of the change,
  positive lines, non-empty bodies). All endpoints now check `Host` (DNS rebinding).
- Viewer: a Comments section in the detail panel (drafts, a box, `Ctrl/⌘+Enter`, `c` to focus),
  clickable +/− lines that move the anchor, a Review tab (drafts, summary, verdict, submit, the
  forge's link or error), 💬 counts in the Changes list. Drafts live in localStorage per
  revision pair, like reviewed marks. Esc in a text field now leaves the field instead of
  closing the panel; checkboxes no longer swallow `j`/`k`.
- E2E: `symbiote pr 7` against a mock GitHub API; two comments (an added line, a removed line), a
  reload, request changes, and the exact review GitHub receives.

**Decisions**: anchors (PLAN decision 13), GitLab request changes (decision 14). Comments go on
the commit that was analyzed, not the PR's newest head, so lines match what the reviewer saw.

**Learned**
- Forges only take inline comments inside diff hunks. The symbol diff comes from jsdiff on the
  symbol's excerpts while forges diff whole files; their changed lines nearly always coincide, and
  when they don't, the forge's 422 is shown instead of losing the review.
- GitHub needs no ordering of comments; GitLab's `bulk_publish` publishes *all* the user's
  pending drafts on the MR — the same as its own "Submit review" button.

**Open**: GitHub rejects approving or requesting changes on one's own PR (the error is shown);
multi-line comments (`start_line`) and suggestions are not offered yet.

## G3 — Findings as comments (2026-10-01)

**What landed**
- `symbiote pr <n> --post-findings <level>` (GitHub and GitLab): reads the existing comments, works
  out which findings at the level are new, posts them as one `comment` review, prints the
  summary, applies `--fail-on`. No viewer, so it is the CI building block for phase 5.
- Core: `listChangedLines` (`git diff -U0 -M`, explicit `a/`/`b/` prefixes so user config
  can't change them, C-quoted path names, `---` content lines after the first hunk are not
  mistaken for headers).
- Forges: `commentBodies` — GitHub inline comments, review summaries and conversation comments;
  GitLab notes; `per_page=100` pages until a short page (50-page cap).
- A finding goes on the first changed line of its symbol (head first, base for removed
  symbols); without one it is listed in the summary. Each carries
  `<!-- symbiote:finding <rule:symbol, URI-encoded, dashes too> -->`.
- If the forge refuses the inline comments, the same findings are posted in the summary, with a
  warning, so a CI job still reports them.

**Decisions**: 15 (what "already posted" means), 16 (where a finding goes).

**Learned**
- The viewer anchors comments on its jsdiff of symbol excerpts; the CLI has no browser and the
  repo at hand, so it asks git — the same diff the forges render. Exact, and no new dependency.
- GitLab's `CI_JOB_TOKEN` can read an MR but not post notes; CI needs `GITLAB_TOKEN`.

**Testing**: planning/anchoring/marker units on the detectors golden graph; full CLI runs
against mock GitHub and GitLab APIs that list back what was posted: posts once, the second run
posts nothing, the GitHub 422 fallback, and `--fail-on` still failing after posting.

**Phase 3 is done.** Next: phase 4 (interdiff, I1–I2), then phase 5 (CI on both forges, C1–C2).

## I1 — Review state per change request (2026-10-01)

**What landed**
- Reviewed marks are now `{symbol ID → fingerprint}` (signature + body hashes of both sides).
  A mark counts only while the fingerprint matches; otherwise the symbol is "↻ changed since you
  reviewed it" (Changes list, detail panel, a count above the list). Marks of symbols that left
  the change are dropped on the next toggle.
- Drafts record the symbol's fingerprint and where the symbol started. On a newer version of
  the change, a draft on an unchanged symbol moves with it (same line within the symbol); a draft
  on a changed or vanished symbol becomes "outdated" and goes into the review summary.
- State moved from browser storage into the CLI: `GET/PUT /api/state/review|drafts`, files
  under `<cache>/state/<repo id>/<sha256(change request URL, else revision pair)>/`, written
  atomically. The viewer saves marks at once and the summary text after a 300 ms pause, one
  write at a time per name, and flushes with `keepalive` on `pagehide`. A graph dropped into the
  viewer still uses browser storage.
- The write header is now `x-symbiote: 1` for every write (review and state).

**Found while testing**: every `symbiote view`/`symbiote pr` run listens on a new free port, and browser
storage is per origin — so V4's "remembers reviewed symbols" only ever held within one run.
The e2e test reloaded the same page, which hid it. The new e2e test restarts `symbiote pr` after a
push (new port) and checks the state is still there.

**Decision**: 17 (review state in the CLI's cache, per change request).

## I2 — `--since`: what changed between two versions of a change (2026-10-01)

**What landed**
- `analyzeGit({ since })` (all of `symbiote diff`, `view`, `pr`): after the main analysis, the
  earlier version merge-base(base, since)..since is checked out in the same slots and only
  extracted — same two-pass inference, no references or detectors. Each changed symbol gets
  `new` / `updated` / `same` by `changeFingerprint` (both sides' signature and body hashes, the
  string the viewer's I1 marks use); `dropped` lists symbols that version changed and this one
  doesn't. Extraction was split out of `analyzeSources` (`extractChanges`) for this.
- Graph schema 0.2.0: top-level `since {ref, sha, dropped}`, node `since`. Goldens differ only
  in the version.
- Summary: `since <ref> (<sha>): 2 new, 1 updated · 1 no longer changed: …` and `[status]` per
  symbol. `symbiote pr --since <sha>` fetches the sha from the remote when it is not local (protocol
  v2 serves reachable SHAs; forges keep old heads after force-pushes).
- Viewer: "Only changes since <sha>" (on by default) hides `same` symbols from the Changes list,
  and so from `j`/`k`, and dims them on the canvas; a chip sums it up; `new`/`updated` tags on
  nodes and in the panel.

**Numbers**: on this repo, G1→I1 (34 files, 123 changed symbols) compared with the G2 head: 54
new, 22 updated, 47 same, 4 dropped — exactly the helpers I1 deleted. 5.6 s → 8.7 s.

**Learned**: a leading comment added above a declaration leaves its hashes alone (tokens skip
trivia), so "added a file header" pushes show nothing new — checked in the e2e test.

**Phase 4 is done.** Next: phase 5 — CI for GitHub (C1) and GitLab (C2).

## C1 — GitHub Action (2026-10-01)

**What landed**
- `symbiote pr` with no number in CI: GitHub Actions' event file (`pull_request`,
  `pull_request_target`, `issue_comment` on a PR) or GitLab's `CI_MERGE_REQUEST_IID`.
- `action.yml` (composite): inputs `token`, `pull-request`, `post-findings` (default
  `warning`, empty = don't post), `fail-on` (default `error`), `project`, `depth`,
  `working-directory`, `setup-node`; output `graph`. Inputs reach the scripts through `env`,
  never interpolated into shell code.
- `action/install.sh` builds Symbiote from the action's own checkout with pnpm 12 via `npx` (the
  packages are not published): 8 s from a fresh clone here with a warm pnpm store.
- `action/run.sh` is shared with the coming GitLab template: deepens shallow clones (the
  merge-base needs history), builds the arguments, tees the summary, writes the step summary
  and the `graph` output, keeps symbiote's exit status.
- `.github/workflows/symbiote.yml`: this repo reviews its pull requests with `uses: ./`; fork PRs
  (read-only token) are reviewed without posting.

**Testing**: `run.sh` runs against a stub CLI that echoes its arguments (arguments, exit status,
step summary, output); the CI-number detection has unit tests and a `symbiote pr` run with a GitHub
event file. The action itself only runs on a real pull request, and none exist in this repo yet:
the first PR will be its first live run.

## C2 — GitLab CI template (2026-10-01)

**What landed**
- `ci/gitlab/symbiote.yml`: a hidden `.symbiote` job (node:22, `GIT_DEPTH: 0`, clones Symbiote at
  `SYMBIOTE_VERSION`, builds it with `action/install.sh`, runs the shared `action/run.sh`) and a `symbiote`
  job on `merge_request_event`. Code Quality report as an artifact report; `.symbiote/` (graph,
  summary) as a plain artifact.
- GitLab forge in CI: the API URL from `CI_API_V4_URL` when the remote is the job's own instance
  (custom ports and relative URLs); without `GITLAB_TOKEN`, the MR comes from the pipeline's
  `CI_MERGE_REQUEST_*` variables (merged-results pipelines name the source commit, others build
  it); commenting and reading comments say plainly that they need `GITLAB_TOKEN` and that the
  job token cannot comment.
- `--codequality <file>` on `symbiote diff` and `symbiote pr`: findings as Code Climate issues — severity
  error → critical, warning → major, info → info; location: where a removed symbol is still
  used, else the first changed line of the symbol; fingerprint from rule + symbol, so GitLab
  recognises the same issue across pipelines.

**Decision**: 18 (GitLab CI works without a token).

**Testing**: a full `symbiote mr` run in a simulated pipeline — the job token in the remote URL, no
`GITLAB_TOKEN`, an unreachable API — produces the summary and the Code Quality report with no
API request, and `--post-findings` fails with the token message. The template itself needs a
GitLab runner; its YAML is checked and its script is `run.sh`, which has its own tests.

**Phase 5 is done — the roadmap's five phases are complete.** PLAN lists proposed next steps
(P1 one program for both sides, C3 GitHub annotations for fork PRs, D1 detectors from dogfood).

## D1 — Detectors from real reviews (2026-10-01)

**What landed**
- `signature-changed` splits users into production code and tests (`isTestFile`: `*.test.*`,
  `*.spec.*`, `*.test-d.*`, `__tests__/`, `__mocks__/`, `test/`, `tests/`, `e2e/`). Only an
  untouched production user in another file makes it a warning — a stale test fails the test run
  by itself. Messages count test users apart (`2 of 2 users not updated · 1 test user`); data
  gains `tests` and `untouchedTests` (existing counts keep their meaning, tests included).
- New rule `exported-api-changed` (warning): a symbol exported from the entry of a published
  package (nearest package.json without `"private": true`) is removed, is no longer exported,
  or gets a `breaking`/`unknown` signature. Private class members (`private`, `#x`) are not API.
  A removal that `removed-still-referenced` already reports is not repeated. New adapter
  method `publicApi(revision, symbol)`, asked only for removed and modified symbols.
- Graph schema 0.3.0. New fixture `public-api`. Vitest no longer collects `*.test.ts` files
  inside test fixtures (the new fixture has one, as code under analysis).

**Dogfood** (last 12 TS commits each, before → after)

| Repo | Findings | Warnings | What changed |
|---|---|---|---|
| ky | 28 → 28 | 11 → 11 | One message now counts its test user apart: "2 of 2 users not updated · 1 test user" (was "2 of 3"). |
| zod | 4 → 6 | 3 → 5 | Two new `exported-api-changed`, both real: the revert of `z.currencyCode()` removes a public export; `ZodInstanceOf.properties()` got a stricter generic constraint (the commit says non-matching schemas now error). |
| vite | 3 → 3 | 0 → 0 | A helper used only by tests reads "(1 test user)". |

The test-user split dropped no warning in these 36 commits. On the commit behind V5's note
(zod 413cce9a) it does what it is for: `_properties` goes from warning to info ("its only user
was updated · 3 test users, 1 not updated"), and `$ZodTypes` lists its production users first
instead of `assignability.test.ts (top level)`. Warnings there: 3 → 2.

**Open**: removing only a re-export from the entry (the symbol itself unchanged) is not
detected; packages without a source entry (only `dist/` in `main`) have no public API for Symbiote.

## Angular 11 trial (2026-10-02)

Ran Symbiote on the Angular RealWorld example app at its Angular 11.2 state (TypeScript 4.1.5, 72 TS
files, dependencies installed with `npm ci --ignore-scripts --legacy-peer-deps` under Node 22):
it loads cleanly, ~3–4.6 s per commit, and its real Angular-11-era commits come out right
(e.g. "Fixed: Tag not saving" → `EditorComponent.submitForm (body)`). Found:
- **Templates are invisible**: a method used only from `(click)` is reported as an orphan; a
  method deleted while its template still calls it is not reported at all.
- **Class families**: `ngOnInit` "used by 11" (every component implements `OnInit`); a user's
  project showed the same for a property overridden from a shared base class. → R1.
- **Decorator metadata**: changing `@NgModule({...})` arguments warns "AppRoutingModule changed
  its signature; 1 of 1 user not updated: AppModule".
- `.symbioteignore` is read from the analyzed head commit, not the working folder, so an uncommitted
  file (or a diff of older commits) ignores it; `interfaces/` matches only at the root, unlike
  `.gitignore`.

## R1 — Receiver-aware references (2026-10-02)

**What landed** (branch `milestone/r1-receiver-aware-references`, merged into main after review)
- `incomingTs` judges every reference to a class member by the class of the object it is read
  from (`x` in `x.m`, the class for `this`): the member's class or a subclass → use; an ancestor
  class or interface → **possible** use; unrelated (a sibling) → dropped; unknown (`any`, no
  receiver) → kept. Union and intersection types count if any part relates; `this` and
  constrained type parameters stand for their constraint.
- Declarations the search returns: a subclass's direct override → `overrides` edge to the
  member; any other (the base declaration, a sibling's own `ngOnInit`) → dropped.
- `outgoingTs` adds the member's own `overrides` edges: to the base class member, to the interface
  (interface members are not nodes), or to a package member (`@angular/core#OnInit.ngOnInit`).
- Graph schema 0.4.0: edge kind `overrides`, edge flag `possible` (every site possible). The
  viewer's detail panel labels such neighbours "· possible".

**Golden graphs**: one real change — `Tool.use → Pen.use (reference)`, the abstract base method
listed as *using* its implementation, became `Pen.use → Tool.use (overrides)`.

**Before/after** on 29 comparisons (6 commits each of ky, zod, vite; the Angular app's 8 commits
and 3 experiments): 957 → 932 edges, 29 dropped, 4 `overrides` added, 2 marked possible, **0
findings changed**. Every dropped edge was inspected: ky's sibling error classes' own `name`
declarations (7), and the Angular app's sibling `ngOnInit` declarations (2 × 11). zod and vite
were unaffected in these ranges.

**Not done**: templates, `.symbioteignore` location, `interfaces/` matching, decorator-only changes
(see the Angular trial above).

## Fix — diff colours across the full line (2026-10-02, branch `fix/diff-row-width`)

Reported from a real review: in the detail panel, a long line made the code scroll sideways and
the green/red row colour stopped at the panel's edge. Rows were as wide as the visible box, not as
the code. They now sit in a wrapper `width: max-content; min-width: 100%`, so every row spans the
longest line. An e2e test opens the panel in a 700 px window and checks each row is as wide as the
scrollable content (it failed before: 280 px rows, 447 px of code).

## Angular templates spike (2026-10-02)

Groundwork for A1–A2 (PLAN), on branch `milestone/a1-angular-templates`. Nothing in Symbiote changed.

**Parser**: `@angular/compiler` 21.2.25 (`parseTemplate` + `R3TargetBinder` with a
`SelectorMatcher` of repo directives) runs standalone under Node 22. On one template mixing
`*ngFor`, `let-`, `#ref="ngModel"`, `[(ngModel)]`, `@if`, `@for`, `@let`, `@defer` and pipes it
told every component member apart from template locals, matched elements and attributes to
directives, mapped input and output bindings to their fields, and gave exact line:column for each
name (inline templates too, with the `range` option). Quirks: `$event` reads as a component name
and must be special-cased; a `*ngFor`'s bindings are visited twice (deduplicate by site); a broken
expression still yields the rest of the template.
- Literal `@` in text (`team@example.com`) parses with block syntax on.
- **Hang**: block syntax on with `@let` off loops forever on `@let x = 1;`. Use both on (Angular
  ≥ 17) or both off.
- 22.x requires Node ≥ 22.22.3 (Symbiote: 22.12); 21.x accepts `^22.12`. Import: 77 ms.

**Counts** (all templates of one checkout; "only by templates" = members whose name no TS file
reads as `.name`, so approximate):

| | RealWorld `994e00b` (Angular 11.2) | RealWorld `3c5b7ac` (Angular 21.2) | Bitwarden clients (Angular 21.2) |
|---|---|---|---|
| TS files / components | 70 / 18 | 48 / 18 | 6,411 / 1,188 |
| External / inline templates | 18 / 0 | 10 / 8 | 780 / 396 |
| Parse errors | 0 | 0 | 0 |
| Component members read | 128 | 112 | 10,368 |
| Template locals read | 13 | 43 | 4,159 |
| Chains past the first name | 64 | 63 | 5,905 |
| Elements matched to repo components | 20 | 23 | 9,545 |
| Input / output bindings to repo directives | 26 / 7 | 30 / 8 | 4,060 / 522 |
| Pipe uses (repo pipes) | 4 (1) | 13 (6) | 6,485 (5,732) |
| Members used only by templates | 19 | 21 | 1,808 |
| Parse + bind, all templates | 103 ms | 100 ms | 1,794 ms |

In RealWorld, the template-only members are nearly every event handler (`submitForm`,
`toggleFavorite`, `deleteComment`, …) and the observables read with `| async`.

**Shims**: a ts-morph project on disk plus one in-memory file holding
`function __template(this: FooComponent) { … }`: `findReferences` returned the shim's sites for a
base class method called as `this.save()`, a service method reached as `this.auth.isLoggedIn()`,
and a method called on a `for…of` loop variable; `this.gone()` had no symbol and a `FooComponent`
receiver, which is what `danglingTs` reports as a certain removal.

**Symbiote today on RealWorld commits that touch templates** (no dependencies installed):

| Commit | Findings | Why they are wrong |
|---|---|---|
| `438e991` (14 templates), `c80e51b` (2) | none, 40 ms: no file is analyzable | templates changed |
| `857a75e` | orphan `authState$`; `HeaderComponent` signature changed | read by its template; `imports` edit |
| `5467760` | `ProfileComponent` signature changed | `imports` edit |
| `df9d5dc` | orphan `ifAuthenticated`, orphan `ngOnInit`; 3 components' signatures changed | `*ifAuthenticated`; `OnInit` unresolved without dependencies; `imports` edits |
| `51c4afd` | orphan `articleInput`; 38 info `signature-changed` | bound as `[articleInput]` in `ArticleListComponent`'s inline template |
| `2faae23` | none | `MarkdownPipe.transform` became async and its template added `\| async` |

## Plan revised: Angular as a plugin (2026-10-02)

Direction from review: Angular support must be a plugin of the CLI, and the TypeScript/JavaScript
analysis must keep working on its own, without it. The A1–A2 plan put template shims, `.html`
relevance, the Angular decorator split and lifecycle exposures inside the TypeScript adapter. It
now starts with **X1 — Plugins**: generic hooks on the TypeScript adapter (`applies`, `matches`,
`virtualFiles` with position maps, `extract`, `decoratorArguments`, `exposure`), plugins turned on
with `--plugin` or `symbiote.config.json` (read from the working folder), resolved by name or path,
isolated on failure. A1–A2 become `@symbiote/plugin-angular` on those hooks; `@symbiote/core` and
`@symbiote/cli` never depend on Angular, and without the plugin every result stays byte-identical,
Angular repos included. Decision 24 records it.

## X1 — Plugins (2026-10-02, branch `milestone/x1-plugins`)

**What landed** (reviewed and merged with PR #1)
- `@symbiote/core` exports the plugin contract (`TsPlugin`, `PLUGIN_API_VERSION` = 1) and
  `createTypescriptAdapter({ plugins })`; `typescriptAdapter` is that factory with no plugins.
  Hooks: `applies`, `matches`, `virtualFiles` (with `map` back to owner and real site),
  `extract`, `decoratorArguments`, `exposure`, `warnings`.
- Core uses them generically: virtual files join the program before the language service
  starts; reference search, outgoing scans and dangling detection map positions inside them back
  to the template (or whatever the owner is); declarations inside them are never edge targets.
  Claimed decorators hash their arguments by role. Exposure `framework` is skipped by
  `orphan-added`. Schema 0.5.0: kind `template`, top-level `plugins`.
- CLI: `--plugin` on diff, view and pr; `symbiote.config.json` (`{ "plugins": [...] }`) at the repo
  root of the working folder; `angular` → `@symbiote/plugin-angular`, `.`/`/` → a path; the project's
  copy first, then the CLI's. Clear errors for a missing package or file, another API version,
  a module without a plugin, a broken config. Hint on Angular repos with changed `.html`.
- CI: action input `plugins`, GitLab variable `SYMBIOTE_PLUGINS` → one `--plugin` each.

**Test plugin**: a made-up framework (`@View({ template: './card.tpl', tags })` classes and
`{{ expression }}` templates), ~200 lines, uses every hook. With it on the fixture: the template
is a symbol modified by the edit, with edges at `.tpl` lines; removing `Card.reset` while the
template still calls it is an error from `src/card.tpl#(template)` at `card.tpl:4:22`; `double`
(template only) and `onStart` (framework) are no orphans; a `tags` edit is a class body change.
Without it, the same change gives 2 false orphans and a false `signature-changed` — the Angular
pattern in miniature.

**No-plugin check**: goldens changed only `schemaVersion`. The 29 R1 comparisons (6 commits
each of ky, zod and vite, 8 Angular app commits and 3 experiments) give byte-identical edges
(932) and findings (11) on `main` and on X1. The Angular app's template commit prints
`hint: Angular project: add --plugin angular to analyze templates` once.

**Learned**
- Plugins must use the adapter's TypeScript (`PluginContext.ts`): a second copy would make
  `ts.isIdentifier` and friends disagree about nodes from the program.
- Hooks as function-typed properties, not methods: plugins should not depend on `this`, and the
  lint rule for unbound methods agrees.
- A failed plugin must also stop mapping its shims, or references keep pointing at symbols its
  failed `extract` never produced.
- Node-style specifiers: a path starts with `.` or `/`; anything else (including `@scope/name`)
  is a package.

**For A1**: an unresolved call inside a shim is labelled with shim text (`unknown:this.reset`);
the summary and viewer show template names as `(template)` — both want template-aware labels.
`@symbiote/plugin-angular` must be a dependency of the CLI to be found "next to symbiote".

## A1 — Angular plugin: templates see their component (2026-10-02, branch `milestone/x1-plugins`)

**What landed** (on the X1 branch, as asked; merged with PR #1): `@symbiote/plugin-angular`, loaded with
`--plugin angular`. Templates become TypeScript shims (`this` is the component) in the analyzed
program, so TypeScript's own reference search, R1's family filter, inherited members, chains
and dangling detection cover them unchanged. Template symbols (`x.html#(template)`, inline
`X.(template)`), the decorator split (selector/inputs/outputs/exportAs signature, the rest body,
the inline template neither), `framework` exposures (templates, lifecycle hooks, host members,
pipe `transform`), template labels in findings, summary and viewer. Details and numbers: PLAN,
"A1 results" and "A1 as built".

**Results in short**
- RealWorld: 8 false warnings on 4 commits → 0 (A1's share); template-only commits analyzed; a
  real bug (`@for` without `track`) reported on the commit that introduced it. Three
  experiments (removed method, renamed member in an inline template, new required parameter)
  all caught; all three missed without the plugin.
- Bitwarden (1,188 templates): +7.5 % time on 7 commits; 12 findings gone, all checked false;
  none new; template-only commits analyzed instead of skipped.
- Without the plugin: nothing changed (goldens, the 29 R1 comparisons).

**Learned**
- `preserveWhitespaces: false` shifts interpolation offsets (the text is rewritten): parse with
  whitespace kept, normalize for the hash.
- Inline templates parse in place with `range` + `escapedString`: spans are then `.ts` offsets,
  escapes included.
- The parser can throw (a bad range gave `RangeError: Invalid code point NaN`): every parse is
  guarded.
- The binder resolves template variables, references and `@let`, but not arrow-function
  parameters or `$event`.
- `<x></x>` → `<x />` is no change to Angular; 4 of the 14 templates of the control-flow commit
  changed only that, so "10 modified" is right where the plan expected 14.
- A generic component needs `this: X<any>` in its shim; without type arguments the whole
  template resolved to nothing (found on Bitwarden: `rowHeight` read by a template looked
  unused).
- Shims can only import exported classes; tests and stories often don't export their hosts
  (268 in Bitwarden). Skipped; warned about only elsewhere.
- Base and head warnings were merged; a warning only base has now reads `in base: …`, so a
  problem the change fixes doesn't read as one it brings.

**Next (A2)**: repo components, directives and pipes used by templates (selectors, inputs,
outputs, pipes, `exportAs`), which also explains the remaining `ifAuthenticated`/`articleInput`
orphans and links `MarkdownPipe.transform` to its template.

## A2 — Angular plugin: templates see other components (2026-10-02, branch `milestone/x1-plugins`)

**What landed**: the plugin reads the repo's directives, components and pipes (selectors,
inputs and outputs in every form Angular 11–21 writes them, aliases, inherited inputs) and
binds templates with Angular's own `SelectorMatcher`. Shims reference what an element matches,
set inputs on it, subscribe to its outputs, type `#ref="exportAs"` locals and call repo pipes'
`transform`; TypeScript's reference search then links templates to them like any code. Two X1
additions: a `dangling(head, removed, base)` hook, and `possible` in a virtual file's map.
Details and numbers: PLAN, "A2 results" and "A2 as built".

**Results in short**: on the fixture, five kinds of template breakage caught that nothing caught
before; on RealWorld, the last two false warnings gone and two more experiments caught; on
Bitwarden, +18.7 % time (budget 20 %), the same findings as A1, and template edges into other
components' files (94 in one commit).

**Learned**
- A rename is a move to Symbiote (same body, new name), and nothing checked the *old name* of a moved
  symbol: a caller left on it was silent — in plain TypeScript too. Found by the A2 experiment
  "rename an input a template still binds"; fixed in core for every language: old declarations
  of moved symbols are checked like removed ones.
- Removed components and inputs cannot be found by name in head: their selector or binding
  matches nothing there. The plugin needs base to know what `<app-badge>` was — hence the
  `dangling` hook with both revisions.
- `@Output() x` and `output()` are listened to with `(alias)`; listening to a removed one is
  accepted by Angular and silently dead, so it is a warning, not an error.
- Plugins cache per revision by the context's functions; core handed them a new context after
  building the program, so every class was scanned twice per side. One context per revision now.
- Timing on a shared machine needs back-to-back runs: comparing against an earlier baseline read
  +26 %, interleaved +18.7 %.

**Not done (later)**: library directives and pipes (`ngModel`, `routerLink`, `| async`,
Material) from their `.d.ts` metadata; NgModule and standalone scopes; host directives;
`ngTemplateContextGuard` types for `let-` variables.

## Merged: X1, A1–A2 (2026-10-02, PR #1)

X1, A1 and A2 went into main as one pull request (`milestone/x1-plugins`, 10 commits), after
review. It was the repository's first pull request, so the first run of its own Symbiote review
workflow:

- **The action failed before Symbiote ran**: `actions/setup-node@v5` enables caching for the package
  manager `package.json` names (`packageManager: pnpm@…`) and fails when that manager is not
  installed yet ("Unable to locate executable file: pnpm"). Any project with a `packageManager`
  field would have hit it. Fixed in `action.yml` with `package-manager-cache: false` (Symbiote
  installs its own pnpm). The action's tests run `run.sh` only, so only a real workflow run
  could show it.
- **Then Symbiote reviewed itself**: no errors, 3 `signature-changed` warnings posted as review
  comments, on `LanguageAdapter` (the new `base` parameter of `dangling`), `Exposure`
  (`framework`) and `SymbolKind` (`template`). Each was checked: the code that calls or branches
  on them was updated in the same change; the "users not updated" only hold or carry the type.
  Answered and resolved; no code change. A known limit of `signature-changed` on widened types
  and interfaces: it cannot tell a user that passes a type along from one that depends on its
  exact members.


## Fix — `.symbioteignore` from the working folder, with gitignore's rules (2026-10-02, branch `fix/symbioteignore`)

Both found in the Angular 11 trial, where `interfaces/` in a `.symbioteignore` did not ignore the
nested `interfaces` folders of a monorepo:

- **Where it is read**: `analyzeGit` read `.symbioteignore` from the checkout of the analyzed head
  commit, so an uncommitted file — or a diff of two older commits — went by another file or none.
  It is now read from the working folder's repository root (like `symbiote.config.json`) and passed
  to the analysis as an `ignore` matcher (`LoadOptions.ignore`, used for both the changed-file
  filter and the program's file list). Comparing two folders still reads the head folder's.
- **How it matches**: a pattern ending in `/` was anchored at the root (`interfaces/` became
  `interfaces/**`, then "contains a slash"), and a leading `/` was stripped and then matched at
  any depth — both the opposite of git. Now, as in git: only a `/` at the start or in the middle
  anchors; `dir/` matches folders only; a pattern matches a path or any folder above it, so
  `secrets` also ignores `secrets/key.ts`.

Tests: 11 gitignore cases, and an `analyzeGit` test where the committed `.symbioteignore` says one
thing and the uncommitted one another (4 of them failed on the old code). The CLI on a nested
monorepo, with an uncommitted `.symbioteignore` and a diff of older commits, lists both `interfaces`
files as `(ignored)`. The 29 R1 comparisons (no `.symbioteignore` in those repos) are unchanged.

## P1 measurement — where load time goes (2026-10-02, branch `milestone/p1-shared-parsing`)

CPU profiles (inclusive time per phase) and file counts of one commit each; times are warm
(files in the OS cache), profiles inflate absolute numbers but not the shares.

| | vite `24bd3316f` | zod `f448c44d` | Bitwarden `55465e2` |
|---|---|---|---|
| Run (no profiler) | 6.4 s | ~4 s | 25.8 s |
| Loading both revisions | 66–70 % | 62 % | 79 % (12 s per side) |
| Parsing | 35 % | 26 % | 19 % |
| Binding (type checker setup) | 15 % | 10 % | 9 % |
| Module resolution | 7.5 % warm (28 % cold: `package.json` reads from disk) | 3 % | 13 % (136k `stat` calls) |
| ts-morph bookkeeping (adding files, normalizing paths) | 12 % | 4 % | ~18 % |
| Symbiote's own analysis (extract, references, detectors) | 4 % | 2 % | 4 % |

**What the two programs share** (files of head, compared with base):

| | vite | zod | Bitwarden |
|---|---|---|---|
| TypeScript lib files (same path and text) | 93, 0.23 s to parse | 89, 0.23 s | 52, 0.29 s |
| `node_modules` declarations (same path and text: linked folder) | 655, **1.25 s** | — | — (not installed) |
| Project files (same text, **different path**: separate worktrees) | 183 of 184, 0.34 s | 515 of 516, 0.51 s | 6,159 of 6,160, **4.2 s** |

**Learned**
- Symbiote's own work is 2–4 % of a run; loading is two thirds or more. P1 is the right lever.
- A first profile blamed module resolution (5.5 s on vite): that was a cold disk. Warm, it is
  7.5 %. Measure twice.
- Every file is read and parsed once per revision; nothing is shared. ts-morph keeps a private
  cache per project and offers no way to share one; TypeScript's own way is a shared
  `DocumentRegistry` across language services (what tsserver does), keyed by path.
- Sharing by path covers lib and `node_modules` files (vite: 81 % of parsing) but not project
  files, whose paths differ between the two worktrees — and those are most of Bitwarden and zod.
  One program for both sides (option A) would not share them either.

**Decision**: not pursued. Sharing lib and `node_modules` files (B1) means replacing the ts-morph
loader for ~15–30 % on projects with installed dependencies; sharing project files too (B2) adds
a virtual-path layer. The user judged the gain too small for the risk. The measurement stays as
the baseline for a later TS 7 adapter.

## A3 — Angular library components, directives and pipes (2026-10-02, branch `milestone/a3-angular-libraries`)

Templates now see what Angular and its libraries provide, read from the typings of installed
packages: `AsyncPipe`, `NgModel`, `RouterLink`, Material and the rest join A2's registry, the
shims import them from their entry point, and TypeScript does the rest — `x$ | async` has
`transform`'s return type, library outputs type `$event`, `#f="ngForm"` is an `NgForm`, and every
use is an edge into the package.

**Formats** (checked on real installs before writing the reader): Angular 12+ partial
declarations (`ɵɵDirectiveDeclaration<…>`, inputs as `{ "alias": … }` since 16), ngcc's
`ɵɵDirectiveDefWithMeta<…>` (Angular 9–11 after `ng build`, typings rewritten in place, inputs as
plain strings) and View Engine `metadata.json` (Angular 9–11 before ngcc). Angular 21 ships its
classes in chunk files (`types/_common_module-chunk.d.ts`) declared without `export` and exported
at the end, re-exported by the entry point, some only as `ɵName`.

**Learned**
- Typings list a class's **own** inputs only: Material's `MatButton` declares one, its base
  `MatButtonBase` seven. The reader follows `extends`, into other packages too (`MatTable` extends
  CDK's `CdkTable`).
- A monorepo's path aliases are bare specifiers: Bitwarden imports 1,115 of them, 94 from
  installed packages. TypeScript's resolver spent 415 ms failing on the rest; checking first
  whether the package folder exists anywhere above the importer brings it to 43 ms.
- Re-exports re-read their chunk file per name until reads were memoized per revision
  (RealWorld: library scan 134 + 83 ms → 65 + 11 ms for base and head).
- Implicit directives are real: `<form>` matches `ɵNgNoValidate` and `NgForm`, an
  `<input formControlName>` `DefaultValueAccessor` and `NgControlStatus`. They show up as edges
  into `@angular/forms`, and, as with A2, matching is global (no NgModule/standalone scopes).
- An interface's members are part of the interface for Symbiote, in TS code and templates alike: the
  RealWorld experiment (a `User` field read through `currentUser$ | async`) changes nothing
  because `User` is an interface. Bitwarden's `Organization` is a class, and there the stale
  template read is caught.
- **A core gap**: a `node_modules` that is itself a link was not linked into the analyzed
  checkouts, so with such an install Symbiote saw no dependency types at all. Found because the test
  installs were links; fixed in `linkNodeModules`, with a test.
- Nothing is read when dependencies are not installed (CI without `npm ci`): results are A2's.

**Verification**: fixture `libraries` (3 tests, one per metadata form plus not-installed); the
whole suite; RealWorld (Angular 21) and the Angular 11 project before and after ngcc (same 16
library edges both ways); the Bitwarden rename experiment (A3 ✖, A2 nothing); Bitwarden timing
on 10 commits, A2 and A3 back to back with the Angular packages installed: +2.3 % in total, the
same findings on all 10, 150 edges into libraries. Without the plugin, the 29 R1 comparisons
are unchanged (932 edges, 11 findings).

Merged into main (2026-10-02).

## V6 — A graph you can navigate (2026-10-02, branch `milestone/v6-navigable-graph`)

Reported on a real project: "I can't navigate through it" — not slowness. Measured on Bitwarden
with the Angular plugin: one commit with 86 changed symbols drew 1,288 symbols in 509 boxes, as
a 9,470 × 85,468 px strip; every selection and reviewed mark re-ran the whole layout (1.2–1.8 s).

**Learned**
- 94 % of the drawn symbols were unchanged neighbours, mostly from a few hubs: one changed enum
  with 390 users, a constructor with 385 dependencies, templates using ~100 things each. The top
  five hubs brought 733 of 1,202 neighbours; most changed symbols have 5 or fewer. Grouping a
  side with more than 8 into one node cut the view to 168 symbols + 29 groups.
- The strip came from dagre stacking every disconnected part in one column; packing clusters
  into rows fixes that, but a large change is mostly one connected cluster (57 of 59 boxes), so
  its overview can't be read at text size anyway. Hence a map mode instead of more layout work:
  file names readable at any zoom, click to zoom in.
- The layout memo depended on `selected` and `reviewed`: fixed by splitting layout from
  decoration, which also keeps everything still while reviewing.
- Bugs found in the browser, not in unit tests: the selection half under the detail panel (the
  pan ran before the canvas narrowed); an opened group off screen; file names on the map
  catching clicks meant for the box below. Tests that counted nodes in the page broke once only
  on-screen nodes are drawn — the minimap still draws them all.

**Verification**: viewer unit tests 44/44, e2e 14/14, typecheck, lint; Bitwarden graphs measured
before and after in Chromium (first paint 4.0 → 0.65 s, mark reviewed 1.2 s → 72 ms, page
elements 22,966 → 3,937 on `737ee3f`), screenshots of the map, a zoomed file and a selection.

Merged into main (2026-10-03).

## W1 — Repositories with several projects (2026-10-03, branch `milestone/w1-multi-project`)

Reported: "Symbiote does not render any HTML templates in my app" — an Angular 11 app two folders
below a repo root with nothing Angular (or TypeScript) in it, next to a second app. Reproduced
with an Angular 11 fixture moved into a subfolder and an HTML-only change: the `.html` file was
listed as changed, no template analyzed, no warning.

**Learned**
- Three things were decided once, at the root: whether the Angular plugin applies, which Angular
  version (and so which template syntax) the repo uses, and which compiler options every file
  gets. Without a root `tsconfig.json`, nested configs were loaded with defaults, so `@app/…` and
  `baseUrl` imports resolved nowhere — in plain TypeScript too. Merging all projects' `paths`
  cannot work: two apps map `@app/*` to different folders.
- ts-morph's `resolutionHost` gets the importing file, and its resolver is used by both the
  program and the language service: per-file options fix resolution without splitting the
  program. It only offers TypeScript's older callback (no ESM/CJS mode), so Symbiote computes the mode
  itself, and the hook is only installed when a project's aliases differ from the root's.
- Angular keeps its build options in `tsconfig.app.json` (Angular 6–11: `src/tsconfig.app.json`
  with `baseUrl`), a file Symbiote never read. Config choice now follows the build, not the editor.
- Verification found what the plan missed: on a replica (RealWorld at Angular 11 and 21 as two
  apps), 38 template edges went from one app to the other's components — both apps have
  `app-article-preview`, and A2 matches selectors repo-wide. Templates now see the components of
  their own Angular workspace (`angular.json` folder) and of shared code outside every workspace.
- Hand-written expectations of template columns were off by one three times; the tests now carry
  values checked against the template text, not counted in my head.

**Verification**: core and Angular fixtures (red before, green after), CLI hint test (fails on
the old code), full suite 293+ tests; 29 R1 comparisons identical; replica 0 → 13 templates,
0 cross-app edges; Bitwarden (per-project resolution on: its test runner has its own `paths`):
10 commits with every edge, finding and warning identical to `main`, no slowdown.

Merged into main (2026-10-03).

## Change-list search (2026-10-03, branch `claude/change-search`)

With hundreds of changed symbols, finding one meant scrolling the Changes tab. A search box at
its top now keeps the symbols whose file path and name hold every word typed (ignoring case; a
word matching the file keeps all its symbols). `/` focuses it, Enter opens the first match, and
j/k walk only the matches — so the tab and the query moved from `Sidebar` up into `App`.

**Learned**: the commit was made by an automated step in this session (branch switch and commit
in the same second) and left the shared checkout on its branch; check `git branch --show-current`
before assuming the checkout is on `main`.

**Verification**: `pnpm check` (295 tests), build, 28 e2e tests including the new search test in
`large-graph.spec.ts`. Fast-forwarded into main (2026-10-03).

## Qwik spike (2026-10-03, branch `milestone/q1-qwik`)

Groundwork for Q1–Q2 (PLAN). Nothing in Symbiote changed.

**What Symbiote does today** on a scratch app with the real typings (`@builder.io/qwik` and
`qwik-city` 1.20.1, checked by `tsc`): JSX elements are calls, `component$` bodies and `$`
handlers fold into the component, a required prop added to an inline props type warns with the
page that does not pass it. Wrong: router-called exports (`onGet`, `onRequest`, `head`, loaders,
actions, a loader re-exported by a route) are orphans; an optional prop added warns (a
`component$` variable has no shape, so its type text is compared: `unknown`); a required member
added to a named `CardProps` is only ℹ on the interface, since `Component<CardProps>` does not
change and JSX sites never name it.

**Qwik's docs site** (`QwikDev/qwik` `packages/docs`, Qwik 2 RC; 30 latest non-merge commits
touching its routes' TS files; blobless clone, no install): 9 `orphan-added`, 7 false — 5 router
exports (`head` ×2, `default` ×3), 1 component rendered only from `.mdx`, 1 MDX provider named
in `vite.config.ts`. The 2 right ones are tutorial code whose only use is commented out.

**Route rules**, read in Qwik's own Vite plugin (`getSourceFile`, `walkServerPlugins`):
1.20.1 and 2.0.0-rc.0 agree on `index`/`layout`/`plugin`/`entry`/`service-worker` names and
extensions; error pages differ (1.x any `400`–`599`, 2.x `404` and `error`). Server plugins are
read from one folder, not recursively. The request handler reads `onRequest`…`onOptions`,
`head`, `default`, `onStaticGenerate`, and (2.x) `routeConfig`, `eTag`, `cacheKey`; loaders and
actions are collected from every export of a page or layout module by their `__brand`.

**MDX** on the docs site: 243 `.mdx` routes, 144 with imports (347 lines, 372 names), 575
elements whose tag is an imported name (2 more inside code fences); 138 imported names are not
tags, mostly images in `src={…}`. A line scanner finds what the plugin needs; checking it
against `@mdx-js/mdx` is part of Q2's verification.

## Q1 — Qwik routes and components (2026-10-03, branch `milestone/q1-qwik`)

A new package, `@symbiote/plugin-qwik` (`--plugin qwik`), and two generic core changes it needs: an
optional `contract` hook (a framework call's value → what its users pass) with `Shape.inputs`
compared from the callers' side, and a plugin's exposure replacing the adapter's "default export,
loaded by convention?" guess.

**Learned**
- A named props type changes without its component's code changing (`CardProps` gains a member,
  `Card` stays as written). Contracts limited to changed symbols, as planned, would never see it:
  the syntactic pass decides which symbols get a second look. Props come from the types written
  in the code, so computing them in both passes costs little and needs no installed Qwik.
- `typeToString` prints a union's members in type-creation order, which differs between two
  programs: `'primary' | 'plain'` came out reversed once. Input types are now the tokens of their
  declared type (as interface members always were); the checker's text only where none exists.
- On Qwik's docs site a removed *optional* prop (`Header`'s `mobileSidebarOpen`) warned about 9
  untouched `<Header />` users — none of which passes it. Breaking for a component means
  breaking for the JSX that passes (or misses) a prop, so JSX references now carry their
  attributes and only users that pass a removed or retyped prop, or miss a newly required one,
  count. Generic: any plugin's inputs get it.
- Qwik's own e2e apps have a `package.json` without dependencies and take Qwik from the monorepo
  root: "nearest `package.json` naming Qwik" put their routes at the root's `src/routes`. A
  project is now its package (nearest real `package.json`), with Qwik named there or above.
- The fixture typings mirror the real ones where it matters (`Loader` declared as `Loader_2`,
  `Component<P>` an alias); `tsc` reports the same 3 errors with them as with the real 1.20.1
  typings.

**Verification**: 76 new tests (plugin fixtures with and without typings, Qwik 2 in a subfolder,
38 file-rule cases, core contract and per-site cases, CLI hints), red before; full suite 371
passing. `--plugin qwik` on the core fixtures and next to `angular` on the Angular fixtures:
identical analyses. Qwik docs site, 30 commits: without the plugin identical to `main`; with it 5
false findings gone, no new warning, 6 new ℹ (real props changes), +3.9 % time.

Merged into main (2026-10-03), with Q2.

## Q2 — Qwik MDX routes (2026-10-03, branch `milestone/q2-qwik-mdx`)

`.mdx` files under a Qwik app's routes folder become templates: a shim per file renders its
component elements (self-closed) and expressions under its own imports, mapped back to `.mdx`
lines, so removed components, props pages do not pass, and components only pages use are seen.

**Learned**
- MDX's ESM rule is stricter than "a line starting with import": the keyword needs a space after
  it and cannot continue a paragraph. Qwik's API pages have `import("@qwik.dev/core").JSXOutput`
  at line starts; the first scanner read those as ESM. Frontmatter sits right before the imports,
  and fences inside list items are indented 4+ spaces. With those rules the scanner and
  `@mdx-js/mdx` agree on all 243 routes of the docs site.
- MDX rejects JS comments in JSX tags, and TSX accepts every valid MDX element tried: the
  "element that does not parse" case only protects against scanner mistakes.
- Find-references follows imports and aliases but not a shorthand property to its uses: routing
  provided components through `useMDXComponents()`'s return value type-checked their props but
  hid the page as a user. Reading the provider by syntax and importing each provided component
  into the shim fixed it.

**Verification**: scanner and shim unit tests (frontmatter, fences, inline code, escapes, ESM
rules, unclosed elements, mapping, the parse fallback), the `qwik-mdx` fixture (red before),
the viewer test `qwik.spec.ts`, Qwik docs site: without the plugin identical to
`main`, with it 7 false findings gone (`head` ×2, route `default` ×3, `BenchmarkTable`,
`useMDXComponents`), both right `Repos` kept, no new warning; +3.7 % time. Full suite: 377 unit
tests, 29 browser tests.

Merged into main (2026-10-03).

## Fix — a doc-comment reference crashed the analysis (2026-10-03, branch `fix/jsdoc-reference-crash`)

Found while measuring Bitwarden for V7: 5 of 8 runs crashed. Q1's per-site props check reads the
parent of a reference's node, and `findReferences` returns `{@link Class.member}` in a JSDoc
comment at a node without a parent. Such a reference is no JSX use: what it passes is unknown,
as for any non-JSX reference.

**Verification**: a test with a resolving `{@link Badge}` (red before: the same `TypeError`); the
29 R1 comparisons identical to W1's baseline (932 edges, no finding changed); the 8 Bitwarden
changes complete; full suite 378 tests, 29 browser tests.

**Learned**: Q1 changed core's references but its checks were the fixtures and Qwik's docs site.
Every core change re-runs the 29 comparisons and Bitwarden from now on.

Merged into main (2026-10-03).

## V7 spike — apps in the graph (2026-10-03, branch `milestone/v7-app-boundaries`)

Asked whether the viewer shows where one app ends and the next begins: it does not (file boxes
by path, placed by calls; a flat change list; no project in the graph JSON). Groundwork for V7
(PLAN); nothing in Symbiote changed on this branch.

**Measured** with the viewer's own layout on 8 Bitwarden changes chosen for touching several
projects and on Qwik's monorepo: a Bitwarden view holds 4–16 projects, 16–45 % of its drawn
edges cross projects, and a third to two thirds of those projects hold only unchanged
neighbours; Qwik's projects are islands (no drawn edge between them). Both need each project in
one place, light frames for context-only projects, and a layout that keeps cross-project edges
short where there are many.

**What a project is** is less obvious than "the nearest `package.json`": Bitwarden's desktop app
has its Electron manifest at `apps/desktop/src/package.json` and the browser app a
`lit-components` package inside it (both would split their app); `bitwarden_license/bit-*` have
no `package.json` or Nx file, only a `tsconfig.json` (and a path alias); `bit-web` is declared
only in `angular.json`. Declared projects first (workspaces, Nx, plugins), packages when nothing
is declared, tsconfig-only folders outside every project, the root last.

**Found on the way**: 5 of the 8 Bitwarden runs crashed. Q1's per-site props check read the parent
of a reference's node, and `findReferences` returns `{@link Class.member}` in a JSDoc comment at a
node without one. Fixed on `fix/jsdoc-reference-crash` and merged into main (see "Fix — a
doc-comment reference crashed the analysis" above).
Q1's verification had re-run the Qwik docs site and the fixtures, not Bitwarden or the 29
comparisons after changing core's references — they are part of every core change's checks
from now on.

Merged into main (2026-10-04).

## Working rules for Claude Code (2026-10-03, branch `chore/agent-guidance`)

Asked where the session's learning is kept: only in the repo. The docs held *what* was learned,
but not *how* work is done here, and the real-repo checks lived in a scratch folder that dies with
the container. Now:

- `CLAUDE.md` at the root (what Symbiote is, commands, code and test rules, how to verify each kind of
  change, the milestone and merge workflow, environment traps) and one per package
  (`core`, `viewer`, `plugin-angular`, `plugin-qwik`), loaded when working there.
- Skills in `.claude/skills/`: `milestone` (with the PLAN section template), `regression-check`,
  `framework-plugin`, `viewer-check`.
- `scripts/regression/`: the comparison sets with pinned commits (`r1`: the 29 R1 comparisons;
  Bitwarden ×10 and ×8 multi-project; Qwik's docs site ×30), `setup.mjs` (blobless clones; the 3
  RealWorld experiments, which existed only locally, recreated from patches), `run.mjs`,
  `compare.mjs`. `scripts/viewer/measure.mjs`: first paint, select, review and pan timings and
  screenshots on any graph JSON.

**Learned**: totals depend on whether the clones have `node_modules` — fresh clones give 927 edges
on `r1` where W1's installed clones gave 932 (ky and RealWorld differ, vite with its install does
not). Only runs on the same clones compare. The first run on new clones also creates Symbiote's
worktrees (159 s, then 92 s): time warm runs only.

**Verification**: `setup.mjs r1` from scratch (clones, patched branches); `r1` on `main` and on
this branch: identical (29 comparisons, 927 edges); `compare.mjs` on a doctored result shows a
dropped edge, a new finding and an error; the `qwik-docs` set with the plugin: the same findings
as the CLI's earlier run on all 30 commits, no error; `measure.mjs` on two Bitwarden graphs
(`737ee3f`: first paint 1.1 s under load, no page error).

Merged into main (2026-10-03).

## V7a — Projects in the graph (2026-10-03, branch `milestone/v7a-projects-in-graph`)

The graph JSON now says which app or library each file belongs to (`projects`, schema 0.6.0),
by the rules the V7 spike measured: declared projects (workspaces, Nx, plugins), packages when
nothing is declared, tsconfig folders, the root. The Angular plugin declares `angular.json`'s
projects through a new optional hook. Nothing in the viewer yet (V7b).

**Learned**
- The workspace glob reader turned `libs/**/*` into "at least one folder between": it never
  matched `libs/common`, so none of Bitwarden's direct `libs/*` packages were workspace members —
  for the TypeScript adapter's package mapping either. `**` now matches no folder too, as in npm.
  No Bitwarden edge changed (its tsconfig `paths` map most of those packages anyway).
- Which projects to list is a contract question: a consumer assigns paths by the longest folder,
  so the list must hold the project of *every* path the graph names (changed files included), or
  a README in an app with no symbol would land in the root project.
- The spike's "4–16 projects per Bitwarden change" counted what the viewer draws. The graph's
  nodes span 8–45: most come from context symbols V6 folds into summaries. Frames must follow
  what is drawn, not the list.
- Nx and `angular.json` disagree: Bitwarden's `libs/components` is an Angular `application`
  (Storybook) and an Nx `library`. Nx wins for name and kind.
- An Nx `project.json` is trusted only with `nx.json` at the root.

**Verification**: tests first (red for the missing module, the missing hook and the missing
field): rule fixtures (`projects/declared` — one folder declared three ways, nested packages, a
`**` member, an Nx-only and a plugin-only folder, a tsconfig folder inside and outside a declared
project; `projects/packages` — nothing declared, a `{ "type": "module" }` marker; `projects/pnpm`
— an excluded package), a monorepo change with a base-only library and a renamed root package,
W1's two-app fixture (two tsconfig projects), the plugin hook (normalized folders, one outside the
repo, a throwing hook), Angular's W1 fixture and an Angular CLI workspace (`shop` at the root,
`projects/admin`, `projects/ui-kit`; without the plugin only the library's package). Full suite
392 tests. Regression against `main`: `r1` 29 identical (859 edges), Bitwarden 10 identical
(4,862), Bitwarden multi-project 8 identical (10,803), Qwik 30 identical (5,530); no finding
changed; time ×0.97–1.015. Projects phase: 250 ms of 66 s (Bitwarden `cbf86c2`), 7 ms (Qwik
`f7ed58cfc`). Not verified: Yarn's `workspaces: { packages }` form and an Nx repo without
workspaces (no fixture, no real repo), an Angular CLI workspace on real code (fixture only).

Merged into main (2026-10-04).

## V7b — Project frames (2026-10-03, branch `milestone/v7b-project-frames`)

When what the viewer draws spans two or more apps or libraries, each is a frame around its files,
with its name, kind, folder and how many of its symbols changed; edges between projects are
heavier, project names are the largest labels on the map, and summaries say across how many
projects their symbols are. One project, or an older graph: the same layout as before.

**Learned**
- The plan's prototype check paid off: dagre over frames ran 3–8 times wider than high on
  Bitwarden (`cbf86c2` 23,924 × 7,549). Rows in dagre's rank order keep callers first and the page
  between 1.00 and 1.46 times wider than high on all 8 changes, at most as wide as before.
- Canvas size was the wrong thing to watch. Qwik `f7ed58cfc` got a smaller canvas and panned at
  3 fps instead of 22: packages placed after the frames (or beside their main user) pulled fans of
  hundreds of long edges across it, and React Flow draws every edge whose bounding box meets the
  view. Hiding the frames changed nothing, which pointed at placement, not painting. Drawing a
  package in the frame it has the most links with (it stays in no project) brought the median
  edges in view to 106, below the 136 without frames, and panning to 30 fps. "Edges in view
  around each changed symbol" is now the measure for placement changes (viewer CLAUDE.md).
- A 1.5 px border is a tenth of a pixel on the map at 7 % zoom: frames there get a ring sized by
  `--symbiote-zoom`, as file names already were.
- A frame must not take clicks: as a parent node it lies under its files, and a click between them
  would land on it instead of the canvas. Only its name band takes the pointer.

**Verification**: tests first — layout (frames around their files, parents first, paths from the
project's folder, frames apart in reading order, `edge-cross` only between two projects, the
longest folder winning, packages in their main user's frame and in no project, one project equal
to no projects, islands packed into a page, summaries across projects) were red before the code;
400 unit tests, 32 e2e (3 new on the npm-workspaces fixture: frames, a click inside a frame,
names on the map and a click zooming into one; all three fail on V7a's build, for want of
frames). Real graphs (8 Bitwarden changes with the Angular plugin, 2 Qwik changes with the
Qwik plugin) against V7a's viewer, back to back: first paint within +7 % (Bitwarden `cbf86c2`
1,514 → 1,168 ms), pan 59–63 fps on Bitwarden and 23 → 30 fps on Qwik `f7ed58cfc`, no page
errors; screenshots of the map, a selection and dark mode. Not verified: a real repository with
an Nx-only or Angular CLI layout in the browser (fixtures only).

Merged into main (2026-10-04).

## V7c — The change list by project (2026-10-04, branch `milestone/v7c-projects-sidebar`)

When a change spans two or more apps or libraries, the change list is grouped by project (name,
kind, progress, foldable, paths from the project's folder), "only" or `p` shows one project and
what it is linked to, and findings and the detail panel name the project. One project: as before.

**Learned**
- Folder order is not path order: `apps/web/e2e/a.ts` sorts before `apps/web/src/x.ts`, but its
  project comes after `apps/web`'s. The list is sorted by project folder with a stable sort, so
  files keep their path order within a project and j/k follow what is on screen.
- Fitting the whole project on every j/k step would throw away the reviewer's place: the canvas
  fits a newly shown project once, then centres each selection as before.
- A test that clicks at a measured spot must wait for the canvas to stop panning: V7b's frame
  click test failed 3 times in 12 because the selection's pan was still running. "Flake" was the
  test reading a moving target, not the viewer.
- Real change lists span 3–9 projects (Bitwarden `cbf86c2`: 9, with 55 of 115 changes in
  `@bitwarden/common`); without groups that was one list of 32 paths.

**Verification**: tests first — the list logic (grouping in folder order with a nested project
and the root, flat for one project, the search over project names, one project, folded projects,
`p` cycling, a project's neighbourhood) was red before the code; 406 unit tests. E2E 35, three new
on the npm-workspaces fixture (the grouped list with progress, folding, j/k and search; one
project on list and canvas, `p`, "Show all projects"; findings naming projects), which fail on
`main`'s build; the projects spec ran 6 times over without a failure. Real graphs: screenshots of
Bitwarden `cbf86c2` grouped and with `@bitwarden/auth` only, and Qwik `f7ed58cfc` with its router
only; timings against `main` within noise (first paint +4–5 % on Bitwarden), no page errors. Not
verified: very long project lists in a narrow sidebar beyond 9 projects.

Merged into main (2026-10-04).

## E1 spike — decisions and their ripples (2026-10-04, branch `milestone/e1-explained-changes`)

Asked what would make Symbiote disruptive, the leading idea was to verify the mechanical part of a
change (a rename and its call sites, moves, a new argument at every call, the same edit repeated)
so a reviewer reads only the decisions. Measured before planning; it does not hold for typical
changes. Nothing in Symbiote changed; the scripts are in `spikes/e1-ripples`.

**Learned**
- Typical changes are decisions. On 165 unique changes (pinned sets, the latest commits of five
  repos, commits titled refactor/rename/move), 20 % of changed symbols but 5.4 % of diff lines are
  verifiable; without one large rename (Qwik `f7ed58cfc`, 72 % of its symbols), 2.8 % of lines.
  "Refactor" commits restructure code: 1.3 % of their lines.
- Symbiote's move matching found 29 of the 66 renamed symbols in Qwik `f7ed58cfc`: a renamed symbol
  often mentions its own name or others renamed with it (`EbFallback` → `CatchFallback` with
  `"eb-fallback"` ids inside), so its body changes and it shows as removed + added. Renames inferred from the change itself (moved
  names, renamed folders, pairs equal under their name difference) found them; one change may
  rename a word two ways, so every way must be tried.
- The biggest class was not ripples but the same edit repeated across files (148 symbols): one
  feature adding a key to 40 locale files, a prop changed in 24 files.
- Verified symbols are many and small: grouping them would shorten the change list by a fifth and
  the reading by a twentieth.
- Traps: a raw scanner misreads JSX text (an apostrophe starts a string) — tokens must come from
  the AST, as Symbiote's hashes do; a commit list grepped by message matches bodies too (`perf:` commits
  "mentioning a refactor"), so filter subjects; one feature reverted and re-applied counted three
  times until changes were deduplicated.

**Verification**: precision audit of 40 verified symbols drawn at random (moves left out): all
mechanical, none hiding a real change. The script ran on every comparison without an error.
Not verified: recall (how many mechanical changes the rules miss beyond member renames, seen in
Qwik `f7ed58cfc`); changes outside these five repositories.

Merged into main (2026-10-12).

## V8 spike — a smooth viewer (2026-10-12, branch `milestone/v8a-zoom-labels`)

Reported "flaky and laggy". Every interaction a reviewer does was scripted in Chromium on real
graphs (`scripts/viewer/interactions.mjs`), profiled on an unminified build, and re-run with one
cost removed at a time. Plan in PLAN.md (V8a–V8e).

**Learned**
- The biggest single cost of zooming was one line: `--symbiote-zoom` set on the page root on every
  zoom frame. An inherited custom property restyles every element below it — 12,788 on Qwik's
  map — though only about 130 labels read it. A stylesheet rule aimed at the labels restyles
  only them, but they still re-laid out their text each frame (`font-size` changes); scaling them
  with a transform from fixed sizes removes that too. Each change alone gained little; together
  they came within reach of the variable frozen (Qwik zoom-out blocking 507 → 190 ms, frozen 150).
- React Flow's `onlyRenderVisibleElements` checks every edge on every frame of a pan, zoom or
  `fitView` animation; edges are 38–52 % of the map's page elements.
- "Flaky" had a concrete part: on the map, frame names (V7b) are drawn over file boxes and take
  the pointer — 9–23 % of the spots on file boxes zoom into the whole project instead.
- On Qwik `f7ed58cfc` a j step's 300 ms glide got 4 frames: the canvas jumps in steps. Layout
  runs on the main thread (1.9 s there), and a context toggle lays out again (769 ms frame).
- Measuring traps: timings varied 3× between runs on this machine — compare medians of 3–5 rounds
  back to back; Long Tasks miss style and layout work, long animation frames (LoAF) include it;
  `getByLabel('Context')` matched "Mark InitContextMenuItems reviewed" too (use `exact`).

**Verification**: baselines (median of 3) in PLAN.md V8's table; the prototype for V8a measured
with medians of 5 against the variable frozen, edges hidden and both.

## V8a — Map labels (2026-10-12, branch `milestone/v8a-zoom-labels`)

Zooming no longer restyles the whole page: the map's labels are scaled by a transform from fixed
sizes, and the zoom value lives in a stylesheet rule for them alone, written only on the map.

**Learned**
- Two costs hid in one line, and each fix alone gained little: an inherited custom property on the
  root restyles every element below it; a font size that follows the zoom re-lays out its text
  on every frame. Scoping the variable halved the cost, the transform alone changed nothing,
  both together came near the "variable frozen" bound.
- A label's computed font size no longer says how big it looks: the e2e check that project names
  read twice as big as file names now compares drawn sizes (bounding boxes).

**Verification**: tests first — `nextMapZoom` (on the map, once per value, nothing off it); e2e:
a map file name keeps its size on screen while the map zooms further out (passing before and
after) and nothing is set on the page root (red before). `interactions.mjs` against `main`'s
build, two alternating runs of 3 rounds: zoom out ×20 blocked 102–103 → 32–40 ms (Bitwarden
`cbf86c2`), 451–466 → 193–219 ms (Qwik `f7ed58cfc`); zoom in on Qwik 107–115 → 0–5 ms; nothing
else moved beyond noise. Map screenshots before and after match. 408 unit tests, 35 e2e.

Merged into main (2026-10-12).

## V8b — Map clicks (2026-10-12, branch `milestone/v8b-map-clicks`)

On the map, a click on a file box now always lands on the file: frames (names included) never take
the pointer there, and a click on an empty part of a frame reaches the canvas, which zooms into the
frame under it.

**Learned**
- The bug came from V7b's choice to draw frames above files on the map so their names stay
  readable, and to let the name take clicks. Layering for reading and for clicking must be decided
  separately: the frame can be on top and still give every click to what is below.
- A test that measures where clicks land (`elementFromPoint` on each box's corners and middle)
  found it on the four-file fixture; nothing checked it before.

**Verification**: tests first — `projectAt` (inside a frame, between frames, without frames); e2e:
every spot of every file box on the fixture's map reaches the file (4 boxes failed before), a
click on a frame's empty edge zooms into it. Real maps, `main` → V8b: Bitwarden `737ee3f` 91 →
100 %, `cbf86c2` 77 → 100 %, Qwik `f7ed58cfc` 88 → 100 % of file-box clicks reach the file;
timings unchanged within noise. 409 unit tests, 35 e2e.

Merged into main (2026-10-13).

## V8c — Edges (2026-10-13, branch `milestone/v8c-edges`)

On the map, one edge per pair of linked file boxes stands for their symbols' edges, heavier the
more it stands for; while the view of a change with more than 400 edges moves, only the selected
symbol's edges are drawn. Zooming out on Qwik `f7ed58cfc` blocked 466 ms, now 15 ms.

**Learned**
- React Flow's `onMoveStart` comes with every press (d3-zoom starts a gesture on mousedown), so
  a click looked like a move and blinked every edge. The view's first real change is `onMove`.
- An animation interrupted by the next one (j during a glide) reports its end after the next
  has started (xyflow defers `onMoveEnd` with a timer): the end of a move must wait a little and
  be cancelled by the next `onMove`.
- React Flow hands `onNodeClick` to every node and the minimap's `nodeClassName` to every minimap
  node. Inline functions re-render thousands of nodes on each canvas render; harmless while the
  canvas rendered on selection only, costly once it renders at each move's start and end.
- React Flow draws no edge to a node without handles: file boxes needed unseen ones. They cost
  nothing measurable at open (alternating benchmarks, within ±15 % noise).
- A long animation frame is reported after it ends. `interactions.mjs` read open's frames too
  early and missed the last, longest one at random: it showed V8c's open 3× worse than main
  (Qwik 835 → 2,304 ms) when both were the same (2,222 vs 2,348 once fixed). Read performance
  entries only once the page is idle, and check a regression with a second method (here, opening
  each build in turn, 5 rounds) before fixing it.

**Verification**: tests first — `fileEdges` (pairs, sides, weights, summaries, projects) and
`edgesToDraw` (off the map, moving, the map, the limit counting what would be drawn); e2e on a
generated change with 421 edges: two file edges on the map, only the selection's edges during a
held drag and all back after, a press without movement keeps them all, a small graph unchanged.
Real graphs, `main` → V8c, blocked ms: zoom out ×20 Qwik 466 → 15, Bitwarden `cbf86c2` 100 → 23;
j ×8 Qwik 862 → 78, `cbf86c2` 98 → 0; select Qwik 576 → 115; map edge elements Qwik 6,681 →
1,378, `cbf86c2` 2,733 → 871; open and context unchanged within noise. Screenshots: the same map
with fewer, heavier lines. 415 unit tests, 38 e2e.

Merged into main (2026-10-13).

## V8e spike — where layout time goes (2026-10-13, branch `milestone/v8e-layout-worker`)

`layoutFlow` alone, in Node: 187–981 ms for the default view of the three measured changes,
47–227 ms with context off, up to 841 ms with Qwik's largest group opened. Moving the data a
worker needs costs little next to it: the graph once (6–39 ms to send), each layout back
(4–42 ms to receive). So a worker frees 0.2–1 s of main thread per layout. React drawing the new
layout stays on the main thread; V8e measures that part separately. V8d is deferred: V8c already
met its targets (j ×8 on Qwik 78 ms blocked, select 115 ms).

## V8e — Layout in a worker (2026-10-13, branch `milestone/v8e-layout-worker`)

Layouts are made in a Web Worker. The page stays usable while one is made: the change list and
findings show at once on opening, the last layout stays drawn with "Laying out…" until the next
arrives, and a view seen before (the last 8) comes back at once. Opening Qwik `f7ed58cfc` blocked
the page 2,568 ms, now 620 ms; context on 1,147 → 284 ms.

**Learned**
- What remains is React drawing a new layout: one frame of 157–693 ms (Qwik's first layout,
  `cbf86c2`'s 404-user group with ~750 more nodes). The worker removed the computing, not the
  drawing; drawing in parts would be the next step for very large views.
- Every effect that moves the view for a new layout (fitting a project, the focus, an opened
  group) must wait for that layout to be drawn: run against the old one, it moved the view twice.
  The canvas skips its fit while a layout is pending.
- The options object must keep its identity while the view is the same (a memo): the effect
  that asks for a layout depends on it, and a cached answer sets state.
- On the map a group lies under its file box, which takes clicks (V8b): a scripted click at the
  group zoomed into the file instead. The measuring script dispatches the click on the node.
- Holding the worker script back (`page.route`) makes "the change list shows before the first
  layout" testable without timing.

**Verification**: tests first — `layoutKey` (same view, any set order; views told apart),
`LayoutCache` (one request per view, a late answer kept and not drawn, least recently used
dropped), `workerLayouts` (answers out of order, worker failure, no worker); e2e: with the worker
held back the change list shows and the canvas says "Laying out…", then symbols; a view laid out
before comes back without the note. Real graphs, `main` → V8e, blocked ms: open — Bitwarden
`737ee3f` 557 → 233, `cbf86c2` 856 → 307, Qwik 2,568 → 620; context on 223 → 51, 256 → 92,
1,147 → 284; the largest group 265 → 173, 1,010 → 600, 1,340 → 322. A timeline of opening Qwik:
no long frame while the worker lays out. 423 unit tests, 40 e2e.

Merged into main (2026-10-13). V8 closed with it: V8a, V8b, V8c and V8e merged, V8d deferred
(V8c already met its targets). Left for later: drawing a large new layout in one frame (up to
693 ms), a faster layout than dagre for very large clusters, the map on a canvas.

## V9 spike — what picking two commits costs (2026-10-13, branch `milestone/v9-commit-picker`)

Measured on the regression clones before planning a commits page for `symbiote view`. Listing 100
commits with `git log` takes 9–66 ms, even on Bitwarden's 23,236 (628 ms once, with a cold disk).
Analyzing one commit against its parent takes 0.6 s (vite, no TypeScript changed) to 59 s
(Bitwarden with the Angular plugin; 46 s on a second run, with the worktrees made); 20 commits
5.6–87 s. Two consequences for the plan: the page must show progress and keep results, and the
analysis cannot run in the server's process — ts-morph is synchronous, so the server would not
answer for up to 90 s. A child process per analysis is safe to stop: worktree locks hold the
owner's pid and stale ones are recovered.

## V9 — Pick two commits (2026-10-13, branch `milestone/v9-commit-picker`)

`symbiote view` without revisions opens at once on the current branch's commits; two picked (or one
against its parent) are compared directly, analyzed then in a child process, and served at
`/diff/<base>..<head>/`. `symbiote view <base> [head]` analyzes first as before and opens that diff;
`symbiote pr` is unchanged.

**Learned**:
- The viewer already used relative URLs for its API and files (`./api/…`, Vite `base: './'`),
  so serving one viewer per diff under its own path took no change to how it calls the server;
  only the commits page's two endpoints are absolute. Every existing e2e spec passed unchanged
  once `symbiote view HEAD~1 HEAD` opened `/diff/<pair>/`.
- IPC messages from a child arrive while it runs synchronous code (a 1.5 s busy loop delayed
  nothing), so phases sent just before the synchronous parts (extract, references) are
  accurate. On these repos loading is nearly the whole run: the page says "loading base" and
  "loading head" for 93 % of Qwik's 14 s.
- The viewer's stylesheet is flat: `.progress` was already the review sidebar's bar, and the
  progress page's rules would have moved it on every graph page. Check a class name before using
  it.
- A list with `white-space: nowrap` subjects inside the app's grid widened the page to its
  longest subject (Qwik has some): `min-width: 0` on flex items does not lower their min-content
  contribution. `contain: inline-size` on the page does. Short fixture subjects hid it; the e2e
  fixture now has a long one.
- CI failed on macOS only: `src/commits.ts` and `src/Commits.tsx` differ only by case. macOS
  file systems ignore case, so TypeScript resolved `./Commits.js` to `commits.ts` and never
  loaded the component (ESLint: "not found by the project service"). Linux, where every local
  run happened, tells them apart. The component is `CommitsPage.tsx`; a unit test now fails on
  any two tracked names that differ only by case.
- A flaky e2e (1 run in 75): "x" pressed as soon as the rows showed was lost, because the key
  listener for that render was attached in a `useEffect`, after the paint. The commits page
  attaches it in a `useLayoutEffect`, in the same task as the rows; 125 runs then passed.
- Counting "N commits" by rows between the picks is wrong with merges (other lines' commits sit
  between them by date); walking the listed commits' parents gives `git rev-list --count`
  (checked on Qwik: 5 and 5).
- Stop signals the node child only: a `git checkout` it started finishes, so no worktree slot is
  left half checked out, and the slot's pid lock is recovered as stale. Ctrl+C in a terminal is
  different: it reaches git too, and a checkout interrupted mid-way can leave a slot whose HEAD
  is the old commit and whose files are partly the new one; reusing it for the old commit skips
  the checkout. Pre-existing (`symbiote diff` has it), not fixed here.

**Verification**: tests first — `parseLog` (merges, the root commit, refs, a subject holding the
separators), `listCommits` (pages, a tag, a detached HEAD, a repo without commits), `isCommit`;
`onPhase` in order with the same analysis; `Diffs` (one at a time in order, failures kept until
asked again, Stop, close, the last N by use); `childRunner` with a fake CLI (args, phases, the
CLI's message, Stop); the server (`/api/commits` pages, `POST /api/diffs` refusals, 202 → 200,
sources and state per diff, 502, Stop, 404); `symbiote view` without revisions; `src/commits.ts`
(picks, base by list position, one commit, the count with a merge, `api/graph` answers). E2E: five
commits served by `symbiote view` — the list, two picked → "Analyzing" → the graph, a reload kept,
← Commits, This commit, the keyboard, Stop, a diff URL opened anew, no sideways scroll, the
sidebar bar untouched. 464 unit tests (31 new), 45 e2e (5 new). `r1`: 29 comparisons identical
(859 edges, no finding changed), time 0.97 of `main`'s. Real repos (warm, 2 rounds): the URL in
0.58–0.64 s, `/api/commits` 33–166 ms, 100 rows drawn 0.24–0.26 s after opening Qwik; a pair
through the server Qwik 13.8–14.3 s (`symbiote diff` 14.2–15.1 s), Bitwarden 41.6–43.2 s (`symbiote diff`
39.8–40.2 s, +3.5 to +8.4 %); status requests meanwhile 1.8 ms median, 20 ms at most; a kept pair
in 1.4–10 ms. `symbiote view HEAD~1 HEAD` on Qwik to its URL: `main` 13.1–14.5 s, V9 13.2–14.5 s. Not
verified: Windows and macOS.

Merged into main (2026-10-13), after two fixes found at merge time: macOS CI (a component named
like `commits.ts` but for case) and a flaky e2e (a key listener attached after the paint). Left
for later: a ref picker and history search, uncommitted changes as a head, graphs kept on disk;
the pre-existing hazard of a checkout interrupted by Ctrl+C (see above).

## V10 spike — what a commit graph needs (2026-10-13, branch `milestone/v10-commit-graph`)

Measured before planning lanes for the commits page, with a prototype of the lane walk over
`git log` on this repository, fresh blobless clones of ky, zod, vite, Qwik and Bitwarden, and a
history-only clone of CPython (172,396 commits). The plan changed four times as the user said
what they wanted (every branch; "exactly like git extension, or gitty up", with a branches
panel; lazy loading; tags only as badges); each change was measured first.
Repositories that merge with merge commits list side-branch commits among the branch's own (Symbiote
66 and Qwik 57 of the first 100 rows); squash-merging ones are one line, and their divergence is
in branches the page does not list (Bitwarden: 1,539 remote branches not merged into HEAD).

**Learned**:
- `git log`'s default order (commit date) is not a graph order: with skewed clocks a parent can be
  listed above its child. Of the two that are, `--topo-order` keeps a branch's commits together
  and needs fewer lanes than `--date-order`: Qwik's own branch 7–11 against 13–15, zod with
  remotes 4 against 5–12. It is also what `git log --graph` draws.
- Without a rule for the current branch, a newer tip of another branch takes the first lane and
  the current branch wanders. Keeping lane 0 for HEAD's first-parent line fixes it, and the
  prototype's rows then matched `git log --graph` on this repository.
- An ordered log walks the history first unless the repository has a commit-graph file, and a
  fresh clone has none (`git gc` writes it): 100 rows on Bitwarden take 111–123 ms (with every
  remote branch 206–237 ms) against 14–16 ms unordered; with the file, 1–25 ms. Within budget
  either way, so Symbiote need not write one (it would change the user's repository).
- Every remote branch is mostly other people's work: on Bitwarden 93 of the first 100 rows. The
  first plan listed local branches and their upstreams by default; the user asked for every
  branch, as Git Extensions and Gittyup show it, with a branches panel on the left.
- Branch tips sit deep in graph order: Bitwarden's median remote tip is row 9,165 (deepest
  37,633; 95 of 1,591 in the first 1,000 rows), Qwik's 3,695. A panel click cannot page its way
  there 100 rows at a time.
- Without a commit-graph file git orders the whole history before its first row: Bitwarden
  243 ms, CPython 762–776 ms. With one the first rows come in 42 ms and 6 ms, but the whole order
  takes longer (Bitwarden 622 against 344 ms, CPython 2.0 against 1.2 s): the incremental walk is
  slower in total.
- What is heavy is the rows' details, not their order: CPython's 150,182 branch commits with
  subject, author, date and refs are 30.5 MB; each row's parents as row numbers are 1.32 MB, and
  the lane walk over them 62 ms. Details for 200 rows fetched by SHA (`git log --no-walk`) take
  16–20 ms anywhere in the history. Hence the plan's lazy loading: the order once on the server,
  the shape to the viewer, details for the rows in view. Sending everything at once (the second
  plan) would have been 7.5 MB on Bitwarden and over 30 MB on CPython.
- Lane counts on partial lists mislead: lines to parents not yet listed stay open to the bottom.
  Bitwarden showed 49 lanes in its first 10,000 rows but needs 17 over the whole history; Qwik
  needs 36 (p95 35). Cutting lines over 100 rows into arrows, as gitk does, takes partial lists
  to 5–19 lanes, but the tools asked for draw every line whole; not planned.
- Tags as tips explode a graph: CPython's 676 tags reach 22,214 commits no branch does (old
  release lines), and its widest row goes from 37 lanes to 2,449. Git's own `--graph` agrees (36
  and 2,449) and takes 15 s to draw it. On Bitwarden and vite they added rows (1,497 and 401)
  but no lanes, which hid it. The user had asked for tags only as badges anyway.
- Cross-checking the prototype against `git log --graph` (the widest line's width) is cheap: 36
  against 37 lanes on CPython's branches, 2,449 against 2,450 with tags. The one-lane difference
  is not explained yet; the plan's check script compares row by row.
- Correction (V10a): the prototype's lane counts were low. It did not count a side branch's
  line down to its fork on HEAD's line; the real layout needs 142 lanes on Bitwarden, not 17
  (git's `--graph`: 143). See V10a.
- Unrelated: `scripts/regression/setup.mjs r1` fails on a fresh machine. Zod's pinned commits
  (`f448c44d` and five more) are no longer reachable from its branches, and git cannot fetch a
  commit by a short SHA. The set needs reachable (or full, fetchable) SHAs; not fixed here.

## V10a — The history as a graph (2026-10-13, branch `milestone/v10-commit-graph`)

`symbiote view`'s commits page lists every branch, local and remote (or "This branch"), in graph
order, with lanes drawn left of the rows; lines over 100 rows are two arrows. The server lists
the order once per scope and serves rows' details by block and the whole shape; the viewer lays
out lanes over the shape and draws only the rows near the view.

**Learned**:
- Check a prototype against the tool it imitates before planning on its numbers. The lane
  prototype skipped one kind of line (a side branch's way back to HEAD's line) and reported 17
  lanes for Bitwarden; `scripts/viewer/lanes-check.mjs`, which walks every drawn line to its
  parent and prints git `--graph`'s width beside ours, showed 142 on its first run. Whole lines
  were what the user had asked for; with the real numbers they chose gitk's arrows (Bitwarden
  20 lanes, 1,939 arrows in 39,861 rows; 1,943 as first counted, see "Fix — lanes-check and root
  commits").
- `--no-walk=unsorted` reads any 200 commits by SHA in 16–20 ms, wherever they are in a
  150,000-commit history: the order is the only thing that must be listed whole.
- A line may join a lane already going to its parent before it is cut: on HEAD's line that is
  common (a branch forked from the very next commit of lane 0) and costs nothing.
- Before the whole shape is known, parents not listed get their own negative numbers; with
  identity kept, the first rows lay out as they will in the whole history, except the last 100,
  whose lines may turn into arrows once their parents' rows are known.
- In this WSL machine's headless Chromium the first layout of a font stack naming fonts it lacks
  (`ui-monospace, SFMono-Regular, Menlo`) costs 347 ms, and the viewer's stacks together
  400–1,000 ms per page. It looked like a V10 regression (a 921 ms task right after the first
  rows arrived) until a profile pointed at `measure` reading layout and the same page on `main`
  paid it too. Timings are given with plain fonts beside.
- `box-sizing: border-box` on a list whose height is set inline to rows × 32 px loses the border
  from the rows' area and clips the last row: the list is `content-box`.
- Qwik's HEAD row carries nine tags; on `main` (V9) they squeezed its subject to nothing. A row
  now shows three refs, then "+N".

**Verification**: tests first — core `streamHistory` (every branch, no tag-only commit, stash or
`refs/symbiote/*`; a child dated before its parent listed above it; an empty repository),
`commitDetails`, `historyState` (moves with HEAD and branches, not tags), `hasCommitGraph`;
`Histories` (rows before the walk ends, the shape after, rows by SHA from the kept order, a new
version, one listing per scope, a failed listing, the hint); the server's `/api/history` and
`/api/history/shape` (defaults, refusals, 409); `layoutLanes` (one line, a merge, two tips from
one commit, an octopus, a freed lane, parents not listed, no HEAD, the first rows unchanged by
the rest, arrows at 101 rows and not 100, a join instead of a cut); `comparison` on rows,
`parentRows`, `blocksAround`, `laneSpacing`. E2E: every branch in graph order with lane 0 and
the cursor on HEAD, tags as badges and "+N", "This branch" in the URL, 450 commits (35 rows in
the page, details on scroll, arrows both ways); all 48 specs pass. `lanes-check.mjs`: 0 errors on
seven repositories. Real repositories in Chromium (plain fonts, warm server): first rows
102–147 ms against `main`'s 87–119 ms; CPython's shape in 83 ms, lanes 62 ms, no long task
while scrolling or jumping, heap 72 MB. A cold server: CPython's first rows at 0.93 s (git's
walk). Not verified: Windows and macOS browsers, Firefox's height cap.

Merged into main (2026-10-13), V10a alone: V10b (branches panel) and V10c (picks across
branches) are not started. `main` verified after the merge: 495 unit tests, build, 48 e2e.

## V11 spike — checking out from the page (2026-10-13, branch `milestone/v11-checkout`)

Measured on a clone of this repository before planning checkout from the commits page (never on
a working tree in use). `git switch` takes 6–54 ms for 104–713 differing files. It carries a
local change to a file the target leaves alone, and refuses one the target would overwrite,
naming the files and changing nothing; it refuses a branch checked out in another worktree;
`git switch <name>` for a remote-only branch creates its tracking branch. Counting local changes
(`git status --porcelain=v2 --untracked-files=no`) takes 3–10 ms on 115–742 files. So the plan
lets git decide what is safe and shows its message, with no forced mode. Found on the way: the
open commits page does not notice a checkout made in a terminal (it showed the old HEAD after
scrolling to the end; its rows were all in one block, so nothing returned 409); a reload did.
The plan lists anew on focus.

## V11 — Checkout from the commits page (2026-10-13, branch `milestone/v11-checkout`)

A row's menu checks out its branches, a remote branch as its tracking branch, a tag or the
commit, after a confirmation; the page lists anew after it, and on focus when HEAD or a branch
moved elsewhere. V11a (a checkbox for the current branch) was dropped: V10a's switch does it.

**Learned**:
- Letting git decide what is safe needs no rules of Symbiote's own beyond operations in progress:
  `git switch` without force carries changes the target leaves alone and refuses the rest,
  naming the files, with HEAD unchanged. The confirmation says that much, and the refusal is
  shown as git wrote it.
- `git switch --create x --track refs/remotes/origin/x` sets up tracking only when `origin` is a
  configured remote whose refspec maps to that ref; the e2e fixture's `origin/topic`, made with
  `update-ref` alone, needed `git remote add`. A real repository whose remote was removed but
  whose remote refs remain gets git's own refusal.
- A post-checkout hook's exit status becomes `git switch`'s, after HEAD moved: checking HEAD
  again tells a refusal from a checkout with a failing hook.
- Listing anew is simplest as a new generation of the page component (a new React key): rows,
  lanes, picks and the cursor start over, and the cursor lands on the new HEAD by V10a's rule.
- A test that conflicts on purpose printed git's stderr into every `pnpm check`; the repository
  helper now keeps stderr in the thrown error.
- The first checkout from the page outside the tests was the user's own, on this repository:
  it moved the working tree to another branch under uncommitted work of the session (two files,
  the same on both branches, moved back with `git stash` and a switch). That is what a checkout
  does, and the confirmation says so; but whoever develops Symbiote with `symbiote view` open on it should
  expect the branch to change under them. Right after, the user found HEAD hard to see: HEAD's
  row, badge, dot and a title chip now show it.

**Verification**: tests first — core (`listRefs`: upstreams with ahead/behind and `gone`, remotes
by remote without `HEAD`, annotated tags peeled; `workingState`: counts, merge, cherry-pick,
bisect; `checkout`: each kind, a change carried, one refused, a branch in another worktree, a
merge in progress, a remote whose local name tracks nothing, unknown names, short SHAs, a name
starting with `-`, a failing hook), server (status, refs, checkout's refusals, one at a time,
other sites), viewer (`checkoutChoices`, `changesNote`, `checkedOut`). E2E (a fresh repository
per test): the menu per row, a branch, a remote branch from the keyboard, a tag, git's refusal,
a terminal checkout on focus. 519 unit tests, 53 e2e. On a clone of this repository: 109–115 ms
from "Check out" to the page drawn again. Not verified: a large working tree, Windows and macOS,
slow hooks.

Merged into main (2026-10-13), with V11a dropped and HEAD's styling added at the user's request.
`main` verified after the merge: 522 unit tests, build, 53 e2e.

## V12 spike — opening VS Code from the viewer (2026-10-13, branch `milestone/v12-open-in-vscode`)

Measured before planning "open in VS Code" from the diff panel. **Which line**: for the last
60–68 first-parent commits of Symbiote, ky and zod, each reviewed as `c^1..c` with the working copy at
the branch tip, 1–62 % of the added lines of code files sat at another line number at the tip
(Symbiote 29–46 %, ky 23–62 %, zod 1–26 % by distance), and up to 23 % had been changed since (ky
6–20 commits back). Head's number is right only for the checked-out commit, so the server maps
it, with `git diff -U0 <commit> -- <file>` against the working copy (under 10 ms on a
3,195-line file). **Which window**: `code <folder> -g <file>:<line>` returned in 50 ms here
(WSL, VS Code 1.141 on Windows), and the window that had the folder got the file (`code
--status`: one window before and after). `launch-editor`, the usual package for this, runs
`code -r -g`: the last active window, whatever project it shows, so it cannot do what was asked.
**Windows**: `code.cmd` runs `Code.exe` with a `cli.js` under a folder named for the build, which
changes with each update, and Node refuses to start a `.cmd` without a shell; the plan reads
`code.cmd` to run what it runs. The user wants it on every platform: running VS Code from the
server, where the files are, needs no case for WSL, SSH or containers, unlike a `vscode://` link
from the browser.

## V12 — Open in VS Code (2026-10-13, branch `milestone/v12-open-in-vscode`)

"Open in VS Code" beside the panel's file line (or `o`), Ctrl/⌘+click on a row, or a click on a
line number opens that line in VS Code: in the window that has the repository open, else a new
one with it, at the line's place in the working copy. The server maps the line with `git diff
<commit> -- <file>` and runs `code <repo root> --goto <file>:<line>:<col>`.

**Learned**:
- Git pathspecs are globs: `git diff <sha> -- 'src/[id].ts'` also matched `src/i.ts` and
  `src/d.ts`, and their edits moved `[id].ts`'s lines. A path from a graph handed to git as a
  pathspec needs `--literal-pathspecs` (Qwik routes use `[param]` folders).
- A command that may start a long-lived process (VS Code) must be awaited on `exit`, not
  `close`: the process it starts can inherit and hold the stderr pipe.
- A button inside the file line changed the text two existing specs read (the path); beside it,
  nothing else changed. Text assertions on a container break when controls are added to it.
- `scripts/viewer/measure.mjs` serves graphs with `?graph=`, where no server can open files, so
  the controls never show there; the cost was measured with a short script against a real `symbiote
  view` of each build instead.
- Under `symbiote view` the code rows had no click action (picking a comment line is `symbiote pr`'s), so
  Ctrl/⌘+click means the same in both, and a plain click keeps its meaning under `symbiote pr`.
- The first "Open in VS Code" was link-styled 12 px text beside the path, and the user did not
  see it. An action the reviewer is meant to find needs to look like a button (now outlined, in
  the accent colour, with an icon and its key). At the same time the user had "This commit"
  removed from every commits row: picking one commit and Compare already does it.

**Verification**: tests first — `mapLine` (insertions, removals, replacements, the file's start
and end), `workingLine` on temp repositories (uncommitted edits, a later commit, deleted and
renamed files, a `[id]` path, a bad SHA), `findVsCode` with injected platforms (PATH, PATHEXT,
VS Code 1.141's and the older `code.cmd`, an unknown `code.cmd`, the macOS bundle, `SYMBIOTE_CODE`),
the `cmd.exe` quoting and its refusals, `runVsCode` with a stand-in (arguments, failure,
a command that keeps running, a missing command), `vsCodeOpener` on a temp repository, the
endpoint (each side's commit, 404 and 502, refusals), the viewer's `src/open.ts`. E2E with a
stand-in for VS Code (`SYMBIOTE_CODE`): 5 under `symbiote view`, 1 under `symbiote pr`. 557 unit tests, 59 e2e.
On this machine (WSL, VS Code 1.141 on Windows): a function at line 449 of `24396ab` opened at
480 in the working copy, 105 ms, in the existing window. Selecting a 300-row symbol: 31–37 ms
median on `main`, 33–34 ms with V12. Not verified: native Windows and macOS, a repository not
open in VS Code, Remote SSH and dev containers.

Merged into main (2026-10-13), with the button made visible and "This commit" removed from the
commits rows at the user's request. `main` verified after the merge: 557 unit tests, build, 59
e2e.

## V13 spike — compare as a mode (2026-10-13, branch `milestone/v13-compare-mode`)

Measured in Chromium on `symbiote view` (`main` at `2644214`) before planning a browse mode for the
commits page, on this repository and the Qwik and Bitwarden clones. The page opens as V9's
picker: the compare bar takes 52.6 px (1.6 rows of 32 px; Qwik and Bitwarden show 23 rows at
1440 × 900, 18 at 1280 × 720) and the pick circle 24 px of every row. A click moves the cursor and
picks, and the pick is what shows: the cursor is a 3 px grey bar, the pick a 14 % accent tint.
Clicking three rows to look at them leaves the first and the third picked, with a comparison
ready ("4d5d13d → 239e9d3 · 10 commits" on Qwik). A row clicked before `c` stays picked under its
checkout menu. Back from a diff lists the page anew (no picks kept), so a mode held in the page's
state starts over in browse mode. The errors the bar shows today (the menu's "Could not read the
branches", a later block's "Could not list commits") need a place of their own once the bar is
gone by default. The plan: browse by default, a "Compare mode" toggle (or `x`) for V9's picking,
left with Escape.

## V13 — Compare mode (2026-10-13, branch `milestone/v13-compare-mode`)

The commits page opens in a browse mode: a click selects a row, and there are no pick circles
and no compare bar. "Compare mode" in the title (or `x`, which also picks the selected row)
turns on V9's picking; the toggle, Escape or Compare leaves it, and the picks go with it. Viewer
only.

**Learned**:
- With the bar gone by default, its error slot went too: a failed `/api/refs` (a row's menu)
  would have shown nowhere. Listing and menu errors now have a line under the title; only
  "Could not compare" stays in the bar, the one place it can come from.
- A selection that replaces picking as what a click does must look like one: the cursor's 3 px
  grey bar was enough beside a pick, not alone. On HEAD's row the selection's tint covers HEAD's
  green; the badge, bold subject and ringed dot still say it is HEAD.
- `getByRole('button', { name: 'Compare' })` matches "Compare mode" too (names match by
  substring): the specs ask for `exact: true`. Adding a control whose name contains another's
  breaks locators the same way V12's button broke text assertions.
- The toggle's key hint (`x`, then `Esc`) is a `kbd` hidden from the accessible name, so the
  button keeps one name in both states.

**Verification**: tests first — the changed `commits.spec.ts` failed 9 of 11 against `main`'s
build, all on the missing toggle or error line. Now 557 unit tests (unchanged) and 64 e2e (5 new:
browse mode, the toggle and Escape with a menu taking Escape first, `x`, a scope switch keeping
the mode, an error under the title). On the Qwik and Bitwarden clones against `main`'s build,
back to back: rows wholly in view 23 → 25 at 1440 × 900 and 17 → 19 at 1280 × 720; first rows
drawn (warm, plain fonts, 5 rounds) Qwik 114 → 114 ms median, Bitwarden 146 → 139 ms; no page
errors; screenshots of both modes, light and dark, and of HEAD's row selected. Not verified:
Firefox and Safari; a back-forward cache restoring the page (Chromium lists it anew).

Merged into main (2026-10-13). `main` verified after the merge: 557 unit tests, build, 64 e2e.

## V14 spike — the checkout menu's names (2026-10-14, branch `milestone/v14-checkout-submenu`)

Measured before planning a checkout submenu, in Chromium on `symbiote view` of the Qwik and
Bitwarden clones (`main` at `c2e3486`, 1440 × 900). Qwik's HEAD row (`main` and 8 release tags)
gets 10 entries, each starting "Check out" and 8 ending "(detached HEAD)"; the menu stops at its
480 px max width and is 343 px tall. A remote branch's entry is 117 characters ("Check out
origin/dependabot/… as dependabot/…") on two lines, and the confirmation repeats it as its
heading. The names are plain text in the middle of each sentence, while the rows draw the same
names as coloured badges. Refs per commit stay small (Qwik 1–8 but for one commit with 10 or
more, Bitwarden 1–5, CPython 1–2); the longest name is 140 characters (a Bitwarden remote
branch). So the plan puts the targets in a submenu under one "Check out" entry, each name as
the row's badge with a muted note, and the name as a badge in the confirmation's heading.

## V14 — Checkout submenu (2026-10-14, branch `milestone/v14-checkout-submenu`)

A row's menu holds one entry, "Check out ▸"; its targets open in a submenu beside it on hover
(or a click, → or Enter), each named by the row's badge with a muted note after it ("tag ·
detached HEAD"). `c` opens straight into the submenu. The confirmation's heading shows the name
as a large badge ("Check out branch [wip]?"). Viewer only.

**Learned**:
- CSS generated content is part of the accessible name: the item drawn as "Check out ▸" was
  named "Check out▸" until the arrow got empty alternative text (`content: '▸' / ''`).
- In a menu entry the name must win the space. A one-line note squeezed a 62-character remote
  name to "o"; with `flex-wrap` the note goes under a long name and the name stays whole up to
  the menu's width, then ends in "…" with its title whole.
- A pill badge wrapped over two lines loses its border; as an inline block it wraps inside
  rounded corners, and `max-width: calc(100% - 1em)` keeps the "?" beside it.
- The submenu has to be measured where nothing narrows it (at the window's left edge, hidden):
  measured in place near the right edge, its shrink-to-fit width would be too small before it
  is moved to the left.
- A `<button>` does not stretch to fill a plain block wrapper, though it does as a flex item:
  wrapped for screen readers, "Check out" was 121 px wide in a 150 px menu. The user saw it
  before any test did; an e2e test now checks that it fills the menu.
- The menu opens after `/api/refs` and `/api/status` answer: a test that pressed Enter right
  after clicking "⋯" reached the page before the menu. It now waits for the menu.

**Verification**: tests first — the new unit test failed on the missing `ref`; 5 of 6 checkout
e2e tests failed against `main`'s build. Now 558 unit tests and 66 e2e (2 new: the keyboard path
through both menus, the submenu kept in a small window). Screenshots on the Qwik clone, light and
dark: HEAD's row (`main` and 8 tags: a submenu of 10 badges, 368 × 335 px, where the menu was
480 × 343 with "Check out" 10 times), the remote-branch row (the name whole, the note under
it), and their confirmations; a 140-character branch in a scratch repository. No page errors.
Not verified: Firefox, Safari, touch screens.

Merged into main (2026-10-14). `main` verified after the merge: 558 unit tests, build, 66 e2e.

## V15 spike — what a new commit costs a review (2026-10-14, branch `milestone/v15-branch-reviews`)

Measured before planning branch reviews. Outside `symbiote pr`, marks and drafts are kept per pair of
revisions (`stateDir`: a hash of `base..head` in the cache), so a commit added to a reviewed
branch starts the review over. On a clone of this repository, whose commits an agent wrote (189
of 206 carry its co-author line), each commit of four milestone branches (V9, V11, V12, V14) was
compared with its branch's fork point (`symbiote diff`, 1.0–1.4 s each), and the changed symbols of
the commit before were checked against it by fingerprint, I1's rule. Over the 15 times a commit
was added to a branch already reviewed, 1,027 of 1,051 marks (97.7 %) would still be valid: 11
symbols changed again, and 13 moved with a renamed file (`e75c1cf`; IDs hold paths). Looking at
each new pair from scratch means 1,197 symbols; keeping marks per branch leaves 170 (14 %).
The graphs' `files` list non-code files too (docs, Markdown), so review files committed in
`symbiote/` would show there, with no symbols. So the plan keys reviews by branch and, as asked, keeps
them in `symbiote/reviews/` at the repository's root, one file per reviewer: out of git by default (a
`symbiote/.gitignore` with `*` and `!config.json`, as pytest and ruff do), shared by deleting it.

## V15 — Branch reviews in the repository (2026-10-14, branch `milestone/v15-branch-reviews`)

"Review ▸" in a commit row's menu (or `r`) compares a branch's fork point with its tip; marks and
drafts are kept per branch, so after an agent's new commits only new and changed symbols are
left. Reviews are files in `symbiote/reviews/<branch>/<user.email>.json`, out of git by default (a
`symbiote/.gitignore` Symbiote writes once), shared by deleting it. The commits page shows "✓" or "+n" on
reviewed branches and a dot on commits added since. Plugins are read from `symbiote/config.json`,
else `symbiote.config.json`.

**Learned**:
- The fork point needs both default-branch refs: with a stale local `main` and an agent branch
  taken from `origin/main`, `merge-base <tip> main` starts the review commits too early. The
  latest merge-base of the local and remote refs is right in both cases.
- A `.gitignore` with `*` and `!config.json` hides itself and the reviews but keeps
  `config.json` trackable (checked in a temporary repository before planning on it). Writing it
  with the `wx` flag leaves a project's own file alone.
- Marks and drafts in one file means two writers (the viewer saves them separately): writes go
  one at a time per file, read, changed and written back atomically.
- The viewer saves state only on a reviewer's action, so opening a review never counts as
  reviewing it: a branch's "head" moves only when something was marked or written there.
- Tests that read `git config` must stub `GIT_CONFIG_GLOBAL`: the developer's own `user.email`
  otherwise leaks in.
- Planned with SHAs in the review header; the first screenshot showed them twice, next to the
  summary's.

**Verification**: tests first (core, CLI, server and the e2e spec all failed before the code).
587 unit tests, 67 e2e. On a clone of this repository through `symbiote view`'s API: `v12` reviewed
at `d175ee5` (83 symbols marked), tip moved to `86dcb60`: "+1", then 83 still reviewed and 2
left, as the spike measured; 1.6–1.7 s from "Review" to the graph; `git status` clean.
`/api/reviews` 10–24 ms on Qwik and Bitwarden. No analysis code changed (goldens unchanged), so
no regression comparison. Not verified: Windows, macOS, a review merged from two machines,
worktrees, Firefox and Safari.

Merged into main (2026-10-14). `main` verified after the merge: 587 unit tests, build, 67 e2e.

## V16 spike — how a review ends (2026-10-14, branch `milestone/v16-finish-review`)

Asked after reviewing V15 with the viewer: "how to end review?". The reviewer's state for that
review (`4061f2b..60d94e1`, compare mode, in Symbiote's cache): 86 of the 87 changed symbols marked,
no comments. None were possible: comments, the summary and a verdict exist only under `symbiote pr`,
where the forge receives them, so `symbiote view` hides them, branch reviews included. Feedback to
the agent went through chat instead, without a place: "bad styling on checkout option in
dropdown" took two close-up screenshots to locate. Checked for the plan: the server's address
(`http://127.0.0.1:<port>`) is a secure context in Chromium, so the page may copy to the
clipboard; graph nodes carry line ranges per side, so a comment's line names its symbol. So the
plan gives branch reviews a local review target behind the same `/api/review`: a verdict
recorded at the tip with its comments in the review's JSON (the user preferred JSON to a
Markdown file: one file, structured fields), text only for "Copy for the agent". Asked too:
Approve pushes to the remote, only then, and `symbiote pr` stays as it is. Checked in a temporary
repository with a bare remote: `git push origin <sha>:refs/heads/<branch>` pushes that commit
and no later one, updates `origin/<branch>`, creates a missing branch (then the upstream can be
set), and a push that is not a fast-forward is refused with git's message. So Approve pushes the
reviewed SHA, never the branch name, never forced.

## V16 — Finish a review (2026-10-14, branch `milestone/v16-finish-review`)

A branch review ends with a verdict in the Review tab — Approve, Request changes or Comment —
recorded with its comments in the review's JSON (`verdicts`), where the agent reads them; "Copy
for the agent" puts them on the clipboard as text. Approve pushes the reviewed commit by SHA,
never forced; newer commits stay local. The default branch is reviewable from where it was last
pushed. `symbiote pr` is unchanged.

**Learned**:
- The user preferred JSON to a Markdown feedback file: one file holds the review and its
  outcome, with fields a script can read; the text for a chat is rendered from it.
- `git push <remote> <sha>:refs/heads/<branch>` is the safe push for a review: it sends the
  commit reviewed and no later one, updates the remote-tracking ref, creates a missing branch,
  and git refuses what is not a fast-forward — checked against a bare remote before planning.
- A draft already knows its symbol: sending it is exact, where mapping a line back to a symbol
  on the server would guess at nested ranges.
- `toReview` folds line-less drafts into the summary for a forge; a local verdict keeps them as
  comments, so the agent gets each with its symbol.
- A test that ends right after a verdict races the viewer's save of the cleared drafts with the
  fixture's cleanup (`ENOTEMPTY`): the cleanup retries.
- A screenshot script that pressed `c` before the code loaded lost nothing but added nothing:
  the panel waits for the code to know the line (`symbiote pr`'s rule).

**Verification**: tests first (core, CLI, server, viewer failed before the code). 599 unit
tests, 69 e2e. On a clone of this repository with a local bare `origin`: `v12` reviewed with
three comments, Request changes in 12 ms (three code lines in the verdict), Approve with the push
in 73 ms (`origin` at the reviewed commit, upstream set, `git status` clean). Screenshots light
and dark. No analysis code changed. Not verified: remotes that need credentials, slow
`pre-push` hooks, Windows, macOS, Firefox and Safari.

Merged into main (2026-10-14). `main` verified after the merge: 599 unit tests, build, 69 e2e.
The reviewer approved V16 in Symbiote itself (one comment, on `ReviewProps`); its push was a no-op,
`origin` already at the reviewed commit.

## Fix — a review's mark you can see on a badge (2026-10-14, branch `fix/review-mark-visible`)

Asked after V16: "The review checkmark is not really visible". V15–V16 put the mark in the
badge's own text: on this repository's commits page, a 10×14 px "✓" in grey on remote badges and
blue on local ones, read as part of the branch name. Each mark now carries its tone and is a
filled 14 px chip: "✓" green, "✗" red, "+n" blue (the colour of the dot on commits since), "…"
grey; on HEAD's solid green badge the chip is light, in its tone. The badge keeps its height
(rows have a fixed height anyway); the overflow badge "+2" (hidden badges) stays plain, so it no
longer looks like "+2 commits since".

**Verification**: unit tests for the tone (red before), and the V16 e2e flow checks the "✗" and
"✓" chips' classes, a filled background in a colour other than the badge's, and a chip lower
than its badge (red before: the class was missing). 599 unit tests, 69 e2e. Screenshots light and
dark on this repository (V16 and the skill branch approved) and on a clone with every state
(approved, changes requested, +1, in progress, HEAD on an approved branch), no page errors.

Merged into main (2026-10-14). `main` verified after the merge: 599 unit tests, build, 69 e2e.

## Fix — Compare mode at the header's right (2026-10-14, branch `fix/compare-button-right`)

Asked: "Move the compare mode button on the right side". It sat between the branch scopes and the
HEAD chip (on this repository at 1440 px, its right edge 745 px short of the list's), and turning
it on widened it ("x" → "Esc"), moving the HEAD chip. It is now last in the header, its right edge
in line with the list's; the keys' help fills the space before it and wraps inside it (compare
mode's longer help: two lines at 1440 px, the header 42 px instead of 49), so the toggle stays in
place when turned on. Narrower (900 px), it goes to the second line, still at the right.

**Verification**: an e2e test at 1280 and 760 px — the toggle's right edge within 1 px of the
list's, the same right edge and height on and off (red before: 713 px off). 599 unit tests,
70 e2e. Screenshots at 1440 and 900 px, on and off, no page errors.

Merged into main (2026-10-14). `main` verified after the merge: 599 unit tests, build, 70 e2e.

## V17 spike — what an approval should do (2026-10-14, branch `milestone/v17-approve-means-merge`)

Asked after approving four branches in Symbiote and asking for each merge in chat: "How can we automate
this…", then "Aprove is just a metadata...that will tell the agent to merge into whichever is the
default branch of that git repository", for any repository, and "not automatically" (the person
tells the agent to act on the review). Measured on this repository: V16's push on Approve did
nothing on 0 of 4 approvals — the agent had pushed each commit 2–4 minutes before, and `origin`'s
reflog holds only the agent's push — while all 4 were followed by asking for the merge in chat.
Reproduced through `symbiote view`'s `/api/reviews` on a temporary repository: a branch approved at its
tip, then 5 commits on `main` merged into it, shows "+6" and the "new since your review" dot on
all 5 of `main`'s commits; the branch's own new commits: 1, the merge. So "since" must leave out
the default branch's commits, or resolving a conflict the usual way (merging the default branch
in) floods the review. Checked `git merge-tree --write-tree --name-only` (git 2.43 here; 2.38+)
against the default branch on 40 recent unmerged branches each: Bitwarden 2 conflicting, median
3 ms, max 871 ms; Qwik 19 conflicting (long-lived lines such as `v1`, `v3`, 57–59 files), median
599 ms, max 5.2 s; this repository's 70 branches are all merged. It touches no checkout, index or
ref (it writes loose objects), so the Review tab can say "conflicts with main in …" before an
approval, in the background. The rules an agent follows lived only in this repository's
`symbiote-review` skill; for any repository Symbiote must write them itself, next to the reviews.

## V17 — Approve means "merge it" (2026-10-14, branch `milestone/v17-approve-means-merge`)

**Learned**:

- Claude Code loads a folder's `AGENTS.md` itself when it reads a file there, a git-ignored
  folder included: with only a review file read (one `Read` in the log) it knew a marker word
  that only `symbiote/AGENTS.md` held, with or without a `symbiote/CLAUDE.md`; reading the same JSON from
  another folder, it did not. The planned `symbiote/CLAUDE.md` would only have loaded it twice.
- An agent told nothing but "Check my Symbiote review of the branch agent and act on it" found
  `symbiote/` by listing the repository, and followed `AGENTS.md` to the letter in both cases tried:
  the approved commit merged with `--no-ff` and the later one left for review; on a conflict, the
  merge aborted, `main` untouched, the conflict resolved on the branch, another review asked for.
  Neither pushed: the rules say to follow the project's, and the repositories had none.
- `git merge-tree` reports conflicts with exit 1 and its answer on stdout; `GitError` now keeps
  stdout. It writes loose objects only: no ref, index or file moved (a test checks it).
- On Qwik the conflicting paths took six lines of the sidebar. Asked then for "each file on
  it's line..with a icon that opens the file in vscode": a list, V12's icon on each, which opens
  the file through `/api/open` — extended to a branch review's conflicting files, since those
  need not be in the change (Qwik's `.api.md`). Tests first (the server refused `docs/api.md`;
  the e2e found no list on the old viewer).
- The V17a–b commit says "CLI 8" tests failed first; it was 11 (and 2 in the server).

**Verification**: tests first (core 3, CLI 11, server 2, viewer 2; e2e 3 of 4 review specs on
the old viewer). 602 unit tests, 71 e2e. The two agent runs above, checked in git afterwards
(`main`'s parents, the later commit not in `main`, `origin` unchanged, clean status) and in Symbiote
("+1" each; "merged" after the clean one; clean merge after the resolution). Qwik's
`origin/claude/http-error`: the conflict line 0.5 s after opening the Review tab, the graph in
6.7–10.3 s; screenshots light and dark, no page errors. Not verified: other agents than Claude
Code, git before 2.38, Windows and macOS.

Merged into main (2026-10-14). `main` verified after the merge: 602 unit tests, build, 71 e2e.
The first use of the flow: the reviewer approved `92c5276` in Symbiote ("Merge into main") and pasted
"Copy for the agent"; the agent read the verdict and `symbiote/AGENTS.md` (Symbiote had written it with
the verdict) and merged that commit, its parents the old `main` and `92c5276`.

## V10c spike — what diverged picks show (2026-10-14, branch `milestone/v10c-picks-across-branches`)

Measured on the regression clones (every branch listed, HEAD as checked out there) before
refining V10's plan for picks across branches. Pairs picked among the rows a reader sees first
are often diverged: among the first 25 rows, 19–74 % of pairs on Qwik, vite, zod and Bitwarden
(0.7 % on this repository, whose branches are all merged). Against HEAD, the 20 unmerged remote
tips nearest the top were diverged in 71 of 80 cases, and a direct diff — what the server runs
today (`--no-merge-base`) — listed a median 99–208 files where the branch changed 5–15: 67–96 %
of its files were the default branch's work shown as reverted. Through Symbiote, a Qwik branch read as
43 files with 6 removed symbols and 3 findings; from its fork point, 7 files, none removed, 1
finding. In all 71 pairs the branch's tip was the lower row, today's base: a fork-point diff with
today's rule would have shown `main`'s work instead of the branch's.

**Learned**:
- The fork point can be found in the page from the shape alone: in graph order a row's children
  are all above it, so painting down from both picks and taking the first row both reach gives a
  best common ancestor, and counting rows reached by one side gives `rev-list --left-right
  --count`. Against git on 1,800 random pairs (six repositories, rows < 2,000): fork 1,800 equal
  to `git merge-base`, counts 1,800 equal, at most 2.0 ms. The server needs no change to diff
  from it.
- The first prototype stopped as soon as no one-sided row was left, which can happen before the
  scan reaches the fork row (its flags already joined): every ancestor pair came out without a
  fork. The rows still marked after the stop are all reached by both; the first of them is it.
- Qwik has unrelated lines: 39 of 300 random pairs share no history (`git merge-base` exits 1).
- Which side is the base matters as much as the fork point. "On HEAD's line" fixes the
  measured case only while the default branch is checked out; here the agent's branch often is.
  The default branch's line, then HEAD's, then the older row, covers both.

## V10c — Picks across branches (2026-10-14, branch `milestone/v10c-picks-across-branches`)

Two picks on lines that diverged are compared from their fork point, as a pull request is: the
page finds it from the history's shape and sends it as the base, so the server is unchanged.
The base's side is the pick on the default branch's line, else HEAD's, else the lower row; the
compare bar says the picks diverged, the fork's SHA goes to its row (ringed with dashes), and
Swap compares the other side. An ancestor pair and one pick against its parent are as before.

**Learned**:
- The shape is row numbers: the fork point's SHA is only known once its row's details are loaded.
  `comparison` takes the loaded SHAs and says "Finding where … forked…" until the page has
  loaded the fork's block (one request).
- What a reviewer reads is the graph, so "correct" was checked there, not only on the fork
  point: through `symbiote view`'s own server, the pair the page sends gave exactly the branch's
  files (`git diff A...B`) and the same graph as `symbiote diff A B` on 12 of 12 branches. The pair
  `main`'s page sent showed the branch's own work inverted: zod's 100 added symbols as 100
  removed, Qwik's 151 the same.
- Reading the default branch's tips after git's listing cost the shape 26–35 ms on Bitwarden;
  started alongside the listing, 9–12 ms.
- Swap keeps focus after a click, and a focused button takes Enter (V9): Enter right after Swap
  swaps back. The e2e test first pressed Enter there and found it.
- `--format='%H %P'` ends a root commit's line with a space: split on spaces, the root gets an
  empty parent. The new check script drops it; `scripts/viewer/lanes-check.mjs` (V10a) does not
  and gives every root a parent outside the history (`-1`). The server parses it right (`%x1f`,
  empty means none). Not fixed here.

**Verification**: tests first — 13 unit tests failed before the code (viewer 11, 4 of them
existing tests moved to the new API; core 1; CLI 1); on `main`'s build 3 of the 4 new e2e tests
failed on the label. 613 unit tests, 75 e2e. `compare-check.mjs` against git: 5,983 random pairs
on ky, zod, vite, Qwik, Bitwarden and CPython (1,199 diverged, 157 with no shared history, 1
criss-cross) and 998 on this repository's "This branch": the fork point, both sides' counts and
the base's side right on every pair; the default branch against every diverged remote branch
(1,868) gave the branch as head from the fork; at most 3.2 ms per comparison (CPython).
`diverged-diffs.mjs` on zod, vite, Qwik and Bitwarden (3 branches each): 12 of 12 as above.
Screenshots on Qwik, light and dark, no page errors. Cold `symbiote view` against `main`'s build:
first rows unchanged; the shape +9–12 ms (Bitwarden), within noise on CPython. Not verified:
Windows, macOS, Firefox, Safari; a repository with no `main`, `master` or remote `HEAD`.

Merged into main (2026-10-14). `main` verified after the merge: 613 unit tests, build, 75 e2e.

## V10b spike — what a branches panel holds (2026-10-14, branch `milestone/v10b-branches-panel`)

Measured on this repository and the regression clones before refining V10's plan for the
panel, with `listRefs` (as the row menu calls it) and the commits page's order. Tips sit deep:
the median remote tip is row 155 here, 691–16,397 elsewhere (Bitwarden 9,165, its deepest
37,633), and only 4–74 tips per repository are in the first 200 rows — a branch cannot be
reached by scrolling. Bitwarden's 1,591 remote branches nest up to 3 folders deep (105 folders),
but 519 are in none: closed folders still leave a 624-entry list, so the filter is what makes it
short. Names: median 18–29 characters, p90 up to 58, the longest 133, against about 35 that fit
in 260 px. `listRefs` takes 4–23 ms. This repository has 14 local branches (13 tracking one),
the clones one each. The plan: tips' rows from the kept listing (`/api/history/refs`), Local and
Remotes by nested folder with a filter, a click to the tip row.

## V10b — Branches panel (2026-10-14, branch `milestone/v10b-branches-panel`)

A panel left of the commits lists local branches (ahead/behind, gone) and remote ones by nested
folder, with a filter and the review marks badges show; a click puts the cursor on the branch's
tip row anywhere in the history. `GET /api/history/refs` gives each tip's row in the kept
listing. From "This branch", a branch it does not list switches to every branch first. `/`
focuses the filter, Enter there goes to the first branch listed; under 900 px a "Branches"
button opens the panel over the rows.

**Learned**:
- The viewer blurs any text field on Escape (`App.tsx`), before a field's own handler can keep
  focus: the plan's "Escape clears, then leaves" lost to it in the first e2e run. Following the
  app's rule keeps the filter and the change list's search alike. A `type="search"` field also
  clears itself on Escape in Chromium; the filter is `type="text"`, as the search is.
- A panel beside the rows took 260 px from them, and rows with two long branch badges then
  pushed their date out of view at 900–1,100 px. Badges never shrank; `main` showed the same at
  800 px. Measuring each visible row's date against the list's edge, per width, found it; the
  screenshots at 1440 px did not.
- Chromium reads a large `style.top` back rounded (`1.20426e+06px` for 1,204,256 px) while
  drawing it exactly: read a deep row's place from its box, not its style.
- `requestAnimationFrame` before focusing: under 900 px the filter is not displayed until the
  panel opens, and focusing it in the same task does nothing.

**Verification**: tests first — 6 unit tests failed before the code; 7 of 7 new e2e tests fail
on `main`'s build. 619 unit tests, 82 e2e. Bitwarden (1,591 remote branches): the panel drawn
44–61 ms after the first rows, 628 entries; no animation frame over 50 ms while filtering or
going to the deepest tip (row 37,633, 89–94 ms to its row drawn with details); first rows as
`main`'s. Rows clipped from 800 to 1,920 px on this repository, Bitwarden and Qwik: 0 (before
the badge fix, 3–8 between 900 and 1,100 px). Not verified: Windows, macOS, Firefox, Safari.

Merged into main (2026-10-14). `main` verified after the merge: 619 unit tests, build, 82 e2e.

## Fix — lanes-check and root commits (2026-10-14, branch `fix/lanes-check-root-commits`)

Found while checking V10c's comparisons: `git log --format='%H %P'` ends a root commit's line
with a space, and `scripts/viewer/lanes-check.mjs` split it into one parent named `''`, a parent
outside the history (`-1`). `layoutLanes` then gave the root a down-arrow "Its parent is below
the commits listed" whenever more than 100 rows followed, and the script's partner check skipped
it (no row to find). The page never had it: the server reads `%H%x1f%P` and an empty field as
no parents. The script now reads git's output the same way.

**Verification**: on the six regression clones and this repository, before and after: lane
widths identical (max, p95, mean); arrows zod 15 → 14, Qwik 241 → 240, Bitwarden 1,943 → 1,939
(one per extra root), others unchanged; 0 errors after. V10a's published arrow counts are
corrected in PLAN.md (a note under its table) and its journal entry. No product code changed.

Merged into main (2026-10-14). `main` verified after the merge: 619 unit tests, build, 82 e2e; `lanes-check.mjs` on this repository: 0 errors.

## V18 spike — what starting a feature with an agent takes (2026-10-15, branch `milestone/v18-start-a-feature`)

Asked: "Start a new feature" from the commits page, continuing the agentic flow. The person chose
Symbiote starting the agent, a worktree per feature and "plan first" per feature, and asked for a
design for any repository, not shaped by how this one is worked on. Measured before planning:

- `git worktree add` at the default branch's tip, warm, on the regression clones: ky 12–20 ms
  (1.7 MB) to Bitwarden 644–854 ms (173 MB); CPython 453–463 ms warm but 10.4 s cold.
- Claude Code's own worktrees (`--worktree`, and background sessions isolating themselves before
  their first edit) live in `.claude/worktrees/` inside the checkout, on `worktree-<name>`
  branched from the remote default branch. None of the six clones ignores that folder, zod's root
  tsconfig includes `**/*.ts`, and in this repository a root `prettier --check .` failed on 58
  files of a nested worktree (removed after). So Symbiote makes the worktree itself, beside the
  checkout, at the commit the person picks; Claude Code skips its own isolation in a linked
  worktree.
- `claude --bg` refused all three folders tried (this repository's checkout, a worktree of it, a
  new repository's worktree): "Workspace not trusted. Run `claude` in … once and accept the trust
  prompt", exit 1 in 0.7 s. Trust is keyed on the main checkout's root and only an interactive
  `claude` accepts it: a page cannot, and Symbiote must not write it. The feature must survive a
  failed start and the agent be restartable.
- `claude -p` (no trust step) in a worktree made with `git worktree add -b`, Haiku, a one-file
  task: the commit landed on the feature branch, the main checkout untouched, `--session-id`
  honoured, 8.5 s and $0.006; its stream has a `vcs_state_changed` event per commit. `-p` runs
  are not in `claude agents --json`, and cannot ask for a permission or an answer: background
  sessions can, and report `state` (`working`, `blocked`, `done`, `failed`, `stopped`) and
  `waitingFor`, listed in 153–158 ms. The worktree folder is what ties a session to its branch.
- From a feature's worktree, Approve's `git switch <default branch>` fails while the main checkout
  has that branch, and Claude Code's isolation refuses git in the main checkout: the approved
  merge happens from the main checkout. Reviews are kept per working tree today (`symbiote/` at
  `symbiote view`'s root), so a `symbiote view` opened in a worktree would keep its own.

Not yet run: `claude --bg` end to end (states from start to `done`, `--bg --resume`, `--add-dir`
and `--session-id` with `--bg`), which needs a repository the person has trusted; it is the first
step of the plan.

## V18a — Start a feature (2026-10-15, branch `milestone/v18-start-a-feature`)

"Start a feature" in the commits page's header (or `n`, or "Start a feature here" in a row's
menu) asks what the agent should build, proposes a branch named after it, creates the branch at
the default branch's newest tip (or the row's commit) with its own worktree beside the checkout
(`../<repo>.worktrees/<branch>`), records the brief in `symbiote/features/<branch>.json` and starts
Claude Code there in the background (`claude --bg --name <branch> --add-dir <symbiote>`, the
person's permission mode, plan first by default). A failed start keeps the feature with Claude
Code's words; without an agent the prompt is offered to copy. Reviews now live in the main
checkout's `symbiote/`, shared by its worktrees.

**Learned**:
- The real-agent spike was skipped at the person's word; Symbiote relies on Claude Code's documented
  interfaces only (`agents --json` for scripts, not `--bg`'s printed text) and the tests run a
  fake through `SYMBIOTE_CLAUDE`, which every feature spec sets: no test can start a real agent.
- A start costs what `git worktree add` costs: 0.1 s on ky, 0.85–0.9 s on Bitwarden; listing three
  features with their agents 37–64 ms, one `claude agents` call per list.
- Adding a header button wrapped the help line to three lines and both buttons to a second row at
  1440 px (seen only in a screenshot); grouped at the right with key badges, the header measures
  as `main`'s except 10 px at 1100 px with a long branch checked out.
- Playwright's `getByLabel('Branch')` matched the brief's field too once the brief said "branch"
  (a label's text includes its text area's content): find fields by role and exact name.
- `git branch -D` refuses a branch checked out in a worktree, even one whose folder was deleted,
  until `git worktree prune`; a cleanup script that ignored the error left a branch the dialog then
  rightly called taken.

**Verification**: tests first (core 5 of 5, server 4, the CLI and viewer modules missing). 653
unit tests (34 new), 87 e2e (5 new; 3 expectations gained the new menu entry), all passing. On the
six regression clones through `symbiote view`'s API with the fake agent: 18 features started at their
base, each checkout's `git status` unchanged, all removed after. Screenshots light and dark at
1440 and 900 px, no page errors. No analysis code changed. Not verified: a real Claude Code
started by Symbiote, Windows and macOS, Firefox and Safari.

Merged into main (2026-10-15), V18a–c together. `main` verified after the merge: 692 unit
tests, build, 98 e2e.

## V18b — The features view (2026-10-15, branch `milestone/v18-start-a-feature`)

`/features` lists the features started from Symbiote grouped by what each needs from the person —
Needs you, Working, Done — with its agent's state in words, its commits, files not committed, its
review and whether it merges, and Review, Talk, Open in VS Code, Stop / Start the agent, Copy the
prompt. "Commits · Features (n)" in the bar counts what needs the person. A feature and its branch
lead to each other: the mark on the branch's badge (and in the branches panel), "Open its
feature" on its row, the review page's header; the branch name on a feature goes to its tip
(`/?branch=`). An agent's commits show on the commits page as they come, the cursor kept.

**Learned**:
- A feature waits on `main`'s row until its agent commits, and that row already shows three
  badges: the first screenshot had both features' marks folded into "+2". The folded badge now
  carries the most urgent mark; looking at real rows found it, the unit tests had one branch.
- A link cannot sit inside a button: in the branches panel the mark is beside the entry.
- Listing anew resets the cursor to HEAD (V11); doing that whenever an agent commits would move
  the view under the reader, so the cursor's commit and its place in the view are kept.
- The server keeps Claude Code's sessions 2 s (each call is ~155 ms): an e2e test that changes the
  fake's state must wait for the page's next read, not reload at once.
- Adding a menu entry made a checkout e2e premise ("the taller submenu moves up") false at that
  window size; the window check it guards still holds.

**Verification**: tests first (core 1, CLI 3, server 2, editor 2, viewer 6). 667 unit tests, 92
e2e (5 new), all passing. Screenshots on a clone of this repository with three features, light
and dark, 1440 and 900 px, no page errors. First rows against `main`'s build: Bitwarden 982–998
against 984–1,042 ms, ky 975–991 against 973–1,004 ms; the bar 37 px on both. Not verified: a
real Claude Code session stopped or attached, VS Code opening a worktree for real, Windows,
macOS, Firefox, Safari.

Merged into main (2026-10-15), V18a–c together. `main` verified after the merge: 692 unit
tests, build, 98 e2e.

## V18c spike — answering a background agent from Symbiote (2026-10-15, branch `milestone/v18-start-a-feature`)

Asked: V18c moves "one abstraction up from Claude Code": not a chat with one input. Question:
can Symbiote see and answer what a `claude --bg` session waits on (a question, a permission, a plan)
while Claude Code keeps hosting the session? Run with Claude Code 2.1.296 (the background service
ran its sessions on 2.1.300), Haiku, the person's Pro subscription and no API key. A throwaway
repository in `~/projects` with a feature worktree beside it, as V18a makes them; `claude` run
with a clean environment, as a `symbiote view` started in a terminal would; a stand-in for Symbiote passed
with `--settings`: command hooks that log every event and, for a question or a permission, wait
for an answer file, as Symbiote's server would wait for the person.

**Learned**:
- **Trust**: a repository inside a trusted folder (`~/projects`) is not trusted: `--bg` exited 1
  in 0.6 s, the message naming the worktree's folder. Once the person trusted the main checkout
  (one interactive `claude` there), its worktree started: trust is the main checkout's, as
  documented. `--bg` returned in 0.7–0.9 s, starting the background service.
- **Permission mode**: without `--permission-mode` the session ran in `auto`, the account's own
  default. In `auto` a classifier decides and permission requests are rare; `manual` is today's
  name of the old default and prompts for edits and commands.
- **Hooks from `--settings` run in a background session**: `SessionStart`, `UserPromptSubmit`,
  `PreToolUse`, `PermissionRequest`, `Notification` (`permission_prompt` about 6 s after a
  request, `idle_prompt` 60 s after a turn ends), `Stop`, `SessionEnd`; each with `session_id`
  and `cwd`. Whether the person's own hooks (`~/.claude/settings.json` has three) ran beside
  them was not checked.
- **A question** (`AskUserQuestion`) reached a `PreToolUse` hook whole: question, header, options
  and their descriptions. `allow` with `updatedInput.answers` after 20 s: the agent took the
  answer. While that hook waits, `claude agents` says `working`.
- **A permission** reached the `PermissionRequest` hook with `tool_name` and the full
  `tool_input` (an `Edit`'s old and new text; a Bash command) and Claude Code's suggestion
  (`acceptEdits` for the session). `allow`: it went on (edit, check, commit, 10–18 s each).
  `deny` with a message ("read the diff in Symbiote first, do not commit"): the agent left the change
  uncommitted and quoted the reason. While that hook waits, `claude agents` says `blocked` ·
  `permission prompt`: the dialog is open beside the hook, the first answer wins.
- **When a hook times out** (set to 15 s): the question's `PreToolUse` hook gave way to Claude
  Code's dialog, which fired `PermissionRequest` for `AskUserQuestion`; answering that one with
  `allow` and `updatedInput.answers` worked (12 s, "You picked Blue"). One hook can answer both
  permissions and questions. If it times out too, the dialog stays: `blocked` · `input needed`
  until someone attaches.
- **The plan**: the `Stop` hook's `last_assistant_message` held the whole plan (Markdown); no
  transcript to read. After it, with no commits, `claude agents` said `blocked` with no
  `waitingFor`, not `done` as documented: V18b shows that as "Waiting: for you", not "Plan ready".
  After the agent committed: `done`.
- **Replies**: `--bg --resume <id> "text"` on a session whose process is alive (idle after its
  turn) started a copy under a new ID, without the original's `--settings`: no hook fired, and it
  then sat at a permission prompt nothing outside could answer. Any flag on a resume also made a
  copy ("keeps its own saved options"). `claude stop` (0.66 s), then `--bg --resume <id> "text"`
  with no flags (0.73 s) continued the same session with its saved permission mode, settings and
  model: the hooks fired again and the reply arrived as the person's prompt. So the hooks must be
  in the first launch.
- **Clean up**: `claude rm` on the four sessions that ran in the Symbiote-made worktree removed the
  sessions only; the worktree and branch stayed (after a merge into `main`), and `git worktree
  remove` and `git branch -d` removed them.
- A session renames itself (`spike-plan` became `greet-farewell-punctuation`), and `claude logs`
  prints a terminal screen with escape codes: match sessions by folder, never parse logs.

**Not tested**: a hook waiting longer than 20 s (documented default 600 s, `timeout` per hook); a
hook that cannot reach Symbiote (`symbiote view` closed); the session's inbox socket; a session whose
process the supervisor stopped after an hour idle; Windows and macOS. Four sessions, all removed
with the repository; Claude Code's own records of them (transcripts, the trust entry) remain in
`~/.claude` and `~/.claude.json` (`claude purge <path>` removes them).

**Second run** (the two checks the V18c plan asked for first; one Haiku session in the same
throwaway repository, recreated at the path the person had trusted, so no trust step; the
repository's `.claude/settings.json` committed with a `SessionStart` hook and a
`Bash(node --version)` allow rule; Symbiote's stand-in hooks in a settings file labelled `symbiote-v1`):
- **The person's settings still apply beside `--settings`**: the repository's hook, Symbiote's hooks
  and the person's own `SessionStart` hook all ran (GSD's update check wrote its cache in the same
  second as the session's start). No permission was asked for `node --version`; that may be
  Claude Code's own list of read-only commands rather than the rule, so the rule is not shown.
- **A waking session reads its settings file again**: rewritten as `symbiote-v2` while the session was
  stopped, the resume ("woke session … with its saved options (--name, --permission-mode,
  --settings, --model)") ran the `symbiote-v2` hooks.
- **The file must be there when it wakes**: moved away, the resume exited 0 but the session
  failed ("exit 1 before init — Error: Settings file not found: …"); with the file back, the next
  resume continued the same session.

## V18c — Talking to the agent (2026-10-15, branch `milestone/v18-start-a-feature`)

Asked to move "one abstraction up from Claude Code", starting simple with one box, beside the
list. The features view is now a list and a panel: picking a feature shows its state and
actions, its thread — Symbiote's prompt, the agent's plans and reports, the person's messages, what
the agent waits on — and one box whose message continues the agent's own session. "Send the
verdict" (and "Send to the agent" in the Review tab) fills the box with the review's verdict.
Clean up removes a merged feature's sessions, worktree and branch. The thread is recorded by
hooks Symbiote gives every agent it starts (`--settings <symbiote>/claude-settings.json`), which decide
nothing: answering permissions and questions in Symbiote is V20b (planned as V18e), on the same
hooks.

**Learned**:
- **A reply is stop, then resume with no flag.** Measured in the spike: a resume of a live
  session, or with any flag, starts a copy without the hooks. With a real agent the same session
  continued twice (1.6 s each), its hooks still firing.
- **The first hooks fire before `--bg` returns.** Symbiote saved the feature's record after the start,
  so the hook found no feature for the session's first events. The e2e fake caught it because it
  runs the hooks of its `--settings` file as Claude Code does; a fake that only records argv would
  not have.
- **A hook is a process per event**: a script with Node's modules only costs 22–23 ms; going
  through Symbiote's CLI, which loads the engine, 286 ms. `thread.ts` stays free of `@symbiote/core`.
- **Two layout bugs only a browser showed**: rows with no brief in the 360 px list (the branch
  took the line), and, with a real agent's long plan, a thread that opened at its oldest entry
  with the fix out of sight. Unit tests and the e2e specs with short messages passed both.
- **A finished plan is `blocked`, not `done`**: with the thread's last report after its last
  prompt, Symbiote reads it as "plan ready" — confirmed with the real agent.
- **The 2 s session cache again**: an e2e that set the fake's state and reloaded pressed Send
  while the page still said "Working", and the panel rightly asked before stopping the agent.
  Tests wait for the page's next read, as V18b's journal says.
- A limit, not tried: `git branch -d` checks the merge against the branch's upstream, else
  `HEAD` (git's documented rule), so with another branch checked out where `symbiote view` runs, Clean
  up's branch deletion would be refused in git's words, the worktree already removed.

**Verification**: tests first (core 2, thread 8, features 10, server 1, reviews 1, viewer 4, e2e
8). 692 unit tests, 98 e2e, all passing. A real Claude Code (Haiku, Pro subscription, `auto`)
driven through `symbiote view`'s API: start 1.0 s, plan 13 s and "plan ready", reply 1.6 s and a commit
13 s later, a verdict sent back 1.6 s and a fix 9 s later, Clean up 1.4 s; everything made was
removed. Screenshots light and dark at 1440 and 900 px, no page errors. Not verified: permissions
and questions from a real agent in the panel, a session woken outside Symbiote, `symbiote view` closed
while an agent works, an unmerged Clean up with a real agent, Windows and macOS, Firefox and
Safari.

Merged into main (2026-10-15), V18a–c together. `main` verified after the merge: 692 unit
tests, build, 98 e2e.

## V21 spike — Claude Code's own terminal in a feature's panel (2026-10-15, branch `milestone/v21-agent-terminal`)

Asked: could the chat the person uses (Claude Code) be in Symbiote instead of V18c's box; of the
ways compared (the Agent SDK hosting the session in `symbiote view`, `claude attach` in a terminal in
the page, V18c with more hooks), "is it easier to do like this?" — the terminal. Question: does
`claude attach <id>` in a pseudo-terminal, drawn by xterm.js in a page, give the whole session
while Claude Code keeps hosting it? Run with Claude Code 2.1.300, Haiku, the person's Pro
subscription: a background session (`--bg`, `manual` permission mode, a hooks file that logs
every event) in a detached worktree of this repository (trusted), started with a clean
environment; a spike server (node-pty 1.1.0, output by server-sent events, keys and resizes as
same-origin JSON POSTs with `x-symbiote`, as every write today) and xterm.js 6.0.0 in Chromium
(Playwright 1.63).

**Learned**:
- **It works whole.** `attach` in node-pty printed its first output in 152–174 ms (4 attaches).
  xterm.js drew Claude Code exactly as a terminal does (123 × 45 at 1000 × 700, 77 columns at
  640 px, reflowed on resize), the person's status line included; a page that joined late got
  the history in 8 ms; no page errors. A key to its echo on screen: median 22 ms, max 37 ms (30
  keys, Playwright's overhead included); the server's write to the next output: median 3 ms,
  p90 21, max 69 (78 writes). Each attach is a Claude Code process: 140 MB resident.
- **Permissions in the page**: a `Write` waited on its dialog (the new file's text shown);
  Enter in the page allowed it, the file was written, `PostToolUse` and `Stop` hooks fired as
  without a terminal.
- **Esc**: on a permission prompt it denies and ends the turn; mid-answer it interrupts
  ("Interrupted · What should Claude do instead?"). Both times **no hook fired** (no `Stop`, no
  `Notification`), and `claude agents` said `status: idle`, `state: working` until the next turn
  ended (11:04 to 11:06:24, across a stop and a restart). V18b's rule reads `state` first, so the
  features view says "Working" for an agent that waits on the person. This already happens on
  `main` when someone attaches through Talk and presses Esc.
- **Typed messages reach the thread**: each prompt typed in the terminal fired
  `UserPromptSubmit`. A message typed while the agent worked was queued ("Press up to edit queued
  messages") and answered after the current turn, each turn with its `Stop`: what V18 left for
  later ("a message kept for the end of the agent's turn") is Claude Code's own behaviour here.
- **Symbiote should type one line at most.** A bracketed paste arrived as `<pasted_content id=…>`,
  which Claude Code tells the agent to treat as text the person may not have written (the agent
  followed it this time); the thread got the wrapper too. Multi-line text typed with
  backslash-Enter kept its backslashes, and its first Enter did not submit. One line, then
  Enter, submitted 4 of 4.
- **Two clients** on one session both drew it and both could answer; the session drew at the
  newest client's size (the 123-column client showed 100-column lines). Hanging one up (SIGHUP,
  as a closed tab) left the session running, same process.
- **`claude stop` while attached**: the client printed "Session … has exited" and exited 0;
  `SessionEnd` fired. **`attach` on a stopped session restarts it** under the same ID with its
  saved options (`SessionStart` `resume`, the hooks file, `manual` mode), without a turn.
  `attach` to an unknown ID printed "No job matching…" and **exited 0**.
- **← on an empty prompt opens Claude Code's agent view**: every background session (one of the
  person's other sessions was listed), a box to start a new session, reply to another, delete
  one (ctrl+x). A panel cannot keep the terminal on its feature's session.
- **Light background**: Claude Code keeps its own theme; on white its `●` marks vanished and
  prompts sat on dark bars. Its theme is Claude Code's setting, not the client's.
- **node-pty 1.1.0** ships prebuilt binaries for macOS and Windows only (64 MB unpacked). On
  Linux it compiles one C++ file with node-gyp (1.6 s with Node's headers cached; needs
  python3, make, g++); pnpm 10+ skips its build script until allowed (`onlyBuiltDependencies`),
  and the module then fails to load. Built on Node 26 it loaded on Node 24 (Node-API).
- **xterm.js 6.0.0**: 345 KB minified (89 KB gzip), 7 KB CSS, the fit add-on 2 KB; the viewer's
  main bundle is 564 KB today.
- The CI matrix (Ubuntu with Node 22 and 24, macOS with 24), the Action (`action/install.sh`)
  and the GitLab template (`node:22`) install the whole workspace.
- Restarting the spike server with `kill $(pgrep -f '[n]ode server.mjs')` in a command that also
  started `node server.mjs` killed that shell (CLAUDE.md's `pkill` trap, once more).

**Not tested**: Windows (ConPTY) and macOS; Firefox and Safari; a question (`AskUserQuestion`)
answered in the page; a session in `failed`; `symbiote view` itself (the spike server stood in for
it); `pnpm install --no-optional` with a frozen lockfile. Everything made was removed: the
session (`claude stop`, `claude rm`), the worktree, and Claude Code's records of its folder
(`claude purge`: the transcript, 8 prompts in the history, the config entry).

## Fix — an interrupted agent waits for you (2026-10-18, branch `fix/agent-idle-after-interrupt`)

Found in the V21 spike (branch `milestone/v21-agent-terminal`) and asked: "starting with the
bug". Esc in an agent's session (`claude attach`, which Talk copies) denies a permission prompt
or interrupts an answer and ends the turn, but no hook fires (no `Stop`, no `Notification`), and
`claude agents` says `status: idle` with `state: working` until the next turn ends (11:04 to
11:06:24 in the spike, across a stop and a restart). V18b's rule read `state` first, so the
features view said "Working" for an agent waiting on the person. Now `idle` with `working` is
"needs you" with `interrupted`, shown as "Interrupted: waiting for you"; when the thread says
the turn ended with a report, it is finished as before (V18c's rule). A reply needs no
confirmation: the session is idle, so stopping it loses nothing (the server already decided so
from `status`).

**Verification**: tests first — `agentState` (idle with working: needs you, interrupted; busy
with working: working; with the thread's report: plan ready), `featureNext`'s words, `replyMode`
sends; the features e2e with the fake's new `interrupt` (failed on `main`'s build: the row stayed
under Working). 693 unit tests, 98 e2e. Not verified with a real Claude Code after the fix (the
states are the spike's); whether a session reads `idle` with `working` for a moment when a turn
starts or ends normally was not measured — the page would say "Interrupted" until its next read
(5 s). Verified since, on the V21 branch, with Claude Code 2.1.302: Esc while it wrote read
`working`, `idle` for 40 s, and the page said "Interrupted: waiting for you" 301 ms after it.

Merged into main (2026-10-18). `main` verified after the merge: 693 unit tests, build, 98 e2e.

## V21 — The agent's terminal in its feature's panel (2026-10-18, branch `milestone/v21-agent-terminal`)

Asked: "Yes. Go for it, implement it, starting with the bug". The interrupted-state fix first
(entry above), then V21a (terminals in the server) and V21b (the Terminal tab), on one branch.

**Learned**:
- **Esc still reads `working` and `idle` on Claude Code 2.1.302**, for the 40 s watched; Symbiote said
  "Interrupted: waiting for you" 301 ms after it. A session reopened by `attach` after a stop
  reads the same way, so the thread decides between finished and interrupted.
- **Lines written in one go are typed, not pasted**: a 229-character write, then Enter as its own
  write, reached the agent as a plain prompt; so did a burst typed at once. The spike's
  `<pasted_content>` came from a bracketed paste, which Symbiote never sends.
- **pnpm 12 approves builds with `allowBuilds`** in `pnpm-workspace.yaml`. A first "no compiler"
  test passed for the wrong reason: pnpm reused the build from its store (0.17 s, `pty.node` in
  place). With `--config.side-effects-cache=false`, the failed build left the install at exit 0
  and node-pty dropped, as an optional dependency should be.
- **`--no-optional` is not an option for the Action**: the lockfile's 80 optional packages
  include the build's native binaries (rolldown, lightningcss).
- **xterm.js draws only the visible rows**: a check that waits for the screen's text to grow by
  400 characters never ends, and one that polls every 100 ms measures every key as 104–106 ms.
  Measured again per animation frame: 32–33 ms, two frames.
- **An event stream's head is the answer's status**: sending it before knowing whether the
  terminal exists turns a 404 into "headers already sent". The server now listens first and
  keeps what arrives until the head is out.
- **The e2e fake is a script in a template literal**: its new `attach` used single backslashes,
  which became line breaks inside the generated script's strings, and every fake call failed
  (no `sessions.json`). Syntax-check a generated fake (`node --check`) when a spec fails before
  its point.
- **An open terminal and a stopped session**: asking "this continues the stopped session"
  whenever the session reads stopped hid the terminal's last lines after a stop from the head; it
  is asked only when a terminal is about to open.

**Verification**: tests first, except `terminal.ts` (written before its tests, which then failed
only for the missing module). 717 unit tests (24 new, one in a real pseudo-terminal), 101 e2e (3
new). A real Claude Code (2.1.302, Haiku 5.5, the person's Pro subscription), five throwaway
features through `symbiote view`: the session drawn and a question answered in the page; prompts typed
and written reaching the thread; Esc read as interrupted; a stop shown in 755 ms and reopened in
230 ms; leaving the tab hanging up only the client; no page errors; everything removed, Claude
Code's records of the folder too. One run's message was not submitted (typed before Claude Code
said `idle`); not explained. Not verified: Windows, macOS, Firefox, Safari; a permission prompt
in Symbiote's terminal (`auto` asked none); four real terminals at once.

Merged into main (2026-10-18), after the state fix. `main` verified after the merge: 717 unit
tests, build, 101 e2e.

## Fix — agents' reports drawn as Markdown (2026-10-18, branch `fix/thread-markdown`)

Asked: "the output of agents is not rendered correctly, i see **Text**..etc..", in the Thread.
V18c showed every message as written (`white-space: pre-wrap`), leaving Markdown for later; the
two reports of this repository's own feature (`chore/update-readme`) held 34 bold spans, 74 code
spans, 46 bullets, 14 numbered items and 8 headings. Now an agent's report is read by `marked`'s
lexer (GitHub's flavour, line breaks kept as written) and its tokens are drawn as React elements
in `src/markdown.ts`: no HTML string is made, so nothing needs sanitizing. HTML in a report shows
as text; links and images become links only to `http(s):` and `mailto:`; task boxes are drawn
read only. `marked` is loaded into its own chunk (46 KB, 13.7 KB gzip) when a thread is first
shown, the report plain text until then; the main bundle grew 3.8 KB. The person's messages and
Symbiote's prompt are shown as written (decision 118).

**Learned**: `marked`'s lexer gives text unescaped (React escapes it once), a task's box as its
own `checkbox` token, and with `breaks` a `br` token per line break. The thread is itself a list,
so a report's top-level bullets came out as circles (the second level's) until set to discs.

**Verification**: tests first — the renderer on agents' constructs (nested and numbered lists,
headings, code, quotes, rules, tables, task lists, HTML as text, unsafe links dropped; red: no
module), an e2e spec (a heading, bold, code, a nested list, HTML as text, a link; your message
with `**` kept), and V18c's panel spec, whose plan is now a numbered list (red on `main`'s build
for both). The two real reports of `chore/update-readme` checked in light and dark at 1440 px:
no `**` left, no page errors.

Merged into main (2026-10-18), after V21: the journal and styles had both grown at the end
(kept whole, V21's first), and the new e2e spec, which answers in the box, runs without
terminals. `main` verified after the merge: 723 unit tests, build, 102 e2e.

## README rewrite (2026-10-15, branch `chore/update-readme`)

Asked: the README was stale; make it readable, without emojis, and the name now stands for
Coordinated Programming Runtime (decision 119; dropped with the rename to Symbiote, decision 223).
What it was:

- Each milestone had appended a paragraph: the commits page took 10 lines, starting a feature 25.
- Its three screenshots were from 2026-10-01 (V1, V3, G2): no map, no project frames, no commits
  page, no features.
- The sample `symbiote diff` output, copied from PLAN §9, predated D1: no `orphan-added`, and
  `signature-changed` a warning where a compatible change is now `info`.
- Feature worktrees were said to be `../<repo>.worktrees/<branch>`; the code turns the branch's
  slashes into dashes.
- No install steps, findings, keys, configuration keys or environment variables in one place.

Now: the name and a short pitch, then a quick start; commands with one options table; the four
findings; the viewer (a change, the commits page, VS Code, keys); reviewing a branch; features
and agents; pull and merge requests; CI; plugins; configuration; limits; development.

Five screenshots at 1440 × 900 from a fresh build, taken by a throwaway Playwright script outside
the repository:

- The V17 branch (`9ffd5ac`'s two parents: 49 symbols in 3 packages, 17 findings), reviewed in a
  clone of this repository whose `main` was reset to before its merge: the graph zoomed in on
  `@symbiote/core`, the detail of `Verdict`, and the Review tab with two comments.
- This repository's history for the commits page, the branches panel open on `milestone/`.
- The e2e suite's fake Claude Code for the Features tab, so no real session and nothing from
  `symbiote/` is in an image.

**Learned**: the README is where drift collected. Milestones kept it current by appending, which
kept every fact and lost the order. The sample output came from the plan, which nothing
regenerates. Stale text found outside the README is V22 in the plan, not part of this change.

**Verification**: a script checked every flag the README names against the CLI's help (all
there; `--bg` is Claude Code's), every configuration key, permission mode and environment
variable against the code, the action's inputs against `action.yml`, and every relative link
and anchor. No emoji outside code: the glyphs left (`✖ ⚠ ℹ` in the sample, `✓ ✗ ↻` as badges)
are what Symbiote prints, kept in code formatting. The sample output is a real run on the `callers`
fixture. `pnpm check` and `pnpm build` pass.

Merged into main (2026-10-18), after V21 and two fixes, resolved on the branch first: V21 and
decisions 111–118 had been taken on `main`, so the proposed fixes are V22 and the name is decision
119; the journal kept whole, `main`'s entries first; the README rewrite kept, with V21's Terminal,
the thread drawn as Markdown, Talk only without the terminal, `SYMBIOTE_TERMINAL` and `node-pty`
carried into it. The images are from before V21: the Features tab shows the thread with its box,
not the terminal. `main` verified after the merge (same tree as the branch): 723 unit tests,
build, 102 e2e.

**Features screenshot retaken after V21** (2026-10-18, same branch): `features.png` now shows the
Terminal tab with a real Claude Code (2.1.302, Haiku 5.5, the person's Pro subscription), not
the e2e fake, whose `attach` only prints its ID. Three throwaway features in a small repository
(`src/math.ts`, three tests) served by this branch's `symbiote view`: one plan first (its plan in 10
s), one in `auto` that stopped at a permission prompt, one that wrote `clamp`, ran the tests and
committed (30 s); the picked one's plan in the terminal. A feature's worktree takes its trust
from the main repository's folder (the parent folder `/` being trusted did not count: refused in
`/tmp`), so the repository was made at the path the person had trusted for the V18c spike.
Everything removed after: Symbiote's Clean up (sessions and worktrees), the folders, and Claude Code's
records of the three worktrees (`claude purge`); the repository folder's older records and trust
entry left as they were. The image shows the person's status line (model, folder, context) and
nothing personal. The README re-checked against the CLI's help and the code: every flag and
environment variable there (`SYMBIOTE_VIEWER_DIR`, for tests, left out).

Merged into main (2026-10-18), the screenshot after the rewrite: no conflicts (`main` had not
moved). `main` verified after the merge (same tree as the branch): 723 unit tests, build, 102
e2e.

## V23 — Branches that need you, first in the branches panel (2026-10-18, branch `feature/sort-branches-by-last-agent-action`)

Asked, as a feature started in Symbiote: "sort the commits from Commits page by last agent action...so
i can see the branches that need my attention at the top", then "we need to sort the Branches from
the left side of the commits page". Planned as V22; `main` took V22 and decision 119 meanwhile,
so it is V23 with decisions 120–121. In the panel's Local list the open features that need the
person come first, the one whose agent acted last on top, then those whose agent works, each with
a short age; then the checked-out branch and the rest by name, as before.

**Learned**:
- **Claude Code keeps no time of a session's last activity**: `claude agents --json --all`
  (2.1.302) gives `startedAt`, `state` and `status` only. Symbiote's thread has the times, but not all
  of it is the agent's: `chore/update-readme`'s last entries were an `idle_prompt` notice a minute
  after its report and a `/clear` (an end and a start) three days later. Only reports and
  questions count.
- **`symbiote view` from a branch's build rewrites `symbiote/claude-settings.json`** to that build's hook
  whenever it lists features: never run it in the person's checkout to measure. Measured on a
  clone with copies of the records and threads instead.
- **Reading every thread on every list costs with long threads**: before, a thread was read only
  for a blocked session; now it is read for each feature with an agent, every 5 s while one works
  or waits. 9.6 ms for a 5,000-entry thread whole, 0.6 ms for its last 256 KB.
- **The page stops reading the features once none works or waits** (V18b's rule): the e2e's
  first draft answered an agent after both had reported, and the page never saw it. A change made
  then shows when the page is back in view.
- **The age costs names about five characters** in the 260 px panel; the full name stays the
  entry's title.

**Verification**: tests first — 6 unit tests red before the code (CLI 3, viewer 3), one guard
green; the new e2e test red on `main`'s build at its first order. 730 unit tests, 103 e2e. On a
clone of this repository with two made-up features beside its own, Chromium at 1440 × 900 light
and dark and the 880 px overlay: the three open features are the first three local entries
(`main`'s build: 4th, 10th, 12th of 22); no page errors. `/api/features` 33.5–34.0 ms against
`main`'s 33.2–34.1 ms (median of 20, three runs each, back to back). No analysis code changed: no
regression sets. Not verified: dozens of features; Firefox, Safari, Windows, macOS; a real Claude
Code session acting while the page is open (the e2e fake runs Symbiote's real hooks).

Merged into main (2026-10-18), approved in Symbiote at `4321040`: no conflicts (`main` had been merged
into the branch before the review). `main` verified after the merge (same tree as the approved
commit): 730 unit tests, build, 103 e2e.

## V22 — Stale text outside the README (2026-10-19, branch `fix/v22-stale-text`)

Found while rewriting the README (2026-10-15). Fixed:
- `symbiote --help` and `symbiote view --help` said the first page lists the current branch's commits; it
  has listed every branch since V10a, and picks happen in Compare mode since V13. Both now say so.
- `symbiote --help` showed `pr <number>`; the number is optional since C1 (a CI job's own).
- `@symbiote/cli`'s description named `symbiote diff` and `symbiote view`, not `symbiote pr`.
- The action's `plugins` input pointed to `symbiote.config.json`, the older place; now
  `symbiote/config.json`, as the README and the GitLab template say.
- The sidebar's "No findings." ended with an emoji.

**Verification**: a unit test first (`symbiote` and `symbiote view --help` say "every branch", never
"current branch"), red on the old help, green after. 729 of 731 unit tests: the two that load
node-pty fail here and on `main` alike (node-gyp is not in this container, so node-pty is not
built). Build. E2e: 99 of 103; the two terminal tests need node-pty (as above), and
`commits.spec.ts:161` (compare mode's toggle position) fails on `main`'s build too. A fourth,
`reviews.spec.ts:353`, failed once removing its temp directory (`ENOTEMPTY`) and passed 3 of 3
alone. No analysis code changed: no regression sets. Not verified: the terminal e2e tests.

Merged into main (2026-10-19): no conflicts, `main`'s tree the branch's. `main` verified after the
merge: 729 of 731 unit tests (the two node-pty ones, as above), build, 97 of 103 e2e — the same
three as on the branch, and `interdiff.spec.ts` (2) and `reviews.spec.ts:75`, which passed on the
branch with the same tree and passed 8 of 9 when run alone afterwards (flaky, not this change).


## Features → Workspaces, in the UI (2026-10-19, branch `chore/workspaces-term`)

"Feature" named the container (a branch, its worktree, its agent and terminal), not the work, and
read oddly for a fix or a spike. The viewer now says **workspace**: the page tab, the page title,
"Start a workspace" (header, row menu, dialog), "Open its workspace", the marks' titles, the
notices, and the server's refusals the viewer shows ("no workspace …", "a workspace needs a
brief", "a workspace is being started"). The view's address is `/workspaces`; `/features` is
still served and the viewer rewrites it to `/workspaces` (same query), for bookmarks.

Unchanged on purpose: code identifiers and file names (`Feature*`, `features.ts`), the HTTP API
(`/api/features/*`), the records in `symbiote/features/<branch>.json`, the `features.*` keys in
`symbiote/config.json`, the `feature/` branch prefix, and the agent's prompt. Renaming the records'
folder or the config keys would need a migration for no visible gain.

**Verification**: unit tests and e2e updated to the new words; a server test that `/features`
still serves the page, and an e2e test that it lands on `/workspaces?branch=…` with the
Workspaces tab current. 731 of 731 unit tests (node-pty built here: `npm i -g node-gyp`, then
`pnpm install --offline --config.nodedir=/opt/node22`). Build. E2e 102 of 104:
`commits.spec.ts:161` fails on `main`'s build too (the toggle drops a line in compare mode at
1280 px, measured the same on both), and `features.spec.ts:683` is flaky on both (1 of 4 on
`main`, 5 of 6 here). No analysis code changed: no regression sets.

Merged into main (2026-10-19): no conflicts, `main`'s tree the branch's. `main` verified after the
merge: 731 of 731 unit tests, build, 101 of 104 e2e — `commits.spec.ts:161` as on the branch,
and `interdiff.spec.ts` (2), which timed out in the full run and passed 6 of 6 alone (flaky, as
after V22's merge; not this change).

## Fix — Compare mode's toggle stays put with wider fonts (2026-10-19, branch `fix/compare-toggle-wrap`)

`commits.spec.ts:161` failed on `main` in a Linux container: at 1280 px, turning Compare mode on
moved the toggle 15 px down. With the branches panel, the header's items did not fit on one line,
so the actions ("Start a workspace", added by V18, and Compare mode) wrapped to a row below the
help, and that row moved with the help's line count: one line in browse mode, two in compare mode.
The test passed where it was written because `system-ui` there is narrower than Inter, this
container's.

**Learned**: the V13 rule ("the keys wrap inside their space, the toggle stays") held only while
the actions fitted beside the keys; V18's second button broke it on wider fonts. The keys and the
actions now wrap as one unit (`.commits-tail`), the actions on the keys' first line.

**Verification**: the existing test red on `main`, green after. The toggle's top at 1440, 1280
and 760 px, browse then compare mode: 55.6/55.6, 55.6/55.6, 82.8/82.8 px (before: 82.8 → 98.0 at
1280). Cost: at 1280 px with the panel, compare mode's help wraps to four short lines beside the
actions instead of two lines above them.

## Fix — "Open again" after a stop asks first (2026-10-19, branch `fix/open-again-race`)

`features.spec.ts:579` failed about one run in three: after "Stop the agent", the terminal said
the session had exited, and "Open again" attached at once instead of saying that opening
continues the stopped session. "Open again" decided from the feature list, read every 5 s and
after each action; the terminal's `exit` event comes before that read, so the agent's state was
still the one before the stop. A person clicking fast would continue a stopped session unasked.

**Learned**: a read already under way when the stop lands is no better: `reloadFeatures` hands it
out, and it may hold the old state. `readFeaturesAgain` waits for it, then reads anew.

**Verification**: the test 7 of 12 on `main` (`--repeat-each=12`), 24 of 24 after; the whole
`features.spec.ts` 22 of 22. Not covered by a deterministic test: holding back `/api/features` in
the e2e server would need a hook it does not have.

Both fixes merged into main (2026-10-19). `main` verified after the merges: 731 unit tests (the
node-pty ones too, now that node-pty is built here), build, 104 of 104 e2e.


## V24 spike — what a brief for an agent should hold (2026-10-19, branch `milestone/v24-structured-brief`)

Asked: structure the "Start a workspace" dialog into several inputs (kind, title, goal…), after
research on how to brief a coding agent.

Measured on this repository: of 35 merges into `main`, 20 are milestones, 7 fixes, 4 chores or
docs, 4 other; every workspace branch is `feature/` today. No real workspace records exist on
this machine (only e2e fixtures), so how people fill the one text area is not measured.

Read on 2026-10-19, what vendors ask a task to hold:
- Claude Code best practices (https://code.claude.com/docs/en/best-practices): a check the agent
  can run; for a bug the symptom, the likely location and what "fixed" looks like, then a failing
  test; specs name files, state what is out of scope, end with a verification step; skip the plan
  when the diff fits in a sentence.
- Anthropic prompting guidance
  (https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices):
  give the why; material first, the request last.
- Devin (https://docs.devin.ai/essential-guidelines/instructing-devin-effectively): context,
  success criteria, patterns to reuse; "Make sure it works" as the bad example.
- GitHub Copilot coding agent
  (https://docs.github.com/en/copilot/tutorials/coding-agent/get-the-best-results): a clear
  problem, complete acceptance criteria, which files.
- Codex (https://developers.openai.com/codex/prompting): file paths; reproduction and constraints
  matter more than a high-level description.
- spec-kit's spec template and Kiro's requirements (EARS acceptance criteria): heavier, for
  multi-step specs; GitHub issue forms: few required fields, the rest optional.

Learned: the sources agree on three parts a single text area leaves to memory — the goal and
why, how done is checked, the bounds — plus, for a bug, what happens against what should and
how to reproduce it. That is the plan: a kind, a title, two required parts per kind, the rest
optional. Not fetched: Cursor's and Linear's guidance; form-friction numbers were secondary and
contradictory, so none are used.

Revised the same day with the user's answers: Spike and Refactor are kinds of their own; Done
when is optional; Symbiote guesses the check command; the brief's format left to the plan (Markdown
headings). Measured for the guess, on the default branches of 16 repositories (shallow blobless
clones: this one, ky, zod, vite, the Angular RealWorld app, Bitwarden, Qwik, TypeScript's Go
port, React, Express, Requests, Flask, FastAPI, ripgrep, axum, cobra): a rule over root files
(`package.json` `check` then `test` with the package manager from `packageManager` or the
lockfile; `make`; `scripts/test.sh`; `cargo test`; `go test ./...`; `pytest`) gave the command
the repository's agent instructions, CONTRIBUTING or CI use in 13, a right but heavy one in 2
(Qwik's `test` builds everything and runs e2e; vite's runs three suites), a close one in 1
(Flask: `uv run pytest`, CI runs `tox`), none wrong.

Learned:
- `check` is rare: only this repository has one; `test` is the convention, and its weight varies
  from one tool (zod) to a full build and e2e (Qwik).
- `cargo test` alone misses a workspace's other crates: ripgrep's CI runs `--workspace`, so the
  rule adds it when `Cargo.toml` has `[workspace]`.
- 7 of 16 have `CLAUDE.md` or `AGENTS.md` (Bitwarden's in `.claude/`), but their commands sit
  among alternatives (Qwik lists six); parsing them would guess worse than the manifests, and the
  agent reads them anyway.
- The package manager is not always npm, pnpm or yarn: zod's `packageManager` is `nub`, and
  `nub run test` is what its CONTRIBUTING says, so the field's name is used as given.

## V24a — Kinds and parts in the record (2026-10-19, branch `milestone/v24-structured-brief`)

A start request may now give a kind (Feature, Fix, Refactor, Chore, Spike), a title and the
kind's parts instead of one brief. The server checks them, makes the brief (`briefOf`: `# Fix:
<title>`, then each part with text under its heading, Done when last), and keeps kind, title and
parts in the record beside it; the list gives kind and title. The prompt adds the kind's one
line after the brief. Branch prefixes are per kind (`features.branchPrefixes`). Nothing in the
dialog changed yet: it still posts one brief, which makes a record exactly as before.

**Learned**:
- One table of headings in the brief's order gives every kind's order, so the server's list of
  kinds for the dialog and the brief agree by construction; the dialog will render that list
  rather than keep a copy (the viewer may not import runtime code from core).
- "`pnpm run check` passes" and "the project's checks pass" need different verbs: the Done when
  token is `{checks pass}`, verb included, never at the start of a sentence.
- Turning an old `{ brief }` request into a Feature would have changed what an old client's agent
  is told (its whole brief under "## Goal"); it stays a record as before V24.
- A spike's prompt cannot keep "Commit your work … the person reviews the branch": it contradicts
  the spike's line. Its closing paragraph says to commit nothing unless asked.

**Verification**: tests first — 9 new unit tests and the changed options test red before the code
(`briefOf is not a function`, missing fields, no kind line), green after; 740 unit tests, lint,
typecheck, build, 104 of 104 e2e (the dialog still posts one brief). No analysis code changed: no
regression sets. Not verified yet: a real agent given a kind's brief (V24c).

## V24b — The check guess (2026-10-19, branch `milestone/v24-structured-brief`)

`GET /api/features/check?at=<commit>` answers the check command guessed from that commit's root
files and where it came from (`{ command, source }`, or `{}`), for the start dialog's Done when.
The rules are the plan's, first match wins: `package.json`'s `check` then `test` script with its
package manager, a Makefile's `check` then `test` target, `scripts/test.sh`, `cargo test`
(`--workspace` with a `[workspace]` table), `go test ./...`, `pytest` (through `uv` with
`uv.lock`).

**Learned**:
- Timing a blobless clone measures the network: ripgrep and axum took 697 and 491 ms the first
  time, because git fetched `Cargo.toml`, never read before; 14 ms once it was local. Measured
  again on a full clone.
- A Makefile line `test := …` sets a variable, yet matches `^test\s*:`; a target is `test:`
  not followed by `=`.

**Verification**: tests first — 7 `guessCheck`/`treeAt` tests (the module did not exist), the
service's `check` and the endpoint red, green after; `treeAt` reads the commit, not an uncommitted
change. 749 unit tests, lint, typecheck, build. On the 16 repositories of the V24 spike, the same
16 commands as planned; 13–17 ms per guess on full clones (Bitwarden 15–17 ms). Not verified: the
dialog showing it (V24c).

## V24c — The structured dialog (2026-10-19, branch `milestone/v24-structured-brief`)

"Start a workspace" asks for a kind (Feature, Fix, Refactor, Chore, Spike), a title, the kind's
one required part, Done when (filled in for four kinds, with the guessed check command) and, under
More, the kind's optional parts. Switching kind keeps every text. The branch follows the title and
the kind's prefix. The form is a draft `symbiote view` keeps until the workspace starts. The list, the
panel and the review page name a workspace by its title, its kind tagged before it.

**Learned**:
- **A draft in `localStorage` would not survive the next `symbiote view`**: each run takes a free port,
  and browser storage is per origin — the reason review state moved to the server in decision 17.
  The draft is kept in Symbiote's cache instead (decision 128), with the last kind.
- **Saving a draft and clearing it race**: the dialog's unmount (after a start) and the starter's
  "clear" would both post, in an order React decides. The dialog owns it: Start saves the form at
  once, and its unmount after a successful start saves only the kind.
- **Five kinds need 329 px**; a 390 px phone gives the picker 308. Tighter padding under 480 px
  puts them on one line (289 px).
- **The `.link` class sets a monospace font**: the More toggle needed its family back.
- **"An agent's report is drawn as Markdown" raced on `main` too** (2 of 6 alone): it replied as
  soon as the report was drawn, while the list, read every 5 s, still said the agent worked, so
  the panel asked "Stop it and send" instead of sending. Filling two fields shifted the timing
  (5 of 6 on this branch); the test now waits for "Plan ready" first (8 of 8).
- **A real agent reads more than the brief**: in the scratch repository, Haiku's plans also noted
  what did not match it (a brief saying "several" test files where there was one, a date bug the
  Spike was not asked about but found), and asked rather than guessed.

**Verification**: unit tests first for the pure parts (`brief.ts`: 7 red, the module missing; the
server's draft and its endpoint: 2 red) and a test that the dialog's count of the brief is the
server's `briefOf` length; `featureName` was written with its test, not before. 761 unit tests,
lint, typecheck, build. E2E: the 22 workspace tests moved to the new fields; 5 new (each kind's
brief and line, the guess and kind switches, the draft through Escape, reload and a start, the
keyboard, a pre-V24 record): 4 red on V24b's build, the fifth guards what stays; 109 of 109,
twice.
Screenshots at 1440 × 900 and 390 × 844, light and dark, each kind, More closed and open: fits
without scrolling with More closed (645 and 685 px); with More open it scrolls inside the window.
With a real Claude Code (Haiku, `claude -p` with Symbiote's own prompt, read-only, plan first) for each
kind: each plan follows its kind's line (PLAN.md, V24 results). Not verified: `claude --bg` from
the dialog with a real agent (its trust prompt, V18), Firefox and Safari, a screen reader on the
radio group.

### V24c, then: what each kind is for

Asked once V24c was built: "an info tooltip after the Workspace type selection with a little
description for each type". An ⓘ after the kinds shows each kind's line (Feature: something new;
Fix: something that goes wrong, reproduced with a failing test first; Refactor: a better shape,
behaviour and tests' assertions kept; Chore: upkeep, nothing else changes; Spike: a question,
answered in a report, nothing committed), the picked one marked. It shows on hover, while the
button has the focus, or once tapped, and Escape hides it without closing the dialog.

**Learned**: the tooltip spans the dialog under the kinds, over the title; taking the pointer, it
kept the title from being hovered (the e2e timed out), so it takes none. On a phone the ⓘ pushed
"Spike" to a second line again: the kinds' padding is 6 px there.

**Verification**: the tooltip's e2e (hover, focus, Escape, a tap) and the keyboard e2e's new tab
stop red first, green after; 761 unit tests, 110 of 110 e2e; screenshots at 1440 × 900 and
390 × 844, light and dark: the kinds and the ⓘ on one line, the tooltip inside the dialog.

Merged into main (2026-10-19): V24a–c, no conflicts (`main` had not moved since the branch
started; the merge's tree is the branch's). `main` verified after the merge: 761 unit tests, lint,
typecheck, build, 110 of 110 e2e.


## V20a spike — what running Codex in a Symbiote worktree takes (2026-10-19, branch `feature/codex-agent-integration`)

Asked, as a workspace started in Symbiote: "Integrate codex agent into Symbiote. It is already planned";
done when Codex is started in a workspace and prompted. V18 planned Codex on 0.162 without
running it. Run with Codex 0.163 (`codex-cli`, npm), logged in with ChatGPT, the person's
`gpt-6-luna` at medium effort, in a throwaway repository with a worktree beside it made as V18a
makes them (`git worktree add -b feature/farewell ../app.worktrees/feature-farewell main`).

**Learned**:
- **Codex cannot commit in a linked worktree from `workspace-write`.** It edited `greet.js`, then
  `git add`/`git commit` failed 3 of 3 times: a linked worktree's git folder is
  `<checkout>/.git/worktrees/<name>`, outside the sandbox ("Git tried to create an index lock
  under the parent repo's `.git/worktrees/` directory, which is read-only"). The change was left
  uncommitted, and Symbiote's flow reviews commits. `--add-dir <checkout>/.git` did not help: Codex
  keeps any `.git` read-only even inside a writable root. Writable roots for the worktree's git
  folder, `objects`, `refs` and `logs`: committed (10.5 s); narrowed to the branch's own ref and
  reflog folders (`refs/heads/feature`, `logs/refs/heads/feature`): committed too (12.0 s).
- **`--approve-for-me`** cannot be given with `-s` ("cannot be used with '--approve-for-me'");
  alone it escalated the refused commit to Codex's automatic reviewer, which approved it, and the
  commit ran outside the sandbox (12.6 s).
- **`exec resume` keeps the thread, not its options.** A resume continued with its context
  (3.2–12.8 s per turn), but a session started with `--add-dir`s could not commit after a resume,
  nor one started with `--approve-for-me` (2 of 2): resume takes no `-s`, `--add-dir` or
  `--approve-for-me` and starts from Codex's configuration. `-c sandbox_mode="workspace-write" -c
  sandbox_workspace_write.writable_roots=[…]` on the resume committed (6.1 s).
- **Events**: `thread.started` with the thread ID 150 ms after the start, `turn.started` at
  0.6 s, `item.started`/`item.completed` (`agent_message`, `command_execution` with its output,
  `file_change` with paths), `turn.completed` with token usage, or `turn.failed` with
  `error.message`; transient `error` events while reconnecting. No event has a time. A turn's
  first `agent_message` is a preamble ("I'll inspect …"), its last the answer. Codex writes
  "Reading additional input from stdin..." to stderr even with stdin closed.
- **Not logged in** (an empty `CODEX_HOME`): `codex login status` says "Not logged in", exit 1, in
  40 ms ("Logged in using ChatGPT" otherwise); `exec` retried for about 25 s, then failed its turn
  with a 401 and exit 1.
- **Stop**: spawned detached from Node, `codex` is a Node script (`codex.js`) running the native
  binary in the same process group; the sandboxed shell has a group of its own. SIGTERM to the
  group ended all of them in 0.1 s; the thread then resumed with its context ("I was running
  `sleep 25`; the command was stopped before it finished").
- **Its instructions**: the repository's `AGENTS.md` in the worktree was followed (1 of 1); a file
  in the main checkout's `symbiote/` was read from the sandbox (1 of 1); `exec` asked for no trust in a
  folder Codex had never seen.
- **Archive**: `codex archive <thread>` 70 ms; again on the same thread, or an unknown one, exit 1
  ("failed to archive session").
- `codex` 0.163 also has `agents` (a TUI over its app-server daemon) and `queue` (a message for a
  session there), and hooks that need the person's trust; `exec` sessions are none of these.

**Not tested**: `--approve-for-me`'s reviewer refusing; Codex with an API key; network inside the
sandbox (off by default: installs and pushes would fail); Windows and macOS. Twelve threads, in
the throwaway repository, removed with it; their session files stay in `~/.codex`.

## V20a — Codex as a workspace's agent (2026-10-19, branch `feature/codex-agent-integration`)

Asked, as a workspace started in Symbiote: integrate Codex, "already planned"; done when Codex is
started in a workspace and prompted. The start dialog now offers the agents installed (Claude
Code first unless `agent.kind` says `codex`); a Codex workspace runs `codex exec --json` in its
worktree through Symbiote's runner (`dist/codex-run.js`), which writes Codex's events into the
workspace's thread; it can commit on its branch from its sandbox; replies resume its thread;
Stop, Start, Talk (`codex resume`) and Clean up (archive) work for it. Claude Code workspaces
are unchanged; the terminal stays Claude Code's.

**Learned**:
- **The plan's design could not have worked as written**: Codex in `workspace-write` cannot
  commit in a linked worktree (its git folder is in the main checkout's `.git`, which Codex keeps
  read-only), and `exec resume` keeps none of the start's options. Both only showed by running
  Codex (spike, above): the fix is writable roots for exactly what a commit on the branch writes,
  passed on every run.
- **Separating runs by time fails in the same millisecond.** Symbiote writes its own `end: stopped`
  and may start the next run within the same millisecond; the tests' fixed clock showed it at
  once. Each run now carries an ID on its entries.
- **A detached start answers before anything is recorded.** The person's reply took 5.3 s to show
  with a real Codex (the page's next read); Claude Code's hooks had hidden this, since they write
  before `--bg` returns. Waiting up to 3 s for the run's first entry: 0.29 s.
- **A fake that waits for the test can outlive it**: two detached runs survived the e2e suite
  because one spec never ended its turn. The fake now exits when the test's folders go; checked
  with `pgrep` after the suite (0 left).
- A Playwright click on a workspace row's centre lands on its branch badge, a link to the commits
  page: the real-run driver navigated away and "missed" Talk. Not a product bug; click the title.
- **Found, not fixed here**: a Claude Code spec failed once on its own `git commit` in a worktree,
  "index.lock: File exists" (5 of 5 alone after). `/api/features` runs `git status` in each
  worktree (V18b), and status refreshes the index under its lock when it can; an agent committing
  at that moment fails the same way. `GIT_OPTIONAL_LOCKS=0` on that call is git's documented
  answer for background status. Proposed as `fix/…` from `main`.

**Verification**: tests first (core 1, runner and Codex 17, service 6 + 2, server 1, viewer 3; red
before), one guard test; 788 unit tests, 113 e2e (3 new with a fake Codex run by the real runner,
written with the viewer change; 113 of 113, then 112 with the lock flake above). A real Codex (0.163, ChatGPT login) through `symbiote view` in
Chromium, two workspaces in a throwaway repository: plans in 9–10.7 s; replies in the thread in
0.29 s; commits from the sandbox (`bdaba0c`, `e15dcb3`), ready for review 15.7–25.3 s after the
reply; Stop in 0.21 s with nothing left running; Clean up in 0.9 s, its thread archived. Screenshots
light and dark at 1440, 900 and 390 px, no page errors; the main bundle +1.0 KB. Everything made
was removed and the throwaway Codex threads archived. Not verified: Windows and macOS, an API key
login, a person's own writable roots, network inside the sandbox.

Merged into main (2026-10-19): V20a, no conflicts (`main` had not moved since the branch
started; the merge's tree is the branch's). `main` verified after the merge: 788 unit tests, lint,
typecheck, build, 113 of 113 e2e.

## V25 spike — what "workspaces first" touches (2026-10-19, branch `milestone/v25-workspaces-home`)

Asked: the commits page's name, and that Symbiote still starts from commits when it works one level
higher, in worktrees the person calls workspaces. Measured on `main` (`d604c2d`):

- `/` is the commits page (V10a, before workspaces existed). Workspaces is the second tab at
  `/workspaces` (V18b; `/features` redirects there). A diff's way back is always "← Commits".
- On screen, workspaces are already called workspaces (V24). Underneath they are still
  "features": 1,949 matches in code and tests, 12 file names, `/api/features` (30 uses),
  `symbiote/features/<branch>.json`, and the "Features" section of the `symbiote/AGENTS.md` Symbiote writes.
  Since V24 "feature" is also one of the five kinds of work (`WorkKind`, the `feature/` prefix), so
  a text replace would break the kinds. The rename has to go symbol by symbol.
- `repository.features` is set on every `symbiote view` (`main.ts`), so Workspaces can always be the
  first page. Its empty state exists already ("No workspaces yet …") but has no action.
- 54 of the e2e's 90 `goto` calls open `/` and expect the commits page.
- `h` and `w` are not bound on either page.

Planned as V25 (PLAN.md): Workspaces at `/`, History at `/history`, then the rename, then the
records on disk.

## V25 — Workspaces first, History beneath (2026-10-19, branch `milestone/v25-workspaces-home`)

`symbiote view` opens on Workspaces (`/`). The repository's history is History (`/history`), and in
code, the API and on disk a workspace is a workspace. "Feature" is left for the kind of work.

Learned:
- **A rename across 1,949 matches needs the syntax tree and then a person.** The script renamed
  identifiers, strings it knew (module paths, API paths, CSS classes), comments and test titles.
  Typecheck caught three objects keyed by kind. It could not catch a kind key in a test's
  `toEqual` (`workspace: undefined` passes, since `toEqual` ignores undefined keys) or a fixture's
  git branch named `feature` (`shas.feature` → `shas.workspace` typechecks, because both sides were
  renamed). Only reading the diff found those. A guard test now lists the 5 `feature` identifiers
  left in `src`.
- **Moving the root address moves its query too.** `/?branch=` meant "History at this branch" and
  now means "Workspaces, this one picked". The workspace's branch link still pointed at History's
  old form. No test covered it; reading every `href` did.
- **The referrer, not history state, says where a diff came from.** Diffs are opened with
  `location.assign`, so the page that opens one cannot leave state on it. `document.referrer`
  survives a reload and is empty for a bookmark.
- **The hook can be the first reader.** An agent started before the upgrade fires its hook (its own
  process, `thread.ts`) before anyone opens `symbiote view`, so the hook moves `symbiote/features/` too.
  `rename` replaces an empty target folder on Linux, so "both folders" means both hold records.
- **Interleaved timings mislead.** Measured round-robin, History's first paint looked 108 ms
  against `main`'s 59 ms. Measured alone, each order, 9 rounds: 60 ms both. An occasional
  ~110 ms run showed on both builds.

Verification: tests first (red before) for the pages and back link, `/history`, the help, the
config's old name, the move (old, new, both, neither, two readers), the hook, the list,
`AGENTS.md`, the guard test and the note; 801 unit tests, 114 of 114 e2e. Chromium on throwaway
repositories, light and dark, 1440 and 390 px, no page errors. First paint: `/` 109 ms like
`main`'s `/workspaces`, `/history` 60 ms like `main`'s `/`. The built CLI moved two old records
from its hook, listed them in 40 ms and showed the note for a leftover `symbiote/features/`. Not
verified: a real agent session across the move; Windows; the README's Workspaces screenshot.

Merged into main (2026-10-19): V25a–c, no conflicts (`main` had not moved since the branch
started). `main` verified after the merge: 801 unit tests, lint, typecheck, build, 114 of 114 e2e.

## V26 spike — what merging takes, and what it would cost an agent (2026-10-19, branch `milestone/v26-merger`)

Asked: a merger agent, not the workspace's own ("it already has polluted context … optimise token
generation"). Measured:

- **A workspace agent's context** at its last turn, from Claude Code's session files for this
  repository's 5 workspaces (6 sessions): 66K–474K tokens, 28–432 turns. A merge run in that
  session would be carried on top of it.
- **Conflicts**, replaying with `git merge-tree --write-tree` (2–3 ms median) the last merges on
  the default branch and the merges of the default branch into each branch before it. The second
  matters: of the last 73 merges here, 5 conflict when replayed, and 6 more conflicts were
  resolved on the branch before its merge, so the final merge replays clean. Here 11, Bitwarden
  21 (80 merges; 11 the `jslib` submodule), Qwik 7, Vite 0.
- **Most conflicts are both sides adding.** In git's diff3 style, the ancestor's side is empty in
  16 of 20 regions here (journal and plan entries), 31 of 46 on Bitwarden (`messages.json` keys),
  3 of 12 on Qwik.
- **"Keep both" needs a guard.** Taken blindly, it was refused or wrong where one side's addition
  already held the other's (a branch that had merged the other side's keys before): it would
  duplicate them. With the guard "the additions share no lines but blank lines and lone brackets",
  it applied to 7 conflicts and was right on 7: 5 equal to what was committed (blank lines
  aside), 1 where the merge also added an unrelated entry, 1 with the same keys in the other order
  (valid JSON, 435 keys). It refused 5.
- **What an agent would read** for a conflict: its regions with 3 lines around, 0.6K–5.8K tokens
  (11 conflicts here, median ~1.3K). That is 1–3 % of a workspace agent's context.
- **Landing is the risky step.** The default branch is checked out in the main checkout. Moving its
  ref from elsewhere would leave that checkout's files behind its branch. A fast-forward made in
  that checkout (`merge --ff-only`) moves both, and git refuses when local changes would be lost.

Planned as V26 (PLAN.md): Merge, check and land with no agent (V26a); keep-both by rule (V26b); a
fresh merger agent from the conflict alone, every resolution reviewed (V26c).

## V26a — Merge, check, land (2026-10-19, branch `milestone/v26-merger`)

Approve, then **Merge into ▾** (the Review tab, a workspace's panel, or `symbiote merge <branch>`):
Symbiote merges the approved commit with `--no-ff` in a worktree in its cache, runs the check
(`merge.checks`, else the V24b guess at the target's tip), and moves the target by fast-forward
in the worktree that has it checked out, else by `update-ref` from the value it was merged on.
The Merging section heads Workspaces while the queue has entries. `symbiote/AGENTS.md` no longer
tells an agent to merge an approval.

**Learned**:
- **A function named `process` shadows Node's global** in the module, and TypeScript said so only
  as "Property 'pid' does not exist on type '(entry) => Promise<void>'".
- **A guessed package script fails in a fresh worktree**: Symbiote's merge worktree has no
  `node_modules`. Linking the main checkout's, as `symbiote diff`'s worktrees do, would make pnpm's
  workspace links resolve into the main checkout, so the check would run the wrong code. So a
  `package.json` guess runs its package manager's install first, and the worktree keeps ignored
  files between merges.
- **A merge waiting at `ready` must hold the next one into the same branch.** Otherwise the next
  is merged on a tip about to move, lands first, and the first is merged again.
- **`git merge --ff-only` in the checkout that has the branch** refuses with "Your local changes
  to the following files would be overwritten by merge", and leaves the branch and the files
  as they were. That is the landing's guard, tested with a change to a file the merge brings.
- **The config was read after landing**, from the checkout the landing had just changed. In the
  real run below, the branch brought this repository's `symbiote/config.json` (`merge.push: true`)
  into a clone whose own config said `false`, and Symbiote pushed the clone's `main` to its `origin`,
  this checkout. Local `main` moved to the test merge; it was put back with `update-ref` from
  that value (GitHub's `main` was never pushed to). Now the push is decided before landing, with
  a test: a landing that brings a pushing config does not push.

**Verification**: tests first — 22 merger tests red (no module), then 4 more (`symbiote merge` ×2, the
install before a guessed package script, the push decided before landing), each red first; the
routes with a fake merger; the viewer's row text and actions (3). 831 unit tests, lint,
typecheck, build; 115 e2e (Merge and Land from a branch review and from a workspace, a conflict
named and removed; the V17 review texts updated). `symbiote diff` on this repository's last 5 merges,
`main`'s build and this one: the same graph JSON (45–731 nodes) but for `stats.durationMs`.
Real use, a clone of this repository merging this branch into its `main` with
`merge.checks` (install, check, build, e2e): merged on `d17fc40`, checked in 188 s, then the
landing was refused ("untracked working tree files would be overwritten by merge:
symbiote/config.json") with `main` and the files as they were; with that file removed, `--land`
fast-forwarded the checkout in 278 ms, its unrelated `.nvmrc` change kept. Not verified: the
merge of a real workspace from a `symbiote view` with a real agent; V26b and V26c.


## V26c — The merger agent (2026-10-20, branch `milestone/v26-merger`)

A conflict goes to one `claude -p` (or `codex exec`) run in Symbiote's merge worktree, read-only:
Symbiote's instructions (1,410 characters, ~350 tokens) as its system prompt, then the sides'
titles, the symbols both changed, `symbiote/merge.md`, and each region in diff3 style with 3 lines
around. It answers each region's text as JSON, or `needsYou`. Symbiote writes the answers, commits
the merge, runs the check; the Merging section shows each region (both sides, the ancestor,
what was written) with Approve and Request changes.

**Learned**:
- **Claude Code's Edit reads the whole file first.** This repository's `JOURNAL.md` is ~100K
  tokens, so an agent that edits would cost more than the workspace agent V26 avoids. An agent
  that answers text per region reads only the regions; it may still read a file (Read, Grep,
  Glob) when a region is not enough, and one did (59K tokens, below).
- **A one-line `claude -p` costs 2,349 input tokens** with `--system-prompt` (Claude Code's own
  replaced), `--tools` limited and `--strict-mcp-config`: the floor of every run.
- **The e2e fixtures would have run the developer's own Claude Code**: the merger finds
  `claude` on PATH. Every e2e `symbiote view` now starts with `SYMBIOTE_CLAUDE` and `SYMBIOTE_CODEX` pointing
  nowhere, and a spec that wants an agent passes a fake.
- **Some merges change lines outside the conflict** (a test adapted to the other side, an ID
  renumbered). The agent cannot, by design: it said so in its note once, and kept two equal IDs
  once. The check and the review are what catch them.
- The 12 prompt and answer tests were written with the module, not seen red; the 7 flow tests
  and the server's routes were red first.

**Verification**: 852 unit tests, 117 e2e (a resolution asked again, approved and landed; one
left to the person, nothing merged). **Replays**: this repository's 11 merges whose parents
conflict (of 79), each through `symbiote merge` in a clone with the real Claude Code (`sonnet`), no
check, compared with the merge that was committed:

| Result | Merges |
|---|---|
| Equal to what was committed (blank lines aside in 2) | 5 |
| Equal but for a list's indentation (33 lines, `git diff -w` empty) | 1 |
| Equal in the regions; the committed merge also changed a test outside them, which the agent's note asked to check | 1 |
| Both sides kept, in the other order, one paragraph in the other side's words | 1 |
| Wrong: two lines kept twice (1); a README paragraph the target had replaced kept, and two plan rows with one ID (1) | 2 |
| "Needs you": a README section moved on one side, changed on the other; it named the three changes and where they belong | 1 |

Input tokens per run: 5.5K–59K, **median 10.0K** (target: under 20K); output 0.9K–10K; 7–49 s
per run. A workspace agent's context was 66K–474K. Not verified: Bitwarden's and Qwik's
conflicts; Codex as the merger with a real Codex.

Merged into main (2026-10-20).

## V27 spike — Codex in the panel's terminal, through its app server (2026-10-20, branch `milestone/v27-codex-terminal`)

Asked: make a Codex workspace's terminal work (V20a left it out: its turns in a terminal would
not reach Symbiote's thread, decision 133); "try codex agents". Codex 0.163.0, the latest release
(2026-10-15). Run in a throwaway repository with a linked worktree as Symbiote makes them, on a
private app server (`codex app-server --listen unix://…`), the person's own daemon left alone.

**Learned**:
- **Codex 0.163 has the binding: a shared app-server daemon** (`codex agents` browses it, `codex
  app-server daemon version` names its socket) **and a TUI that joins it**: `codex resume
  <thread> --remote unix://<socket> -C <worktree>`. Every client of one thread gets its events.
- **The socket speaks WebSocket**, JSON-RPC inside without the `jsonrpc` field (101 Switching
  Protocols on an HTTP upgrade). `codex app-server proxy` relays raw bytes, so it answered
  nothing to plain JSON lines (2 of 2). Node has no WebSocket client over a unix socket: the
  spike's client did the upgrade and the frames itself (~70 lines).
- **Symbiote as a client starts the thread**: `thread/start` (the worktree, `workspace-write`, the
  branch's git folders as writable roots, `approvalPolicy`), then `turn/start`. Codex committed
  in the linked worktree, 4.2 s for the turn. The server holds the thread with those options.
- **A turn typed in the TUI reaches Symbiote**: `turn/started`, the person's `userMessage`, each
  agent message and command, `turn/completed`, 3.0 s. It committed from the sandbox too (the
  thread's writable roots stayed: V20a's `exec resume` lost them).
- **A turn Symbiote starts shows in the open TUI**: its answer was drawn 0.9 s after `turn/start`.
- **No client needs to stay**: a 15 s turn finished after Symbiote's client was killed 3 s in, and a
  new client's `thread/read` (`includeTurns`) gave every turn back (Symbiote's, the TUI's, the one it
  missed) with their items and times. Symbiote need not record the thread itself.
- **"Needs you" exists for Codex here.** With `approvalPolicy: on-request`, a command the sandbox
  refused became `item/commandExecution/requestApproval` to the clients, and the thread's status
  `active` with `waitingOnApproval`. A TUI that joined later drew Codex's own prompt ("Would you
  like to run the following command?", its reason, y / esc). Declined from Symbiote's client:
  `serverRequest/resolved` to all, the command `declined`, nothing written, the turn finished.
- **The TUI asks "Trust this folder?" once per worktree**, and Enter writes `[projects."<path>"]
  trust_level = "trusted"` into the person's `~/.codex/config.toml`. `-c projects."<path>"…` is
  ignored, on the TUI and on the server alike (Codex's warning: "session-flags: … is ignored").
  It is the person's decision, made in their terminal. The spike's three entries were removed.
- **`workspace-write` lets commands write anywhere in `/tmp`** by default (`exclude_slash_tmp`,
  `exclude_tmpdir_env_var` turn it off): a write "outside the folder" there asked nothing.
- **Memory**: a private app server 269 MB (and 50 MB for its Node wrapper); the person's daemon,
  already running, 212 MB. On the daemon, Symbiote adds no process.
- The person's daemon answered the same `initialize` over the same transport (1 ms); nothing
  else was asked of it.

**Not tested**: Symbiote's threads on the person's daemon end to end (only `initialize`); a thread
`codex exec` made (V20a's), resumed on the app server; the daemon restarting during a turn
(`daemon update` "may interrupt running work"); a TUI's memory; macOS, Windows. The 4 threads
were archived (`codex unarchive` brings them back).

## V27a — Symbiote on Codex's app server (2026-10-20, branch `milestone/v27-codex-terminal`)

Asked: "Start V27a". A Codex workspace now starts on the person's app-server daemon (found, or
started, with `codex app-server daemon start`): a thread in the worktree, its branch's git folders
writable, approvals asked, named after the branch. Symbiote reads its state and thread from the server;
a message joins a running turn; Stop interrupts it; Clean up archives its threads. Talk copies
`codex resume <thread> --remote unix://<socket> -C <worktree>`. Without a daemon, V20a's `exec`
as before. Claude Code workspaces unchanged.

**Learned**:
- **Probed first on a private app server** (Codex 0.163, the person's daemon left alone): writable
  roots go in `config.sandbox_workspace_write.writable_roots` (`sandbox` takes only a mode). The
  server keeps a thread's sandbox, roots, approval policy and folder: after a restart, a bare
  `thread/resume` gave all four back, so Symbiote passes none when it continues a thread (decision
  157). `turn/start` on a thread the server does not hold fails "thread not found" (-32600), a
  turn cut by the restart reads `interrupted`, and the thread `notLoaded`.
- **A connection that did not start or resume a thread hears only its status changes.** Symbiote keeps
  none subscribed (a subscriber gets every delta) and reads with `thread/read` (1.9 ms) and
  `thread/turns/list` (`summary`: each turn's first message and final answer, 3.3 ms for 6 turns;
  `full`: every message and Codex's commentary, 7.2 ms). Items have no times, turns do (seconds).
  Agent messages carry `phase`: `commentary` or `final_answer`.
- **While Codex waits on an approval, the request is no item**: the last turn shows the person's
  message and, sometimes, Codex's commentary ("May I run it outside the sandbox?"); in the real run
  only reasoning. "Needs you" comes from the status flag `waitingOnApproval`. Server requests are
  numbered from 0, so a response is told from a request by its `method`, not its ID.
- **Messages can come with the upgrade's answer**, in the same chunk: the first test of the
  WebSocket client lost one, since the caller could not listen before the promise resolved. The
  client now holds messages until its first listener.
- **`codex app-server daemon start` is idempotent**: 57 ms when it runs, 1.25 s to start one (in a
  throwaway `CODEX_HOME`); `daemon version` exits 1 with "failed to connect" when none runs. A
  socket path past ~100 bytes is made a symlink into `/tmp/codex-daemon-<uid>/`.
- **The real run found what the fake did not: Codex refuses to name a thread whose rollout is
  empty.** Start again called `thread/name/set` right after `turn/start` and got "failed to update
  thread metadata … rollout … is empty"; Symbiote called the start failed while the turn ran, and lost
  the thread (it redid the brief, found it done, committed nothing; archived by hand). The first
  start had named its thread by timing alone. Now the name is set once the prompt is in and never
  fails a start, a start that fails after `thread/start` keeps the thread for Clean up (decision
  158), and the fake refuses a name until a thread has an item.
- **A turn typed outside the page shows only when the page is focused again**: the list is read
  every 5 s only while an agent works or waits, so after "Plan ready" nothing reads it. The same
  holds for `claude attach` in the person's terminal; the e2e dispatches `focus` to model coming
  back. V27b's terminal in the panel needs a rule.

**Verification**: tests first (WebSocket client 6, app-server client and operations 9, discovery,
entries and state 11, service 8, viewer 2, e2e 2; red before, for the reasons above). 888 unit
tests (852 on `main`), 119 of 119 e2e; V20a's Codex specs pass unchanged (their fake `codex`
starts no daemon). Real Codex 0.163 on the person's daemon through `symbiote view` in Chromium, in a
throwaway repository outside `/tmp`: started 1.82 s after Start; a message while it worked joined
the turn and was in the thread 0.79 s after Send; it committed in the linked worktree from its
sandbox (`338aa87`), ready 12.7 s later; `symbiote view` stopped mid-turn and started again read
"working", and the turn ended without Symbiote (13.3 s); an approval read "Waiting: approval prompt"
2.2 s after the message, "Stop it and send" ran the next turn (1.9 s); Stop 0.36 s; Start again a
new named thread (1.6 s); the list 19–26 ms, a summary read 4–5 ms, the panel's 50-turn read
10 ms; Clean up archived both threads. Screenshots light and dark at 1440, 900 and 390 px, no
page errors. Everything made was removed and all 3 threads archived (`thread/list` by folder: 0
listed, 3 archived), with the probe's thread on the private server. Not verified: a turn typed in
Codex's own terminal on the real daemon, an approval answered there (both V27b), the daemon
restarting during a turn (the fake only), macOS and Windows.

Merged into main (2026-10-20), with V27b (entry below).

## V27b spike — Codex's own terminal on a Symbiote thread (2026-10-20, branch `milestone/v27-codex-terminal`)

Asked: "Start v27b". Codex 0.163.0, the person's daemon: a thread started as V27a starts one, in a
throwaway repository's linked worktree, then `codex resume <thread> --remote unix://… -C
<worktree>` in node-pty (120 × 40), driven by a script reading the screen with escape codes
stripped; the trust questions measured in throwaway `CODEX_HOME`s with a private app server.

**Learned**:
- **Symbiote has been making Codex trust each repository it starts Codex in, since V20a, without
  saying so.** `thread/start` with `sandbox: "workspace-write"`, the same sandbox in `config`, and
  `codex exec -s workspace-write` each wrote `[projects."<repository>"] trust_level = "trusted"`
  into Codex's `config.toml` (4 of 4); `thread/start` with neither wrote nothing and got a
  read-only sandbox. Found because the person's config held entries for V27a's throwaway
  repositories, written at the second their threads started. There is no writable sandbox without
  it; Symbiote will say so (decision 162).
- **The TUI still asks for the worktree**: "Trust this folder? Codex can read, edit, and run files
  here, subject to your permission settings. Folder settings can run code automatically … Your
  trust decision will be saved", then "1. Trust and continue · 2. Back to Agent Command Center".
  No way on without trusting. The repository's entry did not count for its linked worktree.
- **Joined, it is the thread**: first output in 49 ms; Symbiote's turns drawn with their answers; a
  turn typed there in Symbiote's read 111 ms after Enter; the approval Symbiote's turn asked drawn as
  Codex's prompt ("Would you like to run the following command? … 1. Yes, proceed (y) · 2. Yes,
  and don't ask again … (p) · 3. No … (esc)"), and `y` there cleared "approval" from Symbiote's read in
  65 ms, the turn done 0.85 s later. Codex said why before asking this time (V27a's run: no word).
- **An Enter written with the text is not a submit**: Codex reads a fast run of characters as a
  paste. Text, then Enter on its own, submitted. A 208-character line written at once (Send the
  verdict) stayed in the input as plain text.
- **Esc interrupts the turn; Ctrl+C clears the input, and on an empty one quits the client** ("Any
  running work continues", exit 0); a hang-up exits 0 and leaves the thread as it was.
- **An interrupted turn's command runs on.** After Esc, and after Symbiote's own Stop (`turn/interrupt`,
  V27a), the turn's `sleep` went on as a Codex "background terminal" (alive 18 s after Stop).
  `thread/backgroundTerminals/clean`, an experimental method a client opts into at `initialize`
  (`experimentalApi`), ended it in 7 ms; `…/list` named it first. V27a's Stop is not V20a's.
- **Memory**: the TUI is 266 MB for Codex and 49 MB for its Node wrapper, against 140 MB for
  Claude Code's `attach`.
- **The list is not read after a turn typed in the panel's terminal**, unless an agent works or
  waits: V21's terminal has had this gap for Claude Code too; its e2e passes because its fake
  agent stays "working". The V27a "As built" said V21 had a rule: it had none.
- Whether Codex counts a trusted folder above a worktree stayed open: in a throwaway `CODEX_HOME`
  the TUI asked to sign in before anything else.

**Not tested**: the TUI on a thread the daemon no longer holds (a restart); two TUIs on one thread;
Codex's colors in Symbiote's terminal theme. Cleaned up: the thread archived, the repository removed,
and the 4 trust entries this session's runs wrote taken out of the person's config (two older ones,
for folders of an earlier spike that no longer exist, left as they are).

## V27b — Codex's terminal in its workspace's panel (2026-10-20, branch `milestone/v27-codex-terminal`)

Asked: "Start v27b". A Codex workspace on the app server gets V21's Terminal tab: Codex's own TUI
joined to its thread (`codex resume <thread> --remote <address> -C <worktree>`), the panel opening
on it, the thread read only. When Codex will ask to trust the worktree, the panel says so first.
Stop ends the turn and the commands it left. The list is read while any terminal is open. The
start dialog and the README say that Codex trusts the repository on any writable start.

**Learned**:
- **The trust note must go once it is answered.** Planned to stand while the terminal was open,
  it still sat above an approval in the real run, after the person had trusted the worktree. Any
  key in the terminal answers Codex's first question, so the first key now takes it away.
- **A fake in a template literal, again**: the first fake TUI wrote `\n` where the template needed
  `\\n`; the generated `codex` failed to parse, `daemon start` failed with it, and Symbiote quietly ran
  `exec` (the e2e saw "working" and no thread). A syntax check that copies the template's text
  without reading its escapes passed: it must interpret them. V21 found the same trap.
- **Codex takes a fast run of keys for a paste**: with no delay between keys (Playwright's
  default), the Enter after them did not submit; at 60 ms a key it did (128 ms to the thread).
- **Stop's own time is milliseconds**: `turn/interrupt` 10 ms, idle at 12 ms, the clean 0 ms;
  `POST /api/workspaces/stop` 45 ms with the command ended. The driver's 4.06 s was Playwright's
  click waiting for the button to settle: measure the API when a page number looks wrong.
- **The terminal panel overflows at 390 px**, for Claude Code too (the page 670 px wide): V21's,
  found here, proposed as its own fix.
- The TUI measured 100 MB (and 50 MB for its Node wrapper) when it joins, 266 MB once a thread's
  history is drawn (spike): four Codex terminals can hold over a gigabyte.

**Verification**: tests first (client 2, trust 2, service 2, panel 3, reads 2, e2e 1; the e2e red
without the held reads at "Working", and without the first-key rule at the note). 899 unit tests
(852 on `main`), 120 of 120 e2e. Real Codex 0.163 on the person's daemon through `symbiote view` in
Chromium: the trust question 0.29 s after the page opened and answered in the panel; a commit
from the sandbox in 15 s; a turn typed in 128 ms to the thread; an approval answered with `y` in
the panel's terminal (22 ms to clear "needs you"); Stop 45 ms with the command ended; no page
errors; screenshots light and dark at 1440 and 390 px. Cleaned up: 5 threads archived, the
throwaway repositories deleted, the person's Codex configuration as it was before the runs.

Merged into main (2026-10-20): V27a and V27b, no conflicts (`main` had not moved since the branch
started; the merge's tree is the branch's). `main` verified after the merge: frozen install, 899
unit tests, lint, typecheck, build, 120 of 120 e2e.

## V26b — keep both by rule, built and dropped (2026-10-20, branch `milestone/v26b-keep-both`, deleted)

Asked: "he should just merge the 2", on the merger's e2e screenshots (the fake agent's first
answer there drops a side on purpose). V26b was built (a rule before the agent: every region an
addition on both sides, no line in common, in code whole top-level blocks, JSON still parsing),
then tried on real merges, then dropped: "any conflict should be resolved by the agent". Every
conflict goes to the merger agent, as V26c built it (decision 164).

**Learned**:
- **Where the rule applies, it is mostly docs.** The last 200 merges of Symbiote, Bitwarden, Qwik, zod,
  vite and CPython (952 merges, 171 conflicting, replayed with `git merge-tree --write-tree` in
  diff3 style): it wrote 8 (Symbiote's journal 6 of 11, CPython's `Misc/NEWS` 2), 6 equal to the
  committed merge.
- **A rule cannot see meaning.** File by file it would have kept two `PLAN.md` rows that both
  claim V21 (Symbiote `01161fa2f`; the committed merge renumbered one), a changelog's entries twice
  under two headings (vite `67a8f8022`), and statements added inside a method in the wrong order
  (Bitwarden `0da4f7df7`). Each needed its own guard.
- **The real merger agent on this repository's 11 conflicting merges**, through `symbiote merge` with
  Claude Code 2.1.303 (`sonnet`) and a conflict-marker check: of the 5 the rule left to it, 3
  landed (2 equal to the committed merge, blank lines aside in one; 1 missing a line the committed
  merge changed outside the regions, as V26c found), and 2 stopped rightly with "needs you" (a
  README section rewritten on one side; two milestones both numbered V21). 10.0K–56.3K input
  tokens, 9.9–49.3 s a run. `main` moved only on `--approve`.

## Fix — `symbiote/merge.md` can be committed (2026-10-20, branch `fix/merge-md-shared`)

Found while planning V28. `symbiote/merge.md` holds a project's merge rules for the merger (V26c), but
the `symbiote/.gitignore` Symbiote writes (`*`, `!config.json`) hid it, so the rules stayed on one machine.
Forcing it into git would have been worse: `reviewPlace` treats any tracked file in `symbiote/` that is
not Symbiote's (`config.json`, `.gitignore`, `AGENTS.md`) as the project's own folder, and moves the
reviews to Symbiote's cache.

Now `GITIGNORE` also un-ignores `merge.md`, `merge.md` is one of Symbiote's files, and a
`symbiote/.gitignore` whose text is exactly what Symbiote wrote from V15 on is replaced by the new text. A
`.gitignore` with any other text is still the project's and left alone.

**Verification**: 2 tests red first (a committed `merge.md` sent the reviews to the cache;
`git status` did not show `merge.md`), green after; 900 unit tests, lint, typecheck, build.
README not changed: its Merging section does not describe `symbiote/merge.md` yet (left for later).

Merged into main (2026-10-20), before V28.

## V28 spike — what Symbiote tells its agents, and how a project would change it (2026-10-20, branch `milestone/v28-agent-prompts`)

Asked: a settings page to extend the predefined agents; then "every meta prompt of every agent
should be configurable, with the defaults set as current", saved in `config.json` and shared
with everyone, only the agents' prompts at first.

Measured on `main` (`eadc0ce`): Symbiote writes 13 texts its agents are told: a start prompt per kind
(654–840 characters besides the brief), the two plan sentences (132 and 69), the 4 sentences of a
verdict for a branch's agent (`verdictText`), `symbiote/AGENTS.md` (2,935 characters, 62 lines) and
the merger's instructions (1,410). A project can change none of them. `agent.*` chooses the agent,
not its words; `symbiote/merge.md` only adds to the merger's prompt.

**Learned**:
- **`symbiote/merge.md` could not be shared.** Symbiote's `symbiote/.gitignore` hid it, and forcing it into git
  would have moved the reviews to Symbiote's cache (any tracked file in `symbiote/` that is not Symbiote's makes
  the folder the project's). Fixed on its own branch, `fix/merge-md-shared`.
- **Additions would not be enough.** This repository's CLAUDE.md keeps experiments in `spikes/`
  and ends every session pushed; the Spike prompt says "Commit nothing unless the brief asks for
  it". Only a changed prompt can drop Symbiote's sentence, so V28 makes each prompt whole and
  changeable, with today's text as the default.
- **What people change is not measured.** The 5 workspace sessions on this machine hold 16
  messages from the person: one corrected how the agent worked ("ask for my permission to do
  something, but don't do it"), before Plan first existed; the rest were answers, "continue", and
  merges V26 now makes.
- **Rewriting `config.json` breaks the project's own check.** Prettier checks `symbiote/config.json`
  here; `JSON.stringify(…, null, 2)` turns its one-line `merge.checks` into 6 lines, and
  `pnpm check` would fail. `jsonc-parser` 3.3.1's `modify` changed only the member it set (an
  array of long lines, as Prettier writes them), and removing it gave back the file byte for byte.
- **The merger's last paragraph is a contract, not a prompt**: Symbiote parses the JSON it asks for.
  It stays Symbiote's and is appended after the project's instructions.
- **One case cannot stay byte for byte with placeholders**: with no default branch, today's start
  prompt stops at "the person reviews the branch in Symbiote." V28 says "the branch the person picks",
  which is what Merge into ▾ asks since V26.

## V28a — Prompts from config.json (2026-10-20, branch `milestone/v28-agent-prompts`)

The 13 texts Symbiote's agents are told are now defaults with placeholders
(`packages/cli/src/prompts.ts`), replaced by `prompts.<key>` in `symbiote/config.json` when a project
has its own. Every use reads them: Claude Code's and Codex's start prompt, Copy the prompt, the
merger's system prompt (Claude Code's `--system-prompt`, Codex's stdin), `symbiote/AGENTS.md`, and a
verdict's text. `GET` and `POST /api/settings/prompts` serve the Settings page to come (V28b).

**Learned**:
- **Recording `main`'s prompts before changing the code made "nothing changes" checkable.**
  `test/fixtures/prompts-before-v28.json` holds 48 start prompts, the merger's instructions,
  `symbiote/AGENTS.md` and 8 verdict texts from `main`'s build; the defaults give each byte for byte,
  except decision 171's 20.
- **`symbiote/AGENTS.md` was written once a run.** A Settings change would have waited for a restart;
  it is now written again when the text in use differs from what was written.
- **Moving the texts was needed to avoid an import cycle**: `reviews.ts` reads the prompts, and
  the prompts' defaults held `reviews.ts`'s `AGENTS`.
- **A placeholder filled in one pass** keeps a brief's own `{plan}` or `{branch}` as text. The
  recorded brief holds `{plan}`, `{brief}` and `{"json": 1}` to check it.
- **`jsonc-parser` works from ESM by named import** through its UMD build (Node 24); the Action's
  `pnpm install` brings it.
- The 13 tests of `prompts.test.ts` were red first (no module). The 5 tests of each use (a
  kind's start, the merger's instructions, `AGENTS.md` after a change, a verdict's sentences, the
  server's route) were written with the code, not seen red.

**Verification**: 917 unit tests, lint, typecheck, build. The built CLI in a throwaway repository
with a fake `claude`: the settings listed, a save written as lines, the next Spike's prompt the
project's, a stale save 409. The real Claude Code (2.1.303, `sonnet`, read-only, Plan first):
Symbiote's Spike prompt gave a plan with "no commits"; a Spike prompt that keeps experiments gave
`spikes/…`, a commit and a push. Not verified: Codex with a changed prompt; the merger with
changed instructions on a real conflict; Windows' command-line limit.

## V28b — The Settings page (2026-10-20, branch `milestone/v28-agent-prompts`)

A third tab in `symbiote view`, Settings (`s`, `/settings`): the 13 prompts by agent, each in a text
area with its placeholders, Save and Reset to Symbiote's, and what saving means in git. Written
through V28a's `POST /api/settings/prompts`.

**Learned**:
- **A line count is not a height.** The merger's instructions are 16 lines but wrap to about 30
  at 1440 px: sized by lines, the text area scrolled inside itself in the first screenshot. It
  now grows with its content (`scrollHeight`), up to 70 % of the window.
- **`s` pressed before the tabs are drawn is lost**: the page's keys listen once `symbiote view`
  answered what the page is. The spec waits for the tab first, as a person would see it.
- **The Workspaces page's title is squeezed at 390 px** (its help text in a one-word column
  beside "Start a workspace"). It is so on `main`: V28b adds only CSS rules and does not touch
  that page. Not fixed here.
- The 7 unit tests of `settings.ts` were red first (no module); the 4 e2e tests were written
  with the page.

**Verification**: 924 unit tests, lint, typecheck, build; 124 of 124 e2e. Screenshots at 1440 and
390 px, light and dark, no page errors (sent to the user). The real merger (Claude Code,
`sonnet`) on one conflict, a version constant changed on both sides: with Symbiote's instructions it
kept `2.1.0`; with "a version constant changed on both sides is never yours to answer" it said
"needs you", naming both values; 4.2K input tokens a run. Not verified: Codex with a changed
prompt; Windows.

Merged into main (2026-10-20): V28a and V28b, after `fix/merge-md-shared`. Two conflicts, both
from that fix: `prepareSymbioteFolder`'s doc comment (both kept) and the journal's end (both entries
kept). `main` verified after the merges: frozen install, 925 unit tests, lint, typecheck, build,
124 of 124 e2e.

## V29 spike — today's workspace layout, and where usage can be read (2026-10-20, branch `milestone/v29-workbench`)

Asked: UI improvements after a reference (a window with workspaces and sessions in a sidebar, the
agents' terminals filling the middle, the worktree's files on the right, each subscription's
5-hour and weekly use in a status bar), "Love the fact that i can see the session usage for each
found subscription at the bottom".

Measured on `main` (`ede9e12`) with e2e's fake Claude Code and three workspaces, Chromium at
1280×720, 1440×900 and 1920×1080 (a throwaway spec, not committed): the terminal is 808×429,
965×533 and 1,444×637 px (38, 40 and 44 % of the window; 33, 41 and 49 rows). 268 px sit above it
at every size and 66 px below. The workspace list is 360 px wide and holds three workspaces in
298 px.

**Learned**:
- **Claude Code's copy of the usage on disk is not live.** `~/.claude.json`'s
  `cachedUsageUtilization` was 16.3 h old while a session ran: it is written when `/usage` is
  opened. Live numbers reach Claude Code with each answer (the `anthropic-ratelimit-unified-*`
  headers) and leave it in two places only: the status line's input (`rate_limits.five_hour` and
  `seven_day`, `used_percentage` and `resets_at`, for subscribers after the first answer) and the
  SDK's `rate_limit_event`. Hooks do not get them. Transcripts record a window only when it is hit
  (`apiErrorParams.rate_limit_info`, 2 of this repository's sessions).
- **A status line of Symbiote's would replace the person's.** Symbiote passes its hooks with `--settings`; a
  `statusLine` there would win over the person's own, which today's terminal shows. And it would
  only run where a TUI draws the session.
- **The cached copy has about 20 keys under code names**, one at 100 % here
  (`iguana_necktie`). Its `limits` list (kind, group, percent, reset) is the part meant to be
  shown.
- **Codex's windows are not "5h · wk" on every plan.** On the Go plan here, `account/rateLimits/read`
  on the daemon Symbiote already uses answers one window of 43,200 min (30 days) at 0 %, in 789 ms (it
  asks OpenAI); `account/read` gives the plan in 3 ms. Rollouts carry the same `rate_limits` per
  turn.
- **Not measured**: the endpoint Claude Code's `/usage` reads
  (`api.anthropic.com/api/oauth/usage`), because it needs the OAuth token Claude Code stored. It
  waits for the person's yes (decision 172). The token on this machine expires about 8 h after
  Claude Code last refreshed it. Symbiote must never refresh it: if the refresh token rotates (not
  checked), a refresh by Symbiote would sign Claude Code out.
- **e2e**: 125 tests; 6 selectors in 2 specs name the page tabs the shell would move.

## V29 replanned — no Workspaces page, the reference's look, a modern font (2026-10-20, branch `milestone/v29-workbench`)

Asked, on the first plan: "There is no need for workspaces page anymore … On sidenav, will see the
available pages, and under pages, will be the workspaces. On the right of page, will see the
current selected page … I want the change in styling also, to match the screenshot"; and "i don't
like the font family. Make it more modern".

Measured on `main` (`ede9e12`), Chromium at 1440×900:
- **The font is not Symbiote's choice.** `system-ui` gives DejaVu Sans here (`CSS.getPlatformFontsForNode`
  on History's rows and heading), DejaVu Sans Mono for SHAs; Segoe UI on Windows, SF Pro on macOS.
  Bundled variable fonts for Latin text: Inter 48 KB, JetBrains Mono 40 KB, Geist 29 KB, Geist
  Mono 23 KB (Latin Extended 15–85 KB more, fetched only when used); all OFL 1.1, from
  `@fontsource-variable` 5.3.0. A dark mock of the planned sidenav, workspace and status bar was
  drawn in each pair and today's font, for the person to pick.
- **A new look is mostly new tokens.** The stylesheet (3,835 lines, 601 rules) takes its colours
  from 19 tokens on `:root`, with 2 hex colours and 6 `rgb()` outside it; dark mode is one
  `prefers-color-scheme` block, and React Flow's `colorMode` is `"system"`.
- **Graph layouts do not read the font.** Node widths are estimated from character counts
  (`nodeWidth`, 9.4 px a character, measured on wide DejaVu Sans): a narrower font leaves slack,
  not clipped labels. Keeping the constants keeps every layout identical.
- **xterm measures its cell from the font it is given**: with a bundled mono, the terminal must
  open after the font has loaded, or its columns are counted with the fallback's width.
- **What the sidenav would take**: a diff's canvas is 1,140 px (300 px change list beside it);
  History's commit list 1,180 px (260 px branches panel). A 240 px sidenav takes 21 % of either; a
  48 px rail takes 4 %.
- **e2e**: 40 of the 125 tests, in 4 specs, start from the Workspaces page; 24 open `/` and expect
  it.

## V29 decisions — the live Claude source, History, Geist (2026-10-20, branch `milestone/v29-workbench`)

The person chose Geist and Geist Mono (decision 180, from a mock of the planned sidenav, workspace
and status bar in three pairs), kept History (178), and said yes to the live source for Claude
Code's usage (172: "use the truthful source").

**Measured** once allowed: `GET api.anthropic.com/api/oauth/usage` with the stored access token
and `anthropic-beta: oauth-2025-04-20`, three reads 2 s apart: 200 in 355, 218 and 265 ms, the
same 2,289 bytes, no rate-limit headers. It said 59 % (5-hour) and 53 % (weekly), while
`~/.claude.json`'s copy, 17.5 h old, said 20 % and 22 %. That copy's 5-hour window had reset
15 h before, so its number described nothing current: the plan now drops a cached window whose
reset has passed. The answer has 29 keys; 3 have a value (`five_hour`, `seven_day` and
`iguana_necktie`, a code name), and `limits` lists the two meant to be shown, with kind and
reset. The token was read in the script's process only and not printed.

## V29a — the shell: the pages and the workspaces in a sidenav (2026-10-20, branch `milestone/v29-workbench`)

No Workspaces page: a sidenav lists History and Settings, then the workspaces by group and the
merges in Symbiote's queue; the main area shows what is picked; a status bar says what the last
action did. `/` alone is History; a workspace keeps `/?branch=`; a merge is `/?merge=`.

**Learned**:
- **One window means navigation in place.** With full page loads between the sidenav's entries
  the sidenav would reload and the terminal reattach each time. Links to the shell's addresses
  are caught at the document in the capture phase, before a row's own handler (the cards' and
  badges' links only stop the click reaching their row), and pushed. History mounts anew on each
  visit, since it reads `?branch=` once.
- **In place, nothing unloads.** Settings' `beforeunload` question about unsaved prompts never
  came; the shell now asks for the page (`confirm`), on Back too.
- **History's first rows wait on font matching here.** A trace of the first load: one layout of
  859 ms wall time and 2.3 ms thread time, for 50 layout objects. With one installed font for
  every element the wait is gone and the first rows show at 85–107 ms instead of ~950 ms; the
  sans stack alone (`system-ui, -apple-system, 'Segoe UI'`) costs ~570 ms, the monospace stack
  (`ui-monospace, SFMono-Regular, Menlo`) ~300 ms. `main` has it too, after its first paint. The
  sidenav's key hints in the monospace stack brought it before the first paint (blank ~920 ms in
  3 of 14 loads); in the text's font they no longer do. Not chased in V29a: V29b bundles its
  fonts and names only them and generic families. Measured in headless Chromium on Linux (WSL);
  a browser on Windows or macOS may never wait.
- **A long notice cut to one line hid its button**: the status bar wraps instead.
- **A key pressed as soon as the page shows** was lost when the shell attached its keys after the
  paint (1 of 130 e2e tests); a layout effect attaches them before, as History's are.
- **A diff of `symbiote view` reads the same capabilities as the shell's pages** (`commits`): the diff
  shell flashed on History until it was kept to a diff's states.

**Verification**: unit (8 route tests, the server's repository name), 7 shell e2e tests (6 red on
`main`'s build), `pnpm check` 929 tests, e2e 130 of 130 with 31 tests in 7 specs moved from the
Workspaces page to the sidenav. The agent's terminal (fake Claude Code): 1440×900 965×533 px, 41
rows → 1136×754 px, 58 rows (66 % of the window); 1280 and 1920 in PLAN.md. `/history` on a
clone of this repository, `main` and V29a alternated 7 rounds, both orders: first paint 48/48 →
48/56 ms, first rows 962/970 → 963/981 ms. Not verified: real agents in the new layout; other
browsers and systems.

## V29b — the look: the reference's tokens, Geist, one density (2026-10-20, branch `milestone/v29-workbench`)

Dark by default with light and System in Settings (Appearance, this browser), the reference's
tokens, Geist and Geist Mono served by Symbiote, 44 px toolbars, 28 px rows and buttons, 6 px radii,
tinted badges, cards of 64 px, the keys behind a "?", the terminal black and edge to edge.

**Learned**:
- **A web font can cost more than the system font it replaces, through its fallback.** With
  `'Geist', sans-serif`, History's first paint went from 48 ms to 250–650 ms, and the same with
  the fonts blocked. A trace: one 1,136 ms layout, four `MatchFamilyName("sans-serif")` calls to
  the font service at ~283 ms each — after a web font, Chromium on Linux asked fontconfig for
  `sans-serif` as a family name, and did not keep the answer. As the only family, `sans-serif`
  was resolved through the browser's settings in a few ms. `monospace` was matched in about 1 ms.
- **A glyph in no family of the stack is a search of every font**: ~100 ms here
  (`FallbackFontForCharacter`). With Geist alone, marking a symbol reviewed (its ✓) took 250 ms
  instead of 33. `'Geist Variable', monospace` keeps both fast: DejaVu Sans Mono has ✓ ⚙ ↻.
  These costs are this machine's (WSL); Windows and macOS were not measured.
- **Preloading the fonts and drawing once they are in costs nothing locally**: they arrive at
  7–11 ms from Symbiote's server, before the bundle has run, and the first frame is in Geist.
- **Geist Mono's lines are tall**: a cell of 8 × 17 px at 13 px, where the fallback's was
  7.1 × 13. The terminal's box grew to 71 % of a 1440×900 window and its rows fell from 58 to 46
  (`main` 41). Row targets depend on the font; the box is what the layout controls.
- **WCAG's contrast for "lines"** applies to a control's edge, not to a hairline between
  regions: text fields got their own `--edge` token at 3:1; the reference's region lines are
  1.31:1 and stay.
- **A reload asked during a read was answered by that read** (`loading ??=`), which could have
  started before the change: Land, clicked as its merge opened in the shell, kept "Merged, not
  checked", and nothing read again. V29a's in-place navigation opened the window (the view's
  reader starts as it mounts); the fonts' timing made it fail twice in a row. `reloadWorkspaces()`
  now reads once more after a read under way; mount, focus and timer reads still share it.
- **A test read a file written as it goes**: `reviews.spec` read the review file as soon as it
  existed, while the second mark's write was on its way. It waits for both marks now.

**Verification**: unit tests red before (the theme script run with each stored value and with
storage blocked, token contrast in both themes, the fonts named, the reload race with a fake
fetch); e2e red before for the race (`/api/merges` delayed 1 s) and new in `look.spec.ts` (dark
by default on a light system, Light kept across a reload and on a diff, System following the
scheme, every request to Symbiote's origin with only the two Geist families and 52.5 KB of fonts on
History, a card at most 64 px) and `shell.spec.ts` (a diff's drawer at 390 px). `pnpm check` 947
tests, e2e 135 of 135. Against `main` (`ede9e12`), alternated: `/history` on a clone of this
repository, first paint 48 → 48/52 ms, first rows 969/973 → 131/131 ms (7 rounds, both orders);
Bitwarden `737ee3f`'s graph: first paint 1.95–1.98 s → 0.26–0.29 s, select 79–82 → 73–75 ms,
mark reviewed 33 → 33 ms, pan 63 fps both; labels cut short as j walks 40 changes 62 → 52 of
180, none new. Screenshots, dark, of History, Settings, a workspace, its thread, the start
dialog and a diff at 1280, 1440 and 1920 px (all but the dialog at 390 too) and a merge at
1440; light at 1440. Not verified: real agents in the new terminal; other browsers and
systems; the README's screenshots.

## V29c — usage in the status bar (2026-10-20, branch `milestone/v29-workbench`)

Each subscription Symbiote's agents run on, at the status bar's right: `Claude Pro · 5h 59% · wk 66%`,
`Codex Go · 30d 0%`. Claude Code's from the endpoint its `/usage` reads, with the token it stored,
read only (decision 172); Codex's from its app server. `symbiote view` keeps a 60-s copy
(`GET /api/usage`).

**Learned**:
- **Claude grades its own windows**: `limits[].severity` read `"warning"` at 79 % of the
  5-hour window. A fixed 80 % threshold would have shown it green; the window carries the
  warning now. Other words are not read until seen.
- **The shapes** (Claude Code 2.1.303 on Pro, Codex 0.163 on Go, read today): Claude's `limits`
  list has `kind` (`session`, `weekly_all`), `percent`, `resets_at` (ISO with microseconds),
  `scope`; its plan is `oauthAccount.organizationType` (`claude_pro`); its token file has
  `expiresAt` in ms. Codex's `account/read` gives `type: "chatgpt"` and `planType`;
  `account/rateLimits/read` (0.8 s, it asks OpenAI) `primary`/`secondary` with `usedPercent`,
  `windowDurationMins`, `resetsAt` in seconds, and `rateLimitReachedType`; no experimental
  opt-in needed. Codex's sessions carry the same in snake case.
- **A fallback can reach the person's files from a test.** The first run of the usage spec fell
  back to Codex's sessions in this machine's `~/.codex`. Every spec now runs `symbiote view` with
  `SYMBIOTE_USAGE=off`, and the usage spec gives Claude Code a `CLAUDE_CONFIG_DIR` and Codex a
  `CODEX_HOME` of its own.
- **"One read at a time" needs the decision taken before the read**: a refresh with nothing due
  still left a promise "under way" for a tick, and the next ask, past 60 s, reused it and read
  nothing (a unit test found it).
- **Unexplained**: in 2 of the first ~10 runs of the usage spec Codex's live read failed once;
  not seen in 36 runs since, instrumented ones and a full suite included.

**Verification**: 16 unit tests of the readers and the copy, 1 server test, 6 viewer tests, 2
e2e (red before: no module, a 404), `pnpm check` 970 tests, e2e 137 of 137. Real use on this
repository: Claude 79 % and 68 %, later 83 % (warning) and 69 %, Codex 0 %, each equal to a
direct read of its source in the same minute; not compared with the `/usage` and `/status`
screens themselves. `/api/usage` from memory 0.79 ms median, the first ask 689–799 ms. Not
verified: the macOS Keychain read.

## V29d spike — what the branch's changes cost, and the room beside the terminal (2026-10-20, branch `milestone/v29-workbench`)

Measured on V29c's build (`a5807da`), Chromium, e2e's fake Claude Code (a throwaway spec, not
committed).

**Learned**:
- **A workspace says how much, not what.** Its head says "2 commits · 1 file not committed yet ·
  Merges cleanly into main"; which files takes a Review, an analysis: 4.6 s for this branch
  against `main` (15 commits, 66 files).
- **The git reads are cheap.** On this branch: `git log` 1 ms, `diff --numstat -M` 17–18 ms warm
  (43 cold), `diff --name-status -M` 17 ms. `git status --porcelain -z --untracked-files=all`: 5
  ms here, 14 ms warm and 572 ms cold in a Bitwarden worktree of 9,147 files. Reading them with
  every read of the list (every 5 s while an agent works) costs little once commits and files are
  kept per (base, tip).
- **The plan's 280 px did not fit its own rule.** The terminal's box is 1024×612, 1184×782 and
  1664×969 at 1280, 1440 and 1920 (68, 71 and 78 % of the window). Beside 280 px it would keep
  49, 54.5 and 65 %: under the 55 % the plan asks at 1440. Beside 256 px: 51, 56 and 66 %, 116
  columns at 1440. The rule is the area's width, not the window's: with the rail, 1280 has room.
- **`git diff --raw --numstat -z` gives both in one run**, raw records first; kept as two runs
  (`listChangedFiles` exists and is tested), in parallel.
- **The recorded base and the fork point agree** on this repository's 3 workspaces with a branch
  (the other 3 branches are gone): too few to tell how often a branch is rebased. The panel takes
  the fork point, as Review does (decision 187).

## V29d — the branch's changes beside the terminal (2026-10-20, branch `milestone/v29-workbench`)

A workspace shows its branch at the terminal's right: the commits since the fork point and the
files they change with their lines (what Review will show), then the files its worktree has not
committed. A file opens in VS Code in the worktree at its first change. 256 px, where the
workspace's area is at least 1,200 px wide; `]` hides it, kept per browser.

**Learned**:
- **The plan's width broke its own rule.** 280 px would have left the terminal 54.5 % of a
  1440×900 window, under the 55 % asked; 256 px leaves 56 % and 116 columns (measured with the
  panel built: 928×782 px). A container query on the workspace's area, not a media query on the
  window: the rail gives room at 1280.
- **Two counts of a branch's commits.** The head's `ahead` counts from the workspace's recorded
  base, the panel (and Review) from the fork point: after a rebase onto a newer `main` the head
  says 2 where the panel lists 1. Not changed here: `ahead` also decides a finished agent's state.
- **An empty branch is "merged" by the fork point** (the fork point is its tip), as a merged one
  is: told apart by the recorded base, so a new workspace says "since main" and a merged one
  "since it started".
- **Untracked files need a cap too**: a build's output that nothing ignores lists every file
  (`--untracked-files=all`), every 5 s.
- **`git diff -U0 <base> -- <path>` in the worktree** finds a file's first change in the working
  copy, committed or not, in one run; a rename is found only with both of its paths in the
  pathspec (with the new one alone the whole file is new, line 1).
- **A light theme's text on the terminal's black**: V29b's tab joined to the terminal kept the
  theme's text colour, near-black in light (1.25:1). Seen only in a light screenshot of a
  workspace; fixed on its own commit with an e2e contrast check.

**Verification**: tests first, red before — 7 core (numstat with renames, binary files, tabs;
the worktree's status; the first changed line, a rename through both paths), 3 workspaces (the
changes, a rebase, merged, gone branch and worktree; the caps; opening at the change, paths
outside refused), 1 server, the editor's file at a line, 6 viewer unit, 3 e2e. `pnpm check`
988 unit tests, e2e 140 of 140 in two runs in a row. One full run before them failed and its
output was cut to its last lines: which test failed is not known (no failure in the 3 runs
around it). The terminal at 1440×900 beside the panel 928×782 px (56.0 %, 116
columns), 1184×782 without it; 1920 65.8 %; 1280 with the sidenav open: no panel, 68 %.
`changes()` on the V29 branch of a clone of this repository (17 commits, 76 files): 57 ms first,
26–28 ms after; a Bitwarden worktree's status and lines 291 ms first, 14–16 ms after. Screenshots
at 1280, 1440, 1920 and 390 px dark, 1440 light. No layout, graph or analysis code changed. Not
verified: real agents with the panel; VS Code itself (a fake `code` records its arguments);
browsers other than Chromium.

Merged into main (2026-10-20): V29a, V29b, V29c and V29d, no conflicts (`main` had not moved
since the branch). `main` verified after the merge: frozen install, 988 unit tests, format, lint,
typecheck, build, 140 of 140 e2e.

## Fix — a workspace's commits counted from its fork point (2026-10-20, branch `fix/commits-from-fork-point`)

Found in V29d: the head's "N commits" (`ahead`) counted from the commit the workspace started at,
the changes panel and Review from where the branch leaves the default branch. After the agent
rebases onto a newer `main`, or merges `main` in, `main`'s commits were counted as the
workspace's: 2 where the panel and Review listed 1.

**Learned**:
- **What the count decides, in practice, is the label.** It also picks "Ready for review" over
  "Finished without commits" and gates the merged check, Review and Merge. But a branch whose
  only commits are `main`'s has its tip in `main`, so it reads "Merged" before and after the fix;
  a branch with commits of its own counts above 0 either way. Said wrongly to the person at first
  (that a rebase alone would read "Ready for review").
- **The default branch was looked up once per workspace** by the new fork point (a git run per
  remote): one lookup per read of the refs now, shared by the list's trunk and every workspace.

**Verification**: a unit test red before (after the rebase, 2 against the panel's 1): the list's
count equals the panel's with no commits, one, after a rebase, after `main` merged in (its commit
and the merge), and merged into `main`. `pnpm check` 989 unit tests; e2e of the workspace specs 51
of 51. `list()` with 5 workspaces on a clone of this repository: `main` 96 and 96 ms (medians of
15), the fix 112 and 123 ms with a lookup per workspace, 102, 106 and 110 ms with it shared;
back to back, not alternated.

Merged into main (2026-10-20), after V29, no conflicts. `main` verified after the merge: frozen
install, 989 unit tests, format, lint, typecheck, build, 140 of 140 e2e.

## N1 spike — a native window: Tauri's engine against Chromium (2026-10-20, branch `feature/tauri-integration`)

Measured before planning, on this machine (WSL2 on Windows 11, WSLg, Ubuntu 24.04), with a
`symbiote view` of its own on a clone of this repository (`SYMBIOTE_CACHE_DIR` in the session's temp,
`SYMBIOTE_USAGE=off`, `SYMBIOTE_TERMINAL=off`), never the person's servers. The scripts stayed in the
session's temp folder.

**Learned**:
- **Tauri draws with the system's engine**: on Linux WebKitGTK, which Symbiote had never run in. Ubuntu's
  WebKitGTK 2.52.6 (the runtime is installed; a Tauri build also needs its `-dev` packages, with
  sudo) draws History and a 445-symbol diff (`26ac1c6~12..26ac1c6`) as Chromium does: no page
  errors, Geist loaded, the map's 701 nodes and 263 edges.
- **It is slower where Symbiote works hardest.** `j` (next change), from the key to the next paint,
  median of 10: Chromium 33 ms in 3 of 3 rounds (two frames, the measure's floor); WebKitGTK 77 and
  145 ms (the third round did not report), its first step 360–415 ms, its slowest 160–174 ms.
  First paint was alike (diff: 52–84 ms against 57–60 ms). Both rendered in software (Xvfb,
  headless): a desktop with a GPU may narrow the gap; Bitwarden's graphs would widen it.
- **Driving WebKitGTK without root**: its GObject typelibs and pycairo from `apt-get download` and
  `dpkg -x`, with `GI_TYPELIB_PATH`. Playwright's own WebKit needs `libgtk-4-1` and three more
  (sudo): not run.
- **Traps in measuring it**: under Xvfb `Gdk.pixbuf_get_from_window` gives a blank image (5,829
  bytes, with every renderer setting tried); WebKit's own `get_snapshot` shows the page.
  Synthetic wheel events do not pan React Flow: a frame count while "panning" measured nothing
  (the view had not moved); keys do work. WebKitGTK printed EGL and MESA errors here (ZINK found
  no device).
- **Tauri's Chromium**: a CEF runtime exists, incomplete (an open issue of March 2026 asks for
  back, forward and reload). Electron 44.9.2 is current.
- **The server starts in 211–232 ms** (3 runs, to its `Symbiote viewer:` line): a window can show Symbiote
  at once, without a terminal. **Agents outlive it** (decision 95), so closing a window is Ctrl+C.
- **Windows reaches a server in WSL** at `127.0.0.1` in 2.4 ms, `localhost` in 218 ms.
- **`pgrep -f` with the pattern on its own command line** matched this session's shell once
  (exit 144, as CLAUDE.md warns); the person's three servers were untouched (the same PIDs
  after). Match a full path or a unique port.

**Decided with the person**: Electron, not Tauri ("Should we go with Chromium? is it better?",
then "Yes, plan go with Electron"); Symbiote's own title bar, with the OS's buttons on Symbiote's
colour. Plan: PLAN.md, N1.

## N1 — Symbiote's own window: Electron, the launcher, its own title bar (2026-10-20, branch `feature/tauri-integration`)

N1a: `symbiote view` and `symbiote pr` open the viewer in an Electron app (`packages/desktop`) when it is
set up (`pnpm app:setup`), else the browser. N1b: `symbiote app install` puts Symbiote in the desktop's apps;
opened there, the app starts the repository's `symbiote view` itself, and a start page opens
repositories. N1c: Symbiote's own title bar, with the system's buttons on Symbiote's colour.

**Learned**:
- **pnpm adds exclusions on its own.** Electron 44.9.2, out that day, was refused by the
  repository's minimum release age, and `pnpm install` added `minimumReleaseAgeExclude:
  electron@44.9.2` to `pnpm-workspace.yaml` to get past it. Removed; 44.9.0 pinned (decision 203).
  Read the workspace file's diff after adding a dependency.
- **Electron cancels a close in silence.** A page whose `beforeunload` asks keeps the window open
  and nothing is shown: the app must answer `will-prevent-unload` itself (the system's dialog).
- **Playwright and Electron's events.** Keys typed by Playwright (the DevTools protocol) never
  reach `before-input-event`, where the app takes zoom: `webContents.sendInputEvent` does. A page's
  `beforeunload` reaches Playwright too, which, with no listener, dismisses a dialog Electron never
  shows and fails on "No dialog is showing".
- **A sandboxed preload is CommonJS and loads nothing of its own**: one `.cts` file, with
  `import x = require('electron')` (`verbatimModuleSyntax`). Logic it shares with the main process
  (which keys) is duplicated in a few lines rather than bundled.
- **Ask the main process for the screen.** Under Xvfb, `Gdk.pixbuf_get_from_window` gave a white
  image of Electron's window as it did of WebKit's; Electron's `desktopCapturer` gives the screen,
  the system's buttons included (Playwright's screenshots have the page only).
- **The title in the shell's render re-rendered the whole shell** at each read of the workspaces;
  moved to a component of its own. Not the cause of the shell's keys test failing in full runs: it
  fails on `main` too under load (4 of 12 runs at 6 workers; 3 of 12 on the branch) — a card's
  group changes as the fake agent moves on, and the focused card is mounted anew. Not changed
  here: its own `fix/` branch.
- **`app.ts` beside `App.tsx`** would be one file to macOS's file systems in an import of
  `./App.js`: the viewer's side of the app is `desktop.ts`.
- **A launcher reads no shell profile**: node from nvm, and `claude`, `codex`, `code` on the
  `PATH`, are recorded by `symbiote app install` and again by each `symbiote view` that opens the window.

**Verification**: 33 desktop, 16 CLI and 7 viewer unit tests, red before; `pnpm check` 1,047. 16
e2e on the real app under Xvfb (7 from `symbiote view`, 5 from the launcher, 4 of the title bar); the
full suite 154 of 156 (the shell's keys test, failing on `main` too under load; a Codex spec's
lazily loaded chunk lost to its server's stop). From the launcher to History's first paint
383–493 ms (5 runs); on the 445-symbol diff `j` 32–33 ms, Chromium's; memory 771–893 MB summed over
the app's processes. Screenshots of History, a workspace, Settings in light and a diff, with the
system's buttons, taken with `desktopCapturer`. Not verified: macOS, Windows, native Linux window
managers, Ubuntu 24.04's AppArmor on a real install, WSLg's Start menu, a real agent in the app's
terminal, a GPU.

## N1 — the first merge's check, and two races on `main` (2026-10-21, branch `feature/tauri-integration`)

The person approved `5709575`; Symbiote's merger ran the project's check on the merge (`pnpm test:e2e`
among it) and stopped on two specs.

**Learned**:
- **A merge check runs where the person is.** `pnpm test:e2e` ran on the person's desktop, not
  under Xvfb: the app's specs opened their windows there through WSLg, and its window manager moved
  them ("remembers the window" asserted exact bounds). Specs that start windows now start their own
  Xvfb. On WSL, Xvfb finds no display number by itself (`-displayfd` alone: /tmp/.X11-unix is not
  world-writable) and listens on an abstract socket only, so there is no socket file to wait for;
  a fixed number from :99 with `-displayfd`, which it answers when ready, works. A spec that died
  before stopping its Xvfb left it running with its lock file: found the next day, stopped.
- **The Codex spec's failure was a race on `main`**: it stops its first server while the page is
  on it, right after a start opened the new workspace, whose thread loads Markdown's chunk lazily.
  1 run in 36 on `main` and on the branch alike; made certain by holding that chunk back 2 s, it
  gave the merge check's exact error. The page now leaves first.
- **A command's only child is not always the one you started.** Run twice as the merge check
  runs, "symbiote view opens its window" timed out: it took `symbiote view`'s only child for the app, and
  under load that child was a short-lived `git`, caught before Electron started; it was stopped,
  the window stayed. The spec now waits for `symbiote view`'s new line, "Symbiote's window is open: close
  it, or Ctrl+C, to stop", and finds the app by its command line.
- **The shell's keys spec failed under load because of a real bug**: a workspace whose agent moves
  on is drawn anew in another group of the sidenav, and the focus fell to the page; arrows then did
  nothing. The sidenav now follows the card the focus was on, when nothing else took it.

- **The Settings spec raced a frame**: the `{plan}` button places the cursor on the next frame;
  filled before it, the new text went in after `{plan}` instead of replacing the text (4 runs in
  48 at 8 workers on `main`, 3 on the branch). The spec waits for the cursor: 48 of 48.
- **Left as it was**: the usage spec's Codex live read, unexplained since V29c, failed once in four
  full rounds and 1 run in 32 of the spec at 8 workers.

**Verification**: the app's 16 specs with the desktop's `DISPLAY` and `WAYLAND_DISPLAY` set, no
window on the desktop, no Xvfb left; the Codex race forced (an error) and fixed (none), 72 runs at
6 workers before and after; a new spec moving the focused card's workspace to Needs you, red then
green; both shell specs 24 of 24 at 6 workers (the keys spec failed 3 and 4 runs in 12 before, on
the branch and on `main`). The merge check's commands, as Symbiote runs them (install, check, build,
e2e) on this machine: before these fixes 155 and 156 of 157 (the app's own spec timing out in
both, the usage spec once); after the spec found the app by name, 157 of 157, then 156 (the
Settings race, then fixed); with every fix, 157 of 157.

Merged into main (2026-10-21) by Symbiote's merger, from the approved `2e44a6f`, no conflicts (`main`
had not moved since the branch). `main` verified after the next merge (the usage fix, below):
frozen install, 1,054 unit tests, format, lint, typecheck, build, 158 of 158 e2e.

## Fix — usage keeps Symbiote's own last read, reads every 5 min; a program's output read to its end (2026-10-21, branch `fix/usage-keeps-live-numbers`)

Asked: "sometimes, the claude hourly session disappears, and the chatgpt hourly session does not
exist"; then "Make the query for usage every 5 minutes instead of one" and "No claude copy
code...show the last monitored value from the real usage".

**Learned**:
- **Claude's usage endpoint refuses reads close together.** Two `symbiote view`s of this repository,
  each reading every minute while asked: 4 reads in 90 s answered 200 (06:41:53 and 06:43:23,
  both servers in the same second each time), the next pair 429, and the 5-minute back-off began
  again. No `retry-after` was read. Its limit is not documented and was not measured further.
- **Through a 429, the bar showed Claude Code's copy**, from 20:16 the day before (the last time
  its `/usage` was opened): its 5-hour window had reset, so only `wk 22%` was left, while the live
  numbers were 30–35 % and 18 %. 34 of 46 answers in 12 minutes, logged from both servers, were
  that copy. `usageService` meant to keep the last numbers on a 429
  (`read.subscription ?? (read.backoff ? last : null)`), but the reader always gave the copy.
- **Codex has no 5-hour window on the Go plan.** `account/rateLimits/read` answers one window,
  43,200 min at 0 %, `secondary: null`, in `rateLimits` and `rateLimitsByLimitId` alike; its
  sessions carry the same. An unstarted window's `resetsAt` moves with each read (now + 30 days).
- **At 5 minutes the 429 back-off (5 minutes) delays nothing**: the next read is due then anyway.
  It is kept for a shorter interval; its test gives one of 60 s.
- **The usage spec's Codex first read, open since V29c, was Symbiote losing a program's output.** Codex
  was missing from the first answer in 3 of 7 full e2e runs on this branch. A spec that only
  loads the page and reads that answer found it in 2 of 8 runs at 8 workers. Logged with a file
  write per step it never failed (0 of 48 runs); logged in memory, it did (2 of 128):
  `codex app-server daemon start` had exited 0 with 0 of its 252 bytes, so no socket, no app
  server, and the sessions' fallback found none in the test's `CODEX_HOME`. `runProgram` answered
  at the exit plus one tick ("let the last chunks already written arrive"); under load the output
  came later. Real use had the same window: Codex hidden until its daemon is looked for again a
  minute later, and at 5-minute reads until the next read.
- **A service a program starts can hold its output**, as `runProgram`'s comment said: it now
  answers when the output closes, or 1 s after the exit while it is held. Symbiote's end stays open:
  closed, the service's next write would end it (`SIGPIPE`).

**Changed**: Claude Code's copy is no longer read. Each live read is kept in Symbiote's cache
(`usage/claude.json`, shared by every `symbiote view` on the machine; written to a temporary file and
renamed into place), with the account's `accountUuid`; a failed read gives that last read for the
same account, without the windows reset since, and why. In memory, a failed read, or a copy older
than the numbers kept (Codex's sessions), keeps the last numbers. The hover says "Read 12 minutes
ago, not since: Claude's usage asked to wait (429)" and the bar shows the age. The vendors are read
at most every 5 minutes (decision 175); the page still asks `symbiote view` every minute.

**Verification**: unit tests red before: the day-old copy over live numbers (the copy's `wk 22`
in place of `5h 30 · wk 18`), the 5-min interval (red with 60 s), the hover and the bar's age,
Claude Code's copy shown on a 429 and on an expired token, nothing kept in the cache, another
account's read; `runProgram`'s output written after the exit (red: `early` without ` late`),
and a child holding the output 5 s (answered within 3 s). An e2e test red on the previous build:
a `symbiote view` started while the endpoint answers 429 shows the last read an earlier run kept,
with its age and why (the build showed no Claude). The first-answer spec, 128 runs at 8 workers
each way: the old `runProgram` 4 without Codex, the new 0. Real `codex` runs, 10 each: the same
medians as at the exit (daemon start 46 ms, `login status` 42 ms), with all their output.
`pnpm check` 1,054 tests, build, e2e 158 of 158 in two runs after a forced rebuild.

Real use, a fresh `symbiote view` asked every 30 s like a page: on the 5-min build, for 21 min, its
first read 429 (just after the two 60-s servers'), then 3 of 3 live (5h 40, 44, 47 %); on the
final build, for 11 min, 07:09:26 live and 07:14:26 429, through which the bar kept
`5h 47% · wk 20%` with its age and the 429's note. `~/.cache/symbiote/usage/claude.json`: 301 bytes,
the account's id and the subscription, no token.

Not verified: `claude --bg` (it starts a real session), which may now answer up to 1 s after it
exits if its background process holds the output; the servers already running keep the old code
until restarted.

Merged into main (2026-10-21), after N1, no conflicts. `main` verified after the merge: frozen
install, 1,054 unit tests, format, lint, typecheck, build, 158 of 158 e2e.

## V30 spike — the start dialog, and how agents keep an effort level (2026-10-21, branch `milestone/v30-start-page`)

Asked: "the create a workspace should not be in dialog. it should be itself a page, rendered fully
on the right of sidenav, and with an option for initial effort, for that session".

**Learned**:
- **The dialog is the same 640×626 px at every window size**: 38 % of the main area at
  1440×900, 23 % at 1920×1080. With More open its content is 883 px and scrolls inside the dialog
  at 1280×720, 1440×900 and 390×844; only 1920×1080 holds it. Its text areas are 598 px wide
  whatever the window. Measured with a throwaway spec on `serveWorkspaces`, deleted after.
- **Claude Code keeps `--effort` for the session, through Symbiote's reply.** Each assistant line of
  its transcript records `effort`. `--bg --effort low` ran `low`; after `claude stop`, a
  `--bg --resume <id> "<text>"` without flags said "woke session … with its saved options (--name,
  --effort, --model)" and ran `low`. A resume of a session still running started a copy, which
  ran `medium` — neither the start's level nor the person's `xhigh`. Symbiote stops first (V18c), so
  it never makes that copy.
- **Claude Code ignores a level it does not know, without failing**: "Unknown --effort value
  'bogus' — ignoring it and using the default effort", exit 0. A fixed list in Symbiote could offer a
  level that silently does nothing; its `--help` line lists the levels (low, medium, high, xhigh,
  max) and takes 70–90 ms. All five ran on Haiku, Sonnet and Opus 5.5.
- **Codex's app server keeps a thread's effort**: `effort` on the first `turn/start` gave `low`
  to that turn and to the next one sent without it, and `thread/resume` on a new connection
  reported `low` (each turn's level from its rollout's `turn_context`). `model/list` (1.1 ms)
  gives each model's levels and default; `gpt-5.6-terra` has one more level (`ultra`) than
  `gpt-6-luna`. `config/read` (3 ms) gives the configured model and level (`medium` here).
- **`codex exec resume` drops the level**: started with `-c model_reasoning_effort="low"`, the
  resumed run was `medium`. Like the sandbox (V20a), it must be given on every run.

**Verification**: real runs only, one-word prompts, in a detached worktree of this repository
(trusted through the main checkout): 3 Claude Code turns in the background, 5 `claude -p` runs,
2 Codex turns on the person's daemon and 2 `codex exec` runs. The sessions were removed (`claude
rm`), the threads archived, the worktree deleted.

## Fix — the Brief tab draws the brief as Markdown (2026-10-21, branch `fix/brief-markdown`)

Reported while planning V30: "the brief does not know to render the markdown correctly". Since
V24 the server writes a brief as Markdown (`# Fix: <title>`, then `## <part>` per part), and the
person's parts are often Markdown too, but the Brief tab drew it as source in a `<pre>`: `#` and
`##` lines, backticks and list dashes as typed.

**Learned**: the thread already drew agents' reports through `markdown.ts` (marked's lexer, its
tokens as React elements, no HTML string), so the brief takes the same path: headings, lists,
code, links, and HTML as text. The styles were the thread's (`.thread-markdown`); they are now
`.markdown`, for both. Briefs from before V24 (one text) read as paragraphs.

**Verification**: two e2e assertions first, red on `main`'s build (no heading, no paragraph in the
tab): a structured brief's headings, list items, inline code and an HTML tag kept as text; a
pre-V24 brief's two paragraphs. Then 1,054 unit tests, format, lint, typecheck, build, 159 of
159 e2e. Screenshots of the tab at 1440 × 900, dark and light.

Merged into main (2026-10-21), no conflicts (`main` had not moved). `main` verified after the
merge: frozen install, 1,054 unit tests, format, lint, typecheck, build, 159 of 159 e2e.

## V30a — Start a workspace on a page (2026-10-21, branch `milestone/v30-start-page`)

"Start a workspace" is `/start` in the main area, right of the sidenav: a head strip with where it
starts and Cancel, Clear and Start; the brief in a column up to 760 px, the branch and the agent
in a 300 px column beside it, under it below 1,000 px of page. The dialog is gone.

**Learned**:
- **A page that saves on leaving races its own next visit**: Escape posted the draft as the page
  unmounted, and `n` right after read it in the same moment. The page keeps its last save as a
  promise and reads the draft after it.
- **"Back to where it came from" needs to know there is a Symbiote page behind it.** `history.back()`
  from a tab opened at `/start` would leave Symbiote (or do nothing); the Navigation API's entry before
  this one, same origin or not, decides. A diff before `/start` is Symbiote's too: Back loads it.
- **A link was the simpler ⊕**: the shell already opens its own addresses in place from any link,
  and on a diff a link loads the page; a button needed both paths written out.
- **A flex head squeezed "From main at …" into a 60 px column at 390 px**; a grid with its own
  narrow areas puts it on a row of its own.
- **Margins that line the two columns up separate nothing in one column**: the Branch field sat
  against "More" at 390 px until its zero margin was kept to the two-column layout.

**Verification**: unit tests first (route, title, the server's `/start`: red), then 1,055 unit
tests, format, lint, typecheck, build. e2e: `start.spec.ts`'s 6 tests red on the plan's build,
then green; 52 tests in 8 specs moved from the dialog to the page; 165 of 165. The page's
measurements and `n`'s time against `main`'s dialog (median 37 against 41 ms) are in PLAN.md's
V30a results. Screenshots at 1280 × 720, 1440 × 900 and 390 × 844, dark and light. Not verified:
Firefox and Safari; the Electron window by eye.

## V30b — the agent's effort, for the session it starts (2026-10-21, branch `milestone/v30-start-page`)

Start a workspace offers an Effort choice beside the agent: its own default, or a level the
installed agent lists (Claude Code's `--help`; Codex's configured model, from its app server).
The level goes to `--effort`, to Codex's first `turn/start`, or to `model_reasoning_effort` on
every `exec` run; it is recorded with the workspace, used again by Start again, and said on the
Brief tab as how the agent was started.

**Learned**:
- **A level belongs to its agent, so the draft keeps the agent with it.** Keeping only the level
  made a draft whose agent was not picked lose it: the level was read against no agent. With no
  agent picked, it is the first agent's, the one the page shows.
- **Without Codex's daemon there is no list, but there can be a level**: a workspace started on
  the app server and started again after the daemon stopped falls back to `exec`, which keeps
  nothing between runs. The recorded level is given to each run.
- **A test harness written as a template literal needs its escapes doubled**: the fake Claude
  Code's `--help` broke the whole fake (a newline inside a JS string) and failed unrelated tests
  first ("each kind starts a workspace").
- **A muted line under a select reads as that select's note**: Codex's sandbox line under Effort
  looked like it explained Effort, so it became a field of its own.

**Verification**: tests first (14 CLI tests and 3 viewer tests red, then green; the draft's
reader written with its test), 1,070 unit tests, format, lint, typecheck, build, 167 of 167 e2e.
A real Claude Code workspace started through Symbiote's endpoint at `low`: its transcript's turns
`low`, before and after Symbiote's reply, in one session. The options endpoint 5 ms slower warm
(Codex's two calls). Not verified: a real Codex workspace through Symbiote (a trust entry would be
left in the person's Codex configuration), Codex `exec` with a level beyond unit tests. Numbers in
PLAN.md's V30b results.

Merged into main (2026-10-21) with V30a, no conflicts (`main` had not moved). `main` verified
after the merge: frozen install, 1,070 unit tests, format, lint, typecheck, build, 167 of 167 e2e.

## V31 spike — what the look needs, beyond its colours (2026-10-21, branch `milestone/v31-symbiote-style`)

Asked: "The interface still not feel well...feel oldish with a new look." Read a reference app's
style guide, tokens and component primitives, and its screenshot; recorded as Symbiote's own style, the
`symbiote-style` skill (merged into main 2026-10-21; renamed on this branch: "It is our own style from
now").

**Learned**:
- **V29b took the reference's colours, not its rules.** The style is "monochrome and quiet":
  neutral chrome lifted above the darkest content (`#171717` over `#0a0a0a`, 1.10:1; Symbiote's sidenav
  over its page was 1.04:1), colour for state only, selection a 10 % wash of the text. Symbiote's blue (`--moved`) is on
  49 lines: 2 the moved kind, 12 states, 35 an accent (links, picks, cursors, pressed toggles).
- **The dated parts are controls and states**: 6 native checkboxes, 8 coloured side bars,
  bordered mono chips, a solid HEAD badge, radii of 2–12 px in seven sizes where the style has
  four steps.
- **The reference's values do not all pass Symbiote's contrast floors**: region lines of 7 % white are
  1.15:1 on the canvas (Symbiote's floor 1.2), an input edge of 15 % white about 1.5:1 (Symbiote's 3:1), a
  light muted text 4.16:1 on a chip (Symbiote's 4.5). The skill's tokens take 11 values to the nearest
  neutral that passes, checked by `palette-check.mjs` with `tokens.test.ts`'s rules.
- **Font and layout constraints carry over**: Geist stays, and no system mono stack may be
  named (V29a); node widths are estimated from characters, so the chrome's 0.01em letter-spacing
  stays off the graph.

**Measured** on `main` (`e659928`), Bitwarden `737ee3f` with the Angular plugin, three runs: first
paint 267–322 ms, select 73–90 ms, mark reviewed 33–34 ms, pan 63 fps. Screenshots of the shell
with three workspaces, History, Settings, Start and the V30b diff, dark and light, kept for the
comparison.

## V31a–b — the style's tokens, the shell and the diff page (2026-10-21, branch `milestone/v31-symbiote-style`)

The tokens: the content darkest, the chrome lifted, a white page in light. Blue is a
state; selection, links and pressed controls are neutral. Checkboxes drawn, badges round and
tinted, no coloured side bars, 8–14 px radii, key caps, thin scrollbars. The sidenav's rows,
groups and cards, the page heads, the status bar (V31a); the diff's bar, findings, change list,
canvas chrome and detail panel (V31b).

**Learned**:
- **The dark theme gives the sidenav and the panels one colour** (`#171717`): a hover painted
  with `--panel` on a panel did not show. 13 hover and selected rules used a surface token; all now
  use `--hover` (a wash of the text) and `--selected`.
- **"Blue is a state" needed a list, not a rule**: 14 of 49 `--moved` uses are states (the moved
  kind, an agent working, "since", the current lane); the guard test names their selectors, and
  found 29 accent rules on `main`.
- **Restyling `.link` reaches buttons that are not links**: Settings' placeholders are insert
  buttons, now code chips.
- **The window's title-bar buttons follow `--side`** (N1c): `app.spec.ts` pinned V29b's value;
  the only e2e change outside the look spec.
- **A side bar is part of a node's content box**: the symbol's 3 px bar became a 1 px edge with
  2 px more padding, so its labels keep their width and the layout is untouched.

**Verification**: tests first, red on `main` (7 unit, 3 e2e); `pnpm check` 1,075 tests; e2e 168
of 168. Against `main`'s build, alternated, Bitwarden `737ee3f`: first paint 266–272 → 268–272 ms,
select 74 → 73–89 ms, mark reviewed 34 → 33 ms, pan 63 fps both, 3,134 elements both; labels cut
short as j walks 40 changes 21 of 75 both; `/history` first rows 93–122 → 93–96 ms. Screenshots
before and after, dark and light. Not verified: Windows and macOS rendering; the Electron window
beyond its e2e; real agents in the restyled workspace.

## V31c — History, menus, dialogs and selects in the style (2026-10-21, branch `milestone/v31-symbiote-style`)

History's refs are names in the text's font on quiet chips, HEAD a success tint instead of a solid
fill; menus are a blurred glass, dialogs float over a dimmed and blurred page with a ghost Cancel;
selects have a drawn chevron; every radius is on the style's scale.

**Learned**:
- **`backdrop-filter` makes a containing block**, as `transform` does: with the blur on the row
  menu, its `position: fixed` submenu was placed from the menu, not the window, and opened off
  screen (y 1,467 in a 900 px window); 10 e2e tests in checkout, reviews and merges failed. The
  glass now sits on a `::before` behind the items.
- **Animate floating surfaces by opacity only**: the menus measure their own box to stay in the
  window, and a scale would change it while they open.
- **An inline block that hides its overflow** takes its bottom edge as its baseline: the commit
  chip in a dialog's heading rose above the line once its border went.
- **One slow run is not a regression**: select read 88–106 ms on V31c in a run right after the
  e2e suite; five alternated rounds with `main` and V31b put it at 73–74 ms (88 once).

**Verification**: tests first, red (the radius scale, 14 off; History's names, HEAD's tint, the
menu's glass in the look spec); `pnpm check` 1,076 tests; e2e 169 of 169. Bitwarden `737ee3f`, 5
rounds alternated: first paint 265–289 (`main`) → 261–295 ms, select 74 → 73–88 ms, mark reviewed
33 → 33–34 ms; `/history` first rows 92–121 → 93–96 ms. Screenshots before and after, dark and
light. Not verified: Windows and macOS rendering; the blur's cost on a slow GPU (two layers, only
while a menu or dialog is open).

Merged into main (2026-10-21), with V31a–b, from branch `milestone/v31-symbiote-style`: `pnpm check`
1,076 tests, build, e2e 169 of 169 on `main`. Decisions 212–217 confirmed by the person.

## N1d spike — rounded window corners on Linux (2026-10-21, branch `milestone/n1d-rounded-window`)

Asked: "I want the window corner to have some radius..". A 640×400 Electron 44.9 test window per
variant, opened through WSLg and captured from Windows (PowerShell, `GetWindowRect`; only the
window's corners kept, enlarged 3×).

**Learned**:
- **Electron picks X11 here** (XWayland): `WAYLAND_DISPLAY` is set but `XDG_SESSION_TYPE` is not.
  WSLg's window rectangle has a 32 px invisible margin around an X11 window, none around a
  Wayland one.
- **A transparent window rounds**: the page's 10 px radius shows, and inside the corner the pixels
  are the desktop's (12, 12, 12), not black: WSLg composites the window's alpha.
- **A transparent window has no system buttons**: Electron drops the title bar overlay on Linux,
  its colour transparent or opaque, on X11 and Wayland.
- **Wayland is no way out**: the hidden title bar is square there too, with a close button only.

So on Linux Symbiote draws the frame and the buttons itself (decision 218).

## N1d — rounded window corners on Linux (2026-10-21, branch `milestone/n1d-rounded-window`)

On Linux Symbiote's window is transparent and its pages draw it: a 10 px radius with a hairline edge,
square while maximized or full screen, and Symbiote's own minimize, maximize/restore and close. macOS
and Windows keep their own corners and buttons.

**Learned**:
- **`setTitleBarOverlay` throws on a window without an overlay**, in the main process, and
  Electron's error dialog then blocks the app: every app e2e passed its body and hung in its
  teardown. Found by screenshotting the e2e display (ffmpeg's `x11grab`), not by the test's log.
- **A rounded clip over the page costs**: `overflow: hidden` with a radius on the root took select
  on Bitwarden's graph from 73–74 to 88–89 ms (3 rounds alternated). Rounding the strips at the
  corners instead costs nothing measurable.
- **A shell-less page is a title bar too**: `symbiote pr` in the app would have had no buttons.
- **A bisect in `dist/` survives `tsc -b`**: an emitted file edited by hand is not re-emitted
  while its source is unchanged; restore it from a copy.

**Verification**: tests first (`frame.test.ts`; 4 app e2e red before); `pnpm check` 1,080 tests;
e2e 171 of 171. Bitwarden `737ee3f` without and with the frame: first paint 278–284 / 278–283 ms,
select 73–89 / 72–88 ms, pan 63 fps both. On this machine the real window, opened by `symbiote view`
with a fresh app config and captured from Windows: rounded, the edge, Symbiote's buttons. Not verified:
resizing from an edge, maximizing through the window manager, `symbiote pr` in the app, macOS and
Windows.

## N1d — a maximized window on WSLg, held by Symbiote (2026-10-21, branch `milestone/n1d-rounded-window`)

The person's try of N1d: "The full screen is not working properly from wsl". Maximized, Symbiote's
window was 32 px right and down of the work area: the desktop showed in the strip above and left,
and the right end, with the window's buttons, and the bottom went off it, under the taskbar.

**Learned**:
- **WSLg forgets its own margin when it maximizes.** It pads a frameless X11 window with the
  invisible 32 px margin the spike saw; maximized, the window's X11 bounds are the work area,
  (2560, 0) 2560×1392, but on the screen it starts at (2592, 32). Transparent or opaque alike, so
  N1c's window had it too; full screen and a window with the system's frame are right. Known
  upstream, not fixed (microsoft/wslg#1015, #530).
- **Electron does not know the taskbar there**: its work area on WSLg's X11 is the whole screen
  (1440 high). The window manager knows it (1392): the first maximize on a screen goes through
  it, and the bounds it gives are the area to hold the window to.
- **WSLg's Wayland maximizes right but places nothing**: a window asked at (2700, 150) on the
  right screen opened at (249, 253) on the left one. Remembering the window's place would go.
- **A size asked of a maximized window is ignored, and an unmaximize lands 15–60 ms after it is
  asked**: setting the bounds right after `unmaximize()`, or 50 ms after it, was undone by it.
  The hold waits for the `unmaximize` event and the bounds to be still for 50 ms.
- **A window mapped maximized restores to the screen's corner**: Symbiote opening maximized came
  back, on Restore, at (2560, 0) instead of (2700, 150). The hold keeps the place it was asked
  from.
- **WSLg parks a window off the screen as it shows it** (at −32736 for 14 ms); minimize and
  restore send no event at all. A held window lets go only when its bounds stay off the area.
- **Playwright drives the real app on the person's desktop**, and PowerShell samples the screen
  from Windows: the check of a window manager's behaviour that the e2e's Xvfb (no window
  manager) cannot give.

**Verification**: `maximize.test.ts`, 12 tests on a fake window manager with WSLg's measured
timings, red first (no module; then the start maximized restored to the screen's corner). The
real window on this machine, sampled from Windows at the right screen's work-area corners: Symbiote's
`#171717` at all four and the taskbar below, for the first Maximize, the second (the area known,
no round trip), and a start maximized; Restore back to (2700, 150) each time. Not verified: a
double-click on the title bar and Windows' snap (held as any maximize), dragging a held window
(it moves at full size; a native maximized window restores as it is dragged).

Merged into main (2026-10-21) from branch `milestone/n1d-rounded-window`, no conflicts (`main` had
not moved since the branch): frozen install, `pnpm check` 1,092 tests, build; e2e 169 then 170 of
171 in two full runs on `main`, a different spec each time (`changes.spec.ts:94` and
`shell.spec.ts:160`, then `open-pr.spec.ts:48`), each a key press lost under load, each passing
alone (16 of 16, 8 of 8). Not N1d's: its viewer changes apply only in the app, and these specs run
in the browser.

## Fix — Symbiote's window opening maximized on WSLg took no clicks (2026-10-21, branch `fix/wslg-open-maximized`)

The person, right after N1d's merge: "I can't click on anything form the interface...". Their
window opened maximized (as they had left it) through `symbiote view`, and closed 28 s later.

**Learned**:
- **Playwright's clicks are not the mouse's.** N1d's real-window check clicked Symbiote's buttons
  through the DevTools protocol, which reaches the page whatever Windows shows; the person's
  clicks go through WSLg. Real clicks from Windows (`SendInput`, PowerShell) need the window in
  front first (`SetForegroundWindow` after an Alt press); without it they went to VS Code or
  nowhere, and an `INPUT` struct of 48 bytes (40 on x64) made `SendInput` send nothing.
- **A window maximized before WSLg maps it is stranded.** Unmaximized, it went to the left
  screen's corner, (0, 0), while it had been asked at (2560, 0); the hold's move back was
  refused, with or without a 1 px size change first, and Electron's bounds still read (2560, 0).
  Windows showed it at (−32, −32)–(2592, 1424), X11 took it for the right screen: clicks landed
  outside it. 3 runs in 3 with the work area's size as the place to open at, the person's saved
  state (WSLg's own maximize had saved it); 0 in 1 with 1200×800, where the move also resizes.
- **The launcher's run with the same state was not stranded** (1 run: its clicks landed); not
  explained. N1d's own check opened at 1200×800, where the move also resizes.
- **`show()` does not map at once**: showing first and maximizing right after still mapped the
  window maximized. Maximized after WSLg's park and back (15 and 28 ms after `show`), then 50 ms
  still, it is held on its own screen: 4 runs in 4, as soon as 50 ms after `show`.
- **PowerShell output from inside a callback is lost**: `EnumWindows`' script block printed
  nothing until its lines were collected and printed after it.

**Verification**: `maximize.test.ts`, 14 tests: the fake window manager now maps a window as WSLg
does and strands one maximized before it is mapped (a test shows it); opening maximized through
`maximizeOnceShown` and a place as large as the screen restored to 1440×900 were red first. The
real window through `symbiote view` with the person's state, twice: Windows shows it at (2528, −32)–
(5152, 1424), the right screen's work area; real clicks reached the History list and the sidenav
at their coordinates; Restore put it at (3120, 246), 1440×900, where Windows shows it too. Not
verified: the person's own try.

Merged into main (2026-10-21), no conflicts (`main` had not moved). `main` verified after the
merge: frozen install, `pnpm check` 1,094 tests, build, e2e 170 of 171 (the shell's keys spec,
`shell.spec.ts:117`, its focus lost under load as before N1; 8 of 8 alone).

## Rename to Symbiote (2026-10-21, the rename's feature branch)

Asked: replace the former name everywhere, the commands too, and keep the person's workspaces
and reviews (decisions 223–225).

**Learned**:
- **It was 4,782 occurrences in 311 of 867 tracked files**, and 12 paths. One script over
  `git grep`, by case: before `_` or after it `SYMBIOTE` (env vars, constants), the upper and
  title cases `Symbiote`, the lower case `symbiote`. A case-blind search also matched words such
  as `PublicProps`; the case-exact one matched only the name, `\n` before it included.
- **A plain replace would have lost the person's data**: the repository's folder (reviews,
  workspaces, threads), the cache's state, and the app's settings and choices are all found by
  the name. They move once, on first use (`former-name.ts`). The cache's worktrees do not: git
  records their paths in each repository, and Symbiote makes new ones.
- **After the merge, both folders exist in this repository**: the merge brings the tracked
  `symbiote/config.json`, the untracked reviews stay in the former folder. So the move merges
  entry by entry and drops a file the new folder has the same, rather than renaming the folder.
- **Development runs must not move the live data**: the CLI moves the cache only without
  `SYMBIOTE_CACHE_DIR` (every e2e sets it), the app moves its settings itself (its e2e sets
  `XDG_CONFIG_HOME`), and the repository's folder moves in `reviewPlace` (tests use temp repos).
- Prettier does not wrap comments: the longer name pushed 124 comment lines past 100 columns,
  rewrapped by a script.

**Verification**: `pnpm check` (1,107 unit tests; 9 new for the move, 1 for the desktop entry,
2 for the app's settings and choices, each red first). The graph of this repository's last 20
commits is identical to `main`'s but for `generator.name` (1,404 nodes, 3,266 edges): the
analysis did not change. A copy of the person's live folder (32 files) moved into `symbiote/` in
a temp repository, all but the three files Symbiote writes again. E2E 169 of 171: the shell's
two focus specs (`shell.spec.ts:119`, `:162`), a key press lost under load. Alternated with
`main` in batches of 5 under the same load (other servers and the app running): the keys spec
failed 8 of 30 on `main`, 7 of 30 here. The move's first version asked git on every refresh of
the workspaces; it now asks only when the former folder is there.

Merged into main (2026-10-21) by Symbiote's merger, from the approved `6d0275d`, no conflicts
(`main` had not moved since the branch).

## V32 — text one can read: a type scale, one step up (2026-10-21, branch `feature/font-too-small`)

Asked: "The font-size is too small to read ... My eyes are hurting". Every text one step larger,
nothing under 12 px but uppercase labels and one-glyph marks, every size from a `--size-*` scale
on `:root`; no text-size setting for now (decisions 226–229).

**Learned**:
- **159 font sizes, all in px, and most of what is read at 12 px or less**: buttons, paths, the
  status bar and all code at 12 px (85 rules), chips, badges, counts, dates and section labels at
  10–11 px (37). Only the body, rows and tabs were 13. A scale of named sizes and a guard test
  (as the radii have since V31c) make the next change one line.
- **Titles were not what was small.** At 18 px a symbol's long name wrapped mid-word in its panel
  (Bitwarden's `vault-cipher-row.component.html`, one line at 16 px), and a frame's name would
  outgrow the band `flow.ts` estimates at 10 px a character. Titles stay at 16 px; those at 14 go
  to 16.
- **The graph's layout holds the larger text**: `nodeWidth` counts 9.4 px a character and a 14 px
  Geist Mono name takes 8.6; 58 px still holds both lines. On Bitwarden `737ee3f`, as j walks 40
  changes, 22 of 82–83 names are cut short on both builds (the long ones hit the 380 px width
  cap either way), and no frame's band overflows (3 of 3).
- **xterm kept its columns**: at 1440×900 the terminal is 148 × 44 at 14 px, 148 × 46 at 13.
- **The change list's column (300 px) fits about two characters fewer** of a mono name; paths
  there were cut before too. Not changed: its width is layout.

**Verification**: tests first, red on `main` for the right reason: `tokens.test.ts` (the scale's
values; every size from it: 159 px sizes; no unknown token) and `look.spec.ts` (no text under
12 px, 11 for uppercase labels and one-glyph marks, on History, its row menu, Settings, the start
page, a workspace's terminal and brief, a diff, its panel and findings; the body and the terminal
at 14 px: on `main` 13 px, and chips, badges, key caps, dates and section labels at 10–11 px).
`flow.test.ts` unchanged. `pnpm check` 1,110 tests; e2e 172 of 172 (a first run beside a
screenshot job lost `changes.spec.ts:94` once; 3 of 3 alone, and passed in the full run after).
Against `main`'s build (`bbee774`), Bitwarden `737ee3f` with the Angular plugin, 3 rounds: first
paint 355–367 / 332–368 ms, select 120 / 120–121 ms, mark reviewed 50–51 / 51 ms, pan 63 fps
both. `/history` on a clone of this repository, alternated, 6 rounds: first paint 64–68 / 64–72
ms, first rows 166–240 / 161–177 ms. Screenshots before and after at 1440×900, dark and light:
History, Settings, the start page, a workspace's terminal and brief, a diff and its panel;
Bitwarden's graph, panel and map; the desktop start page (900×640, with a stub preload). Not
verified: the desktop app itself (Electron) and other browsers and systems; real agents in the
terminal; the README's screenshots, not retaken.

Merged into main (2026-10-21) by Symbiote's merger, from the approved `eb7b076`, no conflicts
(`main` had not moved since the branch).

## Fix — Merge into names no branch; the dropdown does (2026-10-21, branch `fix/fix-merge-into-main-button`)

The person: the button read "Merge into main" beside a dropdown of branches preselected with the
default branch; it should read "Merge into" and merge into the dropdown's value.

**Learned**:
- **The merge already went where the dropdown said.** `MergeControl` posts the picked branch as
  `into`, and `merger().enqueue` and `landEntry` use only that; no code path falls back to the
  default branch once a branch is picked. The cause was the label: it repeated the target
  (`Merge into {target}`), so the default branch read as part of the action. Now the button is
  "Merge into" and the target is the dropdown's alone; its tooltip still names it.
- No e2e test had picked a branch other than the preselected one.

**Verification**: a new e2e test (`workspaces.spec.ts`, "Merge into merges into the branch picked
in its dropdown, not main") was red first (no button named "Merge into"): it picks `release`,
merges, lands, and checks `release`'s merge parents and that `main` did not move. Specs that
clicked "Merge into main" now click "Merge into". `pnpm check`: 1,110 tests; build; e2e 173 of
173 twice (a first full run failed once without naming a test in the summary kept; not
reproduced).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `4d544c8`, no conflicts
(`main` had not moved since the branch).

## Feature — the usage bars' colours back (2026-10-22, branch `feature/bottom-statuses-of-models`)

The person: the status bar's usage bars used to be coloured by how full they are; they want that
back, with V29c's thresholds.

**Learned**:
- **V31a greyed the green, not the tones.** `usageTone` still gives `ok` under 80 %, `high` from
  80 % or a vendor's warning, `full` at 100 % or a reached limit; V31a ("usage bars grey until
  they near the limit") changed only `.tone-ok`'s fill to a muted grey. Most of the time a window
  is under 80 %, so the colours looked gone. `tone-ok` is `--added` again.
- **The style skill said a third thing**: grey under 60 %, amber from 60 %, red from 80 % — never
  built. `components.md` now states V29c's tones, so the next restyle keeps them.
- The usage spec checked the tone classes only, so a fill's colour could change unseen.

**Verification**: the usage spec now compares each bar's computed fill with its token as the page
resolves it (green 59 %, amber 84 %, and a new test with a window at 100 %: red bar and number);
red first on the green checks only. `--added` against `--raised` was already in the contrast test.
`pnpm check`: 1,110 tests; build; e2e 174 of 174. Screenshots of the status bar at 1440×900,
dark and light, at 59/84 % (green, amber) and 100/30 % (red, green). Not verified: other browsers;
real usage numbers (the spec's fake endpoint only).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `b73a965`, no conflicts
(`main` had not moved since the branch).

## V33 — start a workspace from a branch (2026-10-22, branch `feature/start-a-workspace-from-branch`)

Asked: "There should be an option on start a workspace page where i can select the branch from
which i start." A Start from select: the default branch, the local branches, then those only on
a remote; a History row's commit first when the page came from one (decisions 230–232).

**Learned**:
- **Stacking was possible but lost the branch.** Starting from a branch's tip row in History
  gave the right commit, but the record had no `from`, so the agent's prompt said "the commit
  abc1234". Now the record and prompt name the branch.
- **One rule for every branch's tip.** `workspaceBase` already chose between the local and the
  remotes' tips of the default branch; `newestTip` is that rule by name, and asks git only where
  tips differ (0 of 102 names here), so listing stays cheap: 2–3 ms for 102, 17–20 ms for 1,641.
- **The pick is resolved at the start, not at page load**, as the default branch was: a branch
  that moved while the form was open starts at its new tip.
- **Without a default branch the page used to refuse**; now it starts from the first branch.

**Verification**: tests first, each red for the right reason (unit: `startBranches`, options,
`start({ from })`, refusals of an unknown name and of `from` with `base`, `readRun`; e2e: the
list, a pick reaching git and the prompt, kept on leaving, reset after a start, a remote-only
branch, a History row's commit). `pnpm check` 1,113 tests, `pnpm build`, e2e 175 of 175 (the
keyboard test's Tab order now includes Start from). Screenshots at 1440×900 dark and light and
390×844. Not verified: a real agent from a non-default branch; a 1,591-branch select in a
browser.

Merged into main (2026-10-22) by Symbiote's merger, from the approved `5c82f01`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md`, resolved in the merge.

## V34 — panels one can resize: the sidenav and a workspace's changes (2026-10-22, branch `feature/resize-left-right-panels`)

Asked: "resize - drag - the left panel with the pages and workspaces, and also from workspaces the
right changes made". The diff's `Resizer` now also drives the shell's sidenav (180–480 px, the
main area keeping 480) and a workspace's changes (200 px up to a 480 px terminal); arrows, Home,
End and double-click as on the diff; widths kept in the browser (decisions 233–235).

**Learned**:
- **A handle need not sit between its panel and the rest.** The sidenav is a grid column, so its
  handle is a grid item over the sidenav's border, and `Resizer` takes `find` to get the panel
  and the main area instead of its siblings.
- **Folding must not lose the width**: the rail sets `--sidenav-width: 48px` on `.shell`, which
  an inline width would beat. The drag writes `--sidenav-open`, from which `--sidenav-width`
  comes unless folded.
- **One storage entry, several writers**: the diff wrote the whole `symbiote.viewer.widths`
  object from its own state, which would drop a sidenav width set on another page. Each writer
  now merges its own field (`saveWidth`).
- **The terminal follows by itself**: its `ResizeObserver` refits it as the changes widen
  (144 px fewer = 18 fewer columns, asserted).
- **The sidenav and the changes share the window**: at 1440 px, a sidenav over 240 px brings the
  workspace under 1,200 px, where V29d hides the changes (decision 186). Not changed: the person
  decides whether the threshold should follow the terminal's 480 px instead.

**Verification**: tests first, red for the right reason — `widths.test.ts` (no module) and
`e2e/panels.spec.ts` (6 of 7 on `main`'s build, waiting for the handles). `pnpm check` 1,116 tests;
e2e 180 of 180. `/history` first contentful paint, 6 rounds back to back: median 34 ms on both
builds. Screenshots at 1440×900, dark and light: defaults, narrowest, widest, the handle on hover.
Not verified: the desktop app (Electron), other browsers, touch.

Merged into main (2026-10-22) by Symbiote's merger, from the approved `ca57f97`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md` and `docs/PLAN.md`, both resolved in the merge.

## Chore — the merge page remake, built (2026-10-22, branch `chore/lost-feature`)

The person: "There was a remake of the merger page… that seems to be lost." It was never built.
On 2026-10-20 the resolution to review was called "mega ugly"; a static mockup followed (a card
per merge, the resolution first with each line's side marked, a verdict in words, the raw
conflict folded), then the session turned to V26b and dropped it. No commit, branch, stash or
dangling commit had it; only the mockup in a session's scratchpad was left. Built now from it,
in the symbiote-style tokens.

**Learned**:
- **The reviewer's question is "what was lost?"**, not "what are the three sides?". The page now
  says it: "Drops all 6 lines from agent", "1 line kept twice", "1 line written by the agent", or
  "Keeps every line of both sides, nothing new", with counts (`main 1/1 · agent 0/6 · new 0`).
- **A side's own lines are those the ancestor lacks.** A line one side kept from the ancestor and
  the other deleted is no loss when the resolution drops it; a line both sides added alike, kept
  once, counts for both. Lines compare without indentation; blank lines are not counted.
- **The style forbids the mockup's coloured side bars** (tokens test): a line's side is a tinted
  row and its name in the gutter; the target is `--info` blue, the branch `--lane-1` purple (only
  on this page), written lines `--modified`, dropped and doubled `--removed`.
- Retry and Remove moved to the "⋯" menu; `MoreActions` left `Workspace.tsx` for both pages.

**Verification**: tests first, red for the right reason: 6 unit (`reviewRegion`, `regionFlags`,
`mergeLabel`), the merger e2e (lines and their sides, the verdict before and after Ask again, the
dropped lines, the conflict folded, the menu). `pnpm check` 1,119 tests; build; e2e 176 of 176.
Screenshots at 1440×900 dark and light and 390 px wide. Not verified: a real merger agent's
resolution (the e2e's fake answers only); a region of hundreds of lines.

Merged into main (2026-10-22) by Symbiote's merger, from the approved `e6588ca`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md`, resolved in the merge.

## V35 spike — what a read-only agent in the checkout takes (2026-10-22, branch `feature/scout-an-agent-to-ask`)

Asked: a Scout page, "a read-only agent I can ask questions about the repository", and to settle
git history, one conversation or many, hooks, and the agent. Claude Code 2.1.306 (Sonnet 5.5,
the person's subscription) and Codex 0.163 on the person's daemon, in a throwaway clone of this
repository at `84bc324` in the folder the V18c spike had the person trust.

**Learned**:
- **Git changes the answers.** Three real "why" questions with the merger's tools (Read, Grep,
  Glob) took 9–10 turns, $0.070–0.105 and named no commit ("couldn't get commit hashes", "my
  inference"); with `git log`, `git show` and `git blame` allowed, 4–6 turns, $0.055–0.064, and
  3–10 commits each. The repository's docs answer much of "why" already; git adds when.
- **Permission rules cannot keep Bash read-only.** Claude Code's documentation lists `git log
  --output=<file> main` among what `Bash(git log * main)` matches, and says deny rules are not a
  security boundary. Its built-in read-only set, in `dontAsk` with no rule, ran 9 of 10 git read
  commands and refused `git log -S'MERGER_ANSWER' --oneline`, the pickaxe. A PreToolUse hook runs
  before the rules, and its block holds over an allow rule: a gate Symbiote writes and tests.
- **This session's own classifier refused a probe** that asked a nested agent to try writes
  (`git log --output=…`, `touch`, `git checkout -b`): "Create Unsafe Agents". Not worked around;
  the docs answered the question the probe would have.
- **`claude --bg` ignores `--session-id`** ("--bg manages the session id") and prints
  `backgrounded · <id> · <name>`, which V18 chose not to parse. `claude agents` listed the
  person's own interactive session in the main checkout: by path it would be Scout's.
- **What a wake keeps**: "woke session … with its saved options (--name, --tools,
  --permission-mode, --strict-mcp-config, --settings, --model)"; it then listed `Glob, Grep,
  Read, EndConversation`.
- **States**: `working`/`busy` during a turn, `done`/`idle` 1–3 s after its answer, not V18c's
  `blocked` (a plan). The name stayed "Scout" through two turns.
- **Tokens**: 9.9K on a fresh conversation's first request (6.7K written to the cache), 13.0K on
  a follow-up after a stop and a wake (11.2K from the cache).
- **Codex read-only**: `thread/start` with `sandbox: read-only`, `approvalPolicy: never` answered
  `readOnly`, no network, in 133 ms; `git log` ran in the sandbox; the answer came in 4.3 s; no
  trust entry was written, unlike V27b's writable starts.
- A Spike workspace, today's way to ask: 1 of 16 workspaces here; a worktree is 67–76 ms on this
  repository, but it starts at the default branch, not the checkout as it is.

**Not tested**: writes refused by Claude Code (the classifier's refusal above) and by Codex's
sandbox; `claude attach` restarting a stopped Scout session (V21 says it keeps the saved options);
macOS. Cleaned up after: the session stopped and removed, the clone deleted, the Codex thread
archived.

## V35 — Scout: a read-only agent to ask about the repository (2026-10-22, branch `feature/scout-an-agent-to-ask`)

Asked: a Scout page to ask questions about the repository without starting a workspace. `/scout`
(the sidenav's pages, key `a`): a question starts a read-only Claude Code or Codex in the checkout
`symbiote view` runs in; its answer and follow-ups are in its own terminal; New conversation starts
over. Claude Code's Bash goes through Symbiote's PreToolUse gate (decision 236), the session is
found by its recorded ID (239), no hook records it (238), the prompt is `prompts.scout`.

**Learned**:
- **git parses more than a prefix check sees.** On git 2.43 `git grep --open=true hello` and
  `git grep -nOtrue hello` each ran `true` as the pager: git takes a long option's unique
  beginning and bundled short options. `git log --outp=…` failed (diff options take no
  abbreviation), `git diff --no-ind` was taken. The gate now refuses every beginning of the
  options that write or run a program, and for grep any bundle holding `O`. Probing git itself
  found this; the first 78 tests passed without it.
- **The real agent keeps to its prompt before the gate is needed.** Asked to change README.md and
  commit, it made no tool call and named the workspace to start; asked to run `ls`, it ran
  `git ls-tree` instead. Only an explicit "call Bash with exactly `ls packages`" reached the gate,
  which refused it ("PreToolUse:Bash hook error: Scout runs only git's read commands …"), and the
  agent quoted it. The gate is the boundary; the prompt keeps it from being hit.
- **`git log -S` is what "why" questions use**: the real agent ran it in two of four answers,
  through the gate, which Claude Code's own read-only set would have refused.
- **Scout's terminal is Claude Code's**: the person can run `! <command>` there or Shift+Tab to
  another mode, as in any terminal of theirs; Scout suggested `! ls packages` itself. The agent's
  tools stay Read, Grep, Glob and the gated Bash.
- **The person's default model sets the pace**: 49–51 s for a code or history question with
  Opus 5.5 (their `model`), against 10 s with Sonnet in the spike; 12–17 s for a short turn.
- **A test's own address**: the e2e helper's URL ends with `/`; the spec's first run asked for
  `//scout`, which the shell reads as History, and failed for that reason, not Scout's.

**Verification**: tests first, red for the right reason (`scout.test.ts` 15, `scout-gate.test.ts`
84 cases, prompts 3, viewer route, mark and reader, e2e 5 of 5 on the build without Scout).
`pnpm check` 1,233 tests; e2e 188 of 188. After the last style change, five specs together
(scout, shell, look, settings, workspaces): `shell.spec`'s keys test failed once (ArrowDown left
the focus on the first card), then passed 27 of 27 alone and 57 of 57 in the same five again; not
explained, not seen before in this branch's runs. Real Claude Code 2.1.306 and Codex 0.163 through
`symbiote view`'s API in a throwaway clone of this repository (PLAN.md's V35 results): the merger's
prompt found in `packages/cli/src/prompts.ts`, a change declined, `ls` refused by the gate, `git
status` empty and HEAD unchanged after five turns; New conversation removed the session (1.5 s);
Codex's read-only thread answered in 7.6 s and was archived. `/history` first paint as `main`'s
(medians within 4 ms, alternating). Screenshots at 1440×900 and 390×844, dark and light. Cleaned
up: the clone, both conversations (the Claude Code session removed, its transcripts deleted; the
Codex thread archived), the `main` build. Not verified: Codex's own terminal on Scout's thread in
the page; macOS and Windows; `regression-check` (no analysis code changed).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `8fb3152`, no conflicts
(`main` had not moved since the branch).

## Fix — Scout starts at an effort level; every effort setter a stepper (2026-10-22, branch `fix/scout-effort-level`)

The person: "I should have an option to put scout on a effort level from the begining of the
conversation"; then, on the plan, the default "in config.json, and from setting i can adjust that
level", and "all of the effort level setter to be drag and drop stepper, with a step being a
level".

**Learned**:
- **Not a regression: V35 left it out** ("an effort choice (the agent's default)" under "Not in
  V35"). Nothing carried a level: `ScoutAsk` had none, `startReadOnly` passed no `--effort`,
  Codex's first `turn/start` none. Scout ran at the person's own level (`xhigh` here).
- **What V30 measured holds for Scout.** With the real Claude Code 2.1.308 (Opus 5.5) in a
  throwaway clone, through `symbiote view`'s API: no level asked and `scout.effort: low` in the
  config, every assistant line of the transcript read `effort: low`, the first turn and a
  follow-up through Symbiote's reply (stop, then `--bg --resume` with no flag); an answer in 4 s.
  `effort: "high"` asked over the project's `low` read `high`. A level asked for a conversation
  that runs was refused (409). `claude agents --json` did not list the level for a Scout session,
  so the record keeps it (`scout.json`), as a workspace's does.
- **Reading the levels has a cost Scout's state cannot pay.** `/api/scout` is read with the
  workspaces on every poll; Codex's levels come from its app server, whose daemon a read starts.
  So they are read apart (`GET /api/scout/efforts`), only where a stepper shows: Scout's box for a
  new conversation, Settings' Effort. 82 ms for both agents here, cold.
- **A level the agent does not list starts it at its own**, not a refusal: the project's file may
  name another agent's level or an older one's (Claude Code ignores an unknown `--effort` without
  failing, V30). Settings says so ("scout.effort is ultra, which Claude Code does not list…").
- **jsonc-parser rewrites the line it inserts after.** `modify` formats from the start of that
  line: a new `scout` section after an inline `"prompts": { … }` spread that object over lines,
  and Reset did not give the file back. With the last section over several lines (as this
  repository's config, whose `merge.checks` is an inline list higher up) it is byte for byte. The
  prompts' writer always behaved so; the Scout level goes through the same writer (`writeConfig`
  now), and its test uses the realistic shape.
- **The stepper is the browser's range input**, so the drag, the arrows, Home and End and the
  slider role come with it; it says the level's name (`aria-valuetext`), and a stop's word picks
  it. React's `onChange` is each `input` of a drag; Settings saves on the input's own `change`,
  once a drag is let go. No fill: the first stop, the agent's own level, is not less than low.
- **A save changes the prompts' file version**: the Settings page reads the prompts again after
  one, or their next save is refused as "changed since you opened it" (an e2e checks it).
- **e2e reading a file the server writes**: Node's `writeFile` truncates, then writes; a poll that
  parsed the config mid-write threw. The spec's reader waits for whole JSON.

**Verification**: tests first, red for the right reason: `scout.test.ts` 8 (no `--effort`, no
`efforts`/`setEffort`, no level recorded or refused, none on Codex's turn), `effort.test.ts` 3
(no module), e2e 6 (no stepper, no Effort entry). `pnpm check` 1,244 tests; build. e2e, 192
tests: 190 the first run, with the new Settings test's race (fixed above, then 5 of 5) and
`shell.spec`'s "a card keeps the focus…"; 191 the second, with `shell.spec`'s "keys…". Both fail
the same way, the ArrowDown flake V35 saw (the first card keeps the focus). Alternated on `main`'s
build and this one, 10 repeats a round of "a card keeps the focus…": `main` failed it 5 of 50, the
branch 9 of 60 (0–5 of 10 a round on each): older than this fix, which does not touch the
sidenav, and not explained; left for a fix of its own. After the last change, the scout,
settings and start specs 23 of 23. Screenshots of the stepper on Scout, Settings and
the start page at 1440×900 and 390×844, dark and light: no overflow, no page error. Real runs as
above, plus `POST /api/scout/effort` (medium written, ultra refused with Claude Code's levels, null
removed). Cleaned up: the session removed by New conversation, its two transcripts deleted, the
clone and the server gone, `main`'s worktree removed. Not verified: a real Codex conversation at a
level (its first-turn level is in the unit test on the fake app server, as V30b's was); Firefox's
range pseudo-elements (styled, not run); macOS and Windows; `regression-check` (no analysis code).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `a6182a3`, no conflicts
(`main` had not moved since the branch).

## Fix — a resolution's failed check is said, not taken for a wrong one; Check again (2026-10-22, branch `fix/fix-merger`)

The person approved `feature/agent-terminal-accept-images` (`9a7c9dd`) into `main` (`43924ec`).
Only `docs/JOURNAL.md` conflicted, one region: two entries added at the end. The merger agent
(`sonnet`) kept both (merge `26b2676`). Install, `pnpm check` and the build passed. `pnpm test:e2e`
failed 1 of 189: `shell.spec.ts:120`, the keys flake (8 of 30 runs failed on `main`, the rename's entry above).
The row read "Resolved 1 region (sonnet) · its check failed: pnpm test:e2e", all red, with no
Approve. "It should display what actually happened… not assume the merge was incorrect because
of a test." Then, on the plan: "And check again in the end".

**Learned**:
- **Not designed: V26c's code added it.** The plan had a resolution wait "plus the check's result.
  Approve → ready → landed", and no decision blocks Approve on a failed check. V26c's commit
  message says "Approve lands it (not when its check failed)". It was blocked in three places:
  `mergeState` (red), `mergeActions` (no Approve) and `approve` (409). The check judges the
  merge, not the resolution, and here no test or source file reads `JOURNAL.md`. Decision 242:
  the person decides.
- **A second fault was behind the first.** With Approve allowed, a landed merge said "checked in
  2 min 31 s" after a failed check, and a refused landing at `ready` said "Merged, not checked".
  Both now keep "its check failed (…)", and so does `symbiote merge`.
- **What ran is in the entry already.** `commands` and `failed`: the commands before the failed
  one passed, the ones after it did not run. `failedCheck` says it ("pnpm install, pnpm check and
  pnpm build passed; pnpm test:e2e failed after 2 min 31 s") without a schema change.
- **Red is for what Symbiote cannot carry further.** A resolution whose check failed is the
  person's turn, `you`, as a passed one is.
- **Check again needs the worktree back at the merge.** A resolution waiting at `needs-you`
  holds nothing, so another merge may have reset Symbiote's merge worktree. `recheck` goes
  through the queue (one merge or check at a time) and resets the worktree to `merge` first. A
  test moves the worktree in between and checks the commit each command ran on. A process that
  stops mid-check merges it again in full, as before. A clean merge whose check failed keeps
  Retry, which is the same with no agent (decision 153).
- **Three actions do not fit at 390 px.** "Request changes" and "Check again" broke over two lines.
  The actions now wrap as whole buttons.
- The README's Merging section still described conflicts as in V26a ("stops the merge with the
  files named"). It now describes the merger agent, Approve, Request changes and Check again.

**Verification**: tests first, red for the reason reported:
- Viewer unit, 5: the text and tone, no Approve, ready and landed, no `failedCheck`.
- CLI, 2: `approve` threw "its check failed"; `symbiote merge --approve` exited 1.
- e2e, 1: the row read "its check failed: ls e2e.passed".
- Check again: viewer unit 2, CLI 2 and the server's route (405), red. Its e2e was written first
  but not run red (that needs a build without the button).

`pnpm check`: 1,251 tests. Build. e2e: 194 of 194 in one run, and the merge spec 4 of 4 after
the last change. The keys flake did not show this time.

Screenshots of the resolution page with a failed check (4 commands: 2 passed, 1 failed, 1 not
run), at 1440×900 and 390×844, dark and light: the label is the person's colour, and Approve,
Request changes and Check again are offered. No horizontal overflow and no page error.

Not verified: a real merge with a real flaky check through Check again (the e2e uses a check that
passes once a file exists); `regression-check` (no analysis code: core gained one optional field
on a queue type).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `c258eb5`, no conflicts
(`main` had not moved since the branch).

## V36 spike — what the agents take as an image, through Symbiote's terminals (2026-10-22, branch `feature/agent-terminal-accept-images`)

Asked: "Terminals with agents should be able to accept images", with Orca as the example. Read
first: Orca (`stablyai/orca` at `70e997f`) saves a pasted screenshot in the OS temp folder and
bracketed-pastes its path into the agent's terminal; Claude Code 2.1.308's code reads a pasted
path ending `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` as an image (outer quotes stripped,
backslash escapes undone); Codex 0.163's binary has `attach_image path=` and `[Image #`. xterm.js
6.0.0 pastes only `text/plain`, so a screenshot reaches the agent as an empty bracketed paste, and
Ctrl+V sends ^V. Then run through `symbiote view` itself (`main`'s build, a throwaway repository
under `~/projects`, Haiku 5.5 for Claude Code), each paste written to the terminal's `…/in`.

**Learned**:
- **Both agents attach a pasted path, through Symbiote's clients.** In Scout's terminal (`claude
  attach`, `dontAsk`): one bracketed paste of a PNG's path gave `[Image #1]`, two in one write gave
  two, a path with a space backslash-escaped was read whole; the transcript held three image
  blocks and the model answered "Red, green, blue." The same with Codex (`codex resume --remote`):
  `[Image #1][Image #2][Image #3]`, three `input_image` items in its rollout, "Red, green, blue."
- **Claude Code reads the file at the paste, Codex at the send.** Removed after the paste and
  before Enter: Claude Code's model still answered "Yellow"; Codex said "Failed to prepare image:
  … No such file or directory (oserror 2)" and sent nothing. An image must outlive the message.
- **Both clients turn bracketed paste on** (`ESC[?2004h`): xterm.js brackets what the page pastes.
- **`claude --bg` needs the folder's own trust entry**: `/` and `~/projects` in the trusted list
  did not count ("Workspace not trusted. Run `claude` in … once"). Trust was accepted once in the
  throwaway folder (the down arrow, then Enter: the default is "No, exit"), as V21 and V35 did,
  and purged after.
- On Linux the OS temp folder is shared by the machine's users: the images went to Symbiote's
  cache instead (decision 243 as built).

**Not tested**: what a Windows screenshot pasted in Symbiote's window on WSLg gives the page (the
person's clipboard); macOS and Windows. Cleaned up: the sessions, the trust entries (Claude Code's
by `claude purge`, Codex's two removed from its configuration), the repository.

## V36 — images in an agent's terminal (2026-10-22, branch `feature/agent-terminal-accept-images`)

Asked: terminals with agents accept images. A screenshot pasted (Ctrl+V, Ctrl+Shift+V, ⌘V) or
image files dropped on any agent terminal (a workspace's Claude Code or Codex, Scout's) are saved
by `POST /api/terminals/<id>/image` in `<cache>/images/` and their paths pasted, which the agent
attaches as `[Image #n]` to the message being typed; nothing is sent before Enter. Decisions
242–245.

**Learned**:
- **The first real run "failed" for the script's reason.** Playwright typed the question and
  pressed Enter at once: the page's key queue (V21) sent the text's tail and the Enter in one
  write, and Claude Code 2.1.308 kept it as typed text. Typed 30 ms a key with Enter 0.8 s later,
  the message with its three images was sent and answered. The page's own writes, logged:
  `S`, `ay ok.`, `\r`, each answered 204.
- **The drop frame cannot live in xterm.js's box**: React and xterm.js would share its children.
  It is a sibling over the whole terminal, taking no pointer, the listeners on the terminal's root.
- **A 413 needs the body drained**: a request destroyed mid-body gives the page "Failed to
  fetch". The image route refuses by `Content-Length` before reading and reads the rest away.
- **A mutation check for Ctrl+V**: with `attachCustomKeyEventHandler` removed, the e2e's Ctrl+V
  step failed (the fake typed ^V, no `[Image #4]`); restored, it passed. Chromium's clipboard,
  written through the async Clipboard API, is what a real Ctrl+V pastes in a headless run.
- **The whole suite under load**: run while the real agents were driven, `shell.spec`'s "a card
  keeps the focus when its workspace moves to another group" failed once, then passed 3 of 3
  alone (V35 recorded a like `shell.spec` focus failure).

**Verification**: tests first, red for the right reason (CLI 4, server 1, viewer 6, e2e 1); `pnpm
check` 1,244 tests; e2e 189 of 189. With the real Claude Code 2.1.308 and Codex 0.163 through the page
in Chromium: a workspace's Claude Code, a workspace's Codex and Scout's Codex each attached one
pasted and two dropped PNGs and named their colours (PLAN.md's V36 results). Bundle: +2,248 bytes
(+848 gzipped), the xterm.js chunk unchanged. Cleaned up: the workspaces, Scout's conversations,
Claude Code's records (`claude purge`), Codex's trust entries, the repository, the saved images.
Not verified: a screenshot from the Windows clipboard in Symbiote's window (WSLg); JPEG, GIF and
WebP with the real agents; macOS and Windows; Firefox and Safari; `/history` first paint.

Merged into main (2026-10-22) by Symbiote's merger, from the approved `9a7c9dd`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md`, resolved in the merge.

## Fix — Symbiote's git reads take no optional lock (2026-10-22, branch `fix/background-status-no-lock`)

The merger's check on `feature/agent-terminal-accept-images` (merge `e80530e`, its JOURNAL.md
conflict resolved correctly) failed 1 of 195 e2e: "Clean up: once merged…", whose `git add
src/half.ts` in a workspace's worktree met "index.lock: File exists". It passed 5 of 5 alone
after. V20a found the cause and proposed this fix ("Found, not fixed here"): `/api/workspaces`
runs `git status` in each worktree, and status rewrites the index under its lock when a file's
timestamps changed. A `git add` or `git commit` made at that moment, by the agent, the person or
a test, fails. Asked: "Yes", to fix it on its own branch.

**Learned**:
- **Four `git status` reads**, all in folders the person or an agent works in: a workspace's
  count (`uncommittedFiles`) and files (`worktreeStatus`), polled with the list; the checkout's
  state before a checkout (`workingState`); a file's state for Settings (`fileGitState`). All go
  through core's `git()`; nothing in Symbiote spawns git elsewhere.
- **One environment fixes them all**: `GIT_OPTIONAL_LOCKS=0`, git's documented setting for
  background processes, in the environment `git()` and `gitStream()` share. Status then neither
  takes `index.lock` nor rewrites the index. Writes (worktrees, checkout, the merger) still take
  the locks they need.
- **Cost**, on a clone of this repository (889 tracked files): 5 ms a status on a settled index
  either way. With every file touched but unchanged, 16–17 ms a read until something else writes
  the index; git with the lock fell to 5 ms after its first writes. Only files touched without a
  change are read again.

**Verification**: test first, red on `main` for the right reason. A worktree and the checkout,
each with a file touched but unchanged, read by the four functions: both indexes were rewritten
on `main`, and now stay byte for byte the same. `pnpm check` 1,252 tests; build; e2e 194 of 194. Not
verified: that the race is gone from the e2e suite (seen twice in this journal, V20a and this
check; the test shows its cause instead); `regression-check` (the analysis' git calls take no
optional lock, so their output cannot change).

Merged into main (2026-10-22) by Symbiote's merger, from the approved `7fdd235`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md`, resolved in the merge.

## V37 spike — what still looks dated, page by page (2026-10-22, branch `feature/ui-improvements`)

Asked: "the inputs, sidenav and everything looks kind of oldish...the hover style..everything",
the help texts in tooltips under a help button, "the fonts are not good inside inputs", then "check
every page for uneven spaces...and ugly styling". Audited on `main` (`7c223d4`): a Playwright spec
outside the repository drove `e2e/symbiote.ts`'s `serveWorkspaces` (three workspaces, one
reporting, usage), `serveFixture('detectors')` and `serveAgentBranch` (a review and a merge), and
took 35 states of every page, dark and light, at 1440×900 and device scale 1.

**Learned**:
- **The uneven letter gaps come from the chrome's `letter-spacing: 0.01em`.** At 1× on Linux,
  Chromium places glyphs on whole pixels: 0.13–0.14 px a letter adds up into a pixel here and
  there ("n o commits", "Noth ing", "fea ture/"). At 3× zoom, `letter-spacing: 0` evened every
  sample; `text-rendering: geometricPrecision` did too (sub-pixel positions), slightly blurrier and
  with a cost on thousands of graph labels to measure. Spacing 0 costs nothing.
- **Form controls do not inherit letter-spacing.** `font: inherit` resets the font, not
  `letter-spacing`, which Chromium's form-control style sets to `normal`: every input, textarea,
  select and button measured `normal` against the body's 0.14 px. With `inherit` alone, the gaps
  moved into the fields; with 0 everywhere, page and fields match. Two fields were also in Geist
  Mono (the start page's Branch, Settings' prompt editor).
- **The fields' 3:1 edge is what reads as old**: `#737373` on every field, the brightest line on
  most pages, with a 2 px solid ring on focus over it. A soft edge (15 % of the text, about 1.5:1)
  brightening on hover and focus was shown beside it; the person chose it (decision 246).
- **Hover and selection were 8 % and 10 % washes**: indistinguishable (Settings hovered looked
  current). Cards hovered with a third recipe, nearly invisible in light.
- **Help had grown as paragraphs** in eight places and as `title`s in two; glyphs stood in for
  icons in five (`?` `ⓘ` `▸` `▶` `←`).
- **Uneven layout**, measured: Start and Scout's content 8 px right of their title (264 / 256);
  History's head 44 → 58 px in compare mode (its instruction wraps); the merge page without a head.

**Not tested**: the person's own window (Electron on WSLg at their scale); Windows and macOS text
rendering. Screenshots kept for the after comparison.

## V37 — a look that is not dated: one text, quiet fields, help behind a "?" (2026-10-23, branch `feature/ui-improvements`)

Letter-spacing 0 everywhere but uppercase labels, and controls that inherit it; one recipe for
text fields and selects (a soft edge at rest, the 3:1 edge on hover, the focus colour and a ring on
focus, 32 px, no grip); a hover 3 points under the selection; ghost buttons for backing out; icons
for the glyphs; one head on every page; flat tabs; and one `Help` button whose tip carries every
help text that was a paragraph, a `title` or a `ⓘ` (decisions 246–250).

**Learned**:
- **A tip inside the page is the page's**: the start page's `container-type` (its container
  queries) makes a containing block for `position: fixed`, as `transform` and `backdrop-filter` do
  (V31c's trap), and scrolling panels clip. `Help` draws its tip on `document.body`.
- **A tooltip shown by a hover must let the pointer through.** The kinds' tip covers the Title
  field; with the pointer taken, V24c's test could not hover the field to close it ("subtree
  intercepts pointer events", 113 retries). A click keeps the tip and only then takes the pointer.
- **A button inside a `<label>` joins the field's name**, and its tip's text would too: Branch's
  name went into a `<label htmlFor>` of its own, the help beside it.
- **`field-sizing: content` ignores `rows`**: the rows' height came back as `min-height` in `lh`.
- **The diff's legend wrapped on `main`**: its canvas hint took a second line (32 px) from the
  canvas at 1440 px; with the hint in the bar's help the canvas draws 846 nodes in view, not 831,
  at the same positions.
- **The sidenav's card-focus test is flaky on `main` too** (`shell.spec.ts`, "a card keeps the
  focus when its workspace moves to another group"): run six times one after another, 3 of 6
  passed on `main`'s build and 4 of 6 on this branch's; in the full suite it failed once in three
  runs. Not V37's; left as found.

**Verification**: tests first, red on `main` for the right reason: `look.spec.ts`'s text test (the
body at 0.14 px, 12 controls at `normal` on History alone) and its fields test (the edge at rest
`rgb(115, 115, 115)`); `tokens.test.ts` (no `--field-line` or `--ring`; dark hover 8 against
selection 10). Written with the code, not seen red: `tips.test.ts` (6) and the help e2e.
`pnpm check` 1,271 tests (`main` 1,263). e2e 198 of 198; two earlier full runs lost 2 and 4
tests: the card-focus flake above, and three specs that read text since moved behind a help
(the worktree path, the review's verdict, the Tab order), changed to open it. Against `main`'s build, alternated, 3 rounds,
on this repository's `e659928..7c223d4` (1,975 symbols, 4,124 edges): first paint 904–942 /
896–948 ms, select 275–301 / 273–279 ms, mark reviewed 64–67 / 65–67 ms, pan 62 / 62–63 fps.
`/history` on a clone of this repository, 6 rounds
alternated: first paint 60–68 / 60–68 ms, first rows 152–259 / 157–183 ms. Screenshots of 35 states of every page, dark and light, at 1440 × 900 and 1×,
before and after. Not verified: the Electron window on WSLg; Bitwarden's graph (no clone here);
Windows and macOS rendering; real agents in the restyled pages.

Merged into main (2026-10-23) by Symbiote's merger, from the approved `76c6920`, no conflicts
(`main` had not moved since the branch).

## V38 spike — what the agents print in a terminal (2026-10-22, branch `feature/clickable-paths-from-agent-terminal`)

Asked: "Provided paths from an agent terminal should be clickable...and open", and web links
too. Read first: xterm.js 6.0.0 has no link provider of its own beyond OSC 8, and for those its
default asks `confirm("…WARNING: This link could potentially be dangerous")` and calls
`window.open`. Then the real agents in a pseudo-terminal (node-pty, 120 × 40, `TERM=xterm-256color`,
`COLORTERM=truecolor`, the job's environment without `TERM_PROGRAM`), one turn each on a throwaway
repository (two files in `packages/app/src/`, a README) asking to read both, add a function, and
answer with each function as `path:line`, the README's absolute path, a web address and a
Markdown link; the raw output replayed into xterm.js in Chromium to read its rows.

**Learned**:
- **Claude Code 2.1.308 (Haiku 5.5) prints paths as text**: `● Update(packages/app/src/math.ts)`,
  `- cube (new): packages/app/src/math.ts:12`, absolute paths in `Bash(…)` and its output. A
  Markdown link comes out as `xterm.js (https://xtermjs.org)`: an address's closing `)` is not
  its own. A long `Bash(…)` line was wrapped by Claude Code itself onto a second row, which
  xterm.js does not mark as wrapped. No OSC 8 link, no mouse tracking (only `ESC[?1004h`, focus).
- **With `FORCE_HYPERLINK=1` it makes OSC 8 links**: `file:///…/packages/app/src/math.ts` on the
  `Update(…)` header, `https://xtermjs.org` behind the text "xterm.js", and the web address. Which
  of the two the person sees depends on what environment `symbiote view` was started in
  (`TERM_PROGRAM=vscode` turns links on): both must work.
- **Codex 0.163 (GPT-6-Luna, low) takes the mouse**: the alternate screen (`ESC[?1049h`) and
  any-event mouse tracking (`ESC[?1000h ?1002h ?1003h ?1006h`), still on at the end. xterm.js
  then reports clicks to Codex, while its link detection listens on the same element on its own:
  a click on a link both follows it and reaches Codex (to check in the page).
- **Codex's OSC 8 links are web addresses only**, each drawn four times by its redraws; its paths
  are text: `packages/app/src/math.ts:2`, absolute ones, and `Read math.ts` (a name, not a path
  from the folder: nothing to open). "Added cube to packages/app/src/math.ts
  (packages/app/src/math.ts)": a file citation drawn with its target.
- **Claude Code writes the words of a dialog apart with cursor moves** (`Quick ESC[8Gsafety
  ESC[15Gcheck`): in the buffer the cells between are empty, read as spaces. A row's text must
  come from the buffer, never from the stream.
- A repository under `~/.claude/` makes Claude Code ask before each edit even with `acceptEdits`
  (its own folder); V36's spikes ran under `~/projects`.

Cleaned up after the real-agent checks (V38's verification): see V38's entry.

## V38 — paths and links in an agent's terminal (2026-10-23, branch `feature/clickable-paths-from-agent-terminal`)

Asked: paths an agent prints in its terminal are clickable and open; and web links. In every agent
terminal (a workspace's Claude Code or Codex, Scout's), a path to a file of the terminal's folder
and any web address are underlined under the pointer with a hint; Ctrl+click (⌘ on macOS) opens
the file in VS Code at the line printed, in the folder's window (`POST /api/terminals/<id>/open`),
or the address in a new tab. The server says which printed paths are files (`…/paths`); the
agent's own OSC 8 links go through xterm.js's `linkHandler` instead of its `confirm()`. Decisions
251–256.

**Learned**:
- **xterm.js asks for a row's links once, as the pointer reaches it**, and keeps them while it
  stays on that row: one `…/paths` request a row, and a whole screen swept cost 4 (Claude Code)
  to 11 (Codex) requests. A link provider answers through a callback, so the links wait for the
  server's answer.
- **A link range ends on its last cell, 1-based**, both cells of a wide character included. The
  row's text is read cell by cell from the buffer, an empty cell as a space and the second half of
  a wide one skipped, so `⏺` before a path does not shift the underline.
- **On the same cells, xterm.js keeps the earlier provider's link**: its own OSC 8 provider is
  registered first, so an agent's OSC 8 link wins over the same text found as a path.
- **An OSC 8 link is drawn with a dashed underline at all times** by xterm.js (Codex's web
  addresses); a link from the provider only under the pointer.
- **Codex's mouse tracking does not take the link's click**: xterm.js reports the click to Codex
  and its link detection, on the same element, follows the link; Codex drew nothing in answer.
- **grep's `path:line:text` is one word**: `rg -n` in Codex's tool output joined the path, the
  line and the code's first word; seen only with the real agent, then a unit test.
- **The e2e fake ends its session when a test sets an answer without `status`**: `setSession`
  replaces the state fields; the terminal printed "Session fake0 has exited" and the server
  answered 404. Set `status: 'idle'` with an answer, as Scout's specs do.
- **`shell.spec`'s "a card keeps the focus when its workspace moves" is flaky on `main`**: alone, 3
  of 8 runs failed there and 4 of 8 here (ArrowDown leaves the second card unfocused), and `main`'s
  own full run lost it. Not V38's; not fixed here.
- **`main` took V37 while this was built** (the look, `feature/ui-improvements`): this milestone
  was renumbered V38, its decisions 251–256; its first commits say V37.

**Verification**: tests first, red for the right reason (CLI 4 and 1, viewer 10, then the grep row;
the e2e workspace test on `main`'s `AgentTerminal`: no hint). With `main` (V37) merged in: `pnpm
check` 1,288 tests; build; e2e 200 of 200. The real
Claude Code 2.1.308 (Scout, Haiku 5.5) and Codex 0.163 (a workspace, GPT-6-Luna) through the page
from this build, a recorder as `SYMBIOTE_CODE`: every printed file of the folder opened at its line,
the README by its absolute path, the PR's address in a new tab (Codex's through its OSC 8 link), the
main checkout's file outside the worktree not linked; screenshots of the hint dark and light. Not
verified: a real VS Code window; macOS and Windows; the desktop app's new tab. Cleaned up: the
workspace, Scout's conversation, `claude purge` of the folder, Codex's two trust entries, the
repository.

Merged into main (2026-10-23) by Symbiote's merger, from the approved `a6af371`, no conflicts (the
branch had merged `main` in first).

## Refactor — the viewer's files in folders, its stylesheet beside them (2026-10-23, branch `refactor/viewer-file-strcture-refactor`)

The brief: `packages/viewer/src` had 70 files in one folder and a 6,302-line `styles.css`; move
the files into folders by area and split the stylesheet so each component's CSS sits beside it,
behaviour unchanged. Now eight folders (`graph/`, `diff/`, `history/`, `workspaces/`, `shell/`,
`ui/`, `scout/`, `settings/`) and 38 CSS parts that `styles.css` lists, by `@import`, in cascade
order. Decisions 257–258.

**Learned**:
- **The guards were blind to a second file.** `tokens.test.ts` read `src/styles.css` only, and its
  fonts guard `src/`'s top level only: a probe folder with a 5 px radius, a 10 px size, a 3 px side
  bar, `accent-color`, `--moved` and `'Arial'` passed 24 of 24. Reading every file under `src/`, 6
  guards fail on it. Changed before anything moved.
- **Moving files changed nothing built**: with imports rewritten from a path map, `dist/` was
  byte-identical to `main`'s (the same content hashes), so the move needed no other proof.
- **A split stylesheet can only keep its cascade by order, and grouping by component reorders it**:
  the parts in folder order changed the relative order of 59,246 pairs of rules. Two of those
  pairs style one element differently. `.thread-text.markdown` (a thread's report) takes
  `white-space` from whichever of `.thread-text` and `.markdown` comes last; the narrow shell's
  `.sidenav { display: none }` lost to the sidenav's own `display: flex` once `Shell.css` came
  first. Both are fixed by the list's order, with a comment there.
- **To find those two among 59,246 pairs**, a check that a pair matters needs four things: a
  property both set differently (`scout-terminal` and `workspace-terminal`, on one element in
  Scout, set the same four values), equal specificity, the same pseudo-element, and an element
  that can carry both selectors. The last is the hard one: the classes each element had during
  the e2e suite (4,525 tag, class, parent and ancestor sets, recorded by a script in the page),
  else the className literals in the source. Moving only the buttons' section to the end, as a
  trial, gave 698 candidate pairs without them and 19 with them.
- **Screenshots of e2e end states compare badly between runs**: each run makes new repositories,
  so SHAs, dates and temporary paths differ; 178 of 197 end states differed in pixels for that
  alone. Comparing computed styles in the same page instead — the branch's stylesheet against
  `main`'s, switched in one synchronous block — has no such noise. Two traps there: both bundles
  carry the Geist `@font-face` rules, and switching the sheet that holds them reset the faces
  (the next read measured text in the fallback); and text measured while a face is still loading
  is the fallback's. Fonts in a sheet of their own, and reads only once `document.fonts` is
  `loaded`, removed both.
- **`pkill -f` and `pgrep -f` match the shell running them** when the pattern's text is in the
  same command line (CLAUDE.md's trap, met twice): find the PID in one command, kill it in the
  next.

**Verification**: the guards first, proved on a probe folder (old test 24 of 24
passed with it; new, 6 guards failed); the move's `dist/` byte-identical to `main`'s; the split:
902 rules kept (1,008 built), the built JS, worker and fonts byte-identical; the pair check (2
fixed, 1 impossible, 46 read by hand); computed styles against `main`'s stylesheet in the same
page, 164 snapshots and 39,422 element reads through the e2e suite and 75 snapshots and 25,652
reads on five real pages at 390–1,440 px in both themes: no difference, while a build with
`Shell.css` before `Sidenav.css` gave 3,029. Screenshots of the five pages: the differences are
History's dates and anti-aliasing, as between two shots of `main`. `pnpm check` 1,290 tests; e2e
199 of 200 (`shell.spec`'s keyboard test, flaky on `main`). Not verified: states the e2e suite
does not reach (the pair check alone there), hovers where no test's pointer rests, Firefox and
Safari, the desktop app's window.

## V39 spike — the koi intro in Chromium (2026-10-23, branch `feature/first-time-intro`)

Asked: "a first time intro into the app", with `koi-intro.zip`: a WebGL1 engine (`koi-intro.ts`,
1,285 lines), its rig, five WebP images, a splash for a web app's first launch and the Python that
made the assets. The engine was read whole before running it: WebGL, Web Audio, and nothing
fetched but its own images. Run out of the repository (transpiled with the repository's
TypeScript, the assets served as files) in Playwright's Chromium 1.63, headless, 1440×900.

**Learned**:
- **It runs as designed on software GL**: SwiftShader (Vulkan, Subzero) keeps 60 fps (frame gap
  median 16.7 ms, p95 16.7–16.8); the engine's own work is 0.6 ms a frame (p95 0.9): the water is a
  144×144 grid on the CPU, the koi two meshes of 170×24 vertices. Assets and GL ready in 65–86 ms;
  the S formed at 4,185–4,188 ms of its 4,200.
- **The tile's corners are transparent**: on the light theme's white page it is the same dark
  tile, nothing to redraw per theme.
- **Without WebGL** (`--disable-webgl`) `create` throws `KoiIntroError` `webgl-unavailable`
  before drawing anything.
- **The zip's splash keeps "seen" in `localStorage`**, and each `symbiote view` is a new origin
  (decision 17): in a browser it would play on every run. The app keeps five viewer keys across
  runs (`CHOICES`); anything else is lost with the port.
- **The final frame is not the three layers composited**: the koi cast soft shadows on the floor
  (`uShadowOn`), so the icon must be the engine's own frame, not a stack of the images.
- **Under the repository's options** the engine has 103 type errors, all reads of typed arrays
  under `noUncheckedIndexedAccess`; under `strict` alone, none.
- The server sends `.webp` as `application/octet-stream` today; the 200 e2e tests each open a
  fresh browser, where a first-visit intro would cover the page for 5.6 s.

## V39 — a first-time intro: two koi form the S (2026-10-23, branch `feature/first-time-intro`)

The person's koi intro plays once over the first page `symbiote view` or `symbiote pr` serves,
with sound from the start; its last frame is the app's icon. Chosen on the plan: "Sound on from
the start", "we need the final S formation as an icon", and the app's start page left out.

**Learned**:
- **In Symbiote's window there was no WebGL at all.** Electron 44 on WSLg finds no GL
  (`gl=none,angle=none` on Microsoft's virtual GPU, `"webgl":"disabled_off"`), and under Xvfb
  neither; since Chromium 137 it falls back to SwiftShader only with
  `--enable-unsafe-swiftshader` (Playwright's Chromium passes it, which is why the spike drew).
  Probed with a hidden window on the person's display, then the switch in the app: SwiftShader's
  WebGL on both displays. Without it the intro would have been skipped, silently, on the one
  machine it is for: only the app spec, run in a real Electron, showed it.
- **The icon is the engine's frame, not the layers stacked**: the koi cast soft shadows on the
  floor. Drawn with reduced motion (the engine's last frame at once), it equals the frame a full
  swim stops on: at 3.5 s after the S the drop's ripple still runs (peak 0.034 over the 0.02 it
  stops at; 22,692 pixels differ, by 1–9 levels), at 3.8 s the engine stops and 0 pixels differ.
- **A WebGL canvas is read in the task that drew it**: `toDataURL` after `await play()` works
  (the continuation runs before the frame is shown); later, the buffer is gone.
- **Electron's `isCurrentlyAudible()`** tells a spec the window plays sound, even on Xvfb with no
  audio device.
- **The JSON rig and `.webp` imports** need nothing in Vite 8: the images are emitted as they are
  (byte for byte, as `koi-aux.webp`'s data map needs), the rig inlined in the chunk.

**Verification**:
- Tests first, red for the right reason: the record and `/api/intro` (no module, 404s,
  `application/octet-stream`), `intro.spec` (no `.intro`), the app's intro test (no overlay: no
  WebGL, which led to the switch). Then `pnpm check`: 1,305 tests in 95 files (15 new).
- e2e: 207 of 208, with `intro.spec`'s 7 (first visit and the page beneath, not on the next;
  Escape and a click; Settings, nothing recorded with `off`; no WebGL; reduced motion; `?graph=`
  never asks) and the app's (audible at once, under the title bar, the window's corners). The one
  failure, `shell.spec`'s keyboard test, passed 5 of 5 alone: flaky on `main` (the refactor's
  entry).
- The engine: its emitted JavaScript diffed against the zip's (one `Promise.all`), its last frame
  against the zip's engine's (0 of 1,048,576 channels).
- In the app (Electron 44 under Xvfb, SwiftShader, 1440×900): 243–245 frames in 4.06–4.08 s,
  gap median, p95 16.7 ms, worst 16.8; dark and light screenshots: the tile centred under the
  title bar.
- `/history`, 10 rounds alternated with `main`'s viewer, the intro seen: first contentful paint 52
  ms, first rows 94 ms, on both. First visit: overlay 41 ms, first paint 64, koi 133, rows 251.
- Settings' bar at 1×, dark and light: the button and the theme switch share top and bottom (28
  px), 12 px apart, the bar's gap.
- The two 404s a History page logs are its `/api/graph` probe, `main`'s viewer too.

Not verified: the intro's frames in the person's own window (the probe there showed no GL, and
SwiftShader's WebGL with the switch); sound on a real device; a desktop browser's autoplay; macOS,
Windows, a GPU.

## Fix — the intro's koi on a lost WebGL context: a blank tile for 5 s (2026-10-23, branch `fix/intro-lost-context`)

Asked: "The last feature merge broke the app - intro motion." In the person's window (WSLg's X11,
2560×1392) the intro played its 5.6 s with sound over a white tile with a broken-image mark, then
the page came as usual (60 fps, no page error). V39 had not verified its frames in that window.

**Learned**:
- **Chromium's GPU process fails first, then starts again in software**, on WSLg and on an Xvfb
  alike ("Exiting GPU process due to errors during initialization"), and the WebGL contexts made
  on the first one are lost: 70–110 ms after they are made, given back 1,004 ms after the loss, if
  the page took it (`preventDefault`). Starting the GPU process earlier (`app.getGPUInfo`) does
  not avoid it: 12 of 12 probes still lost theirs.
- **The engine listens for a loss only once its images are in** (its constructor). A loss before
  that is taken by nobody, the context never comes back, and nothing says so: the overlay runs
  its course over a dead canvas. A loss after it ends the intro at once (`play.ts`). Which one
  happens is a race with the page's load: in the app without the fix, 2 of 4 runs on the
  person's display lost the intro's context.
- **`app.disableHardwareAcceleration()` on WSL costs nothing**: every GPU feature status the same
  as with it on (compositing and raster were software already; WebGL SwiftShader's), and no
  context lost in 3 of 3 probes, nor in the app.
- The app's intro test passed on a dead canvas: it checked the canvas is visible and the window
  audible, not what the window shows.

**Fixed**: on WSL the app does not ask for hardware GL (`packages/desktop/src/gpu.ts`). Anywhere a
context is lost (Xvfb on CI, a VM, a GPU reset), `play.ts` takes the loss from the canvas's
start: the koi are hidden (`data-state='loading'`) and start again on a new canvas once it is
back, once; not back in 2 s (`RESTORE_MS`), or lost again, the intro ends.

**Verification**: tests first, red for the right reason. `gpu.test.ts`; `intro.spec`'s two (a
context lost before the koi and given back: before, the intro ended before its S; lost
for good: before, a dead tile still up at 3.5 s); the app's intro test reads the window's pixels
at the formed S: 52 colours before (the blank tile), over 1,000 needed. `pnpm check`: 1,307 tests
in 96 files; e2e 209 of 210, the one failure `shell.spec`'s keyboard test, 5 of 5 alone (flaky
on `main`). The app's intro test without WSL's variables (as on CI's Xvfb): 3 of 3. On the
person's display: the koi at 2 s, 28,886 colours at the formed S; without the WSL fix, the two
runs that lost the context showed nothing for 1,063–1,067 ms, then the whole swim (screenshots).

Not verified: CI itself; WSLg's Wayland (the app takes X11 there); macOS, Windows, a GPU (the
fix leaves them as they were: no switch off WSL, and the loss handling only runs on a loss).

Merged into main (2026-10-23), asked: "Merge". On `main`: `pnpm check` 1,307 tests; build; e2e
208 of 210, both failures `shell.spec`'s focus tests (a card's focus, the terminal's size), which
failed alone at the same rate on `main` before the merge (`241371d`: 1 of 42 runs; after: 1 of
42, in alternated rounds).

## V41 spike — what a skill is, and what each agent lets a skill writer do (2026-10-23, branch `feature/skill-creator`)

Asked: an agent that creates the project's skills, and editing or adding skills from Symbiote,
"research before that on how a skill should be created". Read: Anthropic's skill authoring best
practices, Claude Code's skills and permissions documentation, the agentskills.io specification,
Codex's skills documentation, and the two skill creators installed here (Anthropic's, synced from
the person's claude.ai account; Codex's, in `~/.codex/skills/.system/`). Probed in a throwaway
clone of this repository at `bf0e717`, Claude Code 2.1.309 (`haiku` for the probes), Codex 0.163.

**Learned**:
- **Codex does not read `.claude/skills/`.** `codex debug prompt-input` (the model's input, no
  model call) listed none of this repository's 6 skills; with `.agents/skills/viewer-check` a copy,
  that one; with `.agents/skills` a link to `../.claude/skills`, all 6, by their real path.
- **Claude Code's `dontAsk` refuses every Write**, whatever approves it: a PreToolUse hook
  answering `allow`, or an `Edit(<path>/**)` allow rule (a `Write(…)` rule is refused at load:
  "only Edit(path) rules are" matched). For `.claude/skills/…` and for a plain path alike. The same
  hook's `allow` let `git log -S'MERGER_ANSWER'` run in `dontAsk`, as Scout's gate does.
- **`.claude` is protected in Claude Code**: its writes are prompted in `default` and
  `acceptEdits`, routed to a classifier in `auto`, denied in `dontAsk`, allowed only in
  `bypassPermissions`; allow rules do not change that. The prompt offers "allow Claude to edit
  files in this project's .claude folder for this session".
- **Codex's sandbox can hold a writer to one folder**: `codex exec --sandbox workspace-write -C
  <clone>/.claude/skills` wrote `probe-codex/SKILL.md` there; `printf 'x' >> <clone>/README.md`
  failed with "Read-only file system". The cwd is the only writable root (with temporary folders).
- **This repository's skills** pass `claude plugin validate .claude/skills`; 2 of 6 descriptions
  hold `<` and `>`, which Anthropic's validator (`quick_validate.py`) and the API refuse.
- **What both skill creators leave to the project**: where a project's skills live (Codex's
  writes to `$CODEX_HOME/skills`), the project's own conventions, and the other agent's folder.

Decided with the person: the name Scribe; Scribe writes in the checkout, as Settings writes
`config.json`; the Codex link offered; personal skills left out. Plan: PLAN.md, V41.
