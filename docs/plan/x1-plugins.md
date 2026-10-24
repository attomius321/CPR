# X1 — Plugins

[Index](../PLAN.md) · [Journal](../journal/x1-plugins.md)

**Status:** merged into main (PR #1, 2026-10-02). The
contract below is as built; "As built" at the end lists what changed from the first sketch.

**Why.** Framework knowledge — Angular templates now; Vue or Svelte templates, NestJS conventions
later — must not live in the TypeScript/JavaScript analysis. That analysis stays the same program
for every project and carries no framework dependency; a framework comes as a **plugin** that the
CLI loads only when asked. Without plugins, Symbiote behaves exactly as it does today.

**What a plugin is.** A JavaScript module exporting one plugin object. A plugin *extends* the
TypeScript adapter at fixed points; it never replaces it, and it sees TypeScript's own objects
(program, checker, nodes). The contract, exported by `@symbiote/core`
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
  path: string;                          // src/app/foo.component.html.symbiote.ts — never on disk
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
- `--plugin <name|path>` (repeatable) on `diff`, `view` and `pr`, and/or `symbiote.config.json` at the
  repository root: `{ "plugins": ["angular"] }`. The config is read from the working folder, not
  from the analyzed commit (the `.symbioteignore` lesson); a flag adds to it.
- `angular` means `@symbiote/plugin-angular`; a value starting with `.` or `/` is a path (flags
  relative to the working folder, the config relative to the repo root); any other value is a
  package name as given (`@acme/symbiote-vue`). Packages resolve from the project first, then next to
  the CLI. Imported only when turned on: no plugin, no cost, no
  extra dependency loaded.
- Another `apiVersion` is refused with a message; a plugin that throws becomes a warning and the
  run continues without it — a plugin never makes an analysis fail.
- A hint, once: when a changed `.html` sits in a repo that depends on `@angular/core` and the
  plugin is off — `Angular project: add --plugin angular to analyze templates`. Nothing changes
  on its own.
- Plugins are trusted code, like build-tool plugins: they run only when configured.

**Packaging.** `packages/plugin-angular` (`@symbiote/plugin-angular`) depends on `@symbiote/core` and
`@angular/compiler`. `@symbiote/core` and `@symbiote/cli` never depend on Angular; in this repository the
plugin is built with the rest, so `--plugin angular` works from a checkout.

**Graph contract (schema 0.5.0).** Node kind `template` (any framework's); exposure `framework`;
top-level `plugins: [{ name, version }]`, so a graph says what produced it. Edge sites can point
into non-TS files. The viewer stays generic: it labels template nodes and shows their file's diff.

**CI.** The GitHub Action gets a `plugins` input and the GitLab template a `SYMBIOTE_PLUGINS` variable,
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
module that is not a plugin and a broken `symbiote.config.json`; a plugin whose hook throws leaves a
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
  [`tpl-plugin.ts`](../../packages/core/test/helpers/tpl-plugin.ts): a made-up framework whose
  `@View({ template: './card.tpl' })` classes render `{{ expression }}` templates, using every hook.
