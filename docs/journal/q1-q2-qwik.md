# Journal: Q1–Q2 — Qwik, as the `qwik` plugin

[Index](../JOURNAL.md) · [Plan](../plan/q1-q2-qwik.md)

## Qwik spike (2026-10-03, branch `milestone/q1-qwik`)

Groundwork for Q1–Q2 (PLAN). Nothing in Symbiote changed.

**What Symbiote does today** on a scratch app with the real typings (`@builder.io/qwik` and
`qwik-city` 1.20.1, checked by `tsc`): JSX elements are calls, `component$` bodies and `$`
handlers fold into the component, a required prop added to an inline props type warns with the
page that does not pass it. Wrong: router-called exports (`onGet`, `onRequest`, `head`, loaders,
actions, a loader re-exported by a route) are orphans; an optional prop added warns (a
`component$` variable has no shape, so its type text is compared: `unknown`); a required member
added to a named `CardProps` is only ℹ on the interface, since `Component<CardProps>` does not
change and JSX sites never name it.

**Qwik's docs site** (`QwikDev/qwik` `packages/docs`, Qwik 2 RC; 30 latest non-merge commits
touching its routes' TS files; blobless clone, no install): 9 `orphan-added`, 7 false — 5 router
exports (`head` ×2, `default` ×3), 1 component rendered only from `.mdx`, 1 MDX provider named
in `vite.config.ts`. The 2 right ones are tutorial code whose only use is commented out.

**Route rules**, read in Qwik's own Vite plugin (`getSourceFile`, `walkServerPlugins`):
1.20.1 and 2.0.0-rc.0 agree on `index`/`layout`/`plugin`/`entry`/`service-worker` names and
extensions; error pages differ (1.x any `400`–`599`, 2.x `404` and `error`). Server plugins are
read from one folder, not recursively. The request handler reads `onRequest`…`onOptions`,
`head`, `default`, `onStaticGenerate`, and (2.x) `routeConfig`, `eTag`, `cacheKey`; loaders and
actions are collected from every export of a page or layout module by their `__brand`.

**MDX** on the docs site: 243 `.mdx` routes, 144 with imports (347 lines, 372 names), 575
elements whose tag is an imported name (2 more inside code fences); 138 imported names are not
tags, mostly images in `src={…}`. A line scanner finds what the plugin needs; checking it
against `@mdx-js/mdx` is part of Q2's verification.

## Q1 — Qwik routes and components (2026-10-03, branch `milestone/q1-qwik`)

A new package, `@symbiote/plugin-qwik` (`--plugin qwik`), and two generic core changes it needs: an
optional `contract` hook (a framework call's value → what its users pass) with `Shape.inputs`
compared from the callers' side, and a plugin's exposure replacing the adapter's "default export,
loaded by convention?" guess.

**Learned**
- A named props type changes without its component's code changing (`CardProps` gains a member,
  `Card` stays as written). Contracts limited to changed symbols, as planned, would never see it:
  the syntactic pass decides which symbols get a second look. Props come from the types written
  in the code, so computing them in both passes costs little and needs no installed Qwik.
- `typeToString` prints a union's members in type-creation order, which differs between two
  programs: `'primary' | 'plain'` came out reversed once. Input types are now the tokens of their
  declared type (as interface members always were); the checker's text only where none exists.
- On Qwik's docs site a removed *optional* prop (`Header`'s `mobileSidebarOpen`) warned about 9
  untouched `<Header />` users — none of which passes it. Breaking for a component means
  breaking for the JSX that passes (or misses) a prop, so JSX references now carry their
  attributes and only users that pass a removed or retyped prop, or miss a newly required one,
  count. Generic: any plugin's inputs get it.
- Qwik's own e2e apps have a `package.json` without dependencies and take Qwik from the monorepo
  root: "nearest `package.json` naming Qwik" put their routes at the root's `src/routes`. A
  project is now its package (nearest real `package.json`), with Qwik named there or above.
- The fixture typings mirror the real ones where it matters (`Loader` declared as `Loader_2`,
  `Component<P>` an alias); `tsc` reports the same 3 errors with them as with the real 1.20.1
  typings.

**Verification**: 76 new tests (plugin fixtures with and without typings, Qwik 2 in a subfolder,
38 file-rule cases, core contract and per-site cases, CLI hints), red before; full suite 371
passing. `--plugin qwik` on the core fixtures and next to `angular` on the Angular fixtures:
identical analyses. Qwik docs site, 30 commits: without the plugin identical to `main`; with it 5
false findings gone, no new warning, 6 new ℹ (real props changes), +3.9 % time.

Merged into main (2026-10-03), with Q2.

## Q2 — Qwik MDX routes (2026-10-03, branch `milestone/q2-qwik-mdx`)

`.mdx` files under a Qwik app's routes folder become templates: a shim per file renders its
component elements (self-closed) and expressions under its own imports, mapped back to `.mdx`
lines, so removed components, props pages do not pass, and components only pages use are seen.

**Learned**
- MDX's ESM rule is stricter than "a line starting with import": the keyword needs a space after
  it and cannot continue a paragraph. Qwik's API pages have `import("@qwik.dev/core").JSXOutput`
  at line starts; the first scanner read those as ESM. Frontmatter sits right before the imports,
  and fences inside list items are indented 4+ spaces. With those rules the scanner and
  `@mdx-js/mdx` agree on all 243 routes of the docs site.
- MDX rejects JS comments in JSX tags, and TSX accepts every valid MDX element tried: the
  "element that does not parse" case only protects against scanner mistakes.
- Find-references follows imports and aliases but not a shorthand property to its uses: routing
  provided components through `useMDXComponents()`'s return value type-checked their props but
  hid the page as a user. Reading the provider by syntax and importing each provided component
  into the shim fixed it.

**Verification**: scanner and shim unit tests (frontmatter, fences, inline code, escapes, ESM
rules, unclosed elements, mapping, the parse fallback), the `qwik-mdx` fixture (red before),
the viewer test `qwik.spec.ts`, Qwik docs site: without the plugin identical to
`main`, with it 7 false findings gone (`head` ×2, route `default` ×3, `BenchmarkTable`,
`useMDXComponents`), both right `Repos` kept, no new warning; +3.7 % time. Full suite: 377 unit
tests, 29 browser tests.

Merged into main (2026-10-03).
