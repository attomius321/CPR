# Q1–Q2 — Qwik, as the `qwik` plugin

[Index](../PLAN.md) · [Journal](../journal/q1-q2-qwik.md)

**Status:** Q1 and Q2 merged into main (2026-10-03, from branches `milestone/q1-qwik` and
`milestone/q2-qwik-mdx`). As built and results: "As built (Q1)" and "As built (Q2)" below.

**Problem** (asked: "does it support TSX, specifically Qwik?"). Qwik is TSX, and Symbiote reads most of
it right already: `<Counter start={1} />` is a call to `Counter`, an edit inside `component$` or
an `onClick$` handler is a body change of the component, and a required prop added to an inline
props type is a signature change whose JSX users were not updated. What Symbiote cannot see is what
Qwik's router calls by name, what `component$` makes of props, and what `.mdx` routes use.
Measured on a scratch app with the real typings (`@builder.io/qwik` and `qwik-city` 1.20.1;
`tsc` checks it):

| Change | Symbiote today | Right answer |
|---|---|---|
| `onGet`, `head`, a `routeLoader$` and a `routeAction$` added to `routes/about/index.tsx`; `onRequest` to `routes/layout.tsx` | 5 × ⚠ `orphan-added` | none: the router calls them |
| A loader in `src/loaders/product.ts`, re-exported by `routes/shop/index.tsx` (Qwik's documented way to share one) | ⚠ `orphan-added` | none |
| The route's and layout's `default`, `entry.ssr.tsx`'s `default` | 3 × ℹ "default export nothing imports (loaded by convention?)" | none |
| A required prop added to `Badge = component$((props: { label: string }) => …)`, its page not updated | ⚠ `signature-changed` | the same ✓ |
| An optional prop added to `Pill` the same way | ⚠ `signature-changed` | ℹ compatible |
| A required member added to `CardProps` of `Card = component$<CardProps>(…)`, its page not updated (`tsc` fails) | ℹ on `CardProps` only ("code that creates it must add them", 0 untouched users); `Card` body-only | ⚠ on `Card`, naming the page |

The last two come from one cause: a `component$` variable has no shape. Its type
(`Component<{ text: string }>`) is compared as text, so any edit is `unknown` (a warning), and
`Component<CardProps>` does not change when `CardProps` does; JSX sites never name `CardProps`.

On Qwik's own docs site (`QwikDev/qwik` `packages/docs`, Qwik 2 RC, the 30 latest non-merge
commits touching its routes' TS files, no dependencies installed), 9 `orphan-added`, **7 of them
false**: `head` added to two route modules (⚠ ×2) and three new route `default`s (ℹ) are called by
the router; `BenchmarkTable` (⚠) is rendered only by its blog post's `index.mdx` (the site has
243 `.mdx` routes, 144 of them import components); `useMDXComponents` (⚠) is the MDX provider
that `providerImportSource` in `vite.config.ts` names. The other 2 are right: a tutorial's
`Repos`, whose only use is commented out. Of 64 `signature-changed`, the app's own 6 are ℹ; the
rest are on Qwik's packages and e2e apps, which the same commits touched.

**Goal**: with `--plugin qwik`, nothing the router calls is an orphan, a component's props are
its contract (optional prop added → compatible, required prop added or one removed → breaking,
for named props types too), and `.mdx` routes are code where they use code. Without the plugin,
nothing changes.

## Which projects are Qwik projects

- `applies`: the root `package.json` names `@builder.io/qwik` (1.x) or `@qwik.dev/core` (2.x),
  or any source file imports either (as Angular since W1).
- Per folder (W1): a file's Qwik project is the nearest folder whose `package.json` names one of
  them; it has router conventions if that `package.json` also names `@builder.io/qwik-city` or
  `@qwik.dev/router`. Cached per folder.
- Routes folder: `<project>/src/routes` (both versions' default), or a string literal
  `routesDir` given to `qwikCity(…)`/`qwikRouter(…)` in the project's `vite.config.{ts,mts,js,mjs}`
  (read by syntax, relative to that folder); the same for `serverPluginsDir` (default: the routes
  folder). Not a literal → the default and one warning.

## Routes: what the router calls by name (Q1)

File kinds as Qwik's Vite plugin decides them (`getSourceFile`, read in `@builder.io/qwik-city`
1.20.1 and `@qwik.dev/router` 2.0.0-rc.0; the same except error pages):

| Kind | Name without extension, under the routes folder | Extensions | Exports the router uses |
|---|---|---|---|
| Page or endpoint | `index`, `index!`, `index@<layout>`; error pages: 1.x `400`–`599`, 2.x `404` and `error` (with `!`/`@<layout>`) | `.tsx .jsx .ts .js` (`.mdx`: Q2) | `default`, `head`, `onRequest`, `onGet`, `onPost`, `onPut`, `onPatch`, `onDelete`, `onHead`, `onOptions`, `onStaticGenerate`; 2.x also `routeConfig`, `eTag`, `cacheKey`; every loader and action |
| Layout | `layout`, `layout!`, `layout-<name>` | `.tsx .jsx .ts .js` | the same |
| Server plugin | `plugin`, `plugin@<name>`, directly in the server plugins folder | `.ts .js .tsx .jsx` | `onRequest` … `onOptions` |
| Entry, service worker | `entry`, `service-worker` | `.ts .js` | every export |

- **Loaders and actions**: a value whose type is the router package's `Loader` or `Action`
  (covers `routeLoader$`, `routeAction$`, `globalAction$` and wrappers such as `formAction$`);
  without the router's typings, a value whose initializer calls one of those three, imported from
  the router package. The router collects them from every export of a page or layout module
  (`Object.values(routeModule)`, by their `__brand`).
- **Re-exports**: `export { useProduct } from '~/loaders/product'` (or `export *`) in a page or
  layout module gives the declaration it resolves to the same exposure, if it is a loader or
  action.
- **App entries**: files named `entry.<name>.{ts,tsx,js,jsx}` directly in a project's `src/`
  (`entry.ssr.tsx`, `entry.express.tsx`, …; named by Vite and adapter configs as strings): every
  export.
- All of these get the exposure `framework` (X1): `orphan-added` skips them. Every other export
  of a route file is judged as today — a helper nobody calls stays an orphan.

## Components: props are the contract (Q1)

A new optional hook in core, generic (React function components fit it later):

```ts
/** What a variable's value is used as, when a framework call made it (a Qwik `component$` →
 *  its props); undefined leaves it as today (the variable's type). Added with Q1. */
contract?: (revision: PluginRevision, declaration: ts.VariableDeclaration) => Contract | undefined;

interface Contract {
  /** For display, e.g. `component$<{ text: string; size?: number }>`. */
  display: string;
  /** What callers pass, member by member (a component's props). */
  inputs: ts.Type;
}
```

- **Core** (`extract.ts`): for a claimed variable, the signature hash and the display come from
  the contract — export and modifiers, name, and each input's name, optionality and normalized
  type (sorted) — instead of the variable's inferred type. Its shape gets a new field
  `inputs: Record<string, { optional, type }>`, compared in `compat.ts` from the caller's side:
  an input removed, retyped or made required → `breaking`; a required one added → `breaking`
  (every JSX site that does not pass it fails); an optional one added, or one made optional →
  `compatible`. Members of a named props type are resolved, so `CardProps` gaining a required
  member changes `Card`'s signature too.
- **Plugin**: claims a variable whose initializer calls `component$` imported from
  `@builder.io/qwik` or `@qwik.dev/core` (aliases followed). Props: the type argument of
  `Component<P>` (the value's type) when the typings are installed; else `component$<P>`'s type
  argument or the annotation of the callback's first parameter, resolved by the checker (inline
  types and repo interfaces need no `node_modules`); no props → no contract (as today).
- The hook runs on changed symbols only, like inferred return types (§6.3).

## MDX routes (Q2)

- `matches`: `.mdx` files under a routes folder.
- **Reading**: no MDX dependency. A line scanner over MDX's code parts: top-level `import` and
  `export` lines, JSX elements whose tag is an imported name, and `{…}` expressions, skipping
  code fences and inline code. On the docs site's 243 `.mdx` routes: 144 import something (347
  import lines, 372 names), 575 elements use an imported name, 2 more sit in code fences;
  138 imported names are not element tags — mostly images passed as `src={img1}`.
- **Shim** `<file>.mdx.symbiote.tsx` next to the file: its import lines verbatim, then one function
  rendering each element verbatim when it parses as TSX on its own (props then type-check like in
  a `.tsx` file), else referencing its tag name; expressions as they are. Each element and
  expression maps to its `.mdx` line; imports are scaffolding (X1).
- **Symbol**: the file is a `template` (`…/index.mdx#template`), hashed over its code parts only:
  a prose edit is no change, a changed element or import is. Exposure `framework`.
- **MDX provider**: the module named by `mdx.providerImportSource` in the router's Vite options
  (a string literal, resolved like an import from `vite.config.ts`) — its `useMDXComponents` is
  `framework`, and an `.mdx` element whose tag is not imported but is a key of the object
  `useMDXComponents` returns is a use of that component (`<Term>` on the docs site).
- **Findings** then follow from X1: a component removed while an `.mdx` still renders it → ✖ at
  the `.mdx` line; a required prop added that an `.mdx` does not pass → ⚠ naming it; a component
  used only by `.mdx` is no orphan (`BenchmarkTable` above).

## CLI hint

`angularHint` becomes a list of known frameworks. Qwik: a changed `.tsx` or `.mdx` file whose
nearest `package.json` names `@builder.io/qwik` or `@qwik.dev/core`, plugin off → once:
`Qwik project: add --plugin qwik to analyze routes and components`.

## Packaging

`packages/plugin-qwik` (`@symbiote/plugin-qwik`) depends on `@symbiote/core` types only: no Qwik, no MDX
parser. Linked from the root `package.json` like the Angular plugin, so `--plugin qwik` works
from a checkout; `qwik` resolves to `@symbiote/plugin-qwik` by the existing naming rule. Graph schema:
no new node or edge kinds (`template` and `framework` exist since X1); `plugins` lists it.

## Verification

1. **Fixtures** (`packages/plugin-qwik/test`), each case with its expected result, red before:
   `qwik-v1` (minimal `@builder.io/qwik` and `qwik-city` typings in a fixture `node_modules`:
   `component$`, `Component`, `routeLoader$` → `Loader`, `routeAction$` → `Action`) with every
   row of the table above; `qwik-v2` (`@qwik.dev/*`, `error.tsx`, `routeConfig`, `plugin@auth.ts`);
   `no-typings` (the same cases by syntax); a `routesDir` set in `vite.config.ts`; an app in
   `apps/site` with nothing at the root (W1). Precision cases: a helper export in a route file
   that nobody calls stays ⚠; an `index.tsx` outside the routes folder keeps its warnings.
   Q2: an `.mdx` route rendering a component (removed → ✖ at the line; required prop added → ⚠;
   only used there → no orphan; prose-only edit → nothing; an element that does not parse →
   name reference, no warning; a component given by the MDX provider and used without import).
2. **No plugin, no change**: goldens, Angular fixtures and the 29 R1 comparisons identical;
   `--plugin qwik` on a non-Qwik repo identical; `--plugin angular --plugin qwik` on the Angular
   fixtures identical.
3. **Qwik docs site**: the same 30 commits without and with the plugin; every finding that
   disappears must be a router-called export, a loader, an entry or an MDX use, and every new one
   is inspected. Expected: the 5 router findings gone after Q1, `BenchmarkTable` and
   `useMDXComponents` after Q2, both `Repos` kept.
4. **MDX scanner** against `@mdx-js/mdx` (in the spike only, not a dependency): on the 243 files,
   the same imports, element tags and lines.
5. **Viewer**: a Qwik starter with commits for a prop added, a route export added and a component
   removed while an `.mdx` uses it → `symbiote view --plugin qwik`: the `.mdx` template with its diff
   and links (screenshot, Playwright like `angular.spec.ts`).
6. **Cost**: +5 % on the docs-site commits at most.

**Risks**

| Risk | Mitigation |
|---|---|
| Qwik changes its route rules | Rules copied from both versions' `getSourceFile`, a fixture per version; a name the plugin does not know keeps today's warnings — never hidden. |
| Real orphans silenced | Only the exports the router reads, values typed as its `Loader`/`Action`, entry modules; precision fixtures. |
| Contract hashes differ from today's | Only with the plugin on. Review marks (I1) on components are flagged ↻ once after turning it on. |
| MDX the scanner misreads (multi-line elements, `<` in expressions) | An element that does not parse becomes a name reference; scanner checked against `@mdx-js/mdx` on 243 files; a file it cannot read is skipped with a warning, as today. |
| Props types are huge (unions, intersections from libraries) | Type text normalized and truncated as for inferred return types (§6.3, decision 11). |

**Order**: fixtures first (red), then route exposures, then the core `contract` hook and
`inputs`, then the plugin's `component$` contract, then the hint — the docs-site comparison
after Q1 — then MDX (Q2) and the comparison again.

## As built (Q1)

Differences from the plan above, and why:

- **The `contract` hook** is `(revision, declaration: VariableDeclaration | ExportAssignment) →
  { label, inputs: ts.Type | undefined }`: default-exported components have props too, and a
  component taking none gets an empty contract (an optional prop added later is then
  `compatible`, not `unknown`). Core builds the display (`const Badge = component$<{ label:
  string; tone: string }>`) from the label and the inputs.
- **It runs in both extraction passes**, not only for changed symbols: `Card`'s code does not
  change when `CardProps` gains a member, so the syntactic pass must already see the contract to
  send `Card` to the second one. It stays cheap: props come from the types written in the code
  (`component$<P>`, `(props: P)`, `const C: Component<P>`) through `getTypeFromTypeNode`, with no
  inference; only untyped props fall back to the value's type (`Component<P>`).
- **Input types are the tokens of their declared type** (as for interface members), the checker's
  text only where there is none: `typeToString` orders a union's members by type creation, which
  can differ between base and head and would make spurious changes.
- **Per JSX site** (not planned; found on the docs site): a props change warned about every user
  not updated, though most do not pass the prop that went away (`Header`'s optional
  `mobileSidebarOpen`, 9 `<Header />` users). JSX references now record the attributes they pass
  (`EdgeRef.passes`, `children` included; unknown with a spread); when only inputs changed, a user
  breaks only if it passes an input that is gone or retyped, or misses one now required. None
  breaking → ℹ "the 9 users not updated pass props that still fit"; else the message names those
  that break. Without inputs nothing changes.
- **Exposure order**: the adapter's `default-export` ("loaded by convention?") is a guess, so a
  plugin's answer now replaces it; every other adapter answer still comes first.
- **Projects**: a file's Qwik project is its package (the nearest `package.json` with a name,
  dependencies or scripts; `{ "type": "module" }` markers are not packages), and Qwik and its
  router may be named there or above — Qwik's own e2e apps have a bare `package.json` and take
  Qwik from the monorepo root. The routes folder is read from `routesDir` as a quoted path or
  built by `resolve`/`join`/`fileURLToPath(new URL(…))` from quoted paths and the config's folder,
  also through a `const`; anything else warns and uses `src/routes`.
- **Loaders and actions by type**: a type alias named `Loader` (declared `Loader_2` in the
  typings), `Loader_2` or `Action` from the router — installed, or, in a monorepo, the package
  named like it.

**Results.** Fixtures `qwik-v1` (with the fake typings `tsc` agrees with — same 3 errors as the
real 1.20.1 typings), the same without `node_modules`, and `qwik-v2` (two folders down, nothing at
the root, `routesDir` from `vite.config.ts`): every row of the table above as planned, plus the
precision cases (helper in a route module, non-handler in a server plugin, non-loader re-exported
by `export *`, route-like export outside the routes folder, Qwik 2's non-route `500.tsx`). `--plugin
qwik` on the 5 core fixtures and with `angular` on 3 Angular fixtures: identical analyses.
Qwik docs site, 30 commits: without the plugin identical to `main` (findings, nodes, edges); with
it the 5 router findings are gone (`head` ×2, route `default` ×3), the 2 `Repos` stay, and the 2
MDX ones wait for Q2; 6 new ℹ, each a real props change now visible (Qwik is not installed there,
so these components' types were `any`): their users were updated or pass props that still fit.
No new warning. Cost: +3.9 % (with and without, 30 commits each).

## As built (Q2)

- **Template IDs** are `…/index.mdx#(template)`, as Angular's external templates (the viewer and
  messages call it `index.mdx`); its signature reads `MDX route`. `matches` takes every `.mdx`
  (it only sees a path); symbols exist for `.mdx` files with code under a routes folder.
  Prose-only files have none: nothing in them to analyze, and a prose edit is no change.
- **The scanner** follows MDX's own tokenizer where the plan's sketch was loose: ESM starts only
  with `import `/`export ` and a space, at column 1, not continuing a paragraph
  (`import("x").Type` at a line start is prose); frontmatter is skipped; fences count at any
  indentation (inside list items). Against `@mdx-js/mdx` 3 on the docs site's 243 routes:
  identical ESM blocks (146) and component elements (585), every content expression found (plus
  53 attribute expressions of HTML elements, which the scanner also reads), no read errors.
- **Elements** are copied self-closed (children are content, not props). TSX's parser turned out
  to accept every valid MDX element tried (it is the more permissive of the two), so the
  name-reference fallback only guards against scanner misreads.
- **The MDX provider** is read by syntax: `providerImportSource` resolved with the app's tsconfig
  (as Vite resolves it), the object `useMDXComponents` returns mapped key → where the provider
  imports that component, and a shim imports each provided tag under its own name. Tried first:
  `<__symbiote_c.Term>` on the provider's return value — props type-check, but TypeScript's
  find-references does not follow a shorthand `{ Term }` property to such uses, so the route did
  not count as a user. Imports it does follow. A provider module's `useMDXComponents` is a
  framework exposure.
- An `.mdx` file's `export` blocks (`export const head`) are code of its template, not symbols.

**Results.** Fixture `qwik-mdx`: a component removed while a route renders it → ✖ at the `.mdx`
line; a required prop a route does not pass → ⚠ naming it (also for a provided component, with
the provider as a second user); components only routes use → no orphan; a prose and inline-code
edit → no change; a prose-only page that gains a component → an added template. Viewer: the route
opens with its own diff and what it renders; a comment on its line goes to the `.mdx` file
(Playwright, `qwik.spec.ts`). Qwik docs site, 30 commits: without the plugin identical to `main`;
with it 7 false findings gone — the 5 router ones of Q1, `BenchmarkTable` (rendered only by its
blog post's `index.mdx`) and `useMDXComponents` (the provider) — both `Repos` kept, no new
warning, no plugin warning; 69 MDX templates in the graphs. Cost on an idle machine, 6 commits
alternating: 67.2 s without, 69.7 s with (+3.7 %)..

## Milestones

| # | Milestone | Output |
|---|---|---|
| Q1 ✅ | Qwik plugin: routes and components | `packages/plugin-qwik`; Qwik and router projects per folder; routes folder from the Vite config; page, layout, error, server plugin, entry and service-worker modules per Qwik's rules (1.x and 2.x); `framework` exposure for router-called exports, loaders and actions (by type, by callee without typings, through re-exports) and app entries; core `contract` hook and `Shape.inputs` compared from the caller's side; `component$` props as the contract; the CLI hint as a list. |
| Q2 ✅ | Qwik plugin: MDX routes | `.mdx` routes as `template` symbols hashed over their code parts; shims with imports, elements (verbatim when they parse, else names) and expressions, mapped to `.mdx` lines; the MDX provider from the Vite config; removed components and missing props found in MDX; no orphans for components only MDX uses. |

**Decisions** (29, 30 and 32 taken with Q1, 31 with Q2):

| # | Question | Decision | Why |
|---|---|---|---|
| 29 | How Qwik is supported | **A `qwik` plugin on X1's hooks, no new adapter**: router conventions as exposures, `component$` props as the contract (a new optional `contract` hook), `.mdx` routes as templates | Qwik is TSX, which Symbiote reads already; what it cannot see is what the router calls by name and what `component$` makes of props. |
| 30 | What a router convention silences | **Only what Qwik's router reads**: the exports it calls by name, values typed as its `Loader`/`Action` (or made by its constructors), entry modules — by Qwik's own file rules | A route file can hold real orphans too; "everything under `routes/` is used" would hide them. |
| 31 | Reading MDX | **A line scanner over MDX's code parts, no MDX dependency**, checked against `@mdx-js/mdx` | The plugin needs imports, element tags and their lines, not markdown; an MDX compiler is megabytes of dependencies for that. |
| 32 | Which users a props change breaks | **Those passing a prop that is gone or retyped, or missing one now required**, read from the attributes at each JSX site (unknown with a spread or outside JSX: may break) | Most users do not pass an optional prop; warning about all of them when one goes away was the only false warning left on Qwik's docs site. |

**Not in Q1–Q2 (later)**: props of plain-function components (Qwik inline components, React) —
the `inputs` comparison fits them, as a core change for TSX; props declared in another file that
is not changed (the component's file is not re-extracted, so only the props type's own finding
shows); `$` closures (`onClick$`, `useTask$`) as symbols of their own; links to a removed route
(`<Link href="/about">`) as `dangling`; `.md` routes and `menu.md`; Qwik's serialization rules
(`eslint-plugin-qwik` checks them).

**Later:** more languages via adapters, a faster core (TS 7 adapter or Rust/oxc), self-hosted team mode.
