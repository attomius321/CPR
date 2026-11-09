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
