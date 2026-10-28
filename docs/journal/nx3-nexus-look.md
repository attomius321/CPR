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

## NX3 — the row's two groups, Symbiotes and Folders as cards, a repository the end (2026-10-28, branch `feature/nexus-improvements-v2`)

Built after the person's OK, with their answers: a repository's click opens its Symbiote,
repository cards and folder rows, and "make a decision" on Symbiotes' near repositories (taken:
yes). NX3a: the branch from `HEAD`, the end of the way down on the server. NX3b: the row's two
groups, Symbiotes' cards and "Repositories in". NX3c: Folders' places, cards and rows, the
arrows on the grid. NX3d: screenshots, numbers, docs. Decisions 551–555.

**Learned**:
- **A `goto` that changes only the hash keeps the page, and the nexus rewrites the hash**: the
  first spec of an address inside a repository went to it and reloaded, but the hash change had
  already been answered by `replaceState` with the folder still shown, so the reload listed
  that. The spec loads `about:blank` first. The spike's "inside a repository" screenshot had met
  the same trap: it showed `projects`.
- **A sticky group inside a padded scroller leaves the padding uncovered**: the strip's 2 px
  before the first tab showed a sliver of a scrolled tab left of the pinned pages. The pages
  take that padding themselves.
- **A tab reached by the keys can scroll under the pinned pages**: `scroll-padding-inline-start`
  set to their width at each draw keeps it clear.
- **`getByRole` leaves out a hidden panel's buttons**: Symbiotes' "Repositories in" and Folders
  both draw "Open Symbiote in beta"; with one panel hidden the specs' names stay unique, but a
  locator by class needs the panel (`.nexus-folders .nexus-repo`), as the screenshot script found.
- **Two of the same action on one screen**: Open a folder in the head and in the empty state
  read as a doubled control in the first screenshot; one place each, by whether Symbiotes run.
- **The decisions' numbers collided again**: `milestone/v75-suggested-settings` committed 544–550
  nine minutes before NX3's plan took 544–548 (the plan-time check had seen 543 as the highest).
  The check before finishing found it; NX3's are 551–555, and NX3a–c's commit messages keep the
  old numbers.

**Verification**: tests first for the server and the page's pure part (red: no branch, no
`picked`, the inside listed; the functions missing), the nexus's unit tests 80 → 89; `pnpm check`
passes (2,174 tests); e2e: the whole suite passes (`pnpm test:e2e`: the viewer's 336 specs in
5.1 min, then the nexus's 15 in 17.5 s, the 3 in Symbiote's window under Xvfb among them). The
listing timed against main's in one process: `~/projects` 3.6–4.6 ms (main 2.9–3.9), `System32`
42.6–48.4 ms (main 39.9–47.0), a folder inside Symbiote 3.9–5.8 ms (it lists `~/projects` now).
Symbiotes' first card 34–37 ms, its first near repository 46–50 ms. Screenshots at 1×, dark and
light, 1440 and 800 px, of every state the plan named. `git diff --stat main` touches
`packages/nexus`, the docs and the README. No analysis change: no regression-check.

Not verified: macOS and Windows outside WSL; the person's WSLg window (Xvfb only); a real home
kept in git; the page on the person's own `~/projects` (timed there, drawn on a stand-in); a
reader test of the README's section.
