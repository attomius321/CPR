# A3 — Angular library components, directives and pipes

[Index](../PLAN.md) · [Journal](../journal/a3-angular-libraries.md)

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

## Where the metadata comes from

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

## Shims

Library classes join the A2 registry with their package as their place:
`import { AsyncPipe as __symbiote_D4 } from '@angular/common';` (by value, resolved in the analyzed
program like any import). Matching stays global (A2), now over repo and imported library
directives; two components on one element stay `possible`. A pipe call is
`(__symbiote_D4(), __symbiote_D4.prototype.transform(value, …args))` as for repo pipes — `transform`'s
generic signature types the result (`async`: `Observable<T>` → `T`). `ngFor`/`ngIf` keep A1's
special handling (their context types are not in their metadata).

## What changes in findings

- **Through library pipes**: reads after `| async`, and aliases of it in `@if`/`*ngIf`/`@for`,
  are typed: their members are edges, a removed or renamed one is `removed-still-referenced`,
  a changed one counts its template users, a new one read only there is no orphan.
- **Library outputs** type `$event` (`(ngModelChange)="save($event)"`); **references** to library
  directives are typed (`#f="ngForm"` … `f.valid`).
- **Edges to packages**: a template's uses of library classes and members are edges to external
  nodes (`@angular/forms#NgModel.model`), drawn in the package's box as for TS code.
- Nothing for library code itself: the analysis is of the repo's change.

## Verification

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

## A3 results

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
the same experiment shows nothing either way: its models are interfaces, whose members Symbiote
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

## A3 as built

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
  `import { AsyncPipe as __symbiote_D0 } from '@angular/common'`, by value, resolved by TypeScript
  like any import — so `transform`'s generic signature types `x$ | async`, and every use is an
  edge to the package's node.

**Proposed decision** (into §14 with 20–24):

| # | Question | Decision | Why |
|---|---|---|---|
| 25 | Where library directives come from | **The installed packages' published typings (and View Engine `metadata.json`), read by syntax**; nothing when `node_modules` is missing | They are what Angular's compiler reads too; reading them by syntax needs no type checker, so the registry exists before the program the shims join. Without an install the result is A2's, never a wrong one. |
