# W1 — Repositories with several projects

[Index](../PLAN.md) · [Journal](../journal/w1-multi-project.md)

**Status:** merged into main (2026-10-03, from branch `milestone/w1-multi-project`); results
and "as built" at the end of this section.

**Problem** (reported on a real project: "Symbiote does not render any HTML templates in my app").
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
   `tsconfig.json` below is loaded with Symbiote's defaults: each project's `paths` and `baseUrl` are
   dropped. With a root one, its options win for every file. Spike (two projects, both mapping
   `@app/*` to their own `src/app/*`): with shared options, `@app/core/user.service` and
   `src/app/core/user.service` are **unresolved** in both projects — links across files through
   aliases are lost, in plain TypeScript too. Merging both projects' `paths` cannot work either:
   the same alias means two folders. And only files named exactly `tsconfig.json` are found:
   Angular keeps the options it builds with in `tsconfig.app.json` (Angular 6–11:
   `src/tsconfig.app.json` with `baseUrl: "./"`), which Symbiote never reads.

The spike also showed the fix: ts-morph takes a `resolutionHost` whose `resolveModuleNames` gets
the importing file; resolving each file's imports with the options of *its* project resolved
both projects to their own files — in the program and in the language service's reference search
(ts-morph wires the host into both).

**Goal**: a repo with any number of TypeScript/Angular projects, at any depth, analyzes like one
project each: imports resolve with the options of the project a file belongs to, the Angular
plugin applies wherever Angular is used, each template is parsed with its project's Angular
version and matched against its project's installed libraries. A repo with one project at the
root behaves exactly as today.

## Which project a file belongs to

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
- Options are the config's parsed options (`extends` followed by TypeScript), with Symbiote's
  `OVERRIDES` and the workspace `paths` (npm/pnpm workspaces) added as today.

## Resolution per project (core)

- `loadTsProject` gives the ts-morph project a `resolutionHost`: for each import, resolve with
  the importing file's project options (one `ModuleResolutionCache` per config); **if that finds
  nothing, resolve as today** (root options, or defaults). So nothing that resolves today stops
  resolving; what changes is only what was unresolved, or what an alias means in its own project.
- Discovered configs follow their own `references` too (a solution-style `tsconfig.json` with
  `files: []` loads nothing today unless it is the root one).
- Plugin shims (`*.symbiote.ts`, next to their component) belong to the component's project, so their
  imports (`./foo.component.js`, `@angular/common`) resolve like the component's.
- A config that cannot be parsed is a warning (as today) and its folder falls back to the root
  options.

## Angular per project (plugin)

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

## Verification

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
   only templates in both → `symbiote view --plugin angular`: both templates in the Changes list, with
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

## W1 results

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
`symbiote view`, the replica's Changes list holds the Angular 11 template-only change with its diff
next to the Angular 21 app's templates (none on `main`).

## W1 as built

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
