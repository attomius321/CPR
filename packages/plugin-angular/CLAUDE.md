# @cpr/plugin-angular

`--plugin angular`: templates become symbols that use their component's members; decorator
configuration is not contract; lifecycle hooks and host listeners are not orphans; templates see
the repo's and installed libraries' components, directives and pipes. Design and history:
`docs/PLAN.md` sections X1, A1–A2, A3, W1.

## Where things are

- `src/index.ts` — the `TsPlugin`: per-revision state (classes, registries, template syntax per
  Angular version), shims, extraction of templates, decorator roles, dangling template uses.
- `src/classes.ts` (Angular classes by syntax), `src/template.ts` (parsing with
  `@angular/compiler`, pinned), `src/shim.ts` (a template as TypeScript, mapped back to `.html`
  positions), `src/directives.ts` (selector registry), `src/expressions.ts`.
- `src/libraries.ts` — library classes read **by syntax** from installed typings: Ivy partial
  declarations (12+), ngcc `DefWithMeta` (9–11), View Engine `metadata.json`.

## Rules

- Per project, not per repo (W1): the Angular version comes from the nearest installed
  `@angular/core` or `package.json` (block syntax and `@let` only from 17); libraries from the
  nearest `node_modules`; a template only sees components of its own Angular workspace (nearest
  `angular.json`) and shared code outside every workspace.
- Without `node_modules`, results must equal A2's (no library classes), never a wrong guess.
- Shims are virtual files: an import there that no longer resolves is how removed components and
  pipes are found — keep their positions mapped to the template.

## Tests

`test/angular.test.ts` on `test/fixtures/{templates,bindings,legacy,ng11,libraries,multi-project}`
(fake library typings in fixture `node_modules/`). Real-repo checks: `regression-check` skill,
`bitwarden` set (and `r1`, whose RealWorld commits are Angular 11).
