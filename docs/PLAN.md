# CPR — Plan (draft v0.1)

> Status: living plan. Settled decisions are in §14; what we learn along the way is in
> [JOURNAL.md](./JOURNAL.md).

## North Star

**Review decisions, not lines.** Every feature must help a reviewer answer, faster than
reading the diff:

1. **What changed in behavior or contract?** (added, removed, signature, body)
2. **Who is affected?** (callers, blast radius)
3. **What is risky?** (findings)

Tie-breakers when trading off: precise beats complete (a wrong finding costs more trust than a
missing one), explainable beats clever (every finding links to code), local and fast beats
hosted.

## 1. Why

Line diffs show *what text moved*. Reviewers need *what decisions were made*:
which functions were added, which contracts changed, and who is affected.

CPR turns a change set into a **graph of changed symbols** (functions, classes,
methods, types) and the **calls between them**, then runs detectors that point
at the risky parts. It runs locally and needs no server.

## 2. Scope

**v1 does**
- TypeScript and JavaScript (`.ts .tsx .js .jsx .mts .cts .mjs .cjs`)
- Compare two git revisions in one repository
- Output a versioned graph JSON and a list of findings
- Run as a CLI (`cpr diff`) on macOS and Linux, Node ≥ 22.12

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
| **Graph** | Nodes + edges + findings. The contract between engine and UI ([graph-schema.md](./graph-schema.md)). |

## 4. Architecture

```
            ┌──────────────┐      graph.json      ┌──────────────┐
 git refs → │  @cpr/core   │ ───────────────────→ │ @cpr/viewer  │
            │  (engine)    │                      │ (React Flow) │
            └──────▲───────┘                      └──────▲───────┘
                   │                                     │
            ┌──────┴─────────────────────────────────────┴──────┐
            │                     @cpr/cli                      │
            │        cpr diff · cpr view · (later) cpr pr       │
            └───────────────────────────────────────────────────┘
```

### Packages

| Package | Role | Key deps |
|---|---|---|
| `packages/core` | Engine: revisions, extraction, diff, references, detectors, graph output | `ts-morph` |
| `packages/cli` | Argument parsing, git plumbing, output formatting | `@cpr/core` |
| `packages/viewer` | Graph UI (phase 2) | `react`, `@xyflow/react` |
| `packages/plugin-angular` (planned, X1–A2) | Angular templates, as a plugin the CLI loads on request | `@cpr/core`, `@angular/compiler` |

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

Diffing, move detection, detectors and graph output are shared code. Framework knowledge
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
  Cache root: `$CPR_CACHE_DIR`, else `$XDG_CACHE_HOME/cpr`, else `~/Library/Caches/cpr` (macOS)
  or `~/.cache/cpr`.
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
| **Monorepo tsconfigs** | All tsconfigs in the repo load into **one** project with the root's options. Limitation: per-package `paths`/options are lost (seen in CPR's own fixtures). Later: one project per config, references searched across them. |
| **Renames and moves** | §5 step 7. Exact body-hash match in v1; similarity matching later. |
| **Dynamic JS calls** | `obj[name]()`, `any`-typed receivers, `require(var)`, `eval`: emit an edge with `resolution: "unknown"` and a text-based guess when a name is visible. Never silently drop them. |
| **JS without types** | Always load with `allowJs` + `checkJs: false`, even when the tsconfig doesn't, so changed `.js` files are part of the program. Resolution is weaker; mark low-confidence edges as `unknown`. |
| **Project's own TS version** | CPR analyzes with ts-morph's bundled compiler (TS 6.0), not the version the project installs. Older configs (`baseUrl`, `moduleResolution: node`, `target: es5`) still work in 6.0 but warn, so projects are loaded with `ignoreDeprecations: "6.0"`. ts-morph is pinned exactly: a release built on TS 7 would drop those options. |
| **Generated files, fixtures** | `.d.ts` and `*.min.js` are never extracted. Changed files under `fixtures/`, `__fixtures__/`, `__snapshots__/`, `generated/` or named `*.generated.*` are listed as `(ignored)` but not analyzed; a root `.cprignore` (gitignore-style, `!` re-includes) adds or removes patterns. |

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
cpr diff <base> [head] [options]        head defaults to HEAD

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
cpr view <base> [head] [options]        same analysis, reviewed in the browser

  --port <n>            port on 127.0.0.1 (default: any free port)
  --no-open             don't open the browser
  (plus --no-merge-base, --since, --project, --depth)
```

```
cpr pr <number> [options]               a GitHub pull request or GitLab merge request (alias: mr)

  --summary | --json    print instead of opening the viewer (also --out, --fail-on)
  --forge github|gitlab for hosts whose name doesn't say
  --remote <name>       remote to read and fetch from (default: origin)
```

`cpr pr` reads the PR/MR through the forge API, fetches its head (`refs/pull/<n>/head`,
`refs/merge-requests/<n>/head`) and target branch into `refs/cpr/<forge>/<n>/…`, and analyzes
the same diff the forge shows (GitHub: merge-base of base and head; GitLab: `diff_refs.base_sha`).

`cpr view` serves the built viewer, `/api/graph`, `/api/capabilities`,
`/api/state/review|drafts` (reviewed marks and draft comments, stored under
`<cache>/state/<repo>/<change>/` so they survive restarts on another port) and
`/api/source?side=base|head&file=…` on localhost only; sources are limited to files the graph
mentions and read with `git show`. Every request must carry the server's own `Host`
(127.0.0.1 or localhost with its port), so a rebinding DNS name cannot read sources.

`cpr pr <n> --post-findings <level>` skips the viewer and posts the findings at or above the
level that no earlier run posted (see G3), then prints the summary and applies `--fail-on`, so
one command serves CI on both forges.

Under `cpr pr`, the viewer can also post a review: `POST /api/review` (`{event, body,
comments[]}`). Writes (`POST /api/review`, `PUT /api/state/…`) need
`content-type: application/json`, an `x-cpr: 1` header and, when the browser sends one, a
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

## 12. Roadmap

| Phase | Deliverable | Done when |
|---|---|---|
| **1. Engine** | `cpr diff base head` → JSON + findings | All fixture cases pass; runs within budget on the dogfood repos. |
| **2. Viewer** | `cpr view` serves a local graph UI with per-symbol diffs | You can review a real PR from the graph alone: click a node → see its diff, callers, findings. |
| **3. GitHub & GitLab** ✅ | `cpr pr 123`: review, comment, approve — pull requests and merge requests | Comments land on the right lines; approve/request-changes works like `gh pr review`, on GitHub and GitLab. |
| **4. Interdiff** ✅ | Show only what changed between PR versions | Re-review after a force-push shows only the new deltas. |
| **5. CI** ✅ | GitHub Action and GitLab CI template that post findings | A pipeline runs on a PR/MR and posts a summary + inline findings, on both forges. |

### Phase 2 milestones (viewer)

| # | Milestone | Output |
|---|---|---|
| V1 ✅ | Viewer app | Vite + React + React Flow app rendering a graph JSON: changed symbols colored by status, context dimmed, edges by side, finding badges, layered layout. Load by URL or drag & drop. |
| V2 ✅ | `cpr view` | CLI runs the analysis, serves the built viewer plus `/api/graph` and `/api/source`, opens the browser. |
| V3 ✅ | Symbol detail | Click a node → base/head source of the symbol side by side, what changed, users and callees, findings. |
| V4 ✅ | Review flow | Findings list, filters (type references hidden by default, externals grouped by package), mark symbols reviewed, keyboard navigation. |
| V5 ✅ | Viewer dogfood | Playwright end-to-end tests; review real commits of ky/zod/vite in the viewer. |

### Phase 3 milestones (GitHub and GitLab)

Everything forge-specific sits behind one **forge adapter** (like the language adapter), with a
GitHub and a GitLab implementation; the CLI and viewer only see "a change request".

| # | Milestone | Output |
|---|---|---|
| G1 ✅ | `cpr pr <n>` | Detect the forge and project from the `origin` remote (`--forge github\|gitlab` for self-hosted hosts), read the PR/MR through its API, fetch its head (`pull/<n>/head`, `merge-requests/<n>/head`) and base, analyze, open the viewer (or `--json`). `cpr mr` is an alias. |
| G2 ✅ | Review from the viewer | Draft comments on symbols (anchored to their first changed line, or a picked +/− line; removed lines on the base side), then submit: comment, approve, or request changes. GitHub: one review call. GitLab: draft notes + bulk publish, approve/unapprove. Local POST endpoint guarded against cross-site requests and DNS rebinding. |
| G3 ✅ | Findings as comments | `cpr pr <n> --post-findings <level>`: new findings become inline comments on their symbols' first changed line (`git diff -U0`, the forge's own lines), the rest go into the summary; a hidden marker per rule + symbol means nothing is posted twice. If the forge refuses the inline comments, all go into the summary. |

| | GitHub | GitLab |
|---|---|---|
| Project from remote | `github.com/<owner>/<repo>` | `gitlab.com/<group>/<subgroup…>/<project>` (URL-encoded path as project id) |
| Read | `GET /repos/:o/:r/pulls/:n` | `GET /projects/:id/merge_requests/:iid` (`diff_refs`) |
| Head ref | `refs/pull/<n>/head` | `refs/merge-requests/<iid>/head` |
| Review | `POST …/pulls/:n/reviews` with `commit_id`, `event`, `comments[]` (`path`, `line`, `side` `RIGHT`/`LEFT`) | `POST …/draft_notes` (position: base/start/head SHA, `old_path`/`new_path`, `new_line` or `old_line`) → `POST …/draft_notes/bulk_publish`; `POST …/approve` (request changes: a marked note + `POST …/unapprove`) |
| Existing comments | `GET …/pulls/:n/comments`, `…/pulls/:n/reviews`, `…/issues/:n/comments` (paged) | `GET …/merge_requests/:iid/notes` (paged) |
| Token | `GITHUB_TOKEN`, `GH_TOKEN`, `gh auth token` | `GITLAB_TOKEN`, `CI_JOB_TOKEN` (reads only: job tokens cannot post notes) |
| API base | `GITHUB_API_URL` or `https://api.github.com` (GHE: `https://<host>/api/v3`) | `GITLAB_API_URL` or `https://<host>/api/v4` |

Tests run against local mock APIs for both forges (no network, no tokens).

### Phase 4 milestones (interdiff)

| # | Milestone | Output |
|---|---|---|
| I1 ✅ | Review state per change request | Reviewed marks and drafts kept by the CLI per PR/MR (else per revision pair), each with the symbol's fingerprint (both sides' hashes). After a new push, marks on symbols whose fingerprint is the same stay; the others are flagged "↻ changed since you reviewed it". Drafts on unchanged symbols follow them to their new lines; drafts on changed symbols become outdated and go into the summary. |
| I2 ✅ | `--since <sha>` | `cpr diff`/`view`/`pr … --since <old head>`: each changed symbol is `new`, `updated` or `same` compared with merge-base(base, old head)..old head, by fingerprint (both sides' hashes), so a rebase that touched nothing in the change shows nothing; `since.dropped` lists symbols no longer changed. The earlier version is only extracted (no references): +55 % time on a 34-file change. `cpr pr` fetches the old head from the forge if it is gone locally. The viewer's "Only changes since …" hides `same` symbols from the list (and `j`/`k`) and dims them. |

### Phase 5 milestones (CI, both forges)

| # | Milestone | Output |
|---|---|---|
| C1 ✅ | GitHub Action | Composite `action.yml` at the repo root: sets up Node 22, builds CPR from the action's checkout (`action/install.sh`), runs `action/run.sh` (deepens a shallow clone, `cpr pr --summary --out … --post-findings … --fail-on …`, the summary into `$GITHUB_STEP_SUMMARY`, the graph path as an output). `cpr pr` without a number reads the job's pull request (`GITHUB_EVENT_PATH`, `CI_MERGE_REQUEST_IID`). This repo reviews its own PRs with it (`.github/workflows/cpr.yml`). |
| C2 ✅ | GitLab CI template | `ci/gitlab/cpr.yml` (`include: remote:`): a `cpr` job on merge request pipelines that builds CPR and runs the shared `action/run.sh`. Without a token, the MR is read from the pipeline's `CI_MERGE_REQUEST_*` variables and findings go to the MR's Code Quality widget (`--codequality`, `artifacts:reports:codequality`); with `GITLAB_TOKEN` they are also posted as comments. The API URL comes from `CI_API_V4_URL` on the job's own instance. |

**Proposed next** (not started; the roadmap above is complete):

| # | Idea | Why |
|---|---|---|
| P1 | One program for both sides | Measured lever: base and head share most files; a single language service over both trees (or reusing the head program's lib/dependency files) would cut load time, the largest cost on vite/zod. |
| C3 | GitHub annotations | Fork PRs get a read-only token, so nothing is posted; `::warning file=…,line=…::` workflow commands show findings inline without one (GitLab already has Code Quality). |
| D1 ✅ | Detectors from real reviews | `signature-changed` tells test users from production users (only untouched production users elsewhere make a warning); new `exported-api-changed` for a published package's API removed, unexported, or broken. See §8. |
| X1, A1–A2 | Plugins; Angular templates as the `angular` plugin | Templates call component methods, bind inputs and use pipes, and CPR sees none of it: 9 of 9 warnings on real Angular commits were false. Angular support must stay outside the TS/JS analysis: X1 adds plugin hooks, A1–A2 build the Angular plugin on them. Planned below. |

### R1 — Receiver-aware references ✅

**Problem** (found on an Angular project): TypeScript's reference search is built for safe
renaming, so it treats every class in a family as related. When `CbsComponent` overrides a
property declared by its base class `ResourceBase`, the search for `CbsComponent.panelDisplayType`
also returns `this.panelDisplayType` inside every *sibling* class (`RentCarsResourceComponent`,
…) and the base declaration itself. CPR lists them all as "used by", although a sibling object can
never be a `CbsComponent`. The same cause gives Angular's `ngOnInit` "used by 11" (every component
implements `OnInit`) and puts siblings into `signature-changed` user counts.

**Rule:** a reference counts as a use of a class member only if the code could run with an
instance of the member's class. CPR looks at the object the member is read from — `x` in
`x.member`, the class itself for `this`/implicit `this` — and asks the checker for its class:

| Object's class | Example | Result |
|---|---|---|
| The member's class or a subclass | `this.m` inside `CbsComponent`; `cbs.m` via `@ViewChild` | use (certain) |
| An ancestor class or an interface it implements | `this.m` in a `ResourceBase` method; `item: ResourceBase` | use, marked **possible** |
| Unrelated (sibling, cousin) | `this.m` in `RentCarsResourceComponent` | dropped |
| Unknown (`any`, JS, type parameters without a constraint) | `obj.m` | use (unsure → keep) |

Declaration sites returned by the search are not uses:
- **an ancestor's declaration** of the member (the base `panelDisplayType`) → an `overrides` edge
  from the member to it;
- **a subclass's override** → an `overrides` edge from the override to the member (it must stay
  compatible, so it still counts for `signature-changed`);
- **a sibling's declaration** (another component's `ngOnInit`) → dropped.

Symbols that are not class members (functions, variables, types) are not affected.

**Graph contract (schema 0.4.0):** new edge kind `overrides`; edges gain optional
`possible: true` when every site reaches the member only through an ancestor or interface type.
The viewer labels such neighbours "possible".

**Verification**
1. A fixture mirroring the Angular case: a base class, an overriding class, a sibling, a base
   method, a polymorphic user (`ResourceBase`-typed value), a subclass override, and two classes
   implementing a shared interface method — each with its expected result.
2. Golden graphs may change only where class families are involved; every changed line is checked.
3. Before/after edge diffs on ky, zod, vite and the Angular 11 RealWorld app: every edge that
   disappears is inspected and must be a sibling or declaration case.

**Risk:** medium-low. The only harmful outcome is dropping a real use; "unknown → keep" and step 3
guard against it. **Cost:** one type lookup per reference.

Not in R1 (listed for later): reading Angular templates, `.cprignore` from the working folder,
`interfaces/` matching at any depth, decorator-only class changes treated as compatible.

### X1 — Plugins (planned)

**Why.** Framework knowledge — Angular templates now; Vue or Svelte templates, NestJS conventions
later — must not live in the TypeScript/JavaScript analysis. That analysis stays the same program
for every project and carries no framework dependency; a framework comes as a **plugin** that the
CLI loads only when asked. Without plugins, CPR behaves exactly as it does today.

**What a plugin is.** A JavaScript module exporting one plugin object. A plugin *extends* the
TypeScript adapter at fixed points; it never replaces it, and it sees TypeScript's own objects
(program, checker, nodes). Sketch of the contract, exported by `@cpr/core`:

```ts
interface TsPlugin {
  name: string;                         // "angular"
  apiVersion: 1;
  /** Whether it applies to this revision (checked per side: base may predate the framework). */
  applies(revision: PluginContext): boolean;
  /** Extra files whose changes it analyzes, besides TS/JS (e.g. `*.html`). */
  matches?(path: string): boolean;
  /** In-memory TypeScript files added to the program before it is built (template shims). Runs
   *  before types exist: it sees the project's files and their syntax trees. */
  virtualFiles?(revision: PluginContext): VirtualFile[];
  /** Extra symbols in the given changed files (templates), with hashes and ranges. */
  extract?(revision: PluginRevision, files: readonly string[]): SymbolDecl[];
  /** How a decorator's arguments count in hashes; undefined = as today (all signature). */
  decoratorArguments?(decorator: ts.Decorator): ArgumentRoles | undefined;
  /** Why a symbol may be used with no reference (a lifecycle hook → `framework`). */
  exposure?(revision: PluginRevision, symbol: SymbolDecl): Exposure | undefined;
  warnings?(revision: PluginRevision): string[];
}

interface VirtualFile {
  path: string;                          // src/app/foo.component.html.cpr.ts — never on disk
  text: string;
  /** Owner symbol and real site of a position in `text`; undefined = scaffolding (dropped). */
  map(offset: number): { owner: SymbolId; site: Site } | undefined;
}
```

**What core does with plugins** — generic mechanisms, nothing Angular-specific:

| Hook | Core behaviour |
|---|---|
| `matches` | A changed file is analyzable if the adapter or an applying plugin matches it (today a template-only change exits early). |
| `virtualFiles` | Added to the program before the language service starts; the program still never changes after loading. |
| `map` | Wherever the adapter reports a site — `incoming`, `outgoing`, `dangling` — a position inside a virtual file is mapped back: the site becomes the real `.html` line and the symbol becomes the owner (the template). Unmapped positions are scaffolding and dropped, like import declarations today. |
| `extract` | Plugin symbols join the adapter's: diffed, move-matched, hashed and drawn like any symbol. |
| `decoratorArguments` | A claimed decorator's arguments are hashed by role (signature, body, neither); unclaimed decorators as today. |
| `exposure` | Consulted after the adapter's own; the new exposure `framework` is skipped by `orphan-added` like `override`. |

Technically the CLI builds `createTypescriptAdapter({ plugins })`; the default `typescriptAdapter`
is the same factory with no plugins, so the pipeline and the `LanguageAdapter` interface do not
change.

**Turning plugins on.**
- `--plugin <name|path>` (repeatable) on `diff`, `view` and `pr`, and/or `cpr.config.json` at the
  repository root: `{ "plugins": ["angular"] }`. The config is read from the working folder, not
  from the analyzed commit (the `.cprignore` lesson); a flag adds to it.
- `angular` means `@cpr/plugin-angular`; a value with `/` or a leading `.` is a path. Resolved from
  the project first, then next to the CLI. Imported only when turned on: no plugin, no cost, no
  extra dependency loaded.
- Another `apiVersion` is refused with a message; a plugin that throws becomes a warning and the
  run continues without it — a plugin never makes an analysis fail.
- A hint, once: when a changed `.html` sits in a repo that depends on `@angular/core` and the
  plugin is off — `Angular project: add --plugin angular to analyze templates`. Nothing changes
  on its own.
- Plugins are trusted code, like build-tool plugins: they run only when configured.

**Packaging.** `packages/plugin-angular` (`@cpr/plugin-angular`) depends on `@cpr/core` and
`@angular/compiler`. `@cpr/core` and `@cpr/cli` never depend on Angular; in this repository the
plugin is built with the rest, so `--plugin angular` works from a checkout.

**Graph contract (schema 0.5.0).** Node kind `template` (any framework's); exposure `framework`;
top-level `plugins: [{ name, version }]`, so a graph says what produced it. Edge sites can point
into non-TS files. The viewer stays generic: it labels template nodes and shows their file's diff.

**CI.** The GitHub Action gets a `plugins` input and the GitLab template a `CPR_PLUGINS` variable,
both passed as `--plugin`.

**X1 verification**
1. A test plugin among the fixtures exercises every hook: a virtual file mapped back into a non-TS
   file, an extra file type, a claimed decorator, an exposure.
2. No plugin → every golden graph byte-identical; ky, zod and vite unchanged; an Angular repo
   without `--plugin angular` unchanged too (only the hint).
3. A missing plugin, a wrong `apiVersion` and a plugin that throws → a message or a warning, never
   a crash.

### A1–A2 — Angular templates, as the `angular` plugin (planned, branch `milestone/a1-angular-templates`)

Everything in this section lives in `@cpr/plugin-angular` and reaches CPR only through X1's hooks.
Without `--plugin angular`, CPR does none of it — on Angular projects too.

**Problem.** CPR reads TypeScript only, so everything an Angular template does is invisible: a
method called only from `(click)` looks unused, a method removed while its template still calls
it is not reported, and a change to a template alone shows nothing. Measured with Angular's own
template parser (spike in the [journal](./JOURNAL.md#angular-templates-spike-2026-10-02)):

| | RealWorld, Angular 11 | RealWorld, Angular 21 | Bitwarden clients, Angular 21 |
|---|---|---|---|
| Components (external / inline templates) | 18 (18 / 0) | 18 (10 / 8) | 1,188 (780 / 396) |
| Component members read by templates | 128 | 112 | 10,368 |
| Members used **only** by templates (by name, approximate) | 19 | 21 | ~1,800 |
| Input / output bindings to repo components | 26 / 7 | 30 / 8 | 4,060 / 522 |
| Pipe uses (of repo pipes) | 4 (1) | 13 (6) | 6,485 (5,732) |
| Parse errors | 0 | 0 | 0 |
| Parse + bind every template, one side | 0.1 s | 0.1 s | 1.8 s |

On seven real RealWorld commits that touch templates, CPR today gives **9 warnings, all false**,
and none of what the templates changed:

| Commit | CPR today | Cause |
|---|---|---|
| `438e991` new control flow (14 templates) | nothing | no TS file changed: `.html` is not analyzed |
| `c80e51b` add a missing `@for` `track` | nothing | same |
| `857a75e` auth state in the navbar | ⚠ orphan `HeaderComponent.authState$`; ⚠ `HeaderComponent` changed its signature, 1 user not updated | used only by its template; an `@Component({ imports })` edit counts as a signature change |
| `5467760` error management | ⚠ `ProfileComponent` changed its signature | `imports` edit |
| `df9d5dc` new structural directive | ⚠ orphan input `IfAuthenticatedDirective.ifAuthenticated`; ⚠ orphan `ngOnInit`; ⚠ 3 components changed their signature | used as `*ifAuthenticated`; lifecycle hook (dependencies not installed); `imports` edits |
| `51c4afd` rewrite with signals | ⚠ orphan input `ArticlePreviewComponent.articleInput`; 38 user counts without templates | bound by `[articleInput]` in a parent template |
| `2faae23` markdown pipe made async | nothing | `MarkdownPipe.transform` went from `string` to `Promise<string>` (breaking); its only user is `article.component.html`, which had to add `\| async` |

**Goal:** a template is code: its edits are changes and its uses are uses. A1 makes a template see
its own component; A2 makes it see the other components, directives and pipes it uses.

#### What a template uses

| Template code | Example | Edge from the template | |
|---|---|---|---|
| A name on the component, in interpolation, property, event or two-way bindings, or as `this.x` | `{{ title }}` `[disabled]="busy"` `(click)="save()"` `[(ngModel)]="query"` | → `FooComponent.title` (reference), `FooComponent.save` (call); an inherited member → the base class's member | A1 |
| A chain through typed values | `auth.isLoggedIn()`; `item.reload()` inside `@for (item of items)` | → `AuthService.isLoggedIn` (call), as TypeScript resolves it. Interface members are not nodes, as in TS code. | A1 |
| Template locals: `let-x`, `#ref`, `@for`/`*ngFor` items and `$index`, `@let`, `*ngIf="x as u"`, `$event` | `@let total = items.length;` | none; a local hides a member of the same name | A1 |
| Host bindings | `host: { '(document:keydown)': 'onKey($event)' }` | from the class → `FooDirective.onKey` | A1 |
| An element matching a repo component's selector | `<app-article-preview>` | → `ArticlePreviewComponent` (call, like a JSX element) | A2 |
| An attribute or structural directive | `[appHighlight]`, `*ifAuthenticated="true"` | → `HighlightDirective` (call) | A2 |
| Its input and output bindings | `[article]="a"`, `(toggle)="…"`, `[(value)]="v"` | → `ArticlePreviewComponent.article`, `….toggled` (reference; aliases resolved) | A2 |
| A pipe | `body \| markdown` | → `MarkdownPipe` (call) and `MarkdownPipe.transform` (call) | A2 |
| A directive instance through a reference | `#p="appPreview"` … `p.reload()` | → `PreviewComponent.reload` (call) | A2 |
| Library directives and pipes | `ngModel`, `routerLink`, `\| async` | not resolved yet: their bindings count as plain element bindings; the expressions inside them still do | later |

#### The template is a symbol

- **ID**: an external template is `src/app/foo.component.html#(template)`, an inline one
  `src/app/foo.component.ts#FooComponent.(template)`. Kind `template`; its signature reads
  `template of FooComponent`. Like `#(module)`, the ID names a place, so an external template sits
  in its own file box, as the pull request lists it, and detectors that compare files see the
  `.html`.
- **Hashes**: no signature (nothing calls a template). The body hash comes from the parsed
  template, so whitespace between tags and inside expressions, comments and attribute quotes do
  not count (§6.3 for templates). `bodySize` counts its tokens, so a moved template
  (`foo.component.html` → `foo.html`, Angular 20's naming) is matched like any symbol.
- **Extraction**: a changed `.html` yields the templates of the components whose `templateUrl`
  points at it (none for `index.html`); a component's `.ts` file yields its inline template. An
  `.html` shared by two components is one symbol whose uses are resolved for each of them.
- **Relevance** (X1 `applies`, `matches`): the plugin applies to a revision that is an Angular
  project (the root `package.json` depends on `@angular/core`, or an `angular.json` exists), and
  then matches `.html` files, so template-only changes are analyzed. Without the plugin, `.html`
  edits keep today's early exit.

#### Resolving with TypeScript: template shims

The plugin translates each template into a small TypeScript function, a **shim**, returned as an
X1 virtual file next to its component; the adapter adds it to the program before the language
service starts (the program still never changes after loading). The shim's `this` is the component, template
locals become locals, and whatever CPR cannot type is `any`:

```html
<!-- article.component.html -->
<h1>{{ article.title }}</h1>
@for (comment of comments; track comment.id) {
  <app-comment [comment]="comment" (deleted)="onDelete(comment)" />
}
<button (click)="auth.logout()" [disabled]="isDeleting">Log out</button>
<div [innerHTML]="article.body | markdown"></div>
```

```ts
// src/app/article.component.html.cpr.ts (in memory)
import type { ArticleComponent as __C } from './article.component';
import type { CommentComponent as __D0 } from './comment.component'; // A2
import type { MarkdownPipe as __P0 } from './markdown.pipe'; // A2
function __template(this: __C) {
  this.article.title;
  for (const comment of this.comments) {
    comment.id;
    (null! as __D0).comment = comment; // A2: input
    (null! as __D0).deleted; // A2: output
    this.onDelete(comment);
  }
  this.auth.logout();
  this.isDeleting;
  (null! as __P0).transform(this.article.body); // A2: pipe
}
```

The plugin's `map` records where each name the shim emits came from (template file, line, column)
and which template owns it. Core maps shim positions back wherever the adapter reads positions
(X1), so the TypeScript side needs no Angular code:

- `incoming`: a reference inside a shim becomes an edge from its template, with its site in the
  `.html` (or in the inline template).
- `outgoing` of a template scans its shim like any symbol's body (its locals are skipped, as today).
- `dangling`: a name the shim reads on a typed receiver that no longer has it (`this.save()` after
  `save` was removed) is a use the compiler would reject → `removed-still-referenced`.
- Shim scaffolding (imports, the function) maps to nothing and is dropped, like import
  declarations today.

This reuses what TypeScript and CPR already do: inherited members, chains through services and
loop variables, package edges, and R1's class-family filter (`this` is the component, so a sibling
component's template reading a same-named member is dropped). The spike confirmed it on ts-morph:
`findReferences` for a base class method, a service method reached as `this.auth.isLoggedIn()` and
a method called on a loop variable all returned the shim's sites, and `this.gone()` resolved to
nothing on a `FooComponent` receiver.

Shims contain only what CPR understands; the rest is `any`, which resolves to nothing: no edge,
never a guess (`let-` variables of `<ng-template>`, library pipes and directives, `$any()`). A
template with syntax errors still gets a shim for the parts that parse, plus a warning.

#### Angular decorators: configuration is not contract

Every decorator argument is part of a class's signature hash today, so editing
`@Component({ imports })` reports a changed signature and warns about the module or routes that use
the component. The plugin claims the decorators imported from `@angular/core` (X1
`decoratorArguments`):

| Decorator | Signature (what templates depend on) | Body | Neither |
|---|---|---|---|
| `@Component`, `@Directive` | `selector`, `exportAs`, `inputs`, `outputs`, `standalone` | the rest: `templateUrl`, `imports`, `providers`, `host`, `styles`, `changeDetection`… | `template` (its own symbol) |
| `@Pipe` | `name`, `standalone` | `pure` | |
| `@NgModule`, `@Injectable` | | every argument | |

Member decorators (`@Input('alias')`, `@Output()`) stay in the member's signature: an alias or
`required: true` changes what templates must write.

Angular calls some members by name, so they are not orphans when added: lifecycle hooks
(`ngOnInit` … `ngOnDestroy`, with or without `implements`) of a class with an Angular decorator,
and `@HostListener`/`@HostBinding` members. The plugin gives them the exposure `framework` (X1
`exposure`), which `orphan-added` skips like `override`. Templates are never orphans.

#### Findings with templates

| Rule | With templates |
|---|---|
| `orphan-added` | Template and host uses count; `framework` exposure is skipped; templates are not reported. |
| `removed-still-referenced` | A shim's dangling site counts, from its template (error). A2: a removed component, directive or pipe whose element, attribute or pipe name a head template still uses (Angular rejects it at build) → error; a removed output still listened to → warning (the compiler allows unknown events, so it fails silently). |
| `signature-changed` | Template users are users, and updated when their template changed in this change. "Another file" is the template's file: an untouched external template makes a breaking change a warning (§8), an inline one in the changed file does not. |
| `exported-api-changed` | Unchanged. |

#### Parser

`@angular/compiler` (pure ESM, depends only on `tslib`, 4.9 MB) is Angular's own parser and
binder (`parseTemplate`, `R3TargetBinder`), so templates read exactly as Angular reads them: block
control flow, `@let`, `@defer`, ICU messages, structural micro-syntax.

- **Pinned to 21.2.x**: 22.x requires Node ≥ 22.22.3, and CPR supports 22.12. A dependency of
  `@cpr/plugin-angular` only, imported when the plugin runs on an Angular revision (77 ms).
- **Syntax by the project's Angular version** (`@angular/core` in package.json or `node_modules`):
  17 and later → block syntax and `@let` on; older → both off. Never block syntax with `@let` off:
  the parser loops forever on `@let x = 1;` in that mode (found in the spike).
- **Parse errors** → a warning (`src/app/foo.component.html: template has syntax errors;
  references may be missing`); the hash falls back to whitespace-normalized text.

#### Graph contract

X1's schema 0.5.0 covers it: node kind `template`, edge sites in `.html` files, `plugins` listing
`angular`; no new edge kinds. The viewer labels template nodes; their per-symbol diff and comments
go through the existing source access (a node's file is already allowed). Summary line: `M  src/app/foo.component.html` / `~ template  of
FooComponent  (body)`.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| X1 | Plugins | The TS adapter's plugin hooks (`applies`, `matches`, `virtualFiles` with position maps, `extract`, `decoratorArguments`, `exposure`, `warnings`); `createTypescriptAdapter({ plugins })`; `--plugin` and `cpr.config.json`; plugin resolution, API version check, failure isolation, the Angular hint; schema 0.5.0 (`template`, `framework`, `plugins`); CI inputs; a fixture test plugin. No Angular code. |
| A1 | Angular plugin: templates see their component | `packages/plugin-angular`; Angular project detection; component metadata (`templateUrl`, inline `template`, `host`); template symbols, hashes and `.html` relevance; shims for names on the component, chains, locals and host bindings; shim position maps; the decorator split; `framework` exposures; viewer and summary labels for templates. |
| A2 | Angular plugin: templates see other components | Directive, component and pipe metadata from repo decorators: selectors, `@Input`/`@Output`, `inputs`/`outputs` arrays, signal `input()`/`input.required()`/`model()`/`output()`, aliases, inputs inherited from base classes. Selector matching with the compiler's `SelectorMatcher` over the repo's directives; shims for elements, directives, inputs, outputs, two-way bindings, pipes and `#ref="exportAs"`; removed components, pipes and outputs still used. |

A2 matches globally over the repo's directives, without NgModule or standalone scopes: a compiling
app can only use what its scope offers, so global matching over-reports only when two directives
share a selector. Two **components** matching one element cannot both be in scope (Angular rejects
that), so their edges are marked `possible`.

#### Verification

1. **Fixtures** `angular-templates` (A1) and `angular-bindings` (A2), each case with its expected
   result.
   - A1: a method used only from `(click)` (not an orphan); a method removed while the template
     still calls it (error); a template-only edit (template modified); a reformatted template (no
     change); `@for`, `@let`, `let-` and `#ref` locals named like members (no edge); an inherited
     member (edge to the base member); a service chain (`auth.isLoggedIn()`); a sibling
     component's template reading a same-named member (dropped, R1); an `@Component({ imports })`
     edit (class body, no `signature-changed`); `ngOnInit` without `implements` (not an orphan); a
     `host` listener; an inline template; an Angular 11–style project with a literal `@` in text
     and `@let` text; a template with a syntax error (warning, the rest analyzed).
   - A2: an input renamed while a parent template still binds it (error); an output removed while
     still listened to (warning); an input's type changed with the parent template untouched in
     another file (warning); a pipe whose `transform` changed; a structural directive
     (`*ifAuthenticated`); `#p="appPreview"`; two components with one selector (possible); signal
     inputs and aliases.
2. **Without the plugin, no change**: every existing golden graph stays byte-identical, and ky,
   zod, vite and RealWorld results are the same as before X1. **With the plugin on a non-Angular
   repo**: no change either (`applies` is false).
3. **RealWorld commits**, expected afterwards:

   | Commit | Expected |
   |---|---|
   | `438e991` | 14 templates modified, no findings |
   | `c80e51b` | 2 templates modified |
   | `857a75e` | header template modified and using `authState$` (no orphan); `HeaderComponent` changed its body only (no `signature-changed`): 2 → 0 warnings |
   | `5467760` | `ProfileComponent` body only; 2 templates modified: 1 → 0 warnings |
   | `df9d5dc` | A1: the 3 `signature-changed` and the `ngOnInit` orphan are gone; A2: `ifAuthenticated` is used by `*ifAuthenticated` (no orphan), and the removed `ShowAuthedDirective` had template users that moved to the new directive: 5 → 0 warnings |
   | `51c4afd` | A1: the inline template edit is a template change, not the class's; A2: `articleInput` is bound by `[articleInput]` (no orphan), user counts include templates |
   | `2faae23` | A2: `MarkdownPipe.transform` changed its signature (breaking); its only user, `article.component.html`, was updated (info). Without that template edit: a warning. |

   Plus one experiment per rule: the template edit of a real commit reverted (a removed method
   still called, an input renamed, the pipe changed without `| async`), each expected to report.
4. **Bitwarden clients** (large): 10 recent commits that touch templates, time per commit before
   and after (budget: templates add at most 20 % to load time), every new or vanished finding
   inspected. Lever if over budget: shim only the changed templates and those mentioning a name
   declared in a changed file (known before loading).
5. **Viewer e2e**: a template node opens its `.html` diff; a comment on a template line posts to
   that file.

**Risks**

| Risk | Mitigation |
|---|---|
| A wrongly typed shim creates a false edge or a false error | Shims hold only names the binder resolved to the component, typed locals and (A2) matched directives; everything else is `any`. One fixture case per construct. |
| The compiler hangs or throws on odd input | Never the hanging option combination; parsing in try/catch with a warning; the `@let`-in-Angular-16 fixture. |
| Large apps: shims add one file per template to the program | 1.8 s per side to parse and bind 1,188 templates; the Bitwarden budget check; the name prefilter as lever. |
| Angular adds syntax | Pinned compiler, upgraded deliberately against the fixtures; unknown syntax is a parse error and a warning, never a crash. |
| Global selector matching (A2) | Competing components are `possible`; scopes later. |

**Risk:** medium. The harmful outcomes are a false edge or a false error from a shim; "unknown →
`any` → nothing" and the fixtures guard against both. **Cost:** ~1–2 ms per template per side to
parse and bind, plus the shims' share of program load.

**Proposed decisions** (into §14 when they land):

| # | Question | Decision | Why |
|---|---|---|---|
| 20 | Where template uses come from | **A template is a symbol**: `<file>.html#(template)`, inline `<file>.ts#<Class>.(template)` | Template-only changes were invisible (14 templates in one commit); a template has its own changes, sits in its own file as the pull request shows it, and must be "the user" in findings. |
| 21 | How templates are resolved | **Generated TypeScript shims** in the analyzed program (X1 virtual files), not a resolver of our own | Reference search, R1's family filter, inherited members, chains and dangling detection then cover templates unchanged (confirmed in the spike); a resolver of our own would repeat each of them. |
| 22 | Template parser | **`@angular/compiler` 21.2.x**, pinned, lazy, syntax options by the project's Angular version | Angular's own parser: 0 errors on 1,212 templates from Angular 11 to 21. 22.x needs a newer Node than CPR supports. |
| 23 | Angular decorator arguments | **What templates depend on is signature, the rest is body** (claimed by the plugin) | 5 of the 9 false warnings on RealWorld commits were `@Component({ imports })` edits reported as signature changes. |
| 24 | Where framework support lives | **Plugins of the TypeScript adapter, loaded by the CLI on request** (`--plugin`, `cpr.config.json`); core offers generic hooks — virtual files with position maps, extra file types, decorator argument roles, exposures | The TS/JS analysis must be the same for every project and carry no framework dependency; the same hooks fit Vue or Svelte templates later. |

Not in A1–A2 (later): library directives and pipes (selectors, inputs and pipe names from the
`ɵdir`/`ɵcmp`/`ɵpipe` declarations in their `.d.ts`) and NgModule/standalone scopes;
`ngTemplateContextGuard` types for `let-` variables; host directives; templates built at runtime
or with `require()`; templates of other frameworks (Vue single-file components, Svelte), which the
same shim approach fits as further plugins on X1's hooks.

**Later:** more languages via adapters, a faster core (TS 7 adapter or Rust/oxc), self-hosted team mode.

### Phase 1 milestones

| # | Milestone | Output |
|---|---|---|
| M0 ✅ | Scaffolding | pnpm workspace, TS strict, vitest, eslint, prettier, CI on push |
| M1 ✅ | Git layer | ref resolve, merge-base, changed files, worktree cache |
| M2 ✅ | Extraction | symbol IDs + both hashes, fixture tests |
| M3 ✅ | Diff + moves | change classification, exact move matching |
| M4 ✅ | References | incoming/outgoing edges, alias resolution, context nodes |
| S1 ✅ | TS 7 spike | Prototype adapter on `typescript/unstable/sync`; compare speed and results with ts-morph on fixtures and dogfood repos |
| M5 ✅ | Detectors | the three v1 rules |
| M6 ✅ | Output + CLI | graph JSON v0.1, human summary, `--fail-on` |
| M7 ✅ | Dogfood | measured runtime + false-positive notes on 3 repos |

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
| 5 | Worktree cache location | **`$XDG_CACHE_HOME/cpr`** (outside the repo) | Worktrees inside the repo would be picked up by tsc, eslint, test runners and file watchers. |
| 6 | Minimum Node | **22.12** | Node 20 is EOL; Vitest 5 requires ≥ 22.12. CI runs Node 22 and 24. |
| 7 | TypeScript for our own code | **6.0.x**, not 7 | TS 7 (the Go port) is `latest`, but typescript-eslint supports `<6.1`. ts-morph bundles its own compiler, so the engine is unaffected. Revisit when lint tooling supports 7. |
| 8 | Compiler behind the engine | **ts-morph (bundles TS 6.0)** for v1; TS 7 adapter as spike S1 after M4 | TS 7's compiler API is `unstable` and ts-morph doesn't support it yet. The adapter boundary lets us swap later. |
| 9 | After spike S1 | **Stay on ts-morph for v1** | TS 7 matched results (99.9 % of use sites) and loaded 4–7× faster, but reference search was only 1.6–3.5× faster over IPC, the API is unstable, and an adapter means porting extraction and hashing to a new AST. See [spikes/ts7](../spikes/ts7/README.md). |
| 10 | Signature-change severity | **By compatibility and reach**: warn only for possibly-breaking changes with untouched users in other files | Dogfood on ky/zod: adding an optional field to an interface warned on every type user. Same-file users are already in the line diff. |
| 11 | Type inference cost | **Infer only for symbols whose syntax changed** (two-pass extraction), truncate long type text | Inference was 75 % of extraction on zod. A drifted inferred type of an unchanged symbol is covered by the callee's own finding. |
| 12 | What to load | Ignore `examples/` and `playground/` by default (also for loading); without a root tsconfig, load the configs below it instead of every file | vite: 2,724 → 932 program files, 15–20 s → 4.5–7 s per commit. |
| 13 | Where a symbol's comment goes | **Its first added line, else its first removed line**; the reviewer can pick another +/− line; no changed line (moved unchanged, context, classes) → quoted in the review summary | Forges accept inline comments only inside diff hunks; changed lines always are, unchanged lines of a long symbol may not be. |
| 14 | GitLab "request changes" | **A note marked "Changes requested" + withdraw own approval** | GitLab's REST API has no stable request-changes call; this keeps the MR unapproved by the reviewer and says why. |
| 15 | When a finding counts as "already posted" | **Same rule and symbol** (a hidden `<!-- cpr:finding … -->` marker), not the same wording | A finding's message changes as callers come and go; reposting it on every push would bury the thread. Resolved findings are not withdrawn. |
| 16 | Where a posted finding goes | **The first changed line of its symbol per `git diff -U0`**, head side first, else base (removed symbols); else the summary | The forge's diff is git's, so its changed lines are always commentable; if the forge still refuses, everything is posted in the summary instead of failing the CI job. |
| 17 | Where review state lives | **In the CLI's cache, per change request** (`/api/state`); browser storage only for dropped graph files | Each run takes a free port and browser storage is per origin, so marks kept in the browser vanished on the next run. Per change request (not per head) so a new push keeps the review. |
| 18 | GitLab CI without a token | **Read the MR from the pipeline's variables; report findings as Code Quality** | The job token can fetch the repository but cannot comment (and may not read merge requests); asking every project for a token before CPR shows anything is a poor first run. |
| 19 | Who uses a class member | **Code that could run on an instance of its class** (R1): the object's class is the member's class, a subclass (use), an ancestor or interface (possible use), or unknown (kept); siblings are dropped; declarations become `overrides` edges | The language service answers rename questions, so it returns the whole class family: on an Angular app every `ngOnInit` "used" every other, and a property override listed every sibling's `this.prop`. |
