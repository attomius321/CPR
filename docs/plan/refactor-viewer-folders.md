# Refactor — the viewer's files in folders, its stylesheet beside them

[Index](../PLAN.md) · [Journal](../journal/refactor-viewer-folders.md)

**Status:** ready for review on branch `refactor/viewer-file-strcture-refactor` (a workspace
started in Symbiote, from `main` at `4b5952f`). As built and results under "As built (the
viewer's files)" below.

**Problem** (the brief): `packages/viewer/src` held 70 files in one folder, and `styles.css` was
6,302 lines, 902 rules. Moving the files and splitting the stylesheet together lets each
component's CSS sit beside it. Two traps the brief named: the style guards in
`test/tokens.test.ts` read `src/styles.css` alone (and the fonts guard only `src/`'s top level),
so a rule moved out would no longer be checked and nothing would fail; and the cascade is the
file's order: at equal specificity a later rule wins, and CSS imported per component is ordered
by Vite's module graph, so rules could swap unseen.

**Goal**: the files in folders by area, the stylesheet in parts beside what they draw.
**Unchanged**: behaviour (the tests' assertions; `pnpm check`), every class name (some 600
class-based locators in 35 e2e files), every rule and every comment it had, and the
cascade.

## Design

- Folders after the groups the viewer's `CLAUDE.md` already had: `graph/`, `diff/`, `history/`,
  `workspaces/`, `shell/`, `ui/`, `scout/`, `settings/`; `main.tsx` and `styles.css` stay at
  `src/`. Each pure module beside the component that uses it; `test/` stays one folder.
- The stylesheet: plain CSS parts beside their components (`HistoryPage.css`), shared controls in
  `ui/controls.css`, the tokens and the page's base in `ui/base.css`, first. `styles.css` becomes
  the list of parts, by `@import`, in cascade order; no component imports a part.
- Split along the file's section banners; a rule goes to the component that draws it, a control
  several pages draw to `ui/controls.css`.

## Verification

- The guards first: `tokens.test.ts` reads every `.css` (and the fonts guard every `.ts`/`.tsx`)
  under `src/`, proved on a probe folder of broken rules; then `test/styles.test.ts`: every part
  in the list once, no part imported elsewhere.
- The move: the build byte-identical to `main`'s.
- The split: every rule kept (rule by rule, with its at-rule context); every pair of rules whose
  order changed checked for one element both could style, at equal specificity, with a property
  both set differently; the computed style of every element `main`'s and the branch's stylesheet
  give, in the same page, through the e2e suite; screenshots, dark and light.

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 257 | Where the viewer's files live | **A folder per area (`graph/`, `diff/`, `history/`, `workspaces/`, `shell/`, `ui/`, `scout/`, `settings/`); a pure module beside its component; `test/` one folder** | The brief's sketch, after reading the files: `open.ts` and `OpenIcon` in `diff/` (they open a diff's lines), `RowMenu` and `branchReviews.ts` in `history/` (History's row menu, on `checkout.ts`), `usage.ts` in `shell/` (the status bar's), `Help` and `tips.ts` in `ui/` (seven pages), `StartPage` in `workspaces/`. |
| 258 | How the stylesheet is split | **Plain CSS parts beside what they draw, listed in cascade order by `styles.css`'s `@import`s; no component imports one** | CSS Modules would rename the classes the e2e specs find elements by. Imported by its component, a part would be placed by Vite's module graph: an import moved in a `.tsx` could reorder the cascade unseen. A test keeps the list whole. |

## As built (the viewer's files)

- **38 parts, 6,262 lines** (40 fewer: blank lines at the joins). `ui/` 7 (base, controls,
  Resizer, icons, Help, MoreActions, markdown), `graph/` 6, `diff/` 5, `history/` 5,
  `workspaces/` 8, `scout/` 1, `settings/` 1, `shell/` 5. The list is grouped by folder in
  that order, with two exceptions the cascade needs, said in `styles.css`:
  `ui/markdown.css` after `workspaces/Workspace.css` (a thread's report is
  `.thread-text.markdown`: `.markdown`'s `white-space: normal` must follow `.thread-text`'s
  `pre-wrap`), and `shell/Shell.css` after `shell/Sidenav.css` (under 900 px the shell hides
  `.sidenav`, whose own rule makes it a flex column). Both were found by the order check below;
  either order the other way changes the page.
- One `@media (max-width: 899px)` block held the shell's and a workspace's narrow rules; it is
  now one block in each part (`Shell.css`, `Workspace.css`), the same rules in the same order.
- 13 parts got a one-line comment saying what they hold; no other comment changed.

**Results**:

- **The guards**: with a probe folder of broken rules, the old `tokens.test.ts` passed 24 of
  24, the new one failed the 6 guards it breaks. `styles.test.ts` fails on a stray part and on a
  component importing its own.
- **The move**: `dist/` byte-identical to `main`'s (`diff -r`).
- **The split**: 902 rules in the source, 1,008 built (with React Flow's and the fonts'), none
  missing or added; the built JS, the worker and the fonts byte-identical to `main`'s, the
  stylesheet +23 bytes (the second `@media` block). Of 59,246 pairs of rules whose order changed,
  2 styled one element differently (fixed by the list's order, above); 1 is left that no element
  can match (`.help-tip p` is on `document.body`, not in Settings), and 46 more were ruled out by
  the DOM the e2e suite showed and read by hand.
- **Computed styles**, `main`'s stylesheet against this one in the same page (both switched in one
  synchronous block, the fonts in a sheet of their own): through the e2e suite 164 snapshots,
  39,422 element reads (with `::before` and `::after`), dark and light, 900–1,500 px; on History,
  Settings, Scout, Start and a diff of this repository at 390, 600, 899, 900 and 1,440 px, both
  themes, the narrow drawer open, 75 snapshots and 25,652 reads. No difference. Against a build
  with `Shell.css` before `Sidenav.css`, the same pages gave 3,029 differing reads.
- **Screenshots** (`shots.mjs`, the same five pages and widths 1,440 and 600, dark and light): 13
  of 20 identical in pixels; the 7 others differ by 7–221 pixels, in History's relative dates
  (the shots a minute apart) and anti-aliasing at a rounded corner and an icon's edge. `main`'s
  build against itself, shot twice, differs in 5 of 20 by 7–827 pixels, the same kinds.
- `pnpm check`: 1,290 tests in 93 files (2 new). e2e: 199 of 200; the one failure, `shell.spec`'s
  keyboard test, failed the same way on `main`'s own run (V38's journal: flaky on `main`).

Not verified: the computed styles of states the e2e suite does not reach (e.g. a workspace at
under 900 px with its own narrow rules); there the pair check stands alone, on the className
literals for classes the suite never showed. Hover states were compared only where a test's
pointer rested. Firefox and Safari; the desktop app's window beyond what its e2e specs show.
