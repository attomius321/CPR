# Journal: A3 — Angular library components, directives and pipes

[Index](../JOURNAL.md) · [Plan](../plan/a3-angular-libraries.md)

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
- An interface's members are part of the interface for Symbiote, in TS code and templates alike: the
  RealWorld experiment (a `User` field read through `currentUser$ | async`) changes nothing
  because `User` is an interface. Bitwarden's `Organization` is a class, and there the stale
  template read is caught.
- **A core gap**: a `node_modules` that is itself a link was not linked into the analyzed
  checkouts, so with such an install Symbiote saw no dependency types at all. Found because the test
  installs were links; fixed in `linkNodeModules`, with a test.
- Nothing is read when dependencies are not installed (CI without `npm ci`): results are A2's.

**Verification**: fixture `libraries` (3 tests, one per metadata form plus not-installed); the
whole suite; RealWorld (Angular 21) and the Angular 11 project before and after ngcc (same 16
library edges both ways); the Bitwarden rename experiment (A3 ✖, A2 nothing); Bitwarden timing
on 10 commits, A2 and A3 back to back with the Angular packages installed: +2.3 % in total, the
same findings on all 10, 150 edges into libraries. Without the plugin, the 29 R1 comparisons
are unchanged (932 edges, 11 findings).

Merged into main (2026-10-02).
