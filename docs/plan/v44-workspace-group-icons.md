# V44 — An icon for each group of workspaces

[Index](../PLAN.md) · [Journal](../journal/v44-workspace-group-icons.md)

**Status:** merged into `main` on 2026-10-24 (built 2026-10-24), on branch `feature/workspaces-list-upgrades` (a
workspace started in Symbiote, from `main` at `ab9e352`); the plan and its two choices OK'd by the
person ("Ok"). As built and results under "As built (V44)" below.

**Problem** (asked: "Workspaces statuses should be represented thorugh some icons. Only the category
should have that icon. Eg. Working should have a clock icon. This is just an example, if you find a
more appropiate icon, use that."). The sidenav lists the workspaces in up to four groups, the merge
queue first: Merging, Needs you, Working, Done. Measured on `main` (`ab9e352`):

| What | Measured |
|---|---|
| A group's mark | A 6 px dot before its name (`h3::before`), in its state's colour; each card under it has a 7 px dot of the same shape |
| Telling groups apart by the mark | Merging and Working: both `--moved` (cyan); only the name tells them apart |
| A Needs you card's dot | Amber, green, red or grey (waiting, ready, failed, idle): the group's amber dot is one of four |
| Folded (the rail) | A group is a 1 px line, 0 px high: which group a dot belongs to is not shown |
| The clock | History's page icon, two rows above the groups (`HistoryIcon`) |
| Found in the rail | A merge card's state text is not hidden there: it shows as "Che…" under its dot |

**Goal**: each group's heading carries an icon that says what the group is, in the state's colour
it has today; the cards keep their dots. Folded, the icon stands for its group where the line was.
**Unchanged**: the groups, their order and counts, the cards (their dots, text and height), the
pages' icons, the colours.

## Design

| Group | Icon (after lucide, ISC) | Colour | Why |
|---|---|---|---|
| Merging | `git-merge` | `--moved`, as today | A branch merged into another |
| Needs you | `bell` | `--warning`, as today | The person's turn. The group holds "Plan ready" and "Ready for review" as well as failures: a "!" would read as an error |
| Working | `hourglass` | `--moved`, as today | Busy, wait: the brief's clock, which History's icon already is two rows above |
| Done | `circle-check` | `--added`, as today | Merged and finished |

- `src/ui/icons.tsx`: the four icons, 16 px line drawings like the others, each credited.
- `src/shell/Sidenav.tsx`: `GROUPS` gives each group its icon; Merging's heading takes its own.
  The heading's `title` names the group (the rail hides its name).
- `src/shell/Sidenav.css`: the dot (`h3::before`) gives way to the icon, 14 px beside the 13 px
  name, in the group's tone (`--group-tone`, as the dot). Folded: the icon, centred, in place of
  the line. No animation.
- The rail's merge card shows only its dot, as a workspace's card does.

## Verification

1. **Test first** (red before), `e2e/shell.spec.ts`: with a workspace in each group and a merge in
   the queue, each group's heading has one icon in its token's colour; the four drawings differ
   and none is History's; the cards keep their dots and no icon; folded, each icon is shown with
   the group's name as its title, the names hidden, and the merge card's text hidden.
2. `pnpm check`, `pnpm build`, `pnpm test:e2e` (`look.spec.ts`'s 64 px card among them).
3. Screenshots before and after: the sidenav open and folded with the four groups, dark and light,
   1440×900, device scale 1 (and 2 to read the icons).
4. `/history`'s first paint against `main`'s build, alternated: inline SVG only, no font or glyph.
5. No analysis changes: no regression run.

**Risks**

| Risk | Mitigation |
|---|---|
| An icon at 14 px blurs at 1× | Lucide's 24-unit paths redrawn on the 16-unit grid; screenshots at 1× |
| The rail grows | About 20 px a group, at most four groups |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 289 | How a group of workspaces is marked | **A lucide icon per group in its state's colour** (Merging `git-merge`, Needs you `bell`, Working `hourglass`, Done `circle-check`); the cards keep their dots; folded, the icon in place of the line | Asked for icons on the categories only; an hourglass for Working because the clock is History's icon (the person: "Ok") |

## As built (V44)

- **The heading moved to line up with the cards**: with the dot's 6 px gap, the 14 px icon put
  the group's name 5 px right of the cards' names (36 against 31 px) and its centre 2.5 px right
  of their dots (23 against 20.5). The heading starts 2 px further left (6 px) with a 3 px gap
  after the icon, and the count keeps its 6 px (3 px gap, 3 px margin): the icon's centre at
  21 px, the name at 31, measured in the DOM at 1440×900. The dot's heading had them at 19 and 28.
- **The rail**: the icon 10 px under the card above and 4 px over its own cards, so a picked
  card's wash does not touch it.
- **A flaky test fixed on the way**: `shell.spec`'s keys test failed once in the e2e run, the
  card-focus test's race (`a6e53c7`): ArrowDown pressed before the second card was listed. On
  `main`'s build 2 of 32 runs failed on 8 workers, as on this branch; it now waits for both
  cards, 0 of 64.
- **Renumbered V44 and decision 289** before review: `feature/agentic-terminal-view`, another
  workspace from the same `main`, planned V43 with decisions 285–288 six minutes after this
  branch's plan; neither is merged. This branch's first two commits say V43 and decision 285.

**Results.**

| What | Measured |
|---|---|
| Test first | `shell.spec`'s V44 test red on the missing icon, then green; 32 of 32 on 8 workers |
| `pnpm check` | 1,380 tests in 100 files, green |
| e2e | 218 of 218 (after the keys test's fix; before it 217 of 218) |
| Alignment, at 1440×900 | Icon centre 21 px over the cards' dots at 20.5; name at 31 px as theirs (before: dot 19, name 28) |
| `/history` of this repository, 16 rounds alternated with `main`'s build | first contentful paint median 64 / 64 ms, first rows 127 / 127 ms (the sidenav lists no workspaces there) |
| Size | JS +903 bytes, CSS −84 bytes |
| Screenshots | The sidenav open and folded with the four groups, dark and light, 1440×900 at device scale 1 and 2, before and after |

Not verified: the person's own repository and its workspaces (Symbiote was not run in their
checkout: its merger acts on the queue); the app's window (Electron on WSLg at their scale);
macOS and Windows rendering.
