# @symbiote/plugin-qwik

`--plugin qwik`: what Qwik's router calls by name is not an orphan; a `component$`'s props are its
contract (core's `contract` hook), compared from the callers' side; `.mdx` routes are templates.
No runtime dependency besides `@symbiote/core` types. Design, measurements and "as built":
`docs/plan/q1-q2-qwik.md` (journal: `docs/journal/q1-q2-qwik.md`).

## Where things are

- `src/projects.ts` — Qwik projects per package (nearest real `package.json`; Qwik and its router
  may be named there or above, as in Qwik's own monorepo), routes folder and MDX provider from the
  Vite config (`routesDir` as a quoted path or `resolve`/`join`/`fileURLToPath` calls).
- `src/routes.ts` — file kinds copied from Qwik's Vite plugin (`getSourceFile`,
  `walkServerPlugins`) for 1.x (`@builder.io/qwik-city`) and 2.x (`@qwik.dev/router`); error pages
  differ between them.
- `src/exposures.ts` — exports the router reads (by name, loaders/actions by type or callee,
  through re-exports, entries). `src/components.ts` — props from type nodes first.
- `src/mdx.ts` — the MDX scanner (no MDX dependency); `src/mdx-shim.ts` — `.mdx` as TSX mapped
  to `.mdx` lines; `src/mdx-routes.ts`; `src/provider.ts` — the MDX provider read by syntax.

## Rules

- Only silence what the router really reads: a helper exported from a route module stays an
  orphan (precision fixtures guard this).
- Keep the fake typings in fixtures shaped like the real ones (`Loader` is declared `Loader_2`,
  `Component<P>` is an alias) and check them with `tsc` against the real packages when changing.
- When changing `mdx.ts`, compare with `@mdx-js/mdx` on Qwik's docs site (243 routes): ESM blocks,
  component elements and expressions must match (see the Q2 entry in `docs/journal/q1-q2-qwik.md`).

## Tests

`test/qwik.test.ts` (fixtures `qwik-v1`, `qwik-v2`, the same without typings), `test/routes.test.ts`
(file rules, projects), `test/mdx.test.ts` (scanner, shim), `test/mdx-routes.test.ts` (fixture
`qwik-mdx`); viewer e2e `packages/viewer/e2e/qwik.spec.ts`. Real repo: `regression-check` skill,
`qwik-docs` set, with and without the plugin.
