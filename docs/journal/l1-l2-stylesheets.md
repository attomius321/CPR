# Journal: L1–L2 — Stylesheets in the graph (CSS and SCSS)

[Index](../JOURNAL.md) · [Plan](../plan/l1-l2-stylesheets.md)

## L1 spike — what real stylesheets hold, and what a commit changes in them (2026-10-24, branch `feature/expand-graph-with-css-scss`)

Asked: "The graph should also know how to interpret CSS/SCSS". Measured on `main` (`c4ff77a`,
built here) and on the regression clones' heads (Bitwarden `51450a5ba9`, Qwik `3fd543fb5`, vite
`cf80aa552`, all 2026-10-13). Three throwaway scripts with postcss 8.5.6, postcss-scss 4.0.9 and
postcss-value-parser 4.2.0 (in the job's scratch folder, not committed): one parses every
stylesheet of a head and counts what it holds; one diffs each stylesheet-touching commit's files
into symbols (rule = context + selector, own declarations hashed after whitespace and comments
are dropped; custom properties, keyframes, mixins, functions and top-level `$variables` apart);
one matches the class names in selectors against class attributes and strings in markup.

**Learned**:
- **A stylesheet change shows nothing today.** `symbiote diff 042112a~1 042112a` (6 lines added
  to `styles.css`): `1 file changed · 0 symbols changed`. V31a (`9220e20`, 584 lines of
  `styles.css`): three symbols, all in tests; parsed, the stylesheet is 66 rules added, 1 removed,
  145 modified. 110 of Symbiote's 461 commits change a stylesheet (24 %); 31, 39 and 34 of the
  last 2,000 in Bitwarden, Qwik and vite (1.6–1.9 %).
- **postcss-scss reads all of it**: 169 stylesheets (43 Symbiote, 48 Bitwarden, 78 Qwik), 0 parse
  errors, 18–32 ms for every stylesheet of a revision. Reading them all for each side is cheap.
- **A commit changes few stylesheet symbols, with long tails**: Symbiote median 9, p90 62, max
  2,230 (`11139e6`, the stylesheet split into parts: 1,115 rules out of one file and into others —
  move matching must pair them); Bitwarden median 4, p90 134, the tail from its generated
  icon-font CSS (`bwicons/styles/style.css`, every `content` code shifted by one icon added).
- **Tokens have wide reach.** 10 Symbiote commits change a custom property's value; V31a changed
  31 of them, used by 523 `var()`s. Custom properties resolve in the repo for 98 % (Symbiote), 100 %
  (Bitwarden) and 85 % (Qwik) of their uses; the rest are libraries' (`--xy-*`) or set by script.
- **Bitwarden's SCSS is the old kind**: 67 `@import`, no `@use`; 145 top-level `$variables` (295
  uses), 5 mixins used 149 times (every one resolves in the repo), 4 functions, 4 `@extend`, 420
  nested rules (182 with `&`), 6 interpolated selectors. `@import` resolution needs the importer
  order (a partial uses `$primary` it never imports).
- **A selector repeated in one file and context is rare**: 5 (Symbiote), 6 (Bitwarden), 6 (Qwik)
  per ~1,000 rules — a ` (2)` suffix is enough.
- **Classes are a different milestone.** Symbiote's viewer names 376 of its 556 classes (68 %) in a
  static `className="…"`, 92 more only in other strings (`tone-${tone}`); Bitwarden 110 of 519
  (21 %), and 1,137 of its 1,247 static class names are Tailwind utilities with no rule. "A class
  with no rule" can never be a finding; markup → stylesheet edges need their own precision cases
  (L2).
- **Selectors in IDs**: every split of an ID in core, CLI and viewer takes the first `#`, so
  `src/a.css##root` and `.a .b` survive; the posted-finding marker already URI-encodes symbols.
  `detectors.ts` and `diff.ts` count dots for depth, which a selector's dots would mislead.

## L1 — stylesheets as a language (2026-10-24, branch `feature/expand-graph-with-css-scss`)

A second language adapter (`packages/core/src/lang/css/`), joined to TypeScript's by
`combineAdapters`: rules, custom properties, keyframes and SCSS's variables, mixins, functions
and placeholders as symbols named as CSS writes them; hashes from postcss-value-parser tokens;
names between stylesheets resolved as the cascade and Sass do; findings for removals that leave
uses. Schema 0.7.0. Decisions 299–305, 329.

**Learned**:
- **Prettier changes more than whitespace**: it lowercases hex colours, units and property
  names, adds leading zeros and drops trailing ones, respaces selectors (`2n+1` → `2n + 1`) and
  media queries, and switches quotes by its config. All of it is normalized; a reformat of every
  stylesheet of Symbiote (1,249 symbols), Bitwarden (1,746) and Qwik (1,523) changes none —
  after one more case: postcss-value-parser keeps `url($path + "a.svg")` as one word, quotes
  and all.
- **Bitwarden's SCSS resolves only through importer order**: `header.scss` imports nothing yet
  uses `$themes` and `@include themify`, which `styles.scss` imported before it. 355 variable,
  18 mixin and 11 function edges on its 31 stylesheet commits; no unknown, no package.
- **Rules need no signature**: as planned, a selector change was a signature change, and
  selector lists gaining a member became "10 of 12 users not updated" warnings once markup had
  users (L2). A rename is a move now (decision 329).
- **zod's `r1` commits live only in GitHub's pull-request refs**: the regression clone needed
  `git fetch origin '+refs/pull/*/head:refs/remotes/pull/*'`.
- The first L1b commit (`2bb0013`) went in with the `css` golden failing (the orphans the
  exposure removes); `e221422` fixed it. Commits have been gated on `pnpm check` since.

**Verification**: tests first in `css.test.ts` (fixtures `css`, `css-refs`, `css-removed`),
red for the right reason; L1a against `main`: `r1` 29 comparisons identical (859 edges),
`bitwarden` 10 identical (4,862), `qwik-docs` 30 identical (5,530). L1 (`fb82036`) on the new
stylesheet sets against `main`: no error, no TypeScript edge or finding changed; Symbiote's 110
commits +3,731 stylesheet symbols (per commit median 8, p90 58), +16,122 edges, +4 % time;
Bitwarden's 31 +1,522 symbols, +849 edges, +6 %; Qwik's 39 +1,305 symbols, +752 edges, +11 %
(CSS-only commits now load the TypeScript program), and 10 new warnings, all on `f2b5479d7`,
read in the source: that commit removed `--repl-docs-*` and `--tutorial-*` definitions that
`repl.css` and `tutorial.css` still read, and nothing in head defines them.

## L2 — markup uses stylesheets (2026-10-24, branch `feature/expand-graph-with-css-scss`)

Adapters can name what another language defines (`mentions`) and scope stylesheets
(`styleScopes`); the stylesheet adapter turns mentions into edges (`mentioned`) and asks its
peers for a rule's users. JSX class names, `classList`, CSS modules and custom properties from
script in core; Angular templates, host classes and `styleUrls` scopes in the Angular plugin;
`useStylesScoped$` in the Qwik plugin. A removed rule whose class markup still renders, styled by
nothing now, is a warning. Decisions 306–312, 330.

**Learned**:
- **A class in a rule's subject is not a use**: `.merge-row-actions .button` (`042112a`) had 13
  users, every `button` renderer; one renders `merge-row-actions`. A file must render all of a
  selector's classes (decision 330) — at the price of rules split across files (a theme class
  on a container), which get no markup users.
- **`:not(.primary)` still styles `primary`**: `3fff617` replaced `.button.primary` with
  `.button:not(.primary)`; reading only the classes a rule reaches said nothing styles
  `primary` any more. The still-styled check reads every class a selector names.
- **Removed classes still rendered are real**: on Symbiote's history `e619d17`
  (`.commits-help`), `92c5276` (`.conflicts`) and `d175ee5` (`.commit-this`) removed a class's
  last rule while its component still renders it — two kept as e2e locators, one left over.
- **Name queries must not read every file**: one query per changed rule re-read the text of
  each file that had not matched yet (11139e6: 6.1–6.6 s); a word index once per revision:
  4.5 s (`main`, reading no stylesheets: 3.8 s).
- **Decision numbers collide across workspaces**: `feature/merger-logs` took 313–314 while this
  branch was built; this branch's two are 329–330 (the highest elsewhere was 328).
- **The viewer is kind-agnostic**: rules, tokens and their users needed no viewer change; the
  e2e spec passed on its first run.

**Verification**: tests first (`markup.test.ts`: the `markup` fixture, the 13-users case, the
`:not()` and rename case, `selectorClasses`; plugin fixtures `styles` (Angular) and
`qwik-styles`, each also without the plugin), `e2e/stylesheets.spec.ts`.
