# NX3 — The nexus: its own tabs apart, fuller pages, a repository is the end

[Index](../PLAN.md) · [Journal](../journal/nx3-nexus-look.md)

**Status:** built (2026-10-28), merged into `main` on 2026-10-29, on branch `feature/nexus-improvements-v2` (a
workspace started in Symbiote). Planned and OK'd by the person the same day, with their answers
(decisions 551–555, planned as 544–548); NX3a–d built. "As built" and results at the end.

**Problem** (asked: "Current interface of nexus is pretty blank..and the top navigation i don't
like it, mark it clear which are symbiotes, view tabs, and which are nexus tabs. separate by a
line or something. Also the UI of the folders, i don't like it...improve the styling, and if a
folder achieved the repository grade, it should stop there, i should not be able to go deeper
into the folder."). Measured on main's build (`484e170`), a home of its own with 4 repositories
and 3 plain folders, 2 Symbiotes running, headless Chromium at 1440×900 and 800×900, dark and
light (16 screenshots):

| What | Today |
|---|---|
| The row of tabs | `Symbiotes 2`, `Folders`, `ky main`, `zod main`: four line tabs drawn alike. Nothing tells the nexus's own pages from the Symbiotes |
| Symbiotes | Two rows in one card that ends at y 265: 635 of the 852 px under the row are empty (75 %) |
| Folders | A repository's row differs from a folder's by a neutral chip and an icon of the same size; its Open Symbiote stands 1,150 px right of its name |
| A repository's row, clicked | Goes in: its `src`, `docs`, `packages` listed, and further down to any depth; the card's head says "In symbiote · Open Symbiote" |
| The person's `~/projects` | 46 folders, 16 repositories (one detached, one on `master`); 3 folders hold 4 more (the `.worktrees` folders) |
| Reading each repository's `HEAD` with the listing | 3–4 ms for `~/projects`' 46 folders and 16 repositories; 0.3–0.5 ms for `Symbiote.worktrees` (two worktrees, their branches) |
| Counting the repositories inside each plain folder (an idea) | 8–12 ms for `~/projects`, but 125 ms for `/mnt/c` and 380–400 ms for `System32` (WSL's 9p): dropped |

What causes it:
- NX1 drew the nexus's pages and the Symbiotes as one strip of line tabs (decision 522); NX2 added
  Folders to it the same way.
- The pages are the viewer's list recipe (a card of 56 px rows) with two or seven rows in them.
- NX2 made every listed folder a way in (decision 540); a repository's row only added a button.

**Goal**: the row shows the nexus's own pages and the Symbiotes as two groups, a line between.
Symbiotes shows the running ones as cards and, under them, the repositories near them to open.
Folders shows a folder's repositories as cards, its folders as rows, the places at its left. A
repository is the end of the way down: it opens its Symbiote, never its folders. **Unchanged**:
the nexus's routes but `GET /api/folders`'s answer, starting and stopping (decisions 541–543),
kept frames (521), the address (`#<root>`, `#folders:<path>`), `symbiote view`, the viewer, the
engine, the desktop app.

## The row (decision 551)

```
 ▦ Symbiotes 2   ▭ Folders  │  ● ky  main   ● zod  main   ○ alpha  stopped ×
 └ the nexus's own pages ┘    └ one tab per Symbiote: its state, its name, its branch ┘
```

- **Two groups, a line between**: the viewer's `.views-divider` (V45 draws it between a
  workspace's agent tab and its shells), taller here, as the row is a page's row.
- **The nexus's pages have icons, the Symbiotes a dot**: Symbiotes (lucide's layout-grid) and
  Folders (folder); each Symbiote's tab starts with its state: a green dot (`--added`) running,
  the viewer's empty ring (`.state-dot.tone-idle`, V48's "not running") stopped. Never both.
- **The nexus's pages stay at the left**: many Symbiotes scroll the strip sideways (the viewer's
  `.workspace-views` does) under them, sticky on `--side`.
- One tab list, as today: ←, →, Home and End cross the line.

## Symbiotes (decision 552)

- **Running Symbiotes as cards** in a grid (at least 320 px each): the dot, the name (600) and
  Stop on the first line; the folder; the branch, the uncommitted changes, since when. The card
  opens its tab; Stop stands beside it, not inside (a button cannot hold a button, NX2).
- **"Repositories in <folder>"** under them: the repositories in the folders the running
  Symbiotes are in (NX2's places of kind `symbiotes`, three at most) that no Symbiote serves, as
  Folders' repository cards: one click opens one. Read through `GET /api/folders?path=` (5–6 ms
  each, NX2), again only when that set of folders changes, not at each 2 s read. With none
  running there is no such folder: the empty state and its **Open a folder**.
- **Open a folder** joins the page's head as its action.
- The person left this to the plan ("Idk, make a decision"): taken for one click to the next
  Symbiote, with nothing new on the server.

## Folders (decisions 553, 555)

```
 ▭ Folders                                    [ Go to folder: /path or ~/path ]
 ┌ Places ────┐ ┌ ↑ Home / projects               16 repositories · 30 folders ┐
 │ ⌂ Home     │ │ Repositories 16                                              │
 │ ▭ projects │ │ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
 │ ⛁ /        │ │ │⎇ ky      ● │ │⎇ realworld │ │⎇ Symbiote  │ │⎇ zod     ● │  │
 │ ⛁ C:       │ │ │⑂ main      │ │⑂ main      │ │⑂ main      │ │⑂ main      │  │
 └────────────┘ │ │ Show       │ │Open Symbio…│ │Open Symbio…│ │ Show       │  │
                │ Folders 30                                                   │
                │ ▭ Agentic      ›   ▭ CryptoTokens ›   ▭ Ethereum     ›       │
```

- **The places, a card at the left** (wide areas): the sidenav's rows (an icon, the name; the
  current one `--selected`, its icon in the accent). Under about 960 px of area, a row over the
  folder's card, as today.
- **Go to folder** in the page's head, as its action.
- **The folder's card**: its head the crumbs and Up, the counts at the right ("16 repositories ·
  30 folders"). Then the **repositories** as cards in a grid (at least 220 px): the repository
  icon, the name, the branch (decision 555), a green dot and **Show** when a Symbiote serves it,
  else **Open Symbiote** in the accent. Then the **folders** as rows in columns, a `›` at each
  end: the way in. A group's head only when both are there.
- **The branch** (decision 555): read from the repository's `HEAD` (a `.git` folder's, or the
  folder a worktree's `.git` file names), no git process: `ref: refs/heads/<name>` is the
  branch, a commit is "detached at <7>", anything else (reftable's `.invalid`, an unreadable
  file) nothing. 3–4 ms for `~/projects` with the listing (the spike).
- **Keys**: the arrows move on the grid by place (↓ the card or row under), Enter acts, Backspace
  goes up; the field keeps its keys.

## A repository is the end (decision 554)

- **No way into a repository**: its card's click, or Enter, opens its Symbiote, or shows the one
  running (the person: "Yes").
- **The server never lists inside one**: `GET /api/folders?path=` for a folder inside a
  repository (git's top level, the root included) answers the folder holding the repository,
  with `picked: <root>`; the page shows that folder and the repository's card picked (focused,
  scrolled to). A repository inside another's folders: up to the outermost. A typed path, an old
  address, Backspace: never a repository's folders.
- **A home kept in git** (`~/.git`): not an end, or the whole tab would be inside it; listed as
  NX2 lists. Here home is no repository.
- **"In <repository> · Open Symbiote"** on the card's head goes: no listing is inside one.
- The answer's `repository` (the root the folder is in) becomes `picked`.

## Verification

1. **Unit tests first** (red before): the branch (a branch, a detached HEAD, a worktree's
   `.git` file, an unreadable or reftable HEAD); the end (a folder inside a repository → its
   holder, picked; the root itself; nested; a home in git; outside: as before); the page's pure
   part (a card's action, the counts' words, the grid's next item by place, the strip's groups,
   the repositories near the running ones); the page's guard with the viewer's new classes.
2. **e2e** (`packages/nexus/e2e`, real builds): a repository's card opens its Symbiote (no way
   in); a typed path inside a repository shows its holder, the card picked, and a reload keeps
   it; the keys on the grid; the row's two groups (the line, icons, dots); Symbiotes' cards and
   opening a repository from "Repositories in"; Stop and Start again as before; the app's spec
   under Xvfb; no page errors in any frame.
3. **Nothing else changes**: `git diff --stat main` shows `packages/nexus` and the docs; `pnpm
   check`, `pnpm build`, `pnpm test:e2e`. No analysis change: no regression-check.
4. **The look** (`symbiote-style`): screenshots before and after at 1×, dark and light, 1440
   and 800 px: the row with running and stopped tabs and with many; Symbiotes with none, two,
   five running; Folders at home, a `~/projects`-like folder, `/`, a repository picked, an
   error, the cap; Stop's question; a stopped tab.
5. **Numbers**: `GET /api/folders` on a `~/projects`-like folder and `System32` against NX2's
   (5–6 ms, 44–47 ms); Symbiotes' first card from opening the nexus.

**Risks**

| Risk | Mitigation |
|---|---|
| A repository's click now starts a process (it went in before) | The card says Open Symbiote; Stop ends it; the person asked for it |
| A home kept in git would make every folder "inside a repository" | Not an end: listed as NX2 does; a unit test |
| A worktree's `.git` names its folder relative or absolute | Both resolved from the worktree; unit tests |
| Moving on a grid by the arrows is new code | Pure, by the items' boxes; unit tests and e2e |
| The viewer's class names change | `test/page.test.ts`'s list, the screenshots |

**Order**: NX3a the server (the branch, the end); NX3b the row and Symbiotes; NX3c Folders; NX3d
the look, the numbers and the docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| NX3a | The end of the way down, the branch | `src/folders.ts`'s listing, its tests |
| NX3b | The row and Symbiotes | Two groups, the line, dots; cards; Repositories in; e2e |
| NX3c | Folders | Places, repository cards, folder rows, the grid's keys, the picked card; e2e |
| NX3d | The look, numbers, docs | Screenshots, numbers; README, commands, CLAUDE.md |

**Decisions** (the person's answers, 2026-10-28):

| # | Question | Decision | Why |
|---|---|---|---|
| 551 | How the row tells the nexus's pages from the Symbiotes | **Two groups, a line between; the pages with icons, the Symbiotes with a state dot; the pages stay at the left** | "separate by a line or something"; a second cue beyond the line, and none of them hidden by a scroll |
| 552 | What fills Symbiotes | **The running ones as cards; "Repositories in <folder>" under them, the near repositories that run no Symbiote** (the person: "make a decision") | One click to the next Symbiote; the listing exists (5–6 ms) |
| 553 | Folders' look | **Places at the left, repositories as cards, folders as rows in columns, the counts in the card's head** (the person: "Yes") | A repository is what the tab is for; 16 of 46 in `~/projects` |
| 554 | A repository's depth | **The end: its click opens its Symbiote; the server never lists inside one but in a home kept in git** (the person: "Yes") | "it should stop there, i should not be able to go deeper" |
| 555 | What a repository's card says | **Its branch from its `HEAD`, no git process** | 3–4 ms for 16 repositories; tells worktrees apart |

**Not in NX3 (later)**: what waits in each Symbiote (its workspaces, an agent that needs the
person); the repositories inside each plain folder (125–400 ms on WSL's drives); a repository's
last commit (a git process each).

## As built (NX3)

- **The decisions' numbers**: planned as 544–548; `milestone/v75-suggested-settings` had taken
  544–550 nine minutes before NX3's plan was committed (neither on `main`), so NX3's are 551–555.
  The commits of NX3a–c still say 544–548.

- **The row** (NX3b, decision 551): as planned. The line is the viewer's `.views-divider`, 24 px
  high, in `--edge` (the field's 3:1 edge), as `--line` read faintly on `--side`. The nexus's own
  pages hold the strip's first 2 px too, so no scrolled tab shows past them, and the strip's
  scroll padding is their width, so a tab reached by the keys scrolls clear of them. The line is
  drawn only when a Symbiote has a tab.
- **Symbiotes** (NX3b, decision 552): **Open a folder** is the page head's action while
  Symbiotes run and the empty state's primary when none does, never both. "Repositories in
  <folder>" has **Show in Folders** in its head. A near folder that is itself inside a
  repository answers its holder (decision 554), drawn once.
- **The end of the way down** (NX3a, decision 554): the listing and git's top level are asked
  together, so a folder outside any repository costs what it did; a path inside a `.git` folder
  is asked from the repository holding it (git names no top level there). The answer's
  `repository` became `picked`, and the card head's "In <repository> · Open Symbiote" went with
  it. The address keeps the folder listed, the holder: a reload shows it without the pick.
- **Folders** (NX3c, decision 553): a picked repository's card is focused whenever an answer
  names one, not only when the keys asked. → and ← move in reading order, ↑ and ↓ to the nearest
  card or row under or over (`nextOnGrid`, by their boxes), Home and End to the ends. NX2's
  chips and `actionOf` went with the rows they drew.
- **The branch** (NX3a, decision 555): as planned; a worktree whose folder is gone, an empty
  `.git` folder and reftable's stub are repositories with no branch shown.
- **The counts** say "1,000 folders", as the rest of Symbiote writes numbers (the cap's
  screenshot said "1000").

**Results (NX3).** Tests first for the server and the page's pure part, red for the right
reasons (no branch, no `picked`, a repository's inside listed; the new functions missing): the
nexus's unit tests went from 80 to 89 (the branch 1, the end of the way down 3, the near folders
1, the cards, counts and arrows 6; NX2's tests of `actionOf` and of a listing's `repository`
gone with them). `pnpm check` passes
(2,174 tests). e2e: the whole suite passes (`pnpm test:e2e`: the viewer's 336 specs in 5.1 min,
then the nexus's 15 in 17.5 s, 14 before): NX1's and NX2's specs moved to the cards, the row's
groups and dots checked, a new spec opening a near repository, Folders' specs for the end of the
way down (typed, and an address loaded inside a repository) and the arrows on the grid; the 3
specs in Symbiote's window under Xvfb pass unchanged. `git diff --stat main` touches
`packages/nexus`, the docs and the README only: no analysis change, no regression-check.

`GET /api/folders`' work (`folders()`), main's against NX3's in one process, alternated, five
runs each after a warm-up, on this machine (WSL2):

| Folder | main | NX3 |
|---|---|---|
| `~/projects` (46 folders, 16 repositories) | 2.9–3.9 ms | 3.6–4.6 ms (16 `HEAD`s read) |
| home (10 folders) | 1.6–2.3 ms | 1.3–1.7 ms |
| `/mnt/c` (18 folders) | 7.8–8.2 ms | 5.4–6.0 ms |
| `System32` (180 folders of 4,950 entries) | 39.9–47.0 ms | 42.6–48.4 ms |
| `~/projects/Symbiote/packages/nexus` | 1.6–2.5 ms (its inside listed) | 3.9–5.8 ms (`~/projects` listed, Symbiote picked) |

Symbiotes, from the nexus's navigation to its first card and to its first near repository (two
Symbiotes running, ten repositories near them, Chromium at 1440×900, five loads): 34–37 ms and
46–50 ms.

Screenshots at 1×, dark and light, 1440 and 800 px wide: Symbiotes with two running and their
near repositories, with none running, Stop's question; Folders in a `~/projects`-like folder
(10 repositories, a detached one, a worktrees folder, 9 folders), at home, at `/`, a repository
picked from a path inside it, an error, the cap (1,005 folders); a Symbiote's tab; the row with
seven Symbiotes, one stopped, scrolled.

Not verified: macOS and Windows outside WSL; the person's own window on WSLg (Xvfb only); a home
kept in git on a real machine (a unit test with a stand-in only); the page on the person's real
`~/projects` (the listing was timed there, the screenshots used a stand-in home); a reader test
of the README's section by a fresh reader.
