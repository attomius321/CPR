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
| W1 ✅ (branch, not merged) | Repositories with several projects | A repo whose Angular apps live in subfolders (two apps, two levels deep, nothing at the root) got no template analysis at all, and its `@app/*` and `baseUrl` imports did not resolve. Now each file resolves with its own project's options, and the Angular plugin works per app; see below. |

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

### W1 — Repositories with several projects

**Status:** built and verified on branch `milestone/w1-multi-project`, not merged yet; results
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
turns per-project resolution on): BWTBD

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
