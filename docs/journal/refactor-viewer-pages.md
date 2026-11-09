# Journal: Refactor — The viewer's and the nexus's large files in modules one can read

[Index](../JOURNAL.md) · [Plan](../plan/refactor-viewer-pages.md)

## Refactor plan — where the length is (2026-11-09, branch `refactor/viewer-pages`)

Measured at `371be1d` before moving anything: a walk of each of the eleven files' syntax trees
(TypeScript's compiler API) gave its top-level declarations and their spans, every function and
JSX return over 100 lines, each component's hook calls at its top and which of its inner functions
read and write each one, and for the nexus page which top-level functions read and write each
module variable. A second walk gave, for each declaration, the file's other declarations it uses:
the graph the pure files are cut along.

**Learned**:
- **The first round's pages grew back**: `HistoryPage.tsx` 832 → 1,737 lines (V66's Git page, V70's
  file shown, the git writes of decisions 636–645), `Workspace.tsx` 649 → 1,320 (V89's tabs, Split
  and Focus, V93's pipeline card), `StartPage.tsx` 593 → 848. Only `App.tsx` stayed near its 542
  (946 with the head's parts added since).
- **`History` is one component of 1,477 lines with 82 hook calls**: `current` (the comparison) is
  read by 22 of its inner functions and effects, `relistRef` by 9, `error` written by 8. Its
  menus and their dialogs (8 pieces of state, 12 functions) and its key handler (26 dependencies)
  are the largest units that read little of the rest.
- **The nexus page's functions cannot move as they are**: 25 module variables, 9 of them written by
  more than one function (`problem` by 6, `known` by 6, `pick` by 5); an ES module cannot assign
  another's `let`. Drawing and acting call each other (`render` → `drawHome` → a listing read →
  `render`), so a split by plain imports would be a cycle.
- **The pure files are five topics each**: `workspaces.ts`'s declarations form five groups with
  one-way uses between them (the agents' names ← a run's choices; the thread's items ← what a
  workspace waits on ← the sidenav's groups); `groups.ts`'s run rules, a run's words, the
  conversation's groups and the entry use each other one way once the shared types sit below them.
- **A file another branch changes**: refactor/workspace-tabs (3 commits, not merged) changes 39 of
  `Workspace.tsx`'s lines (the tab shown, `WorkspacePanel` 299–330); refactor/layout-flow only
  `graph/flow.ts`. No other branch touches the eleven files.

**Verification**: baseline `pnpm check` on `371be1d`: 3,428 tests in 245 files, passing, 110 s.

## Refactor — the eleven files in modules of one concern (2026-11-09, branch `refactor/viewer-pages`)

The eleven files, 12,764 lines on `main`, are 4,641 now, none over 600 (`HistoryPage.tsx` 591,
`Workspace.tsx` 595, `StartPage.tsx` 593), beside 66 new modules of 12–502 lines. Pure files split
by topic into graphs without cycles (`workspaces.ts` into six, `activity/groups.ts` into five);
component files lost their sections to components and their units of state and effects to hooks,
each called where its code was; the nexus page's 22 module variables became one state object and
its functions ten modules made over it. Decisions 955–960.

**Learned**:
- **Moves are cheapest done by the syntax tree, and checked by the type checker**: a script cut
  top-level declarations with their attached comments, copied the source's imports, rewrote every
  importer of a moved name, then let TypeScript's `organizeImports` (RemoveUnused: nothing
  sorted) drop what each file no longer used. Two traps it fell into: a declaration moved into a
  module the source imports from copied a self-import (caught by `tsc`), and an import split into
  `import { type X }` stays a side-effect import under `verbatimModuleSyntax` (rewritten as
  `import type`).
- **A component's state can only leave with what reads it first**: `History` could not hand its
  rows' state to a hook called where the reads' effect was, because the file shown reads `details`
  earlier; the refs stayed in `History` and went into the hooks as inputs. A workspace's shells are
  read by the tab shown above their effect, so `useShells` sits where their state was, and its
  read now starts before the changes' and Hive's (the one effect that moved earlier).
- **A module variable is no import**: an ES module cannot assign another's `let`. Rewriting the
  nexus page's 187 references to `state.<name>` by the checker's symbols was exact; a text rewrite
  would have caught `pick:` and `query:` property keys. One overlap still broke it: an edit inside a
  declaration that was being removed (`let asked = browsed`) left a stray `wsed;` that `tsc`
  caught.
- **Calls up the page need factories**: drawing and acting call each other on the nexus page
  (`render` → a listing's read → `render`). Factories taking the state and the few functions they
  call, wired by `main.ts`, keep the graph acyclic; the one direct reference a factory took before
  its maker ran (`key: onKey`) became an arrow.
- **Some splits needed more than the plan's modules**: `HistoryPage.tsx` was 885 after the plan's
  seven hooks and its menus; four more hooks and four section components took it under 600. The
  Graph page's sidebar and panel share the Files page's state, so the canvas card is what left
  `App.tsx` (`CanvasCard.tsx`).
- **Another package's test can import a viewer module**: two CLI tests import `workspaceNext` from
  the viewer to check Hive's card. The move script rewrote importers under the viewer, the nexus
  and `scripts/`, not `packages/cli/test`, and each step ran the viewer's and the nexus's unit
  tests only: the two failed from `51a08b6d` until the final `pnpm check` found them (lint first).
  A move's importers are searched in the whole repository.
- **A mask follows its element's width**: the screenshots' first comparison differed by the
  temporary repository's name and the fixtures' SHAs (commits made a minute apart); with the dates
  fixed and the name masked, a 2-pixel strip was left where the mask's box followed the name's
  width. Masking the fixed-size row, and pinning the mocked records and the page's clock to one
  instant, left 0 pixels apart.

**Verification**: `pnpm check` 3,450 tests in 251 files (3,428 in 245 on `main`; 22 new tests in 6
files, of the pure functions that left a component), and `pnpm build`, on the last commit; every
changed test file differs from `main`'s in its imports only (12 viewer, 2 CLI; a script comparing
each with its import declarations removed). e2e: 436 of 436 and 32 of 32 on the final viewer and nexus code (`23f96dbb`),
after the pure splits, and after the component splits (435 of 436: `events.spec.ts`' 500 ms timing
at 539 ms under load; 12 of 12 alone, 3 repeats); the seven Git specs after each History step. No
import cycle in the viewer or the nexus (none on `main`). Screenshots, `main`'s build (a `git
archive` copy) against the branch's: 23 pages in both themes and the nexus in 4 states in both, 54
of 54 identical. First paint on Bitwarden's `737ee3f`: medians 331 ms (`main`) and 333 ms, the same
3,124 elements; `/git` on zod: first paint 80 ms both, first rows 203 and 196 ms. The first script
+0.9 % (1,170,056 → 1,180,498 bytes; gzipped +0.8 %). refactor/cli-services took decisions
961–965: no collision with 955–960 (checked on every branch at plan time and before finishing).

Not verified: Firefox and Safari; the desktop window beyond its e2e specs; screenshots of states
the spec does not reach (a merge's conflicts, a live terminal, Split, the Git page's menus open):
the e2e suite drives them, their pixels are unchecked.
