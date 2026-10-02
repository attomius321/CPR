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
library edges both ways); the Bitwarden rename experiment (A3 ✖, A2 nothing); Bitwarden timing:
BWTBD
