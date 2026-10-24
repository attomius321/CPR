---
name: framework-plugin
description: Adds or changes a Symbiote framework plugin (@symbiote/plugin-*, a TsPlugin loaded with --plugin <name>) — framework knowledge such as templates, routing conventions or component props that plain TypeScript analysis cannot see. Use when supporting a new framework (React, Vue, Svelte…), extending the Angular or Qwik plugins, or adding a plugin hook to core.
---

# Framework plugins

Framework knowledge lives in plugins so the TypeScript analysis stays the same for every repo
(`docs/plan/x1-plugins.md`). A plugin implements `TsPlugin` from
`packages/core/src/lang/typescript/plugins.ts`; `packages/core/test/helpers/tpl-plugin.ts` uses
every hook on a made-up framework; the Angular and Qwik plugins are the real examples.

## Hooks

| Hook | For |
|---|---|
| `applies(context)` | Is the framework used? Root `package.json` **or any source import** (apps sit in subfolders) |
| `matches(path)` | Extra changed files to analyze (`.html`, `.mdx`) |
| `virtualFiles(context)` | In-memory TypeScript (shims) added before the program, with `map(offset)` back to real lines; unmapped = scaffolding |
| `extract(revision, files)` | Extra symbols (templates) and the nodes standing for them |
| `decoratorArguments` | Which decorator arguments are signature vs body |
| `contract(revision, declaration)` | What a framework-made value is to its users (component props) |
| `dangling` | Uses of removed symbols TypeScript cannot see by name (selectors, pipe names) |
| `exposure` | Why an unreferenced symbol is used (`framework`: lifecycle hooks, router exports) |
| `mentions(revision)` | Classes and custom properties the framework's templates name (`class="a"`, `[class.a]`), owned by template symbols: their edges to stylesheet rules (L2) |
| `styleScopes(revision)` | Stylesheets that style one component's markup only (`styleUrls`, `useStylesScoped$`), by owners or by the calls that load them |
| `warnings` | Problems the user should know about |

A new optional hook in core keeps `PLUGIN_API_VERSION` at 1. Run hooks through `runHook` so a
throwing plugin is disabled with a warning instead of failing the run.

## Checklist for a new plugin

```
- [ ] Measure first: run Symbiote on real commits of a project using the framework; list the false
      findings and misses it causes (milestone skill, Problem table)
- [ ] Read the framework's own rules from its source (e.g. Qwik's getSourceFile, Angular's
      compiler) for each supported major version; copy them, cite them in the plan
- [ ] packages/plugin-<name>: package.json (private, ESM, exports ./dist, devDependency
      "@symbiote/core": "workspace:*"), tsconfig.json + tsconfig.build.json copied from plugin-qwik
- [ ] Root package.json devDependency "@symbiote/plugin-<name>": "workspace:*"; reference in
      tsconfig.build.json; `pnpm install` (updates the lockfile — commit it)
- [ ] .gitignore exception for the fixtures' node_modules (fake typings)
- [ ] Fixtures base/head with every case of the plan, minimal fake typings shaped like the real
      ones; `tsc` on them gives the same errors as with the real package; a copy without
      node_modules (tests copy the fixture and drop it) for syntax-only behavior
- [ ] Tests red first: expected findings with the plugin; today's without it
- [ ] "Nothing changes": core fixtures with the plugin identical; next to other plugins identical
- [ ] Per project, not per repo: a monorepo can hold several apps and versions (W1); find the
      nearest package.json / config per file
- [ ] CLI hint: add the framework to FRAMEWORKS in packages/cli/src/plugins.ts, with a test
- [ ] README plugin paragraph; plan file with "As built" and its index row; journal entry
- [ ] regression-check: the plugin's real-repo set with --no-plugins vs with it (every finding
      gone must be a framework use; inspect every new one); time +5 % at most
- [ ] Viewer: an e2e spec if the plugin adds symbol kinds or files (packages/viewer/e2e/qwik.spec.ts)
```

## Rules learned the hard way

- Silence only what the framework really uses: precision fixtures keep real orphans and real
  breaks flagged (a helper exported from a route file is still an orphan).
- Prefer syntax and declared type nodes over the checker: cheap, works without `node_modules`,
  and stable between the base and head programs.
- Never assume a node has a parent (JSDoc references), or a dependency is installed.
- Plugins import only types from `@symbiote/core`; the framework's own packages are not dependencies
  unless the plugin cannot work without them (Angular's compiler is the one exception).
