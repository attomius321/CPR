# L1–L2 — Stylesheets in the graph (CSS and SCSS)

[Index](../PLAN.md) · [Journal](../journal/l1-l2-stylesheets.md)

**Status:** planned (2026-10-24), on branch `feature/expand-graph-with-css-scss` (a workspace
started in Symbiote, from `main` at `c4ff77a`). The person's OK on the first plan, with three
answers: L1 **and** L2 on this branch, stylesheets read **by default**, and the workspace's own
branch (not `milestone/l1-…`) — "this is how we will work from now on". Built (2026-10-24):
ready for review; "As built" and results at the end.

**Problem** (asked: "The graph should also know how to interpret CSS/SCSS"). Symbiote's only
adapter is TypeScript/JavaScript (design §2). A stylesheet is listed among the changed files and
nothing more: no symbol, no edge, no finding; and nothing links a component to the rules that
style it. Measured on `main` (`c4ff77a`, built here):

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

How markup names them:

| Repo | Classes in the repo's selectors | Named in a static `class`/`className` | Only in other strings (`tone-${x}`, conditions) | In no markup string | Static class names with no rule |
|---|---|---|---|---|---|
| Symbiote (viewer TSX) | 556 | 376 (68 %) | 92 | 88 (React Flow's own, built names) | 16 of 392 |
| Bitwarden (templates, TS) | 519 | 110 (21 %) | 241 | 168 | 1,137 of 1,247 (Tailwind's `tw-…`) |

Qwik loads stylesheets through its framework: 99 `useStyles$` and 78 `useStylesScoped$` calls,
69 `?inline` imports, 9 CSS-module imports.

**Goal**: a changed stylesheet is a set of changed symbols in the graph — rules, custom
properties, keyframes, SCSS variables, mixins, functions and placeholders — linked to each other
across the repository's stylesheets (a rule uses a token, a mixin, a variable) and to the markup
that renders them (a component's `className="row"` → the rules for `.row`); a token's or a
rule's blast radius reaches the components; a removal that leaves uses behind is a finding. A
reformat changes nothing. **The TypeScript analysis keeps its results**: no TypeScript node,
TypeScript-to-TypeScript edge or finding differs from `main`; what is added are stylesheet nodes,
their edges, and edges from markup to them.

## L1 — Stylesheets as a language

### How stylesheets join the pipeline (core)

- A second **language adapter**, `packages/core/src/lang/css/` (`stylesheetAdapter`), for `.css`
  and `.scss`. Not a plugin of the TypeScript adapter: CSS is a language, and design §4 keeps
  framework knowledge in plugins and languages behind `LanguageAdapter`. Plugin hooks are built
  on TypeScript programs and nodes; nothing in them fits a stylesheet.
- `combineAdapters([typescript, stylesheets])` (`src/adapters.ts`) is the one adapter the
  pipeline is given, so `pipeline.ts` and `LanguageAdapter` keep their shape: `matches` is either
  adapter's; `extract` splits files by adapter; `incoming`, `outgoing`, `exposure`, `publicApi`
  go to the adapter of the symbol's file (plus L2's links, below); `dangling` gives each adapter
  only its own removed symbols (so TypeScript never looks for `$primary`); `projects` and
  `warnings` are joined.
- `load` lists the revision's stylesheets (outside `node_modules`, `.git` and ignored paths) and
  parses them only when needed: a changed stylesheet, or a markup link to resolve (L2).
- The CLI (`diff`, `view`, `pr`) builds `combineAdapters([createTypescriptAdapter({ plugins }),
  stylesheetAdapter])`; `analyzeDirectories` and `analyzeGit` default to the same pair.
- Each node's `language` is its adapter's: `css`, `scss` or `typescript` (the field exists; it
  was a constant). A package or dynamic node takes the language of the code that references it.
- Skipped like `*.min.js` and `.d.ts`: `*.min.css`. `.symbioteignore` applies as to any file
  (`*.css` turns stylesheets off for a repository).

### Symbols and IDs

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

### References between stylesheets

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
  edges.
- Context nodes: the neighbours of changed stylesheet symbols, as for TypeScript (`--depth`).
  A token's users can be many (523 `var()` uses in V31a): the viewer's summaries for big
  neighbourhoods (over 8) already draw them; the 2,000-symbol context cap applies.

### Findings

Detectors stay generic; the adapter feeds them (`dangling`, `exposure`, `shape`). Severities:

| Rule | When | Severity |
|---|---|---|
| `removed-still-referenced` | A removed SCSS variable, mixin, function or placeholder is still used by a stylesheet in head, where nothing visible defines it | **error**: Sass fails to compile |
| `removed-still-referenced` | Every definition of a custom property, or keyframes, is gone, and `var(--x)` / `animation` still name it (and no script sets it, L2) | **warning** (`certainty: unknown`): the page silently falls back |
| `orphan-added` | An added mixin, function or placeholder that no stylesheet uses | warning, as for TypeScript |
| `orphan-added` | Rules, custom properties, keyframes, SCSS variables | **never** (exposure `framework`): markup, scripts and libraries use them in ways Symbiote does not fully see (built class names, a library's `$primary` setting) |
| `signature-changed` | A mixin's or function's parameters changed while `@include`s in other files did not | by compatibility, as for TypeScript (a parameter without a default added: breaking) |
| `exported-api-changed` | — | never (no published-stylesheet API) |

## L2 — Markup uses stylesheets

### Mentions: where code names a class or a custom property

A new optional adapter method, `mentions(revision, names)`: the places this language's code names
a class or a custom property, each with its enclosing symbol (named as extraction names it), its
site, the name, and — for a CSS module — the module's file. Found by a text prefilter (only files
whose text contains one of the names asked for), then a walk of those files' syntax trees.

- **JSX** (`packages/core`, React, Qwik, Solid alike): a `class` or `className` attribute — every
  string literal and template-literal text inside its value, split on whitespace; a token touching
  `${…}` is dropped (`tone-${x}` names no class); object-literal keys inside it (`clsx({ active
  })`, Qwik's `class={{ active: x }}`); array elements (`class={['a', on && 'b']}`).
- **The DOM**: string arguments of `classList.add/remove/toggle/replace/contains`.
- **CSS modules** (a bundler convention, in core): `import styles from './x.module.css'` (or
  `.module.scss`), then `styles.row` or `styles['row']` → `row` in that module only.
- **Custom properties from script**: a JSX `style` object key `'--x'` and `setProperty('--x', …)`
  set it; `var(--x)` inside a string and `getPropertyValue('--x')` use it.
- **Angular templates** (plugin hook `mentions`): `class="a b"`, `[class.a]`, `[ngClass]` keys
  and strings, `[class]` strings — owned by the template symbol. Without `--plugin angular`
  templates are not read, as today.
- Not mentions: strings elsewhere (`const cls = 'row'`), `querySelector` selectors, built names.
  Precise beats complete: 68 % of Symbiote's classes and 21 % of Bitwarden's are named statically.

### Scopes: which stylesheets a mention can reach

A new optional adapter method, `styleScopes(revision)`, with a plugin hook of the same name:
stylesheets that apply only to some markup. Everything not listed is **global**.

| Scope | Declared by | Reached from |
|---|---|---|
| CSS module (`*.module.css`, `*.module.scss`) | core | its importers' `styles.x` only |
| Angular component styles (`styleUrls`, `styleUrl`, `styles`; emulated encapsulation, the default) | Angular plugin | the component's template and class; `ViewEncapsulation.None` → global |
| Qwik `useStylesScoped$(styles)` with `import styles from './x.css?inline'` | Qwik plugin | the component calling it; `useStyles$` → global |
| Anything else (`import './x.css'`, `@import`, `angular.json` styles, `<link>`) | — | every mention |

Loading a stylesheet is not an edge of its own (Symbiote's viewer loads every part through one
`styles.css`: such an edge says nothing); it only decides the scope.

### Edges

`reference` edges, from the mentioning symbol:

- **A class** → every rule in reach whose selector has the class: certain when the class is in
  the rule's subject (its last compound: `.row`, `.list .row:hover`); `possible` when it is only
  in an ancestor or sibling compound (`.selected .icon` styles the icon, not the selected element).
- **A custom property used by script** → its definitions, as `var()` in a stylesheet.
- Both directions, as for TypeScript: a changed rule's incoming are the components that render
  its classes (its blast radius); a changed component's outgoing are the rules it renders.

### The finding

`removed-still-referenced`, **warning** (`certainty: unknown`): a class that the removed rules
styled in base, which no rule in reach styles in head, and which markup in head still names —
"`.badge-new` was removed, but `SidebarRow` still renders class `badge-new`". Also a CSS module's
`styles.row` whose `.row` is gone. A Tailwind utility never had a rule in the repository, so it is
never reported; a class still styled by another rule is not either. A custom property set by
script is not dangling when its stylesheet definition goes (L1's warning gives way).

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
- README: the languages Symbiote reads and what links markup to stylesheets; design §2 gains CSS
  and SCSS; the plugin hooks in `x1-plugins.md`'s contract and the framework-plugin skill.

## Parser (new runtime dependencies of core)

`postcss` 8.5, `postcss-scss` 4.0, `postcss-value-parser` 4.2 — about 0.8 MB with their three
dependencies (`nanoid`, `picocolors`, `source-map-js`); postcss 8.5.28 is already in the
lockfile (through Vite). Why: tolerant parsers with 1-based positions, the ones stylelint and
Vite use; 0 parse errors on 169 real stylesheets; a SCSS parser of our own would be a project of
its own. css-tree reads no SCSS; the `sass` package compiles and exposes no syntax tree; the Sass
team's newer `sass-parser` is the fallback if postcss-scss misreads something in L1c. Selectors
are split by a small tokenizer of our own (compounds and classes only), unless it proves wrong,
then `postcss-selector-parser`. Pinned exactly, like ts-morph.

## Verification

1. **Fixtures first** (red before), `test/fixtures/diff/css-*`, `scss-*` and `markup-*`, each with
   its expected graph:
   - L1: a rule's declaration edited (body), added, removed; a selector renamed with the same body
     (moved, `previousId`); a rule moved to another file; a token's value changed, with its users
     in two files as context; dark and light definitions; a reformat by Prettier (nothing
     changed); SCSS nesting with `&`, `@media` inside a rule, a selector list; partials through
     `@import` (the importer-order case) and `@use … as` / `@forward`; a mixin with a new required
     parameter (`signature-changed`); a removed mixin still included (error); a removed token
     still used (warning); an added mixin no one includes (orphan); an added rule, token and
     keyframes (no orphan); an ambiguous `$var` (unknown edge); a `*.min.css` (skipped);
     duplicate selectors (`(2)`).
   - L2: a static `className` → its rule (certain) and a descendant rule (possible); a template
     literal with `${}`; `clsx` keys; `classList.add`; a CSS module; a removed class still
     rendered (warning); a class with no rule (no edge, no finding); a class still styled by
     another rule (no finding); a token removed from stylesheets but set by `style={{ '--x' }}`
     (no finding); `var(--x)` in an inline style (edge). Angular: a template's `class` and
     `[class.x]` → its component's `styleUrls` rules, not another component's; `encapsulation:
     None` → global. Qwik: `useStylesScoped$` reaches only its component. Without the plugins,
     the plugin fixtures give no template edges, as today.
2. **Hash stability on real code**: every stylesheet of Symbiote's repository and Bitwarden's
   reformatted with Prettier → 0 changed stylesheet symbols.
3. **Nothing else changes**: every golden but `schemaVersion`; `test/plugins.test.ts`;
   `regression-check` `r1` (29), `bitwarden` (10) and `qwik-docs` (30) against `main`: TypeScript
   nodes, TypeScript-to-TypeScript edges and findings identical; every added edge ends at a
   stylesheet symbol; every difference explained.
4. **Real stylesheet commits**: a new regression set `stylesheets` — Symbiote's 110, Bitwarden's
   31, Qwik's 39 commits — run on this branch: no crash; stylesheet symbols per commit (expect the
   spike's median 9, p90 62 on Symbiote); every finding read in the source and recorded right or
   wrong; markup edges per commit.
5. **Viewer**: an e2e spec on a stylesheet fixture (nodes, labels, the detail diff, a comment on a
   rule, a component's edge to its rule); `viewer-check` on the largest real graphs (`11139e6`,
   `9220e20`): screenshot and first paint against a TypeScript graph of the same size.
6. **Cost**: the stylesheets' parse is 18–32 ms per side; mentions are prefiltered by text. Budget:
   `r1` +5 % at most, the `stylesheets` and `qwik-docs` sets +5 % over what their new nodes need.

**Risks**

| Risk | Mitigation |
|---|---|
| Selectors in IDs (quotes, `>`, `#`, spaces) break a consumer that splits or embeds IDs | Every split found by grep takes the first `#`; an e2e and a forge-marker test with such IDs; `findingMarker` encodes already |
| Sass `@import` resolution guesses wrong | Precise for `@use`; for `@import` the importer order; ambiguous → `unknown`, never resolved |
| Generated stylesheets (Bitwarden's icon font CSS: 133–269 rules a commit) swamp the graph | They are changes like any; `.symbioteignore`; measured in the `stylesheets` set |
| A token or a common class pulls hundreds of context nodes | Summary nodes over 8 neighbours; the context cap; viewer-check on V31a's graph |
| A class name is common (`row`, `active`) and global CSS matches every component naming it | That is what global CSS does; scoped sheets (Angular, Qwik, CSS modules) are matched in their scope only; edges to ancestor-only matches are `possible` |
| A class kept in markup as a script or test hook gets a removed-class warning | Only when its own rules were removed in this change; warning, not error |
| False dangling for a token set by script | Script definitions found by L2 silence it; otherwise a warning |
| Mentions scan every TypeScript file | Text prefilter on the names asked for; time measured on `r1`, `bitwarden`, `qwik-docs` |
| The dot-based depth in `diff.ts`/`detectors.ts` misorders CSS names | Depth from the container chain; TypeScript identical (goldens, `r1`) |
| New runtime dependencies in core | Three small postcss packages, pinned; recorded here |

**Order**: the combined adapter with an empty stylesheet adapter first (the `r1` comparison must be
identical before anything else), then CSS symbols and hashes, then SCSS, then references and
findings inside stylesheets; then mentions in core, scopes and the plugins, the removed-class
finding; the viewer, CLI and docs last.

## Milestones

| # | Milestone | Output |
|---|---|---|
| L1a | Two adapters, one pipeline | `combineAdapters`, per-node `language`, the CLI's pair; `r1` identical |
| L1b | CSS symbols | Rules, custom properties, keyframes; hashes from tokens; moves; schema 0.7.0 |
| L1c | SCSS | Nesting, variables, mixins, functions, placeholders; `@use`/`@forward`/`@import` resolution |
| L1d | References and findings | Edges inside stylesheets, context, `dangling`, exposure, shapes; the `stylesheets` set |
| L2a | Mentions in core | JSX classes, `classList`, CSS modules, custom properties from script; edges both ways |
| L2b | Scopes and plugins | `styleScopes`; Angular templates' classes and component styles; Qwik `useStylesScoped$` |
| L2c | The removed class | `removed-still-referenced` for a class still rendered; script-set tokens silence L1's warning |
| L1e | Viewer, CLI, docs | Kinds in the summary and the viewer; e2e; viewer-check; README, design §2, schema docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 299 | Where stylesheets are read | **A second language adapter in core, joined to TypeScript's by `combineAdapters`**; not a plugin | Design §4: languages behind `LanguageAdapter`, frameworks as plugins; plugin hooks are TypeScript programs and nodes |
| 300 | On by default? | **Yes**, like JavaScript; `.symbioteignore` turns files off (the person's answer) | A language, not a framework: Symbiote's own history is 24 % stylesheet commits that show nothing today |
| 301 | What a symbol is | **A rule (selector and its own declarations), a custom property definition, keyframes; SCSS top-level variables, mixins, functions, placeholders** | What a reviewer decides about: a rule's look, a token's value, a mixin's contract. A class has no single definition (it is in many rules) |
| 302 | Their IDs (signatures: 329) | **CSS's own notation** (`.a .b`, `--x`, `$x`, `@mixin x`, `%x`, `@keyframes x`), **contexts joined by ` › `**, nested rules by their resolved selector, a repeat ` (2)` | Readable as CSS; no selector contains ` › `; repeats are 0.5 % of rules |
| 303 | Scope of names inside stylesheets | **Custom properties and keyframes: global over the revision's stylesheets; SCSS members: Sass's rules (`@use`, `@forward`, `@import` order); two candidates or none → `unknown`** | The cascade is global; Sass is not. Precise beats complete |
| 304 | Findings inside stylesheets | **Removed SCSS member still used: error; removed token or keyframes still used: warning; orphans only for mixins, functions, placeholders** | Sass fails on the first, the browser falls back silently on the second; rules and tokens are used where Symbiote does not fully see |
| 305 | Parser | **postcss 8.5 + postcss-scss 4.0 + postcss-value-parser 4.2**, pinned | 0 errors on 169 real stylesheets, 18–32 ms a revision, positions included; no SCSS syntax tree elsewhere |
| 306 | Markup → stylesheets | **L2, on this branch with L1** (the person's answer) | Without it a rule's change reaches no component: the reviewer's "who is affected?" |
| 307 | What names a class in markup | **Static strings and object keys inside a `class`/`className` attribute; `classList` arguments; CSS modules' `styles.x`; Angular templates' `class`, `[class.x]`, `[ngClass]`, `[class]`**; not other strings, not tokens touching `${}` | 68 % (Symbiote) and 21 % (Bitwarden) of classes are named so; a string elsewhere or a built name is a guess |
| 308 | Which rules a mention reaches (revised by 330) | **Global stylesheets' rules with the class; a scoped sheet (Angular component styles, Qwik `useStylesScoped$`) only from its component; a CSS module only through its import; `possible` when the class is not in the rule's last compound** | How the browser and the frameworks apply them; an ancestor class does not style the element |
| 309 | A removed class | **Warning, when the class's rules in reach were removed, none is left, and markup still names it** | Its element silently loses its look; Tailwind's names never had rules, so they are never reported |
| 310 | Custom properties from script | **`style` keys and `setProperty` set; `var()` in strings and `getPropertyValue` use**; a token set by script is not dangling | Symbiote's viewer sets 7 from script (6 JSX `style` keys such as `'--sidebar-width'`, `setProperty('--symbiote-zoom')`) and reads 2 (`getPropertyValue('--side')`) |
| 311 | Plugin API | **Optional hooks `mentions` and `styleScopes`; API version stays 1** | Adding an optional hook is compatible (core `CLAUDE.md`) |
| 312 | Loading a stylesheet | **Not an edge; it decides the scope** | Symbiote's viewer loads all 42 parts through one `styles.css`: a load edge says nothing a reviewer needs |

**Not in L1–L2 (later)**:
- Less (11 files in vite) and indented Sass (3 in vite), all in `playground/`, none elsewhere in
  the five repos; CSS-in-JS; Vue and Svelte `<style>` blocks; Tailwind's `@apply`, `theme()` and
  utility classes as edges; a published stylesheet API; `querySelector` selectors and Playwright
  locators as uses.

## As built (L1–L2)

- **Order**: as planned (L1a–L1d, L2a–L2b, docs), with L2c (the removed class, tokens set by
  script) built inside L2a, and the exposure that keeps rules and tokens from being orphans moved
  up to L1b: the first real run (`042112a`) showed an orphan warning for every new rule.
- **SCSS extraction came with L1b's walk**: L1c's symbol tests passed when written; L1c's real
  work was name resolution (`scope.ts`), built with L1d's references.
- **A selector change is a move** (decision 329): rules, custom properties and keyframes have a
  constant signature hash. Planned: the selector as signature. On Symbiote's history that made
  `signature-changed` warnings for selector lists gaining a member (`b5f0dad`: "10 of 12 users
  not updated") — noise; a rename's real risk is caught by the removed-class finding on the old
  declaration. Mixins, functions and `$variables` keep their signatures.
- **A rule reaches markup only from files rendering all its classes** (decision 330). Planned:
  any mention of a class in the rule's subject. On `042112a`, `.merge-row-actions .button` got 13
  users — every `button` renderer; one renders `merge-row-actions`. `possible` now means another
  symbol of the file supplies the rule's other classes. Given up: rules whose classes are rendered
  in different files (a theme class on a container) have no markup users.
- **A class named only in `:not()` is still styled**: `3fff617` replaced
  `.button.primary` with `.button:not(.primary)`, which read as "nothing styles `primary`".
- **Prettier stability needed one more case**: postcss-value-parser keeps `url($path + "a.svg")`
  as one word, quotes included; such `url()`s are re-read as values.
- **A finding's users are joined with `; `** when a name holds a comma (a selector list), as on
  Qwik's `f2b5479d7`.
- **Mentions through a word index** built once per revision: each name query had re-read every
  unmatched file (11139e6: 6.1–6.6 s → 4.5 s; `main` 3.8 s, reading no stylesheets).
- **Unresolved SCSS names** are `unknown:$x`, `unknown:v.$x`, `unknown:@include m`; an
  ambiguous one is an edge to each candidate with `resolution: "unknown"`.
- **The viewer needed no change**: it is kind- and language-agnostic; an e2e spec
  (`e2e/stylesheets.spec.ts`) covers a rule's and a token's diff, users and a comment.
- **A CSS-only commit now loads the TypeScript program** (markup's mentions): Bitwarden's
  `c1cfaabfb1` went from 26 ms (nothing analyzed on `main`) to 9 s.
- **Regression sets** `stylesheets` (Symbiote, 110 commits, the `symbiote` repo by its SSH
  remote), `stylesheets-bitwarden` (31, angular), `stylesheets-qwik` (39, qwik).

**Decisions added while building**:

| # | Question | Decision | Why |
|---|---|---|---|
| 329 | A rule's signature | **None of its own: rules, custom properties and keyframes hash a constant signature; a new selector is a move** | Selector lists gaining a member read as breaking signature changes with "users not updated" (Symbiote `b5f0dad`, `d2335ca`) |
| 330 | When a mention reaches a rule | **Only when the mention's file renders every class one of the rule's selectors needs; certain when its symbol renders them all** | `.merge-row-actions .button` had 13 users, 12 wrong (Symbiote `042112a`) |
