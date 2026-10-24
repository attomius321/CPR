# Journal: Refactor — the viewer's files in folders, its stylesheet beside them

[Index](../JOURNAL.md) · [Plan](../plan/refactor-viewer-folders.md)

## Refactor — the viewer's files in folders, its stylesheet beside them (2026-10-23, branch `refactor/viewer-file-strcture-refactor`)

The brief: `packages/viewer/src` had 70 files in one folder and a 6,302-line `styles.css`; move
the files into folders by area and split the stylesheet so each component's CSS sits beside it,
behaviour unchanged. Now eight folders (`graph/`, `diff/`, `history/`, `workspaces/`, `shell/`,
`ui/`, `scout/`, `settings/`) and 38 CSS parts that `styles.css` lists, by `@import`, in cascade
order. Decisions 257–258.

**Learned**:
- **The guards were blind to a second file.** `tokens.test.ts` read `src/styles.css` only, and its
  fonts guard `src/`'s top level only: a probe folder with a 5 px radius, a 10 px size, a 3 px side
  bar, `accent-color`, `--moved` and `'Arial'` passed 24 of 24. Reading every file under `src/`, 6
  guards fail on it. Changed before anything moved.
- **Moving files changed nothing built**: with imports rewritten from a path map, `dist/` was
  byte-identical to `main`'s (the same content hashes), so the move needed no other proof.
- **A split stylesheet can only keep its cascade by order, and grouping by component reorders it**:
  the parts in folder order changed the relative order of 59,246 pairs of rules. Two of those
  pairs style one element differently. `.thread-text.markdown` (a thread's report) takes
  `white-space` from whichever of `.thread-text` and `.markdown` comes last; the narrow shell's
  `.sidenav { display: none }` lost to the sidenav's own `display: flex` once `Shell.css` came
  first. Both are fixed by the list's order, with a comment there.
- **To find those two among 59,246 pairs**, a check that a pair matters needs four things: a
  property both set differently (`scout-terminal` and `workspace-terminal`, on one element in
  Scout, set the same four values), equal specificity, the same pseudo-element, and an element
  that can carry both selectors. The last is the hard one: the classes each element had during
  the e2e suite (4,525 tag, class, parent and ancestor sets, recorded by a script in the page),
  else the className literals in the source. Moving only the buttons' section to the end, as a
  trial, gave 698 candidate pairs without them and 19 with them.
- **Screenshots of e2e end states compare badly between runs**: each run makes new repositories,
  so SHAs, dates and temporary paths differ; 178 of 197 end states differed in pixels for that
  alone. Comparing computed styles in the same page instead — the branch's stylesheet against
  `main`'s, switched in one synchronous block — has no such noise. Two traps there: both bundles
  carry the Geist `@font-face` rules, and switching the sheet that holds them reset the faces
  (the next read measured text in the fallback); and text measured while a face is still loading
  is the fallback's. Fonts in a sheet of their own, and reads only once `document.fonts` is
  `loaded`, removed both.
- **`pkill -f` and `pgrep -f` match the shell running them** when the pattern's text is in the
  same command line (CLAUDE.md's trap, met twice): find the PID in one command, kill it in the
  next.

**Verification**: the guards first, proved on a probe folder (old test 24 of 24
passed with it; new, 6 guards failed); the move's `dist/` byte-identical to `main`'s; the split:
902 rules kept (1,008 built), the built JS, worker and fonts byte-identical; the pair check (2
fixed, 1 impossible, 46 read by hand); computed styles against `main`'s stylesheet in the same
page, 164 snapshots and 39,422 element reads through the e2e suite and 75 snapshots and 25,652
reads on five real pages at 390–1,440 px in both themes: no difference, while a build with
`Shell.css` before `Sidenav.css` gave 3,029. Screenshots of the five pages: the differences are
History's dates and anti-aliasing, as between two shots of `main`. `pnpm check` 1,290 tests; e2e
199 of 200 (`shell.spec`'s keyboard test, flaky on `main`). Not verified: states the e2e suite
does not reach (the pair check alone there), hovers where no test's pointer rests, Firefox and
Safari, the desktop app's window.
