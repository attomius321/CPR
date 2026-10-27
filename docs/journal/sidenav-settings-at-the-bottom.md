# Journal: Feature — Settings at the sidenav's bottom

[Index](../JOURNAL.md)

## Feature — Settings at the sidenav's bottom (2026-10-27, branch `feature/sidenav-settings-at-the-bottom`)

The person: Settings should be at the bottom of the sidenav. It had been the fifth row of the
pages since V29, by default rather than by a decision. History, Scout, Skills and Monitor are
pages one works in; Settings is visited now and then, and the bottom corner is where VS Code,
Linear, Slack and Discord keep it.

**Built**: Settings is a row of its own after the Workspaces section (`.sidenav-foot`): the
pages' row (36 px, 18 px icon, hover, the current page's wash and accent icon, the `s` hint),
6 × 8 px around it, over a `--line` hairline the list scrolls under. In the rail its icon sits at
the bottom, centred as the pages' icons; in the narrow drawer it is the drawer's last row. The
`s` key, `/settings` and the tip are unchanged.

**Learned**:
- **A footer, not a second navigation.** The Settings page already has a navigation named
  "Settings", and two "Pages" landmarks would be named alike; the link keeps its name and
  `aria-current`. Focus follows what is drawn: the pages, the cards, then Settings.
- **The list does not gain room.** The pages lose a 38 px row; the new row takes 49 px (hairline,
  padding, row). The workspaces' list is 11 px shorter than before; the plan said "a few pixels".
- The page rows' rules are shared through `:is(.sidenav-pages, .sidenav-foot) a`, so a later
  restyle of the rows reaches Settings too; `:is()` keeps the same specificity, so the cascade
  is as before. Scout's and Scribe's waiting band and dots stay `.sidenav-pages` only.

**Verification**: tests first. `shell.spec` expects 4 links in Pages, and a new test checks
Settings is the sidenav's last element, its bottom within 12 px of the sidenav's, under the
list, open and folded (the rail's icon at the pages' x and width), in a 600 px window whose 4
workspaces scroll. `title-bar.spec` checks the row is drawn where a browser draws it, 38 px
lower, on every page of the shell and on a diff. Before the change 6 of their 16 tests failed
(no row, 5 links); after, 16 of 16. `pnpm check`: 1,884 tests; build; e2e 297 of 297.
Screenshots at 1440×900, device scale 1, dark and light: History (no workspaces, and 5 with one
waiting), Scout, Skills, Monitor, Settings, Start, a workspace, a diff's rail, the rail on
Settings, the row hovered (its tip and `s`), a 600 px window with the list under the hairline,
the drawer at 390 px. The main area is as before on every page. Not verified: other browsers;
first paint (no font changed, and the pages' layout did not).
