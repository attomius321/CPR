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
