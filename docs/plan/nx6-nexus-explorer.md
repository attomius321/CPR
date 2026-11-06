# NX6 — Nexus on a fixed port, home as an explorer, open or `git init` a selected folder

[Index](../PLAN.md) · [Journal](../journal/nx6-nexus-explorer.md)

**Status:** merged into `main` on 2026-11-06; built (2026-11-05) on branch `feature/nx6-nexus-explorer` (the workspace's, from
`main` at `cb11e09`); the person OK'd this plan on 2026-11-05 with the port 7347, home only, a
question before `git init` and no first commit, and the guard outside home. NX6a–e built; "As
built" and results at the end.

**Problem** (the brief: "the nexus serves on one default port", "the person's whole file tree, not
one chosen project folder", "selecting a folder opens it"). Today (`main` at `cb11e09`):

| What | Today |
|---|---|
| The nexus's port | Any free one (`--port` defaults to `0`, `src/main.ts:58`): a new address each run, so a second `symbiote-nexus` starts a second nexus |
| What is scanned | Only the folder the person chose (decision 911), nothing until they choose one |
| What the list shows of the disk | The repositories the scan found (Found); folders only while a path is typed |
| Enter on a folder | Goes into it; a folder that is no repository cannot be opened, and the nexus never writes in a folder (543) |

Measured for this plan (this PC, WSL2, 32 cores; NX5's rules: no hidden or build folders, links
not followed, a repository ends the way down; no depth or folder limit):

| Scan | Folders | Repositories | Time | Levels |
|---|---|---|---|---|
| All of home | 2,780 | 42 | 73 ms warm, 195 ms cold | 15 (repositories only at levels 2, 3 and 5) |
| `~/go` (Go's module cache) | 1,312 | 0 | 47 ms | – |
| `~/projects` | 331 | 21 | 13 ms | – |
| `/mnt/c`, all of C: | over 52,511, stopped at 30 s | 1 | over 30 s | – |
| `/mnt/c/Users/anton` | 25,546 | 3 | 18 s | – |
| `/mnt/d`, all of D: | 8,755 | 7 | 6.8 s | – |

`symbiote view` in a fresh `git init` repository with no commit (`main`'s build): it starts,
`/api/status` answers `head: null`; Overview, Git ("Uncommitted changes · No commits yet", with its
commit action) and History draw. Monitor shows a red "no commit to read at HEAD: commit something
first" and Start a workspace "No branch to start from". Nothing crashes; workspaces wait for a
first commit. The viewer is out of NX6's scope: a fix workspace can turn those two into hints.

**Goal**: `symbiote-nexus` on port 7347 (or `--port`); a second one opens the first. Home is
scanned at start and on ⟳ only, and listed as a tree of its folders. Selecting a repository starts
its Symbiote; selecting a plain folder asks, runs `git init`, then starts it. **Unchanged**: the
port of `symbiote view` and `symbiote pr`, the viewer, the desktop app's `--url` mode (524), the
tab row and frames (521, 551, 625), where pins are kept (NX4), Stop and its question (542).

## The port (decisions 923, 924)

- `--port` defaults to **7347**; `0` is any free port. 7347 is below every system's range of ports
  handed out at random (Linux 32768–60999 here, Windows and macOS 49152–65535), so a Symbiote's
  random port never takes it; not a common development port.
- `GET /api/nexus` answers `{ nexus: true, pid }`.
- When the port is taken (`EADDRINUSE`), the nexus asks it `GET /api/nexus` (1 s):
  - a nexus answers: "Symbiote nexus already runs at http://127.0.0.1:7347/", then Symbiote's
    window or the browser on it, as a start would; exit 0 when that window closes. The running
    nexus is untouched; the app cannot raise its first window (524), so this is a second window.
  - anything else: "port 7347 is in use by another program: choose another with --port <n>",
    exit 1.
- Tests and specs pass `--port 0` (`startNexus`, `app.spec.ts`, `main.test.ts`): other workspaces
  run them at once, and none may reach the person's nexus. The two "taken" cases hold a free port
  of the test's own.

## Home, scanned (decision 925, supersedes 911)

- **Home**, nothing to choose: no depth limit; at most 20,000 folders or 5 s, then the foot says
  it stopped there. No hidden or build folders, links not followed, Symbiote's cache left out, a
  repository ends the way down (554). Windows' drives are not scanned (7 to over 30 s for 10
  repositories, above); they are typed (`/mnt/c/…`) or pinned.
- **When**: at the nexus's start (the last result from `<cache>/nexus/scan.json` answers
  meanwhile) and on the foot's ⟳ (`POST /api/scan`). Never on a timer, nor on the list's 2 s read.
- **Gone**: `POST /api/scanned`, "Look for repositories here", the first run's "choose a folder";
  `nexus.json`'s `scanned` is no longer read (left in the file).
- **The scan keeps every folder it read** with its repositories: `GET /api/tree` answers them
  (home here: 2,780 folders), read again by the page only when the scan's time changes.

## The explorer (decision 926, replaces 909's Found)

- Running, Pinned, Opened before as today; then **Home**, a tree: home's first level at first;
  a chevron (or → with the field empty) opens a folder from the scan, ← closes it; a folder the
  scan did not reach (it stopped at a limit) is read when opened, one folder (`GET /api/folders`).
  Repositories are leaves, with their dot and branch.
- A search finds folders and repositories of the scan by any part of their path (500 drawn, as
  Found), besides the groups above; a repository shown in a group above is not repeated.
- In the tree, a running or pinned repository is also in its place: the pick is kept by the row's
  key (its group and path), not its path alone.
- The foot: "Home: 42 repositories in 2,780 folders, 73 ms, at 11:02 ⟳".

## Selecting a folder (decisions 927, 928; supersede 543's "never write in a folder", replace 619's "nothing starts")

- Selecting is the act (913): Enter, a double click, the card's button. A click picks.
- A repository starts as Open does today (`src/start.ts`).
- A plain folder: `POST /api/symbiotes { folder }`. A folder inside a repository starts that
  repository. Else the answer is 409 with `init: true` (it may be made one) or why not. The page
  asks in Stop's dialog (542), Cancel the default, Escape cancels: "Make notes a git repository?
  Symbiote runs git init in ~/notes: a .git folder is added, nothing else. No commit is made:
  commit from its Git page to start workspaces." On yes, `{ folder, init: true }`: the server
  checks again, runs `git init`, then starts it.
- **Guards** (`src/init.ts`, the server's): refused are `/`, home, a drive root (`/mnt/c`,
  `windowsDrives`), Symbiote's cache and settings folders and anything in them, a folder in a
  repository holding home (a home kept in git), and any folder outside home except on Windows'
  drives (`/etc`, `/usr`, `/tmp`). Refusals the page can tell (home, the top, a drive) show on the
  card instead of the button.
- **No first commit** (the person: "Recommended").
- **A folder's card** (decision 929, replaces 916's "Look for repositories here"): its own
  folders, one level, read as it is picked; Open Symbiote (after the question); Go in opens it in
  the tree.

## Verification

1. **Unit tests first** (red before): `main.test.ts` (7347 by default; the port held by a nexus:
   opens it, exit 0; held by another server: the message, `--port`, exit 1); `server.test.ts`
   (`/api/nexus`, `/api/tree`, the 409 and `init`, writes guarded, a scan only at start and on
   `POST /api/scan` across many reads); `init.test.ts` (every guard, a real `git init`);
   `scan.test.ts` (the tree kept, no depth limit, the new limits); a pure `src/page/tree.ts` and
   its test (rows shown, open and close, the search); `pick.test.ts` (the same path twice);
   `page.test.ts`'s classes.
2. **e2e** (`explorer.spec.ts`, a throwaway home): the tree at start, opened; Enter on a repository
   starts it; Enter on a plain folder asks, Cancel leaves no `.git`, yes makes one and its tab
   opens; home refused; a folder made after the start missing until ⟳, the scan's time unchanged
   over 5 s of reads; the port held by a nexus and by another server. `list.spec.ts`,
   `folders.spec.ts`, `pins.spec.ts` follow the folder chosen going.
3. `pnpm check`, `pnpm build`, `pnpm test:e2e`.
4. **Screens**: every state, both themes, 1440 × 900, 1× (`viewer-check`, `symbiote-style`).
5. **Cost**: the scan of this PC's home, cold and warm; the tree's first draw.

**Risks**

| Risk | Mitigation |
|---|---|
| A test reaching the person's nexus on 7347 | Every test and spec passes `--port 0`; the taken cases use a port of their own |
| A big home | 20,000 folders or 5 s, said in the foot; the tree draws only the opened folders |
| Enter on a folder now starts something | It asks first, Cancel the default; refused folders never reach `git init` |
| `git init` in the wrong place | Guards on the server, checked on each write; inside a repository opens that repository |

**Order**: the port (NX6a), the scan, the tree and the routes (NX6b), `git init` and its guards
(NX6c), the page (NX6d), screens, measures, docs (NX6e).

## Milestones

| # | Milestone | Output |
|---|---|---|
| NX6a | The fixed port | `src/main.ts`, `src/server.ts` (`/api/nexus`), tests |
| NX6b | Home scanned, the tree | `src/scan.ts`, `src/repositories.ts`, `src/pins.ts`, `/api/tree`, `/api/scanned` gone |
| NX6c | `git init` | `src/init.ts`, `POST /api/symbiotes`'s `init` |
| NX6d | The page | `src/page/tree.ts`, `search.ts`, `pick.ts`, `list-view.ts`, `detail-view.ts`, `main.ts`; e2e |
| NX6e | Proof and docs | Screens, measures, this plan's "As built", the journal, `packages/nexus/CLAUDE.md`, `docs/reference/commands.md` |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 923 | The nexus's port | **7347 by default, `--port` overrides it, `0` any free one; tests pass `0`** (the person: "Yes, 7347") | One address to come back to; below every system's random ports, so no Symbiote takes it |
| 924 | The port taken | **Asked `GET /api/nexus`: a nexus is opened (window or browser), exit 0 when it closes; anything else is named, `--port` suggested, exit 1** | A second start is a person looking for the first |
| 925 | What is scanned (supersedes 911) | **Home, at start and on ⟳ only; no depth limit, 20,000 folders or 5 s; Windows' drives not scanned; every folder read is kept** (the person: "Home only") | Home: 2,780 folders, 42 repositories, 73–195 ms; C: over 30 s, D: 6.8 s for 10 repositories |
| 926 | What the list shows of the disk (replaces 909's Found) | **Home as a tree after Running, Pinned and Opened before, first level open; the search finds folders too; the pick kept by group and path** | The person's whole tree, not only the repositories found |
| 927 | Selecting a plain folder (replaces 619's "nothing starts") | **Enter, a double click or the card's button asks, then `git init` and its Symbiote; a folder in a repository opens that repository** | The act is the person's start; a click still only picks (913) |
| 928 | What the nexus may write (supersedes 543's "never write in a folder") | **Only `git init`, after the person's yes, no first commit; refused: `/`, home, a drive root, the cache and settings folders, a home kept in git, outside home but on Windows' drives** (the person: "Recommended", "Y") | A `.git` folder and nothing else; the guards on the server |
| 929 | A folder's card (replaces 916's "Look for repositories here") | **Its folders, one level; Open Symbiote; Go in opens it in the tree** | Home is scanned: nothing to choose |

**Not in NX6 (later)**: the viewer's Monitor and Start a workspace in a repository with no commit
(a hint instead of an error: a fix workspace); scanning Windows' drives; raising the running
nexus's window.

## As built (NX6)

- **The pick keeps which of its path's rows it is** (`Pick.nth`): a repository running and in the
  tree is listed twice, and a pick kept by its place alone moved to its other row when a row came
  above it (a Symbiote starting). The plan said "group and path"; the place and the count of the
  path's rows before it say the same without naming groups.
- **A folder holding a `.git` that git rejects is started, never offered `git init`**: NX2's
  e2e of a broken repository found it. The CLI says why, as before NX6.
- **Enter on a folder the page knows is refused** (home, `/`, a drive) does nothing: its card
  already says why, with no Open Symbiote. First built as a failure ("Did not open"), which the
  screens showed as wrong: nothing was tried.
- **Go in** opens the folder in the tree when the scan has it, and types its path otherwise (a
  pinned folder outside home).
- **Home's group is drawn as "its folders"**; a search turns it flat, "by path". The tree's rows
  are one line (32 px); search rows keep NX5's two lines with the path.
- **`ctx.home`** in `NexusContext` gives the tests a home of their own: `main.test.ts` would else
  scan the person's.
- **The CLI's `--help`** says the port, the tree and `git init`.
- **Kept from the plan**: decisions 923–929 as written.

**Results.**

| What | Measured |
|---|---|
| Unit tests | `pnpm check`: 3,412 pass; the nexus's 177, 37 of them new or rewritten (the port, `/api/nexus`, `/api/tree`, the scans counted, `init.ts`'s guards and a real `git init`, the tree, Home's rows, the pick listed twice) |
| e2e | The nexus's 32 pass, `app.spec.ts`'s 3 in Symbiote's window included (`explorer.spec.ts` 5 new; `list.spec.ts`'s scan test new; the rest ported). The viewer's 431: 430 pass in the full run; `changes.spec.ts`'s V43 test failed there and passes alone (4 of 4); the branch does not touch the viewer |
| The scan of this PC's home (built `scanFolder`) | 2,780 folders, 42 repositories, 115–142 ms (5 runs, with other e2e running); `scan.json` 150 KB |
| The page on that home | First draw 85–180 ms from the address; "sym" searched over 2,779 folders in 42–81 ms (26 rows); 10 × ↓ in 140 ms, Playwright's own key presses included |
| A scan between two reads | None: a repository made after the start stays unlisted across 4.5 s of reads, `scan.json`'s time unchanged; listed after ⟳ |
| `git init` from the page | A `.git` folder only, no commit (`git rev-parse HEAD` fails); the real `symbiote view` opens on it |

Screens of every state, dark and light, at 1440 × 900, 1× (the built nexus in a throwaway home):
home's first level, a repository and a folder picked in the tree, the question, a search over
folders, a start that failed, running with the tree, home refused, 900 px wide.

