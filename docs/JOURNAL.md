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

## V2 — `cpr view` (2026-10-01)

**What landed**
- `cpr view <base> [head] [--port] [--no-open]`: runs the same analysis as `diff`, serves the
  built viewer + `/api/graph` + `/api/source` on `127.0.0.1`, opens the browser, stops on
  Ctrl+C. Startup line: `15 files · 25 symbols changed · 3 findings` + URL.
- `startViewServer` (testable without a CLI process): static files confined to the viewer
  folder (`..` and `%2e%2e` refused), sources only for files the graph mentions, read with
  `git show <sha>:<path>` (`readFileAtRevision` in core).
- `CliContext` gained `openUrl` and `waitForExit` so tests drive the long-running command;
  `CPR_VIEWER_DIR` points at another viewer build (tests, development).
- `diff` and `view` share option parsing and the analysis call.

**Decisions**
- Bind to `127.0.0.1` only and never serve arbitrary files: the server holds the repository's
  source.
- Context nodes carry only their head side, so base sources are served only for files that
  changed (or base-side symbols).

**Verified**: `cpr view` on a ky commit served the viewer, the graph and the head/base sources.

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
- Sources come from `cpr view`'s `/api/source`, fetched once per side and file; a graph opened
  from a file shows a hint instead.

**Verified end to end** (Playwright + Chromium against a real `cpr view` on ky): an added method
shows its code as all-added rows; a modified method (`Ky.#retry`) shows the removed type
parameter in the signature and the exact changed lines.

**Gotcha**: Prettier collapses short import lists to one line, so scripted string edits of
`App.tsx` stopped matching; rewriting the file whole was simpler and clearer.

## V4 — Review flow (2026-10-01)

**What landed**
- Sidebar with two tabs: **Changes** (changed symbols in reading order, grouped by file, each
  with a "reviewed" checkbox and a progress bar `2/25`) and **Findings** (by severity; a click
  selects the symbol). Opens on Findings when there are any.
- Reviewed marks persist in `localStorage` per revision pair (`cpr:reviewed:<base>..<head>`), so
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
  the detectors fixture (base and head commits), starts the built `cpr view`, and checks the
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

The analysis (~7 s) dominates `cpr view` startup; the UI itself is fast at this size.

**Observed while reviewing**
- Test files often show up as `… (top level)` users of a changed signature (describe/it blocks
  are module-level code). Informative, but they inflate "untouched" counts; a later option
  could separate test users.
- Closing the panel keeps the zoomed viewport; the fit-view button returns to the overview.

## Phase 3 kickoff — GitHub **and** GitLab (2026-10-01)

Request: "It should also work with GitLab." Phase 3 now targets both forges through a forge
adapter (PLAN §12, Phase 3 milestones). This session can only reach the GitHub API for
`attomius321/CPR` (no PRs there), and no GitLab instance, so both adapters are tested against
local mock servers; `GITHUB_API_URL` / `GITLAB_API_URL` point the CLI at them.

## G1 — `cpr pr` for GitHub and GitLab (2026-10-01)

**What landed**
- New package `@cpr/forge` (network code stays out of the engine): `parseRemote` (https, ssh,
  scp-like, credentials in URLs), `detectForge` (host name → `--forge` → `CPR_FORGE`),
  `GitHubForge` (incl. Enterprise `https://<host>/api/v3`; token from `GITHUB_TOKEN`,
  `GH_TOKEN`, or `gh auth token`) and `GitLabForge` (nested groups, URL-encoded project path,
  `PRIVATE-TOKEN` or CI `JOB-TOKEN`). Errors say which token to set, or that access is missing.
- Core: `remoteUrl` (reads `remote.<name>.url` from config, before `insteadOf`), `fetchRefs`.
- `cpr pr <n>` / `cpr mr !<n>`: API → fetch head + target branch into `refs/cpr/<forge>/<n>/…`
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
`cpr pr`/`cpr mr` runs against a bare "forge" repo whose `refs/pull/7/head` and
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
  (`cpr pr` only), with a JSON body limit and validation (event, sides, files of the change,
  positive lines, non-empty bodies). All endpoints now check `Host` (DNS rebinding).
- Viewer: a Comments section in the detail panel (drafts, a box, `Ctrl/⌘+Enter`, `c` to focus),
  clickable +/− lines that move the anchor, a Review tab (drafts, summary, verdict, submit, the
  forge's link or error), 💬 counts in the Changes list. Drafts live in localStorage per
  revision pair, like reviewed marks. Esc in a text field now leaves the field instead of
  closing the panel; checkboxes no longer swallow `j`/`k`.
- E2E: `cpr pr 7` against a mock GitHub API; two comments (an added line, a removed line), a
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
- `cpr pr <n> --post-findings <level>` (GitHub and GitLab): reads the existing comments, works
  out which findings at the level are new, posts them as one `comment` review, prints the
  summary, applies `--fail-on`. No viewer, so it is the CI building block for phase 5.
- Core: `listChangedLines` (`git diff -U0 -M`, explicit `a/`/`b/` prefixes so user config
  can't change them, C-quoted path names, `---` content lines after the first hunk are not
  mistaken for headers).
- Forges: `commentBodies` — GitHub inline comments, review summaries and conversation comments;
  GitLab notes; `per_page=100` pages until a short page (50-page cap).
- A finding goes on the first changed line of its symbol (head first, base for removed
  symbols); without one it is listed in the summary. Each carries
  `<!-- cpr:finding <rule:symbol, URI-encoded, dashes too> -->`.
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
- The write header is now `x-cpr: 1` for every write (review and state).

**Found while testing**: every `cpr view`/`cpr pr` run listens on a new free port, and browser
storage is per origin — so V4's "remembers reviewed symbols" only ever held within one run.
The e2e test reloaded the same page, which hid it. The new e2e test restarts `cpr pr` after a
push (new port) and checks the state is still there.

**Decision**: 17 (review state in the CLI's cache, per change request).

## I2 — `--since`: what changed between two versions of a change (2026-10-01)

**What landed**
- `analyzeGit({ since })` (all of `cpr diff`, `view`, `pr`): after the main analysis, the
  earlier version merge-base(base, since)..since is checked out in the same slots and only
  extracted — same two-pass inference, no references or detectors. Each changed symbol gets
  `new` / `updated` / `same` by `changeFingerprint` (both sides' signature and body hashes, the
  string the viewer's I1 marks use); `dropped` lists symbols that version changed and this one
  doesn't. Extraction was split out of `analyzeSources` (`extractChanges`) for this.
- Graph schema 0.2.0: top-level `since {ref, sha, dropped}`, node `since`. Goldens differ only
  in the version.
- Summary: `since <ref> (<sha>): 2 new, 1 updated · 1 no longer changed: …` and `[status]` per
  symbol. `cpr pr --since <sha>` fetches the sha from the remote when it is not local (protocol
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
- `cpr pr` with no number in CI: GitHub Actions' event file (`pull_request`,
  `pull_request_target`, `issue_comment` on a PR) or GitLab's `CI_MERGE_REQUEST_IID`.
- `action.yml` (composite): inputs `token`, `pull-request`, `post-findings` (default
  `warning`, empty = don't post), `fail-on` (default `error`), `project`, `depth`,
  `working-directory`, `setup-node`; output `graph`. Inputs reach the scripts through `env`,
  never interpolated into shell code.
- `action/install.sh` builds CPR from the action's own checkout with pnpm 12 via `npx` (the
  packages are not published): 8 s from a fresh clone here with a warm pnpm store.
- `action/run.sh` is shared with the coming GitLab template: deepens shallow clones (the
  merge-base needs history), builds the arguments, tees the summary, writes the step summary
  and the `graph` output, keeps cpr's exit status.
- `.github/workflows/cpr.yml`: this repo reviews its pull requests with `uses: ./`; fork PRs
  (read-only token) are reviewed without posting.

**Testing**: `run.sh` runs against a stub CLI that echoes its arguments (arguments, exit status,
step summary, output); the CI-number detection has unit tests and a `cpr pr` run with a GitHub
event file. The action itself only runs on a real pull request, and none exist in this repo yet:
the first PR will be its first live run.

## C2 — GitLab CI template (2026-10-01)

**What landed**
- `ci/gitlab/cpr.yml`: a hidden `.cpr` job (node:22, `GIT_DEPTH: 0`, clones CPR at
  `CPR_VERSION`, builds it with `action/install.sh`, runs the shared `action/run.sh`) and a `cpr`
  job on `merge_request_event`. Code Quality report as an artifact report; `.cpr/` (graph,
  summary) as a plain artifact.
- GitLab forge in CI: the API URL from `CI_API_V4_URL` when the remote is the job's own instance
  (custom ports and relative URLs); without `GITLAB_TOKEN`, the MR comes from the pipeline's
  `CI_MERGE_REQUEST_*` variables (merged-results pipelines name the source commit, others build
  it); commenting and reading comments say plainly that they need `GITLAB_TOKEN` and that the
  job token cannot comment.
- `--codequality <file>` on `cpr diff` and `cpr pr`: findings as Code Climate issues — severity
  error → critical, warning → major, info → info; location: where a removed symbol is still
  used, else the first changed line of the symbol; fingerprint from rule + symbol, so GitLab
  recognises the same issue across pipelines.

**Decision**: 18 (GitLab CI works without a token).

**Testing**: a full `cpr mr` run in a simulated pipeline — the job token in the remote URL, no
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
detected; packages without a source entry (only `dist/` in `main`) have no public API for CPR.

## Angular 11 trial (2026-10-02)

Ran CPR on the Angular RealWorld example app at its Angular 11.2 state (TypeScript 4.1.5, 72 TS
files, dependencies installed with `npm ci --ignore-scripts --legacy-peer-deps` under Node 22):
it loads cleanly, ~3–4.6 s per commit, and its real Angular-11-era commits come out right
(e.g. "Fixed: Tag not saving" → `EditorComponent.submitForm (body)`). Found:
- **Templates are invisible**: a method used only from `(click)` is reported as an orphan; a
  method deleted while its template still calls it is not reported at all.
- **Class families**: `ngOnInit` "used by 11" (every component implements `OnInit`); a user's
  project showed the same for a property overridden from a shared base class. → R1.
- **Decorator metadata**: changing `@NgModule({...})` arguments warns "AppRoutingModule changed
  its signature; 1 of 1 user not updated: AppModule".
- `.cprignore` is read from the analyzed head commit, not the working folder, so an uncommitted
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

**Not done**: templates, `.cprignore` location, `interfaces/` matching, decorator-only changes
(see the Angular trial above).

## Fix — diff colours across the full line (2026-10-02, branch `fix/diff-row-width`)

Reported from a real review: in the detail panel, a long line made the code scroll sideways and
the green/red row colour stopped at the panel's edge. Rows were as wide as the visible box, not as
the code. They now sit in a wrapper `width: max-content; min-width: 100%`, so every row spans the
longest line. An e2e test opens the panel in a 700 px window and checks each row is as wide as the
scrollable content (it failed before: 280 px rows, 447 px of code).

## Angular templates spike (2026-10-02)

Groundwork for A1–A2 (PLAN), on branch `milestone/a1-angular-templates`. Nothing in CPR changed.

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
- 22.x requires Node ≥ 22.22.3 (CPR: 22.12); 21.x accepts `^22.12`. Import: 77 ms.

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

**CPR today on RealWorld commits that touch templates** (no dependencies installed):

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
with `--plugin` or `cpr.config.json` (read from the working folder), resolved by name or path,
isolated on failure. A1–A2 become `@cpr/plugin-angular` on those hooks; `@cpr/core` and
`@cpr/cli` never depend on Angular, and without the plugin every result stays byte-identical,
Angular repos included. Decision 24 records it.

## X1 — Plugins (2026-10-02, branch `milestone/x1-plugins`)

**What landed** (reviewed and merged with PR #1)
- `@cpr/core` exports the plugin contract (`TsPlugin`, `PLUGIN_API_VERSION` = 1) and
  `createTypescriptAdapter({ plugins })`; `typescriptAdapter` is that factory with no plugins.
  Hooks: `applies`, `matches`, `virtualFiles` (with `map` back to owner and real site),
  `extract`, `decoratorArguments`, `exposure`, `warnings`.
- Core uses them generically: virtual files join the program before the language service
  starts; reference search, outgoing scans and dangling detection map positions inside them back
  to the template (or whatever the owner is); declarations inside them are never edge targets.
  Claimed decorators hash their arguments by role. Exposure `framework` is skipped by
  `orphan-added`. Schema 0.5.0: kind `template`, top-level `plugins`.
- CLI: `--plugin` on diff, view and pr; `cpr.config.json` (`{ "plugins": [...] }`) at the repo
  root of the working folder; `angular` → `@cpr/plugin-angular`, `.`/`/` → a path; the project's
  copy first, then the CLI's. Clear errors for a missing package or file, another API version,
  a module without a plugin, a broken config. Hint on Angular repos with changed `.html`.
- CI: action input `plugins`, GitLab variable `CPR_PLUGINS` → one `--plugin` each.

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
`@cpr/plugin-angular` must be a dependency of the CLI to be found "next to cpr".

## A1 — Angular plugin: templates see their component (2026-10-02, branch `milestone/x1-plugins`)

**What landed** (on the X1 branch, as asked; merged with PR #1): `@cpr/plugin-angular`, loaded with
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
- A rename is a move to CPR (same body, new name), and nothing checked the *old name* of a moved
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
review. It was the repository's first pull request, so the first run of its own CPR review
workflow:

- **The action failed before CPR ran**: `actions/setup-node@v5` enables caching for the package
  manager `package.json` names (`packageManager: pnpm@…`) and fails when that manager is not
  installed yet ("Unable to locate executable file: pnpm"). Any project with a `packageManager`
  field would have hit it. Fixed in `action.yml` with `package-manager-cache: false` (CPR
  installs its own pnpm). The action's tests run `run.sh` only, so only a real workflow run
  could show it.
- **Then CPR reviewed itself**: no errors, 3 `signature-changed` warnings posted as review
  comments, on `LanguageAdapter` (the new `base` parameter of `dangling`), `Exposure`
  (`framework`) and `SymbolKind` (`template`). Each was checked: the code that calls or branches
  on them was updated in the same change; the "users not updated" only hold or carry the type.
  Answered and resolved; no code change. A known limit of `signature-changed` on widened types
  and interfaces: it cannot tell a user that passes a type along from one that depends on its
  exact members.


## Fix — `.cprignore` from the working folder, with gitignore's rules (2026-10-02, branch `fix/cprignore`)

Both found in the Angular 11 trial, where `interfaces/` in a `.cprignore` did not ignore the
nested `interfaces` folders of a monorepo:

- **Where it is read**: `analyzeGit` read `.cprignore` from the checkout of the analyzed head
  commit, so an uncommitted file — or a diff of two older commits — went by another file or none.
  It is now read from the working folder's repository root (like `cpr.config.json`) and passed
  to the analysis as an `ignore` matcher (`LoadOptions.ignore`, used for both the changed-file
  filter and the program's file list). Comparing two folders still reads the head folder's.
- **How it matches**: a pattern ending in `/` was anchored at the root (`interfaces/` became
  `interfaces/**`, then "contains a slash"), and a leading `/` was stripped and then matched at
  any depth — both the opposite of git. Now, as in git: only a `/` at the start or in the middle
  anchors; `dir/` matches folders only; a pattern matches a path or any folder above it, so
  `secrets` also ignores `secrets/key.ts`.

Tests: 11 gitignore cases, and an `analyzeGit` test where the committed `.cprignore` says one
thing and the uncommitted one another (4 of them failed on the old code). The CLI on a nested
monorepo, with an uncommitted `.cprignore` and a diff of older commits, lists both `interfaces`
files as `(ignored)`. The 29 R1 comparisons (no `.cprignore` in those repos) are unchanged.

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
| CPR's own analysis (extract, references, detectors) | 4 % | 2 % | 4 % |

**What the two programs share** (files of head, compared with base):

| | vite | zod | Bitwarden |
|---|---|---|---|
| TypeScript lib files (same path and text) | 93, 0.23 s to parse | 89, 0.23 s | 52, 0.29 s |
| `node_modules` declarations (same path and text: linked folder) | 655, **1.25 s** | — | — (not installed) |
| Project files (same text, **different path**: separate worktrees) | 183 of 184, 0.34 s | 515 of 516, 0.51 s | 6,159 of 6,160, **4.2 s** |

**Learned**
- CPR's own work is 2–4 % of a run; loading is two thirds or more. P1 is the right lever.
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
- An interface's members are part of the interface for CPR, in TS code and templates alike: the
  RealWorld experiment (a `User` field read through `currentUser$ | async`) changes nothing
  because `User` is an interface. Bitwarden's `Organization` is a class, and there the stale
  template read is caught.
- **A core gap**: a `node_modules` that is itself a link was not linked into the analyzed
  checkouts, so with such an install CPR saw no dependency types at all. Found because the test
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

Reported: "CPR does not render any HTML templates in my app" — an Angular 11 app two folders
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
  program. It only offers TypeScript's older callback (no ESM/CJS mode), so CPR computes the mode
  itself, and the hook is only installed when a project's aliases differ from the root's.
- Angular keeps its build options in `tsconfig.app.json` (Angular 6–11: `src/tsconfig.app.json`
  with `baseUrl`), a file CPR never read. Config choice now follows the build, not the editor.
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

Groundwork for Q1–Q2 (PLAN). Nothing in CPR changed.

**What CPR does today** on a scratch app with the real typings (`@builder.io/qwik` and
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

A new package, `@cpr/plugin-qwik` (`--plugin qwik`), and two generic core changes it needs: an
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
(PLAN); nothing in CPR changed on this branch.

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

- `CLAUDE.md` at the root (what CPR is, commands, code and test rules, how to verify each kind of
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
not). Only runs on the same clones compare. The first run on new clones also creates CPR's
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
  `--cpr-zoom`, as file names already were.
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

Asked what would make CPR disruptive, the leading idea was to verify the mechanical part of a
change (a rename and its call sites, moves, a new argument at every call, the same edit repeated)
so a reviewer reads only the decisions. Measured before planning; it does not hold for typical
changes. Nothing in CPR changed; the scripts are in `spikes/e1-ripples`.

**Learned**
- Typical changes are decisions. On 165 unique changes (pinned sets, the latest commits of five
  repos, commits titled refactor/rename/move), 20 % of changed symbols but 5.4 % of diff lines are
  verifiable; without one large rename (Qwik `f7ed58cfc`, 72 % of its symbols), 2.8 % of lines.
  "Refactor" commits restructure code: 1.3 % of their lines.
- CPR's move matching found 29 of the 66 renamed symbols in Qwik `f7ed58cfc`: a renamed symbol
  often mentions its own name or others renamed with it (`EbFallback` → `CatchFallback` with
  `"eb-fallback"` ids inside), so its body changes and it shows as removed + added. Renames inferred from the change itself (moved
  names, renamed folders, pairs equal under their name difference) found them; one change may
  rename a word two ways, so every way must be tried.
- The biggest class was not ripples but the same edit repeated across files (148 symbols): one
  feature adding a key to 40 locale files, a prop changed in 24 files.
- Verified symbols are many and small: grouping them would shorten the change list by a fifth and
  the reading by a twentieth.
- Traps: a raw scanner misreads JSX text (an apostrophe starts a string) — tokens must come from
  the AST, as CPR's hashes do; a commit list grepped by message matches bodies too (`perf:` commits
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
- The biggest single cost of zooming was one line: `--cpr-zoom` set on the page root on every
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

Measured on the regression clones before planning a commits page for `cpr view`. Listing 100
commits with `git log` takes 9–66 ms, even on Bitwarden's 23,236 (628 ms once, with a cold disk).
Analyzing one commit against its parent takes 0.6 s (vite, no TypeScript changed) to 59 s
(Bitwarden with the Angular plugin; 46 s on a second run, with the worktrees made); 20 commits
5.6–87 s. Two consequences for the plan: the page must show progress and keep results, and the
analysis cannot run in the server's process — ts-morph is synchronous, so the server would not
answer for up to 90 s. A child process per analysis is safe to stop: worktree locks hold the
owner's pid and stale ones are recovered.

## V9 — Pick two commits (2026-10-13, branch `milestone/v9-commit-picker`)

`cpr view` without revisions opens at once on the current branch's commits; two picked (or one
against its parent) are compared directly, analyzed then in a child process, and served at
`/diff/<base>..<head>/`. `cpr view <base> [head]` analyzes first as before and opens that diff;
`cpr pr` is unchanged.

**Learned**:
- The viewer already used relative URLs for its API and files (`./api/…`, Vite `base: './'`),
  so serving one viewer per diff under its own path took no change to how it calls the server;
  only the commits page's two endpoints are absolute. Every existing e2e spec passed unchanged
  once `cpr view HEAD~1 HEAD` opened `/diff/<pair>/`.
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
  the checkout. Pre-existing (`cpr diff` has it), not fixed here.

**Verification**: tests first — `parseLog` (merges, the root commit, refs, a subject holding the
separators), `listCommits` (pages, a tag, a detached HEAD, a repo without commits), `isCommit`;
`onPhase` in order with the same analysis; `Diffs` (one at a time in order, failures kept until
asked again, Stop, close, the last N by use); `childRunner` with a fake CLI (args, phases, the
CLI's message, Stop); the server (`/api/commits` pages, `POST /api/diffs` refusals, 202 → 200,
sources and state per diff, 502, Stop, 404); `cpr view` without revisions; `src/commits.ts`
(picks, base by list position, one commit, the count with a merge, `api/graph` answers). E2E: five
commits served by `cpr view` — the list, two picked → "Analyzing" → the graph, a reload kept,
← Commits, This commit, the keyboard, Stop, a diff URL opened anew, no sideways scroll, the
sidebar bar untouched. 464 unit tests (31 new), 45 e2e (5 new). `r1`: 29 comparisons identical
(859 edges, no finding changed), time 0.97 of `main`'s. Real repos (warm, 2 rounds): the URL in
0.58–0.64 s, `/api/commits` 33–166 ms, 100 rows drawn 0.24–0.26 s after opening Qwik; a pair
through the server Qwik 13.8–14.3 s (`cpr diff` 14.2–15.1 s), Bitwarden 41.6–43.2 s (`cpr diff`
39.8–40.2 s, +3.5 to +8.4 %); status requests meanwhile 1.8 ms median, 20 ms at most; a kept pair
in 1.4–10 ms. `cpr view HEAD~1 HEAD` on Qwik to its URL: `main` 13.1–14.5 s, V9 13.2–14.5 s. Not
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
Repositories that merge with merge commits list side-branch commits among the branch's own (CPR
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
  either way, so CPR need not write one (it would change the user's repository).
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

`cpr view`'s commits page lists every branch, local and remote (or "This branch"), in graph
order, with lanes drawn left of the rows; lines over 100 rows are two arrows. The server lists
the order once per scope and serves rows' details by block and the whole shape; the viewer lays
out lanes over the shape and draws only the rows near the view.

**Learned**:
- Check a prototype against the tool it imitates before planning on its numbers. The lane
  prototype skipped one kind of line (a side branch's way back to HEAD's line) and reported 17
  lanes for Bitwarden; `scripts/viewer/lanes-check.mjs`, which walks every drawn line to its
  parent and prints git `--graph`'s width beside ours, showed 142 on its first run. Whole lines
  were what the user had asked for; with the real numbers they chose gitk's arrows (Bitwarden
  20 lanes, 1,943 arrows in 39,861 rows).
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
`refs/cpr/*`; a child dated before its parent listed above it; an empty repository),
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
- Letting git decide what is safe needs no rules of CPR's own beyond operations in progress:
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
  does, and the confirmation says so; but whoever develops CPR with `cpr view` open on it should
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
60–68 first-parent commits of CPR, ky and zod, each reviewed as `c^1..c` with the working copy at
the branch tip, 1–62 % of the added lines of code files sat at another line number at the tip
(CPR 29–46 %, ky 23–62 %, zod 1–26 % by distance), and up to 23 % had been changed since (ky
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
  the controls never show there; the cost was measured with a short script against a real `cpr
  view` of each build instead.
- Under `cpr view` the code rows had no click action (picking a comment line is `cpr pr`'s), so
  Ctrl/⌘+click means the same in both, and a plain click keeps its meaning under `cpr pr`.
- The first "Open in VS Code" was link-styled 12 px text beside the path, and the user did not
  see it. An action the reviewer is meant to find needs to look like a button (now outlined, in
  the accent colour, with an icon and its key). At the same time the user had "This commit"
  removed from every commits row: picking one commit and Compare already does it.

**Verification**: tests first — `mapLine` (insertions, removals, replacements, the file's start
and end), `workingLine` on temp repositories (uncommitted edits, a later commit, deleted and
renamed files, a `[id]` path, a bad SHA), `findVsCode` with injected platforms (PATH, PATHEXT,
VS Code 1.141's and the older `code.cmd`, an unknown `code.cmd`, the macOS bundle, `CPR_CODE`),
the `cmd.exe` quoting and its refusals, `runVsCode` with a stand-in (arguments, failure,
a command that keeps running, a missing command), `vsCodeOpener` on a temp repository, the
endpoint (each side's commit, 404 and 502, refusals), the viewer's `src/open.ts`. E2E with a
stand-in for VS Code (`CPR_CODE`): 5 under `cpr view`, 1 under `cpr pr`. 557 unit tests, 59 e2e.
On this machine (WSL, VS Code 1.141 on Windows): a function at line 449 of `24396ab` opened at
480 in the working copy, 105 ms, in the existing window. Selecting a 300-row symbol: 31–37 ms
median on `main`, 33–34 ms with V12. Not verified: native Windows and macOS, a repository not
open in VS Code, Remote SSH and dev containers.

Merged into main (2026-10-13), with the button made visible and "This commit" removed from the
commits rows at the user's request. `main` verified after the merge: 557 unit tests, build, 59
e2e.

## V13 spike — compare as a mode (2026-10-13, branch `milestone/v13-compare-mode`)

Measured in Chromium on `cpr view` (`main` at `2644214`) before planning a browse mode for the
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

Measured before planning a checkout submenu, in Chromium on `cpr view` of the Qwik and
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

## V15 spike — what a new commit costs a review (2026-10-14, branch `milestone/v15-branch-reviews`)

Measured before planning branch reviews. Outside `cpr pr`, marks and drafts are kept per pair of
revisions (`stateDir`: a hash of `base..head` in the cache), so a commit added to a reviewed
branch starts the review over. On a clone of this repository, whose commits an agent wrote (189
of 206 carry its co-author line), each commit of four milestone branches (V9, V11, V12, V14) was
compared with its branch's fork point (`cpr diff`, 1.0–1.4 s each), and the changed symbols of
the commit before were checked against it by fingerprint, I1's rule. Over the 15 times a commit
was added to a branch already reviewed, 1,027 of 1,051 marks (97.7 %) would still be valid: 11
symbols changed again, and 13 moved with a renamed file (`e75c1cf`; IDs hold paths). Looking at
each new pair from scratch means 1,197 symbols; keeping marks per branch leaves 170 (14 %).
The graphs' `files` list non-code files too (docs, Markdown), so review files committed in
`cpr/` would show there, with no symbols. So the plan keys reviews by branch and, as asked, keeps
them in `cpr/reviews/` at the repository's root, one file per reviewer: out of git by default (a
`cpr/.gitignore` with `*` and `!config.json`, as pytest and ruff do), shared by deleting it.
