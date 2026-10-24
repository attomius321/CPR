# Journal: V44 — An icon for each group of workspaces

[Index](../JOURNAL.md) · [Plan](../plan/v44-workspace-group-icons.md)

## V44 — an icon for each group of workspaces (2026-10-24, branch `feature/workspaces-list-upgrades`)

Asked: "Workspaces statuses should be represented thorugh some icons. Only the category should have
that icon. Eg. Working should have a clock icon." The sidenav's groups were told apart by a 6 px
dot, the shape of every card's dot; Merging and Working were the same cyan, and folded each group
was a 1 px line. Each heading now starts with a lucide icon in its state's colour: Merging
`git-merge`, Needs you `bell`, Working `hourglass`, Done `circle-check`. The cards keep their
dots. Decision 289.

**Learned**:
- **The clock was taken**: History's icon, two rows above the groups, is a clock. An hourglass
  says "busy, wait" as the brief's clock did, and is not History.
- **A bell, not a "!"**: Needs you holds "Plan ready" and "Ready for review" as well as failures;
  a warning sign would have read every one of them as an error.
- **An icon is wider than the dot it replaces**: at the dot's 6 px gap the 14 px icon pushed the
  name 5 px right of the cards' names (36 against 31 px) and its centre 2.5 px off their dots.
  The heading starts 2 px further left with a 3 px gap, and the count keeps its 6 px: the icon's
  centre at 21 px over the dots' 20.5, the name at 31 as theirs, measured in the DOM.
- **Found in the rail**: a merge card's state text is a bare `.workspace-state`, which the rail
  did not hide (only the workspace cards' line around it): it showed as "Che…" under the dot.
- **The keys test had the card-focus test's race**: it failed once in the e2e run; on `main`'s
  build 2 of 32 runs failed on 8 workers, as on this branch. It now waits for both cards before
  its keys (0 of 64), as `a6e53c7` made the card-focus test do.
- **Numbers collide again**: `feature/agentic-terminal-view` planned V43 with decisions 285–288
  from the same `main`, six minutes after this branch. Renumbered V44 and 289 before review; the
  branch's first two commits say V43.

**Verification**: test first, `shell.spec`'s V44 test (a workspace in each group and a merge in
the queue: one icon per heading in its token's colour, four drawings and none History's, the
cards' dots kept; folded, the icons shown with their titles and the merge card's text hidden), red
on the missing icon, then green, 32 of 32 on 8 workers. `pnpm check` 1,380 tests. e2e 218 of
218 (217 before the keys test's fix). `/history` of this repository against `main`'s build, 16
rounds alternated: first contentful paint median 64 / 64 ms, first rows 127 / 127 ms. JS +903
bytes, CSS −84 bytes.
Screenshots of the sidenav open and folded with the four groups, dark and light, 1440×900 at
device scale 1 and 2, before and after.

Not verified: the person's own repository and its workspaces (Symbiote was not run in their
checkout: its merger acts on the queue); the app's window on WSLg; macOS and Windows rendering.
