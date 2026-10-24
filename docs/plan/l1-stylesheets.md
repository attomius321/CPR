# L1 — Stylesheets in the graph (CSS and SCSS)

[Index](../PLAN.md) · [Journal](../journal/l1-stylesheets.md)

**Status:** planned (2026-10-24), on branch `feature/expand-graph-with-css-scss` (a workspace
started in Symbiote, from `main` at `c4ff77a`); not started: waiting for the person's OK.

**Problem** (asked: "The graph should also know how to interpret CSS/SCSS"). Symbiote's only
adapter is TypeScript/JavaScript (design §2). A stylesheet is listed among the changed files and
nothing more: no symbol, no edge, no finding. Measured on `main` (`c4ff77a`, built here):

| What | Measured |
|---|---|
| Symbiote's own history (461 commits, no merges) | **110 change a stylesheet (24 %)**, 4 of them no TypeScript or JavaScript |
| `symbiote diff 042112a~1 042112a` (6 lines added to `styles.css`) | `1 file changed · 0 symbols changed` |
| `symbiote diff 9220e20~1 9220e20` (V31a: 584 lines of `styles.css`) | 3 symbols, all in tests; the stylesheet: none. Parsed, it is 66 rules added, 1 removed, 145 modified |
| Stylesheet symbols changed per commit, Symbiote's 110 | median 9, p90 62, max 2,230 (`11139e6`, the stylesheet split into parts: 1,115 rules moved) |
| Custom properties (tokens) whose value changed | 10 commits; up to 31 tokens reaching 523 `var()` uses (V31a) |
| Bitwarden · Qwik · vite, last 2,000 commits each | 31 · 39 · 34 change a stylesheet (1.6–1.9 %); vite's are mostly `playground/` (ignored) |
| V43's measure of seven merged branches | 107 of 311 changed files (34 %) are not TypeScript; Review showed none of them |

What the stylesheets hold (a spike with postcss 8.5 and postcss-scss 4.0 over each repo's head;
details in the journal):

| Repo | Stylesheets | Rules | Custom properties (uses, resolved in repo) | SCSS | Parse errors | Parse time |
|---|---|---|---|---|---|---|
| Symbiote (`packages/viewer`, `desktop`) | 43 CSS | 996 | 82 (951 `var()`, 98 %) | — | 0 | 24 ms |
| Bitwarden | 21 CSS, 27 SCSS | 975 (420 nested, 182 with `&`) | 350 (447, 100 %) | 145 `$variables`, 5 mixins (149 `@include`, all in repo), 4 functions, 67 `@import`, 0 `@use` | 0 | 32 ms |
| Qwik (docs, starters, e2e) | 78 CSS | 1,057 | 267 (533, 85 %) | — | 0 | 27 ms |

Two selectors repeated in one file and one context are rare: 5–6 per ~1,000 rules.

**Goal**: a changed stylesheet is a set of changed symbols in the graph — rules, custom
properties, keyframes, SCSS variables, mixins, functions and placeholders — with the links
between them across the repository's stylesheets (a rule uses a token, a mixin, a variable), the
blast radius of a token or a mixin, and findings when a removal leaves uses behind. A reformat
changes nothing. **The TypeScript analysis does not change**: a commit with no stylesheet change
gives a graph identical to `main`'s, and in one with stylesheet changes every TypeScript node,
edge and finding is the same as on `main`.

## How stylesheets join the pipeline (core)

- A second **language adapter**, `packages/core/src/lang/css/` (`stylesheetAdapter`), for `.css`
  and `.scss`. Not a plugin of the TypeScript adapter: CSS is a language, and design §4 keeps
  framework knowledge in plugins and languages behind `LanguageAdapter`. Plugin hooks are built
  on TypeScript programs and nodes; nothing in them fits a stylesheet.
- `combineAdapters([typescript, stylesheets])` (`src/adapters.ts`) is the one adapter the
  pipeline is given, so `pipeline.ts` and `LanguageAdapter` keep their shape: `matches` is either
  adapter's; `extract` splits files by adapter; `incoming`, `outgoing`, `exposure`, `publicApi`
  go to the adapter of the symbol's file; `dangling` gives each adapter only its own removed
  symbols (so TypeScript never looks for `$primary`); `projects` and `warnings` are joined.
- `load` lists the revision's stylesheets (outside `node_modules`, `.git` and ignored paths) and
  parses them only when a changed file is a stylesheet: with none, the stylesheet adapter does no
  work, so commits without stylesheets cost what they cost today.
- The CLI (`diff`, `view`, `pr`) builds `combineAdapters([createTypescriptAdapter({ plugins }),
  stylesheetAdapter])`. `analyzeDirectories` and `analyzeGit` default to the same pair.
- Each node's `language` is its adapter's: `css`, `scss` or `typescript` (the field exists; it
  was a constant). A package or dynamic node takes the language of the code that references it.
- Skipped like `*.min.js` and `.d.ts`: `*.min.css`. `.symbioteignore` applies as to any file
  (`*.css` turns stylesheets off for a repository).

## Symbols and IDs

IDs keep the rule `<path>#<qualified name>`, the name written as CSS writes it. Contexts (an
at-rule, the rule a custom property is defined in) are joined by ` › ` (U+203A, spaced), which no
selector or prelude contains; a second identical key in one file gets ` (2)`, ` (3)` (measured:
0.5 % of rules).

| Symbol | Kind | ID example | Signature hash | Body hash |
|---|---|---|---|---|
| A rule: selector and its own declarations | `rule` (new) | `src/ui/controls.css#.button:hover`, `src/shell/Sidenav.css#@media (max-width: 900px) › .sidenav` | its selector and context (its identity) | its declarations in order, `@include` and `@extend` lines; not nested rules, not custom properties (symbols of their own) |
| A nested SCSS rule | `rule`, contained by its parent rule | `.box { .header {…} &:hover {…} }` → `#.box .header`, `#.box:hover` (the resolved selector) | as above | as above |
| A custom property definition | `variable`, contained by its rule | `src/ui/base.css#:root › --accent`, `#:root[data-theme='light'] › --accent` | name, context | its value |
| A top-level SCSS variable | `variable` | `src/scss/variables.scss#$primary` | name, `!default`/`!global` | its value |
| A mixin | `mixin` (new) | `#@mixin themify` | name, parameters and defaults | its contents |
| A function | `function` | `#@function rem` | name, parameters and defaults | its contents |
| A placeholder | `rule` | `#%button-base` | selector | as a rule |
| Keyframes | `keyframes` (new) | `#@keyframes spin` | name | the whole block |
| Top-level `@include` and other code outside a rule | — | `#(module)`, as today | | |

- **Hashes from tokens**: postcss-value-parser's tokens for values, postcss's nodes for the rest.
  Ignored: whitespace, comments, quote style, the last `;`, what Prettier's CSS formatting
  changes. Kept: declaration order (in CSS a later declaration wins).
- `signature` (the display text): a rule's selector with its context; `--accent: #3b82f6`;
  `@mixin themify($theme: light)`; `@keyframes spin`.
- **Moves and renames** come from `diffSymbols` unchanged: a rule moved to another file keeps
  its selector (rule b); a selector renamed with an identical body of ≥ 10 tokens is a rename
  (rule c), with `previousId`; nested rules follow their container (their ID starts with the
  parent's). Ordering by depth uses the container chain, not the dots in the name (a selector's
  dots are not nesting); for TypeScript the two are the same.
- `shape` for mixins and functions: parameters (optional when they have a default), so
  `signature-changed` judges compatibility as for a TypeScript function. Other symbols: none.
- `exported`: SCSS members whose name starts with `-` or `_` are private under `@use`; everything
  else in a stylesheet is global.

## References between stylesheets

Edges use the existing kinds: `@include` and a function call → `call`; `$var`, `var(--x)` and an
`animation`/`animation-name` keyframes name → `reference`; `@extend` → `extends`.

- **Custom properties and keyframes** are global (the cascade applies any stylesheet's
  definition): `var(--accent)` links to every definition of `--accent` in the revision's
  stylesheets — the dark and the light one. A name defined nowhere in the repository (React
  Flow's `--xy-*`, a property set from script) gives no edge.
- **SCSS members** resolve as Sass resolves them: `@use 'x' as ns` (`ns.$var`, `ns.mixin()`) and
  `@forward` chains precisely; `@import` (Bitwarden's only form) by the import graph — the file's
  own earlier definitions, what it imports, and what the files importing it imported before it.
  Import paths: relative, partials (`_x.scss`), `x/_index.scss`; `~pkg/…` and bare package paths
  are `node_modules` → a package node (`bootstrap#$primary`). Two candidates or none → an
  `unknown` edge (`resolution: "unknown"`), never a guess drawn as resolved.
- `@apply` (Tailwind: 52 in Bitwarden, 238 in Qwik) is hashed with the rule's body and gives no
  edges in L1.
- Context nodes: the neighbours of changed stylesheet symbols, as for TypeScript (`--depth`).
  A token's users can be many (523 `var()` uses in V31a): the viewer's summaries for big
  neighbourhoods (over 8) already draw them; the 2,000-symbol context cap applies.

## Findings

Detectors stay generic; the adapter feeds them (`dangling`, `exposure`, `shape`). Severities:

| Rule | When | Severity |
|---|---|---|
| `removed-still-referenced` | A removed SCSS variable, mixin, function or placeholder is still used by a stylesheet in head, where nothing visible defines it | **error**: Sass fails to compile |
| `removed-still-referenced` | Every definition of a custom property, or keyframes, is gone, and `var(--x)` / `animation` still name it | **warning** (`certainty: unknown`): a script or inline style may still set it; the page silently falls back |
| `orphan-added` | An added mixin, function or placeholder that no stylesheet uses | warning, as for TypeScript |
| `orphan-added` | Rules, custom properties, keyframes, SCSS variables | **never** (exposure `framework`): markup, scripts and libraries use them where L1 cannot see; a SCSS variable is often a library's setting (`$primary` before `@import 'bootstrap'`) |
| `signature-changed` | A mixin's or function's parameters changed while `@include`s in other files did not | by compatibility, as for TypeScript (a parameter without a default added: breaking) |
| `exported-api-changed` | — | never in L1 (no published-stylesheet API) |

## Graph JSON (0.7.0), viewer, CLI

- Schema **0.7.0** (minor): node kinds `rule`, `mixin`, `keyframes`; `language` values `css`,
  `scss`. `schema/graph.schema.json`, `docs/graph-schema.md` (kinds, ID examples, history line);
  goldens change only `schemaVersion`.
- The viewer draws stylesheet nodes like any symbol (the label is the ID's local part; the kind
  chip says `rule`); the detail panel shows the symbol's diff from `/api/source` (graph files
  only, as today). Older graphs open unchanged. Checked for selectors in IDs: quotes, `>`, `#`,
  `[…]` and spaces through the change list, search, selection, review marks and comments
  (`findingMarker` already URI-encodes the symbol).
- The CLI summary prints them like other symbols (`~ rule .sidebar .row (body) · used by 3`).
- README: the languages Symbiote reads; design §2 ("v1 does") gains CSS and SCSS.

## Parser (new runtime dependencies of core)

`postcss` 8.5, `postcss-scss` 4.0, `postcss-value-parser` 4.2 — about 0.8 MB with their three
dependencies (`nanoid`, `picocolors`, `source-map-js`); postcss 8.5.28 is already in the
lockfile (through Vite). Why: tolerant parsers with 1-based positions, the ones stylelint and
Vite use; 0 parse errors on 169 real stylesheets; a SCSS parser of our own would be a project of
its own. css-tree reads no SCSS; the `sass` package compiles and exposes no syntax tree; the Sass
team's newer `sass-parser` is the fallback if postcss-scss misreads something in L1c. Pinned
exactly, like ts-morph.

## Verification

1. **Fixtures first** (red before), `test/fixtures/diff/css-*` and `scss-*`, each with its
   expected graph: a rule's declaration edited (body), added, removed; a selector renamed with
   the same body (moved, `previousId`); a rule moved to another file; a token's value changed,
   with its users in two files as context; dark and light definitions; a reformat by Prettier
   (nothing changed); SCSS nesting with `&`, `@media` inside a rule, a selector list; partials
   through `@import` (the importer-order case) and `@use … as` / `@forward`; a mixin with a new
   required parameter (`signature-changed`, includes in another file); a removed mixin still
   included (error); a removed token still used (warning); an added mixin no one includes
   (orphan); an added rule, token and keyframes (no orphan); an ambiguous `$var` (unknown edge);
   a `*.min.css` (skipped); duplicate selectors (`(2)`).
2. **Hash stability on real code**: every stylesheet of Symbiote's repository and Bitwarden's
   reformatted with Prettier → 0 changed stylesheet symbols.
3. **Nothing else changes**: every golden but `schemaVersion`; `test/plugins.test.ts`;
   `regression-check` `r1` (29), `bitwarden` (10) and `qwik-docs` (30) against `main`: TypeScript
   edges and findings identical; differences only in stylesheet nodes and edges, each explained.
4. **Real stylesheet commits**: a new regression set `stylesheets` — Symbiote's 110, Bitwarden's
   31, Qwik's 39 commits — run on L1: no crash; stylesheet symbols per commit (expect the spike's
   median 9, p90 62 on Symbiote); every finding read in the source and recorded right or wrong.
5. **Viewer**: an e2e spec on a stylesheet fixture (nodes, labels, the detail diff, a comment on a
   rule); `viewer-check` on the largest real graphs (`11139e6`, `9220e20`): screenshot and first
   paint against a TypeScript graph of the same size.
6. **Cost**: commits without stylesheets: `r1` time unchanged; with them, the measured parse cost
   is 18–32 ms per side: a budget of +5 % on the `stylesheets` set's run time.

**Risks**

| Risk | Mitigation |
|---|---|
| Selectors in IDs (quotes, `>`, `#`, spaces) break a consumer that splits or embeds IDs | Every split found by grep takes the first `#`; an e2e and a forge-marker test with such IDs; `findingMarker` encodes already |
| Sass `@import` resolution guesses wrong | Precise for `@use`; for `@import` the importer order; ambiguous → `unknown`, never resolved |
| Generated stylesheets (Bitwarden's icon font CSS: 133–269 rules a commit) swamp the graph | They are changes like any; `.symbioteignore`; measured in the `stylesheets` set |
| A token change pulls hundreds of context rules | Summary nodes over 8 neighbours; the context cap; viewer-check on V31a's graph |
| False dangling for a token set by script | Warning, not error; only when the repo's own definition was removed and a use remains |
| The dot-based depth in `diff.ts`/`detectors.ts` misorders CSS names | Depth from the container chain; TypeScript identical (goldens, `r1`) |
| New runtime dependencies in core | Three small postcss packages, pinned; recorded here |

**Order**: the combined adapter with an empty stylesheet adapter first (the `r1` comparison must be
identical before anything else), then CSS symbols and hashes, then SCSS, then references, then
findings, then the viewer and CLI.

## Milestones

| # | Milestone | Output |
|---|---|---|
| L1a | Two adapters, one pipeline | `combineAdapters`, per-node `language`, the CLI's pair; `r1` identical |
| L1b | CSS symbols | Rules, custom properties, keyframes; hashes from tokens; moves; schema 0.7.0 |
| L1c | SCSS | Nesting, variables, mixins, functions, placeholders; `@use`/`@forward`/`@import` resolution |
| L1d | References and findings | Edges inside stylesheets, context, `dangling`, exposure, shapes; the `stylesheets` set |
| L1e | Viewer and CLI | Kinds in the summary and the viewer; e2e; viewer-check; README, design §2 |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 299 | Where stylesheets are read | **A second language adapter in core, joined to TypeScript's by `combineAdapters`**; not a plugin | Design §4: languages behind `LanguageAdapter`, frameworks as plugins; plugin hooks are TypeScript programs and nodes |
| 300 | On by default? | **Yes**, like JavaScript; `.symbioteignore` turns files off | A language, not a framework: Symbiote's own history is 24 % stylesheet commits that show nothing today; without a changed stylesheet nothing changes |
| 301 | What a symbol is | **A rule (selector and its own declarations), a custom property definition, keyframes; SCSS top-level variables, mixins, functions, placeholders** | What a reviewer decides about: a rule's look, a token's value, a mixin's contract. A class has no single definition (it is in many rules) |
| 302 | Their IDs | **CSS's own notation** (`.a .b`, `--x`, `$x`, `@mixin x`, `%x`, `@keyframes x`), **contexts joined by ` › `**, nested rules by their resolved selector, a repeat ` (2)` | Readable as CSS; no selector contains ` › `; repeats are 0.5 % of rules |
| 303 | Scope of names | **Custom properties and keyframes: global over the revision's stylesheets; SCSS members: Sass's rules (`@use`, `@forward`, `@import` order); two candidates or none → `unknown`** | The cascade is global; Sass is not. Precise beats complete |
| 304 | Findings | **Removed SCSS member still used: error; removed token or keyframes still used: warning; orphans only for mixins, functions, placeholders** | Sass fails on the first, the browser falls back silently on the second; rules and tokens are used by markup and scripts L1 cannot see |
| 305 | Parser | **postcss 8.5 + postcss-scss 4.0 + postcss-value-parser 4.2**, pinned | 0 errors on 169 real stylesheets, 18–32 ms a revision, positions included; no SCSS syntax tree elsewhere |
| 306 | Markup → stylesheets | **Not in L1**: L2, planned on L1's measurements | Bitwarden names 21 % of its classes in static markup (Symbiote 68 %); its markup is mostly Tailwind (1,137 of 1,247 static class names have no rule): its own milestone, with its own precision cases |

**Not in L1 (later)**:
- **L2 — markup uses stylesheets**: a component's stylesheet (`import './x.css'`, Angular
  `styleUrls`/`styleUrl` and inline `styles`, Qwik `useStyles$`/`useStylesScoped$` — 99 and 78
  calls in Qwik, with 69 `?inline` imports), CSS modules (`styles.row` → `x.module.css#.row`, 9
  imports in Qwik), static class names in JSX and templates → rules (68 % of Symbiote's viewer
  classes, 21 % of Bitwarden's), a removed class still in static markup, tokens set from script.
- Less (11 files in vite) and indented Sass (3 in vite), all in `playground/`, none elsewhere in
  the five repos; CSS-in-JS; Vue and Svelte `<style>` blocks; Tailwind's `@apply` and `theme()`
  as edges; a published stylesheet API.
