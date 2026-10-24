# A1–A2 — Angular templates, as the `angular` plugin

[Index](../PLAN.md) · [Journal](../journal/a1-a2-angular-templates.md)

**Status:** A1 and A2 merged into main with X1 (PR #1, 2026-10-02); results and "as built" at
the end of this section.

Everything in this section lives in `@symbiote/plugin-angular` and reaches Symbiote only through X1's hooks.
Without `--plugin angular`, Symbiote does none of it — on Angular projects too.

**Problem.** Symbiote reads TypeScript only, so everything an Angular template does is invisible: a
method called only from `(click)` looks unused, a method removed while its template still calls
it is not reported, and a change to a template alone shows nothing. Measured with Angular's own
template parser (spike in the [journal](../journal/a1-a2-angular-templates.md#angular-templates-spike-2026-10-02)):

| | RealWorld, Angular 11 | RealWorld, Angular 21 | Bitwarden clients, Angular 21 |
|---|---|---|---|
| Components (external / inline templates) | 18 (18 / 0) | 18 (10 / 8) | 1,188 (780 / 396) |
| Component members read by templates | 128 | 112 | 10,368 |
| Members used **only** by templates (by name, approximate) | 19 | 21 | ~1,800 |
| Input / output bindings to repo components | 26 / 7 | 30 / 8 | 4,060 / 522 |
| Pipe uses (of repo pipes) | 4 (1) | 13 (6) | 6,485 (5,732) |
| Parse errors | 0 | 0 | 0 |
| Parse + bind every template, one side | 0.1 s | 0.1 s | 1.8 s |

On seven real RealWorld commits that touch templates, Symbiote today gives **9 warnings, all false**,
and none of what the templates changed:

| Commit | Symbiote today | Cause |
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

## What a template uses

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

## The template is a symbol

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

## Resolving with TypeScript: template shims

The plugin translates each template into a small TypeScript function, a **shim**, returned as an
X1 virtual file next to its component; the adapter adds it to the program before the language
service starts (the program still never changes after loading). The shim's `this` is the component, template
locals become locals, and whatever Symbiote cannot type is `any`:

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
// src/app/article.component.html.symbiote.ts (in memory)
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

This reuses what TypeScript and Symbiote already do: inherited members, chains through services and
loop variables, package edges, and R1's class-family filter (`this` is the component, so a sibling
component's template reading a same-named member is dropped). The spike confirmed it on ts-morph:
`findReferences` for a base class method, a service method reached as `this.auth.isLoggedIn()` and
a method called on a loop variable all returned the shim's sites, and `this.gone()` resolved to
nothing on a `FooComponent` receiver.

Shims contain only what Symbiote understands; the rest is `any`, which resolves to nothing: no edge,
never a guess (`let-` variables of `<ng-template>`, library pipes and directives, `$any()`). A
template with syntax errors still gets a shim for the parts that parse, plus a warning.

## Angular decorators: configuration is not contract

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

## Findings with templates

| Rule | With templates |
|---|---|
| `orphan-added` | Template and host uses count; `framework` exposure is skipped; templates are not reported. |
| `removed-still-referenced` | A shim's dangling site counts, from its template (error). A2: a removed component, directive or pipe whose element, attribute or pipe name a head template still uses (Angular rejects it at build) → error; a removed output still listened to → warning (the compiler allows unknown events, so it fails silently). |
| `signature-changed` | Template users are users, and updated when their template changed in this change. "Another file" is the template's file: an untouched external template makes a breaking change a warning (§8), an inline one in the changed file does not. |
| `exported-api-changed` | Unchanged. |

## Parser

`@angular/compiler` (pure ESM, depends only on `tslib`, 4.9 MB) is Angular's own parser and
binder (`parseTemplate`, `R3TargetBinder`), so templates read exactly as Angular reads them: block
control flow, `@let`, `@defer`, ICU messages, structural micro-syntax.

- **Pinned to 21.2.x** (21.2.25): 22.x requires Node ≥ 22.22.3, and Symbiote supports 22.12. A
  dependency of `@symbiote/plugin-angular` only, loaded with the plugin, which the CLI imports only
  when asked for it.
- **Whitespace preserved** while parsing: collapsing it rewrites text nodes and shifts the
  offsets of interpolations; the hash normalizes whitespace itself.
- **Syntax by the project's Angular version** (`@angular/core` in package.json or `node_modules`):
  17 and later → block syntax and `@let` on; older → both off. Never block syntax with `@let` off:
  the parser loops forever on `@let x = 1;` in that mode (found in the spike).
- **Parse errors** → a warning (`src/app/foo.component.html: template has syntax errors;
  references may be missing`); the hash falls back to whitespace-normalized text.

## Graph contract

X1's schema 0.5.0 covers it: node kind `template`, edge sites in `.html` files, `plugins` listing
`angular`; no new edge kinds. The viewer labels template nodes; their per-symbol diff and comments
go through the existing source access (a node's file is already allowed). Summary line: `M  src/app/foo.component.html` / `~ template  of
FooComponent  (body)`.

## Milestones

| # | Milestone | Output |
|---|---|---|
| X1 ✅ | Plugins | The TS adapter's plugin hooks (`applies`, `matches`, `virtualFiles` with position maps, `extract`, `decoratorArguments`, `exposure`, `warnings`); `createTypescriptAdapter({ plugins })`; `--plugin` and `symbiote.config.json`; plugin resolution, API version check, failure isolation, the Angular hint; schema 0.5.0 (`template`, `framework`, `plugins`); CI inputs; a fixture test plugin. No Angular code. |
| A1 ✅ | Angular plugin: templates see their component | `packages/plugin-angular`; Angular project detection; component metadata (`templateUrl`, inline `template`, `host`); template symbols, hashes and `.html` relevance; shims for names on the component, chains, locals and host bindings; shim position maps; the decorator split; `framework` exposures; viewer and summary labels for templates. |
| A2 ✅ | Angular plugin: templates see other components | Directive, component and pipe metadata from repo decorators: selectors, `@Input`/`@Output`, `inputs`/`outputs` arrays, signal `input()`/`input.required()`/`model()`/`output()`, aliases, inputs inherited from base classes. Selector matching with the compiler's `SelectorMatcher` over the repo's directives; shims for elements, directives, inputs, outputs, two-way bindings, pipes and `#ref="exportAs"`; removed components, pipes and outputs still used. |

A2 matches globally over the repo's directives, without NgModule or standalone scopes: a compiling
app can only use what its scope offers, so global matching over-reports only when two directives
share a selector. Two **components** matching one element cannot both be in scope (Angular rejects
that), so their edges are marked `possible`.

## Verification

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

## A1 results

**Fixtures** (`packages/plugin-angular/test`, 8 tests): every A1 case listed above, plus a
generic component (`Table<T>`), a component that is not exported and a test host in a `.spec.ts`.
**Viewer e2e** (`e2e/angular.spec.ts`): `symbiote pr --plugin angular` shows the finding naming the
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

## A1 as built

- `packages/plugin-angular` (`@symbiote/plugin-angular` 0.1.0) depends on `@angular/compiler` only;
  `@symbiote/core` is a dev dependency for types, and TypeScript comes from `PluginContext.ts`. The
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
  `(x as any)`; pipes → `__symbiote_pipe(…)` (A2 resolves repo pipes); assignments are `Binary`
  nodes in Angular 21.
- `shim.ts`: one block per view; `#refs` declared at the start of their view; `@for`/`*ngFor` →
  `for…of`; `@if`/`*ngIf` aliases → constants; other locals `any`; events →
  `($event: any) => { … }`; host bindings → `__symbiote_host`, owned by the class.
- One shim per class: `foo.component.FooComponent.symbiote.ts`, importing `./foo.component.js` (valid
  in every module resolution mode), with `__symbiote_template` and `__symbiote_host`.
- Template symbol: name `(template)`, signature `template of FooComponent` (a shared
  `templateUrl` is one symbol listing its components), constant signature hash, body hash from
  the parsed template. Labels: findings and the viewer call it by its file
  (`foo.component.html`) or `FooComponent template`; the summary prints `template of …`.
- Core, generic: `ts` types exported for plugins; a warning only the base revision has is
  prefixed `in base:` (a problem the change fixes is not one it brings).

## A2 results

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

## A2 as built

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
  (`__symbiote_D0`…), relative to the shim; imports are written last (`ShimBuilder.prepend`).
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
| 22 | Template parser | **`@angular/compiler` 21.2.x**, pinned, lazy, syntax options by the project's Angular version | Angular's own parser: 0 errors on 1,212 templates from Angular 11 to 21. 22.x needs a newer Node than Symbiote supports. |
| 23 | Angular decorator arguments | **What templates depend on is signature, the rest is body** (claimed by the plugin) | 5 of the 9 false warnings on RealWorld commits were `@Component({ imports })` edits reported as signature changes. |
| 24 | Where framework support lives | **Plugins of the TypeScript adapter, loaded by the CLI on request** (`--plugin`, `symbiote.config.json`); core offers generic hooks — virtual files with position maps, extra file types, decorator argument roles, exposures | The TS/JS analysis must be the same for every project and carry no framework dependency; the same hooks fit Vue or Svelte templates later. |

Not in A1–A2 (later): library directives and pipes (selectors, inputs and pipe names from the
`ɵdir`/`ɵcmp`/`ɵpipe` declarations in their `.d.ts`) and NgModule/standalone scopes;
`ngTemplateContextGuard` types for `let-` variables; host directives; templates built at runtime
or with `require()`; templates of other frameworks (Vue single-file components, Svelte), which the
same shim approach fits as further plugins on X1's hooks.
