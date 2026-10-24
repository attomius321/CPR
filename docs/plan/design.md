# Symbiote — Design (v1)

[Index](../PLAN.md)

## 1. Why

Line diffs show *what text moved*. Reviewers need *what decisions were made*:
which functions were added, which contracts changed, and who is affected.

Symbiote turns a change set into a **graph of changed symbols** (functions, classes,
methods, types) and the **calls between them**, then runs detectors that point
at the risky parts. It runs locally and needs no server.

## 2. Scope

**v1 does**
- TypeScript and JavaScript (`.ts .tsx .js .jsx .mts .cts .mjs .cjs`); since L1–L2 also CSS and
  SCSS (`.css .scss`) and the markup that uses them ([plan](l1-l2-stylesheets.md))
- Compare two git revisions in one repository
- Output a versioned graph JSON and a list of findings
- Run as a CLI (`symbiote diff`) on macOS and Linux, Node ≥ 22.12

**v1 does not**
- Support other languages (they come later through adapters)
- Analyze types from `node_modules` beyond what the TS checker gives for free
- Do runtime or dataflow analysis
- Host anything, or require GitHub (that is phase 3)

## 3. Core concepts

| Term | Meaning |
|---|---|
| **Revision** | A source tree for one side of the diff (`base` or `head`). |
| **Symbol** | A named declaration with a stable ID, e.g. `src/user/service.ts#UserService.getUser`. |
| **Change** | How a symbol differs between sides: added, removed, or modified (signature, body, moved). |
| **Edge** | A relation between two symbols (call, reference, extends, implements). |
| **Finding** | A detector result attached to a symbol, with a severity. |
| **Graph** | Nodes + edges + findings. The contract between engine and UI ([graph-schema.md](../graph-schema.md)). |

## 4. Architecture

```
            ┌──────────────┐      graph.json      ┌──────────────┐
 git refs → │  @symbiote/core   │ ───────────────────→ │ @symbiote/viewer  │
            │  (engine)    │                      │ (React Flow) │
            └──────▲───────┘                      └──────▲───────┘
                   │                                     │
            ┌──────┴─────────────────────────────────────┴──────┐
            │                     @symbiote/cli                      │
            │        symbiote diff · symbiote view · (later) symbiote pr       │
            └───────────────────────────────────────────────────┘
```

### Packages

| Package | Role | Key deps |
|---|---|---|
| `packages/core` | Engine: revisions, extraction, diff, references, detectors, graph output | `ts-morph` |
| `packages/cli` | Argument parsing, git plumbing, output formatting | `@symbiote/core` |
| `packages/viewer` | Graph UI (phase 2) | `react`, `@xyflow/react` |
| `packages/plugin-angular` (X1–A2) | Angular templates, as a plugin the CLI loads on request | `@angular/compiler` (types from `@symbiote/core`) |
| `packages/plugin-qwik` (Q1–Q2) | Qwik routes, `component$` props and MDX routes, as a plugin | none (types from `@symbiote/core`) |

### Language adapter boundary

The pipeline is language-neutral. Everything TS-specific lives behind one interface,
so other languages (and a possible Rust/oxc core) can plug in later.

```ts
interface LanguageAdapter {
  id: string;                                   // "typescript"
  matches(path: string): boolean;
  load(rev: Revision): Promise<LoadedRevision>; // build the program/project
  extract(rev: LoadedRevision, files: string[]): SymbolDecl[];
  incoming(rev: LoadedRevision, id: SymbolId): EdgeRef[]; // who uses it
  outgoing(rev: LoadedRevision, id: SymbolId): EdgeRef[]; // what it uses
}
```

Diffing, move detection, detectors and graph output are shared code. Since L1–L2 two adapters
(TypeScript, stylesheets) are joined by `combineAdapters`, and a language can name what another
defines (`mentions`: markup's classes, a stylesheet's rules). Framework knowledge
(Angular templates first) is not part of an adapter: it comes as **plugins** of the TypeScript
adapter that the CLI loads on request (X1), so the TS/JS analysis is the same for every project.

### Revision sources

```ts
interface RevisionSource { root: string; sha?: string; dispose(): Promise<void> }
```

- `GitWorktreeSource` — a small **pool of detached worktrees** per repo at
  `<cache>/worktrees/<repo-id>/<role>-<n>`. A run takes a free slot (pid lock file) and moves it
  to the target SHA with `git checkout --detach`, so git only rewrites files that differ and
  disk use stays at a few checkouts per repo. Slots show up in `git worktree list`.
  Cache root: `$SYMBIOTE_CACHE_DIR`, else `$XDG_CACHE_HOME/symbiote`, else `~/Library/Caches/symbiote` (macOS)
  or `~/.cache/symbiote`.
- `DirectorySource` — a plain folder. Used by test fixtures and for quick experiments.

## 5. Engine pipeline

```
resolve refs → changed files → load projects → extract → hash → diff
            → match moves → references (changed only) → detectors → graph.json
```

1. **Resolve revisions.** `git rev-parse` both refs. Use `merge-base(base, head)` as the
   real base, the same way GitHub computes a PR diff. Flag `--no-merge-base` to compare directly.
   User-supplied refs are passed after `--end-of-options`; everything after uses resolved SHAs.
2. **Changed files.** `git diff --name-status -M <mergeBase> <head>`. Only these files can
   contain changed symbols, so extraction runs on them only. This is the main speedup.
3. **Load projects.** One ts-morph `Project` per side: the root `tsconfig.json`, every config it
   `references`, and every other `tsconfig.json` in the repo (depth ≤ 5), all with the root's
   options; no tsconfig → all sources with defaults. Workspace packages (from `workspaces` or
   `pnpm-workspace.yaml`) are mapped to their **sources in this revision** through `paths`, so
   cross-package references work even when `types` point at an unbuilt `dist/`. Changed files
   are added up front, so the program never changes after loading. Worktree slots get
   symlinks to the user's `node_modules` folders; package symbols are external leaves.
4. **Extract declarations** in changed files, both sides, with stable IDs (§6).
5. **Hash** each symbol twice: `signatureHash` and `bodyHash` (§6.3).
6. **Diff by ID** into `added`, `removed`, `modified{signature, body}`, `unchanged`.
7. **Match moves and renames.** Pair `removed` with `added` symbols, same kind only, in order:
   (a) git file renames keep the qualified name, (b) an identical declaration with the same
   name in another file, (c) an identical body of at least 10 normalized tokens. Members follow
   their container (`C.m` → `D.m` when `C` → `D`). A candidate must be unique on both sides;
   ambiguous cases stay added + removed. Pairs become `modified{moved}` with `previousId`.
   Similarity (non-exact) matching comes later.
8. **References, changed symbols only**, on each side where the symbol exists (base for
   removed and modified, head for added and modified):
   - Incoming (users): language-service `findReferences` from the declaration name; follows
     imports, barrels and renamed re-exports. Each site maps to its enclosing symbol, named
     exactly like extraction; top-level code is `file#(module)`.
   - Outgoing: resolve every identifier in the declaration (aliases followed to the real
     declaration). Package symbols become `<package>#<name>`; calls the checker cannot resolve
     (`obj[name]()`, `any` receivers) become `unknown:<callee>`; lib globals, locals, params and
     type-literal members are skipped.
   - Base IDs of moved symbols are renamed to head IDs; edges merge by (from, to, kind) into
     `side: base | head | both` with sites per side.
   - Unchanged neighbours join as **context nodes** (1 hop by default, `--depth n` widens on the
     head side, capped at 2000 symbols).
   - Type-only references are always collected as `type-reference` edges. The UI hides them by default.
9. **Detectors** (§8).
10. **Emit** `graph.json` + a human summary on stdout.

## 6. Symbols

### 6.1 What counts as a symbol (v1)

| Included | ID example |
|---|---|
| Top-level function | `src/a.ts#parse` |
| Top-level variable; a function-valued one (`const f = () => …`) has kind `function` | `src/a.ts#handler`, `src/a.ts#config` |
| Each name in a destructuring declaration | `const { a, b: [c] } = …` → `#a`, `#c` |
| Class, its methods, constructor, accessors (get+set = one symbol), properties | `src/a.ts#User`, `src/a.ts#User.save`, `src/a.ts#User.constructor` |
| Class property holding a function (`handle = () => …`) has kind `method` | `src/a.ts#User.handle` |
| Interface, type alias, enum | `src/a.ts#UserDto` |
| Namespace and its members (`namespace A.B` nests) | `src/a.ts#Utils.slugify`, `src/a.ts#A.B.x` |
| Default export: unnamed function/class/expression | `src/a.ts#default` (or its name, if it has one) |

Nested functions and callbacks are **folded into their parent's body** in v1.
A change inside them shows up as a body change of the parent.

Not yet extracted: CommonJS exports (`module.exports = …`, `exports.x = …`), ambient
`declare module 'x'` blocks, `export =`. Declaration files (`.d.ts`) and `*.min.js` are skipped.

### 6.2 Stable IDs

Format: `<repo-relative POSIX path>#<qualified name>`.

- Function overloads are one symbol; all overload signatures go into its signature hash.
- Static members always carry a `static:` prefix (`User.static:create`), so they never
  collide with instance members and IDs don't change when a same-named member appears.
- Computed or symbol-keyed members: `User.[Symbol.iterator]`.
- Anonymous default export: `#default`.
- Declaration merging (interface + namespace with one name): one ID, kinds listed together.

### 6.3 Hashing

Both hashes are computed from **normalized AST tokens**, so formatting-only edits do not count
as changes. Ignored: whitespace, comments, JSDoc, quote style (`'a'` = `"a"` = `` `a` ``),
trailing commas, statement and member terminators (`;` / `,`), parentheses around a single
arrow parameter. Still counted (journaled): redundant parentheses around expressions.

| Hash | Input |
|---|---|
| `signatureHash` | exported or not (however it is exported), decorators, modifiers (`async`, `static`, visibility, `abstract`, `readonly`), name, type params, params (name, optional, type, default), declared or inferred return type, heritage clauses for classes. **Interfaces, type aliases and enums: the whole declaration** — their shape *is* their contract. |
| `bodyHash` | function/method body; initializer for variables and properties; for classes and namespaces, the sorted list of member names. Empty string when there is no body (types, abstract methods). |

A class's own change comes from its heritage and member list. Member edits show on the members.

**Inferred return types:** when a function or method has **no declared return type**, the
checker's inferred return type is normalized and added to the signature hash. This catches
`return user` turning into `return user ?? null` with no annotation. Annotated symbols use
the declared text only. Runs on changed symbols only, so the cost is small.

## 7. TypeScript traps

| Trap | Plan |
|---|---|
| **Barrels and re-exports** | Incoming: the language service follows them. Outgoing: `getAliasedSymbol()` to the real declaration. Re-export hops (`via`) are not recorded yet. |
| **Path aliases** | The root config's `paths` (made absolute) merged with generated workspace-package paths. |
| **Monorepo tsconfigs** | All tsconfigs in the repo load into **one** project with the root's options. Limitation: per-package `paths`/options are lost (seen in Symbiote's own fixtures). Later: one project per config, references searched across them. |
| **Renames and moves** | §5 step 7. Exact body-hash match in v1; similarity matching later. |
| **Dynamic JS calls** | `obj[name]()`, `any`-typed receivers, `require(var)`, `eval`: emit an edge with `resolution: "unknown"` and a text-based guess when a name is visible. Never silently drop them. |
| **JS without types** | Always load with `allowJs` + `checkJs: false`, even when the tsconfig doesn't, so changed `.js` files are part of the program. Resolution is weaker; mark low-confidence edges as `unknown`. |
| **Project's own TS version** | Symbiote analyzes with ts-morph's bundled compiler (TS 6.0), not the version the project installs. Older configs (`baseUrl`, `moduleResolution: node`, `target: es5`) still work in 6.0 but warn, so projects are loaded with `ignoreDeprecations: "6.0"`. ts-morph is pinned exactly: a release built on TS 7 would drop those options. |
| **Generated files, fixtures** | `.d.ts` and `*.min.js` are never extracted. Changed files under `fixtures/`, `__fixtures__/`, `__snapshots__/`, `generated/` or named `*.generated.*` are listed as `(ignored)` but not analyzed; a root `.symbioteignore` adds or removes patterns with gitignore's rules (a pattern matches at any depth unless a `/` at its start or middle anchors it, `dir/` matches folders and what is inside, `!` re-includes). It is read from the working folder, not from the analyzed commits (a fix after the Angular trial). |

## 8. Detectors (v1)

| Rule ID | Fires when | Severity | Notes |
|---|---|---|---|
| `removed-still-referenced` | A removed symbol's name still appears **unresolved** in head (an import of an export that is gone, an unknown identifier, a property missing from a typed receiver), inside a symbol that used it in base or imported from its file. | error; warning when only untyped code (JS, `any`) still uses it | Unresolved names in symbols that never used it are ignored (precision). |
| `orphan-added` | An added symbol has no references in head (its own members don't count). | warning; `info` when exported from the package entry (public API) or a default export | Overrides/implementations of inherited members are skipped (called through the base type). Members of an orphan class are not repeated. |
| `signature-changed` | A modified symbol's signature hash changed and it has users in head. | warning only when the change may break users (**compatibility** `breaking`/`unknown`) **and** an untouched **production** user lives in another file; otherwise `info` (D1: a stale test fails on its own) | **Blast radius** = all head users, split into *updated* (changed in this PR, or top-level code of a changed file) and *untouched*. Compatibility compares shapes: optional params/members added → `compatible`; required members added → `additive`; removed/retyped → `breaking`. |

| `exported-api-changed` (D1) | A symbol exported from the entry of a published package (no `"private": true`) is removed, no longer exported, or gets a `breaking`/`unknown` signature. Private class members are not API. | warning | For code outside the repo. A removal already reported by `removed-still-referenced` is not repeated. Removing only a re-export (the symbol itself unchanged) is not detected yet. |

Test files (`*.test.*`, `*.spec.*`, `*.test-d.*`, `__tests__/`, `__mocks__/`, `test/`, `tests/`, `e2e/`) are told apart from production code by path.

Every finding links to a symbol ID and its related IDs, so the UI can highlight them.

Later candidates: `exported-api-changed`, `new-cycle`, `caller-not-updated-for-new-param`,
`test-not-touched-for-changed-symbol`.

## 9. CLI (phase 1)

```
symbiote diff <base> [head] [options]        head defaults to HEAD

  --json                print the graph JSON instead of the summary
  --out <file>          also write the graph JSON to a file
  --codequality <file>  also write the findings as a GitLab Code Quality report
  --fail-on <level>     exit 1 if any finding is at least error | warning | info (for CI)
  --project <path>      tsconfig to use, relative to the repo root (default: tsconfig.json)
  --depth <n>           hops of unchanged context (default: 1)
  --no-merge-base       compare base and head directly
  --since <rev>         mark changed symbols new / updated / same vs an earlier head (I2)
```

```
symbiote view <base> [head] [options]        same analysis, reviewed in the browser

  --port <n>            port on 127.0.0.1 (default: any free port)
  --no-open             don't open the browser
  (plus --no-merge-base, --since, --project, --depth)
```

```
symbiote pr <number> [options]               a GitHub pull request or GitLab merge request (alias: mr)

  --summary | --json    print instead of opening the viewer (also --out, --fail-on)
  --forge github|gitlab for hosts whose name doesn't say
  --remote <name>       remote to read and fetch from (default: origin)
```

`symbiote pr` reads the PR/MR through the forge API, fetches its head (`refs/pull/<n>/head`,
`refs/merge-requests/<n>/head`) and target branch into `refs/symbiote/<forge>/<n>/…`, and analyzes
the same diff the forge shows (GitHub: merge-base of base and head; GitLab: `diff_refs.base_sha`).

`symbiote view` serves the built viewer, `/api/graph`, `/api/capabilities`,
`/api/state/review|drafts` (reviewed marks and draft comments, stored under
`<cache>/state/<repo>/<change>/` so they survive restarts on another port) and
`/api/source?side=base|head&file=…` on localhost only; sources are limited to files the graph
mentions and read with `git show`. Every request must carry the server's own `Host`
(127.0.0.1 or localhost with its port), so a rebinding DNS name cannot read sources.

`symbiote pr <n> --post-findings <level>` skips the viewer and posts the findings at or above the
level that no earlier run posted (see G3), then prints the summary and applies `--fail-on`, so
one command serves CI on both forges.

Under `symbiote pr`, the viewer can also post a review: `POST /api/review` (`{event, body,
comments[]}`). Writes (`POST /api/review`, `PUT /api/state/…`) need
`content-type: application/json`, an `x-symbiote: 1` header and, when the browser sends one, a
same-origin `Origin` — a request other sites cannot make without a CORS
preflight the server never grants. Comments must be on files of the change. The forge's error
(no access, a line outside the diff, approving one's own PR) is shown in the viewer.

Exit codes: `0` ok, `1` failure or `--fail-on` hit, `2` usage error. Warnings (configs that failed to
load, files the program skipped) go to stderr.

Human summary (real output shape):

```
main (273c27a) → HEAD (b769925), merge-base 273c27a
4 files changed · 3 symbols changed: 1 removed, 1 added, 1 modified

Findings
  ✖ removed-still-referenced  src/math.ts#legacy
      legacy was removed but is still used by 1 symbol: old
  ⚠ signature-changed         src/math.ts#add
      add changed its signature; 1 of 2 users not updated: total

M  src/math.ts
     ~ function    add  (signature, body)  · used by 2
     - function    legacy  · used by 1
     + function    triple
R  src/old.ts → src/new.ts
     → function    old  (moved from src/old.ts#old)
A  test/fixtures/x.ts  (ignored)
```

## 10. Testing

- **Fixture pairs:** `packages/core/test/fixtures/<case>/{base,head}/`, loaded with
  `DirectorySource`. One case per behavior (rename, barrel, path alias, overload, dynamic call,
  legacy TS 4–style tsconfig…).
- **Golden snapshots:** each case has an expected `graph.json`; tests diff against it.
- **Git integration tests:** a small script builds a temp repo with commits to test
  worktrees, merge-base and rename detection.
- **Dogfood:** run on real PRs from 3 open-source TS repos of different sizes; record
  runtime and false positives.

## 11. Performance budget (v1)

Measured in M7 (4-core container, per commit, end to end):

| Repo | TS files | Deps installed | Per commit |
|---|---|---|---|
| ky | 87 | yes | 0.8–3.1 s |
| zod | 515 | no | 2.8–6.4 s |
| vite | 601 (+ playgrounds) | yes | 4.5–7.0 s |

Loading the two programs is ~70 % of the time. Next lever: **one program for both sides** —
load head, then swap in the base versions of changed files so TypeScript reuses every unchanged
file's AST (incremental program). Expected ~40 % off large repos.

Budget targets:

| Repo size | Changed symbols | Target |
|---|---|---|
| ~1k files | 20 | < 5 s |
| ~10k files | 50 | < 30 s |

Main costs are type-checker setup (2 programs) and `findReferences`. Levers if we miss:
cache worktrees and `.tsbuildinfo` by SHA, load only the affected workspace packages,
build a per-file identifier index to prefilter reference search, then a TS 7 adapter (spike S1)
or oxc in the long run.

## 13. Risks

| Risk | Mitigation |
|---|---|
| `findReferences` too slow on big repos | Only changed symbols; prefilter by identifier index; per-package loading. |
| Missing `node_modules` in worktrees breaks types | Symlink from main checkout; external symbols are leaves; base/head lockfile drift is accepted in v1. |
| Symbol IDs unstable across refactors | Move matching by body hash; `previousId` on the node. |
| Graph too big to read | UI collapses context nodes and groups by file/package by default. |
| TS 7 compiler API is published as `unstable` | Only behind the adapter boundary; ts-morph stays the default until it stabilizes. |
| A ts-morph upgrade moves to a TS 7–based compiler | Pin the exact version; the legacy-config fixture must pass before upgrading. |
| ts-morph memory use with two projects | Load sides one after the other and keep only extracted data, not both ASTs. |

## 14. Decisions

| # | Question | Decision | Why |
|---|---|---|---|
| 1 | Package manager | **pnpm** workspaces | Fast, strict about undeclared deps, standard for TS monorepos. |
| 2 | Inferred return type in signature hash | **Only when unannotated** (§6.3) | Catches silent contract changes without noise on annotated code. |
| 3 | Type-only references | **Always collected, hidden by default** in the UI | Needed for blast radius when an interface or type changes. |
| 4 | Context depth | **1 hop**, `--depth n` to widen | Small graphs by default, more context on demand. |
| 5 | Worktree cache location | **`$XDG_CACHE_HOME/symbiote`** (outside the repo) | Worktrees inside the repo would be picked up by tsc, eslint, test runners and file watchers. |
| 6 | Minimum Node | **22.12** | Node 20 is EOL; Vitest 5 requires ≥ 22.12. CI runs Node 22 and 24. |
| 7 | TypeScript for our own code | **6.0.x**, not 7 | TS 7 (the Go port) is `latest`, but typescript-eslint supports `<6.1`. ts-morph bundles its own compiler, so the engine is unaffected. Revisit when lint tooling supports 7. |
| 8 | Compiler behind the engine | **ts-morph (bundles TS 6.0)** for v1; TS 7 adapter as spike S1 after M4 | TS 7's compiler API is `unstable` and ts-morph doesn't support it yet. The adapter boundary lets us swap later. |
| 9 | After spike S1 | **Stay on ts-morph for v1** | TS 7 matched results (99.9 % of use sites) and loaded 4–7× faster, but reference search was only 1.6–3.5× faster over IPC, the API is unstable, and an adapter means porting extraction and hashing to a new AST. See [spikes/ts7](../../spikes/ts7/README.md). |
| 10 | Signature-change severity | **By compatibility and reach**: warn only for possibly-breaking changes with untouched users in other files | Dogfood on ky/zod: adding an optional field to an interface warned on every type user. Same-file users are already in the line diff. |
| 11 | Type inference cost | **Infer only for symbols whose syntax changed** (two-pass extraction), truncate long type text | Inference was 75 % of extraction on zod. A drifted inferred type of an unchanged symbol is covered by the callee's own finding. |
| 12 | What to load | Ignore `examples/` and `playground/` by default (also for loading); without a root tsconfig, load the configs below it instead of every file | vite: 2,724 → 932 program files, 15–20 s → 4.5–7 s per commit. |
| 13 | Where a symbol's comment goes | **Its first added line, else its first removed line**; the reviewer can pick another +/− line; no changed line (moved unchanged, context, classes) → quoted in the review summary | Forges accept inline comments only inside diff hunks; changed lines always are, unchanged lines of a long symbol may not be. |
| 14 | GitLab "request changes" | **A note marked "Changes requested" + withdraw own approval** | GitLab's REST API has no stable request-changes call; this keeps the MR unapproved by the reviewer and says why. |
| 15 | When a finding counts as "already posted" | **Same rule and symbol** (a hidden `<!-- symbiote:finding … -->` marker), not the same wording | A finding's message changes as callers come and go; reposting it on every push would bury the thread. Resolved findings are not withdrawn. |
| 16 | Where a posted finding goes | **The first changed line of its symbol per `git diff -U0`**, head side first, else base (removed symbols); else the summary | The forge's diff is git's, so its changed lines are always commentable; if the forge still refuses, everything is posted in the summary instead of failing the CI job. |
| 17 | Where review state lives | **In the CLI's cache, per change request** (`/api/state`); browser storage only for dropped graph files | Each run takes a free port and browser storage is per origin, so marks kept in the browser vanished on the next run. Per change request (not per head) so a new push keeps the review. |
| 18 | GitLab CI without a token | **Read the MR from the pipeline's variables; report findings as Code Quality** | The job token can fetch the repository but cannot comment (and may not read merge requests); asking every project for a token before Symbiote shows anything is a poor first run. |
| 19 | Who uses a class member | **Code that could run on an instance of its class** (R1): the object's class is the member's class, a subclass (use), an ancestor or interface (possible use), or unknown (kept); siblings are dropped; declarations become `overrides` edges | The language service answers rename questions, so it returns the whole class family: on an Angular app every `ngOnInit` "used" every other, and a property override listed every sibling's `this.prop`. |
| 119 | What the name stands for | **Coordinated Programming Runtime** (2026-10-15); no longer, since the rename to Symbiote (decision 223) | Asked with the README rewrite. Since V15–V18, Symbiote coordinates the person and their agents (a feature's branch, worktree and agent; reviews and verdicts the agent acts on), not only the review; the North Star is unchanged. |
