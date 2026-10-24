# Journal: X1 — Plugins

[Index](../JOURNAL.md) · [Plan](../plan/x1-plugins.md)

## Plan revised: Angular as a plugin (2026-10-02)

Direction from review: Angular support must be a plugin of the CLI, and the TypeScript/JavaScript
analysis must keep working on its own, without it. The A1–A2 plan put template shims, `.html`
relevance, the Angular decorator split and lifecycle exposures inside the TypeScript adapter. It
now starts with **X1 — Plugins**: generic hooks on the TypeScript adapter (`applies`, `matches`,
`virtualFiles` with position maps, `extract`, `decoratorArguments`, `exposure`), plugins turned on
with `--plugin` or `symbiote.config.json` (read from the working folder), resolved by name or path,
isolated on failure. A1–A2 become `@symbiote/plugin-angular` on those hooks; `@symbiote/core` and
`@symbiote/cli` never depend on Angular, and without the plugin every result stays byte-identical,
Angular repos included. Decision 24 records it.

## X1 — Plugins (2026-10-02, branch `milestone/x1-plugins`)

**What landed** (reviewed and merged with PR #1)
- `@symbiote/core` exports the plugin contract (`TsPlugin`, `PLUGIN_API_VERSION` = 1) and
  `createTypescriptAdapter({ plugins })`; `typescriptAdapter` is that factory with no plugins.
  Hooks: `applies`, `matches`, `virtualFiles` (with `map` back to owner and real site),
  `extract`, `decoratorArguments`, `exposure`, `warnings`.
- Core uses them generically: virtual files join the program before the language service
  starts; reference search, outgoing scans and dangling detection map positions inside them back
  to the template (or whatever the owner is); declarations inside them are never edge targets.
  Claimed decorators hash their arguments by role. Exposure `framework` is skipped by
  `orphan-added`. Schema 0.5.0: kind `template`, top-level `plugins`.
- CLI: `--plugin` on diff, view and pr; `symbiote.config.json` (`{ "plugins": [...] }`) at the repo
  root of the working folder; `angular` → `@symbiote/plugin-angular`, `.`/`/` → a path; the project's
  copy first, then the CLI's. Clear errors for a missing package or file, another API version,
  a module without a plugin, a broken config. Hint on Angular repos with changed `.html`.
- CI: action input `plugins`, GitLab variable `SYMBIOTE_PLUGINS` → one `--plugin` each.

**Test plugin**: a made-up framework (`@View({ template: './card.tpl', tags })` classes and
`{{ expression }}` templates), ~200 lines, uses every hook. With it on the fixture: the template
is a symbol modified by the edit, with edges at `.tpl` lines; removing `Card.reset` while the
template still calls it is an error from `src/card.tpl#(template)` at `card.tpl:4:22`; `double`
(template only) and `onStart` (framework) are no orphans; a `tags` edit is a class body change.
Without it, the same change gives 2 false orphans and a false `signature-changed` — the Angular
pattern in miniature.

**No-plugin check**: goldens changed only `schemaVersion`. The 29 R1 comparisons (6 commits
each of ky, zod and vite, 8 Angular app commits and 3 experiments) give byte-identical edges
(932) and findings (11) on `main` and on X1. The Angular app's template commit prints
`hint: Angular project: add --plugin angular to analyze templates` once.

**Learned**
- Plugins must use the adapter's TypeScript (`PluginContext.ts`): a second copy would make
  `ts.isIdentifier` and friends disagree about nodes from the program.
- Hooks as function-typed properties, not methods: plugins should not depend on `this`, and the
  lint rule for unbound methods agrees.
- A failed plugin must also stop mapping its shims, or references keep pointing at symbols its
  failed `extract` never produced.
- Node-style specifiers: a path starts with `.` or `/`; anything else (including `@scope/name`)
  is a package.

**For A1**: an unresolved call inside a shim is labelled with shim text (`unknown:this.reset`);
the summary and viewer show template names as `(template)` — both want template-aware labels.
`@symbiote/plugin-angular` must be a dependency of the CLI to be found "next to symbiote".
