# Journal: A1–A2 — Angular templates, as the `angular` plugin

[Index](../JOURNAL.md) · [Plan](../plan/a1-a2-angular-templates.md)

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
