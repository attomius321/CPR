# Journal: NX3 — The nexus: its own tabs apart, fuller pages, a repository is the end

[Index](../JOURNAL.md) · [Plan](../plan/nx3-nexus-look.md)

## NX3 spike — the nexus's screens today, and what a listing can say cheaply (2026-10-28, branch `feature/nexus-improvements-v2`)

Asked to tell the nexus's tabs from the Symbiotes' (a line between), to make its pages less
blank, to restyle Folders, and to stop at a repository. Read: NX1's and NX2's plans and
journals, the page (`src/page/`), `nexus.css`, the viewer's line tabs (`Workspace.css`) and state
dots (`Sidenav.css`). Built `484e170` and served it with a home of its own (4 repositories, 3
plain folders) and two `symbiote view`s; screenshots in headless Chromium at 1440×900 and
800×900, dark and light. Then a script in the job's folder over the person's folders: a
listing with each repository's `HEAD`, and with the repositories inside each plain folder, three
runs each.

**Learned**:
- **The row is one strip of four alike tabs**: `Symbiotes 2`, `Folders`, `ky main`, `zod main`.
  The viewer already has a line for two groups of tabs (`.views-divider`, V45) and a mark for
  "not running" (`.state-dot.tone-idle`, V48).
- **The pages are mostly empty**: Symbiotes' card ends at y 265, 75 % of the page under the row
  empty; Folders' Open Symbiote stands 1,150 px right of its repository's name.
- **A branch is cheap, a count of what is inside is not**: every repository's `HEAD` with the
  listing costs 3–4 ms in `~/projects` (46 folders, 16 repositories); counting the repositories
  one level inside each plain folder costs 8–12 ms there but 125 ms on `/mnt/c` and 380–400 ms on
  `System32` over WSL's 9p. The cards say the branch; the count is left out.
- **Worktrees' `.git` files name their folder**: `Symbiote.worktrees`' two worktrees read their
  branches through it in 0.3–0.5 ms.
- **Home is no repository here** (`git rev-parse` fails in `~`): stopping at a repository costs
  nothing on this machine; a home kept in git would be every folder's repository, so it is not
  an end.
