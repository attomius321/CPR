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
| `packages/plugin-angular` (X1–A2) | Angular templates, as a plugin the CLI loads on request | `@angular/compiler` (types from `@cpr/core`) |
| `packages/plugin-qwik` (Q1–Q2) | Qwik routes, `component$` props and MDX routes, as a plugin | none (types from `@cpr/core`) |

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
| **Generated files, fixtures** | `.d.ts` and `*.min.js` are never extracted. Changed files under `fixtures/`, `__fixtures__/`, `__snapshots__/`, `generated/` or named `*.generated.*` are listed as `(ignored)` but not analyzed; a root `.cprignore` adds or removes patterns with gitignore's rules (a pattern matches at any depth unless a `/` at its start or middle anchors it, `dir/` matches folders and what is inside, `!` re-includes). It is read from the working folder, not from the analyzed commits (a fix after the Angular trial). |

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
| P1 (measured, not pursued) | One program for both sides | Measured (journal, "P1 measurement"): loading is 62–79 % of a run and CPR's own work 2–4 %, but what both sides can safely share is lib and `node_modules` files (vite ~25–30 % faster, Bitwarden ~15 %, zod little); sharing project files needs both worktrees under one virtual path. Decided against for now: the gain does not justify replacing the ts-morph loader. Revisit with a TS 7 adapter, where loading is several times faster anyway (S1). |
| C3 | GitHub annotations | Fork PRs get a read-only token, so nothing is posted; `::warning file=…,line=…::` workflow commands show findings inline without one (GitLab already has Code Quality). |
| D1 ✅ | Detectors from real reviews | `signature-changed` tells test users from production users (only untouched production users elsewhere make a warning); new `exported-api-changed` for a published package's API removed, unexported, or broken. See §8. |
| X1 ✅, A1–A2 ✅ | Plugins; Angular templates as the `angular` plugin | Templates call component methods, bind inputs and use pipes, and CPR saw none of it: 9 of 9 warnings on real Angular commits were false. Angular support must stay outside the TS/JS analysis: X1 adds plugin hooks, A1–A2 build the Angular plugin on them. Merged with PR #1; see below. |
| A3 ✅ | Angular library components, directives and pipes | `async`, `date`, `ngModel`, `routerLink` and Material were plain bindings, and a library pipe's result untyped: links through `@if (x$ \| async; as x)` were lost (19 such blocks in Bitwarden's web app). Now read from installed packages' typings; see below. |
| V6 ✅ | A graph you can navigate | On a large change the viewer drew 1,288 symbols for 86 changes, in a 9,470 × 85,468 px strip, and every click re-ran the layout. Now: big neighbourhoods as one node, a page of clusters, a map when zoomed out, no relayout while reviewing; see below. |
| W1 ✅ | Repositories with several projects | A repo whose Angular apps live in subfolders (two apps, two levels deep, nothing at the root) got no template analysis at all, and its `@app/*` and `baseUrl` imports did not resolve. Now each file resolves with its own project's options, and the Angular plugin works per app; see below. |
| Q1 ✅, Q2 ✅ | Qwik as the `qwik` plugin | Qwik is TSX and mostly reads right, but what its router calls by name (`onGet`, `head`, loaders, actions) shows as false orphans, an optional prop added to a `component$` is a warning, a required one added to a named props type is missed, and components used only from `.mdx` routes look unused. Planned; see below. |
| V7 ✅ | Apps in the graph | In a monorepo the viewer shows no boundary between apps: file boxes by path, placed by calls, a flat change list, and no project in the graph JSON. Bitwarden changes span 4–16 projects, with 16–45 % of drawn edges crossing them. Planned: projects in the graph, a frame per project, a change list by project; see below. |
| E1 (measured) | Decisions and their ripples | Could mechanical parts of a change (renames and their call sites, moves, a new argument everywhere, the same edit repeated) be verified instead of read? Measured on 165 changes: 20 % of changed symbols but 5.4 % of diff lines (2.8 % without one large rename); 0 false in 40 audited. Not the disruptive lever; grouping repeated edits in the change list is a candidate. See below. |
| V8 ✅ | A smooth viewer | Reported "flaky and laggy". Measured: Qwik `f7ed58cfc` blocks 603 ms zooming out and 731 ms over 8 j steps, a context toggle freezes it 769 ms; 9–23 % of map clicks on files zoom into the whole project. Causes: a zoom variable restyling the page each frame, per-frame checks of every edge, whole-list re-renders, layout on the main thread. Closed: V8a–V8c and V8e merged (on Qwik: zoom out 466 → 15 ms blocked, opening 2,568 → 620 ms, map clicks reaching the file 87 → 100 %); V8d deferred; see below. |
| V9 ✅ | Pick two commits | `cpr view` without arguments is a usage error; another pair means stopping and running again. Merged: the current branch's commits as `cpr view`'s first page (100 rows in under 1 s on Qwik), pick two (or one against its parent), the diff analyzed on demand in a child process (Bitwarden 42 s, within 10 % of `cpr diff`; the server answers in 2 ms meanwhile), the last 8 kept. See below. |
| V10a ✅, V10b–c | A commit graph | The commits page was a flat list of the current branch: on CPR and Qwik, 66 and 57 of the first 100 rows came from merged branches with nothing telling them apart, and other branches were not listed (1,539 unmerged on Bitwarden). V10a merged: every branch's history as a graph, lines over 100 rows as arrows (Bitwarden 20 lanes, 142 drawn whole), loaded lazily (CPython's 150,182 rows: first rows in 120 ms once listed). V10b and V10c on their own rows below. See below. |
| V10b ✅ | Branches panel | A branch can only be found by scrolling: tips sit deep (median row 155 on this repository, 9,165 on Bitwarden; 4–74 tips per repository in the first 200 rows), and Bitwarden has 1,591 remote branches, 519 in no folder. Planned: a panel left of the graph — Local with ahead/behind, Remotes by nested folder, a filter, review marks — whose click goes to the tip's row anywhere in the history (`/api/history/refs` gives the rows). Merged: on Bitwarden the panel draws 1,591 remote branches 44–61 ms after the first rows and a click reaches the deepest tip (row 37,633) in 89–94 ms; badges now shrink, so rows keep their date beside it. See below. |
| V10c ✅ | Picks across branches | Two picks on diverged branches are compared directly: the other side's work shows as reverted (HEAD against unmerged branches: 67–96 % of the direct diff's files are not the branch's; Qwik: 43 files, 6 removed symbols, against the branch's 7 files, 0 removed), and the lower pick, today's base, is the branch in 71 of 71 such pairs. Merged: compared from the fork point, found in the page (agrees with `git merge-base` and `rev-list` on 5,983 of 5,983 random pairs in six repositories, 157 of them with no shared history); the default branch's pick as the base (the branch as head against 1,868 of 1,868 diverged remote branches); the label, the fork marked, Swap; through `cpr view`, 12 of 12 graphs equal `cpr diff A B`. See below. |
| V11 ✅ | Checkout from the commits page | The commits page showed every branch but checked nothing out, and did not notice a checkout made in a terminal (it showed the old HEAD until reloaded). Merged: a row menu (right-click, "⋯", c) checks out a branch, a remote branch as its tracking branch, a tag or the commit, after a confirmation; `git switch` never forced, git's refusals shown; the page lists anew after a checkout (109–115 ms on this repository) and on focus; HEAD stands out (solid "HEAD → main" badge, tinted row, ringed dot, a title chip). See below. |
| V12 ✅ | Open in VS Code | The diff panel shows a symbol's lines, but going there in the editor is done by hand, and head's line number is not the working copy's: reviewing anything but the checked-out commit, 1–62 % of added lines sat at another line and up to 23 % were changed since (CPR, ky, zod). Merged: "Open in VS Code" (or `o`), Ctrl/⌘+click or a line number opens the line in the window that has the repository open (else a new one with it), at its place in the working copy; the server runs `code <repo root> --goto <file>:<line>:<col>`, found on any platform. 105 ms from the request to VS Code here. See below. |
| V13 ✅ | Compare mode | The commits page opened as V9's picker: "Pick two…" leads the help line, every row has a pick circle (24 px), a bar holds a disabled Compare (52.6 px, 1.6 rows), and a click picks: three clicks to look at rows leave a pair picked and a comparison ready (CPR, Qwik, Bitwarden). Merged: browse by default (a click selects the row; 25 rows in view instead of 23 at 1440 × 900), and a "Compare mode" toggle (or `x`) for picking, left with Escape; first rows as fast as `main`. See below. |
| V14 ✅ | Checkout submenu | The row menu lists every target as a sentence: on Qwik's HEAD row 10 entries, each starting "Check out", 8 ending "(detached HEAD)", 480 px wide (its max); a remote branch's entry is 117 characters. The names are plain text mid-sentence, while the rows draw them as coloured badges. Merged: "Check out ▸" with the targets in a submenu on hover (or c), each name as the row's badge with a muted note (Qwik's HEAD row: 10 badges in a 368 px column); the confirmation's heading with the name as a badge. See below. |
| V15 ✅ | Branch reviews in the repository | Outside `cpr pr`, marks are kept per pair of revisions in CPR's cache: when an agent adds a commit, the pair is new and the marks start empty, on one machine. Measured on this repository's agent-written branches: per branch, 97.7 % of marks would still be valid after a new commit (1,027 of 1,051), and 170 symbols left to look at instead of 1,197. Merged: "Review ▸" in the row menu (or r) compares a branch's fork point with its tip, marks kept across new commits (on a clone, 83 of 83 after one more commit, 2 symbols left); reviews in `cpr/reviews/<branch>/<reviewer>.json`, out of git by default (`cpr/.gitignore`), shared by deleting that file; "✓" or "+n" on reviewed branches' badges, a dot on commits added since. See below. |
| V16 ✅ | Finish a review | A branch review has no end: outside `cpr pr` the reviewer can only mark symbols (the reviewer's V15 review: 86 of 87 marked, 0 comments, none possible), feedback to the agent goes through chat without a place, badges show no outcome, and approved work is pushed by hand. Merged: comments and the Review tab on branch reviews; Approve, Request changes or Comment recorded with its comments in the review's JSON ("✓", "✗", "+n" on badges); Approve pushes the reviewed commit, by SHA; the default branch reviewable from where it was last pushed; `cpr pr` unchanged. See below. |
| V17 ✅ | Approve means "merge it" | Approve pushes the reviewed commit, which did nothing on 0 of 4 approvals here (the agent had pushed), while every approval was followed by asking for the merge in chat; merging the default branch into a reviewed branch shows "+6" for one commit; agents elsewhere get no instructions. Merged: Approve records the commit and the default branch to merge into, nothing pushed; "since" counts the branch's own commits; the Review tab says whether the merge will conflict; CPR writes `cpr/AGENTS.md` for any repository's agent (a headless Claude Code agent followed it: merged exactly the approved commit; on a conflict, resolved on its branch and asked for another review). See below. |
| V18 ✅ | Start a feature | The commits page starts nothing: starting an agent on a feature is a terminal job — a branch and worktree by hand (12 ms on ky to 0.85 s on Bitwarden), Claude Code's own worktrees inside the checkout (ignored by 0 of 6 clones) and from the remote default branch, `claude --bg` refused by a trust step a script cannot take (3 of 3 folders), and nothing ties an agent to its branch. Planned: "Start a feature" (header, `n`, a row's menu): a brief, a branch at the chosen commit with its own worktree beside the checkout, the agent started in the background (Claude Code, or a configured command), its state on the branch's badge and in a features view (decisions 105–106), each leading to the other, plan first per feature; reviews and merges as V15–V17. V18a–c merged into main (2026-10-15): a feature from the header or a row, its worktree and agent in 0.1–0.9 s on the six clones, the checkout untouched; the features view with each agent's state; since V18c, the picked feature's panel beside the list with its thread, recorded by hooks CPR gives each agent (22–23 ms per event), and one box that continues the agent's session (stop, then resume: 1.6 s with a real Claude Code), Send the verdict, Clean up. See below. |
| V20 | Other agents | Was V18d–e. V20a: Codex, picked in the start dialog — measured with Codex 0.163, it cannot commit in a CPR worktree from its sandbox (git's folders are in the main checkout's `.git`, 3 of 3 runs) and `exec resume` keeps none of the start's options; merged (2026-10-19): `codex exec --json` detached through a runner that records the thread, its branch's git folders writable on every run, replies by `exec resume`; with a real Codex, a workspace started from the dialog planned in 10.7 s, and after a reply (in the thread 0.3 s after Send) committed on its branch from its sandbox, ready for review 25 s later. V20b (answers in CPR) dropped (decision 163): the panel's terminal answers them (V21, V27b). V20c: any configured agent command, and `.worktreeinclude`. See below. |
| V21 ✅ | The agent's terminal in its panel | A feature's agent is talked to in V18c's box (a reply stops the session, 1.6 s, and loses a turn in progress) or in a terminal elsewhere (Talk copies `claude attach`). Measured (V21 spike): `claude attach` in a pseudo-terminal, drawn by xterm.js in the page, gives the whole session — first output in 152–174 ms, a key to its echo 22 ms, a permission answered in the page, Esc, messages queued while the agent works — while Claude Code keeps hosting it and CPR's hooks keep recording. Planned: Terminal in the feature's panel (node-pty optional, Talk without it), output as events and keys as POSTs under the write rule, one terminal per open panel, dark in both themes; and the state after Esc (`idle` with `working`), wrong on `main` today. Merged (2026-10-18): with a real Claude Code, the session drawn and answered in the panel, Esc read as "Interrupted" 0.3 s later, a stop shown and reopened in 0.2 s; a key to its echo 32 ms through CPR. See below. |
| V22 ✅ | Fixes: stale text outside the README | Found while rewriting the README (`chore/update-readme`, 2026-10-15). `cpr --help` and `cpr view --help` say the first page lists the current branch's commits (every branch since V10a); `@cpr/cli`'s description names only `cpr diff` and `cpr view`; the action's `plugins` input points to `cpr.config.json`, the older place; the sidebar's "No findings." ends with an emoji. Merged: all four fixed, and `cpr --help`'s `pr <number>` shown as optional (it has been since C1); a unit test keeps the help on every branch. |
| V23 ✅ | Branches that need you, first | Planned as V22, which `main` took meanwhile. The branches panel lists Local by name after the checked-out branch: a feature's branch sits where its name falls (on this repository a `milestone/…` feature would be the 23rd of 23 local branches), and nothing says which agent acted last. Claude Code lists a session's start only; CPR's thread has a time for every report and question. Planned: in Local, the features that need you first, the one whose agent acted last on top, then those whose agent works, then the rest as today; each feature with how long ago its agent acted. Merged (2026-10-18): on a clone of this repository with three open features, they are the first three entries instead of the 4th, 10th and 12th; `/api/features` unchanged (34 ms), each thread read from its last 256 KB (0.6 ms at any length). See below. |
| V24 ✅ | A structured brief | The "Start a workspace" dialog is one text area that is also the branch name and the workspace's name; every branch is `feature/`, while 11 of this repository's 35 merges were fixes or chores; nothing prompts for how done is checked, which every agent vendor's guidance asks for. Planned: a kind (Feature, Fix, Refactor, Chore, Spike), a title, one required part per kind, an optional Done when filled in with a check command guessed from the repository's root files (on 16 repositories: 13 the documented command, 2 heavy, 1 close, 0 wrong), optional parts under More, assembled by the server into a brief with Markdown headings; the kind's branch prefix; old workspaces unchanged. Merged (2026-10-19): the guess on 16 repositories gives the 16 planned commands in 13–17 ms; the dialog fits at 1440 × 900 and 390 × 844; a real Claude Code's plans follow each kind's line. See below. |
| V25 ✅ | Workspaces first, History beneath | `cpr view` opens on the commits page (`/`) and Workspaces is the second tab. A diff's way back is "← Commits". The code says "feature" for a workspace 1,949 times (12 files, `/api/features`, `cpr/features/`), and since V24 "feature" is also a kind of work. Planned: `/` Workspaces, `/history` History (today's commits page), tabs "Workspaces · History", old addresses rewritten, a back link to where a diff came from; "workspace" in code, API and on disk (`cpr/workspaces/`, moved once from `cpr/features/`); the kind "feature" kept. Merged (2026-10-19): 801 unit tests, 114 e2e; first paint of `/` as `main`'s `/workspaces` (109 ms); a repository's old records moved by the first reader. See below. |
| V26 ✅ | A merger | An Approve is a note for the branch's agent (V17), whose context is 66K–474K tokens and whose linked worktree cannot merge: the merge comes back to the person. Measured: of the last merges, 11 here, 21 on Bitwarden and 7 on Qwik conflicted; "keep both" for additions that do not overlap was right on 7 of 7 and refused 5; the other conflicts are 0.6K–5.8K tokens of regions. Merged (2026-10-20): V26a, Merge into ▾ after Approve, CPR merges in its own worktree, runs the check, lands by fast-forward, `cpr merge`; V26c, a fresh agent for every conflict, from the conflict alone, every resolution reviewed. V26b (keep both by rule) dropped (decision 164): every conflict goes to the agent. See below. |
| V27 ✅ | Codex in the panel's terminal | A Codex workspace has no terminal (decision 133): `exec` turns are recorded by CPR's runner, and a terminal's would not be. Spike: Codex 0.163's app-server daemon is the binding — CPR as a client starts the thread, a TUI joined with `codex resume --remote` reaches CPR (every item, 3.0 s) and shows CPR's turns (0.9 s), turns outlive the client and come back with `thread/read`, and approvals give "needs you". Merged (2026-10-20). V27a: Codex workspaces on the person's daemon — with the real Codex, started in 1.8 s, committed from its sandbox, a message joined its running turn (in the thread 0.8 s after Send), a turn outlived a `cpr view` restart, an approval read "Waiting: approval prompt"; `exec` without a daemon. V27b, Codex's terminal tab: the panel opens on Codex's own TUI on the thread (trust asked there, said by the panel first), a turn typed there in the thread 128 ms after Enter, an approval answered there cleared "needs you" in 22 ms, Stop ends the turn and its commands (45 ms; V27a's left them running), the list read while a terminal is open; any writable start makes Codex trust the repository (since V20a), now said. See below. |
| V28 (built, not merged) | Every agent's prompts in the project's settings | CPR writes all 13 texts its agents are told (a start prompt per kind, the two plan sentences, the verdict's 4 sentences, `cpr/AGENTS.md`, the merger's instructions), and a project can change none of them; `cpr/merge.md` only adds to the merger's. This repository's own rules disagree with the Spike prompt. Planned: each prompt whole, with placeholders and CPR's text as its default, changed on a Settings page and saved under `prompts` in `cpr/config.json` (shared once committed); written with `jsonc-parser` so the rest of the file stays byte for byte (a `JSON.stringify` rewrite failed this repository's `pnpm check`); with no `prompts`, today's prompts byte for byte. See below. |

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
`interfaces/` matching at any depth, decorator-only class changes treated as compatible. (Since
done: templates and decorators in A1–A2, `.cprignore` in a fix of its own; see the journal.)

### X1 — Plugins

**Status:** merged into main (PR #1, 2026-10-02). The
contract below is as built; "As built" at the end lists what changed from the first sketch.

**Why.** Framework knowledge — Angular templates now; Vue or Svelte templates, NestJS conventions
later — must not live in the TypeScript/JavaScript analysis. That analysis stays the same program
for every project and carries no framework dependency; a framework comes as a **plugin** that the
CLI loads only when asked. Without plugins, CPR behaves exactly as it does today.

**What a plugin is.** A JavaScript module exporting one plugin object. A plugin *extends* the
TypeScript adapter at fixed points; it never replaces it, and it sees TypeScript's own objects
(program, checker, nodes). The contract, exported by `@cpr/core`
(`packages/core/src/lang/typescript/plugins.ts`):

```ts
interface TsPlugin {
  name: string;                          // "angular"
  version?: string;
  apiVersion: 1;                         // PLUGIN_API_VERSION
  /** Whether it applies to this revision (checked per side: base may predate the framework). */
  applies: (revision: PluginContext) => boolean;
  /** Extra files whose changes it analyzes, besides TS/JS (e.g. `*.html`). */
  matches?: (path: string) => boolean;
  /** In-memory TypeScript files added to the program before it is built (template shims). Runs
   *  before types exist: it sees the project's files and their syntax trees. */
  virtualFiles?: (revision: PluginContext) => VirtualFile[];
  /** Extra symbols in the given changed files (templates), with the nodes that stand for them
   *  (usually in a virtual file): their outgoing references are scanned there. */
  extract?: (revision: PluginRevision, files: readonly string[]) => PluginSymbol[];
  /** How a decorator's arguments count in hashes; undefined = as today (all signature). */
  decoratorArguments?: (revision: PluginRevision, decorator: ts.Decorator) => ArgumentRoles | undefined;
  /** Uses of removed symbols found by what they were, not their name (a removed component's
   *  selector in a template): needs the base revision too. Added with A2. */
  dangling?: (revision: PluginRevision, removed: readonly SymbolDecl[], base: PluginRevision) => Dangling[];
  /** Why a symbol may be used with no reference (a lifecycle hook → `framework`). */
  exposure?: (revision: PluginRevision, symbol: SymbolDecl) => Exposure | undefined;
  warnings?: (revision: PluginRevision) => string[];
}

interface PluginContext {        // before the program exists
  ts: typeof ts;                 // the adapter's own TypeScript: nodes match, no second copy
  root: string; packageJson: Record<string, unknown> | undefined;
  readFile(path): string | undefined; sourceFiles(): string[]; syntax(path): ts.SourceFile | undefined;
}
interface PluginRevision extends PluginContext {   // once it exists
  program: ts.Program; checker: ts.TypeChecker; virtual(path): ts.SourceFile | undefined;
}

interface VirtualFile {
  path: string;                          // src/app/foo.component.html.cpr.ts — never on disk
  text: string;
  /** Owner symbol and real site of a position in `text`; undefined = scaffolding (dropped).
   *  `possible`: a reference there may not be a use (two components on one element; A2). */
  map: (offset: number) => { owner: SymbolId; site: Site; possible?: boolean } | undefined;
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
- `angular` means `@cpr/plugin-angular`; a value starting with `.` or `/` is a path (flags
  relative to the working folder, the config relative to the repo root); any other value is a
  package name as given (`@acme/cpr-vue`). Packages resolve from the project first, then next to
  the CLI. Imported only when turned on: no plugin, no cost, no
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

**Results**: 1 — `packages/core/test/plugins.test.ts` (11 tests) runs the `.tpl` test plugin
over a fixture: template edges with sites in the `.tpl`, a template-only change analyzed, a removed
method its template still calls (error), no false orphans (`double` used by the template,
`onStart` called by the framework) and no false `signature-changed` from a configuration-only
decorator edit; the built CLI and viewer show the template node with its own diff. 2 — goldens
changed only `schemaVersion`; on the 29 R1 comparisons (ky, zod, vite, the Angular app) `main` and
X1 give identical edges (932) and findings (11); the Angular app prints the hint once on a
template commit. 3 — CLI tests cover a missing package, a missing file, a wrong `apiVersion`, a
module that is not a plugin and a broken `cpr.config.json`; a plugin whose hook throws leaves a
warning and the plain analysis.

**As built** (what differs from the first sketch, and where it lives)
- Hooks are function-typed properties: a plugin never relies on `this`. `PluginContext.ts` hands
  plugins the adapter's own TypeScript, so a plugin needs no TypeScript of its own and its nodes
  are the program's.
- `extract` returns `{ symbol, nodes }`: the nodes (usually the shim function) are where the
  symbol's outgoing references are scanned. `decoratorArguments` receives the revision too.
- Core (`lang/typescript/`): `project.ts` runs `applies` and `virtualFiles` before the language
  service starts, and refuses a virtual file whose path exists on disk or in the program or lies
  outside the root (warning). `mapVirtual` maps positions in `incomingTs`, `outgoingTs` and
  `danglingTs`; a declaration inside a virtual file is never an edge target. `extract.ts` skips
  virtual files, hashes claimed decorators by role and adds plugin symbols; `detectors.ts` skips
  the `framework` exposure.
- Failure isolation: every hook call, `map` included, goes through one guard; the first throw
  disables the plugin for that revision (its shims then map to nothing) and leaves one warning.
- CLI (`packages/cli/src/plugins.ts`): config plus flags, loaded once per file; two plugins with
  one name are refused; packages resolve from the project, then the CLI; the module's default
  export (or `plugin`) is validated before use.
- The reference for plugin authors is the test plugin
  [`tpl-plugin.ts`](../packages/core/test/helpers/tpl-plugin.ts): a made-up framework whose
  `@View({ template: './card.tpl' })` classes render `{{ expression }}` templates, using every hook.

### A1–A2 — Angular templates, as the `angular` plugin

**Status:** A1 and A2 merged into main with X1 (PR #1, 2026-10-02); results and "as built" at
the end of this section.

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

- **Pinned to 21.2.x** (21.2.25): 22.x requires Node ≥ 22.22.3, and CPR supports 22.12. A
  dependency of `@cpr/plugin-angular` only, loaded with the plugin, which the CLI imports only
  when asked for it.
- **Whitespace preserved** while parsing: collapsing it rewrites text nodes and shifts the
  offsets of interpolations; the hash normalizes whitespace itself.
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
| X1 ✅ | Plugins | The TS adapter's plugin hooks (`applies`, `matches`, `virtualFiles` with position maps, `extract`, `decoratorArguments`, `exposure`, `warnings`); `createTypescriptAdapter({ plugins })`; `--plugin` and `cpr.config.json`; plugin resolution, API version check, failure isolation, the Angular hint; schema 0.5.0 (`template`, `framework`, `plugins`); CI inputs; a fixture test plugin. No Angular code. |
| A1 ✅ | Angular plugin: templates see their component | `packages/plugin-angular`; Angular project detection; component metadata (`templateUrl`, inline `template`, `host`); template symbols, hashes and `.html` relevance; shims for names on the component, chains, locals and host bindings; shim position maps; the decorator split; `framework` exposures; viewer and summary labels for templates. |
| A2 ✅ | Angular plugin: templates see other components | Directive, component and pipe metadata from repo decorators: selectors, `@Input`/`@Output`, `inputs`/`outputs` arrays, signal `input()`/`input.required()`/`model()`/`output()`, aliases, inputs inherited from base classes. Selector matching with the compiler's `SelectorMatcher` over the repo's directives; shims for elements, directives, inputs, outputs, two-way bindings, pipes and `#ref="exportAs"`; removed components, pipes and outputs still used. |

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

#### A1 results

**Fixtures** (`packages/plugin-angular/test`, 8 tests): every A1 case listed above, plus a
generic component (`Table<T>`), a component that is not exported and a test host in a `.spec.ts`.
**Viewer e2e** (`e2e/angular.spec.ts`): `cpr pr --plugin angular` shows the finding naming the
template, opens the template with its own diff and posts a comment to line 5 of the `.html`.

**RealWorld commits**, without → with the plugin:

| Commit | Without | With `--plugin angular` |
|---|---|---|
| `438e991` | nothing (no TS file) | 10 templates modified; 2 warnings: two `@for` loops without `track`, which Angular rejects — the very bug `c80e51b` fixes. The other 4 changed `.html` files only switched to self-closing tags: no change, rightly |
| `c80e51b` | nothing | 2 templates modified; the missing `track` reported `in base:` only |
| `857a75e` | 2 warnings (orphan `authState$`, `HeaderComponent` signature) | 0; header template modified |
| `5467760` | 1 warning (`ProfileComponent` signature) | 0; 2 templates modified |
| `df9d5dc` | 5 warnings | 1 (`ifAuthenticated`, bound as `*ifAuthenticated`: A2) |
| `51c4afd` | 1 orphan, 38 infos | the class-level infos from inline-template edits are gone; `articleInput` (A2) and the members' own signal-type infos remain |
| `2faae23` | nothing | 2 changes (the template and `MarkdownPipe.transform`); the pipe link is A2 |

**Experiments** on `51c4afd`, each missed without the plugin: `deleteArticle()` removed while
`article.component.html` still calls it → ✖ error; `articlesConfig` renamed while the inline
template of a default-exported component still reads it → ✖ error ("ProfileArticlesComponent
template"); `removeTag()` given a second required parameter → ⚠ `signature-changed`, 1 of 1 user
not updated: `editor.component.html`.

**Bitwarden clients**, 10 recent commits that touch templates, one run each way:
- Time on the 7 commits analyzed either way: 225.8 s → 242.7 s, **+7.5 %** (per commit −11 % to
  +19 %: single runs are noisy). Under the 20 % budget, so the name prefilter is not needed yet.
- The 3 template-only commits were skipped before (0.5 s, nothing shown); now 27–31 s, each
  showing its changed template.
- Findings: 12 gone, every one checked and false — 5 class `signature-changed`/
  `exported-api-changed` from `imports`/`host` edits, 7 orphans read by templates
  (`[bitSubmit]="submit"`, `[rounded]="… && isMacOs"`, `[virtualRowHeight]="rowHeight"`), host
  bindings or lifecycle hooks. None new.
- Found on the way: a generic component's shim needs type arguments (`this: Table<any>`), or
  every name in its template resolves to nothing; 268 components in tests and stories are not
  exported, so their templates cannot be imported by a shim — skipped, warned about only outside
  tests and stories.

**No plugin, no change**: the goldens, and the 29 R1 comparisons (ky, zod, vite, the Angular app)
give the same edges and findings as before X1.

#### A1 as built

- `packages/plugin-angular` (`@cpr/plugin-angular` 0.1.0) depends on `@angular/compiler` only;
  `@cpr/core` is a dev dependency for types, and TypeScript comes from `PluginContext.ts`. The
  root `package.json` links it, so `--plugin angular` resolves from a checkout and in CI
  (`action/install.sh` installs the workspace).
- `classes.ts`: Angular classes by syntax — decorators imported from `@angular/core` (named,
  aliased or through a namespace), `templateUrl`, inline `template`, `host`,
  `@HostListener`/`@HostBinding` members, type parameters, how the class is exported.
- `template.ts`: parsing (cached by text, so base and head share most templates; a parser crash
  is an error like a syntax error); inline templates are parsed in place (`range`,
  `escapedString`) so spans are offsets in the `.ts`; the binder runs without directives (A2
  adds them); hash tokens.
- `expressions.ts`: Angular expressions as TypeScript. The binder resolves template locals;
  arrow-function parameters and `$event` it does not, so the plugin tracks them. `$any(x)` →
  `(x as any)`; pipes → `__cpr_pipe(…)` (A2 resolves repo pipes); assignments are `Binary`
  nodes in Angular 21.
- `shim.ts`: one block per view; `#refs` declared at the start of their view; `@for`/`*ngFor` →
  `for…of`; `@if`/`*ngIf` aliases → constants; other locals `any`; events →
  `($event: any) => { … }`; host bindings → `__cpr_host`, owned by the class.
- One shim per class: `foo.component.FooComponent.cpr.ts`, importing `./foo.component.js` (valid
  in every module resolution mode), with `__cpr_template` and `__cpr_host`.
- Template symbol: name `(template)`, signature `template of FooComponent` (a shared
  `templateUrl` is one symbol listing its components), constant signature hash, body hash from
  the parsed template. Labels: findings and the viewer call it by its file
  (`foo.component.html`) or `FooComponent template`; the summary prints `template of …`.
- Core, generic: `ts` types exported for plugins; a warning only the base revision has is
  prefixed `in base:` (a problem the change fixes is not one it brings).

#### A2 results

**Fixture** `bindings` (3 tests): a parent template that does not change while what it uses
does. With the plugin: a removed component still placed (`<app-badge />`) → ✖ error at the tag;
an input renamed while still bound → ✖ error; an output removed while still listened to → ⚠
(Angular accepts it and it never fires); an input's type changed → ⚠ `signature-changed`, the
untouched template not updated; a pipe's `transform` made async → ⚠ likewise; a new directive used
only as `*ifAuthenticated` → no orphan. Links: signal `input()` and `model()` (`[(selected)]`),
an alias (`[total]` → `count`), an input inherited from a `@Directive()` base, `#p="appPreview"`
… `p.reload()`, a repo pipe's `transform`; two components with one selector → both edges
`possible`. Without the plugin: none of the five problems, and one false orphan.

**RealWorld**, A2's share: `df9d5dc` 1 → 0 (`ifAuthenticated` is used as `*ifAuthenticated`;
the commit now has 5 → 0 warnings in all); `51c4afd` 1 → 0 (`articleInput` bound as
`[articleInput]`); `2faae23` `MarkdownPipe.transform` changed its signature (breaking), its
only user `article.component.html` updated → info. Experiments, each missed without the plugin:
the `| async` of `2faae23` taken out of the template → ⚠ "1 of 1 user not updated:
article.component.html"; `articleInput` renamed while `ArticleListComponent`'s inline template
still binds it → ✖ "articleInput was renamed to articleValue, but 1 symbol still uses the old
name".

**A core gap found on the way**: a *renamed* symbol (same body, new name: a move) was not checked
for users of its old name at all — in TS code too (`computeTotal` → `sumPrices` with a caller
left on `computeTotal`: no finding). Now the old declarations of moved and renamed symbols go to
`dangling` with the removed ones, and `removed-still-referenced` reports them under the new
symbol: "… was renamed to …, but N symbols still use the old name" (or "moved to …, … the old
place"). The 29 R1 comparisons are unchanged by it (code that compiles has no such uses).

**Bitwarden** (the same 10 commits, each run without and with the plugin back to back):
- Time on the 7 commits analyzed either way: 214.2 s → 254.3 s, **+18.7 %** (per commit +8 % to
  +29 %), inside the 20 % budget. The plugin's own JavaScript (parsing, binding, shims) is
  ~1.6 s per run; the rest is TypeScript checking ~1,200 shims and their imports. A1 alone was
  +7.5 %. Fixed on the way: the plugin's per-revision cache missed after the program was built
  (core handed plugins a new context), so every class was scanned twice per side (extract
  430 → 32 ms).
- Findings: the same as with A1 (12 false ones gone, none new). Links: one commit (`6d07b79`,
  the 1Password import dialogs) has 94 template edges into other files — the 5 templates that
  place `<tools-import>`, and Bitwarden's own components and directives (`bitSubmit`, callout,
  card…).

#### A2 as built

- `classes.ts` also reads `selector`, `exportAs`, `@Pipe({ name })`, `inputs`/`outputs` arrays
  (`'name'`, `'name: alias'`, `{ name, alias }`), `@Input`/`@Output` with an alias (string or
  `{ alias }`), signal `input()`, `input.required()`, `model()` (input `x` and output
  `xChange`), `output()`, `outputFromObservable()`, the `extends` base and whether the class
  injects `TemplateRef` (structural).
- `directives.ts`: one registry per revision — a `SelectorMatcher` over every repo component
  and directive with a selector, pipes by name, inputs and outputs merged along `extends`
  (resolved by relative import, else by a unique class name).
- Shims: an element (or `*` template) matching repo directives gets
  `const d = null! as Directive; Directive();` — the call is the edge, at the tag or at the
  attribute its selector names; a binding a directive consumes becomes `d.field = value`
  (static attributes too), an output `d.field.subscribe(($event) => { … })` (so `$event` is
  typed), `#p="appPreview"` a local of the directive's type, `x | markdown`
  `(MarkdownPipe(), MarkdownPipe.prototype.transform(x))`. Classes are imported by value
  (`__cpr_D0`…), relative to the shim; imports are written last (`ShimBuilder.prepend`).
- Plugin `dangling` (new X1 hook, core passes `base`): removed components and directives whose
  selector no head directive has, still matched in a head template (error); removed pipes still
  named (error); inputs removed from a directive that is still there and still bound (error);
  outputs likewise still listened to (warning, certainty `unknown`). Sites at the tag,
  attribute, binding or pipe name.

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

### A3 — Angular library components, directives and pipes

**Status:** merged into main (2026-10-02, from branch `milestone/a3-angular-libraries`);
results and "as built" at the end of this section.

**Problem.** A2 sees the repo's own components, directives and pipes; everything that comes from
a package — `async`, `date`, `currency`, `ngModel`, `formControlName`, `routerLink`, Angular
Material — is still a plain binding, and a library pipe's result is `any`. The costliest case:
`@if (org$ | async; as org) { {{ org.name }} }` gives `org` no type, so no `org.…` in that block
links to anything — renaming or removing `Organization.name` goes unnoticed there. Measured
(templates parsed with Angular's compiler, library selectors from Angular 21's packages):

| | RealWorld (Angular 21) | Bitwarden `apps/web` |
|---|---|---|
| Templates | 19 | 297 |
| Elements and attributes matching a library directive | 100 (router 43, forms 46, `NgClass` 8) | 1,058 (forms 900+, `NgClass` 59, router 41) |
| Library pipe uses | 4 `async`, 3 `date` | 176 `async`, 123 `currency`, 25 `date`, 9 `number`, 7 `lowercase` |
| `@if`/`*ngIf` aliases of an `async` (a typed local for a whole block) | 2 | 19 |

**Goal**: library directives and pipes resolve like the repo's: a library pipe returns its
`transform`'s type (`x$ | async` is `T`), library outputs type `$event`, `#f="ngForm"` is an
`NgForm`, and template uses of library classes are edges to their package (`@angular/common#AsyncPipe.transform`).

#### Where the metadata comes from

Angular libraries describe their directives in their published typings, in one of three forms
(all three verified on real installs: Angular 21; Angular 11.2 before and after ngcc):

| Angular version of the library | Where | Example |
|---|---|---|
| 12 and later (partial Ivy) | `.d.ts` | `static ɵdir: i0.ɵɵDirectiveDeclaration<NgModel, "[ngModel]:not([formControlName])…", ["ngModel"], { "model": { "alias": "ngModel"; "required": false; } … }, { "update": "ngModelChange"; }, …>` |
| 9–11 after ngcc (it runs on `ng build`/`ng serve`) | `.d.ts`, rewritten in place | `static ɵdir: ɵngcc0.ɵɵDirectiveDefWithMeta<NgModel, "…", ["ngModel"], { "model": "ngModel"; … }, { "update": "ngModelChange"; }, never>` |
| 9–11 before ngcc (View Engine) | `<entry>.metadata.json` | `{ "NgModel": { "decorators": [{ "Directive", { selector, exportAs } }], "members": { "model": [{ "Input", ["ngModel"] }] } } }` |

Components (`ɵcmp`/`ɵɵComponentDeclaration`/`…DefWithMeta`, `@Component`) likewise; pipes
`ɵɵPipeDeclaration<AsyncPipe, "async", true>` / `ɵɵPipeDefWithMeta<AsyncPipe, "async">` /
`@Pipe({ name: 'async' })`. Signal inputs carry `"isSignal": true`. The `.d.ts` forms win over
`metadata.json` when both exist. Libraries older than Angular 9 (View Engine only, no metadata
v4) are out of scope.

**Which packages**: the entry points the project's TypeScript imports (non-relative specifiers:
`@angular/forms`, `@angular/material/button`), resolved like Node from the project's
`node_modules` (`exports` → `types`, else `typings`/`types`, else `index.d.ts`), plus what their
NgModules export from other entry points. A compiling app can only use what it imports, so
this finds every library directive a template can use — and nothing is read when dependencies
are not installed (then everything stays as in A2). Declarations are found by syntax only:
classes with a static `ɵcmp`/`ɵdir`/`ɵpipe`, following `export { … } from`/`export *` into chunk
files; the name the entry point exports a class under is what the shim imports (Angular exports
some only as `ɵName`).

#### Shims

Library classes join the A2 registry with their package as their place:
`import { AsyncPipe as __cpr_D4 } from '@angular/common';` (by value, resolved in the analyzed
program like any import). Matching stays global (A2), now over repo and imported library
directives; two components on one element stay `possible`. A pipe call is
`(__cpr_D4(), __cpr_D4.prototype.transform(value, …args))` as for repo pipes — `transform`'s
generic signature types the result (`async`: `Observable<T>` → `T`). `ngFor`/`ngIf` keep A1's
special handling (their context types are not in their metadata).

#### What changes in findings

- **Through library pipes**: reads after `| async`, and aliases of it in `@if`/`*ngIf`/`@for`,
  are typed: their members are edges, a removed or renamed one is `removed-still-referenced`,
  a changed one counts its template users, a new one read only there is no orphan.
- **Library outputs** type `$event` (`(ngModelChange)="save($event)"`); **references** to library
  directives are typed (`#f="ngForm"` … `f.valid`).
- **Edges to packages**: a template's uses of library classes and members are edges to external
  nodes (`@angular/forms#NgModel.model`), drawn in the package's box as for TS code.
- Nothing for library code itself: the analysis is of the repo's change.

#### Verification

1. **Fixture** `libraries` with fake packages under its own `node_modules` (kept in git): one in
   each metadata form, each with a component (input, aliased input, output), a directive with
   `exportAs`, a generic `async`-like pipe and an NgModule. Cases: a member read only through the
   pipe alias (no orphan, edge); that member removed (error at the template line); a library
   output typing `$event`; `#f="libForm"` typed; an entry point not imported (not matched); no
   `node_modules` (same result as A2).
2. **Without the plugin, no change**; with it on a non-Angular repo, no change.
3. **RealWorld** with its dependencies installed (Angular 21 and the Angular 11 project, before
   and after ngcc): links through `| async`, library edges per template; experiment: a field read
   only through an `async` alias removed → error.
4. **Cost**: the library `.d.ts` files read are those of imported entry points, parsed once and
   shared by both revisions (same path through the linked `node_modules`); budget +5 % over A2.

**Risks**

| Risk | Mitigation |
|---|---|
| A metadata form not seen yet (other Angular versions, hand-written typings) | Unknown forms are skipped and counted in one warning; the three forms have fixtures. |
| Global matching over large libraries (Material: 86 entry points) over-matches | Only imported entry points are read; competing components stay `possible`. |
| A library class is not exported under a usable name | Classes without an export name are skipped (their elements stay plain). |

**Not in A3 (later)**: NgModule and standalone scopes (which directives a template may use);
`ngTemplateContextGuard` context types for `let-` variables of library structural directives
(`*matCellDef="let row"`); host directives.

#### A3 results

**Fixture** `libraries` (3 tests): four fake packages under the fixture's own `node_modules` —
`@acme/ui` (Angular 12+ typings split into a chunk, as Angular 21 ships them), `@legacy/widgets`
(ngcc's typings, reachable only through `UiModule`'s exports), `@old/forms` (View Engine
`metadata.json`) and `@acme/unused` (installed, never imported). With the plugin:
`Organization.name` removed while `@if (org$ | await; as org) { {{ org.name }} }` still reads it
→ ✖ error at the template line; the new `Organization.plan`, read only there → no orphan. 34
template edges, among them `$event` typed by a library output (`PressEvent.count`), `#f="uiForm"`
… `f.valid`, an aliased input (`kind` → `variant`), an input of the base class
(`UiButtonBase.disabled`, and `OldControl.disabled` from an undecorated View Engine base), a class
exported only as `ɵUiInternal`; nothing from `@acme/unused` or from a class the entry point does
not export; a class in an unknown typings form → one warning. Without `node_modules` (the same
fixture copied without it): A2's result — no error, a false orphan, no library edges, no warning.

**RealWorld** (Angular 21, runtime dependencies installed): `51c4afd` has 134 → 207 template
edges (`@angular/forms` 37, `@angular/router` 17, `@angular/common` 17, `@rx-angular/template` 2),
the same 34 findings and no warnings. `RouterLink.routerLink`, `FormGroupDirective.form`,
`ngSubmit`, `AsyncPipe.transform`, `NgClass.ngClass` and the implicit form directives
(`DefaultValueAccessor`, `NgControlStatus`, `ɵNgNoValidate`) are now edges into their package.

**Angular 11** (`2faae23`): the same 16 library edges (`AsyncPipe`, `NgClass`, `NgForOf`, nine
from forms, `RouterLinkWithHref`) from View Engine `metadata.json` and from the ngcc-processed
typings of the same packages; findings unchanged.

**Experiment** (Bitwarden): `Organization.canManageScim` renamed in the class and its TS users,
`organization-layout.component.html` left reading it in
`*ngIf="organization$ | async as organization"` → ✖ "Organization.canManageScim was renamed to
Organization.canManageScimProvisioning, but 1 symbol still uses the old name:
organization-layout.component.html" at 136:29. A2: only "all 3 users were updated". On RealWorld
the same experiment shows nothing either way: its models are interfaces, whose members CPR
counts as the interface (as for TS code).

**Bitwarden** (the same 10 commits as A2, A2 and A3 back to back, `@angular/*`, CDK, ng-select
and ngx-toastr installed): 359.6 s → 368.0 s, **+2.3 %** (per commit −7.4 % to +7.7 %, mostly
noise), inside the 5 % budget. The same findings on all 10 commits, no warnings. 150 template
edges into libraries (`@angular/forms` 64, `@angular/common` 49, `@angular/cdk` 24,
`@angular/router` 7, `@angular/core` 6), and 12 more into the repo's own code: members reached
through values that a library now types. Before the two fixes in "as built" (reads per name,
path aliases), the library scan alone took ~0.45 s per revision. Without the plugin, the 29 R1
comparisons are unchanged (932 edges, 11 findings).

**A core gap found on the way**: a `node_modules` that is a link (an install shared between
checkouts) was not linked into the base and head worktrees, so neither side saw any dependency
types. `linkNodeModules` now links it too.

#### A3 as built

- `libraries.ts`: the entry points are the bare specifiers the project's files import or
  re-export from, each resolved once from its first importer with TypeScript's resolver
  (Bundler mode: `exports` → `types`, else `typings`/`types`/`index.d.ts`). Skipped: packages
  whose folder is in no `node_modules` above the importer (a monorepo's path aliases — Bitwarden
  has 1,115 bare specifiers, 94 installed), workspace packages linked into `node_modules` (their
  real path is the repo's), `@angular/core`, and packages that are neither `@angular/*` nor
  depend on `@angular/core`.
- Typings are read by syntax (`createSourceFile`), cached by path and text for the process (base
  and head read the same linked `node_modules`), each file once per revision. Exports are
  followed through `export { … } from`, `export *` and import-then-export within the package; a
  class exported under several names keeps its own name, else a public one.
- Metadata: static `ɵcmp`/`ɵdir`/`ɵpipe`/`ɵmod` typed `ɵɵ…Declaration` (12+) or
  `ɵɵ…DefWithMeta` (ngcc): selector, `exportAs`, inputs (`"x"` or `{ "alias": "x" }`), outputs,
  pipe name. Typings list a class's own inputs only (Material's `MatButton` declares 1, its base
  `MatButtonBase` the rest), so `extends` is followed — into other packages too — and merged.
- An NgModule's exports add their entry points to the queue (`typeof i2.BidiModule` →
  `@angular/cdk/bidi`).
- An entry point without Ivy metadata: `<typings>.metadata.json` beside it (View Engine):
  decorators and their options, `@Input`/`@Output` members with aliases, `extends` within the
  entry point (undecorated bases too), NgModule exports from other packages.
- Library classes join the A2 registry before the repo's (a repo pipe wins its name), with
  `module` set to their entry point: the shim imports
  `import { AsyncPipe as __cpr_D0 } from '@angular/common'`, by value, resolved by TypeScript
  like any import — so `transform`'s generic signature types `x$ | async`, and every use is an
  edge to the package's node.

**Proposed decision** (into §14 with 20–24):

| # | Question | Decision | Why |
|---|---|---|---|
| 25 | Where library directives come from | **The installed packages' published typings (and View Engine `metadata.json`), read by syntax**; nothing when `node_modules` is missing | They are what Angular's compiler reads too; reading them by syntax needs no type checker, so the registry exists before the program the shims join. Without an install the result is A2's, never a wrong one. |

### V6 — A graph you can navigate

**Status:** merged into main (2026-10-03, from branch `milestone/v6-navigable-graph`); results
and "as built" at the end of this section.

**Problem** (reported on a real project: "I can't navigate through it"). Measured on Bitwarden
with the Angular plugin, in Chromium:

| | `737ee3f` (1 commit) | `c72c857~15..c72c857` | `canManageScim` experiment |
|---|---|---|---|
| Changed symbols | 86 | 129 | 5 |
| Symbols drawn (default view) | 1,288 in 509 file boxes | 1,389 in 723 boxes | 69 in 58 boxes |
| Edges drawn | 1,840 | 1,640 | 69 |
| Canvas | 9,470 × 85,468 px | 12,553 × 98,871 px | 3,611 × 7,260 px |
| First paint · select a symbol · mark reviewed | 4.0 s · 1.5 s · 1.2 s | 4.0 s · 1.8 s · 1.6 s | 0.4 s · 0.2 s · 0.1 s |

Panning stays at 60 fps: drawing is not the problem. Three things are:

1. **The view is mostly not the change.** 94 % of the nodes are unchanged neighbours, and a few
   hubs bring most of them: `FeatureFlag` (one changed enum member's enum) has 390 users, a
   changed constructor 385 dependencies; the top 5 hubs bring 733 of 1,202 neighbours. 44 of the
   78 changed symbols with neighbours have 5 or fewer.
2. **One tall strip.** The outer dagre layout stacks the file boxes' disconnected clusters in a
   single column; "fit" bottoms out at `minZoom` 0.1, where nothing is readable, and zooming in
   loses the overview.
3. **Every click re-lays out the graph.** `toFlow` runs dagre on everything, and its memo
   depends on `selected` and `reviewed`: selecting or marking a symbol costs 1.2–1.8 s, so
   walking the change with j/k stutters and the canvas jumps.

**Goal**: any change opens as an overview that fits one screen at a readable zoom; walking it
(list, j/k, findings) is instant and keeps the canvas still; neighbourhoods of any size stay one
click away. Viewer only: the analysis and the graph JSON do not change.

#### Design

- **Collapse big neighbourhoods** (in `toFlow`, pure). For each changed symbol, its unchanged
  neighbours on one side — users (edges into it) or uses (edges out of it) — are drawn only if
  there are at most `NEIGHBOUR_LIMIT` = 8; otherwise one **summary node** stands for them:
  "390 users · 220 files". A neighbour another changed symbol shows anyway stays drawn (and is
  not counted twice); users a `removed-still-referenced` finding names are always drawn (the
  stale call site is the point of the finding). Simulated: `737ee3f` 1,288 → 168 symbols + 29 summaries in 59
  boxes; the 15-commit range 1,389 → 282 + 24 in 119 boxes; `canManageScim` 69 → 15 + 2.
- **Expand on click**: a summary node toggles its group (`expanded` set in the app); expanded,
  it stays as "390 users · hide" and its neighbours are laid out. Focus mode (f) collapses the
  same way, so focusing a hub is no longer a wall.
- **Tiles, not a strip**: the file-box graph is split into connected clusters; each is laid out
  with dagre as now, then the clusters are packed in rows (largest first) to a ~16:10 page. The
  inside of a box keeps dagre, but symbols without an edge inside their box are wrapped into
  columns of at most 6 instead of one tall column.
- **Layout once, decorate often**: `toFlow` is split into `layoutFlow` (what is drawn and where:
  graph, type references, context, focus, expanded) and `decorate` (reviewed, settled,
  selected, findings), so selecting, marking reviewed and j/k never move a node; the canvas only
  pans to the selection.
- **Draw what is on screen**: React Flow's `onlyRenderVisibleElements`.

#### Verification

1. Unit (`flow.test.ts`): a hub with 30 users collapses to one summary with the right counts;
   expanded, all 30 are laid out; shared neighbours and error-finding users stay; packing keeps
   the canvas within 2.5:1 for many small clusters; decoration never changes positions.
2. E2E: a generated large graph (`?graph=`): the summary node shows, a click expands it,
   marking reviewed and j/k leave every node where it was; the existing viewer tests unchanged.
3. Bitwarden graphs above: symbols drawn, canvas size and aspect, select/review times
   (target: under 150 ms), screenshots of the overview.

**Risks**: a collapsed neighbour the reviewer needed (mitigation: counts on the summary, one
click, stale users of a finding always shown, the detail panel still lists all callers); packing
moves clusters away from where they were (one layout per view, stable while reviewing).

#### V6 results

| Bitwarden, Chromium | `737ee3f` before → after | `c72c857~15..c72c857` before → after | `canManageScim` before → after |
|---|---|---|---|
| Symbols drawn (+ summary nodes) | 1,288 → 168 (+29) | 1,389 → 282 (+24) | 69 → 15 (+2) |
| File boxes | 509 → 59 | 723 → 111 | 58 → 9 |
| Canvas | 9,470 × 85,468 → 10,904 × 7,183 px | 12,553 × 98,871 → 12,443 × 11,049 px | 3,611 × 7,260 → 3,108 × 670 px |
| Layout | 1,280 → 194 ms | 967 → 171 ms | 42 → 10 ms |
| First paint · select · mark reviewed | 4.0 s · 1.5 s · 1.2 s → 0.65 s · 0.33 s · 0.07 s | 4.0 s · 1.8 s · 1.6 s → 0.72 s · 0.42 s · 0.08 s | 0.4 · 0.2 · 0.1 s → 0.27 · 0.14 · 0.03 s |
| Elements in the page | 22,966 → 3,937 | 24,244 → 5,702 | 1,354 → 389 |

"Select" includes the 0.3 s animated pan to the symbol and drawing its detail panel; nothing is
laid out again.

**What the measurements changed in the plan**:
- Packing separates *clusters*, but on `737ee3f` 57 of 59 boxes are one connected cluster, which
  dagre lays out at 15 % fill; tighter spacing gained 5 % (fit zoom 0.087 → 0.092) and a
  top-to-bottom layout lost half. A whole-change view of a large change cannot be read at text
  size, whatever the layout. So the overview became a **map** (below 45 % zoom): each box shows
  its file name at a readable size — changed files bold, context files small and muted —
  symbols become blocks in their status colour, edges fade, and a click on a file zooms into it.
  Reading happens zoomed in, reached by the change list, j/k, findings or a click on the map.
- The selected symbol ended up half under the detail panel: the canvas was centred before it
  narrowed for the panel. It now re-centres when the canvas size changes.
- Opening a group could put its symbols off screen; showing or hiding a group now fits the view
  to it. A grouped symbol picked in the detail panel's lists opens its group.
- A changed template with many uses (34 in the A3 fixture) is collapsed like a hub's users: its
  package boxes appear when its "32 uses in 5 files or packages" node is opened.

**Tests**: 10 unit tests (collapsing at the limit, expansion, shared neighbours, stale users kept,
focus, packing aspect, wrapping, no overlaps, decoration keeps positions and object identity,
edge highlighting); 4 e2e tests on a generated 40-user hub with 30 more changes (group opens
and closes, map and click-to-zoom, walking and marking move nothing and the selection is not
under the panel, a grouped user picked in the panel is shown). Two older e2e tests counted
symbols in the page — only on-screen nodes are there now — and count the minimap's instead; the
A3 viewer test opens the template's uses first.

#### V6 as built

- `flow.ts`: `layoutFlow(graph, { typeReferences, context, focus, expanded })` returns nodes,
  edges, `hidden` (grouped symbol → its summary) and `members` (summary → its symbols);
  `decorate(nodes, { reviewed, sinceOnly, selected })` and `decorateEdges(edges, selected)` add
  review state, returning untouched nodes as they were. `toFlow` = both.
- Groups: per changed symbol and side, unchanged neighbours over `NEIGHBOUR_LIMIT` (8) become a
  `summary` node (`summary:<users|uses>:<id>`) in the symbol's box, joined to it by a dashed
  edge. Drawn anyway: neighbours another side shows, and the `related` users of
  `removed-still-referenced` findings.
- Boxes: dagre (left to right) for symbols linked inside the box, columns of 6 for the rest,
  changed ones first. Clusters of boxes (union-find over edges between boxes) are laid out by
  dagre each and packed in rows, tallest first, on a page about 1.6 wide.
- App: the layout memo depends on the graph, toggles, focus set and expanded groups only;
  selection and marks only decorate. React Flow draws only on-screen nodes
  (`onlyRenderVisibleElements`); the zoom is a CSS variable (`--cpr-zoom`) set from the store
  without re-rendering, and the `map` class flips at 45 %.
- Follow-up (branch `claude/change-search`, merged 2026-10-03): a search box on the Changes
  tab. `filterChanges(list, query)` keeps the symbols whose `file` + label hold every word,
  ignoring case; `/` focuses it, Enter opens the first match, j/k walk only the matches. The
  sidebar tab and the query live in `App` so `/` can switch tabs and j/k see the filter.

### W1 — Repositories with several projects

**Status:** merged into main (2026-10-03, from branch `milestone/w1-multi-project`); results
and "as built" at the end of this section.

**Problem** (reported on a real project: "CPR does not render any HTML templates in my app").
The repo holds two Angular apps two folders below its root (`<dir>/<dir>/app-a`, `…/app-b`);
the root has no `package.json`, `angular.json` or `tsconfig.json`. Reproduced on a copy of the
Angular 11 fixture moved to `web-a/` under a root with an empty `package.json`, with an HTML-only
change (`*ngIf` and `(click)` added): the `.html` file is listed as modified, no template is
analyzed, no warning. Three causes, all "the root decides for the whole repo":

1. **The Angular plugin turns itself off.** `applies` looks for `@angular/core` in the *root*
   `package.json` or an `angular.json` at the root. Nested projects are never seen.
2. **One Angular version for the repo.** `angularMajor` reads the root's
   `node_modules/@angular/core` or `package.json`; with neither it assumes Angular 17+ syntax, so
   in Angular 11 templates a plain `@` or `{` in text (`team@example.com`) is misread as a block.
3. **One set of compiler options for the repo.** Without a root `tsconfig.json`, every
   `tsconfig.json` below is loaded with CPR's defaults: each project's `paths` and `baseUrl` are
   dropped. With a root one, its options win for every file. Spike (two projects, both mapping
   `@app/*` to their own `src/app/*`): with shared options, `@app/core/user.service` and
   `src/app/core/user.service` are **unresolved** in both projects — links across files through
   aliases are lost, in plain TypeScript too. Merging both projects' `paths` cannot work either:
   the same alias means two folders. And only files named exactly `tsconfig.json` are found:
   Angular keeps the options it builds with in `tsconfig.app.json` (Angular 6–11:
   `src/tsconfig.app.json` with `baseUrl: "./"`), which CPR never reads.

The spike also showed the fix: ts-morph takes a `resolutionHost` whose `resolveModuleNames` gets
the importing file; resolving each file's imports with the options of *its* project resolved
both projects to their own files — in the program and in the language service's reference search
(ts-morph wires the host into both).

**Goal**: a repo with any number of TypeScript/Angular projects, at any depth, analyzes like one
project each: imports resolve with the options of the project a file belongs to, the Angular
plugin applies wherever Angular is used, each template is parsed with its project's Angular
version and matched against its project's installed libraries. A repo with one project at the
root behaves exactly as today.

#### Which project a file belongs to

A file's **project config** is chosen like the build chooses it, not like an editor (which only
knows `tsconfig.json`):

- Discovery: every `tsconfig.json` **and** `tsconfig.*.json` below the root (outside ignored and
  dependency folders, same depth limit as today: 5 folders), plus everything they reference.
  Loading files stays as today (from `tsconfig.json` files and references); the other configs
  only provide options.
- For a file, walk up from its folder; the first folder holding configs decides, preferring
  `tsconfig.app.json`, then `tsconfig.lib.json`, then `tsconfig.json`, then any other
  `tsconfig.*.json` — except that test files (`*.spec.ts`, `*.test.ts`, `e2e/`) prefer
  `tsconfig.spec.json`/`tsconfig.e2e.json`. Cached per folder.
- Options are the config's parsed options (`extends` followed by TypeScript), with CPR's
  `OVERRIDES` and the workspace `paths` (npm/pnpm workspaces) added as today.

#### Resolution per project (core)

- `loadTsProject` gives the ts-morph project a `resolutionHost`: for each import, resolve with
  the importing file's project options (one `ModuleResolutionCache` per config); **if that finds
  nothing, resolve as today** (root options, or defaults). So nothing that resolves today stops
  resolving; what changes is only what was unresolved, or what an alias means in its own project.
- Discovered configs follow their own `references` too (a solution-style `tsconfig.json` with
  `files: []` loads nothing today unless it is the root one).
- Plugin shims (`*.cpr.ts`, next to their component) belong to the component's project, so their
  imports (`./foo.component.js`, `@angular/common`) resolve like the component's.
- A config that cannot be parsed is a warning (as today) and its folder falls back to the root
  options.

#### Angular per project (plugin)

- `applies`: as today, **or** any project source file imports `@angular/core` (one `includes`
  over texts already in memory).
- Version per component: walk up from its file to the root, taking the first
  `node_modules/@angular/core/package.json` (installed version) or `package.json` that names
  `@angular/core`; cached per folder; nothing found → the repo-level answer as today. Template
  syntax (blocks and `@let` from 17) is chosen per component, not per revision.
- Libraries (A3) per dependency root: the specifiers a project imports are resolved and read from
  that project's `node_modules` (the queue is keyed by dependency root and specifier, not by
  specifier alone); a template is matched against the repo's classes plus the libraries of its
  own dependency root. One root (today's repos) → one registry, as today. Two apps on different
  Angular versions no longer borrow each other's library metadata.
- CLI hint ("Angular project: add --plugin angular") also when a changed `.html` file's nearest
  `package.json` names `@angular/core`.

#### Verification

1. **Core fixture** `multi-project` (no root config or `package.json`): `apps/web/a` with
   `baseUrl` + `paths: { "@app/*": ["src/app/*"] }` in `tsconfig.json`; `apps/web/b` with a
   solution-style `tsconfig.json` (`files: []`, `references` → `tsconfig.app.json` extending
   `tsconfig.base.json` with the same alias). A method in `a`'s service renamed while a caller in
   `a`, importing it as `@app/core/user.service`, still uses the old name → ✖ finding (needs the
   alias resolved on both sides); edges from `a` only ever reach `a`'s service, never `b`'s class
   of the same name; `b`'s files are loaded through its references. Today: no finding, no edge.
2. **Angular fixture** `multi-project`: `apps/web/legacy` (Angular 11, `src/tsconfig.app.json`
   with `baseUrl`, template text `team@example.com` and `{ }`, an HTML-only change adding
   `*ngIf`/`(click)`), `apps/web/modern` (Angular 17, `@if` and `@let`, `@app/*` alias), each with
   a fake library of the same package name but different inputs in its own `node_modules`.
   Expected: both templates analyzed; legacy parsed without blocks (no syntax warning), modern
   with them; template edges reach the right project's members and library version; HTML-only
   change → modified template with its edges. Today: no templates.
3. **No change for one-project repos**: the 29 R1 comparisons (932 edges, 11 findings), the core
   goldens and the Angular fixtures unchanged; Bitwarden's 10 commits (root `tsconfig.json`, many
   nested ones): findings unchanged, edges only gained — every lost or changed edge inspected;
   RealWorld (Angular 21 and 11) unchanged.
4. **A replica of the reported layout**: the RealWorld app at its Angular 11 and Angular 21
   commits copied to `apps/web/legacy` and `apps/web/modern` of one repo, a commit changing
   only templates in both → `cpr view --plugin angular`: both templates in the Changes list, with
   their diffs and links (screenshot).
5. **Cost**: per-file config lookup and per-config resolution caches; budget +5 % on Bitwarden
   and RealWorld, measured as for A3.

**Risks**

| Risk | Mitigation |
|---|---|
| Repos with a root `tsconfig.json` resolve some imports differently (a nested config's `paths` now applies to its files) | Only where the nested config resolves the import; the rest as today. Bitwarden and the 29 comparisons inspected edge by edge; any change must be a correction. |
| The wrong config is picked for a file (unusual names, configs outside the project folder) | Build-like preference order; fallback to today's options when it resolves nothing; a test per layout seen (Angular 6–11, 12+, solution-style). |
| Two dependency roots double the library scan | Only roots that projects actually import from; each root's files parsed once and shared by base and head (A3's cache). |
| Angular version undetectable (no `package.json` anywhere above, nothing installed) | Today's behaviour (newest syntax), plus one warning naming the folder. |

**Order**: fixtures first (both red), then core resolution, then the Angular plugin, then
libraries per root, then the CLI hint; regression and real-repo checks after each of the first
three. **Proposed decisions** (into §14 with 20–25):

| # | Question | Decision | Why |
|---|---|---|---|
| 26 | Compiler options in a repo with several projects | **Per file: the config its project builds with** (nearest folder; `tsconfig.app.json` > `tsconfig.lib.json` > `tsconfig.json` > others; tests prefer their spec config), falling back to today's options | One alias can mean different folders in two projects; Angular keeps its build options in `tsconfig.app.json`; the fallback keeps every resolution that works today. |
| 27 | Angular detection and version | **Per project**: any file importing `@angular/core` turns the plugin on; each component's version comes from the nearest installed `@angular/core` or `package.json` | A repo root says nothing about nested apps, and two apps can be years of Angular apart. |
| 28 | Which repo components a template can use | **Those of its Angular workspace** (the folder of the nearest `angular.json`) **and those outside every workspace**; no `angular.json`, or one at the root: all, as before | Found in verification: two apps with the same selectors linked each other's components (38 edges on the replica). Separate `angular.json` files are separate builds; shared code lives outside them. |

#### W1 results

**Fixtures** (red before, green after):
- Core `multi-project` (no root config): `a` maps `@app/*` and `baseUrl`, `b` is solution-style
  (`files: []` + references → `tsconfig.app.json` extending `tsconfig.base.json` with the same
  alias). `UserService.fullName` renamed in `a` while `profile.ts` (`@app/…`) and `header.ts`
  (`src/app/…`) still call it → ✖ "renamed …, but 2 symbols still use the old name"; `b`'s alias
  reaches `b`'s class only. Before: no finding, `b` not loaded.
- Angular `multi-project`: `legacy` (Angular 11, `baseUrl` in `src/tsconfig.app.json`,
  `team@example.com` in a template, an HTML-only change) and `modern` (Angular 17, `@app/*`,
  `@if`/`@let`), each with its own `angular.json`, `app-header` and `@acme/badge` (ngcc `text`
  vs Angular 17 `label`), and a shared `app-footer` in `libs/shared`. Both templates analyzed
  with their own syntax (no warning), each links its own header, badge input and `Account`, both
  link the shared footer, no edge crosses between the apps; `Account.verified` removed in
  `modern` → ✖ at its template. Before: no template at all.
- CLI hint: an Angular app in `apps/web` (nothing Angular at the root) with a changed template →
  the hint (failed before).

**Replica of the reported repo**: one repo with the RealWorld app at Angular 11 in
`apps/web/legacy` (`c023198` → `eca8bb6`, a template-only change) and at Angular 21 in
`apps/web/modern` (`81aeddd` → `51c4afd`), each with its dependencies installed:

| | `main` (before W1) | W1 |
|---|---|---|
| Changed templates | **0** | **13** (1 legacy, 12 modern) |
| Template edges | 0 | 218 |
| Edges crossing between the apps | — | 38 before workspace scoping, **0** after |
| Findings | 39, incl. a false orphan (`articleInput`, bound in a template) and 4 class-level signature notes | 34 — the same as RealWorld analyzed on its own |
| Warnings | none | none |

**No change for one-project repos**: the 29 R1 comparisons without plugins are identical
(932 edges, 11 findings); all earlier fixtures, goldens and viewer tests pass unchanged.
Bitwarden (one root `angular.json`, 192 tsconfigs of which one has its own `paths`, which
turns per-project resolution on — root `tsconfig.json` with 64 aliases, the test runner's with
its own 19), the same 10 commits on `main` and on W1: **every edge, finding and warning
identical** (5,016 edges), 360.6 → 328.0 s (no slowdown; W1 ran second). Every Bitwarden import
went through the new resolver, so its fallback resolves exactly as TypeScript did. In
`cpr view`, the replica's Changes list holds the Angular 11 template-only change with its diff
next to the Angular 21 app's templates (none on `main`).

#### W1 as built

- `configs.ts` (core): every `tsconfig*.json` below the root is discovered (depth 5, outside
  ignored folders); a file's project config is the first folder upwards holding one, by
  preference `tsconfig.app.json` > `tsconfig.lib.json` > `tsconfig.json` > others (tests:
  `tsconfig.spec.json`/`.test`/`.e2e` first). Options are parsed with `extends` but without
  globbing files. Per-project resolution (ts-morph `resolutionHost`) is on only when some
  config's `baseUrl`/`paths` differ from the root project's, and then only for files whose
  config differs; `node_modules` files and everything that finds nothing resolve as before
  (with the import's ESM/CJS mode). Solution-style configs found in the repo load their
  references.
- Angular plugin: `applies` also when any file imports `@angular/core`; a component's version
  is the nearest folder's installed `@angular/core` or `package.json`, and sets its template
  syntax; libraries are scanned per dependency root (nearest folder with `node_modules`); a
  template's registry is (its dependency root's libraries) + (repo classes of its workspace and
  outside every workspace), one per pair, cached; what a change takes from templates is checked
  across all registries.
- CLI hint: the nearest `package.json` above a changed template decides.

### Q1–Q2 — Qwik, as the `qwik` plugin

**Status:** Q1 and Q2 merged into main (2026-10-03, from branches `milestone/q1-qwik` and
`milestone/q2-qwik-mdx`). As built and results: "As built (Q1)" and "As built (Q2)" below.

**Problem** (asked: "does it support TSX, specifically Qwik?"). Qwik is TSX, and CPR reads most of
it right already: `<Counter start={1} />` is a call to `Counter`, an edit inside `component$` or
an `onClick$` handler is a body change of the component, and a required prop added to an inline
props type is a signature change whose JSX users were not updated. What CPR cannot see is what
Qwik's router calls by name, what `component$` makes of props, and what `.mdx` routes use.
Measured on a scratch app with the real typings (`@builder.io/qwik` and `qwik-city` 1.20.1;
`tsc` checks it):

| Change | CPR today | Right answer |
|---|---|---|
| `onGet`, `head`, a `routeLoader$` and a `routeAction$` added to `routes/about/index.tsx`; `onRequest` to `routes/layout.tsx` | 5 × ⚠ `orphan-added` | none: the router calls them |
| A loader in `src/loaders/product.ts`, re-exported by `routes/shop/index.tsx` (Qwik's documented way to share one) | ⚠ `orphan-added` | none |
| The route's and layout's `default`, `entry.ssr.tsx`'s `default` | 3 × ℹ "default export nothing imports (loaded by convention?)" | none |
| A required prop added to `Badge = component$((props: { label: string }) => …)`, its page not updated | ⚠ `signature-changed` | the same ✓ |
| An optional prop added to `Pill` the same way | ⚠ `signature-changed` | ℹ compatible |
| A required member added to `CardProps` of `Card = component$<CardProps>(…)`, its page not updated (`tsc` fails) | ℹ on `CardProps` only ("code that creates it must add them", 0 untouched users); `Card` body-only | ⚠ on `Card`, naming the page |

The last two come from one cause: a `component$` variable has no shape. Its type
(`Component<{ text: string }>`) is compared as text, so any edit is `unknown` (a warning), and
`Component<CardProps>` does not change when `CardProps` does; JSX sites never name `CardProps`.

On Qwik's own docs site (`QwikDev/qwik` `packages/docs`, Qwik 2 RC, the 30 latest non-merge
commits touching its routes' TS files, no dependencies installed), 9 `orphan-added`, **7 of them
false**: `head` added to two route modules (⚠ ×2) and three new route `default`s (ℹ) are called by
the router; `BenchmarkTable` (⚠) is rendered only by its blog post's `index.mdx` (the site has
243 `.mdx` routes, 144 of them import components); `useMDXComponents` (⚠) is the MDX provider
that `providerImportSource` in `vite.config.ts` names. The other 2 are right: a tutorial's
`Repos`, whose only use is commented out. Of 64 `signature-changed`, the app's own 6 are ℹ; the
rest are on Qwik's packages and e2e apps, which the same commits touched.

**Goal**: with `--plugin qwik`, nothing the router calls is an orphan, a component's props are
its contract (optional prop added → compatible, required prop added or one removed → breaking,
for named props types too), and `.mdx` routes are code where they use code. Without the plugin,
nothing changes.

#### Which projects are Qwik projects

- `applies`: the root `package.json` names `@builder.io/qwik` (1.x) or `@qwik.dev/core` (2.x),
  or any source file imports either (as Angular since W1).
- Per folder (W1): a file's Qwik project is the nearest folder whose `package.json` names one of
  them; it has router conventions if that `package.json` also names `@builder.io/qwik-city` or
  `@qwik.dev/router`. Cached per folder.
- Routes folder: `<project>/src/routes` (both versions' default), or a string literal
  `routesDir` given to `qwikCity(…)`/`qwikRouter(…)` in the project's `vite.config.{ts,mts,js,mjs}`
  (read by syntax, relative to that folder); the same for `serverPluginsDir` (default: the routes
  folder). Not a literal → the default and one warning.

#### Routes: what the router calls by name (Q1)

File kinds as Qwik's Vite plugin decides them (`getSourceFile`, read in `@builder.io/qwik-city`
1.20.1 and `@qwik.dev/router` 2.0.0-rc.0; the same except error pages):

| Kind | Name without extension, under the routes folder | Extensions | Exports the router uses |
|---|---|---|---|
| Page or endpoint | `index`, `index!`, `index@<layout>`; error pages: 1.x `400`–`599`, 2.x `404` and `error` (with `!`/`@<layout>`) | `.tsx .jsx .ts .js` (`.mdx`: Q2) | `default`, `head`, `onRequest`, `onGet`, `onPost`, `onPut`, `onPatch`, `onDelete`, `onHead`, `onOptions`, `onStaticGenerate`; 2.x also `routeConfig`, `eTag`, `cacheKey`; every loader and action |
| Layout | `layout`, `layout!`, `layout-<name>` | `.tsx .jsx .ts .js` | the same |
| Server plugin | `plugin`, `plugin@<name>`, directly in the server plugins folder | `.ts .js .tsx .jsx` | `onRequest` … `onOptions` |
| Entry, service worker | `entry`, `service-worker` | `.ts .js` | every export |

- **Loaders and actions**: a value whose type is the router package's `Loader` or `Action`
  (covers `routeLoader$`, `routeAction$`, `globalAction$` and wrappers such as `formAction$`);
  without the router's typings, a value whose initializer calls one of those three, imported from
  the router package. The router collects them from every export of a page or layout module
  (`Object.values(routeModule)`, by their `__brand`).
- **Re-exports**: `export { useProduct } from '~/loaders/product'` (or `export *`) in a page or
  layout module gives the declaration it resolves to the same exposure, if it is a loader or
  action.
- **App entries**: files named `entry.<name>.{ts,tsx,js,jsx}` directly in a project's `src/`
  (`entry.ssr.tsx`, `entry.express.tsx`, …; named by Vite and adapter configs as strings): every
  export.
- All of these get the exposure `framework` (X1): `orphan-added` skips them. Every other export
  of a route file is judged as today — a helper nobody calls stays an orphan.

#### Components: props are the contract (Q1)

A new optional hook in core, generic (React function components fit it later):

```ts
/** What a variable's value is used as, when a framework call made it (a Qwik `component$` →
 *  its props); undefined leaves it as today (the variable's type). Added with Q1. */
contract?: (revision: PluginRevision, declaration: ts.VariableDeclaration) => Contract | undefined;

interface Contract {
  /** For display, e.g. `component$<{ text: string; size?: number }>`. */
  display: string;
  /** What callers pass, member by member (a component's props). */
  inputs: ts.Type;
}
```

- **Core** (`extract.ts`): for a claimed variable, the signature hash and the display come from
  the contract — export and modifiers, name, and each input's name, optionality and normalized
  type (sorted) — instead of the variable's inferred type. Its shape gets a new field
  `inputs: Record<string, { optional, type }>`, compared in `compat.ts` from the caller's side:
  an input removed, retyped or made required → `breaking`; a required one added → `breaking`
  (every JSX site that does not pass it fails); an optional one added, or one made optional →
  `compatible`. Members of a named props type are resolved, so `CardProps` gaining a required
  member changes `Card`'s signature too.
- **Plugin**: claims a variable whose initializer calls `component$` imported from
  `@builder.io/qwik` or `@qwik.dev/core` (aliases followed). Props: the type argument of
  `Component<P>` (the value's type) when the typings are installed; else `component$<P>`'s type
  argument or the annotation of the callback's first parameter, resolved by the checker (inline
  types and repo interfaces need no `node_modules`); no props → no contract (as today).
- The hook runs on changed symbols only, like inferred return types (§6.3).

#### MDX routes (Q2)

- `matches`: `.mdx` files under a routes folder.
- **Reading**: no MDX dependency. A line scanner over MDX's code parts: top-level `import` and
  `export` lines, JSX elements whose tag is an imported name, and `{…}` expressions, skipping
  code fences and inline code. On the docs site's 243 `.mdx` routes: 144 import something (347
  import lines, 372 names), 575 elements use an imported name, 2 more sit in code fences;
  138 imported names are not element tags — mostly images passed as `src={img1}`.
- **Shim** `<file>.mdx.cpr.tsx` next to the file: its import lines verbatim, then one function
  rendering each element verbatim when it parses as TSX on its own (props then type-check like in
  a `.tsx` file), else referencing its tag name; expressions as they are. Each element and
  expression maps to its `.mdx` line; imports are scaffolding (X1).
- **Symbol**: the file is a `template` (`…/index.mdx#template`), hashed over its code parts only:
  a prose edit is no change, a changed element or import is. Exposure `framework`.
- **MDX provider**: the module named by `mdx.providerImportSource` in the router's Vite options
  (a string literal, resolved like an import from `vite.config.ts`) — its `useMDXComponents` is
  `framework`, and an `.mdx` element whose tag is not imported but is a key of the object
  `useMDXComponents` returns is a use of that component (`<Term>` on the docs site).
- **Findings** then follow from X1: a component removed while an `.mdx` still renders it → ✖ at
  the `.mdx` line; a required prop added that an `.mdx` does not pass → ⚠ naming it; a component
  used only by `.mdx` is no orphan (`BenchmarkTable` above).

#### CLI hint

`angularHint` becomes a list of known frameworks. Qwik: a changed `.tsx` or `.mdx` file whose
nearest `package.json` names `@builder.io/qwik` or `@qwik.dev/core`, plugin off → once:
`Qwik project: add --plugin qwik to analyze routes and components`.

#### Packaging

`packages/plugin-qwik` (`@cpr/plugin-qwik`) depends on `@cpr/core` types only: no Qwik, no MDX
parser. Linked from the root `package.json` like the Angular plugin, so `--plugin qwik` works
from a checkout; `qwik` resolves to `@cpr/plugin-qwik` by the existing naming rule. Graph schema:
no new node or edge kinds (`template` and `framework` exist since X1); `plugins` lists it.

#### Verification

1. **Fixtures** (`packages/plugin-qwik/test`), each case with its expected result, red before:
   `qwik-v1` (minimal `@builder.io/qwik` and `qwik-city` typings in a fixture `node_modules`:
   `component$`, `Component`, `routeLoader$` → `Loader`, `routeAction$` → `Action`) with every
   row of the table above; `qwik-v2` (`@qwik.dev/*`, `error.tsx`, `routeConfig`, `plugin@auth.ts`);
   `no-typings` (the same cases by syntax); a `routesDir` set in `vite.config.ts`; an app in
   `apps/site` with nothing at the root (W1). Precision cases: a helper export in a route file
   that nobody calls stays ⚠; an `index.tsx` outside the routes folder keeps its warnings.
   Q2: an `.mdx` route rendering a component (removed → ✖ at the line; required prop added → ⚠;
   only used there → no orphan; prose-only edit → nothing; an element that does not parse →
   name reference, no warning; a component given by the MDX provider and used without import).
2. **No plugin, no change**: goldens, Angular fixtures and the 29 R1 comparisons identical;
   `--plugin qwik` on a non-Qwik repo identical; `--plugin angular --plugin qwik` on the Angular
   fixtures identical.
3. **Qwik docs site**: the same 30 commits without and with the plugin; every finding that
   disappears must be a router-called export, a loader, an entry or an MDX use, and every new one
   is inspected. Expected: the 5 router findings gone after Q1, `BenchmarkTable` and
   `useMDXComponents` after Q2, both `Repos` kept.
4. **MDX scanner** against `@mdx-js/mdx` (in the spike only, not a dependency): on the 243 files,
   the same imports, element tags and lines.
5. **Viewer**: a Qwik starter with commits for a prop added, a route export added and a component
   removed while an `.mdx` uses it → `cpr view --plugin qwik`: the `.mdx` template with its diff
   and links (screenshot, Playwright like `angular.spec.ts`).
6. **Cost**: +5 % on the docs-site commits at most.

**Risks**

| Risk | Mitigation |
|---|---|
| Qwik changes its route rules | Rules copied from both versions' `getSourceFile`, a fixture per version; a name the plugin does not know keeps today's warnings — never hidden. |
| Real orphans silenced | Only the exports the router reads, values typed as its `Loader`/`Action`, entry modules; precision fixtures. |
| Contract hashes differ from today's | Only with the plugin on. Review marks (I1) on components are flagged ↻ once after turning it on. |
| MDX the scanner misreads (multi-line elements, `<` in expressions) | An element that does not parse becomes a name reference; scanner checked against `@mdx-js/mdx` on 243 files; a file it cannot read is skipped with a warning, as today. |
| Props types are huge (unions, intersections from libraries) | Type text normalized and truncated as for inferred return types (§6.3, decision 11). |

**Order**: fixtures first (red), then route exposures, then the core `contract` hook and
`inputs`, then the plugin's `component$` contract, then the hint — the docs-site comparison
after Q1 — then MDX (Q2) and the comparison again.

#### As built (Q1)

Differences from the plan above, and why:

- **The `contract` hook** is `(revision, declaration: VariableDeclaration | ExportAssignment) →
  { label, inputs: ts.Type | undefined }`: default-exported components have props too, and a
  component taking none gets an empty contract (an optional prop added later is then
  `compatible`, not `unknown`). Core builds the display (`const Badge = component$<{ label:
  string; tone: string }>`) from the label and the inputs.
- **It runs in both extraction passes**, not only for changed symbols: `Card`'s code does not
  change when `CardProps` gains a member, so the syntactic pass must already see the contract to
  send `Card` to the second one. It stays cheap: props come from the types written in the code
  (`component$<P>`, `(props: P)`, `const C: Component<P>`) through `getTypeFromTypeNode`, with no
  inference; only untyped props fall back to the value's type (`Component<P>`).
- **Input types are the tokens of their declared type** (as for interface members), the checker's
  text only where there is none: `typeToString` orders a union's members by type creation, which
  can differ between base and head and would make spurious changes.
- **Per JSX site** (not planned; found on the docs site): a props change warned about every user
  not updated, though most do not pass the prop that went away (`Header`'s optional
  `mobileSidebarOpen`, 9 `<Header />` users). JSX references now record the attributes they pass
  (`EdgeRef.passes`, `children` included; unknown with a spread); when only inputs changed, a user
  breaks only if it passes an input that is gone or retyped, or misses one now required. None
  breaking → ℹ "the 9 users not updated pass props that still fit"; else the message names those
  that break. Without inputs nothing changes.
- **Exposure order**: the adapter's `default-export` ("loaded by convention?") is a guess, so a
  plugin's answer now replaces it; every other adapter answer still comes first.
- **Projects**: a file's Qwik project is its package (the nearest `package.json` with a name,
  dependencies or scripts; `{ "type": "module" }` markers are not packages), and Qwik and its
  router may be named there or above — Qwik's own e2e apps have a bare `package.json` and take
  Qwik from the monorepo root. The routes folder is read from `routesDir` as a quoted path or
  built by `resolve`/`join`/`fileURLToPath(new URL(…))` from quoted paths and the config's folder,
  also through a `const`; anything else warns and uses `src/routes`.
- **Loaders and actions by type**: a type alias named `Loader` (declared `Loader_2` in the
  typings), `Loader_2` or `Action` from the router — installed, or, in a monorepo, the package
  named like it.

**Results.** Fixtures `qwik-v1` (with the fake typings `tsc` agrees with — same 3 errors as the
real 1.20.1 typings), the same without `node_modules`, and `qwik-v2` (two folders down, nothing at
the root, `routesDir` from `vite.config.ts`): every row of the table above as planned, plus the
precision cases (helper in a route module, non-handler in a server plugin, non-loader re-exported
by `export *`, route-like export outside the routes folder, Qwik 2's non-route `500.tsx`). `--plugin
qwik` on the 5 core fixtures and with `angular` on 3 Angular fixtures: identical analyses.
Qwik docs site, 30 commits: without the plugin identical to `main` (findings, nodes, edges); with
it the 5 router findings are gone (`head` ×2, route `default` ×3), the 2 `Repos` stay, and the 2
MDX ones wait for Q2; 6 new ℹ, each a real props change now visible (Qwik is not installed there,
so these components' types were `any`): their users were updated or pass props that still fit.
No new warning. Cost: +3.9 % (with and without, 30 commits each).

#### As built (Q2)

- **Template IDs** are `…/index.mdx#(template)`, as Angular's external templates (the viewer and
  messages call it `index.mdx`); its signature reads `MDX route`. `matches` takes every `.mdx`
  (it only sees a path); symbols exist for `.mdx` files with code under a routes folder.
  Prose-only files have none: nothing in them to analyze, and a prose edit is no change.
- **The scanner** follows MDX's own tokenizer where the plan's sketch was loose: ESM starts only
  with `import `/`export ` and a space, at column 1, not continuing a paragraph
  (`import("x").Type` at a line start is prose); frontmatter is skipped; fences count at any
  indentation (inside list items). Against `@mdx-js/mdx` 3 on the docs site's 243 routes:
  identical ESM blocks (146) and component elements (585), every content expression found (plus
  53 attribute expressions of HTML elements, which the scanner also reads), no read errors.
- **Elements** are copied self-closed (children are content, not props). TSX's parser turned out
  to accept every valid MDX element tried (it is the more permissive of the two), so the
  name-reference fallback only guards against scanner misreads.
- **The MDX provider** is read by syntax: `providerImportSource` resolved with the app's tsconfig
  (as Vite resolves it), the object `useMDXComponents` returns mapped key → where the provider
  imports that component, and a shim imports each provided tag under its own name. Tried first:
  `<__cpr_c.Term>` on the provider's return value — props type-check, but TypeScript's
  find-references does not follow a shorthand `{ Term }` property to such uses, so the route did
  not count as a user. Imports it does follow. A provider module's `useMDXComponents` is a
  framework exposure.
- An `.mdx` file's `export` blocks (`export const head`) are code of its template, not symbols.

**Results.** Fixture `qwik-mdx`: a component removed while a route renders it → ✖ at the `.mdx`
line; a required prop a route does not pass → ⚠ naming it (also for a provided component, with
the provider as a second user); components only routes use → no orphan; a prose and inline-code
edit → no change; a prose-only page that gains a component → an added template. Viewer: the route
opens with its own diff and what it renders; a comment on its line goes to the `.mdx` file
(Playwright, `qwik.spec.ts`). Qwik docs site, 30 commits: without the plugin identical to `main`;
with it 7 false findings gone — the 5 router ones of Q1, `BenchmarkTable` (rendered only by its
blog post's `index.mdx`) and `useMDXComponents` (the provider) — both `Repos` kept, no new
warning, no plugin warning; 69 MDX templates in the graphs. Cost on an idle machine, 6 commits
alternating: 67.2 s without, 69.7 s with (+3.7 %)..

#### Milestones

| # | Milestone | Output |
|---|---|---|
| Q1 ✅ | Qwik plugin: routes and components | `packages/plugin-qwik`; Qwik and router projects per folder; routes folder from the Vite config; page, layout, error, server plugin, entry and service-worker modules per Qwik's rules (1.x and 2.x); `framework` exposure for router-called exports, loaders and actions (by type, by callee without typings, through re-exports) and app entries; core `contract` hook and `Shape.inputs` compared from the caller's side; `component$` props as the contract; the CLI hint as a list. |
| Q2 ✅ | Qwik plugin: MDX routes | `.mdx` routes as `template` symbols hashed over their code parts; shims with imports, elements (verbatim when they parse, else names) and expressions, mapped to `.mdx` lines; the MDX provider from the Vite config; removed components and missing props found in MDX; no orphans for components only MDX uses. |

**Decisions** (29, 30 and 32 taken with Q1, 31 with Q2):

| # | Question | Decision | Why |
|---|---|---|---|
| 29 | How Qwik is supported | **A `qwik` plugin on X1's hooks, no new adapter**: router conventions as exposures, `component$` props as the contract (a new optional `contract` hook), `.mdx` routes as templates | Qwik is TSX, which CPR reads already; what it cannot see is what the router calls by name and what `component$` makes of props. |
| 30 | What a router convention silences | **Only what Qwik's router reads**: the exports it calls by name, values typed as its `Loader`/`Action` (or made by its constructors), entry modules — by Qwik's own file rules | A route file can hold real orphans too; "everything under `routes/` is used" would hide them. |
| 31 | Reading MDX | **A line scanner over MDX's code parts, no MDX dependency**, checked against `@mdx-js/mdx` | The plugin needs imports, element tags and their lines, not markdown; an MDX compiler is megabytes of dependencies for that. |
| 32 | Which users a props change breaks | **Those passing a prop that is gone or retyped, or missing one now required**, read from the attributes at each JSX site (unknown with a spread or outside JSX: may break) | Most users do not pass an optional prop; warning about all of them when one goes away was the only false warning left on Qwik's docs site. |

**Not in Q1–Q2 (later)**: props of plain-function components (Qwik inline components, React) —
the `inputs` comparison fits them, as a core change for TSX; props declared in another file that
is not changed (the component's file is not re-extracted, so only the props type's own finding
shows); `$` closures (`onClick$`, `useTask$`) as symbols of their own; links to a removed route
(`<Link href="/about">`) as `dangling`; `.md` routes and `menu.md`; Qwik's serialization rules
(`eslint-plugin-qwik` checks them).

**Later:** more languages via adapters, a faster core (TS 7 adapter or Rust/oxc), self-hosted team mode.

### V7 — Apps in the graph

**Status:** V7a merged into main (2026-10-04, from branch `milestone/v7a-projects-in-graph`, with
the plan's branch `milestone/v7-app-boundaries`); V7b merged into main (2026-10-04, from branch
`milestone/v7b-project-frames`); V7c merged into main (2026-10-04, from branch
`milestone/v7c-projects-sidebar`). V7 is complete.

**Problem** (asked: "In the UI view, the boundary between applications is visible?"). Not really.
In a repo with several apps and libraries the viewer draws one box per file, labelled with its
path, and places boxes by what calls what: two apps' files sit side by side, a library and the
apps it reaches are not grouped, on the map (zoomed out) only file names show — two apps'
`header.tsx` look the same — the change list is one flat list of paths, and the graph JSON does
not say which app a file belongs to. The only "package" boxes are npm packages.

Measured with the viewer's own layout (V6, `layoutFlow`) on real changes, a project being what
the rules below make of it:

| Repo, change | Symbols drawn (changed) | File boxes | Projects (only context) | Edges drawn (between projects) | Canvas |
|---|---|---|---|---|---|
| Bitwarden `737ee3f` | 168 (86) | 59 | 6 (2) | 336 (79) | 10,904 × 7,183 |
| Bitwarden `cbf86c2` | 303 (115) | 123 | 16 (7) | 672 (293) | 17,456 × 15,905 |
| Bitwarden `787bad6` | 80 (34) | 33 | 9 (3) | 166 (72) | 9,632 × 2,662 |
| Bitwarden `9014aef` | 75 (36) | 25 | 6 (3) | 97 (25) | 6,812 × 2,976 |
| Bitwarden `58af82a` | 39 (15) | 23 | 7 (4) | 45 (18) | 4,476 × 2,128 |
| Bitwarden `31dda4f` | 46 (20) | 25 | 4 (1) | 73 (12) | 3,119 × 2,165 |
| Bitwarden `12b0923` | 31 (8) | 18 | 9 (6) | 38 (17) | 3,581 × 2,005 |
| Bitwarden `9ce55cd` | 23 (7) | 15 | 5 (1) | 24 (6) | 2,968 × 825 |
| Qwik `f7ed58cfc` | 685 (367) | 192 | 6 (0) | 1,944 (0) | 35,051 × 25,081 |
| Qwik `65661bf49` | 152 (62) | 39 | 3 (0) | 226 (0) | 8,165 × 3,658 |

(npm packages and dynamic calls, outside every project, are not counted as projects.)
Two kinds of monorepo, and the design must serve both: in Bitwarden a change spreads over 4–16
projects and 16–45 % of the edges drawn cross projects (apps into `@bitwarden/common`, `auth`,
`vault`…); in Qwik's repo each project's part of a change is its own island (no edge between
projects drawn) — boundaries there separate unrelated work. A third to two thirds of Bitwarden's
projects in a view hold only unchanged neighbours, often one or two (`guid`, `storybook`,
`ui-common`): frames must stay light for those.

**Goal**: when a graph's symbols come from two or more projects, each project is a labelled frame
holding its files; edges between projects stand out; the map keeps project names readable; the
change list groups by project, shows review progress per project and can show one project only.
A single-project graph is drawn exactly as today.

#### What a project is (core)

Measured on Bitwarden (60 `package.json`, 54 Nx `project.json`, an `angular.json` with 6
projects, workspaces `apps/*` and `libs/**/*`) and Qwik's repo (pnpm workspaces). "The nearest
`package.json`" alone is wrong: `apps/desktop/src/package.json` is the desktop app's Electron
manifest and `apps/browser/src/autofill/content/components` holds a `lit-components` package —
it would split two apps; and `bitwarden_license/bit-*` have no `package.json` at all (only a
`tsconfig.json` and a path alias). The rule, in order:

1. **Declared projects**: workspace members (`package.json` `workspaces`, `pnpm-workspace.yaml`,
   `**` globs included), Nx `project.json` files, and projects a plugin declares (Angular:
   `angular.json` `projects` and their `root` — `bit-web` exists only there).
2. **Packages**, when the repo declares nothing: the nearest `package.json` with a name,
   dependencies or scripts (not a `{ "type": "module" }` marker) — the user's repo with two apps
   two folders down and nothing at the root.
3. **TypeScript projects nobody declared**: for a file outside every project above, the nearest
   folder with its own `tsconfig.json` (not the root's) — `bitwarden_license/bit-common`. Inside a
   declared project such a folder is not a project of its own (an app's `e2e/` stays the app's).
4. **The root**, for everything else.

A file belongs to the project with the longest folder prefix. One folder declared several ways is
one project (Bitwarden's `apps/web`: workspace member `@bitwarden/web-vault`, Nx `web`, Angular
`web`). Name: the Nx or plugin name (`web`), else the package name (`@bitwarden/common`), else the
folder's name (`bit-common`); the root: its package's name, else "repository root". Kind
(`application`/`library`) when declared (Nx or Angular `projectType`), else none.

**Plugin hook** (optional, generic): `projects?: (revision: PluginContext) => { folder: string;
name: string; kind?: 'application' | 'library' }[]`. The Angular plugin returns `angular.json`
projects — an Angular CLI workspace with one `package.json` and `projects/*` has no other marker.
Nx stays in core: it is build tooling, not a framework.

**In the analysis**: core reads the markers of the folders of the graph's files from the head
checkout (the base checkout for files only base has), cached per folder; the workspace globs
reader moves out of the TypeScript adapter (`project.ts`) into a shared core module. The
`LanguageAdapter` gets an optional `projects(revision)` for plugin-declared ones.

**In the graph** (schema 0.6.0, minor — a new optional field): a top-level list, only when the
graph's symbols span two or more projects:

```jsonc
"projects": [
  { "folder": "apps/web", "name": "web", "kind": "application", "source": "nx" },
  { "folder": "libs/common", "name": "@bitwarden/common", "source": "workspace" },
  { "folder": "bitwarden_license/bit-common", "name": "bit-common", "source": "tsconfig" },
  { "folder": "", "name": "@bitwarden/clients", "source": "root" }
]
```

No field on nodes: a consumer puts a file in the project with the longest folder prefix (one rule,
documented with the schema; base-only files work the same). `source`: `workspace`, `nx`,
`plugin` (with the plugin's name), `package`, `tsconfig`, `root`. Older graphs have no list: one
project, today's drawing.

#### Frames (viewer)

- **Layout, one level more** (pure, in `layoutFlow`): symbols → file boxes as today; a project's
  file boxes packed into its frame with the V6 cluster packing (clusters of boxes linked inside
  the project, to the page aspect); frames and the boxes outside every project (npm packages,
  dynamic calls) laid out together by the links between them — dagre left to right, callers
  before what they call, so apps sit left of the libraries they use; groups of frames with no
  link between them packed like V6 clusters. Prototype check before going on: on `cbf86c2` (16
  projects) and `737ee3f` the canvas stays within about 2:1 and no wider than today's; if dagre
  over frames runs too wide, frames are packed by size instead and only edges show the links.
- **Frame node** (`project`, React Flow parent of its file boxes, which stay parents of their
  symbols): name, kind (app/lib), folder, and "12 changed" in its top band; a frame holding only
  unchanged neighbours is drawn lighter and smaller-headed. Neutral colours: status colours
  keep meaning added/removed/modified.
- **Edges between projects** get their own class (heavier, a distinct dash) and stand out more
  when one end is selected; the legend explains them.
- **Map** (below 45 % zoom): the frame's name scales with `--cpr-zoom` at about twice a file
  name's size, so projects read first, files second; clicking a frame on the map zooms into it,
  as a file box does. The minimap draws frames as outlines.
- **Summaries** ("390 users in 220 files") also say "across 5 projects" when they do; expanded,
  their members are drawn in their own frames.
- **One project** (or a graph without `projects`): no frame, layout identical to today's — every
  existing viewer test and screenshot unchanged.

#### By project in the sidebar (viewer)

- **Change list grouped by project** (only with two or more): a header per project (name, kind,
  "4/12 reviewed"), collapsible; file paths under it relative to the project's folder
  (`src/components/header.tsx`); projects with changes first, in folder order; j/k follow the
  list's order; search also matches project names ("web button").
- **Show one project**: a filter on the project header (and `p` cycles projects): the canvas and
  the list keep that project's changed symbols and what they are linked to directly in other
  projects (the impact across the boundary stays visible), as focus does for one symbol.
- **Findings and detail**: a finding row names its symbol's project; the detail panel's file line
  reads `web › src/app/foo.ts`.

#### Verification

1. **Core**: project rules on fixtures for each kind (workspaces with `**` globs, pnpm, Nx,
   plugin-declared, no declaration, a `{ "type": "module" }` marker, an undeclared nested
   package inside a declared one, a tsconfig-only folder, the root), names and kinds, one folder
   declared three ways; the graph has `projects` only with two or more; goldens unchanged except
   `schemaVersion`; schema validation. The 29 R1 comparisons identical apart from the new field.
2. **Angular plugin**: `angular.json` projects (an Angular CLI workspace with `projects/*`, and the
   W1 multi-project fixture).
3. **Viewer units** (`flow.test.ts`): one project → positions identical to today's; two or more →
   every file box inside its frame, frames not overlapping, boxes outside projects outside
   frames, edges between projects classed; filter by project; grouped change list and j/k order.
4. **E2E**: a monorepo fixture (two apps and a shared library, plain TypeScript, npm workspaces):
   frames with names, the map showing project names, the grouped list, the project filter;
   screenshot. Existing e2e tests unchanged.
5. **Real repos**: Bitwarden's 8 changes above and Qwik `f7ed58cfc`: project assignment matches
   the rule (no `apps/desktop/src` split, `bit-common` its own project, `bit-web` from
   `angular.json`), canvas size and first paint against today's (+10 % at most), screenshots of
   `737ee3f` and `cbf86c2`. The user's two-app layout (W1 replica): two frames.

**Risks**

| Risk | Mitigation |
|---|---|
| Frames waste space (a project of one box still has a band and padding) | Light frames for context-only projects; inside a frame the V6 packing; measured canvas against today's. |
| Dagre over 16 frames runs wide | Prototype on `cbf86c2` first; fallback: frames packed by size, links shown by edges only. |
| Wrong boundaries | Rules from three real layouts; `source` in the graph says why; a plugin can declare projects. |
| Nested React Flow parents cost render time | Frames are few (at most 16 measured); first paint measured on the largest graphs. |

**Order**: V7a (core and schema, fixtures red first) → V7b (frames; prototype the frame layout on
`cbf86c2` before the rest) → V7c (sidebar). Each merged after its checks.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V7a ✅ | Projects in the graph | Core project rules (declared, packages, tsconfig-only, root), the optional plugin hook and the Angular plugin's `angular.json` projects, `projects` in the graph (schema 0.6.0), shared workspace-globs reader. |
| V7b ✅ | Frames | `layoutFlow` one level deeper (files in project frames, frames by the links between them), `project` frame node, edges between projects, project names on the map and minimap, summaries across projects, legend; one project = today. |
| V7c ✅ | By project in the sidebar | Change list grouped by project with progress and relative paths, the project filter (canvas and list), project names in findings and the detail panel, search by project name. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 33 | What a project is | **Declared first** (workspace members, Nx `project.json`, plugin-declared such as `angular.json`), **packages when nothing is declared**, **tsconfig-only folders outside every project**, the root last; the longest folder prefix wins | "Nearest `package.json`" splits Bitwarden's desktop and browser apps over nested packages and leaves `bit-common` (no `package.json`) at the root; repos that declare nothing (two apps two folders down) still get one frame per app. |
| 34 | How the graph says it | **A top-level `projects` list, no field on nodes**; consumers use the longest folder prefix | Nodes stay as they are (smaller graphs, no change for single-project repos); base-only files resolve the same way. |
| 35 | When frames are drawn | **Only with two or more projects**; otherwise today's layout, unchanged | A single-app repo gains nothing from one frame around everything, and every existing view stays as reviewers know it. |
| 36 | Where frames go | **Files packed inside their project; frames laid out by the links between them, callers left of what they call**; size-packing if that runs too wide. *As built: frames in rows in dagre's rank order (callers first), packages inside their main user's frame — see As built — V7b.* | Bitwarden's changes run from apps into shared libraries (16–45 % of drawn edges cross projects); Qwik's projects are islands — both read best with each project in one place. |

#### As built — V7a

- **Which projects are listed**: those holding every file the graph names — changed files (also
  non-code and ignored ones, and old paths of renames) and the files of its nodes — not only the
  symbols' files. The longest-folder rule must give the right answer for every path in the graph:
  listing only the symbols' projects would put a changed `apps/web/README.md` into the root
  project when `apps/web` holds no symbol. The list appears with two or more of them; the viewer
  decides when to draw frames (V7b: by the projects of what it draws).
- **"The repo declares"** (rule 2's condition): workspace globs, an `nx.json` at the root, or a
  plugin's projects. An Nx `project.json` counts only with `nx.json`, so a stray `project.json`
  in another kind of repo is not a project.
- **Nx before plugins** for the name and kind of a folder declared both ways: Bitwarden's
  `libs/components` is an `application` in `angular.json` (its Storybook) and a `library` in Nx,
  which is what it is.
- **The workspace globs reader** (`src/workspace.ts`) is shared with the TypeScript adapter, and
  `**` now also matches no folder: `libs/**/*` holds `libs/common`, as in npm. The old pattern
  missed every direct child, so Bitwarden's `libs/common` was not a workspace member for the
  adapter's package mapping either. It reads `package.json` with `JSON.parse` (npm's rule) where
  the adapter used TypeScript's lenient config reader.
- **Hook**: `TsPlugin.projects(context) → { folder, name, kind? }[]` (plugin API stays 1);
  `LanguageAdapter.projects?(revision)` adds the plugin's name. Folders are normalized
  (`./src/` → `src`, `.` → `''`); one outside the repository is skipped with a warning.
- **Base-only files** are read from base; when head and base give a project for the same folder,
  head's is listed (a renamed package shows its new name).

**Results (V7a)**: graphs, edges and findings identical to `main` apart from the new field and
`schemaVersion` — `r1` 29 comparisons (859 edges), Bitwarden 10 (4,862 edges) and the 8
multi-project changes (10,803 edges), Qwik's 30 (5,530 edges); run time ×0.97–1.015. Goldens:
only `schemaVersion`. On Bitwarden every project is what the rules say: apps and libraries by
their Nx names and kinds (`web`, `@bitwarden/common`), `bitwarden_license/bit-common`,
`bit-browser`, `bit-cli` by their tsconfig, `bit-web` from `angular.json`, nothing split at
`apps/desktop/src` or the browser's `lit-components`. The graphs list 8–45 projects there, far more
than the 4–16 the viewer draws: all but 3–10 come from context symbols, which V6 folds into
summaries — V7b frames what it draws, and a summary can say "across 5 projects" from the list.
Qwik: 19 of 30 changes span 2–7 projects (`f7ed58cfc`: 7, with the root). The new phase costs
250 ms of 66 s on Bitwarden `cbf86c2`, 7 ms on Qwik `f7ed58cfc`.

#### As built — V7b

- **Frames follow what is drawn**: a frame per project of the file boxes drawn, when they belong
  to two or more (the graph's `projects`, longest folder; `src/projects.ts`). Focus, context and
  opened summaries change what is drawn, so they can add or remove frames. One project, or a graph
  without `projects`: the layout equals the one without (a unit test compares them).
- **Rows in rank order, not dagre's columns** (decision 36 changed): the prototype ran dagre over
  frames 3–8 times wider than high on Bitwarden (`cbf86c2` 23,924 × 7,549, `737ee3f` 15,557 ×
  3,158). Frames are ranked by dagre (callers before what they call) and placed in rows in that
  order, the tallest first within a rank, frames linked to nothing last. Packing by size alone
  fitted as well but put a callee before its caller for 202 of 338 links on `cbf86c2` (rank
  order: 109).
- **Packages and the dynamic calls are drawn in the frame they have the most links with**, still
  in no project (no relative path, never `edge-cross`). Placed after the frames, or in a column
  beside their main user, Qwik `f7ed58cfc`'s `@qwik.dev/core` (461 edges, 403 from the e2e apps)
  pulled fans of long edges across the canvas: React Flow draws every edge whose bounding box meets
  the view, and panning at the first change fell from 22 to 3 fps. Inside its main user's frame the
  package joins its users into one cluster, as without frames.
- **Edges between projects** are heavier (3 px, 4.5 px when an end is selected) and less faded on
  the map; no distinct dash, since dashes already mean "removed" and "type reference / unknown".
- **Frame**: name, kind (app/lib), folder (unless it is the name), "N changed" (changed symbols
  drawn in it) or "context only" — then lighter, dashed and with a smaller head. Wide enough for
  its name. Only the name band takes the pointer: a click inside a frame is a click on the canvas
  (it closes the detail panel), a drag pans.
- **Map**: a frame is drawn over its files there, transparent, with a ring that keeps 2 screen px;
  its name is 26 px on screen, smaller only to fit the frame's width and never below a file name's
  13 px; a click on it zooms into the frame. A context-only frame's name is a file name's size.
- **Paths in a frame** start at the project's folder (`src/page.ts`); the full path is the title.
  Summaries say "across N projects" when their neighbours span two or more (from the graph's list,
  frames drawn or not); they are 250 px wide then, 190 otherwise.

**Results (V7b)**, with the Angular and Qwik plugins, against V7a's viewer (no frames), measured
back to back (two rounds, 1440 × 900 Chromium):

| Change | Frames (context only) | Canvas, today → frames | Edges in view, median (p90), today → frames | First paint | Pan |
|---|---|---|---|---|---|
| Bitwarden `cbf86c2` | 17 (8) | 17,044 × 15,230 → 8,921 × 8,964 | 121 (177) → 131 (190) | 1,514 → 1,168 ms | 63 → 63 fps |
| Bitwarden `737ee3f` | 6 (2) | 9,587 × 7,819 → 7,566 × 5,859 | 53 (120) → 67 (112) | 922 → 900 ms | 64 → 59 fps |
| Bitwarden `787bad6` | 10 (4) | 9,632 × 2,662 → 4,037 × 4,024 | 42 (59) → 49 (68) | 676 → 667 ms | 64 → 62 fps |
| Qwik `f7ed58cfc` | 6 (0) | 35,051 × 25,081 → 27,896 × 22,196 | 136 (318) → 106 (260) | 2,726 → 2,910 ms | 23 → 30 fps |
| Qwik `65661bf49` | 3 (0) | 8,165 × 3,658 → 8,092 × 4,585 | 45 (50) → 42 (53) | 764 → 654 ms | 62 → 62 fps |

"Edges in view": edges React Flow draws in a zoom-1.1 view centred on each changed symbol. On all
8 Bitwarden changes the canvas is 1.00–1.46 times wider than high and 0.42–1.01 times today's
width; on the three Bitwarden changes above a view holds 10–19 % more edges on average (the page
is denser), on Qwik's fewer. Marking a symbol
reviewed took 84 → 134 ms (`737ee3f`) and 154 → 230 ms (`f7ed58cfc`), within the ±30 % these
timings vary by; no page errors. Layout time fell (Bitwarden `cbf86c2` 443 → 243 ms): dagre runs
per frame. Not changed: the largest Qwik graph opens at the minimum zoom (0.05) and does not fit,
as before.

#### As built — V7c

- **By project when the changes span two or more** (as frames, decision 35): `changeList` gives
  each file its project and orders by project folder (stable, so files stay in path order within
  one); `byProject` cuts the list into groups. Folder order puts the root and a nested project
  (`apps/web/e2e` after `apps/web`) where the folders say, not where the paths sort.
- **Header**: name, kind, "n/m reviewed" over the project's whole change (not what the search
  leaves); it stays at the top while its files scroll. A click folds the project; j/k walk the
  list without folded projects, as they walk only what a search leaves.
- **One project**: "only" on a header, or `p` / `P` (next / previous, then all). The list keeps
  that project; the canvas keeps its changed symbols and everything one edge away, in it or in
  another project (`projectNeighbourhood`), and fits them once — walking the project's symbols
  then centres each, as without the filter. Focus on a symbol (`f`) narrows further. When the
  project's neighbours are all its own, one project is drawn: no frame (Qwik's router).
- **Search** matches project names too ("acme/ui"). **Findings** name their symbol's project;
  the **detail panel** reads `@acme/ui › src/index.ts`, the full path as its title. Packages and
  dynamic calls are in no project and stay as they were.
- **Fixed on the way**: V7b's e2e "a click inside a frame" measured the frame while the canvas
  still panned to the selection; 3 of 12 runs failed. It waits for the canvas to settle (20 of 20).

**Results (V7c)**: change lists on real graphs span 3–9 projects (Bitwarden `cbf86c2`: 115
changes in 32 files, 9 projects, `@bitwarden/common` 55 and `@bitwarden/auth` 32; Qwik `f7ed58cfc`:
367 in 113 files, 6 projects). Showing one project takes 623 ms on `cbf86c2` (`@bitwarden/auth`:
153 nodes drawn), 369 ms on Qwik `f7ed58cfc`; back to all, 914 and 1,617 ms (the whole layout
again). Against `main` (V7b), two rounds back to back: first paint +4–5 % on Bitwarden, select and
mark reviewed within their noise, no page errors.

**Not in V7 (later)**: collapsing a whole frame into one node (V6's summaries already cut
context); grouping findings by project in the CLI summary and PR comments; colouring projects.

### E1 — Decisions and their ripples (measured)

**Status:** measured (2026-10-04) with a spike (`spikes/e1-ripples`); merged into main
(2026-10-12, from branch `milestone/e1-explained-changes`); not planned for implementation — see
the recommendation.

**Hypothesis** (asked: "What this app could have to be disruptive?", then "I want a more precise
explanation for #1"): much of a pull request is mechanical — a rename and the call sites it
touches, moves, an argument added at every call, the same edit repeated — and could be verified
instead of read, leaving the reviewer the decisions. North Star: review decisions, not lines.

**How it was measured** (`measure.mjs`): CPR's analysis of each change, then a token diff of
every modified symbol's two versions (CPR's normalization: no formatting or comments). A changed
symbol is verified when it is:

- **moved**: CPR matched it under a new ID with identical code;
- **renamed**: a removed and an added symbol (or a moved one) equal under the change's renames;
- **ripple**: every difference is one of the change's renames, an import path, or the argument
  list of a call to a symbol whose signature changed — `linked` when it references that symbol;
- **repeat**: its edit, string and number values masked, is another symbol's edit in the same
  change (zod's 40 locales gaining `currency_code: "…"`), or new code shaped like other new code.

Renames are inferred only from the change itself: symbols CPR matched as moved under a new name,
renamed files and folders, and removed + added pairs (12 tokens or more) equal under their name
difference — as word substitutions, several per word (one change renamed `errorBoundaryName` →
`caughtErrorName` and `ErrorBoundary` → `Catch`). Everything else is a decision.

**Measured** on 165 unique changes — the pinned regression sets, the latest 15 commits touching
TypeScript of ky, zod, vite, Bitwarden and Qwik, and 35 whose subject says rename, move or
refactor (one zod change, reverted and re-applied, counted once):

| Sample | Changes | Changed symbols verified | Diff lines verified | Changes with ≥ 25 % of their lines verified |
|---|---|---|---|---|
| Pinned sets (`r1`, Bitwarden ×17, Qwik ×30) | 76 | 343 of 1,270 (27.0 %) | 1,235 of 14,080 (8.8 %) | 5 |
| Latest commits | 54 | 87 of 514 (16.9 %) | 160 of 4,068 (3.9 %) | 5 |
| Subject says rename, move or refactor | 35 | 58 of 654 (8.9 %) | 133 of 10,365 (1.3 %) | 0 |
| **All** | 165 | 488 of 2,438 (20.0 %) | 1,528 of 28,513 (5.4 %) | 10 |
| All but Qwik `f7ed58cfc` | 164 | 225 of 2,071 (10.9 %) | 740 of 26,636 (2.8 %) | 9 |

By class (all): repeated edits 148 symbols, moved 119, renamed 105, ripples 98 (31 of them an
argument added or removed at a call), repeated new code 18. One change carries most renames:
Qwik `f7ed58cfc` (Suspense → Pending, ErrorBoundary → Catch), 263 of its 367 changed symbols
verified (71.7 %). Precision: 40 verified symbols drawn at random (moves left out) and read by
hand were all mechanical — 0 false.

**What this says**

- Typical changes are decisions. Outside one large rename, a reviewer would skip 2.8 % of the
  diff lines; changes titled "refactor" restructure code rather than rename it (1.3 %).
- Verified symbols are many and small: a fifth of the change list's items, a twentieth of its
  lines. The win is fewer items to open and tick, not fewer lines to read.
- When it applies, it applies strongly: 6 of 165 changes have half their lines or more verified
  (a rename across a repo, a feature added to 40 locales, a prop changed in 24 files).

**Recommendation**: not the disruptive feature #1 was meant to be. A smaller version is worth a
viewer milestone when the change list grows long: group repeated edits ("the same edit in 24
files — values: …") and renames with their call sites, collapsed, with the proof one click away.
Without the rename inference and the argument rule, `repeat` and `moved` alone cover 285 of the 488
verified symbols, at much lower risk.

**Not measured**: member renames (an enum or interface member renamed; Qwik's `suspense` →
`pendingBoundary` flag stayed a decision), call-site rewrites beyond one argument list, and
whether the old spelling of a rename is left anywhere (an incomplete rename would be a finding).

### V8 — A smooth viewer

**Status:** planned (2026-10-12); V8a merged into main (2026-10-12, from branch
`milestone/v8a-zoom-labels`); V8b merged into main (2026-10-13, from branch
`milestone/v8b-map-clicks`); V8c merged into main (2026-10-13, from branch
`milestone/v8c-edges`); V8e merged into main (2026-10-13, from branch
`milestone/v8e-layout-worker`). **V8 closed (2026-10-13)**; V8d deferred (V8c met its targets).

**Problem** (asked: "it works really flaky and laggy. What are our options to improve the client
side viewer?"). Measured with `scripts/viewer/interactions.mjs` (new: every interaction a
reviewer does, scripted in Chromium; "blocked" sums long animation frames over 50 ms; median of
3 rounds) on today's viewer:

| Interaction | Bitwarden `737ee3f` | Bitwarden `cbf86c2` | Qwik `f7ed58cfc` |
|---|---|---|---|
| Open: took / blocked / worst frame | 674 / 310 / 262 ms | 885 / 148 / 198 ms | 2,082 / 610 / 660 ms |
| Zoom out ×20: blocked / worst frame | 30 / 63 ms | 164 / 122 ms | 603 / 134 ms |
| Next change (j) ×8: blocked / worst | 0 / 0 ms | 38 / 80 ms | 731 / 149 ms |
| Select a change: blocked / worst | 6 / 56 ms | 55 / 105 ms | 362 / 205 ms |
| Context on: blocked / worst frame | 111 / 161 ms | 212 / 236 ms | 874 / 769 ms |
| Map: file-box clicks reaching the file | 91 % | 77 % | 87 % |
| Map: page elements (edges, symbols) | 4,021 (1,417, 1,629) | 7,131 (2,733, 2,780) | 12,788 (6,681, 4,157) |

What causes it, found by profiling (CPU profiles of an unminified build) and by removing one cost
at a time (medians of 5):

1. **The map labels' zoom variable**: `--cpr-zoom` is set on the page root on every zoom frame;
   an inherited custom property restyles every element under it, though only map labels read
   it. Frozen, zoom-out blocking fell 94 → 14 ms (Bitwarden `cbf86c2`) and 507 → 150 ms (Qwik).
2. **Edges**: with `onlyRenderVisibleElements`, React Flow checks every edge's bounding box on
   every frame of a pan, zoom or animation (`isEdgeVisible`, `nodeToBox` lead the profiles), and
   edges are 38–52 % of the map's elements. Edges hidden plus the variable frozen: zoom-out
   blocking −75 to −90 %, j −39 to −67 %.
3. **Selection**: each j re-renders the whole change list and decorates every node, then animates
   the view for 300 ms; on Qwik the animation gets 4 frames — the canvas jumps in steps, and a
   selection starts moving 670 ms after the click.
4. **Layout on the main thread**: 1.9 s for Qwik `f7ed58cfc` (dagre on its biggest cluster,
   1.3 s); toggling context lays out again (worst frame 769 ms).
5. **Frames on the map catch clicks** (V7b): a frame's name is drawn above its files and takes
   the pointer; 9–23 % of the spots on file boxes zoom into the whole project instead.

**Goal**: no freeze a reviewer notices on Bitwarden-sized changes (no frame over 100 ms while
zooming, panning, pressing j or selecting), Qwik-sized ones usable (blocking halved or better),
the UI never frozen while laying out, and every click on the map landing on what is under the
pointer. Nothing a reviewer sees changes, apart from what each part says.

#### V8a — map labels (A)

- Map labels (`.file-name`, `.project-name`) keep fixed font sizes and grow with `transform:
  scale(1 / zoom)` instead of `font-size: calc(13px / zoom)`: a scale needs no text layout.
  The frames' ring (`box-shadow`) keeps its width the same way.
- The zoom value lives in a one-rule stylesheet aimed at those elements (`.file-name,
  .project-frame, .project-name { --cpr-zoom: … }`), not on the page root, so a change restyles
  them alone; it is only updated while the canvas is a map (below 45 %) or crossing into it.
- Prototype (medians of 5, zoom out ×20): Bitwarden `cbf86c2` 94 → 34 ms blocked, Qwik 507 →
  190 ms; either change alone gained little (the scale alone nothing, the scoped rule half).

#### V8b — map clicks (B)

- On the map a frame never takes the pointer, its name included; a click on an empty part of a
  frame reaches the canvas, which finds the frame under it (`screenToFlowPosition`) and zooms
  into it, as a click on a file box zooms into the file. Off the map, a click there deselects
  as today.

#### V8c — edges while moving, edges on the map (C)

- While the view moves (`onMoveStart` to `onMoveEnd`, programmatic animations included), React
  Flow gets only the selected symbol's edges; all edges come back when it stops.
- On the map, symbols' edges give way to one edge per pair of linked file boxes (pure, in
  `layoutFlow`: count, sides, crossing projects), drawn heavier by count; symbols' edges come back
  above 45 %. Expected: Qwik's map from 1,670 edges to its file pairs, a few hundred.

#### V8d — lighter selection (D)

- The change list's rows are memoized: a selection or a mark re-renders the two or three rows it
  touches, not hundreds; nodes keep their identity unless their decoration changed (today's rule).
- A selection moves the view only when the symbol is out of view (or within a margin of the
  edge); on graphs too large to animate smoothly (a node count measured in V8d), it jumps
  instead of gliding in steps.

#### V8e — layout in a worker (E)

- `layoutFlow` (pure; dagre and types only) runs in a module Web Worker. The previous layout
  stays drawn, with a small "laying out…" note, until the next arrives; requests are numbered so
  a late answer never replaces a newer one; recent layouts are kept by their options (context,
  type references, focus, project, opened groups), so toggling back is instant.
- Opening: the sidebar and findings show while the first layout runs.

**Refined before building (2026-10-13; built after V8c, V8d deferred: V8c met its targets).**
Measured in Node (median of 3), `layoutFlow` per view, and the cost of moving data between
threads (V8 serialization, as structured clone does):

| View | Bitwarden `737ee3f` | Bitwarden `cbf86c2` | Qwik `f7ed58cfc` |
|---|---|---|---|
| Default | 217 ms | 187 ms | 981 ms |
| Context off | 67 ms | 47 ms | 227 ms |
| Type references on | 217 ms | 321 ms | 1,021 ms |
| One project (the largest) | 108 ms | 215 ms | 183 ms |
| The largest group opened | 217 ms | 273 ms | 841 ms |
| The graph to a worker, once (send) | 6 ms | 39 ms | 9 ms |
| A layout back (receive) | 4–11 ms | 5–39 ms | 10–42 ms |

In the browser (V8c's results): Qwik opens with 2,348 ms blocked (worst frame 1,575 ms) and
context on blocks 1,279 ms (1,181 ms); `cbf86c2` 942 and 253 ms. Part of that is React drawing
the new layout, which stays on the main thread.

- `src/layout-worker.ts`: a module worker that holds the graph and answers `{ id, options }`
  with `layoutFlow`'s result (its Maps and Sets cross threads as they are).
- `src/layouts.ts`: `layoutKey(options)` (the same view gives the same key, whatever the order
  of its sets); a cache of the last 8 layouts by key that knows the view last asked for (an
  answer for an older one is kept, never drawn); a runner whose requests are numbered and whose
  answers are matched by number; if the worker fails, layouts run on the main thread as today.
- App: the layout memo becomes `useLayout(graph, options)` → the layout to draw and whether a
  newer one is coming. A cached view is drawn at once. The canvas fits a project, the focus or a
  group only once the layout asked for is drawn, so the view moves once. A "Laying out…" note
  shows while one is coming; on opening, the header, change list and findings show at once and
  the canvas says "Laying out…".
- Not in V8e: a faster layout (dagre still takes 1 s on Qwik, off the main thread now); React
  drawing a new layout (measured and reported separately).

#### Verification

1. **Unit tests** (red first): the zoom value set only on the map (V8a),
   the frame under a point (V8b), file-pair edges and the moving-edges filter (V8c), the
   selection-moves rule (V8d), layout requests and their order (V8e).
2. **Nothing else changes**: every e2e spec unchanged except where a part changes behavior
   (map clicks); screenshots of the map and a selection before and after.
3. **Real graphs**: `scripts/viewer/interactions.mjs` on Bitwarden `737ee3f`, `cbf86c2` and
   Qwik `f7ed58cfc`, against `main`'s build, back to back, 3 rounds; each part's targets below.
4. **Targets**: V8a — zoom out ×20 blocked ≤ 60 ms (Bitwarden `cbf86c2`), ≤ 300 ms (Qwik).
   V8b — 100 % of map file-box clicks reach the file. V8c — zoom out ×20 on Qwik ≤ 150 ms blocked;
   map edges' elements on Qwik ≤ 1,500. V8d — j ×8 on Qwik ≤ 250 ms blocked, one movement per
   step; select a change ≤ 150 ms. V8e — no frame over 200 ms on the main thread while laying out
   (open, context, groups, project) on any of the three.

**Risks**

| Risk | Mitigation |
|---|---|
| Timings vary ±30 % and more between runs (a 3× spread was seen) | Medians of 3–5 rounds, back to back against `main`; targets with margin. |
| Scaled labels blur (a raster scaled up) | No `will-change` on labels, so they are painted at the final scale; screenshots on the map. |
| Edges popping in after a move feel worse than lag | Only the selected symbol's edges stay during a move; check in the browser; fall back to drawing all edges if it reads badly. |
| A worker makes layout asynchronous: tests and the reveal/fit effects assume it is immediate | Requests numbered; the canvas fits after the layout it asked for arrives; e2e waits on nodes, as today. |

**Order**: V8a → V8b → V8c → V8d → V8e, each on its own branch from the previous, each merged
after its checks and the user's agreement.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V8a ✅ | Map labels | Labels scaled by a transform, the zoom value in a stylesheet for them only, updated only on the map. |
| V8b ✅ | Map clicks | Frames never take the pointer on the map; a click on an empty frame area zooms into it. |
| V8c ✅ | Edges | Only the selection's edges while moving; one edge per linked file pair on the map. |
| V8d (deferred) | Lighter selection | Memoized change-list rows; the view moves only for a symbol out of view, without stepped animation on large graphs. |
| V8e ✅ | Layout in a worker | `layoutFlow` off the main thread, numbered requests, recent layouts kept. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 37 | How map labels follow the zoom | **A transform from fixed sizes; the zoom value in a stylesheet rule for the labels only, updated only on the map** | The root variable restyled every element on every frame; measured −64 % zoom blocking, near the frozen bound. |
| 38 | What takes clicks on the map | **File boxes; frames never** (an empty frame area zooms in through the canvas) | Frame names caught 9–23 % of file-box clicks. |
| 39 | Which edges are drawn | **While moving (over 400 edges drawn): the selection's; on the map: one per linked file pair** | Per-frame visibility checks over every edge; edges are up to half the map's elements. Smaller changes keep every edge (V8c). |
| 40 | When a selection moves the view | **Only when the symbol is out of view; no stepped animation on large graphs** | Qwik's 300 ms glide ran in 4 frames: a jumping canvas. |
| 41 | Where layout runs | **A Web Worker; the last layout drawn until the next arrives** | 1.9 s of frozen UI on Qwik; a toggle froze it for 769 ms. As built (V8e): no long frame while a layout is made; drawing it is one frame of 0.2–0.7 s. |

#### As built — V8a

- As planned: map labels keep fixed sizes (13 px, 10 px for unchanged files, 26 px for project
  names) and are scaled by `transform: scale(1 / zoom)`; the frame name's fit to its frame's
  width became a clamp on the scale (`--frame-width` is now unitless). `mapZoomStyle`
  (`src/mapzoom.ts`) owns a one-rule stylesheet for `.file-name, .project-frame, .project-name`
  and writes the zoom there only below `MAP_ZOOM`; `MAP_ZOOM` moved there from `App.tsx`.
- Screenshots of Bitwarden `cbf86c2`'s map before and after: the same labels, sizes and places.

**Results (V8a)**, `interactions.mjs` against `main`, two alternating runs of 3 rounds each,
blocked ms (main → V8a): zoom out ×20 — Bitwarden `737ee3f` 13–35 → 0, `cbf86c2` 102–103 → 32–40
(−65 %), Qwik `f7ed58cfc` 451–466 → 193–219 (−55 %); zoom in ×10 — Qwik 107–115 → 0–5; select a
change — Qwik 342–395 → 280–283. Open, j and context toggles unchanged (V8d, V8e). Map clicks
unchanged (V8b). No page errors; 408 unit tests, 35 e2e.

#### As built — V8b

- As planned: on the map nothing of a frame takes the pointer (`.react-flow__node-project *`); the
  canvas's click handler asks `projectAt` (flow.ts) for the frame under the point and zooms into
  it, else deselects. A click on a project's name now reaches what is under the name — usually
  a file box, sometimes the frame's empty top. Off the map, nothing changed.
- README: "a click inside a frame, off its files, zooms into the project".

**Results (V8b)**: file-box clicks reaching the file on the map, `main` → V8b: Bitwarden
`737ee3f` 91 → 100 %, `cbf86c2` 77 → 100 %, Qwik `f7ed58cfc` 88 → 100 %; timings unchanged
within noise; no page errors; 409 unit tests, 35 e2e.

#### As built — V8c

- As planned, with three changes:
  - A moving view drops edges only when more than 400 would be drawn (`MOVING_EDGE_LIMIT`):
    smaller changes keep every edge while moving, so nothing pops in (the risk above). Bitwarden
    `737ee3f` (354 edges) never drops them; `cbf86c2` (683) does off the map, not on it (290
    file pairs).
  - A move starts with the view's first change (`onMove`), not with React Flow's start, which
    comes with every press: a click blinked every edge. It ends 100 ms after React Flow's end
    unless the view moves again: an animation interrupted by the next one (j pressed during a
    glide) reports its end after the next has started.
  - Edges have no invisible click path (`interactionWidth: 0`; nothing uses edge clicks or
    hovers): 3 elements per edge instead of 4.
- File boxes have two unseen React Flow handles: React Flow draws no edge between nodes without
  them. A file pair's edge is `edge-files` with a weight (`edge-files-1`…`4` for 1, 2–3, 4–9, 10+
  symbol edges; 3–12 px), its edges' side when they all share one, and `edge-cross` when one of
  them crosses projects.
- Found while measuring: the canvas's click handlers and the minimap's class function were new
  on every render, and React Flow hands them to every node and minimap node. With two more canvas
  renders per move, thousands of nodes re-rendered for an edge change. Now stable.
- Found while measuring: `interactions.mjs` read open's long frames as soon as the first symbol
  was painted, but a frame is reported after it ends: the last and longest one was missed at
  random (main's open on `737ee3f`: 135 ms in one run, 454 ms in another). It now reads them
  once the page is idle. Open numbers above (V8 table, V8a, V8b) are undercounted.

**Results (V8c)**, `interactions.mjs` against `main`, back to back, median of 3, blocked ms
(main → V8c):

| Interaction | Bitwarden `737ee3f` | Bitwarden `cbf86c2` | Qwik `f7ed58cfc` |
|---|---|---|---|
| Zoom out ×20 | 10 → 0 | 100 → 23 | 466 → 15 |
| Next change (j) ×8 | 0 → 3 | 98 → 0 | 862 → 78 |
| Select a change | 19 → 5 | 78 → 19 | 576 → 115 |
| Pan, overview | 0 → 0 | 0 → 0 | 228 → 11 |
| Mark reviewed (r) | 0 → 0 | 0 → 0 | 42 → 25 |
| Open | 443 → 478 | 755 → 942 | 2,222 → 2,348 |
| Context on | 133 → 201 | 301 → 253 | 1,149 → 1,279 |
| Map: edge elements | 1,417 → 406 | 2,733 → 871 | 6,681 → 1,378 |
| Map: page elements | 4,022 → 3,131 | 7,132 → 5,512 | 12,789 → 7,700 |

- Targets met: Qwik zoom out 15 ms blocked (≤ 150), its map's edge elements 1,378 (≤ 1,500).
  Worst frames on Qwik: zoom out 129 → 61 ms, j 191 → 109 ms, select 320 → 101 ms. On both
  Bitwarden changes no frame over 70 ms while zooming, panning, pressing j or selecting.
- Open and context: not changed by V8c, within noise. Open alternated build by build, 5 rounds
  each on `cbf86c2`, read 806 → 980 ms in one run and 929 → 868 ms in the next; a build without
  the file boxes' handles 864 and 887 ms. They are V8e's.
- Screenshots of the map and of a selection on the map (`cbf86c2`, Qwik), main and V8c: the
  same picture, with fewer, heavier lines.
- No page errors; 415 unit tests, 38 e2e.

#### As built — V8e

- As planned. `useLayout` (App) asks `workerLayouts` for the view (`layoutKey`) unless
  `LayoutCache` has it; the worker bundle is 57 kB (dagre and `flow.ts`). The canvas skips its
  fit while a layout is pending, so a project, the focus or an opened group is fitted once, when
  its layout is drawn. A `Panel` says "Laying out…" over the canvas; before the first layout the
  canvas's place says it.
- `interactions.mjs` gained "open a group" (the largest drawn, clicked on the node itself: on
  the map a file box lies over it) and "close it", and waits for a new layout to be drawn.
- Not changed: how long a layout takes (Qwik's still 1 s, now in the worker) and drawing it,
  which stays on the main thread as one long frame.

**Results (V8e)**, `interactions.mjs` against `main`, back to back, median of 3, blocked ms
(worst frame), main → V8e:

| Interaction | Bitwarden `737ee3f` | Bitwarden `cbf86c2` | Qwik `f7ed58cfc` |
|---|---|---|---|
| Open | 557 (405) → 233 (283) | 856 (647) → 307 (345) | 2,568 (1,731) → 620 (630) |
| Open the largest group | 265 (294) → 173 (157) | 1,010 (777) → 600 (412) | 1,340 (1,309) → 322 (271) |
| Close it | 208 (258) → 122 (172) | 552 (602) → 350 (400) | 1,049 (1,087) → 247 (292) |
| Context off | 32 (82) → 0 (0) | 57 (107) → 5 (55) | 424 (388) → 124 (149) |
| Context on | 223 (252) → 51 (95) | 256 (303) → 92 (137) | 1,147 (1,106) → 284 (302) |

- Timeline of opening Qwik (one run): the change list shows at 230 ms (main: 1,185 ms, after a
  955 ms frame); the worker lays out with no long frame on the page; one 693 ms frame draws the
  layout; symbols at 1,565 ms (main: 2,440 ms, after a 1,798 ms frame). Context off: 270 ms of
  "Laying out…" with no long frame, then a 290 ms frame to draw (main: one 512 ms frame); context
  back on, a view seen before: no note, one 322 ms frame (main: 945 ms).
- Target: no frame over 200 ms while laying out — met; drawing a new layout is still one frame
  of 157–693 ms (worst: Qwik's first layout; `cbf86c2`'s 404-user group, ~750 more nodes, 412 ms).
- Other interactions unchanged within noise; no page errors; 423 unit tests, 40 e2e.

**Not in V8 (later)**: drawing the map on a canvas (option F) or as one element per file
("F-lite"); a faster layout for very large clusters (dagre's 1.3 s on Qwik moves off the main
thread in V8e, but stays 1.3 s); drawing a large new layout in parts rather than one frame
(V8e: up to 693 ms); V8d (lighter selection), deferred.

### V9 — Pick two commits

**Status:** merged into main (2026-10-13, from branch `milestone/v9-commit-picker`). As built
and results: "As built — V9" below.

**Problem** (asked: "I would also like to start making a git user interface to manage the
repository … from where you can select 2 commits and go to this diff page … This should be the
first page when you type "cpr view" command. A list of commits, select 2 commits, view diff
between them."). Today `cpr view` without arguments is a usage error ("missing <base>"): the
revisions come from the command line, the server starts with one graph analyzed before it
listens, and another pair means stopping it and running again. Measured on the regression
clones (4 cores, `cpr diff`, this branch's build):

| Repo | Commits | 100 commits listed (`git log`) | One commit (`HEAD~1..HEAD`), first / second run | 20 commits |
|---|---|---|---|---|
| ky | 549 | 9 ms | 6.6 / 2.8 s | 5.6 s |
| zod | 3,247 | 66 ms | 10.4 / 6.2 s | 6.6 s |
| vite | 9,734 | 14 ms | 0.7 / 0.6 s (no TypeScript changed) | 9.5 s |
| Qwik (`--plugin qwik`) | 10,736 | 8 ms (628 ms with a cold disk) | 24.3 / 13.6 s | 23.3 s |
| Bitwarden (`--plugin angular`) | 23,236 | 23 ms | 59.1 / 46.5 s | 86.6 s |

So listing commits is instant, but a pair takes 1–90 s: the page must say what it is doing and
keep what it made. And the analysis is synchronous (ts-morph): run in the server's process, it
would stop the server answering for up to 90 s.

**Goal**: `cpr view` with no arguments opens a page listing the current branch's commits; the
reviewer picks two (or one commit, against its parent) and gets the same diff page as
`cpr view <base> <head>`, with a way back to the list. `cpr view <base> [head]` and `cpr pr` work
as today; `cpr diff`'s results do not change.

#### Commit list (V9a)

- Core: `listCommits(repo, { skip, limit })` in `packages/core/src/git/log.ts`: `git log HEAD`
  with fields separated by `%x1f` and records by `%x00` (subjects may hold anything), parsed by a
  pure `parseLog`: sha, parents, author, date, subject, refs (`%D`: branches, tags, HEAD).
  Newest first, 100 a page.
- Server: `GET /api/commits?skip=<n>` → `{ head, commits, more }`; `/api/capabilities` says
  `commits: true` when the server has a repository (`cpr view`, not `cpr pr`).
- Viewer: at `/`, when the server lists commits, a commits page instead of the graph: rows with
  the short sha, subject, author, relative date and branch/tag badges, "Load more" at the end.
  A click picks a commit; a second click picks the other end; the lower in the list (older) is
  the base. A bar shows "a1b2c3d → e4f5a6b · 12 commits" and Compare. Each row has "This commit"
  (against its first parent). Keys as in the change list: j/k move, x picks, Enter compares.
  The rules (order, label, one commit) are pure, in `src/commits.ts`.
- CLI: `cpr view [<base> [head]]`; without arguments nothing is analyzed before serving, so the
  URL prints at once.

#### Diffs on demand (V9b)

- **Where a diff lives**: `/diff/<base>..<head>/` (full SHAs). The viewer calls its API with
  relative URLs (`./api/graph`, `./api/source`, `./api/state/<name>`) and loads its files from
  `./assets/`, so under that path every call reaches that diff: the server routes
  `/diff/<pair>/api/…` to it and serves the viewer's files under any `/diff/<pair>/` prefix. A
  diff page can be reloaded or bookmarked while the server runs; reviewed marks and drafts are
  kept per pair, as today (`stateDir` keys by base..head).
- **Starting one**: `POST /api/diffs { base, head }`, a write like the others (same-origin JSON
  with the custom header). Both must be full SHAs of commits (`git cat-file -e <sha>^{commit}`,
  through `execFile`, no shell), else 400. The answer is `{ url }`; the commits page goes there.
- **What is compared**: a picked pair directly, without the merge-base (`--no-merge-base`): the
  diff between the two commits. `cpr view <base> [head]` keeps comparing with the merge-base, as
  `cpr diff` and pull requests do.
- **Where it runs**: a child process of the CLI per analysis (`cpr diff <base> <head>
  --no-merge-base --json` with the server's `--plugin`, `--project` and `--depth`), so the server
  keeps answering, the analysis's memory is freed when it ends, and it can be stopped. Its phases
  (checkout, load base, load head, extract, references, findings) come over IPC from an `onPhase`
  callback added to `analyzeGit`; nothing else in core changes. One runs at a time, in the order
  asked.
- **While it runs**: `GET /diff/<pair>/api/graph` answers 202 `{ phase, elapsedMs, queued }`;
  the page shows "Analyzing a1b2c3d → e4f5a6b — loading head · 12 s" with Stop, and asks again
  every 500 ms; then 200 with the graph, as today. A failure shows the CLI's message and the way
  back. Leaving the page does not stop it: the result is kept.
- **Kept**: the last 8 graphs, in memory, while the server runs; asking for one again is instant.
- `cpr view <base> [head]` analyzes as today (before serving, in its own process), registers that
  diff and opens `/diff/<from>..<head>/`; its commits page is at `/`. `cpr pr` is unchanged: one
  graph at `/`. A diff page served by `cpr view` has "← Commits" in its header.

#### Verification

1. **Unit** (red first): `parseLog` (merges with two parents, refs, a subject holding the
   separators, the root commit); `src/commits.ts` (base and head by list position, one commit
   against its parent, the label); server: `/api/commits` pages, `POST /api/diffs` refusals (not a
   SHA, not a commit, another site), a diff's 202 → 200 with a fake runner, sources and state per
   diff, Stop; `onPhase` called in order with the same analysis.
2. **Nothing else changes**: goldens and the `r1` regression set identical; every existing e2e
   spec passes (`cpr view HEAD~1 HEAD` now opens `/diff/<pair>/`; `cpr pr` as before).
3. **E2E**: a fixture repo of 5 commits served by `cpr view` without arguments: the list newest
   first; pick two → "Analyzing…" → the graph; "← Commits"; "This commit"; reload a diff URL.
4. **Real repos**: `cpr view` in the Bitwarden and Qwik clones: the commits page in under 1 s; a
   pair's time against `cpr diff` (within 10 % + the child's start); the server answering status
   requests during an analysis in under 100 ms.
5. **Cost**: `cpr view <base>` as fast as today.

**Risks**

| Risk | Mitigation |
|---|---|
| A pair takes up to 90 s on large repos (Bitwarden) | Progress by phase and elapsed time; Stop; results kept; one run at a time. |
| A child process per diff adds a start (Node, ts-morph) | Measured against today; small next to 3–90 s. |
| Input from the page reaching git | Only full SHAs verified as commits; `execFile`; writes need the same-origin rules. |
| Paths under `/diff/<pair>/` break the viewer's files | The viewer is built with relative URLs (`base: './'`); e2e reloads a diff URL. |
| A stopped run leaves worktree locks | Locks hold the owner's pid; stale ones are recovered (`worktree.ts`). |

**Order**: V9a (the list), then V9b (diffs), on one branch: the list alone compares nothing.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V9a ✅ | Commit list | `listCommits`, `/api/commits`, the commits page, `cpr view` without arguments. |
| V9b ✅ | Diffs on demand | `/diff/<pair>/`, `POST /api/diffs`, child-process runs with phases, the progress page with Stop, kept graphs, "← Commits". |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 42 | What `cpr view` opens without arguments | **The current branch's commits: pick two, or one against its parent** | It was a usage error; 100 commits list in 9–66 ms, even with 23,236. |
| 43 | How a picked pair is compared | **Directly, without the merge-base; the older is the base** | "The diff between them"; the merge-base suits a branch against its target (`cpr view <base>`, pull requests). |
| 44 | Where a diff lives | **`/diff/<base>..<head>/`, the viewer's relative API under it** | One server, many diffs; reload and back work; review state is already per pair. |
| 45 | Where an analysis runs | **A child process of the CLI, one at a time, with Stop** | The analysis is synchronous: in the server it would block it for up to 90 s; a process frees its memory and can be stopped. |
| 46 | What is kept | **The last 8 graphs, in memory, while the server runs** | A pair takes 3–90 s; going back must be instant. On disk later. |

#### As built — V9

- **Core**: `listCommits(repo, { skip, limit })` in `src/git/log.ts` returns `{ branch, commits,
  more }` (`branch` is null for a detached HEAD; the plan said `head`). Refs come from `%D` with
  full names as `{ kind: head | branch | remote | tag, name }`; a remote's `HEAD` and refs outside
  `heads/`, `tags/`, `remotes/` (`refs/cpr/*` from `cpr pr`, the stash) are left out. The
  subject is the last field, so one holding the separators is read whole. `isCommit` takes only
  full SHAs (40 or 64 hex). `analyzeGit`'s `onPhase` reports `checkout`, `loadBase`,
  `loadHead`, `extract`, `references`, `findings` as each starts; `--since`'s extra extraction
  reports nothing.
- **Server** (`packages/cli/src/server.ts`): one "site" per graph — its sources, review state
  and reviews — at `/` for `cpr pr`, under `/diff/<base>..<head>/` for `cpr view`
  (`/diff/<pair>` redirects to the trailing slash). A diff's `api/graph` answers 200 (graph),
  202 `{ base, head, status, phase | queued, elapsedMs }` (`elapsedMs` since asked: waiting
  counts), 502 `{ base, head, error }` (the CLI's `cpr: …` lines), 404 `{ base, head }`.
  Stop is `POST /api/diffs/stop { base, head }`. Capabilities say `commits: true` under
  `cpr view` only; there the root's `/api/graph` is 404.
- **Runs** (`diffs.ts`, `runner.ts`): `Diffs` queues pairs, runs one at a time, keeps failures
  until asked again and the last 8 graphs by use (a graph opened again moves to the end).
  `childRunner` spawns `node [execArgv] bin.js diff <base> <head> --no-merge-base --json
  --depth n [--plugin …] [--project …]` with an IPC channel; the CLI sends `{ phase }` when it
  has one (`CliContext.onPhase`). The child's hints and warnings go to `cpr view`'s terminal,
  prefixed with the pair. Stop sends SIGTERM to the node child only: a `git checkout` it started
  finishes, so no slot is left half checked out, and the slot's pid lock is recovered as stale
  (a run started within that checkout can meet its index lock and fail: "Analyze again").
  Stopping the server stops every run.
- **Viewer**: `src/commits.ts` (pure) and `src/CommitsPage.tsx`. A click picks, a picked commit is
  unpicked, a third replaces the last picked. The label counts the commits head adds to base,
  walked through the listed commits' parents (the rows between them would count commits of
  other lines). A diff page opened anew (a bookmark, a restarted server) starts its own analysis;
  404 while polling (stopped elsewhere) shows "not analyzed" with "Analyze again"; a failure
  shows the message and "Analyze again". `App` loads capabilities, then the graph, and polls
  while it gets 202.
- **CLI**: `cpr view [<base> [head]]`; `--since` without `<base>` is a usage error. With a pair,
  the URL printed and opened is the diff's (`/diff/<from>..<head>/`); its review state is in the
  same folder as before (`stateDir` keys by base..head).
- Trap: the stylesheet is flat, and `.progress` was already the sidebar's review bar; the
  progress page uses `.diff-progress` (an e2e check holds the bar's margin at 0).

**Results (V9)**, 4 cores, the regression clones, `HEAD~1..HEAD`, warm (worktrees made), 2 rounds:

| | Qwik (`--plugin qwik`) | Bitwarden (`--plugin angular`) |
|---|---|---|
| `cpr view` prints its URL | 0.58–0.64 s | 0.58 s |
| `/api/commits` (100 commits) | 33–104 ms | 42–166 ms |
| A pair picked → its graph served | 13.8–14.3 s | 41.6–43.2 s |
| `cpr diff` of the same pair | 14.2–15.1 s | 39.8–40.2 s |
| Status requests during the analysis: median (max) | 1.8 ms (17 ms) | 1.8 ms (20 ms) |
| The pair asked again (kept) | 1.4–3 ms | 6–10 ms (206 kB) |

- A pair through the server against `cpr diff`: Qwik −3 to −5 %, Bitwarden +3.5 to +8.4 % —
  within the target (10 % plus the child's start, 0.7 s). The server answered 135–421 status
  requests per run, none over 20 ms.
- Phases (polled every 100 ms): the child starts in 0.7 s (Node, ts-morph), checks out in 0.1 s;
  Qwik loads base 6.8 s and head 6.4 s, then extract, references and findings take 0.3 s
  together; Bitwarden loads base 18.6–20.4 s and head 15.2–16.5 s, then extract 0.1 s,
  references 4.9–6.0 s, findings 0.7 s.
- In Chromium on Qwik: the URL printed after 0.60 s, 100 rows drawn 0.24–0.26 s after opening
  (target: under 1 s); two rows four apart labelled "5 commits" (`git rev-list --count`: 5);
  no page errors. Long subjects first widened the page past the window (the brand, dates and
  Compare off screen): `.commits` now has `contain: inline-size`, and the e2e fixture holds a
  long subject. A picked pair's header showed its SHAs twice in full; a ref equal to its SHA is
  now shown short.
- `cpr view HEAD~1 HEAD --plugin qwik` to its URL, 3 runs alternating: `main` 13.1–14.5 s, V9
  13.2–14.5 s.
- `r1`: 29 comparisons identical (859 edges, no finding changed), time 0.97 of `main`'s.
- Tests: 466 unit (33 new, with the guard against names differing only by case), 45 e2e (5 new; the 40 others unchanged, `cpr view HEAD~1 HEAD` now
  opening `/diff/<pair>/`).
- Not verified: Windows and macOS (spawning the CLI, signals); a server restarted while a diff
  page polls (the page then starts the analysis again, by design, but no test restarts it).

**Not in V9 (later)**: uncommitted changes as a head (analysis reads commits only); other
branches and tags (a ref picker), search through history; branch lanes; a commit's details
(message body, files); graphs kept on disk across runs; managing the repository (checkout,
branches, commits) — the larger git interface this starts.

### V10 — A commit graph

**Status:** V10a merged into main (2026-10-13, from branch `milestone/v10-commit-graph`; "As
built — V10a" below). V10c and V10b refined, built and merged on their own (2026-10-14): see "V10c — Picks across branches" and "V10b — Branches panel"
after V17.

**Problem** (asked: "I want to see the tree on the left, with branch divergence … if that is
possible"; "I want to see all the commits, from any branches, not only from the branch, with a
tree structure"; "exactly like git extension, or gitty up, the entire flow of the commits, with
the branch trees on the left" — a graph and a branches panel, as Git Extensions and Gittyup
have; "How much time it takes to load 100.000 commits, can't we lazy load"; "tags should only be
in the row, as a head … the tree should be branches only"). The commits page (V9) lists
`git log HEAD` in date order as plain rows, 100 at a time. Nothing says which rows are the
branch's own line and which came in through a merge, and other branches are not listed.
Measured on this repository, the regression clones and CPython (fresh clones of the history
only, no commit-graph file). Lanes are `layoutLanes`'s (V10a) over the whole history, checked
against git by `scripts/viewer/lanes-check.mjs`; the planning prototype undercounted them (see
"As built — V10a"):

| Repo | Local / remote branches (not merged into HEAD) / tags | This branch, first 100 rows: from merged branches / merges | Every branch: rows | Of its first 100 rows, not on this branch | Remote branch tips: median row (deepest) | Widest row, lines whole (git `--graph`) | Widest row, lines over 100 rows as arrows (arrows) |
|---|---|---|---|---|---|---|---|
| CPR | 1 / 50 (0) / 0 | 66 / 20 | 179 | 0 | 116 (175) | 3 (3) | 3 (0) |
| ky | 1 / 2 (1) / 99 | 0 / 0 | 593 | 0 | 1 (173) | 2 (2) | 2 (0) |
| zod | 1 / 154 (128) / 219 | 0 / 0 | 4,239 | 48 | 978 (4,058) | 10 (9) | 7 (14) |
| vite | 1 / 88 (85) / 1,054 | 0 / 0 | 10,359 | 56 | 691 (9,260) | 53 (54) | 3 (75) |
| Qwik | 1 / 133 (125) / 559 | 57 / 44 | 12,362 | 62 | 3,695 (8,889) | 37 (35) | 10 (240) |
| Bitwarden | 1 / 1,591 (1,539) / 638 | 0 / 0 | 39,861 | 93 | 9,165 (37,633) | 142 (143) | 20 (1,939) |
| CPython | 1 / 6 (5) / 676 | 0 / 0 | 150,182 | 0 | 11,068 (33,309) | 37 (37) | 35 (169) |

Arrow counts corrected (2026-10-14): `lanes-check.mjs` gave each root commit a parent outside
the history, an arrow too many per root above the last 100 rows (zod 15, Qwik 241, Bitwarden
1,943 as first published); lane widths were right.

- Repositories that merge with merge commits (CPR, Qwik) list side-branch commits among the
  branch's own: 66 and 57 of the first 100 rows, with nothing telling them apart. V9 met this
  already: counting the rows between two picks was wrong, so the label walks parents.
- Squash-merging repositories (ky, zod, vite, Bitwarden) are one line on their branch: their
  divergence is in the branches not listed, up to 1,539 unmerged ones on Bitwarden. With every
  branch, 48–93 of the first 100 rows are on other branches; HEAD is still in rows 1–7.
- Branch tips sit deep: Bitwarden's median remote tip is row 9,165 (95 of 1,591 in the first
  1,000 rows), CPython's 11,068. A panel whose click goes to a branch cannot page its way there.
- Git orders the whole history before its first row unless the repository has a commit-graph
  file (`git gc` and `git maintenance` write one; a fresh clone has none). Without one, the first
  row of Bitwarden comes after 243 ms, of CPython after 762–776 ms; with one, after 42 ms and
  6 ms. The order of every row is known soon after: 344 ms and 1.2 s without the file (with it
  622 ms and 2.0 s: the incremental walk is slower in total).
- What is heavy is the rows' details, not the order: CPython's 150,182 rows with subject, author,
  date and refs are 30.5 MB (Bitwarden's 39,861: 7.5 MB). The shape alone, each row's parents as
  row numbers, is 1.32 MB (0.34 MB); lanes over it take 62 ms (24 ms). Details for 200 rows
  fetched by SHA take 16–20 ms, about 40 kB, wherever they are in the history.
- Lines drawn whole, as the tools named do, need 142 lanes on Bitwarden (git's own `--graph`:
  143), 53 on vite, 37 on Qwik and CPython: a branch that forked long ago keeps its line open down
  to its fork. Cutting lines over 100 rows into two arrows, as gitk does, takes Bitwarden to 20,
  vite to 3, Qwik to 10; CPython stays at 35 (its width is parallel maintenance branches).
- Tags as tips of the graph explode it: CPython's 676 tags reach 22,214 commits no branch does,
  and its widest row goes from 37 lanes to 2,449 (git's `--graph` agrees, and takes 15 s to draw
  it). Bitwarden's tags reach 1,497 such commits, vite's 401.
- Order: `git log`'s default (commit date) can list a parent above its child when clocks are
  skewed, which no graph can draw. Date order (`--date-order`) keeps children first but
  interleaves lines: in the first prototype Qwik's own branch needed 13–15 lanes instead of 7–11
  in graph order (`--topo-order`), zod with remotes 5–12 instead of 4.

**Goal**: `cpr view` opens on the whole history of every branch, local and remote, drawn as a
graph left of the rows, with a branches panel left of the graph. The current branch is the
straight line on the left; other branches leave a line where they diverged and join it where
they were merged; a line longer than 100 rows is two arrows; the scrollbar spans the whole
history, and the rows' details load as they come into view. Tags show as badges on their commits' rows, as today. The
panel lists local branches (with how far each has diverged from its upstream) and remote
branches by remote and folder; a click goes to the tip. Two picks on diverged branches compare
what one adds since they forked; picks on one line compare as today. "This branch" narrows the
list to V9's. `cpr view <base> [head]`, `cpr diff` and `cpr pr` do not change. A sketch
(`origin/feature/q3` is made up):

```
Filter branches     │ ●           d4d2d32  Docs: V9 merged                 main  origin/main
▾ Local             │ │ ●         9c1e0aa  Q3: route loaders typed         origin/feature/q3
  ● main  ↑1        │ ●─┼─╮       db1acce  Merge V9: pick two commits      v0.9
    milestone/v10   │ │ │ ●       fb0050b  Fix: a key pressed as soon as …
▾ Remotes           │ │ │ ●       6ac99b5  Plan V9: pick two commits
  ▾ origin          │ ●─┼─╯       b6b0016  Docs: V8e merged, V8 closed
    ▸ milestone/ 27 │ │ │         ░░░░░░░  ░░░░░░░░░░░░░░░  (details loading)
    ▸ fix/ 4        │
```

#### History, loaded lazily (core, server)

- **Tips**: `HEAD`, `--branches`, `--remotes` (scope `all`, the default) or `HEAD` alone (scope
  `current`, as V9). Never tags (decision 48) and never `--all` (the stash, `refs/cpr/*`). Only
  the scope's name comes from the request, checked against the two; the revisions are fixed.
- **The order, once**: the server streams `git log --topo-order -z --format=%H%x1f%P` over the
  tips (graph order: every commit above its parents, a branch's commits together, what
  `git log --graph` draws) and keeps, per scope, the SHAs in order and each row's parents as row
  numbers. It is made again when the refs change: the server compares `git for-each-ref`'s
  output (10–79 ms) when the page asks for the history.
- **Core**: `streamHistory(repo, scope, onRows)` in `src/git/log.ts` (rows as git gives them),
  `commitDetails(repo, shas)` (`git log --no-walk=unsorted` with V9's format, parsed by
  `parseLog`), `listRefs(repo)` (one `git for-each-ref` over `refs/heads` and `refs/remotes`:
  branches with `upstream`, `ahead`, `behind`, `gone`; remotes without their `HEAD`).
  `listCommits` and `parseLog` stay for V9's callers.
- **API**:
  - `GET /api/history?scope=…&rows=<from>-<to>` → the details of those rows (at most 500), from
    the kept order. It answers as soon as git has listed them: the first 200 rows do not wait for
    the whole walk.
  - `GET /api/history/shape?scope=…` → `{ version, rows, head, parents }` (`head`: HEAD's row;
    `parents`: row numbers) once the whole order is known. `version` changes with the refs; rows
    asked with an older version answer 409, and the page loads anew.
  - `GET /api/refs?scope=…` → the branches and remotes, each with its tip's row (null when the
    scope does not list it).
- **Hint**: when the order took over 500 ms and the repository has no commit-graph file, the
  terminal says once that `git commit-graph write --reachable` (or `git maintenance start`) makes
  the first rows come at once. CPR does not write it: that would change the user's repository.

#### Lanes (viewer, pure)

`layoutLanes(parents, head)` in `src/lanes.ts`, over row numbers, gives each row: `lane` (the
column of its dot), `through` (lanes passing by), `from` (lanes ending in its dot from above: its
children's lines, so branches diverged here when there are two or more), `to` (one lane per
parent below; a merge has two or more) and `width`. Rules:

1. Lane 0 is the current branch's first-parent line (HEAD, its first parent, …): the straight
   line on the left, however many tips are newer.
2. A commit takes the leftmost lane waiting for it; a new tip takes the leftmost free lane; a
   lane whose line ended is free again. A first parent continues in the child's lane.
3. Lines never shift sideways: a line bends only where it starts or ends, so each row is drawn
   from its own data.
4. A line to a parent more than 100 rows below is cut: an arrow under the child, one over the
   parent, no lane between (decision 50). HEAD's line is never cut; a line that can join a lane
   already going to its parent joins it. The first rows are drawn from their own parents before
   the shape arrives (a parent not yet listed counts as below the last row).

#### Drawing (viewer)

- Rows have a fixed height (about today's 33 px) and only those in view (and a screen around) are
  in the page. Their details are asked for in blocks of 200 as they come near; a row whose
  details have not come yet shows its graph and grey bars. The cursor's scrolling and j/k work by
  row number, not by element.
- A graph cell at the left of each row: an inline `<svg>` of the row's full height, its top half
  the lines from children, its bottom half the lines to parents, a curve where a line changes
  lane. The cell spans the row's padding and border, so lines join across rows.
- Lanes 14 px apart, narrowed down to 6 px when the widest row would pass 240 px; past 6 px the
  column widens (CPython's 35 lanes: 240 px at 6.9 px).
- An arrow says how far its other end is ("Its parent is 441 rows below: click to go there");
  a click moves the cursor there.
- A lane keeps one color from start to end: lane 0 the accent (`--moved`), the others a palette
  of six tokens with light and dark values. A merge is a hollow dot. A picked commit's dot gets a
  ring; the fork point of two diverged picks a dashed one.
- Badges as today: branches, remotes and tags on their commit's row; tags only there.
- The page opens with the cursor on HEAD's row. The `○/●` pick column and the row's picked
  background stay.

#### Branches panel (viewer)

- Left of the graph, its own scroll, about 260 px wide (hidden behind a "Branches" button under
  900 px). Branches only:
  - **Local**: the current branch first (●), then by name; each with `↑2 ↓1` against its
    upstream (title: "2 commits not pushed to origin/main, 1 not pulled"), `gone` when the
    upstream was deleted.
  - **Remotes**: per remote, then folders by `/` (`milestone/`, `fix/`), each folder with its
    count; folders start closed.
- A filter box on top narrows both by name and opens the folders that match (Bitwarden: 1,591
  remote branches).
- A click puts the cursor on the branch's tip row and scrolls it to the middle (its details load
  as any rows in view); the row flashes. Under "This branch", a tip not listed switches to every
  branch first.

#### This branch (viewer)

- In the title: "All branches · This branch". The choice is kept in the page's URL
  (`/?scope=current`), so a reload keeps it; changing it clears the picks.

#### Picking across branches (viewer, server)

- One pick an ancestor of the other: as today. In graph order the ancestor is the lower, so it is
  the base.
- Neither (diverged): the label says "a1b2c3d ⑂ e4f5a6b · forked at 9f8e7d6: 3 and 5 commits"
  (each side's commits since the fork, walked through the shape), and the fork point's row is
  marked. Compare analyzes the fork point against head: what head's branch adds since they
  diverged, as `cpr view <base> <head>` and pull requests do. The lower pick is the base; Swap
  exchanges them.
- Server: `POST /api/diffs { base, head, from: 'fork' }` checks both with `isCommit`, resolves
  `git merge-base` (execFile) and answers the URL of `/diff/<fork>..<head>/`. Unrelated
  histories: 400 "these commits share no history".

#### Verification

1. **Unit** (red first): `streamHistory` on a fixture repository with a merged branch, an
   unmerged one, a local branch ahead of and behind its upstream, a remote-only branch, a tag on
   no branch, a stash and a `refs/cpr/*` ref (the last three never listed); a child dated before
   its parent still listed above it; `current` lists V9's commits. `commitDetails` in the order
   asked, tags among the refs. `listRefs`: ahead/behind, `gone`, no remote `HEAD`, no tags. The
   server: rows before the walk ends, the shape after, rows past the end, more than 500 rows
   refused, 409 after the refs change, one walk per scope and refs state. `layoutLanes`: one
   line; a merged branch (fork and merge rows); two branches from one commit; an octopus merge;
   a tip newer than HEAD (lane 0 stays HEAD's); a lane freed and reused; a parent not yet listed
   (open to the bottom); a detached HEAD; the first rows keep their lanes when the shape comes.
   The panel tree (pure): folders by `/`, counts, the filter opening folders. `comparison`:
   ancestor picks unchanged; diverged picks (label, Swap). `POST /api/diffs` with `from: 'fork'`.
2. **Nothing else changes**: no analysis code is touched; goldens identical; `cpr diff` and
   `cpr pr` tests unchanged; every e2e spec passes.
3. **The graph is git's**: a script checks `layoutLanes` over the whole history of CPR, Qwik,
   Bitwarden and CPython against `git log --topo-order`'s parents: each row's lines reach
   exactly its parents' rows, lane 0 holds exactly the first-parent line, and the widest row
   matches the Problem table.
4. **E2E** (`serveCommits` grows a merged branch, an unmerged local one, a remote-only one, a tag
   on no branch and an upstream ahead): a graph cell per row (`data-lane`); every branch listed,
   the tag only as a badge, "This branch" and the URL; rows' details arriving on scroll; the
   panel (sections, a folder, the filter, a click going to the tip); diverged picks → the fork
   point's diff; Swap; the keys as before; no sideways scroll with the widest graph; screenshots
   light and dark.
5. **Real repos** (`viewer-check`), without a commit-graph file and with one: `cpr view` on Qwik,
   Bitwarden and CPython — the first rows drawn (target: under 1 s on CPython without the file,
   under 0.3 s with it), the shape in, scrolling top to bottom and a panel click to the deepest
   tip with no frame over 100 ms; the browser's memory after scrolling CPython end to end.
6. **Cost**: 200 rows' details under 50 ms anywhere in the history; the shape under 2.5 s on
   CPython (git: 1.2–2.0 s), under 700 ms on Bitwarden; `/api/refs` under 150 ms.

**Risks**

| Risk | Mitigation |
|---|---|
| Large histories (CPython: 150,182 rows, 30.5 MB of details) | Only the shape for every row (1.32 MB); details for the rows in view, 200 at a time (20 ms); rows virtualized. Not measured beyond CPython (the Linux kernel has over 1.3 million commits). |
| The first row waits for git's ordering (CPython 0.77 s without a commit-graph file) | The rows come as soon as git has them; the hint names the command that makes it instant; the page shows "Listing commits…" meanwhile. |
| Refs move while the page is open (a fetch) | Rows and shape carry the history's version; an old version answers 409 and the page lists anew. |
| Wide graphs (lines whole: Bitwarden 142 lanes, vite 53, Qwik 37) | Lines over 100 rows are arrows (Bitwarden 20, vite 3, Qwik 10); spacing narrows to 6 px; "This branch". |
| Most rows are other people's branches (Bitwarden: 93 of the first 100) | The current branch is lane 0; the page opens on HEAD; the panel; "This branch". |
| 1,591 remote branches in a panel | Folders closed at first, counts, the filter. |
| Rows' padding and borders break lines between rows | Fixed row height; the cell spans the whole row; e2e checks lines meet. |
| Dates no longer fall steadily down the list (a branch's commits are kept together) | It is `git log --graph`'s order; the date column stays. |
| Diverged picks: the reader expects a direct diff | The label says "forked at …"; Swap; a direct diff only if asked for (decision 52). |

**Order**: on one branch, merged together. V10a (the history as a graph, lazily) first; V10b (the
panel) next, since a click must reach any tip; V10c (picks across branches), since every branch
listed makes diverged picks common; "This branch" with V10a.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V10a ✅ | The history as a graph | `streamHistory`, `commitDetails`; the kept order per scope and refs state; `/api/history` (rows, shape); `layoutLanes`; virtualized rows with a graph cell, lane colors and details by block; the cursor on HEAD; "This branch"; the commit-graph hint; the check against git. |
| V10b | Branches panel | `listRefs` and `/api/refs` with tip rows; Local (ahead/behind) and Remotes by remote and folder; the filter; a click to the tip. |
| V10c | Picks across branches | The diverged label, the fork point marked, Compare from the fork point (`from: 'fork'`), Swap. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 47 | Row order | **Graph order (`--topo-order`)** | A graph needs every commit above its parents; date order interleaves lines (Qwik 13–15 lanes against 7–11, zod 5–12 against 4); it is what `git log --graph` shows. |
| 48 | Which commits | **Every branch, local and remote, and HEAD; "This branch" on demand. Tags only as badges on their rows; not the stash or `refs/cpr/*`** | Asked: "all the commits, from any branches" and "tags should only be in the row … the tree should be branches only". As tips, CPython's tags take its graph from 37 lanes to 2,449. |
| 49 | Lane rules | **Lane 0 is HEAD's first-parent line; lines never shift sideways; the leftmost free lane is reused** | The current branch is always the straight line on the left; each row is drawn from its own data. |
| 50 | Long lines | **Lines over 100 rows as two arrows (gitk's way): hover says how far, a click goes there; HEAD's line never cut** | First "drawn whole" (asked: "exactly like git extension, or gitty up … the entire flow"); then measured with the real lanes, whole lines need 142 lanes on Bitwarden (git `--graph`: 143), 53 on vite, 37 on Qwik; asked again with those numbers, the user chose arrows: 20, 3 and 10 lanes. |
| 51 | How the history loads | **The order once, on the server (kept per scope and refs state); the shape of every row to the viewer; the details of the rows in view, 200 at a time** | Asked: "can't we lazy load". Git orders everything before the first row anyway (CPython 0.77 s, 6 ms with a commit-graph file); the details are the weight (30.5 MB on CPython against a 1.32 MB shape); 200 rows' details take 20 ms anywhere; tips sit deep (median row 9,165–11,068), so the panel needs every row's place. |
| 52 | What diverged picks compare | **The fork point (merge-base) against head; the lower pick is the base; Swap** | What a branch adds since it forked is what a pull request shows; directly, base's own changes would show as reverted. For a commit and its ancestor the merge-base is the ancestor, so V9's picks compare as before. |
| 53 | The left panel | **Branches only: Local (with ahead/behind), Remotes by remote and folder; a filter; a click goes to the tip** | Asked: "graph + branches panel", "the tree should be branches only". Bitwarden's 1,591 remote branches need folders and a filter. |

**Not in V10 (later)**: hiding branches from the graph (checkboxes in the panel); a commit's
details (message, files); repository actions from the panel (checkout, delete, fetch); histories
beyond CPython's size (browsers cap an element's height: Chromium at 33.5 million px, about a
million rows of 32 px; the Linux kernel has 1.3 million commits); uncommitted changes as a row;
a direct diff of diverged picks; a lane layout that moves lines left as lanes free up (git
`--graph`'s p95 is lower: Bitwarden 90 against 112 lanes whole).

#### As built — V10a

- **Core** (`src/git/log.ts`): `streamHistory(repo, scope, onRows)` streams `git log
  --topo-order -z --format=%H%x1f%P` (a new `gitStream` in `exec.ts`); `commitDetails(repo,
  shas)` reads rows by SHA (`--no-walk=unsorted`, V9's format, full SHAs only);
  `historyState(repo)` gives the branch, HEAD and a version (a hash of HEAD and `for-each-ref`
  over `refs/heads` and `refs/remotes`: tags do not change it); `hasCommitGraph(repo)`.
  `listCommits` and `/api/commits` are gone: the history serves both scopes, and nothing else
  called them.
- **Server** (`packages/cli/src/history.ts`): `Histories` keeps one listing per scope until the
  version changes; a request without a version checks it (and lists anew), one with a stale
  version answers 409. `GET /api/history?scope=&from=&to=&version=` (at most 500 rows; it waits
  only until `to` rows are listed) and `GET /api/history/shape?scope=&version=` (the plan had
  `rows=<from>-<to>`). After a listing over 500 ms in a repository without a commit-graph file,
  `cpr view` prints once: "hint: listing 150,182 commits took 1.2 s; `git commit-graph write
  --reachable` (or `git maintenance start`) lets git list them at once".
- **Lanes** (`src/lanes.ts`, pure): as planned, plus arrows for lines over `LONG_LINE` (100)
  rows (`down`, `up` per row). A line joins a lane already going to its parent rather than be
  cut. Before the shape arrives the first page's parents are numbered by `parentRows` (a parent
  not listed gets its own negative number); a line to one is cut when more than 100 rows
  follow, so only the first page's last 100 rows can change when the shape comes.
  `laneSpacing(lanes)`: 14 px, down to 6.
- **Drawing** (`src/GraphCell.tsx`, `src/CommitsPage.tsx`): rows 32 px high, absolutely placed,
  without borders (lines run from row to row); only rows near the view are in the page (35 at
  1440 × 900), details asked for by block of 200 (`blocksAround`). Lane colors are
  `--lane-1`…`--lane-6` with dark values, set as `color` per lane class so lines and dots use
  `currentColor`. "All branches · This branch (main)" in the title, `?scope=current` in the URL.
  The cursor starts on HEAD.
- **Badges**: a row shows three refs at most, then "+N" naming the rest. Qwik's HEAD row carries
  nine tags: on `main` its subject was squeezed to nothing (a first row Playwright saw as hidden).
- **Picks** carry their row (`Picked`); `comparison` counts through the shape's row numbers.
- Trap: the planning prototype did not count a side branch's line down to its fork on HEAD's
  line, and gave Bitwarden 17 lanes where the real layout (and git) needs 142. The check script
  found it on the first run; decision 50 was asked again with the real numbers.
- Trap: in this machine's headless Chromium (WSL) the first layout of the stylesheet's font
  stacks costs 400–1,000 ms per page (`ui-monospace, SFMono-Regular, Menlo` alone: 347 ms; plain
  `monospace`: 4 ms). It predates V10 (`main` pays it too) and a Windows browser does not;
  timings below are also given with plain fonts.

**Results (V10a)**, 4 cores, WSL, fresh clones without a commit-graph file:

| | CPR | Qwik | Bitwarden | CPython |
|---|---|---|---|---|
| Rows (every branch) | 181 | 12,362 | 39,861 | 150,182 |
| First listing (git's walk), server | 0.02 s | 0.08 s | 0.28 s | 0.80 s |
| First rows, warm server, plain fonts: `main` / V10 | 101–119 / 107–148 ms | 87–96 / 102–104 ms | 90–96 / 106–133 ms | 90–94 / 114–120 ms |
| Shape received, warm server; longest task | — | 74–75 ms; none | 78–79 ms; none | 83 ms; 62 ms (lanes) |
| Lanes (`layoutLanes`) | 0 ms | 6 ms | 22 ms | 67 ms |
| Scrolling 30 screens, jumping to the middle and end: longest task | — | 0 ms | 0 ms | 0 ms |
| Browser heap after scrolling | — | 17 MB | 25 MB | 72 MB |

- `lanes-check.mjs`: 0 errors on CPR, ky, zod, vite, Qwik, Bitwarden and CPython (every line
  ends in its parent's row, every arrow has its partner, lane 0 is exactly HEAD's first-parent
  line).
- A cold server pays git's walk once per scope: CPython's first rows at 0.93 s, its shape at
  1.23 s (plain fonts). `main` lists 100 commits of one branch without that walk.
- Tests: 495 unit (core `log` 14, `Histories` 8, server 2 new, `lanes` 13, `commits` 15), 48 e2e
  (3 new: every branch and "This branch"; 450 commits: rows near the view, details on scroll,
  arrows). Not verified: Windows and macOS browsers; Firefox's and Safari's element height caps
  (Firefox about 17.9 million px: 559,000 rows).

### V11 — Checkout from the commits page

**Status:** merged into main (2026-10-13, from branch `milestone/v11-checkout`): V11b and V11c;
V11a dropped (the user: V10a's "All branches · This branch" switch already does it). As built and
results: "As built — V11" below.

**Problem** (asked: "let's make a mini git extension out of this … checkout to branch/commit/
tag as a first feature, also, a checkbox with Show only this branch commits"). The commits page
shows every branch (V10a) but changes nothing: to check out what it shows, the reviewer goes to
a terminal. And the page does not notice. On a clone of this repository, after `git switch
--detach HEAD~5` in a terminal, the open page still showed HEAD at `78ca95a`, before and after
scrolling to the end: its 181 rows were all in the first block, so it asked for nothing and met
no 409. Only a reload showed `41e6cc1`. On a longer history it notices only when it asks for a
new block ("The branches moved…").

What git does, measured on that clone (713 files):

| Case | `git switch` |
|---|---|
| To a commit 60 back (647 files differ) / the first commit (104) / back to the tip (713) | 18 / 6 / 54 ms |
| A local change to a file the target does not change | carried along (` M .editorconfig` after) |
| A local change to a file the target changes | refused, nothing changed: "Your local changes to the following files would be overwritten by checkout: README.md" |
| A branch checked out in another worktree | refused: "'other-branch' is already used by worktree at …" |
| `git switch <name>` for a remote-only branch | creates `<name>` tracking `origin/<name>` |
| Counting local changes (`git status --porcelain=v2 --untracked-files=no`) | 10 ms (713 files), 3 ms on ky (115) and zod (742) |

So git already refuses whatever would lose work, and says why; a checkout costs tens of
milliseconds here (git's own cost, growing with the files that differ).

**Goal**: from the commits page, check out a local branch, a remote branch (as its local
tracking branch), a tag or a commit (detached HEAD), after a confirmation that says what will
happen; the page then shows the new HEAD (lane 0, cursor, badges). A checkout made elsewhere
shows when the page gets focus. "Show only this branch's commits" is a checkbox. `cpr diff`,
`cpr pr` and diff pages do not change.

#### What can be checked out (core)

- `checkout(repo, target)` in `src/git/checkout.ts`, the target one of:
  - `{ kind: 'branch', name }` → `git switch --no-guess <name>`;
  - `{ kind: 'remote', name: 'origin/x' }` → the local branch `x`: absent, `git switch --create
    x --track origin/x`; present and tracking `origin/x`, `git switch x`; present and tracking
    something else, refused ("a local branch x exists and tracks origin/y");
  - `{ kind: 'tag', name }` and `{ kind: 'commit', sha }` → `git switch --detach <commit>`.

  Never `--force`, `--discard-changes` or `--merge`: what git refuses is refused, with its
  message.
- Names only as `listRefs` lists them (exact match; a name starting with `-` refused), SHAs only
  full and `isCommit`: nothing else from the request reaches git, as with V9's diffs.
- Refused while a merge, rebase, cherry-pick, revert or bisect is in progress (their files in the
  worktree's own git dir, `git rev-parse --git-dir`).
- HEAD is read again after git returns: a failing post-checkout hook makes git exit non-zero
  after HEAD moved, and the answer says "checked out; the post-checkout hook failed: …".
- `workingState(repo)`: `{ changed, operation }` — tracked files with local changes, and the
  operation in progress or null.
- `listRefs(repo)` (from V10b's plan, brought forward): local branches with their upstream,
  remote branches with their remote (the configured remote whose name prefixes the ref), tags
  peeled to their commit. The menu offers what it lists.

#### Server

- `GET /api/status` → `{ version, branch, head, changed, operation }`; `GET /api/refs` →
  `listRefs`'s answer.
- `POST /api/checkout { kind, name | sha }`: a write like the others (same-origin JSON with the
  custom header), one at a time. 200 `{ branch, head, warning? }`; 400 for a name or SHA the
  repository does not have; 409 for a refusal (git's or ours), with the message.
- After it the history's version has changed (HEAD moved): the page lists anew, by V10a's path.

#### Viewer

- A menu per row: right-click, the row's "⋯" (on hover and on the cursor row), or `c` on the
  cursor row. Its entries come from the row's refs and `/api/refs`:
  - each local branch: "Check out branch wip" (the current one disabled: "checked out");
  - each remote branch: "Check out origin/topic as topic", or "… (tracked by topic)" when a
    local branch tracks it; disabled with the reason when a local branch of that name tracks
    something else;
  - each tag: "Check out tag v1 (detached HEAD)";
  - always "Check out this commit (detached HEAD)".
- A confirmation says what will happen: the branch checked out or created, or the detached HEAD;
  "3 files have uncommitted changes: they come along, unless the target changes them too — then
  git refuses and nothing changes"; an operation in progress disables "Check out" and says
  which. Enter confirms, Escape cancels.
- While it runs: "Checking out…". Then the history is listed anew, the cursor goes to HEAD, and
  a line under the title says "Switched to branch wip" or "HEAD is now at 9c1e0aa (detached)". A
  refusal shows git's message in the confirmation, and nothing else changes.
- On focus (`visibilitychange`, `focus`): `GET /api/status`; a version other than the page's
  lists anew (a checkout or a commit made elsewhere).
- "Show only this branch's commits": a checkbox replacing V10a's two buttons, named for the
  branch ("Show only main's commits"; detached: "Show only HEAD's commits"), kept in the URL as
  before. After a checkout, "this branch" is the new one.

#### Verification

1. **Unit** (red first), core on temp repositories: each kind of target; a local change carried;
   one refused (git's message, HEAD unchanged); a branch checked out in another worktree; a merge
   in progress; a remote whose local name tracks another; unknown names, short SHAs, a name
   starting with `-`; a failing post-checkout hook (HEAD moved, the warning). `workingState`
   (counts, each operation), `listRefs`. Server: `/api/checkout` refusals (another site, an
   unknown ref, one already running); a checkout changes `/api/status`'s version.
2. **Nothing else changes**: goldens; `cpr diff` and `cpr pr` tests; every e2e spec.
3. **E2E** (a fresh fixture repository per test: checkouts change it): the menu's entries per
   row; `wip` → its HEAD badge, lane 0 on its line, the cursor, "Switched to branch wip";
   `origin/topic` → a local `topic`; tag `v1` → detached, the checkbox says "HEAD's"; a
   conflicting local change → git's message, nothing changed; a terminal checkout shows on
   focus; the checkbox and the URL.
4. **Real repositories**: on clones (never a working tree in use): a branch, a remote branch, a
   tag, a commit on this repository's clone and on a full clone of Qwik; the round trip
   (checkout and relisting) against the checkout and the listing alone.
5. **Cost**: the round trip no more than git's checkout plus V10a's listing (0.02 s on CPR,
   0.8 s on CPython without a commit-graph file) plus 100 ms.

**Risks**

| Risk | Mitigation |
|---|---|
| A checkout changes the user's working tree: the first thing CPR writes outside its cache | `git switch` only, never forced; a confirmation every time; git's refusals shown; no reset, stash or discard. |
| A detached HEAD surprises | The menu, the confirmation and the line after say "detached"; the checkbox says "HEAD's". |
| Hooks (husky) run, can be slow or fail | Run as git runs them; "Checking out…" meanwhile; a failure after HEAD moved is a warning. |
| An editor sees files change under it | That is a checkout; the confirmation says the working tree changes. |
| A page acts on a stale view (another tab or a terminal checked out) | Names and SHAs are checked against the repository when asked; the page lists anew on focus. |
| Requests from other sites | Same-origin JSON with the custom header, like every write. |
| Analyses running meanwhile | They use CPR's cached worktrees, never the working tree: unaffected. |

**Order**: V11a (the checkbox, viewer only), V11b (status and refs; the page notices changes on
focus), V11c (checkout), on one branch.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V11a (dropped) | Show only this branch's commits | V10a's switch already does it. |
| V11b ✅ | Status and refs | `workingState`, `listRefs`, `/api/status`, `/api/refs`; the page lists anew on focus when the version changed. |
| V11c ✅ | Checkout | `checkout`, `POST /api/checkout`, the row menu (right-click, "⋯", `c`), the confirmation, the line after. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 54 | How a checkout runs | **`git switch`, never forced: local changes come along unless the target changes them too; then git refuses and nothing changes** | Measured: git carries what it can, refuses what would be lost and names the files. Options that stash or discard (Git Extensions has them) can lose work; later, if asked. |
| 55 | A remote branch | **Its local tracking branch: created if absent, checked out if it tracks it, refused if a branch of that name tracks something else** | What `git switch <name>` does by default, without its guessing where it would be ambiguous. |
| 56 | Tags and commits | **A detached HEAD, said before and after** | Git's own way; creating a branch there is a separate action (later). |
| 57 | Operations in progress | **Refused: merge, rebase, cherry-pick, revert, bisect** | Checking out in the middle of one leaves a state the page cannot show. |
| 58 | What a request may name | **Refs as `listRefs` lists them, by exact name; full SHAs of commits** | As V9's diffs: nothing else from a page reaches git. |
| 59 | "This branch" | **V10a's "All branches · This branch" switch stays (no checkbox); after a checkout, "this branch" is the new one** | Asked first for a checkbox, then: "I didn't see that we already have a switch between All branches, and current branch". |

**Not in V11 (later)**: creating, renaming or deleting branches; stash, reset, merge, rebase,
fetch, pull, push; choosing what to do with local changes (stash, discard); untracked files;
the branches panel (V10b), where a double-click could check a branch out.

#### As built — V11

- **Core**: `listRefs` in `src/git/refs.ts` (one `for-each-ref`, `%1f`-separated; the remote of
  `refs/remotes/a/b` is the longest configured remote prefixing it; a remote's `HEAD` and tags
  on trees or blobs left out). `workingState` and `checkout` in `src/git/checkout.ts`; the
  operation is read from `git rev-parse --absolute-git-dir` (`rebase-apply/applying` is `am`).
  A remote branch with no local branch of its name: `git switch --create x --track
  refs/remotes/origin/x` (the full ref, never a guess); git sets up tracking only for a remote
  it has configured. `RepoStatus` is `HistoryState & WorkingState`.
- **Server**: `GET /api/status`, `GET /api/refs`, `POST /api/checkout` as planned; a refusal is
  409 `{ error }` with git's words; a second checkout while one runs is 409 too.
- **Viewer**: `src/checkout.ts` (pure: the menu's entries, the note on local changes, the line
  after) and `src/CheckoutMenu.tsx` (menu and confirmation). A remote branch whose tracking
  branch is on the same row gets no entry of its own (the branch's covers it). After a checkout
  `CommitsPage` lists anew in a new generation of the page (fresh rows, lanes and picks; the
  cursor on HEAD) and shows the line above the rows; a stale page's "List them again" does the
  same instead of reloading. "c checks out" joins the help line.
- Test helper: `createRepo`'s `git` keeps stderr in the error (a test that conflicts on purpose
  printed git's "could not apply" into every `pnpm check`).
- **HEAD stands out** (asked after trying a checkout: "the current HEAD marker is not really
  visible"): HEAD and its branch are one solid badge, "HEAD → main" (`rowBadges` in
  `src/commits.ts`; detached: "HEAD", titled so); HEAD's row is tinted with a bold subject; its
  dot has a green ring; the title has a "HEAD → main" chip that goes to HEAD from anywhere in the
  history.

**Results (V11)**: from "Check out" to the page drawn again, on a clone of this repository
(181 commits, plain fonts): a remote branch (creating its local branch) 109 ms, a branch 112 ms,
the first commit (detached, 713 files changed) 115 ms. Tests: 519 unit (24 new: core 15,
server 3, viewer 6), 53 e2e (5 new: the menu's entries per row; a branch with HEAD, lane 0 and
the cursor following; a remote branch from the keyboard and a tag detached; git's refusal with
nothing changed; a terminal checkout shown on focus). Not verified: a large working tree (the
regression clones of Qwik, Bitwarden and CPython have none: they are history only), Windows
and macOS, a checkout through a hook that is slow (husky).

### V12 — Open in VS Code

**Status:** merged into main (2026-10-13, from branch `milestone/v12-open-in-vscode`). As built
and results: "As built — V12" below.

**Problem** (asked: "is there a way to jump to vs code at a specific selected line from the file
from the diff?", then "i want it to work on any platform", and "i want it to open the project in
vs code … if there is already an opened instance of that project, reuse that vscode"). The diff
panel shows a symbol's lines; going to them in the editor means finding the file and the line by
hand. And the number shown is the commit's: when the working copy is not that commit, it is
often another line. Measured: the last 60–68 first-parent commits of each repository, each
reviewed as `c^1..c` with the working copy at the branch tip; where each added line of a code
file (`.ts`, `.tsx`, `.js`, …) is at the tip:

| Repo | Commits back | Added lines | Same line number | Moved (right after mapping) | Changed since |
|---|---|---|---|---|---|
| CPR | 1–5 | 5,648 | 60.0 % | 34.8 % | 5.2 % |
| CPR | 6–20 | 3,930 | 70.5 % | 28.5 % | 1.0 % |
| CPR | over 20 | 25,655 | 48.1 % | 46.2 % | 5.7 % |
| ky | 1–5 | 5,484 | 76.8 % | 23.0 % | 0.2 % |
| ky | 6–20 | 2,233 | 14.9 % | 61.9 % | 23.2 % |
| ky | over 20 | 8,491 | 25.9 % | 54.3 % | 19.8 % |
| zod | 1–5 | 98 | 94.9 % | 4.1 % | 1.0 % |
| zod | 6–20 | 213 | 91.5 % | 0.9 % | 7.5 % |
| zod | over 20 | 4,052 | 73.1 % | 26.2 % | 0.8 % |

The checked-out commit itself is right as is, unless the working copy has uncommitted edits.
`cpr pr` of a pull request that is not checked out is like a commit some way back. What else
the plan rests on, measured on this machine (WSL, VS Code 1.141 on Windows):

- `code <folder> -g <file>:<line>` took 50 ms (3 runs). The window that had the folder open got
  the file: `code --status` listed one window before and after, its title then "README.md - CPR".
- `git diff -U0 <commit> -- <file>` (a commit against the working copy) took under 10 ms, on a
  3,195-line file 30 commits back.
- `launch-editor` 2.14.2 (Vite's "open in editor") runs `code -r -g <file>:<line>`: the last
  active window, whatever folder it has open. It never opens the project.
- VS Code's Windows `bin\code.cmd` runs `"%~dp0..\Code.exe"
  "%~dp0..\2a59476c9b\resources\app\out\cli.js" %*` with `ELECTRON_RUN_AS_NODE=1`; the folder is
  the commit's and changes with every update. Node refuses to start a `.cmd` without a shell
  (EINVAL since 18.20.2 and 20.12.2, CVE-2024-27980).

**Goal**: from the diff panel, open the symbol, or one of its lines, in VS Code: in the window
that has the repository open, else in a new window with the repository; at the line where that
code is in the working copy now, saying so when it moved or changed since. The same on Linux,
macOS, Windows, WSL, Remote SSH and dev containers: VS Code runs on the machine where `cpr`
runs. Without a working copy (a graph opened with `?graph=`) nothing shows. The graph JSON does
not change.

#### Running VS Code (cli)

- `openInVsCode(command, folder, file, line, column)` in `packages/cli/src/editor.ts` runs
  `<code> <folder> --goto <absolute file>:<line>:<column>`, without a shell, and waits for it to
  exit (10 s at most; the CLI returns once VS Code has the request). VS Code focuses a window
  whose folder is `folder` and opens the file there, or opens a new window with the folder.
  `folder` is the repository's root (`repo.root`: the worktree `cpr` runs in, never CPR's cached
  worktrees).
- `findVsCode(env, platform, fs)` finds the command at the first open, and keeps it:
  1. `CPR_CODE`, a path or a command: Insiders, VSCodium, Cursor or an unusual install (same
     flags).
  2. `code` on `PATH` (on Windows with `PATHEXT`: `code.cmd`). In a VS Code terminal (local, WSL,
     SSH, container) this is the CLI that talks to that terminal's window. In WSL outside VS Code
     it is Windows' `bin/code`, a script that handles WSL itself.
  3. The usual install places: macOS `/Applications/Visual Studio
     Code.app/Contents/Resources/app/bin/code` and the same under `~/Applications`; Windows
     `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd` and `%ProgramFiles%\Microsoft VS
     Code\bin\code.cmd`; Linux `/usr/share/code/bin/code` and `/snap/bin/code`.

  Not found: "VS Code's `code` command was not found: run 'Shell Command: Install 'code' command
  in PATH' in VS Code, or set CPR_CODE".
- On Windows, `code.cmd` is read and what it runs is run: `Code.exe` with its `cli.js` and
  `ELECTRON_RUN_AS_NODE=1`, so no shell sees a path. A `code.cmd` of another shape goes through
  `cmd.exe /d /s /c` with every argument quoted, refused if a path holds `%`, `"`, `!` or a line
  break.
- A non-zero exit gives the CLI's stderr as the error (e.g. "Unable to connect to VS Code server"
  after the terminal's window was closed).

#### Which line (cli)

- `workingLine(repo, sha, file, line)` runs `git diff -U0 --no-color --no-ext-diff --no-textconv
  <sha> -- <file>`: the side's commit against the working copy, uncommitted edits included. Its
  hunks give one of:
  - `exact`: the file is unchanged, or the line is outside every hunk: the line plus what was
    added and removed above it;
  - `nearest`: the line is inside a hunk (changed since, or removed): the hunk's first line in
    the working copy;
  - `missing`: the file is not in the working copy (deleted, renamed since, untracked, or a pull
    request's new file that is not checked out). Nothing opens; the answer says so.
- The pure part apart from git: `mapLine(hunks, line)`.
- The viewer names the side: `head` for a row with a head number (added and unchanged rows) and
  for a symbol with a head range; `base` for a removed row and a removed symbol. A removed line
  maps like a changed one: to where the removal is in the working copy (when the working copy is
  head, the line after it).

#### Server

- `POST ./api/open { side, file, line, column? }`: a write like the others (same-origin JSON with
  `x-cpr: 1`). `file` must be in `site.allowed[side]` (files the graph mentions); `line` and
  `column` positive integers. 200 `{ line, how: 'exact' | 'nearest', moved }`; 404 when the
  working copy lacks the file; 502 with the message when VS Code's command is missing or fails.
- The side's commit: the diff's pair under `cpr view`, the analyzed revisions under `cpr pr`.
- `/api/capabilities` gains `open: true` when the server has a working copy (`cpr view`,
  `cpr pr`). Whether `code` is found is not checked there: a click says how to fix it, a hidden
  button would not.

#### Viewer

- The file line above the code gets an "Open in VS Code" button: the symbol's first line (head's
  range, else base's).
- On a row, Ctrl+click (⌘+click on macOS) opens at that row's line, and the line numbers are
  links that do the same. A plain click still picks the comment line.
- `o` opens the selected symbol at the picked comment line when there is one, else at its first
  line; it joins the keyboard help.
- After an open, a line under the file line for a few seconds: "Opened in VS Code at line 52",
  "… at line 52 (48 at head: moved in your working copy)", "Line 48 changed in your working
  copy: opened at line 60, where it was", or the error.
- Nothing shows without `capabilities.open` (older servers, `?graph=`).

#### Verification

1. **Unit** (red first): `mapLine` — no hunks, lines added and removed above, a line inside a
   hunk, an insertion just before it, a pure removal, the last line. `workingLine` on temp
   repositories — the commit checked out, uncommitted edits above the line, a later commit
   checked out, a file deleted, renamed or untracked, a base line removed at head.
   `findVsCode` with an injected platform, environment and file system — `CPR_CODE`, `PATH`,
   `PATHEXT`, the `code.cmd` of 1.141 (versioned folder) and of the older layout
   (`resources\app\out\cli.js`), the macOS bundle, not found; the Windows command line for a
   path with spaces, `&` and `%`. Server — `/api/open`'s refusals (another site, no header, a
   file not in the graph, a bad line), the command's arguments (a fake CLI), its failure as 502,
   `capabilities.open`.
2. **Nothing else changes**: goldens, every e2e spec, `cpr diff` and `cpr pr` tests. No analysis
   code changes, so no `regression-check` run.
3. **E2E**: `CPR_CODE` set to a fake that writes its arguments to a file — the button, Ctrl+click
   on a row, `o` with a picked line; a fixture whose working copy moved the line (the note, the
   line passed); a removed symbol; no controls under `?graph=`; no page errors.
4. **Real**: on this machine (WSL, VS Code on Windows), `cpr view` on CPR: the window with CPR
   gets the file (`code --status`: still one window); a repository not open in VS Code gets a
   new window (by hand, by the user). Native Windows and macOS cannot be run here (CI runs
   Ubuntu and macOS unit tests); asked of the user, and said so in the results.
5. **Cost**: from the click to the CLI's exit under 200 ms with VS Code running (git diff under
   10 ms, `code` 50 ms here).

**Risks**

| Risk | Mitigation |
|---|---|
| A page starts a program on the machine | Only VS Code's command, found by CPR, with a folder and a `file:line` the server makes from the graph's own files; a write like the others, which other sites cannot send; no shell (on Windows, `Code.exe` and `cli.js`, as `code.cmd` runs them). |
| The wrong line, silently | Lines mapped against the working copy through git; a changed line says so; a missing file opens nothing. |
| `code` missing or stale (macOS without the shell command; the IPC of a VS Code terminal closed since) | The usual install places; `CPR_CODE`; VS Code's own error shown with the fix. |
| VS Code's Windows layout changes again | `code.cmd` is read, not the folder guessed; `cmd.exe` with strict quoting otherwise. |
| The user opens a subfolder or a `.code-workspace` | VS Code matches the exact folder: a second window opens for the root. Recorded; a setting for the folder later. |
| Windows and macOS not run here | Unit tests with injected platforms; CI on macOS; tried by hand by the user. |

**Order**: V12a (cli: `mapLine`, `workingLine`, `findVsCode`, `openInVsCode`, `POST ./api/open`),
then V12b (viewer), on one branch.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V12a | Open from the server | `editor.ts` (find and run VS Code), `workingLine` and `mapLine`, `POST ./api/open`, `capabilities.open`. |
| V12b | Open from the viewer | The file line's button, Ctrl/⌘+click and line-number links, `o`, the line after an open. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 60 | Who opens the editor | **The `cpr` server runs VS Code's command; no `vscode://` link** | The server runs where the files are. A link opens on the browser's machine, needs another URL form for WSL, SSH and containers, and the browser asks before each one. |
| 61 | Which window | **`code <repo root> --goto <file>:<line>:<col>`: the window with that folder, else a new one with it** | Asked: "open the project … reuse that vscode". Measured: VS Code gave the file to the window with the folder; `launch-editor`'s `code -r -g` takes the last active window, whatever its project. |
| 62 | Which line | **Mapped to the working copy through `git diff <side's commit> -- <file>`; a changed line opens where it was, and says so** | Reviewing anything but the checked-out commit, 1–62 % of added lines sat at another line (CPR 29–46 %, ky 23–62 %, zod 1–26 %) and up to 23 % were changed since. |
| 63 | Other editors | **VS Code and its forks through `CPR_CODE` (same flags); no others in V12** | Asked for VS Code; JetBrains and the rest take other flags and have no rule like VS Code's window per folder. |
| 64 | New dependencies | **None**: `git diff` maps lines, `node:child_process` runs VS Code | `launch-editor` does not open the project; the `diff` package would redo what git does. |

**Not in V12 (later)**: other editors (JetBrains, Sublime, Vim); a setting for the folder to open
(a subfolder, a `.code-workspace`); opening the commit's own version when the working copy lacks
the file (a read-only copy, or VS Code's git URIs); opening from graph nodes and the change list.

#### As built — V12

- **Which line** lives in core, not the CLI: `mapLine` and `workingLine` in
  `src/git/working-line.ts`, next to `readFileAtRevision`. `git --literal-pathspecs` is needed:
  without it git reads a path like Qwik's `src/routes/[id]/index.tsx` as a glob, and edits of
  `i.ts` or `d.ts` moved its lines (a test maps line 3 to 1 without the flag).
- **Running VS Code** (`packages/cli/src/editor.ts`): as planned, plus: the run ends at the
  command's `exit`, not `close` (a VS Code it starts may keep the pipe open); off Windows it runs
  detached, so Ctrl+C on `cpr` does not reach it; the command is found at the first open and
  looked up again after a failure.
- **Server**: `startViewServer`'s `open` option (`OpenRequest` → `OpenResult`); `cpr view` and
  `cpr pr` pass `vsCodeOpener(repo, env)`. A graph without a commit for the side (two folders
  compared) answers 404.
- **Viewer**: `src/open.ts` (pure: what a button, a row or a line number opens, the note; and the
  request). The button sits beside the file line, not in it: inside, its text became part of the
  path two specs read (projects, Angular 11). The button and `o` open the line picked for a
  comment when there is one (`cpr pr`), else the symbol's first line. A line number opens its own
  side (unchanged rows have both); Ctrl/⌘+click opens the head line when the row has one, else
  the base line. Under `cpr view` rows had no click action before (comments are `cpr pr`'s), so
  Ctrl/⌘+click means the same in both. A note stays 8 s; an error stays until the next open.
- **The button** (asked after the first build: "make a nice button for Open in VS Code … so i
  can see it"): link-styled 12 px text at first, it went unseen. Now an outlined button in the
  accent colour, with an icon and its key (`o`), on the line under the file name.
- **"This commit" removed from the commits page** (asked at the same time): every row had it. One
  commit picked alone, then Compare (or `x`, Enter), compares it with its parent, as before.

**Results (V12)**: 557 unit tests (35 new: core 9, CLI 19, viewer 7), 59 e2e (6 new: the button,
Ctrl/⌘+click and a removed line's number, `o` after the working copy moved the line, a file the
working copy lacks, no controls under `?graph=`; under `cpr pr`, a click still picks the comment
line while Ctrl/⌘+click and line numbers open, and `o` opens the picked line). On this machine
(WSL, VS Code 1.141 on Windows), `cpr view 24396ab~1 24396ab`: `parseCheckoutTarget`, at line 449
in that commit, opened at 480, its place in the working copy, 105 ms from the request to the
answer, in the window that had CPR open (`code --status`: one window before and after). Selecting
`startViewServer` (300 rows, 559 line numbers as buttons): median 31–37 ms on `main`, 33–34 ms
with V12 (8 rounds per run, two runs each, back to back); the panel has 1,720 elements instead of
1,717. Not verified: native Windows and macOS, a repository not open in VS Code (a new window),
Remote SSH and dev containers.

### V13 — Compare mode

**Status:** merged into main (2026-10-13, from branch `milestone/v13-compare-mode`). As built and
results: "As built — V13" below.

**Problem** (asked: "i would like the default mode to not be 'Pick two to compare them, or one
against its parent' -- there should be an active mode 'Compare mode' that trigger that state on
commits list"). Since V10–V11 the commits page is a small git client: every branch as a graph,
checkout from a row's menu, HEAD marked. It still opens as V9's picker, though. The help line
starts "Pick two to compare them, or one against its parent". Every row has a pick circle. A bar
under the rows says "Pick two commits, or one to compare with its parent" beside a disabled
Compare. And a click on a row picks it. Measured in Chromium on `cpr view` (`main` at
`2644214`), the page as it opens:

| Repo | Window | Rows in view | Compare bar | Pick column, every row | Three rows clicked to look at them | A row clicked, then `c` |
|---|---|---|---|---|---|---|
| CPR | 1440 × 900 | 22 (the title on two lines: a long branch name) | 52.6 px | 24 px | 2 picked: "d67a5d6 → d175ee5 · 5 commits" | the menu opens; the row stays picked |
| Qwik | 1440 × 900 / 1280 × 720 | 23 / 18 | 52.6 px (1.6 rows) | 24 px | 2 picked: "4d5d13d → 239e9d3 · 10 commits" | the same |
| Bitwarden | 1440 × 900 / 1280 × 720 | 23 / 18 | 52.6 px | 24 px | 2 picked: "389f204 → db4a0eb · 4 commits" | the same |

- A click does two things: it moves the cursor (the row `c` and Enter act on) and it picks.
  Clicking rows to look at them, or to choose one to check out, leaves picks behind and a
  comparison ready. Three clicks leave the first and the third picked (a third pick replaces
  the second: V9's rule).
- The cursor is drawn as a 3 px grey bar; the pick as a 14 % accent tint. So what a click
  visibly does is pick, not select.
- Two of the help line's three parts are about picking; the checkout key comes last.
- Back from a diff lists the page anew (measured: no picks kept). A mode kept in the page's
  state starts over the same way.

**Goal**: the commits page opens in a browse mode. A click selects a row (the cursor), and
nothing about picking shows: no pick circles, no compare bar. A "Compare mode" toggle in the
title (or `x`) turns on today's picking state: the circles, the bar with its label, Clear and
Compare, and V9's rules (two picks, the older the base; one picked alone against its parent).
The toggle again, Escape, or Compare leaves it, and the picks are cleared. Checkout (menu, `c`),
the scopes, the HEAD chip and the arrows work the same in both modes. Diff pages, the server,
`cpr diff` and `cpr pr` do not change.

#### Browse mode (the default)

- A click on a row moves the cursor there and picks nothing. j/k move it; `c`, right-click and
  "⋯" open its menu, as today; Enter does nothing.
- Rows have no pick column: `.commit-pick` is not drawn (24 px back to the subject). There is no
  compare bar (52.6 px back to the list: Qwik at 1440 × 900 shows 25 rows instead of 23).
- The cursor is now the selection, so it must show: in browse mode the cursor row gets an accent
  bar on the left and a light accent tint, distinct from HEAD's green tint. Checked in
  screenshots, light and dark, on HEAD's row and another.
- The help line: "j/k move · c checks out · x picks to compare".
- Errors the bar showed ("Could not read the branches" from a row's menu, "Could not list
  commits" for a later block) move to a line under the title (`role="alert"`, next to the
  checkout notice), in both modes. In browse mode there is no bar to show them.

#### Compare mode

- The toggle: a button "Compare mode" in the title, after the scopes, with `aria-pressed`.
  Pressed, it is filled in the accent colour; not pressed, outlined in it, like V12's "Open in
  VS Code" (a link-styled control went unseen there). Its title: "Pick commits to compare (x)".
- On: the page gets the class `comparing`; rows get their pick column; the bar appears with
  "Pick two commits, or one to compare with its parent", then the label ("a1b2c3d → e4f5a6b ·
  12 commits"), Clear and Compare. A click picks and moves the cursor, `x` picks the cursor's
  row, Enter compares: V9's rules, unchanged (`pick`, `comparison` in `src/commits.ts`). The help
  line: "Pick two to compare them, or one against its parent · x picks, Enter compares, Esc
  leaves".
- `x` in browse mode turns compare mode on and picks the cursor's row. So `x`, Enter still
  compares a commit with its parent from the keyboard, as since V9.
- Off: the toggle, Escape (when no menu or confirmation is open: they take Escape first), or
  Compare (the page then leaves for the diff). The picks are cleared.
- Where the state lives: `comparing` in `CommitsPage`, above the `History` generation. A scope
  switch or a relisting after a checkout keeps the mode; the picks are cleared, as today. It is
  not in the URL: a reload, "← Commits" and a new `cpr view` open in browse mode. The back link's
  title changes from "Pick other commits" to "Back to the commits".

#### Code

- `src/CommitsPage.tsx`: `CommitsPage` holds `comparing` and hands it to `History` with a setter.
  `History`'s click handler and the `x`/Enter/Escape keys branch on it; the bar renders only
  when comparing; errors render under the title. `CommitRow` draws `.commit-pick` only when
  comparing.
- `src/styles.css`: `.compare-mode` (the toggle), `.commits.comparing`, the browse mode's
  cursor style, `.commits-error`. These class names are not taken yet (checked).
- No server, core or graph change; `src/commits.ts` unchanged.

#### Verification

1. **E2E** (red first), in `e2e/commits.spec.ts`: the page opens in browse mode: no
   `.commit-pick`, no compare bar, no "Pick two" in the help line. A click moves the cursor and
   picks nothing (three clicks: 0 picked). "Compare mode" pressed: circles, the bar, V9's label;
   two clicks pick a pair; Escape leaves and clears; the toggle leaves. `x` from browse mode
   turns it on with the cursor's row picked, then Enter compares (the existing keyboard test,
   unchanged). A scope switch keeps the mode and clears the picks. The existing tests that click
   to pick ("picks two commits…", "stops an analysis", "compares one commit…") press "Compare
   mode" first. `history.spec.ts` (an arrow moves the cursor, nothing picked) and
   `checkout.spec.ts` pass unchanged.
2. **Nothing else changes**: `pnpm check` (the `commits.ts` unit tests unchanged); every other
   e2e spec. No analysis code changes, so no `regression-check` run.
3. **Viewer** (`viewer-check`): screenshots of Qwik's commits page in both modes, light and
   dark (the selection beside HEAD's tint, the toggle pressed and not); rows in view at 1440 ×
   900 and 1280 × 720 against the Problem table.
4. **Cost**: first rows drawn on Qwik and Bitwarden within the noise of `main`'s (V10a: 102–133
   ms, plain fonts). The page draws the same rows, with one element fewer per row.

**Risks**

| Risk | Mitigation |
|---|---|
| Comparing takes one more click with the mouse: the toggle, the picks, Compare | The keyboard keeps two keys (`x`, Enter). A one-step "this commit against its parent" from browse mode (double-click) is left as an open choice: V12 removed the per-row button because every row had it. |
| A click that picked for three milestones now only selects | The toggle is a visible button; the help line names `x`. |
| Errors shown in the bar vanish with it | They move to a line under the title, in both modes. |
| The cursor's grey bar is too faint for a selection | A browse-mode selection style; screenshots light and dark beside HEAD's tint. |
| A browser that restores the page from its back-forward cache brings compare mode back, with its picks | Measured: Chromium lists the page anew on Back. Either way the page is usable. |

**Order**: one step, viewer only: the e2e changes (red), then the page and its styles, then
README.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V13 ✅ | Compare mode | Browse mode by default (a click selects; no circles or bar; errors under the title), the "Compare mode" toggle, `x` turning it on, Escape leaving it; e2e; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 65 | What the commits page does by default | **Browse: a click selects a row (the cursor); no pick circles, no compare bar** | Asked. Measured: three clicks to look at rows leave a pair picked and a comparison ready; a click before `c` picks too; the bar and circles take 52.6 px and 24 px a row. |
| 66 | How compare mode starts and ends | **The title's "Compare mode" toggle, or `x` (which also picks the cursor's row); the toggle, Escape or Compare end it, clearing the picks** | Asked for a mode. `x` keeps V9's two keys for a commit against its parent. |
| 67 | What the mode survives | **A scope switch and a relisting after a checkout (picks cleared, as today); not a reload, "← Commits" or a new `cpr view`** | The default is browse; picks never survived a new generation either. |

**Not in V13 (later)**: a one-step compare from browse mode (double-click a row: the commit
against its parent); what the selection could show beside the list (a commit's message and
files, V10's "later"); the mode kept in the URL; Shift+click to pick a range.

#### As built — V13

- As planned, in `src/CommitsPage.tsx` and `src/styles.css`; `src/commits.ts`, the server and
  core unchanged. `comparing` lives in `CommitsPage`; `History` leaves the mode through
  `stopComparing` (picks and the bar's error cleared). The row's click handler is `onClick`
  (was `onPick`): it moves the cursor, and picks only when comparing.
- The toggle shows its key: "Compare mode `x`", and "`Esc`" when on (a `kbd` hidden from the
  accessible name, so the button is "Compare mode" in both states).
- Errors: listing and menu errors under the title (`.commits-error`, `role="alert"`); "Could not
  compare" stays in the bar (`compareError`), the only place it can come from.
- HEAD's row selected: the selection's accent tint replaces HEAD's green tint; HEAD stays clear
  from its solid badge, bold subject and ringed dot (screenshots, light and dark).
- Clear (in the bar) still clears the picks and stays in compare mode.

**Results (V13)**. Tests first: against `main`'s build the changed `commits.spec.ts` failed 9 of
11 (the toggle and the error line missing; the two tests that do not pick passed). Now 557 unit
tests (unchanged) and 64 e2e (5 new: browse mode, the toggle with Escape and a menu taking
Escape first, `x` turning the mode on, a scope switch, an error under the title; 3 existing tests
turn compare mode on before picking). Real repositories (Chromium, 1440 × 900 unless said;
`main`'s build from a worktree, run back to back):

| | Qwik `main` / V13 | Bitwarden `main` / V13 |
|---|---|---|
| Rows wholly in view, 1440 × 900 | 23 / 25 | 23 / 25 |
| Rows wholly in view, 1280 × 720 | 17 / 19 | 17 / 19 |
| First rows drawn, warm server, plain fonts (5 rounds, alternating): median (range) | 114 (112–117) / 114 (107–127) ms | 146 (142–148) / 139 (114–144) ms |
| Page errors (both modes, light and dark) | — / 0 | — / 0 |

Not verified: Firefox and Safari; a browser that restores the page from its back-forward cache
(Chromium here lists it anew on Back, so compare mode does not come back).

### V14 — Checkout submenu

**Status:** merged into main (2026-10-14, from branch `milestone/v14-checkout-submenu`). As built
and results: "As built — V14" below.

**Problem** (asked: "Let's make the branch name more visible when checking out...and maybe, in
the dropdown, show Check out, and when hovering over, another dropdown opens with the options").
V11's row menu lists every checkout target as a sentence, and the names are plain text inside
it. Measured in Chromium on `cpr view` (`main` at `c2e3486`, 1440 × 900, light):

| Repo, row | Entries | Menu (px) | Longest entry | Confirmation's heading |
|---|---|---|---|---|
| Qwik, HEAD (`3fd543f`: `main` and 8 release tags) | 10 | 480 × 343 (at its max width) | "Check out tag @qwik.dev/devtools@2.0.0-rc.3 (detached HEAD)" | "Check out tag eslint-plugin-qwik@2.0.0-rc.3 (detached HEAD)?", on two lines |
| Qwik, `2cf8a7d` (a remote branch) | 2 | 480 × 112 | 117 characters: "Check out origin/dependabot/npm_and_yarn/npm_and_yarn-c03abc55da as dependabot/…", on two lines | the same sentence and "?" |
| Bitwarden, HEAD (`main`, `origin/main`) | 2 | 313 × 90 | "Check out this commit (detached HEAD)" | — |

- Every entry starts with "Check out" (10 times on Qwik's HEAD row) and 8 of those 10 end with
  "(detached HEAD)". The name the reviewer is looking for sits in the middle, the same weight
  and colour as the words around it.
- On the rows the same names are coloured badges (branch blue, tag gold, remote grey, HEAD
  green); the menu and the confirmation drop that.
- Refs per commit on the regression clones: Qwik 1–8 for 393 of 394 commits with refs and one
  with 10 or more; Bitwarden 1–5 (2,104 commits); CPython 1–2 (679). The longest ref name is 140
  characters (a Bitwarden remote branch).

**Goal**: the row menu shows one entry, "Check out ▸". Hovering it (or →, Enter) opens a
submenu beside it with the targets: each name drawn as the row draws it (the same badge), what
it is and does in muted text after it ("tag · detached HEAD"). The confirmation's heading shows
the name as a large badge: "Check out branch [wip]?". What can be checked out, the rules, the
server and the page after a checkout do not change.

#### Viewer

- `src/checkout.ts`: each `CheckoutChoice` gains `ref` (`{ kind: 'branch' | 'remote' | 'tag' |
  'commit', name }`, what the badge shows) and `note` (after it). `label` stays the sentence
  ("Check out tag v1 (detached HEAD)"): the submenu entry's accessible name.

  | Target | Badge | Note |
  |---|---|---|
  | local branch | `wip` (branch) | branch (current: disabled, "checked out" under it) |
  | remote branch, no local branch of its name | `origin/topic` (remote) | remote · creates branch topic |
  | remote branch, a local branch tracks it (not on the row) | `topic` (branch) | branch · tracks origin/topic |
  | remote branch, its local name tracks something else | `origin/topic` (remote) | remote (disabled, the reason under it) |
  | tag | `v1` (tag) | tag · detached HEAD |
  | the commit | `3fd543f` (commit, monospace) | this commit · detached HEAD |

- `src/CheckoutMenu.tsx`: the menu holds "Check out ▸" (`aria-haspopup="menu"`,
  `aria-expanded`). The submenu opens on hover, on a click, or with → / Enter / Space, to the
  right of the menu (to its left when the window has no room), its first entry level with
  "Check out", moved up to stay in the window, scrolling past the window's height. In it ↑/↓
  move, Enter chooses, ← closes it (back to "Check out"); Escape or a click outside closes
  both. It is rendered inside the menu's element, so a click in it is not "outside".
- `c` opens the menu with the submenu already open and its first enabled entry active: the key
  says "checks out", so it lands on the targets (c, Enter as before for the first one).
  Right-click and "⋯" open the menu; the submenu opens on hover.
- The confirmation's heading: "Check out" and the kind ("branch", "remote branch", "tag",
  "commit"), then the badge at heading size, then "?". A long name wraps inside its badge (Bitwarden's
  140 characters); in the submenu it is cut with an ellipsis and its title holds it whole.
- `src/styles.css`: the badge styles (`.ref-branch`, `.ref-tag`, `.ref-remote`) are reused;
  new `.ref-commit` (monospace), `.submenu`, `.menu-item.has-submenu`, `.dialog-ref`. Checked
  free: none of these names is taken.

#### Verification

1. **Unit** (red first), `test/checkout.test.ts`: `ref` and `note` for each kind of target
   (a branch, the current branch, a remote with no local branch, one tracked, one conflicting,
   a tag, the commit). Labels unchanged.
2. **E2E** (red first), `e2e/checkout.spec.ts`: the menu holds "Check out" alone; hovering it
   opens the submenu; its entries per row (badges and notes; accessible names as today);
   keyboard: `c` opens straight into the submenu, ← back to "Check out", → into it again,
   Escape closes both; the confirmation's heading shows the badge ("Check out branch wip?" as
   text). The existing checkout tests choose through the submenu; `commits.spec.ts`'s `c` test
   and V13's "a menu takes Escape first" pass.
3. **Nothing else changes**: `pnpm check`; every other e2e spec. No analysis change, so no
   `regression-check` run.
4. **Viewer** (`viewer-check`): screenshots of Qwik's HEAD row and remote-branch row with the
   submenu open, and the confirmation, light and dark; the submenu flipped left near the right
   edge and moved up near the bottom.
5. **Cost**: none expected (the entries are the same; one more element). First rows drawn as
   V13's.

**Risks**

| Risk | Mitigation |
|---|---|
| One more step to check out with the mouse (hover, then pick) | Asked for. The submenu opens on hover, with no delay: there is one parent entry, so no diagonal-move problem. `c` goes straight to the targets. |
| The badge and its note read as two things | The note is muted and says the kind first ("tag · …"); the accessible name stays the whole sentence. |
| Colour alone tells branch from tag | The note says the kind. |
| A submenu off-screen near the right or bottom edge | Flipped left, moved up, scrolling past the window's height; e2e at a narrow window. |
| A menu with a single entry looks empty | It is where later row actions go (V11's "later": create a branch here); the submenu opens on hover. |

**Order**: unit tests and `checkout.ts`; e2e (red); the menu and submenu; the confirmation;
styles; screenshots; README.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V14 ✅ | Checkout submenu | "Check out ▸" with the targets in a submenu, names as the row's badges; the confirmation's heading with the name as a badge; `c` straight into the submenu. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 68 | How the row menu offers checkout | **One entry, "Check out ▸"; its targets in a submenu opened on hover, click, → or Enter** | Asked. The entries no longer repeat "Check out" (10 times on Qwik's HEAD row), and the menu has room for later row actions. |
| 69 | How a target's name shows | **As the row's badge (same colours), first in the entry, with a muted note after it; in the confirmation's heading at heading size** | Asked ("the branch name more visible"). The names were plain text mid-sentence, and the rows already teach the colours. |
| 70 | What `c` opens | **The menu with the submenu open, its first enabled entry active** | `c` "checks out": a second key to reach the targets would add a step the keyboard never had. |

**Not in V14 (later)**: other row actions in the menu (create a branch here, copy the SHA,
compare with the parent); the line after a checkout ("Switched to branch wip") with a badge.

#### As built — V14

- As planned in `src/checkout.ts` (`ref`, `note`), `src/CheckoutMenu.tsx` and `src/styles.css`;
  `CommitsPage` passes `submenu` for `c`. Core, the server and `src/commits.ts` unchanged.
- The arrow after "Check out" is drawn by CSS with empty alternative text (`content: '▸' /
  ''`): plain generated text counts in the accessible name, and the item was "Check out▸".
- A note that does not fit beside its name goes under it (`flex-wrap`). The first screenshot of
  Qwik's remote-branch row showed the note, kept on one line, squeezing the badge to "o".
- The confirmation's badge is an inline block (8 px corners, wrapping inside), leaving 1em for
  the "?": a pill split over two lines lost its border, then the "?" fell to a line of its own.
- Hovering "Check out" opens the submenu and keeps "Check out" highlighted; the pointer on an
  entry highlights it, and the keys then act in the submenu. A click on "Check out" opens it
  with the first entry active, like → and Enter.
- The menu's minimum width went from 240 to 160 px: it holds one entry.
- "Check out" and its submenu sit in a wrapper (`role="none"`, `.menu-host`) for screen readers.
  It is a flex column: in a plain block the button kept its own width (121 of 150 px), and the
  user saw its highlight and arrow stop short of the menu's edge.
- Headings for a tag or a commit no longer say "(detached HEAD)": the first words under them
  do ("Detaches HEAD at …").

**Results (V14)**. Tests first: the new unit test failed (no `ref`), and against `main`'s build
5 of 6 checkout e2e tests failed (no lone "Check out", no submenu). Now 558 unit tests (1 new)
and 66 e2e (2 new: the keyboard path through both menus; the submenu kept in a 900 × 300 window,
flipped left of "⋯" and moved up near the bottom; the entries test rewritten for the submenu;
3 tests choose through it; the confirmation's badge checked). Real repositories (Chromium,
1440 × 900, light and dark), against the spike's numbers:

| Row | Before | V14 |
|---|---|---|
| Qwik HEAD (`main`, 8 tags) | one menu, 480 × 343 px, "Check out" 10 times | menu 160 × 42, submenu 368 × 335: 10 badges in a column, notes after them |
| Qwik `2cf8a7d` (remote branch) | 480 × 112, a 117-character entry on two lines | submenu 480 × 105: the name whole on one line, the note under it |
| A 140-character branch (scratch repository) | — | cut with "…" in the submenu (its title whole), whole in the confirmation |
| Page errors | — | 0 |

Not verified: Firefox and Safari (empty alternative text for `content` needs Chrome 77, Safari
17.4, Firefox 128; older browsers draw the same arrow and read it in the name); touch screens
(no hover: a tap on "Check out" opens the submenu, as a click does); first rows drawn, not
re-measured (the rows did not change).

### V15 — Branch reviews in the repository

**Status:** merged into main (2026-10-14, from branch `milestone/v15-branch-reviews`). As built
and results: "As built — V15" below.

**Problem** (asked: "this app will be a review app for commits made by an agent"; then, on where
reviews live: "this should be shared in the repo, so .git is not a good position...much better
to create a folder cpr at the root, and there we should store eveythinf related, reviews etc";
and: "can't we just keep cpr folder at the root, and gitignore it?").
An agent commits to a branch several times, and the reviewer looks at the branch after each
commit or batch. Today:

- Outside `cpr pr`, reviewed marks and drafts are kept per pair of revisions (`stateDir` in
  `packages/cli/src/state.ts`: `<cache>/state/<repo id>/<sha256(base..head)>/`). A new commit
  makes a new pair, so the marks start empty.
- They live in CPR's cache (`~/.cache/cpr`), next to throwaway worktrees: one machine, one
  person, and gone when caches are cleared.
- The commits page does not show which commits or branches were reviewed.

Measured on this repository, where an agent wrote 189 of 206 commits (`Co-Authored-By:
Claude`). Four milestone branches, each commit compared with the branch's fork point (`cpr
diff`, 1.0–1.4 s each); the marks of the commit before (as if all were reviewed) checked
against each new commit by fingerprint, I1's rule:

| Branch (fork point) | Commits | Symbols at the tip | A commit added to a reviewed branch: marks still valid | Symbols to look at, per pair (today) / per branch |
|---|---|---|---|---|
| V9 (`b6b0016`) | 10 | 109 | 617 of 637 (96.9 %), 8 times | 732 / 115 |
| V11 (`78ca95a`) | 4 | 63 | 114 of 116 (98.3 %), 2 times | 121 / 7 |
| V12 (`d67a5d6`) | 6 | 85 | 285 of 286 (99.7 %), 4 times | 332 / 47 |
| V14 (`c2e3486`) | 3 | 12 | 11 of 12 (91.7 %), once | 12 / 1 |
| All | 23 | | 1,027 of 1,051 (97.7 %), 15 times | 1,197 / 170 (14 %) |

Of the 24 marks lost, 11 are symbols changed again (rightly "↻ changed since you reviewed it")
and 13 moved with a renamed file (`e75c1cf`: a symbol's ID holds its path).

**Goal**: "Review" a branch from the commits page. CPR compares the branch's fork point with
its tip and opens the diff with the reviewer's marks and drafts for that branch. After the agent
adds commits, reviewing the branch again keeps every mark whose symbol did not change, so only
new and changed symbols are left. Reviews are files in `cpr/reviews/` at the repository's root,
one per branch and reviewer, plain JSON. By default they stay out of git: CPR writes a
`cpr/.gitignore` once, and deleting it makes them commit and share like any file. CPR never
stages or commits them. The commits page shows each reviewed branch's
progress and the commits added since. `cpr pr`, `cpr diff`, compare-mode pairs and the graph
JSON do not change.

#### Where reviews live (`cpr/`)

- `cpr/reviews/<branch>/<reviewer>.json`, at the root of the working tree `cpr view` runs in
  (`git rev-parse --show-toplevel`):
  - `<branch>`: the branch name without its remote (`origin/topic` and `topic` are one branch).
    Its slashes become folders; git refuses `a` and `a/b` as branches, so paths cannot clash.
  - `<reviewer>`: the repository's `git config user.email`, already in every commit the
    reviewer makes. Without one, the page says so and the review stays in the cache, as today.
- One file per reviewer and branch: two reviewers never write the same file.
- Keys sorted, two-space indent, one mark per line, so git merges and diffs it line by line;
  the same review always gives the same bytes:

  ```json
  {
    "base": "<the fork point, full SHA>",
    "branch": "milestone/v14-checkout-submenu",
    "drafts": [],
    "head": "<the tip last reviewed, full SHA>",
    "marks": {
      "packages/viewer/src/checkout.ts#checkoutChoices": "<fingerprint>"
    },
    "reviewer": "anton@example.com",
    "summary": "",
    "updated": "2026-10-14T10:12:00Z"
  }
  ```

- Local by default. The first time CPR writes a review it creates `cpr/.gitignore`, unless the
  file exists (then CPR never changes it), as pytest and ruff do for their cache folders:

  ```
  # Written by CPR: reviews stay on this machine. Delete this file to commit and share them.
  *
  !config.json
  ```

  Nothing shows in `git status`, an agent's `git add -A` skips open reviews, and checkouts leave
  ignored files alone. `cpr/config.json` stays trackable: CI reads it.
- Shared, once `cpr/.gitignore` is deleted: the files are committed like any other, where it
  suits (on the agent's branch the review travels with the work; on `main` everyone sees it).
  The format above is made for that: one file per reviewer, stable sorted lines.
- CPR never runs `git add` or `git commit`.
- A repository whose own `cpr/` folder holds tracked files that are not CPR's (`git ls-files
  cpr`: anything but `config.json`, `.gitignore` and `reviews/`) is left alone: reviews stay in
  the cache, and the page says why. A `*` there would hide that project's new files.
- Drafts sit in the same file: that is what feedback to the agent (later) will read.
- `cpr/config.json` replaces `cpr.config.json` (`plugins`); the old file is still read when the
  new one is absent. `.cprignore` stays at the root for now: core reads it per revision, an
  analysis change.

#### Reviewing a branch

- The row menu (V14) gains "Review ▸": a submenu with the row's branches, one entry per branch
  name (local or remote), each a badge with a note: "not reviewed", or "40 of 63 reviewed · 2
  commits since". `r` on the cursor row opens it, as `c` opens "Check out".
- Not offered on the default branch (`origin/HEAD`, else `main`, else `master`): it has no fork
  point (later: review it from a commit you pick).
- Fork point: `git merge-base <tip> <default branch>`, recomputed at each review. A rebase moves
  it, and fingerprints then flag what changed, as I1 does after a rebase.
- Server: `POST /api/reviews { branch }` (a write: same-origin JSON with the custom header)
  resolves the tip and fork point, starts the analysis in `/api/diffs`' queue (the same 8 kept),
  and answers `{ url: '/review/<branch, URL-encoded>/' }`. Under that path the server serves
  the branch's diff with the viewer's files and API, as under `/diff/<pair>/`; a path opened
  anew (a reload, a new `cpr view`) resolves the tip itself, as V9's diff URLs do.
  `./api/state/review` and `./api/state/drafts` read and write the branch's file (both in one
  file; `head` and `updated` set on each write).
- The diff page's header: "Review of wip · a1b2c3d → e4f5a6b · 2 commits since your last
  review". The change list already marks reviewed symbols and flags "↻ changed since you
  reviewed it".

#### The commits page

- `GET /api/reviews` → the reviewer's reviews: branch, fork point, the tip last reviewed, the
  commits since (`git rev-list <head>..<tip>`, at most 100), marks.
- A reviewed branch's badge gets "✓" when the review's head is the tip, else "+2" (commits
  since). Rows of commits added since the review get a dot ("new since your review").

#### Code

- `packages/cli/src/reviews.ts` (new): paths from branch names, the reviewer, read (missing or
  invalid → empty), write (sorted, atomic: temp file + rename, as `fileStateStore`), list.
- `packages/cli/src/server.ts`: `/api/reviews` (GET, POST) and `/review/<branch>/`.
- `packages/core/src/git`: `defaultBranch`, `forkPoint` (`merge-base`), with `isCommit`'s
  checks on what reaches git (branch names only as `listRefs` lists them).
- `packages/viewer`: the row menu's "Review ▸" (`CheckoutMenu` becomes the row menu), badges
  and dots on the commits page, the review header on the diff page.
- No graph change (no schema bump).

#### Verification

1. **Unit** (red first): paths from branch names (slashes, remote prefixes); the file's bytes
   stable and sorted; a missing or invalid file; the reviewer from git config, and its absence;
   fork points on temp repositories (a branch off `main`, after `main` moved, after a rebase);
   `cpr/.gitignore` written on the first review and never changed after, `git status` clean
   after a review, the review file untracked once `.gitignore` is deleted, a foreign `cpr/`
   folder left alone; server: `POST /api/reviews` for an unknown branch (400), the default
   branch (refused), a state round trip writing `cpr/reviews/<branch>/<email>.json` in the
   working tree with nothing staged.
2. **E2E** (red first), a fixture branch "written by an agent": review it from the row menu
   (header, nothing marked); mark two symbols; a commit added that changes one of them; review
   again: one still reviewed, one "↻ changed", the new symbols unmarked; the commits page shows
   "+1" on the badge and a dot on the new commit; the file in `cpr/reviews/` survives a restart
   of `cpr view` on a new port.
3. **Nothing else changes**: compare-mode pairs and `cpr pr` keep their cache state (existing
   tests); goldens unchanged; every e2e spec.
4. **Real repository**: on a clone of this repository, review V12's branch at `d175ee5`, mark
   everything, move the tip to `86dcb60`: 83 of 83 marks valid, 2 symbols left (as measured).
5. **Cost**: a review is one analysis, as a picked pair (1.0–1.4 s on this repository);
   `/api/reviews` one `rev-list` per reviewed branch.

**Risks**

| Risk | Mitigation |
|---|---|
| Reviews stay on one machine by default | Asked. Deleting `cpr/.gitignore` shares them; the format is made for it. |
| `git clean -fdx` deletes ignored files, reviews with them | Only with `-x`; the README says so. Shared reviews are in git. |
| Each worktree has its own `cpr/`: an agent working in its own worktree does not see your reviews | Nothing reads them yet. Feedback to the agent (later) will write where the agent works, or give it the path. |
| A project with its own `cpr/` folder | Left alone when it tracks files that are not CPR's; reviews stay in the cache. |
| Shared: review files carried by a checkout, or git refusing one when the target has its own version of a file | New untracked files never block a checkout (V11 counts tracked changes only); one file per reviewer and branch makes "its own version" rare; the confirmation shows git's refusal, as today. |
| Shared: an agent can write review files too, marking its own work reviewed | The file names its reviewer and git says who committed it. Not enforced (later: a warning when a review file's last commit is not by its reviewer). Local reviews: anything on the machine can write them. |
| Shared: the same reviewer on two machines edits one file | Sorted JSON, one mark per line: a conflict is a few plain lines. |
| Email addresses in the tree | The same as in commit metadata; a noreply address works the same. |
| A renamed or deleted branch | The review stays as history; a new name starts a new review. |
| A renamed file loses its marks (13 in the measurement) | I1's limit, unchanged. |
| Commits of review files show in diffs' file lists (`graph.files` lists non-code files) | No symbols, so no changes or findings; used only for comment anchors. |

**Order**: V15a (reviews in `cpr/`, "Review" a branch: core, server, menu, header); V15b (the
commits page shows progress); V15c (`cpr/config.json`). One branch.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V15a ✅ | Branch reviews | `cpr/reviews/<branch>/<reviewer>.json`, local by default (`cpr/.gitignore`); "Review ▸" in the row menu; `/review/<branch>/` with marks kept across new commits; the review header. |
| V15b ✅ | Progress on the commits page | `GET /api/reviews`; "✓" or "+n" on reviewed branches' badges; dots on commits added since. |
| V15c ✅ | `cpr/config.json` | Plugins read from `cpr/config.json`, else `cpr.config.json`. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 71 | Where reviews live | **`cpr/reviews/` at the repository's root, kept out of git by a `cpr/.gitignore` CPR writes once (`*`, `!config.json`) and never changes after; deleting it shares reviews through commits; CPR never stages or commits** | Asked: a folder at the root, then "gitignore it". `.git` cannot be shared and the cache is cleared with caches; `cpr/config.json` must still reach CI. Pytest and ruff keep their folders out of git the same way. |
| 72 | What a branch review is keyed by | **The branch name without its remote; marks checked by fingerprint** | Measured: 97.7 % of marks still valid after a new commit; per pair, none. |
| 73 | Whose review a file is | **One file per reviewer, named by `git config user.email`** | Two reviewers never write one file; the email is already in their commits. |
| 74 | Where a branch review starts | **The fork point with the default branch, recomputed each time; not offered on the default branch** | What a pull request of the branch would show; the default branch has no fork point. |
| 75 | What stays in the cache | **Compare-mode pairs and `cpr pr` reviews** | A picked pair is a look, not a branch's review; `cpr pr`'s review goes to the forge, and its marks already outlive pushes. |

**Not in V15 (later)**: feedback to the agent (drafts as a prompt or file it reads); agent
commits marked (co-author trailers, bot authors, branch names like `codex/`); a commit's details
beside the list; reviewing the default branch from a picked commit; other reviewers' reviews on
the commits page; `.cprignore` in `cpr/`; checking who last committed a review file.

#### As built — V15

- **Core** (`src/git/branches.ts`): `defaultBranch`, `forkPoint`, `commitsBetween`,
  `userEmail`, `trackedFiles`, and the types the viewer reads. `forkPoint` takes the latest
  merge-base among the default branch's local and remote refs, not `merge-base <tip> <default>`
  as planned: an agent that branched from `origin/main` while the local `main` was stale would
  otherwise have its review start before commits that are not its own. `trackedFiles` uses a
  `:/cpr` pathspec, so `cpr view` started in a subfolder checks the right folder. No analysis
  code changed: the goldens are unchanged.
- **CLI** (`src/reviews.ts`): as planned. Marks and drafts share one file, so writes go one at
  a time per file (read, change, write back, atomically). A branch name only remotes have (a
  review's address opened anew) is found on `origin` first. The server keeps the review each
  branch's page shows; asking again re-resolves the tip. A review page whose branch cannot be
  reviewed answers its graph with the reason (404).
- **Viewer**: `CheckoutMenu.tsx` became `RowMenu.tsx` (entries, each with a submenu; ↑/↓ move
  between entries, `RefBadge`) and `CheckoutDialog.tsx`. The Review submenu has an entry per
  branch name: a row holding `v12` and `origin/milestone/v12-open-in-vscode` at the same commit
  offers both. Its note says "12 reviewed · 2 commits since", not the planned "40 of 63": the
  total needs the analysis. Reviews are read again when the page is back in focus (a review is
  made on another page; its marks do not change the history's version).
- The review page's header is "Review of wip · 2 commits since your last review", without the
  planned SHAs: the summary right after it already shows them (seen on the first screenshot).

**Results (V15)**. Tests first: core 7 of 7 and CLI 11 of 11 failed before the code existed,
the server's 5 new tests failed (no routes), the e2e spec failed on the missing "Review" entry.
Now 587 unit tests (29 new: core 8, CLI 17 with server and config, viewer 4) and 67 e2e (1 new:
review an agent's branch, mark both changes, the file in `cpr/reviews/` with `git status`
clean, "✓"; the agent changes `square` and adds `half`: "+1" and a dot; reviewing again from
the keyboard leaves 1 of 3 with one symbol "changed since you reviewed it"; a restarted
`cpr view` on a new port finds the review).

On a clone of this repository with `main` set back before V12's merge (`d67a5d6`), through
`cpr view`'s API: reviewing `v12` at `d175ee5` gave 83 changed symbols, all marked; with the tip
moved to `86dcb60`, `/api/reviews` reported "+1" and that commit, and reviewing again found 83
still reviewed, none changed, 2 left, as the spike measured. From "Review" to the graph: 1.6–1.7
s. The file landed in `cpr/reviews/v12/reviewer@example.com.json`; `git status` stayed clean.
`GET /api/reviews`, which the commits page now asks for beside its first rows: 10 ms on Qwik
(694 refs), 24 ms on Bitwarden (2,231 refs), 14 ms with one review (medians of 5). Screenshots
light and dark: the badge's "+1", the dot, the Review submenu, the review header; no page
errors.

Not verified: Windows and macOS (branch folders, `@` in file names); a review shared through
git and merged from two machines (the format is made for it, not exercised); worktrees; Firefox
and Safari; first rows drawn (not re-measured: the reviews request runs beside the listing).

### V16 — Finish a review: verdict, feedback for the agent, push on approval

**Status:** merged into main (2026-10-14, from branch `milestone/v16-finish-review`). As built
and results: "As built — V16" below.

**Problem** (asked, after reviewing V15 in the viewer: "how to end review?"; then "Yes, plan
it"; then: "Wouldn't it be better to save it as a JSON instead of md? … This would work locally,
comparing local commit made by an agent, with a past commit...after approve, it should be pushed
to the origin, only in this case..we should not touch the cpr pr feature"). An agent commits
locally; the reviewer reviews those commits in `cpr view`. Today the review has no end, no way
to tell the agent what to fix, and nothing happens on approval:

- Outside `cpr pr` the reviewer can only mark symbols. Comments on lines, the summary and a
  verdict (Comment, Approve, Request changes) exist only under `cpr pr`, where they go to the
  forge (G2); `cpr view` hides them, branch reviews included. The reviewer's own review of V15
  (`4061f2b..60d94e1`, compare mode): 86 of 87 symbols marked, 0 comments (none possible), and
  no way to say "done" or "fix this".
- Feedback to the agent goes through chat, without a place. In this session "bad styling on
  checkout option in dropdown" took two close-up screenshots to locate (the button 121 of the
  menu's 150 px wide).
- The commits page shows no outcome: V15's "✓" means only that something was marked at the tip.
- Approved work is pushed by hand, and nothing stops pushing more than was reviewed: the agent
  may have committed again since.
- An agent working on the default branch itself cannot be reviewed: V15 offers no review there
  (no fork point), though its unpushed commits are exactly what needs one.

Checked: `git push <remote> <sha>:refs/heads/<branch>` pushes that commit and no later one,
updates `<remote>/<branch>`, and creates the branch when the remote lacks it (then
`--set-upstream-to` works); git refuses a push that is not a fast-forward, with its message (a
temporary repository with a bare remote). The server's address (`http://127.0.0.1:<port>`) is
a secure context in Chromium, so the page may copy to the clipboard. Graph nodes carry line
ranges per side, so a comment's line names its symbol.

**Goal**: On a branch review the reviewer comments on lines, as under `cpr pr`, and finishes
the review in the Review tab: Approve, Request changes or Comment. The verdict and its comments
are recorded in the review's JSON file (V15's `cpr/reviews/<branch>/<reviewer>.json`), which the
agent reads; "Copy for the agent" puts them on the clipboard as text. **Approve pushes the
reviewed commit** to the branch on its remote — that commit, not a newer one; Request changes
and Comment never push. The commits page shows the outcome on the branch's badge. The default
branch becomes reviewable: its unpushed commits, from where it was last pushed. Everything stays
local; **`cpr pr` does not change** (its Review tab still posts to the forge), nor do
compare-mode pairs.

#### Comments and the Review tab on a branch review

- A branch review's page names a local review target: `/api/capabilities` answers `review: {
  forge: 'local' }`. The viewer then shows comments in the detail panel (`c`, a line picked) and
  the Review tab, as for `cpr pr` (`ReviewTab`, `comments.ts`); its button says "Finish review"
  or, with Approve chosen, "Approve and push" (below).
- Drafts and the summary are kept in the review file, as V15 does; I1's rules carry them to a
  new tip (a comment on a symbol that changed becomes outdated and goes into the summary).
- Finishing posts `./api/review` with the drafts as `toReview` makes them (the same request as
  for a forge, checked by `parseReview`). The drafts and summary are then cleared: the verdict
  holds them, and the next round starts empty.

#### The verdict, in the review's JSON

- The review file gains `verdicts`, appended on each finish (sorted keys, as the rest of the
  file):

  ```json
  "verdicts": [
    {
      "at": "2026-10-14T10:12:00Z",
      "comments": [
        {
          "body": "Keep `a * a`: it reads better here.",
          "code": "  return a ** 2;",
          "id": "c1",
          "line": 12,
          "path": "src/math.ts",
          "side": "head",
          "symbol": "src/math.ts#square"
        }
      ],
      "event": "request-changes",
      "head": "<the tip reviewed>",
      "summary": "The summary, as written."
    }
  ]
  ```

  `side: "base"` is a removed line, at the review's `base` (its fork point). Comments without a
  line (outdated, or on a symbol with no changed line) have no `line` and `code`. Each carries
  its symbol and code line, so the agent finds the place after it commits again (V12 measured
  1–62 % of added lines moving within a few commits); `id`s let a later step mark comments
  answered.
- JSON, not Markdown: one file holds the review and its outcome (nothing to keep in step),
  fields a script or hook can read without parsing prose, and stable lines for git as the rest
  of the file. Agents read JSON as well as Markdown; for a chat, "Copy for the agent" renders the
  last verdict as text (first line "Address this review of the branch agent:", then the summary
  and each comment with its file:line, symbol and code line).
- `GET /api/reviews` adds the last verdict (event, tip, time, comment count).
- Badge marks replace V15's: "+2" when the branch has commits since the review; else "✓"
  approved at the tip, "✗" changes requested at the tip, "…" marks at the tip and no verdict
  yet. The Review submenu's notes say the same in words ("approved and pushed", "changes
  requested · 2 commits since", "40 reviewed · in progress").
- README: a "For agents" note — read the last entry of `verdicts` in `cpr/reviews/<your
  branch>/*.json` before continuing.

#### Approve pushes the reviewed commit

- On Approve the server runs `git push <remote> <reviewed sha>:refs/heads/<branch>`: the
  branch's upstream (remote and branch name) when it has one, else `origin` and the same name,
  then `git branch --set-upstream-to=<remote>/<branch>`. Never `--force`: a push that is not a
  fast-forward is refused by git, and its message is shown. No remote: the approval is recorded
  and the page says there was nothing to push to.
- Exactly the reviewed commit: commits the agent made after the review stay local, and the page
  says so ("pushed e4f5a6b to origin/agent; 2 newer commits not pushed: not reviewed").
- The button says what will happen before it does: "Approve and push 3 commits to origin/agent"
  (the commits between the remote branch and the reviewed tip). Hooks run as git runs them
  (`pre-push`); prompts are off (`GIT_TERMINAL_PROMPT=0`), so a remote that needs a password
  fails with git's message rather than waiting.
- The verdict records the push: `push: { remote, branch, sha }` or `push: { error }`. A refused
  push leaves the approval standing; the Review tab offers "Push again".
- Request changes and Comment never push.

#### The default branch: its unpushed commits

- V15 offered no review of the default branch. Now it is reviewable when it has an upstream:
  from where it was last pushed (`merge-base <tip> <upstream>`, e.g. `origin/main`) to its tip
  — the agent's local commits. Nothing unpushed: "main has no unpushed commits". No upstream:
  not offered, as before.
- Other branches keep V15's start (their fork point): a review covers everything a push sends.

#### Server

- Branch review sites get a local `ReviewTarget` (`forge: 'local'`). Its `submit` maps each
  comment to its symbol (the node whose range on that side holds the line), reads the code line
  at that side's commit, appends the verdict to the review file, pushes on Approve, and answers
  `{ verdict, push?, text }` (the text for the clipboard) instead of a forge URL.
- `ReviewTarget.forge` becomes `'github' | 'gitlab' | 'local'`; `cpr pr`'s targets are untouched.
- Core: `pushCommit(repo, sha, remote, branch)` and the branch's upstream, in `src/git/` (no
  analysis change).

#### Verification

1. **Unit** (red first): verdicts appended with comments (head and base sides, a renamed file,
   outdated and unanchored drafts), comment → symbol by range, the clipboard text; on temporary
   repositories with a bare remote: Approve pushes the reviewed commit only (a later commit stays
   local), creates the remote branch and sets the upstream, a diverged remote is refused with
   git's message and nothing changes, no remote; the default branch's start from its upstream,
   and "no unpushed commits".
2. **Server**: `/api/capabilities` on a branch review says `review: { forge: 'local' }`; `POST
   ./api/review` records the verdict, refuses comments outside the change and requests other
   sites could send; compare-mode pairs still have no review target; `cpr pr`'s review tests
   unchanged.
3. **E2E** (red first), on V15's agent fixture with a bare `origin`: comment on `square`,
   Request changes: the verdict in the JSON, drafts cleared, "✗", the clipboard's text, nothing
   pushed; the agent commits a fix: "+1"; review again, Approve: "✓", `origin/agent` at the
   reviewed commit; an agent commit after that review stays unpushed. The agent on `main`:
   reviewable from `origin/main`, approved and pushed.
4. **Real repository**: on a clone of this repository with a local bare remote: review `v12`,
   comment on three symbols (one on a removed line), Request changes, read the JSON; Approve and
   push.
5. **Cost**: finishing reads one file per comment at its commit; under 100 ms for ten comments
   here. The push is git's.

**Risks**

| Risk | Mitigation |
|---|---|
| Approve pushes more than was reviewed | The reviewed SHA is pushed, never the branch name; newer commits stay local and the page says so. |
| A push is hard to undo | Only on Approve; the button names the remote branch and how many commits; never forced, so a remote that moved refuses. |
| A push needs credentials or a slow hook | Prompts off: git's message shown; "Pushing…" meanwhile; the approval stands, "Push again" retries. |
| Line numbers move once the agent commits again | Each comment carries its symbol and code line; the verdict names the reviewed tip. |
| An agent acts on an older request after an approval | The last verdict is the one to read; it names its tip. |
| Comments on a branch review mistaken for a pull request review | "Finish review" / "Approve and push"; the tab says the feedback stays in the repository. |
| Clipboard refused (permissions, another browser) | The verdict is in the file anyway; the button says the copy failed. |

**Order**: V16a (verdicts in the review file, the local target, push on approval, the default
branch's start; CLI, server and core git helpers), V16b (the viewer: comments and the Review tab
on branch reviews, badges, copy, push results), on one branch.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V16a ✅ | Verdict, push, the default branch | Local review target; `verdicts` with comments in the review JSON; Approve pushes the reviewed commit; the default branch reviewable from its upstream; verdicts in `/api/reviews`. |
| V16b ✅ | Finish from the viewer | Comments and the Review tab on branch reviews ("Finish review", "Approve and push N commits to origin/x"); "✓", "✗", "…", "+n" on badges; "Copy for the agent"; push results and "Push again"; README note for agents. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 76 | How a branch review ends | **A verdict in the Review tab — Approve, Request changes or Comment — recorded at the tip; drafts cleared after** | Asked ("how to end review?"); the same three verdicts as `cpr pr`, so one flow to learn. |
| 77 | Where the agent finds feedback | **In the review's JSON (`verdicts`, last entry), plus "Copy for the agent" as text** | Asked ("Wouldn't it be better to save it as a JSON"): one file, structured fields, stable for git; text only for a chat. |
| 78 | What a comment carries | **File, side and line at the reviewed tip, the symbol, the code line, the comment, an id** | Lines move when the agent commits again; the symbol and the line's text still find it. |
| 79 | Badge marks | **"+n" commits since; else "✓" approved, "✗" changes requested, "…" in progress** | The badge should say the outcome, not only that something was marked. |
| 80 | What Approve does | **Pushes the reviewed commit (by SHA) to the branch's upstream, else `origin/<branch>` with the upstream set; never forced; nothing on the other verdicts** | Asked ("after approve, it should be pushed to the origin, only in this case"); by SHA so nothing unreviewed goes out. |
| 81 | The default branch (supersedes 74 there) | **Reviewable when it has an upstream: from where it was last pushed to its tip** | Asked: the agent's local commits against a past commit; on the default branch that past commit is the last one pushed. |

**Not in V16 (later)**: comments and verdicts on compare-mode pairs and `cpr view <base>
<head>` (no branch to push); copying the verdict into the agent's own worktree; an agent marking
comments answered by `id`; posting a branch review to a forge once a pull request exists.

#### As built — V16

- **Comments know their symbol from the draft**, not from a line range on the server as
  planned: a draft is written on a symbol, so `toLocalReview` sends its `symbol` and `id`, and
  the server checks the symbol against the graph and the line as for a forge (`parseReview`,
  reused, its errors renamed per comment). Drafts without a line stay structured comments, where
  `toReview` (for a forge) folds them into the summary.
- **Core** (`src/git/branches.ts`): `upstreamOf` (`%(upstream:remotename)` and
  `%(upstream:remoteref)`), `listRemotes`, `pushCommit` (a SHA to `refs/heads/<branch>`, names
  checked, git's refusal as `PushRefused`), `setUpstream`, `mergeBase`; no analysis change.
- **The push target**: the local branch's upstream, else the remote branch reviewed (a review
  of `origin/topic`: already there, so nothing is pushed), else `origin/<branch>`. The count on
  the button ("Approve and push 3 commits") is computed when the review is opened; the push
  itself looks again.
- **"Copy for the agent"** is in the note after finishing only; the plan also put it in the
  review page's header while changes are requested (later: the verdict is in the file).
- **Marks**: V15's "✓" (something marked at the tip) is now "…"; "✓" means approved.
- A comment typed while the symbol's code is still loading is not added on Ctrl+Enter (the text
  stays in the box): `cpr pr`'s behaviour, unchanged, seen while taking screenshots.
- The e2e agent fixture has a bare `origin` with `main` pushed and tracked; its cleanup retries,
  since the server may still be saving the cleared drafts when the test ends.

**Results (V16)**. Tests first: core 3 of 3, CLI 6 of 6 (5 new and V15's resolve test), server
2, viewer 6 failed before the code. Now 599 unit tests (12 new) and 69 e2e (2 new: a comment on
`square` and Request changes — the verdict in the JSON, drafts cleared, "✗", the clipboard's
text, nothing pushed —, the agent's fix ("+1"), Approve and push (`origin/agent` at the fix,
"✓"); the agent's commit on `main` reviewed from `origin/main` and pushed). `cpr pr`'s review
tests unchanged.

On a clone of this repository with a local bare `origin` (`main` at `d67a5d6`), through `cpr
view`'s API: reviewing `v12` (`86dcb60`, 6 commits to push) with three comments, one on the base
side, Request changes took 12 ms and recorded the verdict with its three code lines; Approve took
73 ms with the push: the bare `origin` had `v12` at `86dcb60`, the upstream was set, `git
status` stayed clean, and `/api/reviews` reported the approval as pushed. Screenshots light and
dark: the Review tab with a comment and Request changes chosen, the note after finishing, the
commits page with "✓" on `v12` and `origin/v12` and "✗" on branches with changes requested; no
page errors.

Not verified: remotes that need credentials (prompts are off, so git's message is shown) and
slow `pre-push` hooks; Windows and macOS; the clipboard in Firefox and Safari.

### V17 — Approve means "merge it": a verdict for the agent, not a push

**Status:** merged into main (2026-10-14, from branch `milestone/v17-approve-means-merge`). As
built and results: "As built — V17" below.

**Problem** (asked, after approving four branches in CPR and asking for each merge in chat: "How
can we automate this…"; then "approve should mean merge into main...and
not automatically"; "This tool should be used on any other project"; "Aprove is just a
metadata...that will tell the agent to merge into whichever is the default branch of that git
repository"). V16's Approve pushes the reviewed commit; what the reviewer wants from it is the
merge, done by the agent when told to act on the review. Measured today on this repository:

| What | Measured |
|---|---|
| Approvals whose push did anything | **0 of 4** (V16, the `cpr-review` skill, two fixes): the agent had pushed each commit 2–4 minutes before; `origin`'s reflog has one entry per branch, the agent's |
| Approvals followed by the reviewer asking for the merge in chat | **4 of 4** (3 typed "merge into main", 1 answered "Yes"); the merge, its checks and push were then done by the agent |
| A branch approved at its tip, then 5 commits on `main` merged into it (no conflict) | CPR shows **"+6"** and the "new since your review" dot on all 5 of `main`'s commits; the branch's own new commits: **1** (the merge) |
| `git merge-tree --write-tree` (no checkout, index or ref touched), 40 recent unmerged branches against the default branch | Bitwarden: 2 conflict, median 3 ms, max 871 ms. Qwik: 19 conflict (old lines such as `v1`, `v3`: 57–59 files), median 599 ms, max 5.2 s. This repository: all 70 branches merged |
| Instructions an agent in another repository gets | **None**: what a verdict means is in this repository's `cpr-review` skill and README only |

Causes: Approve is wired to a push (decision 80), which an agent that pushes as it goes makes a
no-op, while the step the reviewer wants is not recorded anywhere for the agent. "Since" counts
`rev-list <reviewed>..<tip>`, which includes the default branch's commits once it is merged into
the branch — the usual way to resolve a conflict. Nothing tells the reviewer, before approving,
that the merge will conflict.

**Goal**: Approve is metadata. The verdict records the approved commit and the branch to merge it
into — the repository's default branch, whatever its name — and CPR does nothing else: **no push,
no merge**. The agent, when the person asks it to act on the review, merges exactly that commit;
on a conflict it resolves on its own branch and the person reviews that. CPR writes the
instructions for agents into `cpr/` so this works in any repository, not only this one. Request
changes and Comment, the review files' place, `cpr pr` and compare mode do not change.

#### The verdict

- An approve verdict gains `"into": "<default branch>"` (V15's `defaultBranch`: `origin/HEAD`,
  else `main`, else `master`), next to `head`, the approved commit. CPR no longer pushes: no
  `push` on new verdicts, no `POST ./api/review/push`, no `push` in `/api/capabilities`. Old
  verdicts' `push` fields are read and ignored.
- Approve's button says "Approve" again; after finishing, the tab says "Approved abc1234: the
  agent merges it into main when you ask it to act on this review", with "Copy for the agent"
  (as for the other verdicts). The text: "Approved the branch agent at abc1234: merge it into
  main." plus where the review is and where the instructions are.
- Titles and notes drop "pushed": "Approved". A branch whose approved tip is already in the
  default branch says so: "Approved · merged into main" (badge title, Review submenu note).
- The default branch's own review (decision 81, its unpushed commits): there is nothing to merge
  into, so its Approve has no `into` and tells the agent those commits may be pushed — the agent
  pushes only if the project does.

#### Commits since a review

- "Since" counts only the branch's own commits: `rev-list <reviewed>..<tip> --not <default
  branch, local and remote>`; the dots on the commits page follow. The measured case becomes
  "+1" (the merge commit), and reviewing again shows the branch against today's default branch
  (V15's fork point moves to its tip), with marks kept on everything the resolution left alone.
- The default branch's own review keeps today's count (nothing to exclude).

#### Will it merge?

- A branch review checks the merge in the background: `git merge-tree --write-tree --name-only
  --no-messages <default branch> <tip>` (git 2.38+), cached per pair of commits. Exit 0: clean;
  1: the conflicting paths; anything else: "could not check".
- `GET ./api/merge` answers `{ into, clean }`, `{ into, conflicts: [paths] }` or `{ into, error }`;
  the Review tab shows "Merges cleanly into main", "Conflicts with main in 2 files: src/a.ts,
  src/b.ts — the agent merges main into the branch first", or nothing while it runs. Not on the
  commits page (Qwik's slowest check took 5.2 s).
- Not stored in the verdict: the default branch moves; the agent finds out when it merges.

#### Instructions for agents, from CPR

- When CPR creates `cpr/` (with V15's `.gitignore`) it also writes `cpr/AGENTS.md`, and
  `cpr/CLAUDE.md` importing it (`@AGENTS.md`), so Claude Code loads it when it reads anything in
  `cpr/`. CPR rewrites `AGENTS.md` when its text changes (a first line says CPR writes it); when
  `cpr/` holds the project's own files (V15's cache case), nothing is written.
- Each review file gains a first key (keys are sorted), `"about": "A CPR review. Agents: read
  cpr/AGENTS.md before acting on it."`, so any agent that opens a review finds the instructions.
- What `AGENTS.md` says (the `cpr-review` skill's rules, extended): act on the last verdict when
  the person asks; `request-changes`: fix in new commits; `comment`: answer; **`approve`: merge
  `head` — not the tip, newer commits are not approved — into `into`** (`git merge --no-ff`,
  unless the project merges otherwise), then push only if the project does. **On a conflict**:
  abort, so the default branch is untouched; merge the default branch into the feature branch,
  resolve there, commit; never rebase approved commits; do not merge until approved again. Never
  edit `cpr/`.
- This repository's `cpr-review` skill becomes a pointer to `cpr/AGENTS.md` (one text, CPR's);
  its CLAUDE.md says an Approve, when the user asks to act on the review, is the "yes" to merge.

#### Verification

1. **Unit** (red first): an approve verdict has `into` and pushes nothing (a bare remote is
   unchanged); the default branch's approve has no `into`; "since" after merging the default
   branch into a reviewed branch is 1, not 6, and only the merge commit gets a dot; the merge
   check on temporary repositories: clean, two conflicting files, git's error; `AGENTS.md` and
   `CLAUDE.md` written with `.gitignore`, rewritten when stale, not written when `cpr/` is the
   project's; `about` first in the file; the clipboard text.
2. **Server**: `/api/merge` on a branch review; no push endpoint; `cpr pr`'s review tests
   unchanged.
3. **E2E** (red first), V16's agent fixture: Approve → "Approved …", `origin` unchanged, "Copy
   for the agent"; a conflict made on `main` → the Review tab names the file; the agent merges
   `main` into its branch → "+1"; the approved tip merged into `main` → "merged into main".
4. **Real repositories**: a Qwik branch that conflicts (the Review tab lists its files, the check
   in the background); on a clone of this repository, an approved branch merged by following
   `cpr/AGENTS.md` step by step.
5. **An agent reads it**: does Claude Code load `cpr/CLAUDE.md` in a git-ignored folder when it
   reads a review there? Checked once; the `about` key and the copied text carry the pointer
   either way.
6. **Cost**: the merge check never blocks the page; the commits page's `/api/reviews` adds one
   `rev-list` per reviewed ref.

**Risks**

| Risk | Mitigation |
|---|---|
| An agent merges because it noticed an approval, unasked | `AGENTS.md`: act on a verdict when the person asks; an approval is the "yes" to merge only then. |
| The agent merges commits made after the approval | The verdict names `head`; `AGENTS.md` says merge that commit; "+n" shows the rest. |
| Conflicts resolved on the default branch, unreviewed | `AGENTS.md`: abort, resolve on the branch, ask for a review again; the Review tab warns before approving. |
| A slow merge check (5.2 s on Qwik) | In the background, cached per pair; the tab shows nothing until it is done. |
| `merge-tree` writes objects | Only loose objects in `.git/objects` (git's own garbage collection removes them); no ref, index or working-copy change. |
| git older than 2.38 | "Could not check the merge"; everything else works. |
| A person edits `cpr/AGENTS.md` | Its first line says CPR rewrites it; a project's own rules belong in its own CLAUDE.md or AGENTS.md. |
| Reviews written by V16 (with `push`) | Read as before; the field is ignored. |

**Order**: V17a (CLI and core: `into`, no push, "since", the merge check, `AGENTS.md`, `about`),
then V17b (the viewer), then V17c (README, this repository's skill and CLAUDE.md).

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V17a ✅ | The verdict as metadata | `into` on approve; push removed (`pushCommit`, `setUpstream`, `listRemotes`, the push endpoint); "since" without the default branch's commits; `GET ./api/merge`; `cpr/AGENTS.md`, `cpr/CLAUDE.md`, `about`. |
| V17b ✅ | The viewer | "Approve"; the note and "Copy for the agent" after approving; the merge check in the Review tab; "Approved", "merged into main" in titles and notes. |
| V17c ✅ | Docs | README (what Approve means, for agents); the skill as a pointer; CLAUDE.md's merge rule. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 82 | What Approve does (supersedes 80) | **Records the approved commit and `into`, the default branch; CPR pushes and merges nothing; the agent merges that commit when asked to act on the review** | Asked ("Aprove is just a metadata...that will tell the agent to merge"; "not automatically"); 0 of 4 approvals' pushes did anything; 4 of 4 were followed by asking for the merge in chat. |
| 83 | Commits since a review | **Only the branch's own: not those reachable from the default branch** | Merging the default branch into a branch showed "+6" for one commit. |
| 84 | Checking the merge | **`git merge-tree` in the background on a branch review, shown in the Review tab, not stored** | Touches no checkout, index or ref; 3 ms median on Bitwarden but up to 5.2 s on Qwik, so never on the commits page or in the way. |
| 85 | Where agents learn what a verdict means | **`cpr/AGENTS.md`, written by CPR beside the reviews; `about` in every review file** (no `cpr/CLAUDE.md`: Claude Code loads a folder's AGENTS.md itself, checked) | "This tool should be used on any other project": the rules lived in this repository's skill only. |
| 86 | Conflicts | **Resolved on the feature branch (the default branch merged into it), reviewed again; never on the default branch, never by rebasing** | The resolution is code nobody reviewed; rewriting approved commits breaks marks and pushes. |
| 87 | Approve on the default branch's own review | **No `into`: those unpushed commits may be pushed, if the project pushes** | Nothing to merge into; V16 pushed here. |

**Not in V17 (later)**: a signal that wakes the agent when a verdict is recorded (a watcher, or a
command run after each verdict from `cpr/config.json`); CPR merging by itself; conflicts on the
commits page's badges; a verdict on compare-mode pairs.

#### As built — V17

- **No `cpr/CLAUDE.md`.** Checked with Claude Code 2.1.296 in a temporary repository whose `cpr/`
  is git-ignored: asked to read only a review file there, it answered with a marker word that only
  `cpr/AGENTS.md` held, one `Read` in its log — with `cpr/CLAUDE.md` and without it; reading the
  same file from another folder, it had no marker. Claude Code loads a folder's AGENTS.md itself,
  so CPR writes that one file (and, in CPR's cache, an AGENTS.md beside the cached reviews).
  `cpr/AGENTS.md` counts as CPR's own when a project commits `cpr/`.
- **One button, "Finish review"**, for every verdict; the line above it says what Approve asks
  ("Approve asks it to merge 561a0b4 into main. CPR pushes nothing.").
- **Conflicting files, one per line** (asked: "put each file on it's line..with a icon that
  opens the file in vscode"): a button with V12's open icon, the file's name, its folder dimmed
  and cut short (the full path in the title). On Qwik the two paths as one sentence took six
  lines of the 300 px sidebar. The button opens the file at line 1 in the working copy through
  `POST ./api/open`, which accepts a branch review's conflicting files though they need not be
  part of the change (Qwik's: an `.api.md` file); nothing else outside the change opens.
- **`GitError` keeps git's stdout**: `merge-tree` answers on stdout with exit 1 when it conflicts.
- **The merge check needs the analyzed review** (it is served beside the graph), which the Review
  tab needs anyway.
- The old push endpoint now answers 405, as for any POST the server does not take. Verdicts
  written by V16 keep their `push` field; nothing reads it.
- This repository's `cpr-review` skill points at `cpr/AGENTS.md` (the text: `AGENTS` in
  `packages/cli/src/reviews.ts`); CLAUDE.md says an Approve, when the user asks to act on the
  review, is the yes to merge.

**Results (V17)**. Tests first: core 3, CLI 11 and server 2, viewer 2 failed before the code; e2e
3 of 4 review specs failed on the old viewer. Now 602 unit tests and 71 e2e (one new: a branch
that conflicts with `main` — the Review tab names `math.ts`; the agent merges `main` into its
branch: "+1", the dot on its merge commit only; reviewed again: "Merges cleanly into main").

An agent following `cpr/AGENTS.md`: Claude Code, headless, in two temporary repositories with a
real CPR approval and a bare `origin`, told only "Check my CPR review of the branch agent and act
on it." Clean: it found `cpr/`, read `AGENTS.md` and the review, merged exactly the approved
commit into `main` with `--no-ff` (`main`'s parents: the old `main` and `5f3fe66`), left the
commit made after the approval out and said it needs a review, pushed nothing, changed nothing in
`cpr/`; CPR then showed "+1" (that commit) and "merged". Conflict (`main` had added a function
where the agent had): it tried the merge, aborted it (`main` unchanged), merged `main` into
`agent`, resolved, committed, pushed nothing, and asked for another review; CPR then showed "+1"
(the merge only) and "Merges cleanly into main" (10 ms).

Qwik, the agent-written branch `origin/claude/http-error` (3 commits, 2 files conflicting with
`main`): the review's graph in 6.7–10.3 s, then the Review tab's conflict line 0.5 s after the tab
opened ("Conflicts with main in loader-handler.unit.ts, qwik-router.runtime.api.md"); no page
errors; nothing written into the clone (the review in CPR's cache, without a git user).

Not verified: agents other than Claude Code reading `cpr/AGENTS.md` (the `about` key and the
copied text name it); git older than 2.38 ("Could not check the merge"); Windows and macOS.

### V10c — Picks across branches: diverged picks compared from their fork point

**Status:** merged into main (2026-10-14, from branch `milestone/v10c-picks-across-branches`).
As built and results: "As built — V10c" below. Planned with V10 (decision 52, "Picking across branches" there); refined here, before V10b, on
today's code and measurements.

**Problem** (asked: "let's do v10c first"; "be absolutely sure that it renders the correct
changes, in most of the cases"). Since V10a the commits page lists every branch, and compare mode
(V13) picks any two rows. Two picks on branches that diverged are compared **directly**: the
server analyzes every pair with `cpr diff <base> <head> --no-merge-base`
(`packages/cli/src/runner.ts`). Everything the base's branch did since the fork then shows as
reverted in head. The label (`a1b2c3d → e4f5a6b · N commits`) counts only head's side and does
not say the picks diverged. Measured on the regression clones (`HEAD` as checked out there, every
branch listed):

| Repo | Diverged pairs among the first 25 rows / first 100 | HEAD against the 20 unmerged remote tips nearest the top: diverged | …tip on the lower row (today's base) | Files in the direct diff / the branch's own (median) | Direct diff's files the branch never touched |
|---|---|---|---|---|---|
| CPR | 0.7 % / 0.4 % | no unmerged remote branch | — | — | — |
| zod | 64 % / 34 % | 17 | 17 | 208 / 9 | 91.6 % |
| vite | 32 % / 55 % | 15 | 15 | 101 / 5 | 95.8 % |
| Qwik | 19 % / 53 % | 19 | 19 | 187 / 15 | 84.7 % |
| Bitwarden | 74 % / 96 % | 20 | 20 | 99 / 5 | 67.3 % |

Through CPR's analysis, one pair each (HEAD against an unmerged remote branch):

| Pair | Direct (today) | From the fork point |
|---|---|---|
| Qwik `3fd543f` / `origin/fix-unclaimed-visible` | 43 files; 1 added, 6 removed, 9 modified symbols; 3 findings | 7 files; 1 added, 0 removed, 4 modified; 1 finding |
| zod `b500a2e` / `origin/bench/recursive-type-wall-clock-20260929` | 24 files; 21 added, 9 removed, 155 modified | 12 files; 21 added, 3 removed, 151 modified |

Causes:
- Pairs are analyzed directly (V9's decision, made when the page listed one branch: there every
  pair was an ancestor and its descendant, and direct equals from-the-fork).
- The base is the lower row. In graph order a diverged branch's tip is usually below the
  default branch's newest commits: 71 of 71 diverged pairs above. So even from the fork point
  today's rule would show what `main` did, not what the branch did.
- Nothing on the page says the picks diverged or where.

**Goal**: two picks that diverged compare what the head pick's branch adds since the two forked,
as `cpr view <base> <head>`, `cpr diff` and pull requests do. The base is chosen so that this is
the branch's own work in the usual cases (a branch against the default branch, wherever HEAD is).
The compare bar says the picks diverged, where (the fork point, marked in the graph and a click
away), and how many commits each side has; Swap exchanges the sides. A pick and its ancestor, and
one pick against its parent, compare exactly as today. `cpr diff`, `cpr pr`, branch reviews and
the analysis do not change.

#### Which pick is the base (viewer, pure)

For two picks where neither is an ancestor of the other, the base is, in order:
1. the pick on the **default branch's line** (the first-parent line from its tips: the local
   branch and each remote's, as V15's `forkPoint` takes them);
2. else the pick on **HEAD's line** (lane 0);
3. else the **lower row** (older in graph order).

Rule 1 covers a branch against the default branch whether the default branch or the branch is
checked out (in this repository the agent's branch often is, and rule 2 alone would then show
`main`'s work). Rule 2 covers "This branch" and repositories without a default branch. A pick and
its ancestor: the ancestor is the base, as today. Swap exchanges base and head; picking again
resets it.

#### The fork point and the counts (viewer, pure)

- `comparison(picks, shape)` in `src/commits.ts` paints down from both picks in row order (graph
  order: every child above its parents, so a row's flags are final when it is reached): rows
  reached by one side are counted for it, and the first row reached by both is the fork point.
  It stops when no row reached by one side alone is left. This replaces `countBetween`, which
  walked the whole history from both picks on every render.
- The fork point is a best common ancestor by construction (no other common ancestor is below
  it). Where git has several (criss-cross merges), it may not be the one `git merge-base` prints;
  the label and the diff use the same one. Prototype against git on 300 random pairs among the
  first 2,000 rows of each of CPR, zod, vite, Qwik, Bitwarden, CPython (621 diverged):
  **fork = `git merge-base` 1,800 of 1,800; both sides' counts = `git rev-list --left-right
  --count` 1,800 of 1,800**; slowest 2.0 ms.
- No fork point: if a row reached has a parent the shape does not hold (a shallow clone's edge,
  or the first rows before the shape is in), the answer is "unknown": "Listing the history…"
  until the shape arrives, then "Their fork point is not in this clone". Otherwise the picks
  share no history (39 of Qwik's 300 pairs: its unrelated lines). Either way Compare is off.
  No direct diff instead (decision 52).

#### Compare bar and graph (viewer)

- Diverged picks: `9f8e7d6 → e4f5a6b · 5 commits`, then "diverged from a1b2c3d (3 commits not
  in this diff)"; the fork's short SHA is a button that moves the cursor to its row; "Swap".
  Ancestor picks keep today's label.
- The fork point's dot gets a dashed ring (`fork-ring`), as V10 planned.
- Compare sends `{ base: <fork point>, head }` to `POST /api/diffs`: the server is unchanged
  and the diff is served at `/diff/<fork>..<head>/`, the same pair `cpr view <fork> <head>` and
  the label name. For ancestor picks the fork is the base, so the request is today's.

#### The default branch in the shape (core, server)

- Core: `defaultBranchTips(repo)` → `{ name, tips }` (V15's `defaultBranch` and the same tips
  `forkPoint` uses), null without one.
- `GET /api/history/shape` gains `defaultBranch: { name, rows }`: the rows of those tips in the
  scope's listing (absent when none is listed, e.g. "This branch" on a branch behind which `main`
  moved). Read once per listing, when the shape is made; the history's version already follows
  every branch.

#### Verification

1. **Unit** (red first): `comparison` — one pick (its parent), an ancestor pair (as today, both
   orders), diverged picks (fork, both counts, label), the three base rules and Swap, a merge
   commit as a pick, a criss-cross (the fork is one of the two bases), unrelated lines, a missing
   parent (unknown), counts equal to the old `countBetween` on ancestor pairs. Core:
   `defaultBranchTips` (origin/HEAD, `main`, none; local and remote tips). `Histories`: the shape
   carries the default branch's rows; absent when not listed.
2. **E2E** (a new `serveDiverged` fixture: `main` adds two functions after `topic` forked; `topic`
   adds one and changes one): pick `main`'s tip and `topic`'s → the diverged label, the fork ring,
   the fork button; Compare → the diff lists only `topic`'s symbols (none of `main`'s as removed);
   Swap → only `main`'s; ancestor picks unchanged; with `topic` checked out, the same base (rule 1).
   Every existing spec passes.
3. **Against git on real repositories** (`scripts/viewer/compare-check.mjs`, the viewer's own
   `comparison` on the shape the server sends): CPR, ky, zod, vite, Qwik, Bitwarden, CPython —
   ≥ 1,000 random pairs each, near the top and across the whole history: the fork point is one of
   `git merge-base --all` (and how often it is git's), both counts equal `rev-list`, unrelated
   pairs recognized; and HEAD against every unmerged remote tip: the base is HEAD's pick.
4. **The diff renders the branch's changes** (end to end, `cpr view`'s server, the request the
   page sends): on zod, vite, Qwik and Bitwarden, several HEAD/branch pairs: the graph's files
   equal `git diff --name-status <head pick>...<branch>` (three dots: from the merge-base), and
   its symbols, edges and findings equal `cpr diff <head pick> <branch>`'s (merge-base by
   default). The diff page in a browser (`viewer-check`): screenshots light and dark.
5. **Nothing else changes**: no analysis code touched (goldens identical); `cpr diff`/`cpr pr`
   tests unchanged; ancestor pairs send the same request as `main`.
6. **Cost**: `comparison` under 5 ms on CPython's shape for any pair; first rows as fast as
   `main` (the shape gains one small field).

**Risks**

| Risk | Mitigation |
|---|---|
| The diff page names the fork, not the pick (`9f8e7d6 → e4f5a6b`) | The label says so before Compare; the pair is the one `cpr view <fork> <head>` serves. |
| Criss-cross merges: our fork point is not git's | Still a best common ancestor; label and diff agree; the check script counts how often it differs. |
| The default branch is unknown or not listed | Rule 2 (HEAD's line), then the older pick; Swap. |
| Two feature branches: no side is "right" | The newer is head (what it adds since they forked); the label names both sides' counts; Swap. |
| A shallow clone hides the fork | "Unknown", Compare off; no guess. |

**Order**: the pure `comparison` and its tests, checked against git with the script; the shape's
default branch (core, server); the compare bar, ring and Swap; the e2e fixture; the end-to-end
check on real repositories.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V10c | Picks across branches | `comparison` with the fork point, both counts and the base rules; `defaultBranch` in the shape; the diverged label, fork ring and button, Swap; Compare from the fork point; `compare-check.mjs`. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 88 | Which diverged pick is the base (supersedes 52's "the lower pick") | **The pick on the default branch's line, else on HEAD's line, else the lower row; Swap** | 71 of 71 diverged HEAD/branch pairs had the branch on the lower row: the lower pick as base shows `main`'s work. Rule 1 holds wherever HEAD is (here the agent's branch is often checked out). |
| 89 | Where the fork point is found (supersedes V10's `from: 'fork'` in `POST /api/diffs`) | **In the page, from the shape, and sent as the base** | Matches `git merge-base` on 1,800 of 1,800 pairs, in ≤ 2 ms; the label is shown before any request, and the diff then analyzes exactly the fork the label names; the server is unchanged. |
| 90 | No fork point | **Say why (no shared history, not in this clone, still listing); Compare off** | A direct diff would show the other side's work as reverted (decision 52); precise beats complete. |

**Not in V10c (later)**: a direct diff of diverged picks; ranking a pick merged into the default
branch above one that is not; the diff page naming the picks it came from; V10b (branches panel).

#### As built — V10c

- **The fork point's SHA comes from the rows' details.** The shape holds row numbers only, so
  `comparison` takes `shaAt(row)` (the details loaded) besides `parents`, `head`, `trunk` and
  `complete`. While the fork's row is not loaded the bar says "Finding where … forked…" and the
  page loads its block of 200 (one request, 16–20 ms anywhere in a history, V10).
- **`comparison` returns `{ pair, label, diverged? }`**: `pair` null with the reason in the label;
  `diverged` names the other pick, its commits since the fork, the fork's row and which rule chose
  the base (`default`, `head`, `older`) for the note's title. It replaces `countBetween`, which
  walked the whole history from both picks on every render; the result is now memoized.
- **The bar**: `8dd3ab0 → 7b3a37e · 2 commits · diverged from 3fd543f: its 11 commits since the
  fork are not in this diff` (Qwik), the fork's SHA a button to its row, then Swap. The title
  says why: "3fd543f is on main: this diff shows what 7b3a37e adds since they forked at 8dd3ab0.
  Swap compares 3fd543f instead." The SHAs keep the monospace font; the note takes the page's.
- **Swap keeps focus**, so Enter right after it swaps again (V9's rule: a focused button takes
  Enter); Compare is the next control.
- **The default branch's tips are read while git lists the history**, not after: read after, the
  shape took 26–35 ms longer on Bitwarden; alongside, 9–12 ms.
- **Core**: `defaultBranchTips(repo)`; `forkPoint` and it share `branchTips`. `HistorySource`
  gains an optional `defaultBranch()` (tests' fakes have none); a failed shape is not kept.
- **Two scripts** stay: `scripts/viewer/compare-check.mjs` (the viewer's `comparison` against git
  on whole histories) and `scripts/viewer/diverged-diffs.mjs` (`cpr view`'s server driven as the
  page does, the graph against `git diff A...B` and `cpr diff A B`).

**Results (V10c)**. Tests first: 13 unit tests failed before the code (viewer 11, 4 of them
existing tests on the new API; core 1; CLI 1);
on `main`'s build 3 of the 4 new e2e tests failed on the label (`main`'s tip compared directly
with the branch's), the ancestor-pair one passed on both. Now 613 unit tests and 75 e2e.

Against git (`compare-check.mjs`, 500 random pairs among the first 2,000 rows and 500 anywhere):

| Repo | Rows | Pairs (diverged / no shared history / several merge-bases) | Fork = `git merge-base`; both counts = `rev-list`; base's side by the rules | Default branch against each diverged remote branch: the branch is head, from the fork | Slowest |
|---|---|---|---|---|---|
| CPR ("This branch") | 243 | 998 (2 / 0 / 0) | 998 of 998 | — (none) | 0.4 ms |
| ky | 593 | 998 (0 / 0 / 0) | 998 of 998 | 1 of 1 | 0.4 ms |
| zod | 4,239 | 997 (297 / 0 / 1) | 997 of 997 | 124 of 124 | 0.2 ms |
| vite | 10,359 | 997 (95 / 0 / 0) | 997 of 997 | 80 of 80 | 0.3 ms |
| Qwik | 12,362 | 997 (265 / 126 / 0) | 871 of 871; the 126 "share no history" | 124 of 124 | 0.7 ms |
| Bitwarden | 39,861 | 997 (505 / 31 / 0) | 966 of 966; the 31 "share no history" | 1,534 of 1,534 | 0.6 ms |
| CPython | 150,182 | 997 (37 / 0 / 0) | 997 of 997 | 5 of 5 | 3.2 ms |

End to end (`diverged-diffs.mjs`: `cpr view`'s server, the default branch's tip and the three
nearest diverged remote branches' tips picked, the pair the page sends analyzed): **12 of 12
graphs hold exactly the branch's files (`git diff --name-only A...B`) and equal `cpr diff A B`**
(files, symbols, edges, findings). Beside them, what `main`'s page analyzed for the same picks:

| Pair | V10c: from the fork, the branch as head | `main`: the branch's tip as base, directly |
|---|---|---|
| zod `b500a2e` / `c7705c5` | 38 files; 100 added, 12 removed; 2 findings | 44 files; 12 added, **100 removed**, 1 modified; 0 findings |
| vite `cf80aa5` / `f957682` | 3 files; 3 added, 1 modified | 48 files; 0 added, **3 removed**, 1 modified |
| Qwik `3fd543f` / `7b3a37e` | 7 files; 1 added, 4 modified; 1 finding | 43 files; 6 added, 1 removed, 9 modified; 4 findings |
| Qwik `3fd543f` / `aec301b` | 49 files; 151 added, 1 removed, 10 modified; 3 findings | 142 files; 29 added, **151 removed**, 38 modified; 12 findings |
| Bitwarden `51450a5` / `2651094` | 4 files; 4 modified; 3 findings | 44 files; 7 added, 25 modified; 12 findings |

On the Qwik clone in Chromium (1440 × 900, light and dark): `main` and `origin/fix-unclaimed-visible`
picked, the bar and the dashed ring as above, no page errors. Cold `cpr view`, 4 rounds against
`main`'s build back to back: first rows unchanged (Bitwarden 267–283 against 268–299 ms, CPython
812–848 against 820–876 ms); the shape 87–94 against 75–82 ms (Bitwarden), 350–372 against
339–380 ms (CPython). No analysis code changed (goldens unchanged), so no regression-check run.

Not verified: Windows and macOS; Firefox and Safari; a repository whose default branch is not
`main` or `master` and has no remote `HEAD` (rule 2 then, as unit-tested); shallow clones beyond
the unit test.

### V10b — Branches panel: every branch a click away

**Status:** merged into main (2026-10-14, from branch `milestone/v10b-branches-panel`). As built
and results: "As built — V10b" below. Planned with V10 ("Branches panel" there, decision 53); refined here on today's page (V11–V17
since) and measurements.

**Problem** (asked with V10: "exactly like git extension, or gitty up … with the branch trees on
the left"; "graph + branches panel"; now "start with v10[b]"). The commits page lists every
branch's commits, but a branch can only be found by scrolling and reading badges: there is no
list of branches and no search. Branch tips sit deep in graph order. Measured on this repository
and the regression clones (every branch listed, `listRefs` as the row menu calls it):

| Repo | Local / remote branches | Remote: not in a folder / folders (deepest nesting) | Tip rows: median / p90 / deepest | Tips in the first 25 rows / 200 | Name length: median / p90 / max | `listRefs` |
|---|---|---|---|---|---|---|
| CPR | 14 / 62 | 1 / 5 (1) | 155 / 230 / 242 | 7 / 43 | 25 / 30 / 38 | 4–6 ms |
| zod | 1 / 154 | 103 / 13 (1) | 978 / 3,338 / 4,058 | 8 / 16 | 18 / 40 / 58 | 6–13 ms |
| vite | 1 / 88 | 42 / 14 (1) | 691 / 4,896 / 9,260 | 10 / 24 | 23 / 58 / 83 | 9–11 ms |
| Qwik | 1 / 133 | 74 / 10 (2) | 3,695 / 7,443 / 8,889 | 3 / 4 | 23 / 39 / 55 | 6–7 ms |
| Bitwarden | 1 / 1,591 | 519 / 105 (3) | 9,165 / 21,794 / 37,633 | 9 / 74 | 29 / 53 / 133 | 22–23 ms |
| CPython | 1 / 6 | 6 / 0 | 16,397 / 33,308 / 33,308 | 1 / 1 | 4 / 4 / 4 | 8–16 ms |

- Most tips are out of reach by scrolling: Bitwarden's median tip is 9,165 rows (293,000 px)
  down, Qwik's 3,695; only 4–74 tips per repository are in the first 200 rows.
- Since V11 and V15 a branch's row is where it is checked out and reviewed (c, r): reviewing an
  agent's branch starts with finding its row.
- Folders do not make a short list on their own: Bitwarden has 519 remote branches outside any
  folder, beside 105 folders. The filter is what finds a branch there.
- Names run long: a 260 px panel holds about 35 characters; half of Bitwarden's names are 29 or
  more, the longest 133.

**Goal**: a panel left of the graph lists the branches — local ones with how far each is from its
upstream, remote ones by remote and folder — with a filter on top. A click puts the cursor on
the branch's tip row, wherever it is in the history, and flashes it; from there c and r check it
out or review it as today. Reviewed branches show their mark as their badges do. Tags stay
badges on rows (decision 48). The rows, the graph, compare mode, the row menu, `cpr view
<base> [head]`, `cpr diff` and `cpr pr` do not change.

#### Tips' rows (core, server)

- `GET /api/history/refs?scope=…&version=…` → `{ version, branches, remotes }`: `listRefs`'s
  local and remote branches, each with `row`, its tip's row in that listing (null when the scope
  does not list it). It waits until the listing is done (tips sit deep); a stale version answers
  409, as rows and shape do. `/api/refs` (the row menu's) is unchanged.
- Server: `Histories.tips(scope, version, shas)` maps SHAs to rows from the kept order (one map
  per listing, made once).
- Core type `HistoryRefs` beside `HistoryShape`.

#### The panel (viewer)

- A pure `branchTree(refs, filter)` in `src/branches.ts`:
  - **Local**: the current branch first, then by name; each with `↑2 ↓1` against its upstream
    (title: "2 commits not pushed to origin/main, 1 not pulled") or `gone` when the upstream was
    deleted.
  - **Remotes**: per remote, then folders by `/` (nested: Bitwarden has 3 levels), each with its
    count; a branch shows its last part (`milestone/v10b-…` under `milestone/` reads `v10b-…`).
    Folders start closed; remotes open. By name, folders first.
  - **Filter**: case-insensitive, on the whole name; folders with matches open, others hidden;
    counts become matches. Nothing matching: "No branch matches".
- `src/BranchesPanel.tsx`: about 260 px, its own scroll, left of the rows, the whole height
  beside the list; names cut with an ellipsis, the full name as title; a reviewed branch's mark
  (V15/V16's `reviewMarks`) after its name. Under 900 px it is hidden behind a "Branches" button
  in the title and opens over the rows; a click on a branch closes it.
- A click on a branch: the cursor on its tip row, scrolled to the middle (its details load as for
  any rows in view), the row flashes (1 s). Under "This branch", a tip not listed switches to
  every branch first, then goes there. A tip in no listing (a remote branch whose history the
  clone lacks): the entry is greyed, with a title saying so.
- `/` focuses the filter; Escape there clears it, then leaves it.

#### Verification

1. **Unit** (red first): `branchTree` — the current branch first; ahead/behind and `gone`;
   folders nested by `/`, counts, closed at first; the filter (case, whole name, folders opened,
   counts, nothing matching). `Histories.tips` — rows, null for a tip not listed, waits for the
   listing, stale version. The server's `/api/history/refs` (shape of the answer, 409, defaults).
2. **E2E** (a new `serveBranches` fixture: 300 commits on `main` written with `fast-import`,
   `origin/feature/deep` forked near the bottom, `origin/fix/one` and `origin/fix/two`, a
   top-level `origin/topic`, local `wip` ahead 2 and behind 1 of `origin/wip`, local `old` whose
   upstream is gone): the panel's sections, counts and marks; a folder opened; the filter; a
   click on the deep tip puts the cursor there and it is in view; "This branch" then a remote
   branch: every branch, and the tip; `/` and Escape; under 900 px the button and the overlay;
   no sideways scroll; every existing spec passes.
3. **Real repositories** (`viewer-check`): on Bitwarden — the panel drawn with 1,591 remote
   branches (time to draw, page elements), a filter keystroke, a click to the deepest tip
   (row 37,633): the row drawn with its details, no task over 100 ms; first rows against
   `main`'s build (the panel loads after them). Screenshots of this repository (14 local, 62
   remote), light and dark, and at 900 px.
4. **Cost**: `/api/history/refs` under 150 ms on Bitwarden once listed; first rows unchanged.
5. **Nothing else changes**: no analysis code; goldens identical; `/api/refs` unchanged.

**Risks**

| Risk | Mitigation |
|---|---|
| 1,591 remote branches, 519 outside folders | Folders closed; the filter; measure drawing every entry before virtualizing anything. |
| The panel narrows the rows (260 px of 1,440) | Subjects are cut already; under 900 px the panel is a button; author and date stay in view (checked). |
| Refs move while the page is open (a fetch) | The answer carries the history's version; 409 → the page lists anew (V10a's path). |
| A tip no listing holds (a shallow clone; a remote branch never fetched) | Its entry is greyed with a title; nothing to go to. |
| Long names | Ellipsis, the full name as title; the filter matches the whole name. |

**Order**: the endpoint and `branchTree` with their tests; the panel and the click; the narrow
layout; the e2e fixture; real repositories.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V10b | Branches panel | `/api/history/refs` with tips' rows; `branchTree`; the panel (Local, Remotes by folder, filter, marks); a click to the tip; "This branch" switching; `/`; the narrow overlay. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 91 | Where tips' rows come from | **`GET /api/history/refs?scope&version`: `listRefs` with each tip's row in that listing; 409 when stale** | Rows belong to one listing; the page has the SHAs of loaded rows only, and tips sit deep (Bitwarden's median row 9,165). `/api/refs` stays the row menu's, unversioned. |
| 92 | What the panel lists, and how (refines 53) | **Local (current first, ↑/↓, gone); Remotes by remote and nested folders, closed at first; a filter on the whole name; review marks** | Asked: "the tree should be branches only". 519 of Bitwarden's 1,591 remote branches are in no folder, so the filter, not the folders, makes it short. |
| 93 | What a click does | **The cursor on the tip row, in the middle, flashed; "This branch" switches to every branch when needed; no action from the panel** | Checking out and reviewing already live on the row (c, r): one place for them. |
| 94 | Narrow windows | **Under 900 px, a "Branches" button opens the panel over the rows** | The rows need the width; V10 planned the same. |

**Not in V10b (later)**: actions from the panel (check out, review, delete, fetch); hiding
branches from the graph (checkboxes); sorting by date; tags in the panel; the panel on a diff's
page.

#### As built — V10b

- **Escape leaves the filter and keeps it**, not "clears it, then leaves it" as planned: the
  viewer already has that rule for every text field (`App.tsx`), and the change list's search
  follows it. The filter is a text field like that search: a search field clears itself on
  Escape in Chromium, so the two would have behaved differently.
- **Enter in the filter goes to the first branch listed.** The e2e test first tabbed from the
  filter to the branch and landed on its remote's folder: type a few letters, then Enter.
- **The filter and the folders opened are kept by the page**, across a scope switch or a listing
  anew (a checkout); the panel draws them.
- **The panel lists branches once the shape is in**: before it, the list is as tall as the first
  rows, and a deep tip cannot be scrolled to.
- **Badges shrink.** With the panel taking 260 px, rows with two long branch badges pushed their
  author and date past the list's edge: on this repository 3 of 35 rows at 1,100 px and 8 at
  900 px (`main`: none; it clipped 3 at 800 px, by the same cause). Badges now shrink with an
  ellipsis once the subject has no room left, named in full on hover; the author can shrink, the
  date cannot. Clipped rows, measured from 800 to 1,920 px on this repository, Bitwarden and
  Qwik: 0 at every width.
- **`Histories`** keeps one SHA-to-row map per listing, shared by the shape and the tips.
- The browse-mode help gains "/ finds a branch".

**Results (V10b)**. Tests first: 6 unit tests failed before the code (`branchTree` 4, `Histories`
1, the server 1); on `main`'s build the 7 e2e tests of `branches.spec.ts` fail. Now 619 unit tests
and 82 e2e (the badges' test fails without the shrink: 1 row clipped at 1,000 px).

On the regression clones in Chromium (1440 × 900, warm server, 3 rounds):

| | This repository | Bitwarden |
|---|---|---|
| Branches (local / remote) | 14 / 63 | 1 / 1,591 |
| `/api/history/refs` | 5–6 ms | 26–28 ms |
| Panel drawn after the first rows | 8–11 ms | 44–61 ms |
| Panel entries / page elements | 23 / 524 | 628 / 2,622 |
| Filter keystrokes: animation frames over 50 ms | 0 | 0 |
| A click to the deepest tip, until its row is drawn with its details | 21 ms (row 4) | 89–94 ms (row 37,633, `origin/feature-personal-item-clone`), no frame over 50 ms |

First rows against `main`'s build, back to back on Bitwarden: 1,119–1,142 ms against
1,108–1,130 ms (both include the WSL font-layout cost V10a found). Screenshots of this repository,
light and dark at 1440 px and the overlay at 800 px; no page errors. No analysis code changed.

Not verified: Windows and macOS; Firefox and Safari; moving through the panel with arrow keys
(not built: Tab and Enter); screen readers beyond the roles given (`complementary`, folders'
`aria-expanded`).

### V18 — Start a feature: a branch, a worktree and an agent, from the commits page

**Status:** merged into main (2026-10-15, from branch `milestone/v18-start-a-feature`): V18a,
V18b and V18c, all of V18 (V18d–e became V20, asked: "Rename V18d and V18e into V20"). As built
and results: "As built — V18a", "— V18b" and "— V18c" below.

**Problem** (asked: "Let's continue with our agentic flow...from the commits view page, i would
like to "Start a new feature" feature"; then, choosing among options: CPR starts the agent; the
agent works in its own worktree; "plan first" is chosen per feature; and "Do not look at how this
repo is worked on": the design is for any repository). Since V15–V17 CPR is where a person
reviews an agent's branch and records a verdict the agent acts on. The loop's first step is not
in CPR: the commits page checks out and reviews, but starts nothing. Starting a feature with an
agent by hand, measured on the regression clones (ky, zod, vite, Qwik, Bitwarden, CPython) and
with Claude Code 2.1.296:

| Step | Measured |
|---|---|
| A branch and its worktree at a chosen commit (`git worktree add`, warm, 3 runs) | ky 12–20 ms (115 files, 1.7 MB); zod 66–85 ms (742, 17 MB); vite 165–178 ms (2,866, 30 MB); Qwik 315–402 ms (4,806, 56 MB); CPython 453–463 ms (6,545, 150 MB; 10.4 s cold); Bitwarden 644–854 ms (9,282, 173 MB) |
| Claude Code's own worktrees (`--worktree`, and background sessions isolating themselves) | Branch `worktree-<name>` from the remote default branch (`worktree.baseRef: "fresh"`), not from a picked commit; the folder is `.claude/worktrees/<name>` inside the checkout |
| A worktree inside the checkout | `.claude/worktrees/` is ignored by **0 of 6** clones: it shows in `git status`, and `git add -A` there picks it up. zod's root `tsconfig.json` includes `**/*.ts`, so a nested copy is type-checked with the project. In this repository a root `prettier --check .` fails on **58 files** of a nested copy (exit 1) |
| Starting Claude Code in the background (`claude --bg --name …`) from a script | Refused in **3 of 3** folders tried (this repository's checkout, a worktree of it, a new repository's worktree), exit 1 in 0.7 s: "Workspace not trusted. Run `claude` in … once and accept the trust prompt". Trust is keyed on the main checkout's root (documented); only an interactive `claude` can accept it |
| Claude Code headless (`claude -p`) in a worktree made with `git worktree add -b` | Edits and the commit landed on the feature branch in that worktree; the main checkout's branch and status unchanged (Claude Code skips its own isolation in a linked worktree, as documented); `--session-id` honoured; a one-file task: 8.5 s, $0.006 (Haiku) |
| Which agent works on which branch | `claude agents --json --all`: background sessions with `cwd`, `name`, `state` (`working`, `blocked`, `done`, `failed`, `stopped`) and `waitingFor`, in **153–158 ms**; nothing names a branch; `-p` runs are not listed. The commits page shows none of it |

Causes:
- The commits page only reads, checks out and reviews; starting work is a terminal's job, with
  commands that differ per agent and a trust step a script cannot take.
- Agent tools that make worktrees choose the base and the branch name themselves, and put the
  worktree inside the checkout, where the project's own tools and `git add -A` find it.
- A background agent's only link to a branch is the folder it runs in.

**Goal**: "Start a feature" on the commits page (a header button, `n`, and "Start a feature
here" in a row's menu). The person writes what to build; CPR proposes a branch name, creates the
branch at the chosen commit (the default branch's tip unless a row was picked) with its own
worktree **outside** the checkout, records the brief in `cpr/features/`, and starts the agent
there in the background: Claude Code by default, a command from `cpr/config.json` otherwise. The
branch then shows its agent's state on its badge and in the branches panel — working, needs you,
plan ready, ready for review, failed — with ways to talk to it. "Plan first and wait for my OK"
is a checkbox, on by default. Once the branch has commits, reviewing, the verdict and the merge
are V15–V17's, plus the worktree rules below. CPR never grants Claude Code's trust, never passes
a permission mode the person did not pick, never removes a worktree that holds work, and merges
nothing (decision 82). Without a feature started, nothing changes: the commits page, reviews,
`cpr diff` and `cpr pr`.

#### A feature (core, CLI)

- **The record**: `cpr/features/<branch>.json` (the branch's slashes as folders, as reviews are
  kept), keys sorted, `about` first, the same bytes for the same feature:

  ```json
  {
    "about": "A feature started in CPR. Agents: read cpr/AGENTS.md before acting on it.",
    "agent": { "kind": "claude", "permissionMode": "auto", "session": "<uuid>", "started": "…" },
    "base": "<full SHA>",
    "branch": "feature/export-review-as-csv",
    "brief": "Export a branch review as CSV: …",
    "by": "anton@example.com",
    "created": "2026-10-15T09:00:00Z",
    "from": "main",
    "planFirst": true,
    "worktree": "/home/anton/projects/app.worktrees/feature-export-review-as-csv"
  }
  ```

  One file per feature, not per person: a branch is one feature. Kept where `reviewPlace` keeps
  reviews (`cpr/`, else CPR's cache, with the same note). `cpr/.gitignore` already hides it.
- **One `cpr/` per repository**: the main worktree's (the parent of `git rev-parse
  --path-format=absolute --git-common-dir`), not the working tree `cpr view` runs in. Today each
  worktree has its own `cpr/` (V15's risk table), so a `cpr view` opened in a feature's worktree
  would split its reviews from the main checkout's. This changes `reviewPlace` for people who run
  `cpr view` in a linked worktree; nothing changes in a single checkout.
- **Branch name**: proposed from the brief's first line — lowercase words joined by `-`, at most
  5 words and 40 characters, prefixed `feature/` (`features.branchPrefix` in `cpr/config.json`);
  `-2`, `-3` when taken locally or on a remote. Editable. Checked with `git check-ref-format
  --branch`; refused when it starts with `-` or exists locally or on a remote.
- **Base**: the default branch's tip — of the local and remote default-branch refs (V10c's
  `defaultBranchTips`), the one that contains the other; the local one when they diverged — or the
  picked row's commit (full SHA, `isCommit`).
- **The worktree**: `git worktree add -b <branch> <folder> <base>` (one command makes both;
  never `-B` or `--force`). The folder is beside the checkout,
  `../<checkout folder>.worktrees/<branch, slashes as ->`, configurable as
  `features.worktrees` in `cpr/config.json` (`{repo}` stands for the checkout's folder name);
  refused if it exists. Not inside the checkout (the table above); not in CPR's cache, which holds
  throwaway worktrees (decision 5) and is cleared, while a feature's worktree holds work.
- **`.worktreeinclude`** (Claude Code's file, `.gitignore` syntax): CPR copies the git-ignored
  files it names (`.env`…) into the new worktree, as Claude Code does for the worktrees it makes;
  tracked files never.
- Core, `src/git/worktrees.ts`: `addWorktree`, `listWorktrees` (`git worktree list --porcelain`:
  folder, HEAD, branch, locked, prunable; 2–3 ms), `removeWorktree` (never `--force`: git refuses
  a worktree with changes or untracked files, and says so), `deleteMergedBranch` (`git branch -d`
  only), `mainWorktree`. `listRefs` gains each local branch's `worktree`
  (`%(worktreepath)`), so V11's menu can say "checked out in ../app.worktrees/x" instead of
  offering a checkout git refuses.

#### Starting the agent (CLI)

- **Which agent**: picked per feature in the dialog among those installed (on the PATH, found as
  V12 finds `code`); the default is `agent` in `cpr/config.json`, else Claude Code, else Codex:
  - `"claude"`: Claude Code; optional `permissionMode` and `model`;
  - `"codex"`: Codex (V20a); optional `sandbox`, `approveForMe` and `model`;
  - `{ "command": ["my-agent", "{prompt}"] }`: any other command, run detached in the worktree
    with `{prompt}` replaced, its output in a log file in CPR's cache (V20a);
  - none found: the feature is still made, and "Copy for the agent" gives its prompt, as after a
    verdict.

  The record's `agent.kind` says which one a feature runs, so "Send to the agent" and "Talk to
  the agent" use the same one later; switching agents is a new feature or a new start.
- **Claude Code**: `claude --bg --name <branch> --add-dir <main worktree>/cpr
  [--permission-mode <mode>] [--model <model>] "<prompt>"`, run with `execFile` (no shell) in
  the worktree. The `--bg` text it prints is not parsed (not a stable format): the session is the
  one `claude agents --json --all` lists with that worktree as `cwd` (a real path; unique per
  feature). `--add-dir` lets it read its brief and, later, its reviews; Claude Code's worktree
  isolation refuses its edits in the main checkout (documented), and AGENTS.md says not to.
- **Codex** (0.162 here; V20a): `codex exec --json -C <worktree> -s workspace-write
  [--approve-for-me] [-m <model>] "<prompt>"`, started detached by CPR (Codex has no background
  supervisor like `claude --bg`), its JSONL events in a log in CPR's cache, its process ID in the
  record. State from the process and the last event: running → working; ended after a completed
  turn → plan ready or ready for review, as for Claude Code; a failed turn or a non-zero exit →
  failed. No "needs you": `exec` never stops to ask; a command its sandbox refuses fails, or with
  `--approve-for-me` is reviewed automatically. Reply and "Send to the agent": `codex exec resume
  <thread id> "<text>"` (the ID from the log's first event), appended to the same log; "Talk to
  the agent" copies `codex resume <thread id>`, which continues it in a terminal. Never
  `--dangerously-bypass-approvals-and-sandbox`, never `--worktree` (CPR made it). Not
  `--add-dir`: in Codex it makes a folder *writable*, and `cpr/` is the person's; the prompt names
  the brief and reviews by absolute path (reading them in its sandbox is checked first). Codex
  reads `AGENTS.md` from the repository's root down to its folder, not `cpr/AGENTS.md`: the
  prompt names it. Its account is its own login (`codex login`: a ChatGPT plan or an API key).
- **Failures keep the feature**: the branch, worktree and record stay; the feature reads "agent
  not started" with Claude Code's own words and a way out, and "Start the agent" retries:
  - "Workspace not trusted" → "Run `claude` in <main worktree> once and accept the trust prompt,
    then start the agent." CPR never writes `~/.claude.json` (the trust is the person's to give);
  - not installed, not logged in (`claude auth status` exits 1), or any other exit: its message.
- **The prompt** (`featurePrompt` in `packages/cli/src/features.ts`): the brief; the branch, its
  base and the default branch; with "plan first": "write a plan — what you will change and how
  you will check it — then stop and wait for the person's OK before changing anything"; else
  "plan, build and check it as the project's own instructions say"; commit on this branch as you
  go, push only if the project does; say when it is ready for review in CPR; where the brief and
  reviews are (absolute paths) and that `cpr/AGENTS.md` says how to act on a review. The brief is
  at most 20,000 characters (Windows' command line holds 32,767).
- **Whose account**: the agent is the person's own `claude`, logged in as they are: a Claude
  subscription (here `authMethod: claude.ai`, `subscriptionType: pro`) or an API key. CPR never
  handles credentials and never passes `--bare` (it takes an API key only). The dialog says which,
  from `claude auth status` ("Claude Code · your Pro subscription"), and warns when
  `ANTHROPIC_API_KEY` is set in `cpr view`'s environment, where the agent may use it instead.
  Agents share the subscription's usage limits with the person's other sessions; one that hits
  them stops and is resumed later.
- **Permission mode**: Claude Code's own default unless the person picks "Accept edits" or "Auto"
  in the dialog (default from `agent.permissionMode`). CPR never passes `bypassPermissions` or
  `--dangerously-skip-permissions`; a person who wants that configures it in Claude Code.

#### Agent state (CLI, server)

- `GET /api/features` → `{ features: [...] }`, each `{ branch, base, created, planFirst,
  worktree: { path, exists }, ahead, merged, agent: { kind, state, waitingFor?, id?, error? } }`;
  `ahead` counts the branch's commits since its base, `merged` is V17's check against the default
  branch.
- Claude Code: one `claude agents --json --all` per answer, kept 2 s (153–158 ms each); matched by
  real path. States: `working` → working; `blocked` → needs you (with `waitingFor`: "a permission
  prompt", "input needed"…); `done` → plan ready (plan first, no commits), else ready for review
  (commits), else done; `failed`, `stopped`; no session → not running.
- Asked on load, on focus (as `/api/status` is), and every 5 s while the page is visible and an
  agent is working or needs the person. No feature: no call to `claude` at all.
- `POST /api/features` `{ brief, branch, base?, planFirst, permissionMode? }` → `{ feature }` or
  400 (name, base, brief too long) / 409 (taken, folder exists); `POST
  /api/features/<branch>/start|stop|clean`. Writes as every write: same-origin JSON with the
  custom header, one at a time. The request never names a folder or a command: CPR computes the
  folder and reads the command from `cpr/config.json`.

#### The commits page (viewer)

- **Start**: "Start a feature" in the header (left of Compare mode) and `n`; "Start a feature
  here" in a row's menu (the base is that row). The dialog (`StartFeatureDialog.tsx`): "What
  should the agent build?" (a text area, required); the branch name, proposed as the brief's
  first line is typed and checked as it changes; "From main at a1b2c3d" (or the row's commit);
  "Plan first and wait for my OK" (checked); the agent (Claude Code or Codex, those installed) and
  its permission mode ("Claude Code · permission: default ▾", or the configured command, shown in
  full); the worktree's folder. Ctrl+Enter starts, Escape cancels.
- **After Start** (the history's version changed: a new branch): the page lists anew, the cursor
  on the new branch's row, and a line: "Started feature/export-review-as-csv: Claude Code is
  working in ../app.worktrees/feature-export-review-as-csv".
- **Badges** (V18b): a feature's branch badge gains an agent chip before its name, next to V16's
  review chips after it: working, needs you (its `waitingFor` in the title), plan ready, ready for
  review, failed or not started. Shapes as well as colours, as V16's fix made review chips
  readable. The chip is the link to the feature (below); the branches panel draws the same chip.
- No "Features" section in the branches panel (asked: "should we create a different view for
  features?"): a feature carries more than its 260 px hold (V10b: about 35 characters), and
  in a repository with 1,591 remote branches it would be buried among them. Features have their
  own view.

#### The features view (V18b)

- `/features`, beside the commits page: a tab bar on both pages, "Commits · Features (2)", the
  count being the features that need the person. The server serves the viewer there as at `/`;
  the page reads `/api/features`, on load, on focus, and every 5 s while an agent works or waits.
- One row per open feature, grouped by what it needs from the person, not by stage:
  - **Needs you**: plan ready, waiting (a permission prompt, an answer: Claude Code's
    `waitingFor`), ready for review, changes requested and fixed ("+n" since the verdict), failed
    or not started (Claude Code's words);
  - **Working**: working, with its commits since the start and its uncommitted files;
  - **Done**: approved and merged into the default branch, until cleaned up.
- A row: the agent's chip; the branch (a link, below); the brief's first line (the whole brief on
  a click); the agent's state in words ("Waiting for a permission prompt · 12 min"); commits since
  the start; "3 files not committed yet"; the review's mark (V16: "✓", "✗", "+2"); whether it
  merges cleanly (V17's check, in the background, as the Review tab does).
- Its actions as buttons on the row, what the state allows: Review (V15, once it has commits),
  Talk (copies `claude attach <id>`: it needs a terminal), Open in VS Code (the worktree's
  folder), Start / Stop the agent, Copy the prompt; Reply, Send the verdict and Clean up (V18c).
- "Start a feature" (and `n`) in its header too; after a start the new feature's row is shown
  and flashed.

#### Feature and branch: each leads to the other

- **One key**: a feature is its branch. The record is `cpr/features/<branch>.json`, and both
  pages map a branch name to its feature as reviews do: the local branch and its remote ones
  (`feature/x` and, once pushed, `origin/feature/x`) are one.
- **From the feature to the branch**: the branch name on its row goes to the commits page at the
  branch's tip, `/?branch=<name>` (a new parameter: V10b's "go to a tip" — the cursor there,
  flashed; under "This branch", every branch first). Review opens `/review/<branch>/`.
- **From the branch to the feature**: the agent chip on the branch's badge (rows and branches
  panel) goes to `/features?branch=<name>`, the feature's row scrolled to and flashed; the tip
  row's menu gains "Open its feature"; the review page's header (V15: "Review of wip · …") names
  the brief's first line as a link to the feature.
- Both addresses can be reloaded or bookmarked, as diffs and reviews can.
- **When the link breaks**: a branch deleted or renamed outside CPR leaves its feature saying
  "its branch is gone" (no commits link, no chip anywhere); a new branch of a cleaned-up
  feature's name gets no chip (only open features have one). Following a rename: later.

#### One `cpr view` for every worktree

- Worktrees share the repository's refs and objects: the commits page lists every feature's
  branch and commits, and a review compares commits in CPR's cached worktrees, never a working
  tree. So one `cpr view`, in the main checkout, covers every feature; opened in a feature's
  worktree it shows the same page and the same `cpr/` (decision 103).
- **Uncommitted work** is not in any commit, so no page shows it. The prompt says to commit as it
  goes; `/api/features` adds `worktree.changed` (V11's `workingState` run in the worktree, 3–10
  ms), shown on the feature: "3 files not committed yet".
- **New commits while the page is in view**: the page lists anew on focus only (V11). While an
  agent works, `/api/features` (every 5 s) carries each feature's tip; a tip that moved lists the
  history anew, so the agent's commits appear without leaving the page.
- **Open in VS Code** (V12) opens the repository's root and maps a line to its working copy
  (`editor.ts`): for a branch checked out in a feature's worktree that is the wrong copy. On a
  review of such a branch, it opens that worktree's folder and maps the line there; V17's
  conflicting files the same.

#### Talking to the agent (V18c)

**Problem** (asked: "we move one abstraction up from Claude Code … it will not be anymore a
simple chat with one input"; then "Should we start simple, with only one chatbox, and we'll go
further then?", the box beside the list). Today a feature's agent is talked to only in its
session (`claude attach`, copied by Talk). Measured in the V18c spike (journal, 2026-10-15) with
a real `claude --bg` (2.1.296, its sessions on 2.1.300), Haiku and a Pro subscription:

| What V18a–b and this plan had | Measured |
|---|---|
| Reply by `claude --bg --resume <session> "<text>"` | On a live session (idle after its turn) it starts a **copy** under a new ID, without the original's `--settings`; any flag on a resume makes a copy too ("keeps its own saved options"). `claude stop` (0.66 s), then a resume with no flag (0.73 s), continues the same session with its saved permission mode, settings and model |
| What the agent said is only in its session | A `Stop` hook gets `last_assistant_message`: the whole plan or report, Markdown; no transcript to read |
| Questions and permission prompts are answered by attaching | Hooks passed with `--settings` run in background sessions. A question (`PreToolUse` on `AskUserQuestion`) and a permission (`PermissionRequest`, with an `Edit`'s old and new text or the Bash command) arrive whole and were answered from outside; when the first hook timed out, the question came again through `PermissionRequest` |
| "Plan ready" is `done` with no commits | A finished plan read `blocked` with no `waitingFor`: V18b shows "Waiting: for you". After a commit: `done` |
| (cost of a hook) | A Node script using only Node's modules: 20–34 ms per event; through CPR's CLI, which loads the engine: 286 ms |
| (hooks added later) | A session's options are fixed at its first start: one started without CPR's hooks never gets them |

**Goal**: the features view becomes a list and a panel. Picking a feature shows beside the list
its head (branch, state, facts and V18b's actions), its thread — the agent's reports and the
person's messages, newest last — and one reply box; Send continues the same session with the
text. After a verdict, "Send the verdict" fills the box with the verdict's text (what "Copy for
the agent" copies). Every feature started from V18c on gets CPR's hooks at its first start; in
V18c they only record and decide nothing: what an agent waits on is shown in the panel, and is
answered there in V20b. Features started before V18c keep V18b's behaviour, plus the box; a
repository with no feature makes no call to `claude`, as before.

##### The hooks (CLI)

- **One script, `packages/cli/dist/agent-hook.js`**, Node's modules only (no `@cpr/core`: 286 ms
  against 20–34 ms per event). It reads the event on stdin, finds the feature whose worktree holds
  the event's `cwd` (real paths, the records in `cpr/features/`), and appends one line to that
  feature's thread; what it cannot read or place it leaves alone. It exits 0 and prints nothing:
  it never decides, so Claude Code goes on as without it (its own dialogs, its permission mode).
- **Registered at the first start**: `claude --bg … --settings <cpr>/claude-settings.json`. The
  file is CPR's, the same for every feature, written by `prepareCprFolder` and rewritten when its
  text changes (as `AGENTS.md` is): `SessionStart`, `UserPromptSubmit`, `PermissionRequest`,
  `PreToolUse` (matcher `AskUserQuestion`), `Notification`, `Stop` and `SessionEnd`, each running
  `"<node>" "<agent-hook.js>" "<cpr folder>"` (absolute paths; `process.execPath`). A file, not
  inline JSON: a waking session reads it again (measured), so a new install path reaches older
  sessions when `cpr view` rewrites it. It must be there when a session wakes: without it Claude
  Code stops before starting ("Settings file not found", the session `failed`; with the file
  back, a resume continues it). `cpr view` writes it when it starts and before every start or
  reply. The person's own hooks and the repository's run beside it (measured). Every event is
  registered now so that V20b changes only what CPR answers, for every feature started since
  V18c.
- **The thread**: `cpr/threads/<branch>.jsonl` (the branch's slashes as folders, as features and
  reviews are kept; `cpr/.gitignore` hides it), one JSON line per entry, `{ at, session, kind, … }`:
  - `start` (`SessionStart`: `startup`, `resume`, `fork`) and `end` (`SessionEnd`);
  - `prompt` (`UserPromptSubmit`): what the agent was given — first CPR's prompt, then the
    person's messages;
  - `report` (`Stop`): `last_assistant_message`;
  - `asks` (`PermissionRequest`, and `PreToolUse` on `AskUserQuestion`): the tool and its input,
    at most 4 KB (an `Edit` can carry a whole file), or the questions with their options; a
    question that reaches both hooks (the spike: `PreToolUse`, then `PermissionRequest` when
    nothing answered it) is one entry;
  - `notice` (`Notification`): its type (`permission_prompt`, `idle_prompt`) and message.

  In `cpr/`, not CPR's cache: the cache is cleared (decision 5), and a thread is the feature's
  history. Not the transcript: tool calls and their output stay in the session (`claude attach`).

##### Reply (CLI, server)

- `POST /api/features/reply` `{ branch, text }` (same-origin JSON with the custom header, as every
  write; at most 20,000 characters, as a brief). The feature's newest session (V18b's choice, by
  folder): if its process lives (`status` is `busy`, `waiting` or `idle`), `claude stop <id>`
  first; then `claude --bg --resume <sessionId> "<text>"` in the worktree **with no other flag**.
  Answers `{ feature }`; 409 when there is no session to continue (removed: "Start the agent"
  instead), else Claude Code's words when it fails. The text reaches the thread through
  `UserPromptSubmit`: CPR does not write the person's messages itself, so the thread shows what
  the agent got.
- **A copy anyway**: if after the resume the folder's newest session is not the one resumed, the
  answer says so ("Claude Code started a copy: …"); the page shows the newest, as V18b does.
- **While the agent works or waits on a prompt**, sending stops its turn and drops what it waits
  on: the box says so, and Send becomes "Stop and send", confirmed once.
- `GET /api/features/thread?branch=<name>` → `{ entries }`, the last 200; read when a feature is
  picked and with the list's reads (on focus, every 5 s while an agent works or waits).
- `ClaudeCode` gains `resume(sessionId, cwd, text)`; `start` passes `--settings`.
- **States**: a finished turn is "plan ready", "ready for review" or "done" (V18b's rule by
  commits) when Claude Code says `done`, or `blocked` with no `waitingFor` and the thread's last
  `report` comes after its last `prompt` (measured: a finished plan reads `blocked`). With no
  thread (a feature started before V18c), `blocked` stays "Waiting: for you".

##### The features view: list and panel (viewer)

- Two columns: V18b's groups on the left, each row its chip, branch, the brief's first line and
  its next step in words; the picked feature on the right. `?branch=<name>` (V18b's address)
  becomes the selection: picking writes it with `replaceState`, so reloads and links land there;
  with none, the first feature that needs the person.
- **The panel**: the head (the branch as a link, the review mark, state and facts, and V18b's
  actions — Review, Talk, Open in VS Code, Stop / Start the agent, Copy the prompt — moved from
  the row); the brief, collapsed; the thread — "Agent" reports and "You" messages with their
  times, the first prompt as "CPR's prompt" (collapsed), `asks` as a line ("Waiting: permission to
  run `git commit …`", "Asks: Should farewell end with !? — Yes, end with ! · No punctuation")
  with Talk to answer it (V20b answers it here), a later start as a thin line ("continued", "copy
  started"); then the box, "Reply to the agent…", Send (Ctrl+Enter).
- Messages are shown as written (Markdown as text, `white-space: pre-wrap`): no Markdown library
  in V18c (a new runtime dependency needs a reason, and plans read as text). Since 2026-10-18 the
  agent's reports are drawn as Markdown (decision 118); the person's messages and CPR's prompt
  are still shown as written.
- **Send the verdict**: when the branch's review has a verdict newer than the last `prompt`, the
  panel offers it: it fills the box with `verdictText` (V16's text, the one "Copy for the agent"
  copies), to edit and send. The Review tab's note (V16–V17) gains "Send to the agent", which
  opens the feature's panel with the box filled. Nothing is sent without Send (decision 82).
- A feature started before V18c: "CPR keeps an agent's messages from V18c on: Talk shows this
  one's." The box still works: a resume needs no hook.
- **Width**: from 1100 px both columns (the list 360 px); narrower, the panel takes the page and
  "← Features" goes back. Checked at 1440 and 900 px, light and dark.

##### Verification (V18c)

1. **Unit** (red first): the hook script on the spike's recorded inputs — each event to its line,
   a `cwd` in a subfolder of the worktree, no feature for the folder (nothing written), input that
   is not JSON (exit 0, nothing written), `asks` cut at 4 KB; `claude-settings.json`'s bytes and
   the rewrite when the path changes; `start` passes `--settings`; reply — stop then resume when
   the process lives, resume only when it does not, no other flag, 409 with no session, a copy
   reported; the states (`blocked` with a `report` after the last `prompt`: plan ready; with no
   thread: waiting); the thread's last 200 entries, a broken line skipped.
2. **E2E** (red first), the fake `claude` running the hook command from the `--settings` it is
   given, as Claude Code does (`SessionStart`, `UserPromptSubmit`, `Stop` with a plan): the panel
   shows the plan and "Plan ready"; Send — the fake records `stop`, then `--bg --resume <id>
   "<text>"` and no other flag, and its `UserPromptSubmit` puts "You: …" in the thread; while it
   works, "Stop and send" asks first; a verdict — "Send the verdict" fills the box; the Review
   tab's "Send to the agent" opens the panel filled; `?branch=` reloaded lands on the same panel;
   at 900 px the panel alone with "← Features"; a feature started before V18c — the note, and Send
   still resumes. Every existing spec passes (V18b's row actions are in the panel now; their specs
   follow them there).
3. **A real agent** once, as in the spike (a throwaway repository the person trusts): plan first —
   the plan in the panel, "Plan ready"; a reply — it builds and commits, "Ready for review";
   Request changes, "Send the verdict" — a fix, "+1".
4. **Cost**: the hook 20–34 ms per event; `/api/features` as V18b's (threads are read only by
   `/api/features/thread`, ≤ 20 ms for 200 entries); first rows on the commits page as `main`'s.

**Risks (V18c)**

| Risk | Mitigation |
|---|---|
| A resume with a flag, or on a live session, makes a copy without the hooks | Reply stops a live session first and resumes with no flag; a copy is noticed and said. |
| CPR's install path changes (an update, `npx`) and older sessions' hook command breaks | `cpr view` rewrites the settings file with today's path (whether a waking session reads it again is checked first); a failing hook is a non-blocking error in Claude Code: the session goes on and the thread misses those entries. |
| The thread holds what the agent saw (prompts, commands, excerpts of files) | In `cpr/`, git-ignored, on this machine, as reviews are; `asks` capped at 4 KB. |
| Sending to a working agent loses its turn | "Stop and send", confirmed. |
| Claude Code's hook inputs change | Only documented fields are read (`hook_event_name`, `session_id`, `cwd`, `source`, `prompt`, `last_assistant_message`, `tool_name`, `tool_input`, `notification_type`, `message`); the rest is ignored; the fake replays the spike's inputs. |
| The settings file is deleted (`cpr/` removed by hand) | A session woken from agent view or `claude attach` then fails with Claude Code's "Settings file not found"; `cpr view` writes the file back when it starts and before each start or reply, and a resume then continues the session (measured). |

**Order (V18c)**: the two checks it needed first are done (journal, V18c spike, second run: the
person's and the repository's hooks run beside CPR's file; a waking session reads the file
again, and fails without it). Then the hook script and the settings file, the thread and the states,
reply, the panel, Send the verdict; then Clean up and AGENTS.md (below).

#### Reviews and merges from a worktree (AGENTS.md)

- The feature's agent finds its reviews in the shared `cpr/` (given by `--add-dir`; the prompt
  names the folder), and V17's rules apply.
- Approve says "merge `head` into `into`": from the feature's worktree that fails when `into` is
  checked out in the main checkout ("already used by worktree"), and Claude Code's isolation
  refuses git in the main checkout anyway. `cpr/AGENTS.md` gains: "In a linked worktree, when
  `into` is checked out in another worktree (`git worktree list`), do not merge here: say that
  the approved commit is merged from that worktree." The person asks the agent there (or merges);
  CPR still merges nothing.
- A "Features" part of `AGENTS.md`: what a feature record is, plan first means stop after the
  plan, never edit `cpr/`.

#### Finishing a feature

- Once merged into the default branch, "Clean up": `claude rm <id>` for each session of its
  worktree (measured in the V18c spike: it removes the sessions and leaves a worktree CPR made),
  `git worktree remove` (git refuses while anything is uncommitted or untracked, and the page
  shows its message), `git branch -d <branch>`. The record and its thread stay, the record with
  `finished`; the view lists open features only.
- Not merged: "Stop the agent"; "Clean up" then needs a confirmation and removes the worktree
  only (git refuses it with changes); the branch and its commits stay.

#### Verification

1. **Unit** (red first): core on temporary repositories — `addWorktree` (the branch at the base;
   refused: an existing branch or folder, an invalid name, a name starting with `-`),
   `listWorktrees`, `removeWorktree` (refused with changes and with untracked files),
   `deleteMergedBranch` (refused unmerged), `mainWorktree` from a linked worktree, `listRefs`'s
   `worktree`, `.worktreeinclude` (ignored files only). CLI — the name from a brief (words,
   prefix, `-2`, cap), the record's bytes (sorted, `about` first), the folder, the prompt (plan
   first or not, paths), the base rule (local/remote default branch ahead, behind, diverged);
   reviews and features in the main worktree's `cpr/` when `cpr view` runs in a linked one; the
   launcher with a fake `claude` on the PATH (records argv and cwd; prints `--bg`'s text; or
   fails with the trust message: "agent not started", then "Start the agent" retries); states
   from recorded `claude agents --json` answers (each state, `waitingFor`, symlinked paths, two
   sessions in one folder: the newest). Server: `POST /api/features` (another site refused, 400,
   409), `GET /api/features` (no features: `claude` never run), start, stop, clean.
2. **E2E** (red first), the fake `claude` on the PATH: Start from the header — the branch on the
   page with "working", the worktree on disk on that branch, the record, the fake's argv (`--bg`,
   `--name`, `--add-dir`, the brief in the prompt, cwd the worktree); the fake turns `blocked` —
   "needs you"; it commits and reports `done` — "ready for review", and Review (V15) opens it;
   plan first with no commits — "plan ready"; the trust failure — the message, retry; "Start a
   feature here" on a row — that base; merged — Clean up removes the worktree; a dirty worktree —
   git's refusal; V11's menu says where a feature's branch is checked out; a commit made in the
   worktree appears without leaving the page, and uncommitted files are counted; Open in VS Code on
   the feature's review asks for the worktree's folder and line. The features view (V18b): the
   groups as the fake's states change, the tab's count; a branch's chip opens its feature's row,
   the branch name on that row the commits page at its tip, and both addresses reloaded land in
   the same place; "Open its feature" from the tip's menu and the review page's header; a branch
   deleted in a terminal: "its branch is gone", no chip. Every existing spec passes.
3. **A real agent** (first, see Order): Claude Code in a temporary repository the person trusts
   once — plan first: the plan in the session, `done` with no commits, "plan ready"; a reply: it
   builds and commits in its worktree, "ready for review"; Request changes, "Send to the agent":
   a fix, "+1"; Approve: the feature's agent says to merge from the main checkout, which does.
   Codex the same way once (V20a): plan, reply by `exec resume`, a fix after Request changes.
4. **Real repositories**: on the six clones, a feature started at the default branch's tip — the
   time from Start to the page listing the branch, `git status` of the checkout unchanged;
   Bitwarden with three features: first rows against `main`'s build, `/api/features` time.
5. **Nothing else changes**: no analysis code (goldens); review, checkout and commits specs
   unchanged; a repository with no feature makes no `claude` call.
6. **Cost**: Start answers within the worktree's time (≤ 0.9 s on Bitwarden, warm) plus
   `claude --bg`'s return (measured in the first step); `/api/features` ≤ 200 ms with its 2 s
   cache; first rows as fast as `main`.

**Risks**

| Risk | Mitigation |
|---|---|
| Claude Code does not trust the repository (3 of 3 folders here) | Said with Claude Code's words and the command that fixes it; the feature stays and "Start the agent" retries; CPR never grants trust. |
| A background agent edits or runs commands unasked | Claude Code's permission mode decides: its default unless the person picked another; never bypassed by CPR. It works in its own worktree: the checkout is untouched. |
| Agents cost money and run long | Started only by a click; the dialog names the agent, its mode and the brief; "Stop the agent" in the features view. |
| Worktrees pile up (1.7–173 MB each, plus installs) | Listed in the features view; Clean up once merged. |
| A feature and its branch drift apart (deleted, renamed outside CPR) | Keyed by the branch name; the feature says its branch is gone; no chip on a branch that is not an open feature's. |
| A folder beside the checkout surprises, or cannot be written | The dialog shows it; configurable; git's error shown. |
| Losing work | Nothing forced: git refuses to remove a worktree with changes; a branch is deleted only merged (`-d`). |
| An agent merges from its worktree into a checked-out default branch | AGENTS.md says not to; git refuses the `switch`; Claude Code refuses git in the main checkout. |
| Claude Code's background sessions are new; their text may change | Only `claude agents --json` is read (documented for scripts); the fake follows its documented fields; the version is checked in the first step. |
| A committed `cpr/config.json` names a command | Shown in full in the dialog before Start; the same file already loads plugins (code). |
| A person starts another session in a feature's worktree | The newest working session is shown; "2 sessions" in the title. |
| Symlinked paths (macOS `/private/tmp`, WSL `/mnt`) | Compared as real paths. |
| Reviews kept per worktree today | One `cpr/` per repository, the main worktree's. |

**Order**: first a spike on a repository the person trusts once (`claude` run there by hand):
`--bg` with `--add-dir` and `--session-id`; the states from Start to `done` with plan first;
`--bg --resume` on a finished session and on one still running; the time `--bg` takes to return.
Then V18a (core and CLI, server, the dialog), V18b (the features view, chips, the links both
ways, polling), V18c (hooks, the thread, reply, send a verdict, the panel, AGENTS.md, clean up;
its own order above), on one branch. Codex and other commands with `.worktreeinclude` (was
V18d) and answers in CPR (was V18e) are V20.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V18a ✅ | Start a feature | `cpr/features/`, one `cpr/` per repository; branch and worktree outside the checkout; the agent started (`claude --bg`), failures kept with their reason; `/api/features` with states; the dialog (header, `n`, "Start a feature here"); the page lists the new branch. |
| V18b ✅ | The features view | `/features`: open features grouped by what they need (needs you, working, done), each with its state, commits, uncommitted files, review mark and merge check; Review, Talk (attach), Open in VS Code, Start/Stop, Copy the prompt; the tab bar with the count; agent chips on badges and in the branches panel; feature ↔ branch links (`/?branch=`, `/features?branch=`, "Open its feature", the review header); polling while an agent works, the history listed anew when a feature's tip moves; Open in VS Code in the feature's worktree; V11's menu names a branch's worktree. |
| V18c ✅ | Talk and finish | CPR's hooks at every first start (`--settings <cpr>/claude-settings.json`, `agent-hook.js`), recording into `cpr/threads/<branch>.jsonl` and deciding nothing; the features view as list and panel (`?branch=` the selection): the head and V18b's actions, the thread (reports, messages, what the agent waits on), one reply box (stop if live, resume with no flag), "Send the verdict" and the Review tab's "Send to the agent"; "plan ready" from a `blocked` session after its report; Clean up; AGENTS.md: features, merging from a worktree. |

Codex and other agents (V18d) and answers in CPR (V18e) moved to V20: V20a and V20b.

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 95 | Who starts the agent | **CPR, on the person's click, in the background: Claude Code (`claude --bg`) by default, Codex (`codex exec`, detached) or another command when picked or configured; without one, "Copy for the agent"** | Asked ("CPR starts it"). `--bg` sessions outlive `cpr view`, can be attached to for questions and permission prompts, and report their state; a `claude -p` child cannot ask anything and is not listed. |
| 96 | Where the agent works | **A new worktree per feature, beside the checkout (`../<repo>.worktrees/<branch>`, configurable); never inside it, never in the cache** | Asked ("own worktree"). Inside: 0 of 6 clones ignore `.claude/worktrees/`, zod type-checks `**/*.ts`, a root Prettier check failed on 58 files. The cache is for throwaway worktrees and is cleared. |
| 97 | Branch and base | **CPR creates both (`git worktree add -b`): the default branch's tip or a picked row; the name proposed from the brief, `feature/` prefix, editable** | Claude Code's own worktrees branch from the remote default branch and name themselves `worktree-<name>`; the person picks where the feature starts. |
| 98 | What the agent is told | **The brief in the prompt, the plan-first instruction when ticked, and where its brief and reviews are (`--add-dir <repo>/cpr`); the record in `cpr/features/<branch>.json`** | The agent reads its brief without looking; reviews reach it in its worktree; the record outlives the session. |
| 99 | The agent's state | **From `claude agents --json --all`, by the worktree's folder; asked on load and focus, every 5 s while one works or waits** | The documented interface for scripts (153–158 ms); the folder is the only link to the branch; no polling when nothing runs. |
| 100 | Trust and permissions | **CPR never grants trust or bypasses permissions; trust failures shown with the fix; the agent restartable; the person picks the permission mode** | Measured: 3 of 3 folders refused; trust is the person's decision, and so is what an agent may do unasked. |
| 101 | Approve on a feature in a worktree | **Merged from the worktree that has the default branch (the main checkout), not the feature's; AGENTS.md says so; CPR still merges nothing** | `git switch main` fails in a linked worktree while the main checkout has it, and Claude Code refuses git in the main checkout; decision 82 stands. |
| 102 | Plan first | **Per feature, on by default: the agent plans and stops; "plan ready" is a finished session with no commits** | Asked ("your choice per feature"). |
| 103 | One `cpr/` per repository | **The main worktree's, for reviews and features** | With features in worktrees, a `cpr view` opened in one would otherwise keep its reviews apart. |
| 104 | Cleaning up | **Offered once merged; nothing forced; branches deleted with `-d` only; the record kept** | Worktrees hold uncommitted work; git's refusals protect it. |
| 105 | Where features are shown (refines V18b's plan) | **Their own view, `/features`, grouped by what each needs from the person; on the commits page only the agent chip on the branch's badge; no section in the branches panel** | Asked ("should we create a different view for features?"). A feature carries its brief, state, commits, uncommitted files, verdict, merge check and five or six actions; the panel holds about 35 characters, and its 1,591 remote branches on Bitwarden would bury them. |
| 106 | Feature and branch | **One key, the branch name; each leads to the other: the branch name on a feature goes to its tip (`/?branch=`), the chip on a branch and the tip's menu to its feature (`/features?branch=`), the review page names its feature** | Asked ("We still need a link between the feature and the branch"). The record is already keyed by the branch; addresses make both views bookmarkable. |
| 107 | How a reply reaches the agent (V18c) | **Stop the session if its process lives, then `claude --bg --resume <session> "<text>"` with no other flag** | Measured (V18c spike): a resume on a live session, or with any flag, starts a copy without the hooks; stop and resume continued the same session with its saved options in 1.4 s. |
| 108 | What CPR's hooks do (V18c) | **Registered for every event at each first start; they record into the thread and decide nothing** | A session's options are fixed at its first start, so the hooks must be there from the start; recording only keeps V18c to one box ("start simple, with only one chatbox"), and V20b answers through them for every feature started since. |
| 109 | Where a feature's conversation is shown (V18c) | **Beside the list in the features view: list and panel, `?branch=` the selection** | Asked, among beside the list, under the row, and a page of its own: the person answers one feature and goes to the next that needs them without leaving the page. |
| 110 | Where the thread is kept (V18c) | **`cpr/threads/<branch>.jsonl`, written by the hook; the person's messages as the agent received them (`UserPromptSubmit`)** | Beside the record and reviews, git-ignored; not the cache, which is cleared; Claude Code's transcripts are not a documented interface. |
| 118 | Agents' reports in the thread (fix, 2026-10-18) | **Drawn as Markdown: `marked`'s lexer (GitHub's flavour, line breaks kept) reads a report, CPR turns its tokens into React elements; HTML shows as text, links only to `http(s):` and `mailto:`; `marked` in its own chunk, loaded when a thread is first shown; the person's messages and CPR's prompt as written** | Asked ("the output of agents is not rendered correctly, i see **Text**"). One of this repository's agents wrote 34 bold spans, 74 code spans, 46 bullets, 14 numbered items and 8 headings in two reports. A parser of nested lists and tables by hand is where bugs hide; `marked`'s renderer makes HTML, which would need a sanitizer; its tokens drawn as elements need neither. 46 KB (13.7 KB gzip), not in the main bundle. |

**Not in V18 (later)**: cloud sessions (`claude --cloud`, whose branch comes back on `origin`);
several agents on one feature; the agent's actions live in CPR (a `-p` stream, or the
transcript's tool calls in the panel); briefs from an issue tracker; editing a brief after the
start; reviewing a plan in CPR (Markdown has no symbols to review); a message kept for the end of the agent's turn instead of "Stop and send" (a `Stop` hook
could hand it over; not measured); the session's inbox socket (its messages reach the agent as
another session's, not the person's).

#### As built — V18a

- **No real-agent spike** (asked: "I trust it works..skip the test"). V18a is built on Claude
  Code's documented behaviour (`--bg`, `agents --json --all`, `auth status`); tests and e2e run a
  fake `claude` through `CPR_CLAUDE` (also the way to point CPR at another install), so no spec
  can start a real agent. `--session-id` is not passed: the session is the one whose folder is
  the feature's worktree, which needs nothing more of `--bg`.
- **Awaiting `claude --bg`**: CPR waits for it to exit, not for its output to close (a background
  service it starts may keep that open: V12's lesson with VS Code), 60 s at most.
- **What the page shows of the agent**: after Start, a line ("Started feature/x: Claude Code is
  working in …") and the cursor on the new branch. `/api/features` already answers each agent's
  state and `POST /api/features/start` starts one again; the chips, the Features section and its
  actions are V18b's.
- **The base from the header** is not sent: the server takes the default branch's newest tip at
  the start (the dialog shows the one it had when it opened; they differ only if the branch moved
  meanwhile). "Start a feature here" sends the row's commit.
- **Names are checked twice**: in the dialog as typed, by git's rules for branch names and the
  names in use (local and remote branches), and by the server with `git check-ref-format
  --branch`. The proposal: the brief's first line, five words, accents and apostrophes dropped,
  at most 40 characters after `feature/`, `-2` when taken.
- **The row menu** takes plain entries beside submenus ("Start a feature here").
- **The header**: the first screenshots showed the new button and a longer help line pushing the
  help to three lines and both buttons to a second row at 1440 px. "Start a feature" now sits with
  Compare mode at the right, its key as a badge (`n`), as Compare mode shows `x`; the help line is
  unchanged.
- **One `cpr/` per repository** (decision 103) is in V18a: `reviewPlace` uses the main worktree;
  `prepareCprFolder` (the folder's `.gitignore` and `AGENTS.md`) is shared by reviews and features.
- **`listRefs`** names the worktree a branch is checked out in when it is not this one; V11's menu
  uses it in V18b.
- **Config**: `features.branchPrefix`, `features.worktrees` (relative to the main checkout,
  `{repo}` its folder's name), `agent.permissionMode`, `agent.model` in `cpr/config.json`; unknown
  values are ignored.

**Results (V18a).** Tests first: core 5 of 5 failed (no functions), the CLI module and the
viewer's helpers did not exist, the server's 4 new tests failed (no routes). Now 653 unit tests
(34 new: core 5, CLI 21, server 4, viewer 4) and 87 e2e (5 new: a feature from the header — its
branch at `main`'s tip in `<repo>.worktrees/…`, the checkout clean, the fake's `--bg`, `--name`,
`--add-dir` and the brief with plan first, the record —; `n`, a name in use refused, Escape,
Auto passed as `--permission-mode auto`; "Start a feature here" at a row's commit; a trust
refusal kept with its words and the prompt copied; no agent at all). Three existing e2e
expectations gained the new menu entry.

On the six regression clones, through `cpr view`'s API with the fake agent, three features each:

| Repo | `POST /api/features` | `GET /api/features` (3 features) | `…/options` | Checkout's `git status` |
|---|---|---|---|---|
| ky | 104–121 ms | 40–46 ms | 72 ms | unchanged |
| zod | 161–193 ms | 37–43 ms | 83 ms | unchanged |
| vite | 305–334 ms | 40–51 ms | 92 ms | unchanged |
| Qwik | 443–506 ms | 42–47 ms | 88 ms | unchanged |
| CPython | 571–588 ms | 42–48 ms | 180 ms | unchanged |
| Bitwarden | 850–898 ms | 57–64 ms | 149 ms | unchanged |

A start is mostly `git worktree add` (Bitwarden 644–854 ms of it, measured in the spike). Every
branch was at its base (18 of 18); everything made was removed afterwards. The header against
`main`'s build on a clone of this repository: with `main` checked out, the same at 1440, 1100 and
900 px (42, 69, 70 px high; 25, 24, 24 rows in view); with a long branch name checked out, the
same at 1440 and 900 px, 10 px higher at 1100 (one row fewer). Screenshots light and dark at 1440
and 900 px: the dialog, a name in use, the line after Start; no page errors. No analysis code
changed (goldens unchanged), so no regression-check run.

Not verified: a real Claude Code started by CPR (skipped, as asked) — `--bg` with `--add-dir`,
its sessions' states end to end, how long `--bg` takes when it starts its background service;
Windows and macOS (worktree paths, `claude.exe` on `PATH`); Firefox and Safari.

#### As built — V18b

- **The groups**, as `featureGroups` decides them: **Done** only once merged; **Working** only while
  the agent works; everything else **Needs you**, each with its next step in words — "Waiting:
  permission prompt", "Plan ready: read it and answer", "Ready for review", "Changes requested:
  send them to the agent", "2 commits since your review: review again", "Approved: ask your agent
  to merge it", "Not started: Workspace not trusted.", "Its branch is gone". The tab counts Needs
  you.
- **One reader for the page** (`useFeatures`): the features and the reviews, read together (a
  review changes what is next), shared by the tab bar, the page and the review header; on load,
  on focus, and every 5 s only while an agent works or waits.
- **Live listing**: a feature's tip that is not the listed one lists the history anew, the cursor
  kept on its commit at its place in the view (when that commit is in the first 200 rows; else on
  HEAD, as before).
- **The marks**: on a branch's badge, before its name, a link to the feature; in the branches
  panel beside the entry, since a link cannot sit inside the entry's button. The first screenshots
  showed two new features' badges folded into "+2" on `main`'s row — where a feature sits until
  its agent commits —, so "+N" now carries the most urgent mark among those it folds (failed,
  waiting, ready, then working), linking to the features view.
- **"Open its feature"** is in the menu of the row where a feature's branch is (its tip).
- **Actions**: Stop only while the agent works or waits (`claude stop <id>`); Start the agent after
  a failed start, a stop, a failure or once it is no longer listed; Talk copies `claude attach
  <id>`; the merge check is asked per row, in the background, once per pair of tips (V17's
  `git merge-tree`).
- **Files not committed** count new files one by one and leave ignored ones out (`git status
  --porcelain --untracked-files=all`).
- **The tab bar** made the bar 4 px taller at first (37 to 41 px); without the tabs' vertical
  padding it measures as `main`'s.
- **Open in VS Code** from a review of a branch checked out in a feature's worktree opens that
  worktree and maps the line in its working copy (the review page asks the refs where the branch
  is checked out); V11's checkout menu says "checked out in <folder>".
- **Trap**: the server keeps Claude Code's sessions for 2 s, so an e2e test that changes the fake's
  state waits for the page's next read, not a reload. One checkout e2e check, "the taller submenu
  moves up", now allows the submenu level with its entry: the row menu has more entries since V18.

**Results (V18b).** Tests first: core 1, CLI 3, server 2, editor 2, viewer 6 failed before the code
(groups, next steps and marks 4, the folded badge 1, the checkout menu 1). Now 667 unit tests (14
new since V18a) and 92 e2e (5 new, with the fake agent: the groups as its state changes and the
tab's count; the links both ways — the mark, the branch name, "Open its feature", the review
header; an agent's commit arriving with the cursor kept; stop, start again, copy the prompt, Talk,
Open in VS Code; a branch checked out elsewhere, and one deleted in a terminal: "Its branch is
gone", no mark).

On a clone of this repository with three features (one waiting for a permission, one finished
with a commit and a file not committed, one working): the features view and the review header in
light and dark at 1440 and 900 px, the marks on the commits page and in the branches panel; no
page errors. Against `main`'s build, warm servers, 4 rounds each: first rows on Bitwarden
982–998 ms (`main` 984–1,042 ms), on ky 975–991 ms (`main` 973–1,004 ms); the bar 37 px on both.
No analysis code changed (goldens unchanged).

Not verified: a real Claude Code (as for V18a) — `claude stop` and `claude attach` with a real
session; VS Code opening a worktree for real (the tests use a fake `code`); Windows and macOS;
Firefox and Safari.

#### As built — V18c

- **The record is saved before the agent starts**: the session's first hooks (`SessionStart`,
  CPR's prompt) fire while `claude --bg` is still starting, and the hook finds a feature by its
  record; saved after the start, as V18a did, those entries were dropped. The e2e fake, which
  runs the hooks of its `--settings` file as Claude Code does, found it.
- **`hooks: true`** in the record's `agent` tells a feature whose thread is recorded from one
  started before V18c ("CPR keeps an agent's messages from V18c on: Talk shows this one's").
- **The settings file** is written when a feature is started or a message sent, and on a list of
  features that has a recorded one; `cpr view` builds its services lazily, so not at its own
  start. A repository with no feature gets no file. The hook's command quotes each path for the
  shell Claude Code runs it in (single quotes; double on Windows).
- **The thread** keeps `PreToolUse` only for questions; a question seen by both hooks is one
  entry, made so by the reader (`readThread`), not the hook. Entries are read whole (the last
  200).
- **Reply**: one at a time ("a message is being sent", 409). Sending to a working agent, or one
  waiting on a prompt, is refused (409, "sending stops its turn") unless asked with `stop`; the
  panel asks first ("Stop and send", then "Stop it and send"), also when the page's state was
  older than the server's. A live but idle session is stopped without asking: nothing is lost.
- **Clean up** refuses before touching anything while files in the worktree are not committed
  (git would refuse its removal, but only after `claude rm` had removed the sessions); then
  `claude rm` for each session in the worktree (a live one stopped first), `git worktree
  remove`, `git branch -d` when merged. `removeWorktree` and `deleteMergedBranch` (core) were
  planned in V18a and built now.
- **The rows**: the first screenshots at 1440 px showed rows with no brief (the branch name took
  the 360 px line); the brief leads the row now, the branch on a line below.
- **The thread opens at its newest entry**: with a real agent the panel showed the plan and hid
  the fix below the fold; it scrolls to the end when it shows and when an entry arrives, not on a
  read with nothing new.
- **"Send to the agent"** in the Review tab is a link to `/features?branch=<b>&send=verdict`;
  the panel fills its box once the thread (with the verdict) is read.

**Results (V18c).** Tests first: core 2, thread 8, features 10, server 1, reviews 1, viewer 4
and e2e 8 (6 new; 2 V18b specs whose actions moved to the panel) failed for the right reasons.
Now 692 unit tests (25 new since V18b) and 98 e2e (6 new), all passing. The hook, built: 22–23 ms
per event, exit 0 on any input. With a real Claude Code (2.1.296, Haiku, the person's Pro
subscription, its own default permission mode, `auto`) in a throwaway repository, driven
through `cpr view`'s API: a start in 1.0 s; the plan in 13 s, read as "plan ready" (Claude Code:
`blocked`, the thread: a report after the prompt); "OK, go ahead." continued the same session
(no copy) in 1.6 s, which committed and read "ready" 13 s later; a "request changes" verdict's
text, sent the same way (1.6 s), gave a fix commit 9 s later; after a merge into `main`, Clean up
in 1.4 s (no session left, worktree and branch removed, the checkout's status clean). The thread
held every step: CPR's prompt, the plan, "Continued", the messages, the reports. Screenshots
light and dark at 1440 and 900 px with three features (a plan answered and a command waiting, a
question with its options, one working), "Stop and send" asked, and the real agent's thread; no
page errors. No analysis code changed (goldens unchanged); the commits page is unchanged.

Not verified: permissions and questions from a real agent in the panel (the real run was in
`auto` and asked nothing; the spike recorded both, and the e2e fake replays those inputs); a
session that wakes from agent view or `claude attach` rather than from CPR; the thread while
`cpr view` is closed (the hook writes files and needs no server, by design); Clean up of an
unmerged feature with a real agent (unit and e2e only); Windows and macOS (the hook's quoting);
Firefox and Safari.

### V20 — Other agents, and answers in CPR

**Status:** planned (2026-10-15). Moved out of V18 (asked: "Rename V18d and V18e into V20"):
V20a was V18d, V20b was V18e. V20a, Codex: merged into main (2026-10-19, from branch
`feature/codex-agent-integration`, a workspace started in CPR); as built and results under "As built
(V20a)" below. V20b dropped (2026-10-20, decision 163). V20c not started. Each gets its own plan (the problem measured, design, verification) when it starts;
what V18 already designed and measured for them:

- **V20a, Codex**: V18's "Starting the agent" (Codex 0.162: `codex exec --json` started
  detached, its states from its JSONL events, replies by `codex exec resume`; the agent picked
  in the dialog); V18's verification step 3 for Codex. Planned in full below, measured on Codex
  0.163; the spike changed the design (commits, resume's options).
- **V20c, other agents** (was in V20a; asked for Codex alone: "Integrate codex agent into CPR"):
  a configured `agent.command` for any other agent, and `.worktreeinclude` under "A feature".
- **V20b, answers in CPR**: dropped (asked: "Delete v20b"; decision 163). V21's terminal shows
  the agent's own prompts in the panel and answers them, and V27b does the same for Codex. The
  hooks V18c registered stay, recording only (decision 108).

#### V20a — Codex

**Problem** (asked: "Integrate codex agent into CPR. It is already planned"; done when a full
test with Codex "creating a workspace with it, and prompting something to him" runs). A
workspace's agent is Claude Code or nothing: `FeatureOptions.agent` is Claude Code's, the record
reads only `kind: "claude"`, and with Claude Code missing the dialog says "No agent found" even
where Codex is installed. Measured with Codex 0.163 (installed here, logged in with ChatGPT,
`gpt-6-luna` at medium effort from its own `config.toml`) in a throwaway repository and a
worktree beside it, made as V18a makes them (journal, "V20a spike"):

| What V18's plan assumed | Measured |
|---|---|
| `codex exec --json -C <worktree> -s workspace-write "<prompt>"` builds and commits | It edits, but **cannot commit**: a linked worktree's git folder is `<checkout>/.git/worktrees/<name>`, outside the sandbox's writable roots ("Git tried to create an index lock under the parent repo's `.git/worktrees/`"), 3 of 3 runs. `--add-dir <checkout>/.git` does not help: Codex keeps any `.git` read-only. Writable roots for the worktree's git folder, `objects`, and the branch's ref and reflog folders (`refs/heads/feature`, `logs/refs/heads/feature`): committed, inside the sandbox, 2 of 2 (10.5–12.0 s) |
| `--approve-for-me` optional | Cannot be combined with `-s` (it implies `workspace-write`). It escalated the refused commit to Codex's automatic reviewer, which approved it: the commit ran **outside** the sandbox (12.6 s) |
| `codex exec resume <thread> "<text>"` continues the same session | It does, with its context (3.2–12.8 s), but with **none of the start's options**: neither `--add-dir` nor `--approve-for-me` survived (a commit refused again, 2 of 2); `exec resume` takes no `-s`, `--add-dir` or `--approve-for-me`. `-c sandbox_mode="workspace-write" -c sandbox_workspace_write.writable_roots=[…]` on the resume: committed (6.1 s) |
| Its states from its JSONL events | `thread.started` (the thread ID) 150 ms after the start, `turn.started`, `item.started`/`item.completed` (`agent_message`, `command_execution`, `file_change`), `turn.completed` (usage) or `turn.failed` (`error.message`); transient `error` events ("Reconnecting... 2/5"). **No timestamps** in any event. Exit 0 after a completed turn, 1 after a failed one |
| (not logged in) | `codex login status` (40 ms) prints "Logged in using ChatGPT", or "Not logged in" with exit 1; `exec` then retries for about 25 s and fails its turn with a 401 |
| (stop) | Spawned detached from Node (its own process group: `codex.js` and the native binary), SIGTERM to the group ended both in 0.1 s, the sandboxed command it ran included; the stopped thread resumed with its context (3.2 s) |
| (its instructions) | Codex reads the repository's `AGENTS.md` in the worktree (followed, 1 of 1); reading `cpr/` in the main checkout from its sandbox works (1 of 1); no trust step for `exec` in a folder Codex never saw |
| (cleaning up) | `codex archive <thread>`: 70 ms; a second archive of the same thread fails (exit 1, "failed to archive session") |

Causes:
- CPR knows one agent: its options, record, states and messages are Claude Code's.
- Codex's sandbox protects git's folders, and a worktree's live in the main checkout's `.git`.
- `exec resume` starts from Codex's configuration, not from the thread's first options.

**Goal**: the start dialog offers the agents installed — Claude Code and Codex — the default
first; a workspace started with Codex runs `codex exec` in its worktree in the background, can
commit on its branch from inside its sandbox, shows its state (working, plan ready, ready for
review, stopped, failed with Codex's words), its thread (CPR's prompt, Codex's reports, the
person's messages) and takes replies in the panel's box; Stop, Start the agent, Talk (copies
`codex resume`), Clean up work for it. Unchanged: Claude Code workspaces (launch, hooks,
terminal, states), workspaces started before, a repository with no workspace (no call to either
agent), the analysis.

##### Starting Codex (CLI)

- **Found** as Claude Code is: `CPR_CODEX` (a path or a command on PATH), else `codex` on PATH
  (`findCodex`); a fake in tests and e2e. `packages/cli/src/codex.ts` holds what CPR asks of it
  (`Codex`: `start`, `resume`, `stop`, `alive`, `archive`, `account`), as `ClaudeCode` does.
- **The command**: `codex exec --json -C <worktree> -s workspace-write -c
  sandbox_workspace_write.writable_roots=[<git folders>] "<prompt>"`; a reply is `codex exec
  resume --json -c sandbox_mode="workspace-write" -c sandbox_workspace_write.writable_roots=[…]
  <thread> "<text>"` in the worktree (decision 130). Never `--dangerously-bypass-…`, never
  `--worktree` (CPR made it), never `--add-dir` (`cpr/` is the person's), no `--approve-for-me`.
  The model and effort are Codex's own configuration.
- **The git folders**, from `git rev-parse --path-format=absolute --git-dir --git-common-dir` in
  the worktree: the worktree's git folder; the common `objects`; the folders holding the branch's
  ref and reflog (`refs/heads/<branch's folder>`, `logs/refs/heads/<branch's folder>`), those that
  exist. Not `refs/` whole: other branches' refs stay read-only.
- **Detached, through CPR's runner** (decision 129): `node <dist/codex-run.js> <thread file>
  <startup|resume> <codex> <args…>`, spawned detached in the worktree (its own process group;
  `unref`), its process ID in the record (`agent.pid`). The runner, Node's modules only as
  `agent-hook.js`, starts Codex and turns its events into the workspace's thread
  (`cpr/threads/<branch>.jsonl`, V18c's entries), stamped as they arrive: `thread.started` →
  `start` (the thread ID as `session`) and `prompt` (what it was given: CPR's prompt, or the
  person's message); a `turn.completed` → `report` (the turn's last `agent_message`); its end →
  `end` with `reason`: `completed`, `stopped` (SIGTERM, SIGINT, SIGHUP), or the failure in
  Codex's words (`turn.failed`'s message, else the last `error` event, else the last lines of its
  error output, else its exit code). It outlives `cpr view` like Claude Code's background
  sessions. Not a log in CPR's cache (V18's plan): events have no times, the thread is what the
  panel and V23's order read, and Codex keeps its own session files.
- **Before starting**: `codex login status`; exit 1 → the workspace is kept, "not started:
  Codex is not logged in: run `codex login`, then start the agent" (instead of a 25 s run that
  fails with a 401).
- **The prompt**: `featurePrompt` unchanged; it names the record, the reviews and
  `cpr/AGENTS.md` by absolute path, which Codex can read.

##### State, replies, stop and clean up (CLI)

- **State** (`codexState`, decision 131): from the record's `started` (when the last run
  started), the thread's entries since then and whether the runner's process lives
  (`process.kill(pid, 0)`): an `end` since then — `completed` → finished (plan ready, ready or
  done by commits, V18b's rule), `stopped` → stopped, else failed with its reason as `error`; no
  `end` and the process lives → working; no `end` and it is gone → finished if a `report` came,
  else failed ("Codex ended without a word"). No "needs you": `exec` never stops to ask. The
  state's `id` is the thread ID (Talk).
- **Reply** (`/api/features/reply`, unchanged route): while a run lives, refused unless `stop`
  (V18c's "Stop and send"); then the runner with `exec resume` on the newest `start`'s thread ID.
  No thread ID yet → 409 "start the agent again".
- **Stop**: SIGTERM to the runner's process group, waiting at most 2 s for it to go; if the
  runner left no `end`, CPR writes `end: stopped`.
- **Start the agent** again: a new `codex exec` with the prompt (a new thread), as Claude Code
  starts a new session.
- **Clean up**: a live run stopped; each thread the workspace ran archived (`codex archive`,
  failures ignored: an archived thread fails the same way, and nothing is lost); then V18c's
  worktree and branch rules.
- **The terminal** (V21) is Claude Code's: for a Codex workspace `/api/features/terminal`
  answers 409, and the page offers Talk instead.

##### Which agent (core, CLI, viewer)

- `AgentKind` gains `'codex'`. `FeatureOptions.agent` becomes `agents`: those installed, the
  default first (decision 132), each `{ kind, command, account?, apiKey?, permissionMode? }`
  (`permissionMode` and `apiKey` Claude Code's). `FeatureRequest` gains `agent?` (absent: the
  default); a permission mode with Codex is refused (400). The default: `agent.kind` in
  `cpr/config.json`, else Claude Code, else Codex.
- Codex's account from `codex login status`: "your ChatGPT account", "an API key", "not logged
  in".
- **The dialog**: with two agents, "Agent: Claude Code ▾ / Codex" in the agent line; Claude Code
  keeps its permission select; Codex shows "sandbox: its worktree, commits on its branch". With
  none: "No agent found (Claude Code or Codex …)".
- **The panel**: the line after Start names the agent ("Codex is working in …"); Talk copies
  `codex resume <thread> -C <worktree>` for Codex (decision 133); "Its agent failed: <reason>"
  when there is one.
- **The record**: `agent: { kind: "codex", started, pid }`; old records unchanged.

##### Verification (V20a)

1. **Unit** (red first): the runner on scripted Codex event streams (a fake `codex` printing
   them) — start then prompt with the thread ID, the report of a turn's last message, `end`
   completed, a failed turn's message, stopped on SIGTERM, a broken line ignored, Codex not
   found; `codexState` for each case (working, plan ready / ready / done, stopped, failed with
   reason, gone without a word, a new run before its first event); the commands (`exec` and
   `exec resume`, their flags, the TOML list of folders); the git folders of a real worktree;
   `codex login status` parsed; options with both, either or no agent and `agent.kind`; a start
   with Codex (record, runner spawned, "not logged in" kept as not started); reply (refused
   while it runs unless `stop`, then stop and resume); stop; clean up (archive, worktree);
   the terminal refused for Codex; Claude Code's tests unchanged.
2. **E2E** (red first), a fake `codex` as `CPR_CODEX`, run by the real runner: Start a workspace
   with Codex picked — its state working, then plan ready with its report in the thread; a reply
   sent — "You:" and a new report; Talk copies `codex resume …`; Stop while it works — stopped;
   no Codex installed — the dialog offers Claude Code only. Every existing spec passes.
3. **A real Codex** (the brief's "done when"): in a throwaway repository through `cpr view` in
   Chromium — start a workspace with Codex, plan first; the plan in the thread, "plan ready"; a
   reply ("go ahead") — it builds and commits on its branch, "ready for review"; Stop and Start;
   Clean up. Times for each step; everything made removed.
4. **Viewer**: screenshots of the dialog with two agents and of a Codex workspace's panel, light
   and dark, 1440 and 900 px; no page errors.
5. **Nothing else changes**: no analysis code (goldens), Claude Code's unit and e2e tests as
   they are; a repository with no workspace calls neither agent.

**Risks (V20a)**

| Risk | Mitigation |
|---|---|
| The git folders made writable let Codex change git's data beyond its branch | Only the worktree's git folder, `objects` (append-only by git's design) and the branch's ref and reflog folders; other refs, `config` and hooks stay read-only; said in the README |
| CPR's `writable_roots` replace the person's own `sandbox_workspace_write.writable_roots` for these runs | Said in the README; a configured list for CPR's runs is later if asked |
| A reused process ID reads as "working" | Only while the thread has no `end` since the last start; a run that ended normally always wrote one |
| The runner is killed hard (SIGKILL, Windows) and writes no `end` | The state reads the process as gone: finished with a report, else failed; Stop writes `end: stopped` itself |
| Codex's event names change | Only `thread.started`, `turn.completed`, `turn.failed`, `error` and `item.completed` of type `agent_message` are read; the fake follows the 0.163 stream recorded in the spike |
| Talk's `codex resume` continues the thread outside CPR | Its turns are not in the thread; the state reads the last CPR run; said in Talk's title |
| Network is off in Codex's `workspace-write` sandbox (installs, pushes fail) | Codex's own `network_access` setting decides; the prompt already says push only if the project does |
| Windows: no process groups; npm's `codex.cmd` shim | Not verified; Stop kills the runner's tree with `taskkill /T`; said in the results |

**Order**: the spike (done: journal). Then core types and the runner with its tests, the Codex
launcher and states, the service (start, reply, stop, clean, options), the dialog and panel,
the e2e fake; then the real Codex run and screenshots.

**Proposed decisions (V20a)**:

| # | Question | Decision | Why |
|---|---|---|---|
| 129 | How CPR runs Codex | **`codex exec --json` detached through CPR's runner (`codex-run.js`, Node's modules only), which writes Codex's events into the workspace's thread as they arrive; replies by `codex exec resume`** | Codex has no background supervisor like `claude --bg`; its events carry no timestamps, and the thread (V18c) is what the panel, the states and V23's order read. The runner also knows the exit and Codex's last words. |
| 130 | Codex's sandbox | **`workspace-write`, plus the worktree's git folder, `objects` and the branch's ref and reflog folders as writable roots, passed on every run (`-c`); never full access, never `--approve-for-me`** | Measured: without them nothing can be committed in a linked worktree (3 of 3); `--add-dir .git` stays read-only; `--approve-for-me` runs the commit outside the sandbox; `exec resume` keeps none of the start's options. |
| 131 | A Codex workspace's state | **From the thread since the last start and whether the runner's process lives: an `end` decides (completed, stopped, failed with its reason); else working while it lives; no "needs you"** | `exec` never stops to ask; the runner writes the end it saw; the process check covers a run with no end yet. |
| 132 | Which agent a workspace runs | **Picked in the start dialog among those installed; the default `agent.kind` in `cpr/config.json`, else Claude Code, else Codex; kept in the record** | V18's plan; the record's `agent.kind` makes later replies, stops and clean-ups use the same agent. |
| 133 | Talking to Codex outside the panel | **Talk copies `codex resume <thread> -C <worktree>`; no terminal tab for Codex in V20a** | Its turns in a terminal would not reach the thread, which the state reads; `codex resume` gives the whole session where the person wants it. |
| 134 | Codex's sessions at Clean up | **Archived (`codex archive`), not deleted; failures ignored** | Archiving is undone with `codex unarchive`; the person's history stays theirs. |
| 163 | V20b, answers to permissions and questions in CPR | **Dropped** | Asked ("Delete v20b", 2026-10-20). The panel's terminal shows the agent's own prompts and answers them: Claude Code since V21, Codex since V27b. What V20b alone would add (answers without node-pty, from the list, an edit as a diff before allowing it) has not been asked for. The hooks registered since V18c stay, recording only |

**Not in V20a (later)**: `agent.command` and `.worktreeinclude` (V20c); a Codex terminal in the
panel (with its turns recorded, e.g. through Codex's hooks, which need the person's trust);
`--approve-for-me`; a Codex model or writable roots set in `cpr/config.json`.

##### As built (V20a)

- **Runs told apart by an ID, not by time.** The plan read a run's entries as those since the
  record's `started`. With the tests' fixed clock, CPR's own `end: stopped` and the next start
  fell in the same millisecond, and the new run read as stopped; a real machine can do the same.
  CPR now gives each run an ID (`agent.run`, a UUID) that the runner writes on every entry
  (`ThreadEntry.run`, optional; Claude Code's entries have none), and the state reads the entries
  with the record's `run`. The runner takes it as an argument: `node codex-run.js <thread>
  <startup|resume> <run> <codex> <args…>`.
- **A start or a reply waits for the run's first entry** (3 s at most, not once the runner is
  gone). With a real Codex the person's reply showed in the thread 5.3 s after Send: a Codex
  start returns once the runner is spawned, and the page saw the message at its next read, while
  Claude Code's hooks write it before `--bg` returns. After: 292–294 ms.
- **What Codex is given comes after `--`** (a reply may start with `-`; measured: `--` ends
  Codex's options). Every run passes the same `-c sandbox_workspace_write.writable_roots=[…]`,
  the start with `-s workspace-write`, a resume with `-c sandbox_mode="workspace-write"`.
- **`commitFolders`** (core, `git/worktrees.ts`) names the git folders from `git rev-parse
  --git-dir --git-common-dir` in the worktree, real paths, the ref and reflog folders only when
  they exist.
- **The account** from `codex login status` (it writes to stderr) is kept a minute, except "not
  logged in", asked again at the next start.
- **The runner runs from source too** (Node's own modules and `import type` only): its unit test
  starts it detached with Node's type stripping and stops it by its process group.
- **The dialog** says "sandbox: its worktree and branch" (the first words wrapped the line at
  1440 px), the details in its title.
- **The e2e fake Codex** waits for the spec to end its turn; one spec never did, and two runs
  outlived the suite: the fake now exits once the test's folders are removed (0 left after).

**Results (V20a).** Tests first: core 1, runner and Codex 17, service 6 (and the options test
changed), server 1, viewer 3, red before for the right reasons (missing modules and fields, the
state's run); then 2 more for the wait for the first entry, red before. One guard test (Codex is
asked nothing for a repository with no workspace, or with Claude Code's alone) passed as written.
Now 788 unit tests (761 on `main`) and 113 e2e (110 on `main`; 3 new for Codex with a fake run by
the real runner, written with the viewer change rather than before it): 113 of 113 in a first full
run; in the last, 112, a Claude Code spec ("Send the verdict…") failing once on its own `git
commit` in a worktree ("index.lock: File exists"), then 5 of 5 alone. Not this branch's: since
V18b, `/api/features` counts a worktree's files with `git status`, whose index refresh can take
the lock while an agent commits; `GIT_OPTIONAL_LOCKS=0` is git's answer for background status.
Proposed as its own fix (not made here).

A real Codex (0.163, the person's ChatGPT login, `gpt-6-luna` at medium effort) in a throwaway
repository (a greeter with `npm test`), through `cpr view` in Chromium:

| Step | Measured |
|---|---|
| Start a workspace, Codex picked in the dialog, plan first | Answered in 210 ms (818 ms with the wait for its first entry, its thread ID in the answer) |
| Its plan | In the thread, "Plan ready", 10.7 s and 9 s after Start (two workspaces) |
| A reply ("OK, go ahead: build it, run the tests, and commit it") | In the thread 294 ms after Send (5,335 ms before the wait); it built, ran `npm test` and **committed on its branch from its sandbox** (`bdaba0c`): "Ready for review · 1 commit · Merges cleanly into main" 25.3 s after Send |
| Stop during a turn (`sleep 60` asked for) | "Stopped" 211 ms after the click; no `sleep` or runner left |
| A reply to the stopped thread | Resumed it (292 ms to the thread); committed (`e15dcb3`), ready 15.7 s after Send |
| Talk | Copied `codex resume 01a1554a-… -C <worktree>` |
| Clean up, unmerged (asked first) | 882 ms: the worktree removed, the branch kept, the record `finished`, its thread in `~/.codex/archived_sessions` |
| Page errors | None |

Screenshots of the dialog (1440 px light and dark, 390 px) and of the panel (1440 and 900 px,
light and dark): the agent line on one line at 1440 px, two at 390 px. The viewer's main bundle
592,739 → 593,757 bytes. No analysis code changed (goldens unchanged), so no regression sets.
Everything made was removed, the throwaway Codex threads archived.

Not verified: Windows and macOS (process groups, `taskkill`, npm's `codex.cmd`); Codex with an
API key; a person's own `sandbox_workspace_write.writable_roots`, which CPR's runs replace;
network-dependent checks inside Codex's sandbox; a reftable repository (no ref folders to grant);
the 390 px dialog wraps "Spike" to a second line of the kinds here (CSS this branch does not
touch; V24c measured it on one line).

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V20a | Codex | Codex picked in the start dialog among the agents installed (`agent.kind` the default); `codex exec --json` detached through CPR's runner, which records the thread; commits from its sandbox (its branch's git folders writable); its states; replies by `exec resume`; Stop, Start, Talk (`codex resume`), Clean up (archive). |
| ~~V20b~~ | ~~Answers in CPR~~ | Dropped (decision 163). Was: what an agent waits on, answered in the panel through the hooks registered since V18c: a permission (an edit as a diff, a command; allow, or deny with a reason), a question (its options); the hook waits for the person up to its timeout, then Claude Code's own dialog (measured: the question comes again through `PermissionRequest`). |
| V20c | Other agents | `agent.command` for any other agent (detached, log, running/exited); `.worktreeinclude`. |

### V21 — The agent's terminal in its feature's panel

**Status:** merged into main (2026-10-18, from branch `milestone/v21-agent-terminal`): V21a and
V21b, after the state fix (`fix/agent-idle-after-interrupt`, merged first). The
spike is in the journal ("V21 spike"); as built and results under "As built (V21)" below.

**Problem** (asked: "Can we somehow integrate this chat inside my app, instead of the current
chat?"; then, of the ways compared, "is it easier to do like this?" — `claude attach` in a
terminal in the panel). Since V18c a feature's panel shows the agent's reports and one box, and
everything else happens in Claude Code's own session, which CPR only copies a command for (Talk:
`claude attach <id>`, pasted in a terminal elsewhere). Measured in the V18c and V21 spikes
(Claude Code 2.1.300, Haiku, a Pro subscription):

| What V18c has | Measured |
|---|---|
| What the agent did between reports: in the session only | The thread gets `last_assistant_message` per turn; tool calls, their output and the text before them stay in Claude Code |
| A reply stops the session, then resumes it | 1.6 s, and a turn in progress is lost ("Stop and send"); in a terminal, a message typed while the agent works is queued and answered after the turn, each turn with its `Stop` |
| A permission or a question: shown, answered by attaching | In the page, Enter on a `Write`'s dialog allowed it; the file was written and the hooks fired as without a terminal |
| Talk copies `claude attach <id>` | `attach` in a pseudo-terminal: first output in 152–174 ms; xterm.js drew it whole (123 × 45 at 1000 × 700; 77 columns at 640 px); a key to its echo 22 ms median, 37 ms max |
| (Esc in an attached session, possible on `main` through Talk) | No hook fires; `claude agents` says `status: idle`, `state: working` until the next turn ends: the features view says "Working" for an agent that waits on the person |

**Goal**: a feature's panel can show its agent's session as Claude Code draws it — the
conversation, tool calls, dialogs, Esc, queued messages, slash commands — beside the list, while
Claude Code keeps hosting the session (`--bg`, decision 95) and CPR's hooks keep recording the
thread (decision 108). Where the terminal cannot run (node-pty missing or not built), the panel
is V18c's, Talk copying as today. A repository with no feature starts nothing new; nothing in
the analysis changes.

#### The terminal (CLI, server)

- **`packages/cli/src/terminal.ts`**: open terminals, each one `<claude> attach <id>` in a
  pseudo-terminal (`node-pty`, loaded with `import()` the first time a terminal is asked for), in
  the feature's worktree, with `cpr view`'s environment and `TERM=xterm-256color`,
  `COLORTERM=truecolor`. Each keeps its output since it started (at most 1 MB, the oldest
  dropped: a page that reconnects redraws from there, measured 8 ms) and its listeners.
- **Which session**: the feature's newest session (V18b's choice, by folder). `attach` to an
  unknown ID exits 0 ("No job matching…"), so CPR attaches only to a session `claude agents`
  lists, and answers 409 with what to do otherwise ("Start the agent"). Attaching to a stopped
  session restarts it with its saved options and no turn (measured): allowed, and the panel says
  so before ("Opening the terminal continues the stopped session").
- **Routes**, under V18's rules for writes (same-origin JSON with `x-cpr`):
  - `POST /api/features/terminal` `{ branch, cols, rows }` → `{ id }`: an unguessable ID (16
    random bytes). Creating needs the write rule, so another site cannot start a process.
  - `GET /api/terminals/<id>` → server-sent events: `out` (the output so far, then live chunks),
    `exit` (the client's last line, e.g. "Session … has exited", and its code).
  - `POST /api/terminals/<id>/in` `{ data }` (at most 64 KB); `…/resize` `{ cols, rows }`;
    `…/close`.
- **Lifetime**: one terminal per open panel. It is hung up (SIGHUP: measured to leave the
  session running) on close, when its stream has been gone 10 s (a reload reconnects within
  that), and when `cpr view` exits. At most 4 at once (each attach is about 140 MB); a fifth
  closes the oldest without a listener, else 409.
- **Without node-pty**: `/api/features/options` says `terminal: false` with the reason (not
  installed, or "built for another Node" with its error); the panel keeps Talk.

#### The panel (viewer)

- The head's **Talk** becomes **Terminal** when terminals can run: the panel's lower part
  switches between "Thread" (V18c's thread and box) and "Terminal"; `?branch=<name>&terminal`
  in the address, so a reload reopens it. Without terminals, Talk copies as today.
- **xterm.js** (`@xterm/xterm`, `@xterm/addon-fit`) is loaded with `import()` when a terminal
  first opens: its own chunk (89 KB gzip), so the commits page and `/features` load what they do
  today. Fitted to the panel, resized with it (`ResizeObserver` → `…/resize`).
- **Dark in both themes**: Claude Code keeps its own theme whatever the client's background
  (measured: on white its `●` marks vanish). The terminal's colors are the dark theme's tokens.
- **Keys**: one POST at a time, what was typed meanwhile sent together (measured: 22 ms a key).
  The page's shortcuts already ignore keys from a text area (`FeaturesPage.tsx`), which is
  where xterm.js types.
- **The box while the terminal is open**: hidden. A reply through it stops the session, and a
  stop ends the attach (measured).
- **Send the verdict** with the terminal open types one line into the agent's input and does not
  press Enter (decision 82): the verdict's first line and where the review is ("Address this
  review of the branch feature/x (anton, at 1a2b3c4): changes requested. The review:
  cpr/reviews/feature/x/anton.json; how to act on it: cpr/AGENTS.md."). Not the whole text: a
  paste reaches the agent as `<pasted_content>`, and typed lines kept their backslashes
  (measured). With the terminal closed, the box as in V18c.
- **When the session ends** (stopped from the panel or elsewhere), the terminal shows the
  client's last line and "Open again"; Stop / Start stay in the head as in V18b.
- A line under the terminal: "← in an empty prompt lists all your agents" — Claude Code's agent
  view can switch to another session, start one without CPR's hooks, or delete one (measured);
  CPR cannot keep the terminal on its feature.

#### The agent's state after Esc

- In `agentState`, `status: idle` with `state: working` is a turn that ended without a report
  (interrupted): "needs you", in words "Interrupted: waiting for you". Measured: no hook fires
  on Esc, and `state` stays `working` until the next turn ends. This is on `main` today through
  Talk: fixed first on its own branch (`fix/agent-idle-after-interrupt`, test first), if agreed.

#### Install

- `node-pty` an **optional** dependency of `@cpr/cli`, its build allowed in
  `pnpm-workspace.yaml` (`onlyBuiltDependencies`). On Linux it compiles (python3, make, g++;
  1.6 s); macOS and Windows use its prebuilt binaries. A failed build fails nothing: the panel
  keeps Talk and says why.
- CI installs that never open a terminal skip it: `action/install.sh` and the GitLab template
  with `--no-optional` (to check with `--frozen-lockfile`); the repository's own CI builds it
  (Ubuntu, macOS), so its tests run with a real pseudo-terminal.
- New runtime dependencies, with their reasons: `node-pty` (Claude Code's interface needs a
  terminal; Node has no pseudo-terminal), `@xterm/xterm` and `@xterm/addon-fit` (a terminal in
  the page; the one VS Code uses). No WebSocket library: events and POSTs keep the server's
  write rule.
- README: the Terminal, what Linux needs to build it, and Talk without it.

#### Verification

1. **Tests first** (red before): `terminal.ts` with a fake pseudo-terminal — create, output
   kept and capped, input, resize, close, hang-up 10 s after the stream goes, the limit of 4,
   IDs required and unguessable; the routes (409 without a session, 403 without `x-cpr`);
   `agentState` for `idle` + `working`; the verdict's line; options without node-pty.
2. **e2e** with the fake Claude Code gaining `attach <id>` (a Node script in a real
   pseudo-terminal: draws a prompt, echoes keys, answers a line with "got: …", exits on
   `stop`): open the terminal, type, Enter, see the answer; resize; Send the verdict types one
   line without Enter; Thread hangs up (the fake records SIGHUP); a stopped session reopens;
   without node-pty Talk copies as today; every existing spec passes.
3. **A real Claude Code** (Haiku, a trusted repository, a throwaway feature through `cpr
   view`): start; open the terminal; answer a permission and a question; Esc, and the state
   says "Interrupted"; a message typed while it works; Stop from the head (the terminal shows
   the exit), Open again; the thread recorded all of it. Everything made removed (`claude rm`,
   the worktree, `claude purge`).
4. **Viewer**: screenshots light and dark at 1440 and 900 px; `/features` first paint and the
   main bundle as on `main` (xterm.js in its own chunk, not loaded until opened).
5. **Cost**: attach under 0.3 s to first output; a key under 50 ms to its echo; 140 MB per open
   terminal, none after it closes (`pgrep` finds no attach).
6. No analysis code changes: `pnpm check`, build, e2e; no regression sets.

**Risks**

| Risk | Mitigation |
|---|---|
| ← opens Claude Code's agent view: another session, one without CPR's hooks, deletions | Said under the terminal; CPR's states still come from the worktree's sessions; not blocked (← also moves the cursor) |
| node-pty does not build (no compiler, Alpine, a new Node) | Optional; Talk as before, the reason in the panel; macOS and Windows prebuilt |
| Another site drives a terminal | Created only by a write (`x-cpr`, JSON, same origin); IDs unguessable; the Host check against DNS rebinding as today |
| Two clients share one size (measured) | The newest client's size wins; documented, nothing to fix in CPR |
| Memory: 140 MB per terminal | One per panel, hung up when it closes; at most 4 |
| Claude Code changes `attach`'s screen or keys | CPR depends on `attach <id>`, its exit and the bytes; the fake pins CPR's side |
| Windows (ConPTY), macOS, Firefox, Safari not run | node-pty prebuilds; said in the results; the CI's macOS job runs the unit tests |

**Order**: the state fix first (its own branch, if agreed). Then V21a (server, fake attach,
unit tests), V21b (the panel, e2e), then the real-agent check and screenshots.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V21a ✅ | The terminal in the server | `terminal.ts` (node-pty optional, `attach` in the worktree, output kept, hang-up, limit 4); `POST /api/features/terminal`, `GET /api/terminals/<id>` (events), `…/in`, `…/resize`, `…/close`; `terminal` in the options; the fake's `attach`; `pnpm-workspace.yaml`, the Action and GitLab installs. |
| V21b ✅ | The terminal in the panel | Terminal in the head (Talk without it); Thread · Terminal, `&terminal` in the address; xterm.js in its own chunk, dark, fitted; the box hidden, Send the verdict's one line; exit and Open again; the line about ←; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 111 | How CPR shows an agent's session | **Claude Code's own interface: `claude attach <id>` in a pseudo-terminal (node-pty), drawn by xterm.js in the feature's panel; Claude Code keeps hosting the session** | Asked ("is it easier to do like this?"). Spike: the whole session works with nothing drawn by CPR. The Agent SDK would host the session in `cpr view` (closing it stops the agent), its docs do not allow third-party products to offer claude.ai login without approval, and CPR would draw every message, tool and dialog itself. |
| 112 | How bytes travel | **Output as server-sent events; keys, resizes and close as JSON POSTs with `x-cpr`; a terminal created only by a POST** | Keeps the server's write rule (a WebSocket is not covered by it) and adds no dependency; measured 22 ms a key. |
| 113 | A terminal's lifetime | **One per open panel; hung up on close, 10 s after its stream goes, and when `cpr view` exits; at most 4** | 140 MB per attach; hanging up leaves the session running (measured). |
| 114 | The box and the verdict while the terminal is open | **The box hidden; Send the verdict types one line (the verdict's first line and where the review is), without Enter** | A stop ends the attach; a paste reaches the agent as `<pasted_content>`; typed lines kept their backslashes; nothing is sent without the person (decision 82). |
| 115 | The terminal's colors | **Dark in both themes** | Claude Code keeps its own theme; on white its marks vanished (measured). |
| 116 | Installing node-pty | **An optional dependency whose build is allowed (`allowBuilds`); where it cannot build, pnpm drops it and the panel keeps Talk; the Action and GitLab installs unchanged** | No Linux prebuilds (a compiler is needed). As built: `--no-optional` would also drop the build's own native binaries, and a failed build fails no install (measured). |
| 117 | `status: idle` with `state: working` | **A turn that ended without a report: "Interrupted: waiting for you"** | Esc fires no hook and leaves `state` at `working` until the next turn ends (measured). |

**Not in V21 (later)**: CPR's own chat over the Agent SDK (decision 111); answering
permissions and questions with CPR's controls (V20b: dropped, decision 163; the terminal answers
them); a terminal for Codex (V20a: `codex resume` in the same terminal, once
Codex is started by CPR); keeping the terminal on its feature's session (←); a shell in the
worktree; the terminal on the commits page.

#### As built (V21)

- **The state fix first**, on `fix/agent-idle-after-interrupt` (decision 117), merged into this
  branch, which builds on it; it goes into `main` first.
- **Where the page learns that terminals can run**: `/api/features` carries `terminal`
  (`{ available: true }`, or `false` with the reason) once there are features, not
  `/api/features/options`: the page reads the list anyway, the options only in the start dialog.
  A repository with no feature does not load node-pty.
- **Install** (decision 116 as built): pnpm 12 records the approval as
  `allowBuilds: { node-pty: true }` in `pnpm-workspace.yaml` (`onlyBuiltDependencies` is pnpm
  10's). The Action and the GitLab template are unchanged: `--no-optional` would also drop the
  lockfile's 80 other optional packages, among them the build's own native binaries (rolldown,
  lightningcss). Measured instead, in a clean worktree with `make`, `g++` and `c++` failing and
  pnpm's build cache off: `pnpm install --frozen-lockfile` exits 0 and drops node-pty; CPR then
  says "node-pty is not installed" and the panel keeps Talk.
- **`CPR_TERMINAL=off`** turns terminals off: the e2e case without them, and anyone who prefers
  Talk.
- **Tabs**: "Thread · Terminal" above the panel's lower part, when terminals can run and the agent
  has a listed session; Talk is not shown then. Then, after a first look (asked: "Do we need it
  anymore?" — of the thread), the panel opens on the Terminal and the Thread is the feature's
  history, read only: one way to answer the agent, not two (the box's reply stops the session).
  `&thread` opens on the thread; "Send to the agent" from the Review tab types the verdict's line
  into the terminal. The thread itself stays: the states (decision 117), Send the verdict's offer
  read it, and it outlives the session. Without terminals the panel is V18c's.
- **A reload opens a new client** rather than reconnecting to the old one by ID; the old one is
  hung up 10 s later. The kept output (1 MB) serves an event stream that drops and reconnects by
  itself: the page clears the screen and draws it again.
- **A stopped session's question** is asked when a terminal is about to open, not while one is
  open: a stop from the head leaves the terminal's last lines ("Session … has exited.") in view
  with "Open again".
- **The event stream's head**: the server listens first, keeping what arrives, then sends the
  head and what it kept. The first version sent the head before knowing whether the terminal
  existed, and an unknown ID then failed with "headers already sent" instead of 404.
- **A reopened session reads like an interrupted one** (`working`, `idle`, measured): with the
  thread's report after its last prompt, decision 117's rule reads it as finished ("plan ready"),
  else as interrupted — waiting for the person either way.

**Results.** Tests: 717 unit tests (24 new: terminal 13, one of them in a real pseudo-terminal;
features 3, server 4, viewer 4) and 101 e2e (3 new: keys and the thread, hang-up, reopen, resize,
stop and Open again; the verdict typed without Enter; no terminals). Red before, except
`terminal.ts`, written before its tests (they failed only for the missing module). The V18b spec
for Talk runs without terminals.

A real Claude Code (2.1.302, Haiku 5.5, the person's Pro subscription, the account's default
permission mode `auto`): five throwaway features in this repository through `cpr view`, driven in
Chromium.

| Check | Measured |
|---|---|
| The session in the Terminal tab | Drawn whole: header, CPR's prompt, a question with its options; first output 1.1 s after opening `&terminal` (page, xterm chunk, attach); the question answered with Enter in the page, then "plan ready" |
| What reaches the agent | Typed slowly, typed at once, and one 229-character write then Enter (what Send the verdict does): each a plain prompt in the thread (`UserPromptSubmit`), none wrapped as pasted content |
| Esc while it writes | Claude Code: `state: working`, `status: idle` for the 40 s watched; CPR: "needs you, interrupted" 301 ms after Esc; the row "Interrupted: waiting for you" |
| Stop from the head | Claude Code's last lines ("Session a27d1f2d has exited.") 755 ms after the click; Open again asks first; the session back 230 ms after "Open the terminal" |
| Leaving the tab | Our `claude attach` processes 1 → 0; the session went on (`working`, `idle`) |
| Page errors | None |

Everything made was removed: the sessions (Clean up's `claude rm`), worktrees, branches, records,
threads, `cpr/config.json` (the model, Haiku), and Claude Code's records of the folder (`claude
purge -y`). One run's typed message was not submitted: it was typed as soon as CPR's cached state
said "plan ready", before Claude Code's own `idle`; the three runs that waited for `idle` all
submitted. Not explained.

Cost: a key to its echo through CPR with the fake agent, 30 keys watched every animation frame,
32–33 ms (two frames); its first output 122 ms after opening. With the real agent, watched every
100 ms: every key under 106 ms. xterm.js in its own chunks, 331 KB (83 KB gzip) and 4 KB of CSS,
loaded when a terminal first opens; the main bundle 575.9 → 581.7 KB.

Not verified: Windows (ConPTY) and macOS; Firefox and Safari; a permission prompt answered in
CPR's terminal (`auto` asked none; the spike answered one in a terminal); four real terminals at
once (unit-tested with fakes); the 140 MB per attach, not measured again.

### V23 — Branches that need you, first in the branches panel

**Status:** merged into main (2026-10-18, from branch `feature/sort-branches-by-last-agent-action`,
a feature started in CPR; approved in CPR at `4321040`). Planned as V22 with decisions 119–120,
which `main` took meanwhile. As built and results: "As built (V23)" below.

**Problem** (asked: "sort the commits from Commits page by last agent action...so i can see the
branches that need my attention at the top", then "we need to sort the Branches from the left side
of the commits page"). The branches panel (V10b, decision 92) lists Local with the checked-out
branch first, then by name. A feature's branch sits where its name falls:

- On this repository (22 local branches, 70 remote, 2 open features) the features are 3rd and
  4th only because `chore/` and `feature/` sort before `fix/` and `milestone/`; a feature named
  `milestone/v22-…` would be the 23rd of 23 local entries.
- The panel says what each feature needs (its mark: `?`, `●`, `⚙`), but not which agent acted
  last: the person reads every entry to find the one that just stopped.
- Claude Code gives no time of a session's last activity: `claude agents --json --all` (2.1.302)
  lists `startedAt`, `state` and `status` only. CPR's thread (`cpr/threads/<branch>.jsonl`, V18c's
  hooks) has a time for every report (a turn ended) and every question or permission asked.
  Not everything there is the agent's: on this repository `chore/update-readme`'s last entries
  are an `idle_prompt` notice a minute after its report and, three days later, a `/clear` (an end
  and a start).
- The commit rows cannot take this order: they are the graph (`git log --topo-order`, each commit
  above its parents, lanes drawn from it), and a feature without commits sits on its base's row.
- `/api/features` on `main`'s build: 34 ms (median of 20; 32–36 ms) on a clone of this
  repository with its two features.

**Goal**: in the panel's Local list, the features that need the person come first, the one whose
agent acted last on top; then the features whose agent works, the same way; then the other
branches as today (the checked-out one, then by name). Each feature's entry shows how long ago its
agent acted. Without open features the panel is as today; Remotes, the commit rows and the
features view do not change.

#### When an agent last acted (core, CLI)

- `FeatureSummary.lastAction?: string` (core, a type only): the time of the thread's newest
  `report` or `asks` entry; else when its agent last started (`agent.started` in the record);
  absent with neither (no agent was found).
- Prompts are the person's or CPR's; notices (Claude Code's `idle_prompt` comes a minute after a
  report) and sessions' starts and ends (`/clear` writes both) are not the agent handing the turn
  back. None of them counts.
- `thread.ts`: `lastAction(entries)`. `summary()` reads a feature's thread once, for it and for
  `turnEnded` (read today only when a session is blocked with nothing named).
- No graph change: no schema bump.

#### The order (viewer)

- `features.ts`: `featuresFirst(features, reviews)` — the branches of the open features that need
  the person (`featureNext`'s `needs-you`), then those whose agent works, each newest
  `lastAction` (else `created`) first, ties by name. Merged features and gone branches are left
  out: they need nothing.
- `branches.ts`: `TreeOptions.first?: readonly string[]` — those local branches first, in that
  order; then the checked-out branch, then by name. The filter keeps the order. A name that is
  not a local branch is ignored. Remotes do not change.
- `BranchesPanel`: a short muted age after a feature's name (`now`, `4m`, `2h`, `3d`), titled with
  the time in full. It ticks once a minute in its own component; the panel is not drawn again.
- The commits page computes `first` from `useFeatures` (read on load, when the page is back in
  view, and every 5 s while an agent works or waits).

#### Verification

1. **Unit** (red first): `lastAction` (reports and questions count; prompts, notices, starts and
   ends do not; the newest wins; none, none); the server's `/api/features` carries it, and
   `agent.started` without a thread; `featuresFirst` (needs-you before working, newest first,
   `created` without `lastAction`, merged and gone left out); `branchTree` with `first` (in that
   order, then the checked-out branch, then by name; the filter; unknown names ignored); without
   `first`, the existing tests unchanged; the age's text.
2. **E2E** (`features.spec.ts`, the fake Claude Code): two features — the one that reported last
   is on top of Local, then the other, then `main`; the other reports and moves on top; a working
   one goes below those that need you; the age is shown. Every existing spec passes,
   `branches.spec.ts` unchanged.
3. **Real data**: a clone of this repository with copies of its feature records and threads (not
   the checkout: `cpr view` from a branch's build rewrites `cpr/claude-settings.json` to that
   build's hook); screenshots light and dark, 1440 and 900 px; no page errors.
4. **Cost**: `/api/features` within 5 ms of `main`'s; with a 5,000-entry thread, measured; if
   reading it costs more than that, read the file's end only.
5. **Nothing else changes**: no analysis code (no regression sets); `pnpm check`, build, e2e.

**Risks**

| Risk | Mitigation |
|---|---|
| The order moves while the person reads (read every 5 s while an agent works or waits) | Only features move, when one acts or changes state; the age says why |
| A long thread read every 5 s per feature | Measured on 5,000 entries; the file's end only, if it costs |
| Features started before V18c have no thread | `agent.started`, else `created` |
| The checked-out branch is no longer first | It keeps its ●; only open features go above it, as asked |

**Order**: the type and `lastAction` with their tests; the server; `featuresFirst` and
`branchTree`; the panel and its age; the e2e; the real-data check.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V23 ✅ | Branches that need you, first | `lastAction` on each feature (its thread's newest report or question); `featuresFirst`; `branchTree`'s `first`; the panel's order and ages; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 120 | What "the agent's last action" is | **Its thread's newest report or question; else when its agent last started; else when the feature was made** | Claude Code lists a session's start only. Those two entries are the agent handing the turn back; prompts are the person's, and notices and `/clear` came minutes to days after the agent's last act on this repository's thread. |
| 121 | Where the order shows | **The branches panel's Local list: features that need you, then working ones, newest action first; then the checked-out branch and the rest by name. Remotes, rows and the features view as they are** | Asked ("sort the Branches from the left side of the commits page"). Rows are graph order; a pushed feature's remote branch stays in its folder; the features view keeps its order until asked. |

**Not in V23 (later)**: the features view's order (started order today); other branches by date;
a toggle between orders; the remote branches.

#### As built (V23)

- **The thread's end only** (`readThreadEnd`, its last 256 KB, the line cut there dropped), as
  the plan allowed if reading cost: a 5,000-entry thread (9.9 MB) took 9.6 ms whole, for each
  feature on every read of the list; its end 0.6 ms at any length, with the same last action. The
  longest entry in this repository's threads is 6.3 KB. The thread view still reads it whole.
- **`featuresFirst` gives each branch with its time** (`{ branch, at }`): the order and the age
  come from the same value.
- **The e2e's last step** is a permission asked, then answered, not a second report then an
  answer: once no agent works or waits, the page stops reading the list every 5 s (V18b), and a
  change shows only when the page is back in view.
- **Names are cut sooner**: the age takes about five characters of the 260 px panel
  (`milestone/v10b-branches-panel` fits on `main`'s build, not beside `55m`). The full name is the
  entry's title, as before.

**Results (V23)**. Tests first: 6 unit tests failed before the code (`lastAction`, the list's
`lastAction`, `featuresFirst`, `shortAge`, `branchTree`'s `first`, then `readThreadEnd`); a
seventh, no `lastAction` without an agent, guards what was already true. The new e2e test fails
on `main`'s build at its first order. Now 730 unit tests and 103 e2e.

On a clone of this repository with copies of its feature records and threads, and two made-up
features (a plan ready 55 minutes ago on `milestone/v10b-branches-panel`, a permission asked 5
minutes ago on `fix/thread-markdown`), in Chromium at 1440 × 900:

| | `main`'s build | This branch |
|---|---|---|
| Local entries of the three open features | 4th, 10th, 12th of 22 | 1st, 2nd, 3rd: the permission (5m), the plan (55m), then this feature at work (19m), then `● main` |
| `/api/features`, median of 20 (three runs, back to back) | 33.2–34.1 ms | 33.5–34.0 ms |
| Page errors (light, dark, the 880 px overlay) | none | none |

The real `chore/update-readme` thread's last action is its report (2026-10-15 11:06), not the
idle notice a minute later or the `/clear` three days after; merged since, it keeps its place by
name.

Not verified: a feature list of dozens of features; Firefox and Safari; Windows and macOS; a real
Claude Code session acting while the page is open (the e2e fake runs CPR's real hooks).

### V24 — A structured brief: kind, title, goal, done when

**Status:** merged into main (2026-10-19, from branch `milestone/v24-structured-brief`): V24a–c. Plan revised the same day with the user's answers: Spike and Refactor are kinds of their own; "Done
when" is optional for every kind; CPR guesses the project's check command; the brief's format
left to the plan (Markdown headings, decision 124).

**Problem** (asked: "The Create a workspace dialog need some structuring..like multiple inputs
where the user is prompt about the feature/chore/fix. With a title, final goal, etc."). The
dialog (`StartFeatureDialog.tsx`, V18) has one text area, "What should the agent build?". One
string does three jobs: the agent's brief, the branch name (its first line's first five words)
and the workspace's name in every list (its first line). Measured:

| What | Today |
|---|---|
| Inputs about the work | 1 free-text area (placeholder: "what, why, what done looks like") |
| Branch prefix | `feature/` for every workspace (`features.branchPrefix`, one value) |
| This repository's merges into `main` | 35: 20 milestones, 7 fixes, 4 chores or docs, 4 other — a third is not a feature |
| What the agent is told about "done" | Only what the person thought to write; the prompt adds "check it as the project's own instructions say" |
| The name in lists | The brief's first line, however long; a brief that starts with context names the workspace after that context |

What agent vendors ask for in a task, read on 2026-10-19 (sources in JOURNAL "V24 spike"):
Anthropic's Claude Code best practices ("give Claude a check it can run"; for a bug "the
symptom, the likely location, and what 'fixed' looks like"; specs "state what is out of scope"),
Devin (context, success criteria, patterns to reuse; "Make sure it works" is the bad example),
GitHub Copilot's coding agent (a clear problem, complete acceptance criteria, which files),
Codex (file paths; a reproduction and constraints "matter more than a high-level description").
All four ask for the same three things a single text area leaves to memory: **the goal and why,
how done is checked, and the bounds** (where to look, what not to touch); bugs add **what
happens against what should, and how to reproduce it**. Issue forms (GitHub) keep required
fields few and mark the rest optional.

**Guessing the check command** (measured on 16 repositories' default branches, 2026-10-19: this
one, the six regression repositories, TypeScript (Go port), React, Express, Requests, Flask,
FastAPI, ripgrep, axum, cobra). The rule below, from root files only, against what the
repository's agent instructions, CONTRIBUTING or CI run:

| Result | Repositories |
|---|---|
| Same command, or one that runs it (13) | CPR `pnpm run check`; ky, Express, Bitwarden `npm run test`; RealWorld `bun run test`; React `yarn run test`; zod `nub run test`; TypeScript `npm run test` (= `hereby test`); axum, ripgrep `cargo test --workspace`; cobra, Requests `make test`; FastAPI `bash scripts/test.sh` |
| Right but heavy (2) | Qwik `pnpm run test` builds everything and runs e2e (its AGENTS.md says `pnpm test.unit`); vite's runs unit, serve and build suites |
| Close (1) | Flask `uv run pytest` (CI: `tox` through `uv`) |
| None found, words instead (0) | — |

No guess was wrong; 2 of 16 were slow. 7 of 16 repositories have agent instructions
(`CLAUDE.md`/`AGENTS.md`); the prompt already tells the agent to follow them, and the guess
is shown with its source and is editable, so a heavy guess costs the person one edit.

Causes:
- One text area, no prompt about the parts an agent needs; the placeholder is the only hint.
- No kind: a fix gets a `feature/` branch and the same instructions as a feature.
- The name is derived, not given.

**Goal**: the dialog asks for the work in a few labelled parts, chosen by its **kind** —
Feature, Fix, Refactor, Chore or Spike: a **title** (the workspace's name and its branch), the
one part that kind needs, **Done when** (optional; filled in for every kind but Feature, with the
guessed check command), and optional parts behind "More". CPR assembles them into the agent's
brief in a fixed order with fixed headings, and the branch takes the kind's prefix. The record
keeps the parts, so the panel shows them as written. Unchanged: workspaces started before V24
(their brief, name and branch as today), the agent's launch, plan first, permissions, the
worktree, reviews and merges; `cpr diff`, `cpr pr` and the graph JSON.

#### The kinds and their inputs (viewer)

The kind is a segmented control at the top (Feature · Fix · Refactor · Chore · Spike; `1`–`5`
while it has focus), Feature by default, the last one picked remembered per repository (with the
draft, decision 128). Required: the title and the kind's one part. `<check>` is the guessed command
(below), else the words "the project's checks".

| Kind | Required part | Done when (optional, pre-filled) | Under "More" (optional) | Branch |
|---|---|---|---|---|
| **Feature** | **Goal** — "What should it do, and why?" | empty; placeholder "e.g. `<check>` passes, and …" | Where to look; Out of scope; Notes | `feature/` |
| **Fix** | **What happens** — "What goes wrong, and what should happen instead?" | "A test that fails today passes, and `<check>` passes." | How to reproduce; Where to look; Notes | `fix/` |
| **Refactor** | **What to restructure** — "What, and why is the current shape a problem?" | "Behaviour is unchanged: existing tests pass without changing what they assert, and `<check>` passes." | Where to look; Out of scope; Notes | `refactor/` |
| **Chore** | **What to change** — "What, and why now?" (dependencies, config, docs, tooling) | "`<check>` passes." | Where to look; Out of scope; Notes | `chore/` |
| **Spike** | **Question** — "What do you want to find out, and what will you decide with the answer?" | "A written answer: what was tried, what was measured, and a recommendation." | What is known; Where to look; Notes | `spike/` |

- Visible per kind: title, the required part, Done when; "More" collapsed unless a field in it
  has text. Optional means the brief leaves an empty part out; an empty Done when leaves the
  prompt's "check it as the project's own instructions say" as the only word on it.
- Under Done when, when a command was guessed: "`pnpm run check` from package.json (scripts.check)"
  — the command and where it came from, so a wrong or heavy guess is seen before Start.
- **Switching kind** keeps every text typed: the required part is one text area whose label
  changes; Done when changes to the new kind's default only while it still equals the old
  kind's default (edited text is kept); More's fields are kept and shown where the kind has them.
- Branch: proposed from the **title**, with the kind's prefix; editable as today, and once
  edited no longer follows title or kind.
- Lengths: the assembled brief is checked against `maxBrief` (20,000) as one text, the count
  shown under the dialog when it is within 10 % of it.
- **A draft**: the fields are kept per repository while the dialog is open and cleared after a
  start; Escape and Cancel keep it, "Clear" empties it. (Built in CPR's cache, not
  `localStorage`: decision 128.)
- Ctrl+Enter starts, Escape cancels, as today; Tab goes kind → title → required part → Done
  when → More → branch → plan first → Start.

#### Guessing the check command (CLI)

`GET /api/features/check?at=<commit>` → `{ command, source }` or `{}`, read from the commit the
workspace starts at (`git cat-file` of a few root files; the worktree does not exist yet). The
dialog asks when it opens and when the start commit changes; it shows words until the answer
comes, and keeps words if the request fails. First match wins:

1. `package.json` `scripts.check`, else `scripts.test` (not npm's `echo "Error: no test
   specified" && exit 1`) → `<pm> run check|test`. `<pm>`: the `packageManager` field's name,
   else the lockfile (`pnpm-lock.yaml` pnpm, `yarn.lock` yarn, `bun.lock`/`bun.lockb` bun,
   else npm).
2. `Makefile` with a `check:` or `test:` target → `make check|test`.
3. `scripts/test.sh` → `bash scripts/test.sh`.
4. `Cargo.toml` → `cargo test`, with `--workspace` when it has a `[workspace]` table.
5. `go.mod` → `go test ./...`.
6. `pyproject.toml`, `setup.py`, `tox.ini` or `pytest.ini` → `uv run pytest` with `uv.lock`,
   else `python -m pytest`.

Root files only: a monorepo's root command is what its people run (10 of 10 JavaScript
repositories above had one). Agent instructions are not parsed: their commands sit in prose and
code blocks with many alternatives (Qwik's lists 6), and the agent reads them anyway.

#### The record, the request and the prompt (core, CLI)

- `FeatureRequest` and the record gain `kind` (`feature` | `fix` | `refactor` | `chore` |
  `spike`), `title` and `parts` (`{ goal?, happens?, restructure?, change?, question?, known?,
  reproduce?, doneWhen?, where?, outOfScope?, notes? }`, absent when empty). The request no
  longer sends `brief`: the **server** assembles it (`briefOf` in
  `packages/cli/src/features.ts`), so the record's `brief` stays what the agent was told and
  every reader of `brief` (the panel's "The brief", `featurePrompt`) works unchanged. Server
  checks: a known kind, a title, the kind's required part, only the kind's parts, the assembled
  length; 400 with the field's label otherwise.
- Old records (no `kind`): read as before; their name is the brief's first line. New records:
  the name is `title`. `FeatureSummary` gains `kind` and `title` (absent for old ones).
- **The brief** (`briefOf`): Markdown headings in a fixed order, empty parts left out, the
  person's text verbatim under each:

  ```
  # Fix: The date column sorts as text

  ## What happens
  …
  ## How to reproduce
  …
  ## Where to look
  …
  ## Done when
  A test that fails today passes, and `pnpm run check` passes.
  ```

  Order: the required part, then context (reproduce, known, where, out of scope, notes), Done
  when last (Anthropic's guidance: the material first, the request and its check last).
- **The prompt** (`featurePrompt`): unchanged except one line per kind after the brief, the
  only instruction CPR adds:

  | Kind | Line |
  |---|---|
  | Feature | none |
  | Fix | "Reproduce it first, with a failing test where the project has tests, then fix the cause, not the symptom." |
  | Refactor | "Change structure, not behaviour: do not change what existing tests assert; if behaviour must change, stop and say so." |
  | Chore | "Keep to what is asked; if it needs a change in behaviour, stop and say so." |
  | Spike | "The answer is what is asked for, not a change to merge: put it in your final report; keep experiments out of the project's code unless the brief says otherwise." |

- **Branch prefixes**: `features.branchPrefixes` in `cpr/config.json` (default `{ "feature":
  "feature/", "fix": "fix/", "refactor": "refactor/", "chore": "chore/", "spike": "spike/" }`,
  a partial object overrides only its kinds); `features.branchPrefix`, if set, stays the Feature
  prefix. `FeatureOptions.branchPrefix` becomes `branchPrefixes`.
- No graph JSON or analysis change.

#### The workspace list and panel (viewer)

- A row's name is the title (old workspaces: the brief's first line, as today), with the kind
  as a small text tag before it (`fix`, `refactor`, `chore`, `spike`; none for Feature, the
  common case).
- "The brief" in the panel shows the assembled brief, as today; the review page's "Workspace: …"
  uses the title.
- A Spike's answer is its agent's final report, in the thread as today; reviews and merges are
  unchanged for it (its branch is usually empty, and Clean up ends it).

#### Verification

1. **Unit, red first**:
   - `briefOf` per kind: order, headings, empty parts left out, text kept byte for byte, a part
     that contains `## ` lines; the per-kind prompt line.
   - `guessCheck` on fixture trees built as git commits: each rule, the order between them
     (`package.json` with `check` and `test`; `Makefile` beside `Cargo.toml`), npm's placeholder
     `test` skipped, each package manager source, Cargo with and without `[workspace]`, none →
     `{}`; read from the given commit, not the working copy.
   - Request validation: missing title, missing required part per kind, a part the kind does not
     have, unknown kind, assembled length over 20,000; `{ brief }` alone still accepted as a
     Feature.
   - Old records read unchanged and named by their first line; `proposeBranch` from the title
     with each kind's prefix, `-2` when taken; config with `branchPrefix` only, `branchPrefixes`
     only (partial), both.
2. **The guess on real repositories**: the 16 above again through `/api/features/check`, the
   same results as the table; its time on Bitwarden's full clone (target: under 50 ms).
3. **E2E** (`features.spec.ts`, rewritten where it fills the brief): each kind starts a
   workspace whose fake agent received the expected brief and line; the guessed command and its
   source under Done when; switching kind keeps text and swaps an unedited Done when only;
   Start disabled until the title and required part have text; More opens itself when a field in
   it has text; the draft survives Escape and a reload, and is gone after a start; an old record
   is listed by its first line; keyboard path (Tab order, `1`–`5`, Ctrl+Enter).
4. **Nothing else changes**: the e2e suite, the commits page and reviews; no analysis code, so
   no regression sets.
5. **Viewer** (`viewer-check`): the dialog in light and dark at 1440 × 900 and 390 × 844, each
   kind, More open and closed: it fits without scrolling at 1440 × 900 with More closed; the five
   kinds fit on one line at 390 px; screenshots against today's.
6. **With a real agent**: one workspace of each kind started with a real Claude Code (headless,
   Haiku, plan first) on a scratch repository with a planted bug: the Fix's plan names a failing
   test first; the Refactor's and Chore's change no test assertions; the Spike's report answers
   the question and its branch has no commits; record what the plans say.

**Risks**

| Risk | Mitigation |
|---|---|
| A form is slower than one text area for a quick ask | Two required inputs (title, one part); Done when filled in; measure keys from open to Start against today's |
| A guessed command is wrong or heavy (Qwik, vite) | Shown with its source under Done when, editable; root files only, so no guess from prose; measured on 16 repositories: 0 wrong, 2 heavy |
| A guess runs against an old start commit with different scripts | Read from the start commit, the tree the agent gets |
| Someone pastes a long spec | Parts take any length; the assembled limit is the only one |
| Five kinds crowd the control at 390 px | Short labels; measured in step 5; below that width the control wraps |
| A spike's agent commits anyway | The prompt line says not to; the branch's review shows any commit as usual |
| Older viewers or scripts posting `{ brief }` | The server keeps accepting `brief` alone as a Feature with the brief's first line as its title (one release), so nothing that posts today breaks |

**Order**: `briefOf`, the record and the request, then `guessCheck` and its endpoint (unit tests
first), then the dialog, then the list and panel; the real-agent check last.

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V24a ✅ | Kinds and parts in the record | `kind`, `title`, `parts` in `FeatureRequest`, the record and `FeatureSummary`; `briefOf`; the per-kind prompt line; `branchPrefixes`; server validation; old records and `{ brief }` requests as before. |
| V24b ✅ | The check guess | `guessCheck` and `GET /api/features/check`; the 16-repository comparison repeated through it. |
| V24c ✅ | The structured dialog | Kind control, the kind's inputs, Done when with the guess, More, the draft, branch from title and kind; the list's title and kind tag; e2e; screenshots; the real-agent check. |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 122 | Which kinds | **Feature, Fix, Refactor, Chore, Spike** | Asked (revised 2026-10-19: Spike and Refactor of their own). Refactor differs from Chore in what done means (tests' assertions unchanged); a Spike's output is an answer, not a branch to merge |
| 123 | Who assembles the brief | **The server**, from the parts; the record keeps both | One place for the format; `brief` stays what the agent was told, so every reader of it is unchanged |
| 124 | Headings or XML tags in the brief | **Markdown headings** | Left to the plan. The person reads the brief in the panel as written; Claude Code and Codex both read Markdown; headings carry the same structure tags would, and an agent's own instructions (CLAUDE.md, AGENTS.md) are Markdown too |
| 125 | Does CPR fill in a check command | **Yes, guessed from root files, shown with its source, editable** | Asked (revised 2026-10-19; proposed "no"). Measured on 16 repositories: 13 the documented command, 2 right but heavy, 1 close, 0 wrong. Seen and editable before Start, so precision is the person's to keep |
| 126 | Is Done when required | **No, for any kind** | Asked. Filled in for four kinds, so it is there unless removed; an empty one falls back to the project's own instructions |
| 127 | Where a spike's answer goes | **The agent's final report**, in the thread | Repositories keep spikes in different places or not at all; the thread is CPR's own record. A brief can ask for a file instead |
| 128 | Where the start dialog's draft and last kind are kept | **CPR's cache, per repository** (`/api/features/draft`), not browser storage | Found building V24c: `cpr view` takes a free port per run and browser storage is per origin (decision 17), so a draft in `localStorage` would be gone at the next `cpr view`. The cache is per user, so nothing lands in the repository |

**Not in V24 (later)**: templates per repository (`cpr/config.json` defining kinds and fields);
a guess from agent instructions; attaching screenshots or logs as files; filling a brief from an
issue or a review comment; an LLM rewriting the person's brief; spike answers as a document kind
in reviews.

**As built (V24a)**:
- The start dialog's options carry the kinds (`kinds`: each one's name, its parts in the brief's
  order with their headings, which one is required, Done when's default), so V24c's dialog
  renders the server's one table instead of a copy: the brief's order and the dialog's are the
  same by construction. `branchPrefix` became `branchPrefixes`; today's dialog uses the Feature's.
- Done when's defaults say `{checks pass}` where the plan said `<check>`: the token carries its
  verb, because "`pnpm run check` passes" and "the project's checks pass" do not agree with one
  verb. The Chore's default reads "Nothing else changes, and {checks pass}." so the token is never
  at the start of a sentence.
- A request with `brief` alone makes a record as before V24 (no kind, no title), not a Feature
  with the brief's first line as title: as a Feature, an old client's agent would get its whole
  brief under "## Goal", which is not what it was told before.
- A title is one line of at most 200 characters (not in the plan): it names the workspace in
  lists and proposes its branch.
- The prompt names the work by its kind ("You are starting a new fix", "This fix's record"), and
  a Spike's closing paragraph says to commit nothing unless the brief asks and to give the answer
  in the report, instead of "Commit your work … the person reviews the branch".
- The brief's sections are separated by blank lines.

**As built (V24b)**: as planned, plus:
- The tree is read with `git ls-tree` (the root's names, and `scripts/test.sh` asked for by
  path); only the files a rule needs are read (`package.json`, the Makefile, `Cargo.toml`).
  Lockfiles are known by name, never read: `pnpm-lock.yaml` runs to megabytes.
- `GNUmakefile` and `makefile` count as a Makefile; a line `test := …` sets a variable and is not a
  target.
- A `packageManager` that is not a plain program name is ignored for the lockfile's, so the
  dialog never shows an arbitrary command from it.
- Guesses are kept per commit while `cpr view` runs (a commit's files never change).

**Results (V24b)**: through `guessCheck` and `treeAt` on the same 16 repositories, the same 16
commands as the planning table. 13–17 ms per guess on full clones (Bitwarden 15–17 ms, this
repository 13–15 ms; three runs each), against the 50 ms target.

**As built (V24c)**:
- The draft and the last kind are kept by `cpr view` in CPR's cache (`/api/features/draft`), not
  in `localStorage` (decision 128); after a start the draft is cut to the kind. Edits are saved
  400 ms after typing pauses, Start saves at once, Cancel and Escape save what is pending.
- An info button (ⓘ) after the kinds shows what each is for, in a line, the picked one marked
  (asked after V24c was built): on hover, while it has the focus, or once tapped; Escape hides it,
  not the dialog. It spans the dialog under the kinds and takes no pointer events.
- The kind picker is a radio group: `1`–`5` and the arrow keys while it has focus, one tab stop.
  The title has the focus when the dialog opens (the kind is remembered, so typing starts
  there); Shift+Tab reaches the kinds.
- The dialog shows "Check: `<command>`, from <source>" under Done when when a command was
  guessed; Done when and More's fields say "optional".
- The dialog scrolls inside the window when it is taller than it (More open, a phone).
- The viewer counts the brief's length as the server makes it (`briefLength`), checked against
  `briefOf` by a test, for the count shown within 10 % of 20,000.
- `getJson` and `postJson` moved to `http.ts`: the dialog and its starter imported each other.
- The kind tag is the kind's own word (`fix`, `refactor`, `chore`, `spike`), in the list, the
  panel's head, and the review page's "Workspace: <title>".

**Results (V24c)**:

| What | Before (V24b's build) | V24c |
|---|---|---|
| Dialog height, 1440 × 900, More closed | 463 px | 645 px; fits (no scroll) for each kind, light and dark |
| Dialog, 390 × 844, More closed | — | 685 px; fits; the five kinds and their info on one line |
| More open (Spike) | — | 912 px of content in an 866 px dialog at 1440 × 900: scrolls inside it |
| Inputs to fill for a quick ask | 1 (the brief) | 2 (title, the kind's part), 1 Tab between; a kind other than the last is 1 more key |
| e2e | 104 | 110 (6 new; 4 red on V24b's build, 1 guards what stays; the info's red before it existed) |

With a real Claude Code (2.1.303, Haiku, `claude -p`, read-only tools, plan first) given CPR's
own prompt for each kind on a scratch repository with a date sort that compares strings: the Fix's
plan writes a failing test first and fixes the comparator, not the one pair; the Refactor's keeps
`test/totals.test.js` unchanged and asks before adding tests; the Chore's changes only the README;
the Spike's commits nothing, keeps experiments out of the project and ends in a written answer;
the Feature's (no Done when) plans tests and `npm test` itself. 21–46 s each. Not through
`claude --bg` (its trust prompt cannot be answered by a script, V18) and not in a real worktree:
the agents said so, as they did of the record paths that did not exist.

### V25 — Workspaces first, History beneath

**Status:** merged into main (2026-10-19, from branch `milestone/v25-workspaces-home`): V25a–c. Decisions
135–140 confirmed by the user before V25a ("always keep workspaces as the first page"; the kind
kept "because they are indeed a feature").

**Problem** (asked: "I don't like the commits page name … and that we still work with commits,
this app is one abstraction higher than git branches … it works with worktrees, and I call a
worktree a workspace"). Measured on `main` (`d604c2d`):

| What | Today |
|---|---|
| `cpr view` with no revisions opens on | `/`, the commits page; Workspaces is the second tab (`/workspaces`) |
| The tabs | "Commits · Workspaces" (`PageTabs.tsx`) |
| A diff's way back | "← Commits" (`BackToCommits`), even when it was opened from a workspace |
| "commits page" in user text | README 6 times, `cpr view --help` once, the page's heading "Commits" |
| "feature" in code (`feature`, `features`, `Feature…`, `feature…`) | 1,949 matches: core 48 + 52 tests, cli 486 + 545, viewer 459 + 153, e2e 206 |
| Files named for features | 12 (`FeaturesPage.tsx`, `features.ts` ×3, `useFeatures.ts`, `StartFeatureDialog.tsx`, …) |
| The API | `/api/features…`, 30 uses in the viewer and the server |
| On disk | `cpr/features/<branch>.json`, described as "Features" in the `cpr/AGENTS.md` CPR writes |
| e2e that open `/` and expect the commits page | 54 of 90 `goto` calls |

What causes it:
- V10a made the history the first page, before workspaces existed (V18). V18b added
  workspaces as a second tab, and V24 changed what they are called on screen but not in the code.
- The word "feature" now means two things: a workspace (code, API, disk) and one of V24's five
  kinds of work (`WorkKind 'feature'`, the `feature/` branch prefix).

**Goal**: `cpr view` opens on **Workspaces**. The repository's history is still there, called
**History**, at `/history`. "Workspace" is the word everywhere: on screen, in the code, in the API
and on disk. "Feature" is left only for the kind of work. Unchanged: `cpr view <base> [head]`
still opens on that comparison, `cpr diff` and `cpr pr` are untouched, graph JSON is untouched,
and old addresses and old workspace records keep working.

#### Pages and addresses (viewer, server)

- `/` is Workspaces. `/history` is the history page (today's commits page, behavior unchanged).
  The tabs read **Workspaces · History**, in that order, and the needs-you count stays on
  Workspaces.
- Old addresses keep working: `/workspaces` and `/features` are rewritten to `/` with
  `history.replaceState`, keeping search and hash (`&thread` links keep working). A bare `/` saved
  before V25 meant the commits page; it now opens Workspaces, which is the point of the change.
- The server serves the page at `/history` (beside `/workspaces` and `/features`). `/api/history`
  is the API and is unaffected (exact-path routing).
- A diff's way back names where it came from: "← History" or "← Workspaces", kept in the diff
  page's history state. With no state (a bookmark, a reload) it is "← History".
- The workspaces page's empty state ("No workspaces yet …") gains **Start a workspace** (n) and a
  link to History. Keys on History are unchanged.
- `cpr view --help` and the README say "History" and describe Workspaces as the first page.
  `docs/images/commits.png` is retaken as `history.png`.

#### One word in the code (cli, core, viewer)

- Rename the workspace meaning of "feature" to "workspace": files (`FeaturesPage.tsx` →
  `WorkspacesPage.tsx`, `features.ts` → `workspaces.ts` in each package, `useFeatures`,
  `FeatureMark`, `FeatureStarter`, `StartFeatureDialog` → `StartWorkspaceDialog`), types
  (`Features` → `Workspaces`, `FeatureRecord`…), the page state (`'features'` → `'workspaces'`,
  `'commits'` → `'history'`), CSS classes, and `CommitsPage` → `HistoryPage`.
- Keep `WorkKind 'feature'`, the `feature/` prefix and every string about the kind. The rename is
  done symbol by symbol (TypeScript's rename), not by a text replace. A guard test lists the
  remaining `feature` identifiers outside kind code and fails on new ones.
- API: `/api/workspaces…`. The viewer and the server ship in one package and one process, so
  `/api/features…` is not kept as an alias.
- `@cpr/core` exports: the renamed types are exported under their new names only. No other
  package outside this repository imports them (the plugins import graph types only).

#### Records on disk

- Workspaces are kept in `cpr/workspaces/<branch>.json` (and the cache fallback's `workspaces/`).
- When a repository is opened and `cpr/features/` exists but `cpr/workspaces/` does not, CPR moves
  it with one `rename` (atomic on one filesystem). If both exist, it reads `cpr/workspaces/` and
  leaves the old folder, with a note in `/api/workspaces`' `note`. Nothing is copied, so records
  are not duplicated.
- `cpr/AGENTS.md`, which CPR writes, says "Workspaces" and `cpr/workspaces/<branch>.json`.
  Threads (`cpr/threads/`) and reviews (`cpr/reviews/`) do not move.

#### Verification

1. **Tests first** (red before): server, `/history` serves the page and `/workspaces` and
   `/features` still serve it; viewer unit, the page chosen for each address and the back link's
   label; core/cli, the move of `cpr/features/` (only old, only new, both, neither, a cache-only
   repository); `AGENTS.md`'s text; the guard test on `feature` identifiers.
2. **e2e**: the 54 `goto('/')` calls that mean the history go to `/history`; new specs:
   `cpr view` opens on Workspaces, the empty state's two actions, the tabs' order and count,
   "← Workspaces" from a workspace's review and "← History" from a compare, and the old
   addresses. All of today's 113 pass.
3. **Nothing else changes**: graph goldens untouched (no analysis change, so no
   `regression-check`). `cpr diff`/`cpr pr` output byte-identical on this repository's last five
   merges.
4. **Real use**: this repository's two workspaces (`cpr/features/`, 2 records) moved on the first
   start and listed as before. A workspace started before V25 and still running gets a reply and is
   cleaned up. The same with a Codex one.
5. **Viewer**: `viewer-check`, screenshots of Workspaces (empty and with two) and History, light
   and dark, at 1440, 900 and 390 px. First paint of `/` is no slower than today's `/workspaces`.

**Risks**

| Risk | Mitigation |
|---|---|
| The rename catches the kind "feature" (`feature/` branches, the Feature kind's line) | Symbol renames, not text; V24's kind tests and e2e unchanged and green; the guard test |
| An agent running during the move reads `cpr/features/<branch>.json` | Its brief is in its prompt; the record is only re-read by CPR. Tested: a running workspace across the move |
| Two `cpr view` processes on one repository both try the move | `rename` fails for the second (target exists), which then reads the new folder; tested |
| People expect `/` to be the history (bookmarks, muscle memory) | The History tab is one click or `h`; the README's first lines say it |
| A 1,949-match rename makes a large, hard-to-review diff | V25b is its own commit with no behavior change: tests unchanged except for names |

**Order**: V25a first (the visible change, on today's names), then V25b (renames only, all tests
green before and after), then V25c (disk).

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V25a | Workspaces home, History | `/` Workspaces, `/history` History; tabs "Workspaces · History"; old addresses rewritten; a back link to where the diff came from; the empty state's Start and History; `h` to History; help, README, screenshots |
| V25b | One word in the code | Files, types, state, CSS and API renamed from features to workspaces and from commits page to history; the kind "feature" kept; the guard test |
| V25c | Records on disk | `cpr/workspaces/`, a one-time move of `cpr/features/`, `AGENTS.md`'s text |

**Decisions** (135–140 confirmed; 141 made while building):

| # | Question | Decision | Why |
|---|---|---|---|
| 135 | The history page's name | **History** | It is the repository's history (every branch, the commit graph). "Branches" is git's own word, and every workspace already has a branch. "Repository" would cover workspaces too |
| 136 | The first page | **Workspaces, also when there are none** | The empty state starts one or links to History. Workspaces are the unit CPR works in, so a first run shows that |
| 137 | `/api/features` alias | **None** | The viewer and the server are always the same version (one process) |
| 138 | Old records | **Move `cpr/features/` once, with `rename`** | Reading both forever would keep the old word in the code. A copy would leave two sources |
| 139 | "feature" as a kind | **Kept** | It is the kind most branches are (V24). Renaming it would change branch prefixes people already use |
| 140 | A key for History | **`h`** (the tabs' keys: `w` Workspaces, `h` History) | Neither is bound on either page today (checked: no handler for `h` or `w` in `packages/viewer/src`) |
| 141 | `cpr/config.json`'s `features` section | **Now `workspaces`; `features` still read when `workspaces` is not there** | It is the person's file, which CPR cannot move as it moves its records. Like the old addresses, the old name keeps working |

**Not in V25 (later)**: a workspace's own history (its commits drawn alone, in its panel), and
starting a workspace from a History branch that has none.

#### As built (V25)

- **The way back from a diff** is read from the page's `document.referrer`, not from history
  state as planned. A diff is opened with `location.assign` (History's Compare, a workspace's
  Review), so the opening page cannot leave state on it. The referrer outlives a reload, and is
  empty for a bookmark (then "← History"). `src/pages.ts` holds the rule, unit-tested.
- **The empty state** has no Start button of its own. The page header's "Start a workspace" is right
  above it, and a second one broke strict locators in 4 specs. It says "Start a workspace above
  (n)" and links to History.
- **A workspace's branch link** went to `/?branch=` (History, when History was at `/`). That address
  now picks a workspace, so it goes to `/history?branch=`. Found by reading the code, not a test.
- **The rename** was done by a script on TypeScript's syntax tree, not by text: identifiers, module
  paths, `/api/features…`, CSS classes, comments and test titles (1,437 edits; 12 files renamed;
  `CommitsPage` → `HistoryPage`; page states `'workspaces'` and `'history'`). What it got wrong and
  was put back: three objects keyed by kind (typecheck found them), one more in a test (`toEqual`
  ignores an undefined key, so only reading the diff found it), the fixtures' git branch named
  `feature` (`shas.feature` in 4 test files), and comments on the Feature kind. `/api/features`
  without its leading slash in one spec was missed by both passes; e2e found it.
- **"Workspace" is taken twice more** in the code: npm/pnpm workspaces (`core/src/workspace.ts`) and
  Angular workspaces in the plugin. Different files and no shared names, so left as they are.
- **The commits list's CSS classes** (`commits-*`) are kept: they name the list, which History still
  is.
- **Moving the records**: `workspacesFolder` in `thread.ts`, since the agent's hook (a process of its
  own, Node modules only) reads the records too. An agent running across the upgrade can fire its
  hook before any `cpr view`; then the hook moves them. On Linux `rename` replaces an empty
  `cpr/workspaces/`, so "both" means both hold something.
- **The list's note is now shown** on Workspaces (`.workspaces-note`). The plan put the "old folder
  left" note in the API only. The cache note (why workspaces are not in `cpr/`) was never shown
  either; now it is.

**Results.** Tests first, red before: server 1, viewer unit 4 (`pages.test.ts`), CLI help 1, config
1, the move 3, the hook 1, the list 1, `AGENTS.md` 1, the guard test 1 (red with a new `featureCount`), e2e 2
(the pages, old addresses and keys; the note). 801 unit tests (788 on `main`), 114 of 114 e2e.
Matches of `feature` in code and tests: 1,949 → 565, mostly `feature/…` branch names and the kind
in tests; 5 identifiers in `src`, all listed by the guard test. In Chromium on throwaway
repositories: Workspaces with two workspaces, empty, and History, light and dark at 1440 and 390 px,
no page errors. First paint, same server, 5–9 rounds back to back: `main`'s `/workspaces` 109 ms,
V25's `/` 109 ms; `main`'s `/` (commits) 60 ms, V25's `/history` 60 ms. History at 390 px is cramped
(its help wraps into a narrow column, Compare mode is cut), the same on `main`. On a repository whose
two records were in `cpr/features/`, the built CLI's hook moved them and recorded its event,
`cpr view` listed both in 40 ms, and a `cpr/features/` made again showed the note. README's History
screenshot retaken (`history.png`). `cpr diff` on this repository's last 5 merges, `main`'s build
and this one: the same graph JSON but for `stats.durationMs` (within ±4 %). Not verified: a real Claude Code or Codex session running across
the move (the hook was run by hand with a recorded event); Windows, where `rename` onto an existing
folder fails even when it is empty (then the old folder is reported left); the README's Workspaces
screenshot (`features.png`, three real agents) is not retaken and still shows the old tab order.

### V26 — A merger: approved branches merged by CPR, an agent only for conflicts

**Status:** V26a and V26c merged into main (2026-10-20, from branch `milestone/v26-merger`). V26b dropped (2026-10-20, decision 164): every conflict goes to the merger agent.

**Problem** (asked: "I want a merger agent, who specializes in merging branches"; "I don't like the
idea of the workspace's own agent doing it … it already has polluted context … we need to optimise
token generation also"; "I need to have the possibility to choose which branch merges into which.
Most of my working projects are old, and they have master … or I need to merge into another
branch"; "the merger agent needs a skill for that … does he need a heavy skill?"). Since V17 an Approve is a note for the branch's agent, and `cpr/AGENTS.md`
tells that agent to merge. A workspace's agent works in a linked worktree while the default branch
is checked out in the main checkout, so `AGENTS.md` tells it not to merge there, and the merge
comes back to the person. Measured (2026-10-19):

| What | Measured |
|---|---|
| A workspace agent's context at its last turn (Claude Code session files, the 6 sessions of this repository's 5 workspaces) | **66K–474K tokens** (median ~215K); 28–432 turns. A merge run in that session would carry it on every turn |
| Last merges on the default branch that conflict when replayed, plus merges of the default branch into the branch before it (where conflicts are usually resolved) | This repository: **11** conflicting (73 merges). Bitwarden: **21** (80 merges; 11 of them the `jslib` submodule). Qwik: **7** (80). Vite: 0 (10) |
| `git merge-tree --write-tree` on those merges (no checkout, index or ref touched) | median 2–3 ms, max 760 ms |
| What conflicts | Here 16 of 18 files are docs (`JOURNAL.md` 10, `PLAN.md` 4, `README.md` 2). Bitwarden: `messages.json` 30, the `jslib` submodule 11, code 5 |
| Conflict regions where the ancestor had nothing, both sides only added (git's diff3 style) | Here 16 of 20 regions; Bitwarden 31 of 46; Qwik 3 of 12 |
| "Keep both" (the first parent's addition, then the second's) where the additions share no lines but blank lines and lone brackets | Applicable to **7** conflicts (here 6, Bitwarden 1). Equal to what was committed in 5; in the 2 others, the merge added an unrelated entry, or the same keys came in the other order (still valid JSON, 435 keys). Refused for **5** whose additions overlap (one side already had the other's keys): keeping both would have duplicated them |
| What an agent would need to read for the other conflicts | The conflict regions with 3 lines around: **0.6K–5.8K tokens** (11 conflicts here, median ~1.3K) |

What causes it:
- The merge is given to the agent that wrote the branch: the most expensive context there is, and
  one that cannot do the merge where it works.
- Nothing does the merge that needs no judgement (most of them), so every merge waits for a person
  or an agent.

**Goal**: Approve, then **Merge**. CPR merges the approved commit in a worktree of its own, runs
the project's check, and moves the default branch. No agent and no tokens when the merge is clean.
A conflict whose sides only added, without overlap, is resolved by a rule (dropped: V26b, decision
164). Anything else goes to a fresh agent that starts from the conflict alone, never the
workspace's agent. Every resolution is reviewed by the person in CPR before the branch moves. Unchanged: the workspace's agent, reviews,
and `cpr diff`/`cpr pr`.

#### The merge (cli: `merges.ts`, beside `workspaces.ts`)

- **A queue per repository**, kept in CPR's cache. An entry is a branch, the approved commit
  (`head` of the Approve verdict, V17), the branch to merge into (`into`, the default branch), and
  a state: `queued` → `merging` → `checking` → `needs-you` (a resolution to review, or a failure
  to read) → `ready` → `landed` | `failed`. One merge at a time. The next starts from the default
  branch the last one produced, and its conflict check is made again.
- **CPR's merge worktree** in its cache (`git worktree add --detach`, as the CLI's other worktrees),
  reset for each entry to the tip of `into`. The person's checkout is never used to merge: it may
  hold their work.
- **Clean**: `git merge --no-ff -m "Merge <branch>: <title>" <approved sha>` (the workspace's
  title, else the branch's last subject), then the check (below). Passed: `ready`.
- **Landing**: the default branch moves only by fast-forward to the merge commit. If it is checked
  out in a worktree (usually the main checkout), CPR runs `git -C <that worktree> merge --ff-only
  <merge>` there. git refuses if local changes would be overwritten, and nothing changes then: the
  entry stays `ready` with git's words, and **Land** tries again. If it is checked out nowhere,
  `git update-ref refs/heads/<into> <merge> <old>`: refused if it moved meanwhile. If `into` moved
  since the merge started, the entry goes back to `queued` (merged again on the new tip).
  `merge.push: true` pushes after landing. It is off by default.
- **The check**: `merge.checks` in `cpr/config.json`, else the command guessed at `into` (V24b).
  The last 60 lines of its output are kept with the entry. No check (none guessed, none set):
  the entry says so and waits for the person at `ready`, never landed unasked.
- **After landing**, the workspace offers Clean up as today (V18b). Landing does not clean up.

#### Into which branch

- **Merge into ▾**: the person picks the target from the repository's branches (local, and remote
  ones as a local branch of the same name). Preselected, in order: the branch the workspace
  started from (its record's `from`, V18), the Approve verdict's `into` (V17), then the default
  branch (`origin/HEAD`, else `main`, else `master`, as `defaultBranch` finds it today). An old
  project on `master`, or work merged into `develop` or a release branch, is the same path.
- The queue entry records its target. Everything above applies to any target: the merge worktree
  starts at its tip, landing fast-forwards it in the worktree that has it checked out, else
  `update-ref`. One merge at a time per repository, whatever the target, since two targets can be
  checked out in one checkout over time.
- `cpr merge <branch> [--into <target>]`.

#### Conflicts: a rule, then an agent

The rule was dropped (V26b, decision 164): every conflict goes to the merger agent.

- ~~**Keep both**~~ (no tokens): every conflicting file is text, and each region's ancestor side is
  empty. Two additions that share no lines (blank lines and lone brackets aside) are kept in
  parent order. Two equal additions are kept once. A `.json` file must still parse. Anything else
  is not resolved by the rule. The result goes to the check and then to the person (below).
- **The merger agent** for the rest, and for a clean merge whose check failed. A new session each
  time (Claude Code `--bg` or `codex exec`, as V18 and V20a start them) in the merge worktree, with
  the conflicts left in the files. Its prompt, made by CPR, holds only:
  - for each conflicting file, its regions with 3 lines around (not whole files);
  - the symbols both sides changed in those files, from CPR's own analysis of the two sides
    against their merge base (name, kind, what each side did);
  - each side's title and goal from its record, or its last commit subject: a line or two each;
  - the check command, and when it failed, the end of its output.

  It must resolve the markers, run the check, and stop. **Its instructions** (the "skill") are
  CPR's, written into that prompt, the same for Claude Code and Codex, and short (target: 1K
  tokens): edit only the listed files and only between markers; keep what both sides meant; never
  commit, push or switch branches; run the check; report one line per region; and when both sides
  cannot be kept, stop with "needs you" and why, never pick one. Not a Claude Code skill file in the
  repository: the workspaces' agents would load it too, and Codex does not read those. A project
  can add its own merge rules in `cpr/merge.md` (optional, short), which only the merger is given. It never commits, pushes, or touches
  another branch. Edits outside the merge worktree are denied (permission mode `acceptEdits`, the
  worktree its only folder; Codex `-s workspace-write`). CPR commits its result as the merge.
  `merge.model` picks the model (default: a smaller one, Claude Code `sonnet`; Codex its
  configuration's). `merge.agent` picks the agent (default: `agent.kind`).
- **A submodule pointer, a binary file, or a file deleted on one side** is not given to anyone:
  `needs-you`, with both sides named.

#### Reviewing a resolution (viewer)

- A resolved conflict (rule or agent) is `needs-you`. **Review** opens CPR's review of the merge
  commit against the first parent, as a branch review (V15). Only the symbols in the conflicting
  files are listed first. Approve → `ready` → landing. Request changes → the merger agent again
  with the person's comments added (a new session, the same small context plus the comments).
- A clean merge with a passing check needs no review: Approve was the yes.

#### Where it shows (viewer)

- Workspaces gets a **Merging** section above "Needs you", with one row per queue entry: branch,
  state, the check's time or its failure, and Review, Land, Retry or Remove. It is shown only
  while the queue has entries. A merger agent's thread and terminal open in the panel, as a
  workspace's do.
- **Merge** on an approved workspace (its panel) and on an approved branch review (the Review tab):
  "Merge into main" enters the queue. It is offered only when the verdict is Approve and the
  branch's tip is the approved commit.
- `cpr merge <branch>` does the same from a terminal and prints each state until landed or
  `needs-you`.

#### Agents' instructions

- `cpr/AGENTS.md` no longer tells an agent to merge on Approve. An approval is for CPR's merger.
  The branch's agent is not woken for it. A conflict found on the branch before the review (V17's
  merge check) is still the branch's agent's to fix.

#### Verification

1. **Tests first** (red before):
   - the queue's states and order;
   - a clean merge, its check passed and failed;
   - landing: a fast-forward in the checkout that has `into`, refused by local changes (nothing
     changes), `update-ref` when `into` is checked out nowhere, and `into` moved meanwhile
     (back to `queued`);
   - keep-both: this section's cases as fixtures (two journal entries; JSON keys; overlap
     refused; equal additions kept once; JSON that would not parse refused);
   - the agent's prompt from a fixture conflict (its regions, symbols, titles, the instructions,
     `cpr/merge.md` when there; nothing else), and the instructions' size (≤ 1K tokens);
   - the target: preselected from the workspace's `from`, then the verdict, then the default
     branch; a repository on `master`; a merge into a branch that is not the default, landed in
     the worktree that has it;
   - submodule and binary → `needs-you`;
   - `AGENTS.md`;
   - e2e: Merge, the Merging rows, the review of a resolution, Land.
2. **Replays**: the 11 conflicting merges here and Bitwarden's 21, replayed through the merger in
   throwaway clones. Rule: each resolution it makes equals what was committed, or differs only in
   order or extras. Agent (real Claude Code, `sonnet`): resolved or `needs-you` per conflict, the
   check's result, and tokens per run (input and output, from the session file).
3. **Tokens**: a merger run's input against the 66K–474K context of a workspace agent. Target:
   the median run under 20K tokens of input in all.
4. **Nothing else changes**: `cpr diff` output as `main`'s on this repository's last 5 merges; the
   existing e2e green.
5. **Real use**: two workspaces in a throwaway repository: one clean (merged, checked, landed in
   the checkout that has `main`, with an unrelated local change there), one conflicting (the
   agent, its review, landed).

**Risks**

| Risk | Mitigation |
|---|---|
| Moving `main` behind the person's checkout leaves it stale (its files no longer match its branch) | Never `update-ref` a checked-out branch: fast-forward in that checkout, which git refuses when it would overwrite. Tested with local changes |
| Keep-both is wrong when the two additions are the same thing written twice | Overlapping additions refused (5 of 12 measured); JSON must parse; the person reviews every resolution |
| The agent "resolves" by dropping one side | The person reviews only the conflicting files' symbols. The check runs first |
| A check that takes minutes holds the queue (this repository's check + build + e2e ≈ 2.5 min) | One merge at a time is the point: the next one must be checked on the result. Its time is shown; Remove takes an entry out |
| A project with no check command | Never landed unasked: `ready` waits for Land |
| Two `cpr view`s on one repository | The queue file is locked while a merge runs; the second shows the queue read-only |

**Order** (changed 2026-10-19): V26a (the clean path, landing, no agent) first: it is most merges
and fixes the main gap on its own. Then V26c (the merger agent, for every conflict), then V26b
only if the replays show the agent slow or wrong where both sides only added: keep-both applied
to 6 of 11 conflicts here but 1 of 21 on Bitwarden and 0 of 7 on Qwik, and every resolution is
reviewed either way. V26b was built after V26c, then dropped (decision 164).

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V26a | Merge, check, land | Merge into ▾ (any branch; preselected from the workspace's `from`, the verdict, the default branch), the queue, CPR's merge worktree, `--no-ff` merge of the approved commit, `merge.checks`, landing by fast-forward or `update-ref`, `merge.push`; Merge on an approved workspace or branch review; the Merging rows; `cpr merge`; `AGENTS.md` without merging |
| ~~V26b~~ | ~~Keep both~~ | Dropped (decision 164): every conflict goes to the merger agent. Was: the rule (empty ancestor, no shared lines, JSON parses), its result checked and reviewed |
| V26c | The merger agent | A fresh session from the conflict alone (regions, both sides' symbols, titles, check output; CPR's short instructions and `cpr/merge.md`), `merge.model`, `merge.agent`, confined to the worktree; its resolution reviewed; tokens per run measured |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 142 | Who merges | **CPR, and a fresh agent only for what needs judgement; never the workspace's agent** | The workspace's context is 66K–474K tokens and holds nothing a merge needs. A conflict is 0.6K–5.8K tokens |
| 143 | Where | **A merge worktree in CPR's cache** | The person's checkout may hold their work, and the workspace's worktree has its branch checked out |
| 144 | How `main` moves | **Fast-forward only: in the checkout that has it, else `update-ref` with the old value** | Never stale, never forced; git refuses rather than overwrite |
| 145 | Push | **Off by default (`merge.push`)** | Other projects may not want CPR to push. This repository turns it on |
| 146 | Clean merges | **No agent, no review: Approve was the yes** | Most merges are clean. A plain merge plus the check can be explained line by line |
| 147 | Conflicts | **Rule, then agent; every resolution reviewed before landing** (the rule dropped: decision 164) | Measured: the rule was right on 7 of 7 and refused 5. A wrong merge costs more trust than a slow one |
| 148 | The agent's model | **`merge.model`, default `sonnet`** | Resolving a few regions with their symbols needs less than building a feature; the person can raise it |
| 149 | Into which branch | **Any, picked at Merge; preselected: the workspace's `from`, the verdict's `into`, the default branch** | Old projects use `master`, others `develop` or release branches. Work goes back where it started from |
| 150 | The merger's skill | **Light: ~1K tokens of CPR's own instructions in its prompt, plus an optional `cpr/merge.md`** | What a conflict needs is assembled per conflict. A heavy skill would be read on every run, which is the cost V26 removes. A skill file in the repository would reach the workspaces' agents too, and Codex does not read it |

#### V26a as built

What differs from the plan, and why:

- **The git steps are in core** (`git/merging.ts`: reset the merge worktree, merge, fast-forward,
  push), the queue in the CLI (`merges.ts`), as `worktrees.ts` and `workspaces.ts` split them.
- **The merge worktree keeps ignored files** between merges (`git clean -d` without `-x`):
  installed dependencies stay, so a check does not start from nothing each time. It does not link
  the main checkout's `node_modules` as `cpr diff`'s worktrees do. pnpm's workspace links would
  resolve into the main checkout, and the check would test the wrong code.
- **A check guessed from `package.json` runs its package manager's install first** (`pnpm
  install`, then `pnpm run check`). Without it, the first merge of every JS project fails on
  missing dependencies. `merge.checks` replaces both.
- **A conflict is `needs-you` with its paths**, and the merge is aborted. Until V26b/V26c resolve
  conflicts, Retry merges again once the branch is fixed and approved again.
- **A merge waiting at `ready` holds later merges into the same branch.** They would be merged on
  a tip that is about to move, then merged again. A conflict or a failure holds nothing.
- **The queue follows other processes**: listing it merges what is queued, so a `cpr merge` in a
  terminal is merged by a `cpr view` that is open, or by itself. While one process merges, the
  other's `cpr merge` follows the entry through the queue file.
- **The approval's text** (Copy for the agent, Send the verdict) says CPR merges it and the agent
  should not. `cpr/AGENTS.md` loses "Approved in a linked worktree". Its conflict section keeps the
  branch's agent resolving on the branch.
- **This repository's `cpr/config.json`** sets `merge.checks` (install, check, build, e2e) and
  `merge.push: true` (decision 145).

**V26a results**: 831 unit tests, 115 e2e. `cpr diff` unchanged on the last 5 merges. A real
merge of this branch in a clone of this repository: merged and checked (install, check, build,
e2e) in 188 s; the landing refused by an untracked file the merge brings, with nothing changed;
landed in 278 ms once it was removed, a local change kept. Found that way: `merge.push` was read
after landing, from the config the landing brought; it is read before now.

#### V26c as planned (2026-10-19)

Measured first: a Claude Code `-p` run with CPR's own system prompt (`--system-prompt`), tools
limited and no MCP servers took 2,349 input tokens and 2.9 s for a one-line answer (`sonnet`).
Claude Code's Edit needs the file read first: for this repository's `JOURNAL.md` (3,000+ lines)
that is ~100K tokens, the cost V26 is to remove.

- **The agent writes no file.** It is given the conflict and answers, for each numbered region,
  the text that replaces it (or "needs you" and why), as JSON in its last message. CPR writes each
  answer between that region's markers, checks no markers are left, commits the merge (its
  message `Merge <branch>: <title>`), and runs the check. Read-only tools only: Claude Code
  `--tools Read,Grep,Glob` (it may look at a file when the region is not enough), Codex `-s
  read-only`. One run, `claude -p` or `codex exec`, waited for: no session to follow, and its
  usage comes with its answer.
- **Its prompt**: CPR's instructions (≤ 1K tokens, the system prompt for Claude Code), then
  `cpr/merge.md` when there, both sides' titles (the workspace's title and goal, else the last
  commit subjects), and each region in git's diff3 style (ours, the ancestor, theirs) with 3
  lines around. The symbols both sides changed in the conflicting files, by CPR's analysis of
  each side against the merge base, limited to those files.
- **Not given to anyone**: a file deleted on one side, a submodule pointer, a binary file:
  `needs-you`, as before.
- **The review is the regions.** A resolved merge waits at `needs-you` with each region: the two
  sides, the ancestor, and the answer, plus the check's result. Approve → `ready` → landed.
  Request changes → a new run with the person's words and the earlier answer.
- **A clean merge whose check failed** stays `failed` (not given to the agent): there is no region
  to answer, and the fix belongs on the branch.

| # | Question | Decision | Why |
|---|---|---|---|
| 151 | How the agent changes files | **It does not: it answers each region's text, CPR writes it** | Edit would read whole files (~100K tokens for this repository's journal); the answer is confined by construction; the review is region by region |
| 152 | Which run | **One `claude -p` / `codex exec` run, waited for, read-only tools** | Bounded, its usage in its answer; nothing to attach to or clean up |
| 153 | A failed check after a clean merge | **`failed`, not the agent's** | No region to answer: what fails is the branch's code, fixed on the branch and reviewed again |
| 164 | V26b, keep both by rule | **Dropped: every conflict goes to the merger agent** | Asked ("Remove this feature from the plan … any conflict should be resolved by the agent", 2026-10-20), after V26b was built and tried on real merges. In the replays the rule was right where it applied, but a rule cannot see meaning: run file by file, it would have kept two `PLAN.md` rows that both claim V21 (CPR `01161fa2f`; the agent stopped and asked) and a changelog's entries twice under two headings (vite `67a8f8022`); each guard added for such a case is another rule to explain. The agent sees what both sides were for. Branch `milestone/v26b-keep-both` deleted |

**V26c results**: 852 unit tests, 117 e2e. This repository's 11 conflicting merges replayed with
the real Claude Code (`sonnet`): 5 equal to what was committed, 1 equal but for indentation, 1
equal in the regions (its note flagged the test the committed merge also changed), 1 both kept
in the other order, **2 wrong** (lines kept twice; a replaced paragraph kept and a duplicate ID),
1 "needs you", rightly. Input tokens: median 10.0K (5.5K–59K), 7–49 s a run. Both wrong ones
duplicate text: a duplicate-lines warning on the review is the next precision step; keep-both
by rule (V26b) would have refused both (additions that share lines; an edit of the same lines).

**Not in V26 (later)**: a duplicate-lines warning on a resolution's review (both wrong answers in the replays kept text twice); Bitwarden's and Qwik's conflicts replayed; Codex as the merger with a real Codex; several merges at once (each on its own worktree), squash or rebase merges
(`merge.style`), resolving submodule pointers, lockfiles regenerated instead of merged (none
conflicted in the merges measured).

### V27 — Codex in the panel's terminal, through its app server

**Status:** V27a and V27b merged into main (2026-10-20, from branch `milestone/v27-codex-terminal`).
As built and results: "As built (V27a)" and "As built (V27b)" below.

**Problem** (asked: "Why codex can't run in terminal?" … "Think of a way to make it work … try
codex agents, run a spike"). V20a runs Codex as `codex exec` through CPR's runner, which records
its thread from Codex's output. A Codex workspace has no terminal tab (decision 133): `codex
resume` in a terminal would not reach that thread, and V20a's resume lost the sandbox's writable
roots, so it could not commit in the worktree. Codex workspaces also never say "needs you"
(decision 131). Measured in the V27 spike (Codex 0.163.0, the latest):

| What | Measured |
|---|---|
| CPR as a client of an app server: `thread/start` in the worktree, the branch's git folders writable, `turn/start` | committed in the linked worktree, 4.2 s for the turn |
| A turn typed in `codex resume <thread> --remote unix://…` (the TUI joined to that thread) | reached CPR's client, every item, 3.0 s; committed from the sandbox |
| A turn CPR starts while the TUI is open | drawn in the TUI 0.9 s after `turn/start` |
| CPR's client gone mid-turn, a new one later | the turn finished; `thread/read` gave all 4 turns back with their items and times |
| An approval (`approvalPolicy: on-request`) | `waitingOnApproval` on the thread's status; Codex's own prompt in a TUI that joined later; answered from CPR, resolved for all |
| Trust | "Trust this folder?" once per worktree in the TUI; `-c projects…` ignored |
| The app server's memory | 269 MB for a private one; the person's daemon (212 MB) already runs |

**Goal**: a Codex workspace's panel gets a terminal, as Claude Code's has: Codex's own TUI on
the workspace's thread, and what is typed there in the thread CPR shows. Its state says "needs
you" when Codex waits for an approval. Unchanged: Claude Code workspaces; a Codex workspace when
no app server can be reached (V20a's `exec`, as today).

#### Design

- **Codex workspaces run on the person's app-server daemon**: its socket from `codex app-server
  daemon version` (started with `daemon start` when it is not running). It is theirs already, it
  keeps threads running when `cpr view` stops, and `codex agents` lists CPR's workspaces with
  their other sessions.
- **CPR is a client** over WebSocket on that unix socket: its own small client (the HTTP upgrade,
  text frames, ping), no new dependency. `initialize`, then per workspace:
  - start: `thread/start` (the worktree, `workspace-write`, the branch's git folders as writable
    roots as V20a gives them, `approvalPolicy: on-request`), `turn/start` with the prompt;
  - a reply from the box: `turn/start`, or `turn/steer` while a turn runs (no stop, no lost turn);
  - stop: `turn/interrupt`;
  - its thread: `thread/read` with `includeTurns` (items as V18c's thread entries), and the
    notifications while connected; no runner and no thread file for these workspaces.
- **State** from the thread's status: `active` → working; `active` + `waitingOnApproval` →
  needs you; `idle` → ready or done (V20a's rule on commits); a failed turn → failed.
- **The terminal tab**: `codex resume <thread> --remote unix://<socket> -C <worktree>` under
  CPR's terminals (node-pty), as `claude attach` is for Claude Code. The first time in a
  worktree, Codex asks to trust it: the person answers there.
- **Approvals** are answered in the terminal, Codex's own prompt. Answering them with CPR's own
  controls was V20b, dropped (decision 163).
- **A workspace started by V20a** (`exec`) keeps V20a's path until it is started again.

#### Verification

1. Tests first: the WebSocket client (handshake, frames in both directions, ping, a fragmented
   message, close) against a fake server; the thread from `thread/read`; the state from status
   and turns; the terminal's command; the fallback to `exec` without a daemon.
2. A fake app server for e2e (a WebSocket server on a unix socket), answering as the spike's
   logs show: Codex's terminal tab, a turn there in the thread, "needs you".
3. Real use with the person's daemon: a workspace started, a turn typed in its terminal and in
   the box, an approval answered in the terminal, `cpr view` restarted mid-turn.

**Risks**

| Risk | Mitigation |
|---|---|
| The app server is `[experimental]`: its protocol may change between Codex versions | The version from `initialize`; methods checked against `generate-ts` per version; V20a's `exec` when a call fails |
| The daemon restarts (an update "may interrupt running work") | Threads are on disk: `thread/resume` after a reconnect; the state says what happened |
| The daemon is the person's: CPR's threads sit among theirs | Named after the workspace (`thread/name/set`), archived at Clean up as V20a does |
| The trust prompt in every new worktree | Said in the panel before the terminal opens; the person decides |

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V27a ✅ | CPR on Codex's app server | The client, start, reply, stop and the thread through the daemon; "needs you"; `exec` when no daemon |
| V27b ✅ | Codex's terminal | The terminal tab for Codex workspaces (`codex resume --remote`), the trust note |

**Decisions** (154 and 155 as built in V27a, 156 for V27b; 157 and 158 made while building V27a):

| # | Question | Decision | Why |
|---|---|---|---|
| 154 | Which app server | **The person's daemon, started when it is not running** | Threads outlive `cpr view`; `codex agents` shows them; no second 270 MB process |
| 155 | Where a Codex thread comes from | **`thread/read` and the server's events; no runner, no thread file** | The server keeps every turn, from any client (4 of 4 read back after a reconnect) |
| 156 | Trust | **The person answers Codex's prompt in the terminal** | It writes their config; `-c` cannot set it, and CPR should not decide it |
| 157 | A thread's options when CPR continues it | **None: a bare `thread/resume`; the sandbox, writable roots, approvals and folder are the server's** | The server keeps them with the thread: a bare resume after a restart gave all four back (measured). Passing them again would undo what the person set in Codex's terminal. V20a passed them on every run because `exec resume` kept none |
| 158 | A start the server does not finish | **Unreachable: `exec`, as without a daemon. An answer: the start failed in its words, and a thread it made is kept for Clean up. The thread's name never fails a start** | A second thread beside one already running would be two agents on one branch. In the real run Codex refused the name while the thread's rollout was empty, after its turn had started |

#### As built (V27a)

- **A connection per call, no thread kept subscribed.** The plan read the thread "and the
  notifications while connected". A connection that started or resumed a thread gets every delta
  of its turns, and one that did not gets only status changes (probed). So each call opens the
  socket, introduces CPR (`initialize`), asks, and closes. A start or a message waits on its own
  connection for the message's `item/completed` (3 s at most) so the page shows it at once: V20a's
  lesson, 5.3 s to the next read without it.
- **The daemon is found with `codex app-server daemon start`** alone, not `daemon version` then
  `start`: it is idempotent (`alreadyRunning`), 57 ms when it runs and 1.25 s from cold (measured
  in a throwaway `CODEX_HOME`), and its last line is JSON with `socketPath`. A call whose socket
  does not answer starts the daemon again once and asks once more. No daemon: asked again a minute
  later, and `exec` meanwhile.
- **Writable roots go in `config.sandbox_workspace_write.writable_roots`** on `thread/start`
  (`sandbox` takes only a mode). Continuing a thread passes no options (decision 157).
- **Two reads.** The list reads the last two turns with `itemsView: "summary"`, each turn's first
  message and final answer: 4–5 ms per Codex workspace on the person's daemon. The panel reads 50
  turns in full, with every message (steered ones too) and Codex's commentary: 10 ms. Not
  `thread/read` with `includeTurns`, which Codex 0.163 calls deprecated for paginated threads.
- **"Needs you" comes from the thread's status only.** The pending approval is not an item (it
  appears once accepted) and goes only to subscribed clients. The panel shows what Codex said
  before asking, when it said something: in the real run it asked with no message, only
  reasoning. The words are "approval prompt" and "question", read after "Waiting:" as Claude
  Code's "permission prompt" is.
- **A message while Codex works joins its turn** (`turn/steer`): the box says Send, not "Stop and
  send". To a turn waiting on an approval, a message stops it first, after asking, as for Claude
  Code. The server answers 409 without `stop`.
- **Start again makes a new thread**, as V20a made a new run. The record keeps the current
  `thread` and the earlier ones in `threads`. Clean up interrupts a running turn and archives
  them all with `thread/archive`, else `codex archive`. The panel shows the current thread only.
- **The thread's name is set after the prompt is in** and never fails the start (decision 158).
  In the real run, Start again failed on `thread/name/set` ("rollout … is empty") while its turn
  was already running, and the old code lost that thread. The fake server now refuses a name
  until the thread has an item.
- **A turn typed outside the page shows when the page is focused again**, as with `claude attach`:
  the list is read every 5 s only while an agent works or waits. V21's terminal in the panel has
  the same gap for Claude Code (its e2e passes only because its fake agent stays "working"); V27b
  closes it for both (decision 161).
- **Talk** copies `codex resume <thread> --remote unix://<socket> -C <worktree>`, without V20a's
  note that its turns are not recorded. `codex resume` takes `--remote` with `-C`; checked in its
  help, not run (it asks to trust each new worktree, which writes the person's config: V27b).
- **The e2e fake app server runs in Playwright's process**: the unit tests' fake
  (`packages/cli/test/fake-app-server.ts`), imported as `forge/test/mock-api.ts` already is. The
  fake `codex` names its socket on `app-server daemon start` only then, so V20a's specs keep
  testing `exec`.

**Results (V27a).** Tests first, red before: the WebSocket client 6 (against a fake server: frames
of every length, fragments with pings between, bytes cut mid-header, close both ways, a refused
upgrade, no answer), the app-server client and operations 9, discovery, entries and state 11, the
service 8, viewer 2, e2e 2. 888 unit tests (852 on `main`), 119 of 119 e2e, V20a's three Codex
specs unchanged. With the real Codex 0.163 on the person's daemon, through `cpr view` in Chromium,
in a throwaway repository outside `/tmp` (where `workspace-write` writes freely): started in 1.82 s
(the worktree, `daemon start`, `thread/start`, the prompt in); a message sent while it worked
joined its turn and showed in the thread 0.79 s after Send; Codex committed on its branch in the
linked worktree from its sandbox (`338aa87`, the steered comment in it), ready for review 12.7 s
later. `cpr view` stopped 3 s into a 15 s turn and started again: the workspace read "working"
at once, and the turn finished without CPR ("slept", 13.3 s). An approval: "Waiting: approval
prompt" 2.2 s after the message, then "Stop it and send" interrupted it and the next turn answered
in 1.9 s. Stop 0.36 s. Start again: a new thread, named after the branch, 1.6 s. `GET
/api/workspaces` 19–26 ms with that workspace; its thread 9–10 ms. Clean up archived all three
threads on the daemon (one by hand: the thread the failed start lost, before the fix). Screenshots
light and dark at 1440, 900 and 390 px, no page errors; at 390 px the header's help wraps into a
narrow column, as on `main`. Not verified: a turn typed in Codex's own terminal against the real
daemon (the fake's, and the V27 spike's, only), an approval answered there, a daemon restarted
during a turn (the fake's restart only), macOS and Windows. (The V27b spike since verified the
first two, and found that this Stop leaves the turn's commands running: decision 159.)

#### V27b — Codex's terminal

**Problem** (measured in the V27b spike, below; Codex 0.163.0, the person's daemon, `codex resume
<thread> --remote unix://… -C <worktree>` in node-pty):

| What | Measured |
|---|---|
| The TUI joined to a thread CPR started | first output 49 ms; CPR's turns drawn; 266 MB for Codex + 49 MB for its Node wrapper (Claude Code's `attach`: 140 MB) |
| Trust | asked for the worktree although `thread/start` had just made Codex trust the repository: "Trust this folder? … Your trust decision will be saved", **1. Trust and continue · 2. Back to Agent Command Center**; no way on without trusting |
| A writable sandbox and trust | `thread/start` with `workspace-write` (as `sandbox` or in `config`) and `codex exec -s workspace-write` (V20a) each write `trust_level = "trusted"` for the repository's root into the person's `~/.codex/config.toml`, unasked (4 of 4; without it, none and a read-only sandbox) |
| A turn typed in the TUI | in CPR's read 111 ms after Enter; an Enter in the same write as the text is not a submit (Codex's paste-burst rule); a line written alone stays in its input as plain text |
| An approval CPR's turn asked | drawn as Codex's prompt (y · p · esc); `y` there: CPR's read lost "approval" 65 ms later, the turn finished in 0.85 s |
| Esc, Ctrl+C, a hang-up | Esc interrupts the turn; Ctrl+C clears the input, on an empty one quits the client ("Any running work continues"), exit 0; SIGHUP: exit 0, the thread unchanged |
| **CPR's Stop (V27a)** | **the interrupted turn's command runs on** as a Codex background terminal (`sleep 45` still running 18 s after Stop); `thread/backgroundTerminals/clean` (experimental) ended it in 7 ms |
| The list after a turn typed in the panel's terminal | not read until the page is focused again, for Claude Code too (V21) |

**Goal**: a Codex workspace on the app server gets V21's Terminal tab, Codex's own TUI on its
thread, and the panel opens on it. Its approvals are answered there; what is typed there is in the
thread; the state follows while the terminal is open. Stop ends the turn and its commands. The
trust Codex asks for, and the one it records on its own, are said, not decided. Unchanged: V20a's
`exec` workspaces (Talk, no terminal); Claude Code's terminal, except that the list is read while
it is open.

**Design**:
- **The terminal**: `POST /api/workspaces/terminal` for a Codex workspace on the server opens
  `codex resume <thread> --remote <address> -C <worktree>` under CPR's terminals (V21), Codex as
  found (`CPR_CODEX`, else `codex` on PATH). A V20a workspace is still refused (Talk). Joining a
  stopped thread starts nothing, so V21's "continues the stopped session" is not asked for Codex.
- **Trust**: the answer says `trusted: false` when Codex's configuration, read from the server
  (`config/read`, its `projects`), has no entry for the worktree or a folder above it; the panel
  then says, above the terminal, that Codex asks whether to trust the worktree and saves the
  answer in the person's Codex configuration. CPR never answers it (decision 156).
- **Stop** interrupts the turn, then cleans the thread's background terminals (a connection that
  declares `experimentalApi`); if Codex refuses that method, the turn is still interrupted. Clean
  up does the same before it archives.
- **The list is read every 5 s while a terminal is open** in the panel, for both agents.
- **The panel**: the Terminal and Thread tabs as for Claude Code; the reply box hidden while a
  terminal can run; the hint "? in an empty prompt lists Codex's keys". Terminals stay four at
  most (each Codex one about 315 MB, said in the README).
- **Saying what Codex records**: README, and the start dialog's sandbox tooltip: starting Codex
  makes Codex mark the repository trusted in the person's Codex configuration (its rule for a
  writable sandbox), since V20a.

**Verification**: tests first — the terminal's command and refusals (V20a workspaces, no
terminals), `trusted` from `config/read` (exact entry, a folder above, none), Stop cleaning
background terminals and surviving a refusal of that method, the list read while a terminal is
open; e2e: the Codex Terminal tab on a fake TUI (keys reach it, the trust note, Thread read only,
reopen after it ends), the state following a turn typed there. Real use: the person's daemon
through `cpr view` in Chromium — the trust prompt answered in the panel, a turn typed, an approval
answered, Stop ending a running command; screenshots; everything removed, trust entries too.

**Risks**

| Risk | Mitigation |
|---|---|
| `thread/backgroundTerminals/clean` is experimental | Asked on its own connection; a refusal leaves V27a's Stop (the turn interrupted) |
| Codex's trust rule is per worktree folder, and each new workspace asks again | Said in the panel each time Codex will ask; the person decides (decision 156) |
| 315 MB per Codex terminal | Four terminals at most, the oldest unread one hung up first (V21) |
| Codex's TUI draws its own colors | CPR's dark terminal theme, as Claude Code's |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 159 | What Stop ends for Codex on the app server | **The turn (`turn/interrupt`), then its commands (`thread/backgroundTerminals/clean`)** | An interrupted turn's command ran on (18 s after Stop, measured); V20a's Stop ended the process group, and a Stop that leaves a test run or a server going is not a stop |
| 160 | When the panel speaks of trust | **When Codex's configuration has no entry for the worktree or a folder above it** | Codex asks per worktree and has no untrusted way on; the note never says Codex will ask when it will not |
| 161 | The list while a terminal is open | **Read every 5 s, for both agents** | A turn typed in the panel's terminal after "Plan ready" showed only on focus (V21 too) |
| 162 | The trust Codex records on its own | **Said in the README and the start dialog; not avoided** | Any writable sandbox makes Codex trust the repository (4 of 4 calls); there is no writable sandbox without it |

#### As built (V27b)

- **The trust note goes with the first key in the terminal.** Planned for as long as the terminal
  is open; in the real run it still stood above an approval, after the person had trusted the
  worktree. Codex's question is the first thing its terminal shows, and any key answers it
  (Enter trusts, Esc goes back to its agents' list).
- **Stop** interrupts the turn, then cleans the thread's background terminals on a connection of
  its own that opts into experimental methods; Clean up does the same before archiving. A Codex
  without the method answers -32600, and the turn is still interrupted (a test of the fake, which
  answers as Codex 0.163 does without the opt-in).
- **The e2e's fake Codex TUI** is the fake `codex` with `resume … --remote`: it reads trust with
  `config/read`, asks as Codex does, trusts through a fake-only method, and gives each line to the
  thread through CPR's built client. Its first version used single backslashes in the template
  literal: the generated script did not run, and CPR fell back to `exec` without a word (V21's
  trap again; a syntax check must interpret the template's escapes, or it passes).
- **A line typed faster than a person types is not sent by an Enter right after it**: Codex reads
  the run as a paste. Typed at 60 ms a key, the turn was in the thread 128 ms after Enter; with no
  delay at all (Playwright's default), the Enter right after was not taken, a second was. CPR
  types no Enter itself (decision 114), so only automation meets it.
- **Opening a workspace's page again while its terminal runs** briefly gives two TUIs on the
  thread (the old page's is hung up when it goes, else after V21's 10 s grace): measured both
  gone once the tab was left.
- **Found, not fixed here**: at 390 px the panel with a terminal makes the page 670 px wide
  (the terminal box 588 px), for Claude Code and Codex alike: V21's, on `main`. Proposed as
  `fix/terminal-narrow`.

**Results (V27b).** Tests first, red before: the client 2 (Stop cleaning, trust entries), when
Codex will ask 2, the service's terminal 2, the panel 3, the reads while a terminal is open 2, e2e
1 (red without the held reads, at "Working"; red without the note going on the first key). 899
unit tests (852 on `main`), 120 of 120 e2e. With the real Codex 0.163 on the person's daemon
through `cpr view` in Chromium: the panel opened on Codex's terminal with the note, Codex asked
to trust the worktree 0.29 s after the page opened, Enter there trusted it and the TUI drew the
thread (100 MB for Codex and 50 MB for its Node wrapper at first); Codex committed on its branch
(`8dbda4a`, 15 s); a turn typed at a person's pace in the thread 128 ms after Enter; an approval
read "needs you" 1.8 s after the message, `y` in the panel's terminal cleared it in 22 ms, and
the command ran ("HTTP/2 200"); the Thread tab read only, the TUI hung up once the tab was left.
Stop with `sleep 62` running: 45 ms for `POST /api/workspaces/stop`, the command ended (the
driver's 4.06 s for the same in the page was Playwright waiting on the button). Screenshots light
and dark at 1440 and 390 px; no page errors. Everything made was removed: 5 threads archived,
the repositories deleted, and the trust entries the runs wrote taken out of the person's Codex
configuration (it reads as before the runs). Not verified: a daemon restarted under an open
terminal, two people's TUIs on one thread, macOS and Windows.

### V28 — Every agent's prompts in the project's settings

**Status:** V28a and V28b built (2026-10-20), on branch `milestone/v28-agent-prompts`; not
merged. As built and results: "As built (V28a)" and "As built (V28b)" below.

**Problem** (asked: "We need a settings page where you can extend the predefined agents with more
specific things for it"; then "Every meta prompt of every agent should be configurable, with the
defaults set as current. Can be saved in config.json"; the changes shared with everyone, only the
agents' prompts at first). CPR writes every word its agents are told, and a project can change
none of them. Measured on `main` (`eadc0ce`, 2026-10-20):

| What CPR tells an agent | Where | Size | A project can change it today |
|---|---|---|---|
| A workspace's start prompt, one per kind (Feature, Fix, Refactor, Chore, Spike) | `workspacePrompt` and `KINDS[kind].line` (`workspaces.ts`) | 654–840 characters besides the brief, 12–14 lines | No. `agent.kind`, `agent.model` and `agent.permissionMode` choose the agent, not its words |
| Plan first or not: one of two sentences in every start prompt | `workspacePrompt` | 132 and 69 characters | No |
| A verdict for a branch's agent: approved with a target, approved to push, changes or comments, where the review is | `verdictText` (`reviews.ts`) | 4 sentences around the person's comments | No |
| The review instructions, `cpr/AGENTS.md` | `AGENTS` (`reviews.ts`) | 2,935 characters, 62 lines | No. CPR rewrites the file when its text differs, and the file sends the project's rules to its own CLAUDE.md or AGENTS.md |
| The merger's instructions, its system prompt | `MERGER_INSTRUCTIONS` (`merge-agent.ts`) | 1,410 characters, 16 lines | Only adds: `cpr/merge.md` goes into the prompt after the sides' titles (git-ignored until `fix/merge-md-shared`) |

So 0 of these 13 texts can be changed. What a project would change is not measured: of the 5
workspace sessions on this machine (16 messages from the person), one corrected how the agent
worked ("ask for my permission to do something, but don't do it", started before Plan first
existed); the rest were answers, "continue", and merges that V26 now makes. One disagreement is
in this repository: the Spike prompt says "Commit nothing unless the brief asks for it" and
"keep experiments out of the project's code", while its CLAUDE.md keeps experiments in `spikes/`
and ends every session "with everything pushed".

Writing the setting is measured: `cpr/config.json` is the project's file and its formatter's.
Prettier checks it in this repository, and a `JSON.stringify` rewrite turns its one-line
`merge.checks` into 6 lines, which fails `pnpm check`. `jsonc-parser` 3.3.1's `modify` changes
only the member it sets; removing that member gives back the file byte for byte.

**Goal**: a Settings page in `cpr view`, beside Workspaces and History, lists every agent's
prompts: the start prompt of each kind, the two plan sentences, the verdict's sentences, the
review instructions and the merger's instructions. Each shows CPR's text until it is changed. A
change is saved under `prompts` in `cpr/config.json`, which the project commits to share; Reset
removes the key, so CPR's text applies again, a later version's too. Agents started, conflicts
sent to the merger and `cpr/AGENTS.md` written after a save use it. Unchanged: with no `prompts`,
every prompt is today's byte for byte (one case aside, decision 171); config.json's other keys
and formatting; the start dialog; and the data in a prompt (the brief, conflict regions, comments).

#### The prompts and their placeholders

| Key in `prompts` | What | Placeholders |
|---|---|---|
| `start.feature`, `start.fix`, `start.refactor`, `start.chore`, `start.spike` | A workspace's start prompt for that kind | `{branch}`, `{start}` (`main at abc1234`, or `the commit abc1234`), `{brief}` (required), `{plan}`, `{into}`, `{record}`, `{reviews}`, `{agents}`, `{cpr}` |
| `plan.first`, `plan.direct` | What `{plan}` becomes with Plan first, and without | none |
| `verdict.approve`, `verdict.push`, `verdict.address`, `verdict.where` | A verdict's sentences: approved with a target, approved to push (no target), changes requested or comments, where the review is | `{branch}`, `{at}`, `{into}`; `{reviewer}`, `{what}`; `{review}`, `{agents}` |
| `reviews` | `cpr/AGENTS.md` | none |
| `merger` | The merger's instructions | none |

- Each default is today's text with today's values as placeholders. One start prompt per kind,
  its kind's line written in, not a frame plus a line: the page shows what that agent is told,
  whole, and changing the Fix prompt cannot change the Spike's.
- Only the names listed for a prompt are replaced; any other brace is text (the merger's
  instructions show JSON).
- **The merger's answer format stays CPR's** (decision 169): the last paragraph of today's
  instructions ("Answer with one JSON object …") is appended after `merger`, so the default gives
  today's system prompt, and the page shows it read-only. `cpr/merge.md` is read as today.
- What stays data: the brief and its parts, the conflict regions and symbols, the "asked again"
  words, the verdict's summary and comments, the `about` lines in records.

#### Storage: `prompts` in `cpr/config.json`

```json
{
  "prompts": {
    "start": {
      "spike": [
        "You are starting a new spike in this repository, on the branch {branch}, started from {start}. This folder is a git worktree of its own with that branch checked out: work only here.",
        "",
        "The person's brief:",
        "",
        "{brief}"
      ]
    },
    "verdict": {
      "approve": "Approved the branch {branch} at {at}: CPR merges {at} into {into}; do not merge it yourself."
    }
  }
}
```

- A prompt is a string, or an array of lines joined with `\n`. CPR writes a one-line prompt as a
  string and a longer one as lines, so git diffs and CPR reviews it line by line; as one string,
  any change would be one changed line of ~800 characters.
- Read where the other keys are (`cpr/config.json`, else `cpr.config.json`), at each use: a save
  applies at once, committed or not, as `.cprignore` does. Shared once committed: `config.json` is
  the one file `cpr/.gitignore` lets through.
- Written with `jsonc-parser`'s `modify` and `applyEdits`, only `prompts.<key>`. An emptied
  `start`, `plan`, `verdict` or `prompts` is removed; a text equal to CPR's is saved as no key;
  with neither file, `cpr/config.json` is created. New runtime dependency of `@cpr/cli`: MIT, no
  dependencies of its own, 112 KB of ESM. The reason is the file's formatting, measured above.
- A hand-edited value that is not text, or a start prompt without `{brief}`: CPR's text is used,
  and the page says why (decision 170).

#### Server

- `GET /api/settings/prompts`, in Workspaces mode only, like `/api/workspaces…`: the config
  file's path, a `version` (a hash of its text), its git state (committed, changed, new, none),
  and per prompt its key, agent, title, purpose, the text in use, CPR's text, whether it is
  changed, the placeholders and what each means, its limit, a warning when the file's value is
  not used, and, for the merger, the answer format CPR adds.
- `PUT /api/settings/prompts/<key>` with `{ text: string | null, version }`. `null`, or CPR's
  text, removes the key. 409 when the file changed since `version`; 400 for an unknown key, a
  missing required placeholder, or a text over the limit.
- Limits: a start prompt 8,000 characters (it goes on the agent's command line with a brief of up
  to 20,000, and Windows takes 32,767); a verdict sentence 1,000; `reviews` and `merger` 20,000.
- One reader, `promptsOf(root)`, for every use: Claude Code's `--bg` start, Codex's `exec` and app
  server start, "Copy the prompt", the merger (Claude Code's `--system-prompt`, Codex's stdin),
  `prepareCprFolder` (`AGENTS.md`) and `verdictText`.

#### Viewer

- A third tab, Settings, at `/settings` (`pages.ts`, `PageTabs.tsx`).
- On the left, the agents and their prompts: Workspaces (Feature, Fix, Refactor, Chore, Spike,
  Plan first, Plan without), Reviews (the verdict's sentences, `cpr/AGENTS.md`) and Merger; a
  mark on each changed one.
- On the right, the prompt in a monospace text area; its placeholders, each with what it means;
  "CPR's" or "Changed"; Save, and Reset to CPR's. Under Save, what saving does:
  "Saved in cpr/config.json, not committed: commit it to share it with everyone who uses this
  repository." Characters and about how many tokens. For the merger, the answer format CPR adds,
  read-only.
- An unsaved edit is kept while another prompt is open; leaving the page with one asks first.

#### Verification

1. **Tests first**: with no `prompts`, each start prompt equals today's for 5 kinds × Plan first
   or not × a default branch or none, against strings recorded from `main` before the change; the
   merger's system prompt (Claude Code and Codex), `AGENTS.md` and each kind of verdict text equal
   today's. Each configured prompt replaces its default, placeholders filled and other braces
   left. A value that is not text, and a start prompt without `{brief}`, give CPR's text and a
   warning. Writing: this repository's `config.json` with a prompt set, then reset, is the file
   it was byte for byte; a stale version gets 409; the limits hold; a one-line prompt is written
   as a string and a longer one as lines.
2. **E2E** (`settings.spec.ts`, with `serveWorkspaces`' fake agent): the tab; Fix changed and
   saved, then a Fix workspace's "Copy the prompt" has the change; Reset; a save from another tab
   gives "changed since you opened it"; an unsaved edit kept across prompts; no page errors.
3. **Real agents**: a Spike started with a changed Spike prompt (commit the experiment under
   `spikes/`) in a throwaway repository with the real Claude Code, which follows it; the merger
   with changed instructions on one of V26c's replays; a Codex start through the app server with
   a changed prompt.
4. **viewer-check**: the page at 1440 × 900 and 390 × 844, light and dark.
5. **Nothing else changes**: unit and e2e tests as on `main`. No analysis code changes, so no
   regression-check.

**Risks**

| Risk | Mitigation |
|---|---|
| A changed prompt loses what the agent needs (its brief, its branch) | `{brief}` is required; the page lists the placeholders; Reset |
| A changed merger prompt answers in a form CPR cannot read | The answer format is CPR's and always appended (decision 169) |
| A project's changed prompt misses CPR's later rewording | Only changed prompts are stored; the page shows CPR's text beside the project's |
| The project's formatter disagrees with what CPR writes inside `prompts` | Outside `prompts` the file is unchanged byte for byte; arrays of long lines are what Prettier writes too (checked here) |
| A long merger prompt costs tokens on every conflict | Characters and tokens shown under each prompt; the limits |

**Order**: V28a first (the prompts read from and written to config.json, the server), then V28b
(the page).

#### Milestones

| # | Milestone | Output |
|---|---|---|
| V28a ✅ | Prompts from config.json | The 13 prompts as defaults with placeholders; `promptsOf`; every use reads it; writing with `jsonc-parser`; `GET`/`PUT /api/settings/prompts`; README's config table |
| V28b ✅ | The Settings page | `/settings`, the tab, the list, the editor, Save, Reset, the git state, e2e and screenshots |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 165 | Where a project's prompts are kept | **`prompts` in `cpr/config.json`, only the changed ones** | The user's choice. Shared once committed (the one file `cpr/.gitignore` lets through); a missing key keeps CPR's text, and a later version's |
| 166 | What can be changed | **Each prompt whole, with placeholders; one start prompt per kind** | "Every meta prompt … configurable, with the defaults set as current": additions after CPR's text could not change CPR's words, as this repository's Spike rule needs |
| 167 | How config.json is written | **`jsonc-parser`'s `modify`: only `prompts.<key>` changes** | A `JSON.stringify` rewrite changed this repository's `merge.checks` line and failed its `pnpm check`; `modify` and its removal give the file back byte for byte |
| 168 | A prompt's form in the file | **One line, a string; more, an array of lines** | Git diffs and CPR reviews it line by line |
| 169 | The merger's answer format | **CPR's, appended after the project's instructions, not changeable** | CPR parses the answer: a changed format is a merger whose every answer fails |
| 170 | A value CPR cannot use (not text; a start prompt without `{brief}`) | **CPR's text, and the page says why** | An agent started without its brief does the wrong work; precise beats complete |
| 171 | `{into}` when CPR knows no default branch (no `origin/HEAD`, no `main` or `master`) | **"the branch the person picks"** | Since V26 the person picks it at Merge into ▾. Today's sentence stops before the target there; the one case where the default's output changes |

**Not in V28 (later)**: the other config.json keys on the page (asked: the prompts first);
prompts per person (asked: shared); the Done when texts each kind fills in (the brief's, edited in
the start dialog); the merger's conflict frame and its "asked again" sentence; new kinds of work;
a diff of a changed prompt against CPR's; folding `cpr/merge.md` into `merger`.

#### As built (V28a)

- **A write is `POST /api/settings/prompts` with `{ key, text, version }`**, not `PUT …/<key>`:
  every write of `cpr view`'s server is a POST with `x-cpr: 1` and a JSON body (`written`).
- **CPR's texts moved into `packages/cli/src/prompts.ts`**: the kinds' lines (out of `KINDS`),
  `cpr/AGENTS.md` (out of `reviews.ts`) and the merger's instructions (out of
  `merge-agent.ts`), so `reviews.ts` can read the prompts without an import cycle. `AGENTS` and
  `MERGER_INSTRUCTIONS` are still exported, built from the defaults.
- **`cpr/AGENTS.md` follows a change while `cpr view` runs.** It was written at most once a run;
  now again whenever the text in use differs from what was written.
- **The file's git state** comes from a new core helper, `fileGitState`: committed, changed,
  new, `ignored` (a project's own `cpr/.gitignore` may hide `config.json`), none.
- **A save keeps the text as given**, but with `\n` line ends and no blank end; one equal to
  CPR's is no key. `{plan}`'s texts are not filled again: one pass, so a brief or a plan sentence
  that holds `{branch}` keeps it as text.
- Limits as planned; the plan sentences have 1,000 characters, as a verdict's.

**Results (V28a).** With no `prompts`, the 48 start prompts recorded from `main`'s build (6
kinds, a record from before V24 among them, × Plan first × a default branch or none × `from` or
not), the merger's system prompt, `cpr/AGENTS.md` and 8 verdict texts are byte for byte
`main`'s, except the 20 start prompts with no default branch (decision 171). This repository's
`cpr/config.json` with a prompt set, then reset, is the file it was. 917 unit tests (18 new);
lint, typecheck, build. Through the built CLI in a throwaway repository with a fake `claude`:
`GET /api/settings/prompts` listed the 13 prompts, a save wrote `cpr/config.json` as lines
(git: new), the Spike started next got the project's prompt filled in, and a stale save got 409.
The real Claude Code (2.1.303, `sonnet`, read-only, Plan first) on CPR's Spike prompt planned
"nothing in the project, and no commits"; on a Spike prompt that keeps experiments, it planned
`spikes/line-count-bench.ts`, a commit and a push (19.2K–20.3K input tokens). Not verified: Codex
started with a changed prompt, and the merger with changed instructions on a real conflict
(both get the text through the code the tests cover); Windows' command-line limit.

#### As built (V28b)

- **Settings is a third tab, `s`**, at `/settings` (served when `cpr view` has the settings
  service). The list groups the prompts as the server gives them (Workspaces, Reviews, Merger)
  and marks each "changed", "not saved" or "not used" (a value CPR cannot use).
- **The editor**: the prompt in a monospace text area that grows with its text, wrapped lines
  too, up to 70 % of the window (a line count left the merger's long lines scrolling inside);
  its size in characters and about how many tokens; the placeholders, each inserted at the
  cursor on a click; the merger's answer format read-only; CPR's text under a disclosure once
  the project has its own. Save (also Ctrl+S, Ctrl+Enter) is off while the text would be
  refused: the page checks the required placeholder and the limit as the server does.
- **What saving says** comes from the file's git state: "Saved in cpr/config.json, not
  committed: commit it to share the prompts with everyone who uses this repository", changes
  not committed, committed, ignored, none. A save refused as stale offers "Read it again", which
  keeps the drafts.
- **Drafts** are kept per prompt while others are open; leaving the page with one asks first
  (`beforeunload`, which the tabs' links and keys trigger too). Reset asks once, inline.
- **On a phone** the list comes first and a prompt takes the page, with "← All prompts" back, as
  Workspaces does with its panel.

**Results (V28b).** 7 unit tests for the page's logic (red first), 4 e2e tests
(`settings.spec.ts`: a Fix prompt changed and saved, then the next Fix workspace's agent told it,
Reset leaving no `prompts`; drafts kept across prompts, `beforeunload` on leaving, a save refused
as stale then saved after "Read it again"; the merger's fixed answer format; the phone layout,
nothing wider than 390 px). V25's tabs test now expects three tabs. 124 of 124 e2e, 924 unit tests. Screenshots at
1440 × 900 and 390 × 844, light and dark, no page errors. The merger with changed instructions,
the real Claude Code (`sonnet`) on one conflict (a version constant changed on both sides): CPR's
instructions answered `2.1.0`; a rule that versions are the person's gave "needs you", naming the
two values and the decision (4.2K input tokens, 3–5 s a run). Not verified: Codex started with a
changed prompt; Windows.

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
| 119 | What CPR stands for | **Coordinated Programming Runtime** (2026-10-15) | Asked with the README rewrite. Since V15–V18, CPR coordinates the person and their agents (a feature's branch, worktree and agent; reviews and verdicts the agent acts on), not only the review; the North Star is unchanged. |
