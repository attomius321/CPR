# NX5 — Nexus revamp: search by path, one ordered list, the picked repository's card

[Index](../PLAN.md) · [Journal](../journal/nx5-nexus-revamp.md)

**Status:** planned (2026-11-04), on branch `feature/nx5-nexus-revamp` (the workspace's, from
`main` at `8ae448a`); the person picked option B of three designs and OK'd this plan the same day.

**Problem** (the brief: "the person finds a project by its path quickly and sees the projects in
order"). Today's nexus (`main` at `8ae448a`), measured on this PC and on the designs' example data
(26 repositories, 4 running, 3 pinned):

| What | Today |
|---|---|
| Finding a repository by part of its name or path | Not possible. "Go to folder" takes a full path and Enter; anything else is refused ("Type a full path", `typedFolder`, `src/page/folders-tab.ts:53`). No completion |
| Finding one by browsing | One folder at a time (`listFolder`, `src/folders.ts:58`): home, then `projects`, then a search by eye among 46 folders (NX4's measure) |
| The page at 1440 × 900 | Three grids of different widths: the Symbiotes' 320 px cards (`page/nexus.css:158`), the Places card beside the folder card (`:485`), 240 px repository cards (`:285`), folder rows in 220 px columns (`:702`) |
| Repositories in view | 9, 4 of them twice (a running one is a Symbiote card and a repository card) |
| Order | Pinned repositories first in the order pinned, running or not (`symbiotesShown`, `src/page/tabs.ts:115`), then the running ones by name |
| The redesign (V88–V93) | Only the tokens and the tab row reached the nexus; its layout is NX3's and NX4's |

Measured for the plan:

| What | Measured |
|---|---|
| A bounded scan of this PC's home (no hidden folders, no `node_modules`, a repository ends the way down) | 913 folders read, 41 repositories, 5 levels: 35 ms cold, 6–12 ms warm |
| The same scan of `~/projects` only | 256 folders, 21 repositories, 5 levels: 3–6 ms |
| MC1's `<cache>/views/*.json` as a history of opened repositories | None: a view removes its record when it stops (`removeViewRecord`, `packages/cli/src/mcp-bridge.ts:61`); 1 record on this PC, the running one |
| Worktrees of this repository (`.git/worktrees/*/gitdir`) | 26, read in 15 ms; 25 of them Symbiote's own analysis checkouts in `~/.cache/symbiote/worktrees` |

**Goal**: one search field over every repository the nexus knows (running, pinned, opened before,
found in the one folder the person chose), matching any part of a name or path, keyboard first,
paths completing; the repositories in one list, grouped and ordered; the picked one's card beside
it with its facts, checkouts and actions; in the redesign's look, both themes. **Unchanged**: the
tab row (decision 551), frames and how they load (521, 524, 625), the registry, starting and
stopping (541–543), Stop's question (542), the stopped tab's panel, pins kept in Symbiote's
settings folder (NX4, 617–620), a repository the end of the way down (554), `symbiote view`, the
viewer, the desktop app's `--url` mode.

The designs, three options in four states, dark and light, and B's card in every state:
<https://claude.ai/artifact/HewYkJjrSrYsWU6Pv6fvfh> (private to its owner). Their sources:
`coverage/nx5/` (ignored), drawn in `spikes/hive-redesign/src/kit.css` and
`spikes/normal-redesign/src/normal.css`.

## The page (decisions 908, 913, 915)

```
 ▦ Symbiotes 4 │ ● design-system main  ● feature-saved-carts …  ● payments-api …  ● storefront main
 (S) Symbiotes                                                                     [▭ Browse…]
     4 running · 5 pinned · looking for repositories in ~/code
 ┌ ⌕ Find by name or path; ~/ for a path        / ┐ ┌ ● storefront (✓ Running)  ⧉ 📌 [Stop] [Show ↗] ┐
 │ Running 4                    by name, as tabs │ │ ⌂ / code / storefront                         │
 │ ● design-system           1 changed           │ │ Branch main · Changes 3 files · since 08:12   │
 │   ~/code/design-system · main · since 10:05   │ │ Serves at 127.0.0.1:40004                     │
 │ ● storefront 📌 (picked)  3 changed           │ │ ┌ Checkouts of this repository 3 ──────────┐ │
 │ Pinned 4 · Opened before 3 · Found in ~/code 4│ │ └ ~/code/ (the folder it is in) ─────────────┘ │
 │ ⟳ Looking in ~/code: 11 repositories … Change…│ └───────────────────────────────────────────────┘
```

- **A list and the picked repository's card** (908): the page's head (`.page-head`: the S,
  "Symbiotes", the line, Browse…), then two cards: the list, 560 px, and the card, the rest. The
  list's rows are two lines, as the sidenav's (V93): a state dot, the name, then the path, the
  branch and when; files changed at the right for a running one.
- **The pick** (913): always one, kept by path when the list is drawn again (every 2 s, as the
  running Symbiotes are read); at first the first running repository, else the first row. A click
  picks; Enter, a double click or the card's main button acts (Show, Open Symbiote, List it, Try
  again). ↑↓ move the pick while the focus stays in the field (a combobox: `aria-activedescendant`
  on the list's `listbox`). Today a card's click opens its Symbiote: this changes.
- **The card** has a kind for each row: a running repository (Show, Stop, its address, its
  changes, since when); one not running (Open Symbiote; opened before, pinned or found); a folder
  (its folders, read as it is picked; List it, Look for repositories here); a pin whose folder is
  gone (Unpin); starting (an amber spinner, "Starting…"); a start that failed (why, in today's
  words, and Try again). Every repository's card has its path as crumbs (a click lists that
  folder), copy path and its pin. Stop asks in the viewer's dialog, as today (542).
- **Narrow** (915): under 960 px the list stands over the card; nothing else changes.
- Drawn in the viewer's classes where they exist (`.page-head`, `.card`, `.card-head`,
  `.status-label`, `.state-dot`, `.button`, `.icon-button`, `.count`, decision 523); the list's rows,
  the split and the narrow layout in `page/nexus.css`, its colours the viewer's tokens only.

## The list (decision 909)

| Group | What | Order |
|---|---|---|
| Running | Every running Symbiote, pinned or not (a pinned one with a small pin) | By name, as the tabs |
| Pinned | Pins not running: repositories, folders, and pins whose folder is gone | By name |
| Opened before | Repositories the nexus saw running, not running now, not pinned, their folder still there | Last seen first |
| Found in `<folder>` | Repositories the scan found in the chosen folder, in no group above | By path, so worktrees sit by their repository |

A repository is in one group only. Found draws at most 500 rows ("and N more: type to find them").
The group headings stay in view while the list scrolls.

## The search and paths (decision 910)

- **One field** at the list's head. Text that starts with neither `~` nor `/` is a search: every
  word typed must be in the repository's path, `~` for home (its name is the path's last part),
  case aside. The matches are marked in the name and the path. A match in the name ranks first,
  then the group's own order. Groups with no match are hidden; each says "2 of 4".
- **A path** (`~`, `~/…` or `/…`) lists that folder's entries starting with what follows the last
  `/` (`GET /api/folders`, one folder, as Browse reads it today; never inside a repository, 554).
  Tab completes the common part (`~/work/acme/bi` → `billing-service`; one match: whole, with a
  `/` after a folder). → or Enter on a folder goes into it; Backspace right after a `/` goes up one
  folder. ← keeps moving the caret.
- **Keys**: `/` and Ctrl K focus the field on the nexus's page (keys typed in a Symbiote's frame
  go to the viewer: frames are another origin); Esc clears it.
- **Browse…** types `~/` into the field. `#folders:<path>`, the old address, fills the field with
  the path. "Go to folder" and Places go.

## The scan: one folder the person chooses (decision 911)

- **Only the folder the person chose is scanned**, and nothing until they choose one (the person:
  "I should be able to select a folder, and only this folder should be scanned for
  repositories"). It is kept in `nexus.json` in Symbiote's settings folder, beside the pins
  (`"scanned": "/home/…/code"`): the person's choice, never the page's storage or the cache (NX4).
- **Choosing it**: Look for repositories here on a folder's card (a folder typed into, a pinned
  folder, one reached from the crumbs); Change… in the list's foot types `~/` into the field. A
  repository, or a folder inside one, cannot be chosen (decision 554). `POST /api/scanned`
  `{ path }` (or `null` for none), a write as the others (543).
- **Bounded and read only** (`src/scan.ts`): breadth first, 5 levels under the folder; no hidden
  folders, no `node_modules`, `vendor`, `target`, `dist`, `build`, `__pycache__` or `venv`, nor
  Symbiote's cache; links not followed; a repository (a `.git` folder or file) ends the way down,
  its branch read from its `HEAD` (555); at most 5,000 folders and 2 s, the answer then says it
  stopped short. It never writes in a folder and never starts a Symbiote (543, 627).
- **When**: at the nexus's start (the last result first, from `<cache>/nexus/scan.json`, then a
  new one), on the foot's ⟳ (`POST /api/scan`), and when the folder changes. The foot says
  "Looking in ~/code: 11 repositories in 38 folders, 3 ms, at 11:02".

## What the nexus remembers (decision 912) and a repository's checkouts (914)

- **Opened before**: MC1's records are removed when a view stops, so the nexus keeps its own
  history, `<cache>/nexus/opened.json`: each Symbiote seen running, by path, with its name and the
  last time seen; at most 50, newest first; written whole through a file renamed into place, when
  a new root runs or a minute after the last write. A Symbiote that ran while no nexus ran is not
  in it.
- **Checkouts** (`src/checkouts.ts`, `GET /api/checkouts?path=`): a repository's main folder and
  its worktrees, from its `.git/worktrees/*/gitdir` (a worktree finds them through its `.git`
  file's `gitdir` and `commondir`). Symbiote's cache's worktrees and pruned ones (their folder
  gone) are left out. The card shows them only when there are worktrees.

## The server

| Route | Answer |
|---|---|
| `GET /api/repositories` | `{ repositories, pins, scan }`: the history and the scan's repositories merged by path, each with its name, branch (or detached commit) and `opened` or `found`; the pins as today (`describePins`); the scan's summary (folder, when, folders read, repositories, ms, stopped short) or `null` |
| `GET /api/checkouts?path=` | `{ checkouts }` for a repository; 404 for anything else |
| `POST /api/scanned` | `{ path }` or `{ path: null }`: the folder to scan, refused with 404, 400 or 422 as a pin is; answers the scan's summary |
| `POST /api/scan` | Scans the chosen folder again; answers its summary |
| `GET /api/folders`, `/api/symbiotes`, `POST /api/symbiotes`, `/stop`, `/api/pinned` | As today |

## Verification

1. **Unit tests first** (red before): `scan.test.ts` (depth; hidden and skipped folders; links not
   followed, a loop included; a worktree's `.git` file is a repository; the caps, the time by an
   injected clock; nothing read outside the folder, with repositories beside it; nothing written:
   the tree is the same after, a read-only folder included; none chosen, nothing scanned);
   `opened.test.ts`; `checkouts.test.ts` (from the repository and from a worktree; cache and pruned
   worktrees left out); the scanned folder in `pins.test.ts` (kept, the pins kept beside it,
   refused for a repository); `server.test.ts` (the four routes, writes guarded);
   `search.test.ts`, `complete.test.ts`, `pick.test.ts` for the page's pure parts;
   `page.test.ts`'s class list.
2. **e2e** (`packages/nexus/e2e`, real `symbiote view`s in throwaway repositories, a home, cache
   and settings folder of the spec's own): a new `list.spec.ts` (find by part of a path, the mark;
   ↑↓ and the card following; Enter opening a found repository and showing a running one; Esc,
   `/`, Ctrl K; Tab, →, Backspace; the first run, choosing a folder, Found following, changed;
   kept to the next nexus; worktrees in the card from `git worktree add`; 900 px wide);
   `folders.spec.ts` and `pins.spec.ts` rewritten for the list and the card; `nexus.spec.ts` (the
   tab row, frames, Stop's question, starting again) kept, its steps on the list.
3. `pnpm check`, `pnpm build`, `pnpm test:e2e`; `app.spec.ts` on Xvfb if the app is set up here.
4. **Screens**: every state at 1440 × 900, 1×, both themes, from the real nexus, beside the
   designs; checked for uneven spacing.
5. **Cost**: the scan of `~/projects` and of home on this PC, cold and warm; the page's first draw
   with 41 repositories.

**Risks**

| Risk | Mitigation |
|---|---|
| A big folder chosen (`/`, a network drive) | The caps: 5,000 folders, 2 s, the foot says it stopped short |
| The pick jumping when the list is drawn again every 2 s | Kept by path; `pick.test.ts` |
| Opened before missing Symbiotes that ran without a nexus | Said in the docs; the scan finds them if they are in the folder |
| Thousands of rows | Found draws 500 at most |
| A class the page uses leaving the viewer's CSS | `test/page.test.ts`'s list |

**Order**: the server's parts (NX5a), the page's pure parts (NX5b), the page (NX5c), then the
screens, measures and docs (NX5d).

## Milestones

| # | Milestone | Output |
|---|---|---|
| NX5a | What the nexus knows | `src/scan.ts`, `src/opened.ts`, `src/checkouts.ts`, the scanned folder in `src/pins.ts`, the routes, `src/main.ts` |
| NX5b | The page's pure parts | `src/page/search.ts`, `complete.ts`, `pick.ts` |
| NX5c | The page | `src/page/list-view.ts`, `detail-view.ts`, `main.ts`, `page/nexus.css`; `folders-view.ts`, `cards.ts`, the grid's arrows and the places go; e2e |
| NX5d | Proof and docs | Screens, measures, this plan's "As built", the journal, `packages/nexus/CLAUDE.md`, `docs/reference/commands.md` |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 908 | What Symbiotes shows (supersedes 552 and 553; replaces 626's folders under the cards and its Go to folder, 627's cards and 628's places) | **A list of the repositories the nexus knows and the picked one's card beside it**; Places, the folder grid and the Symbiotes' cards go (the person picked option B of three) | One list in one order; a card per repository is where what waits in each Symbiote will go later |
| 909 | The list's groups | **Running by name, Pinned by name (folders and gone pins too), Opened before last seen first, Found in the chosen folder by path; a repository in one group; Found at most 500 rows** | Running as the tabs; pins no longer in the order pinned; worktrees by their repository |
| 910 | How a repository is found (replaces 626's Go to folder) | **One field: every word in the `~` path, a name match first; a path (`~`, `/`) lists its folder's entries, Tab completes, → and Enter go in, Backspace after `/` goes up; `/` and Ctrl K focus it; Browse… types `~/`** | "Searching by path is hard": a full path was the only search |
| 911 | What is scanned | **Only the folder the person chose, kept in `nexus.json` beside the pins; nothing until they choose; 5 levels, no hidden or build folders, links not followed, a repository ends the way down, 5,000 folders or 2 s at most; the last result in `<cache>/nexus/scan.json`** | The person: "only this folder should be scanned"; `~/projects`: 256 folders, 21 repositories, 3–6 ms |
| 912 | Where "Opened before" comes from | **The nexus's own history, `<cache>/nexus/opened.json`: each root seen running, at most 50** | MC1's records are removed when a view stops |
| 913 | What a click does | **It picks; Enter, a double click or the card's button acts; there is always a pick, kept by path** | The card follows the pick; ↑↓ from the field |
| 914 | A repository's checkouts | **From `.git/worktrees/*/gitdir`; Symbiote's cache's and pruned worktrees left out; shown only with worktrees** | 25 of this repository's 26 worktrees are Symbiote's own analysis checkouts |
| 915 | A narrow window | **Under 960 px the list stands over the card** | Every action stays in reach with no second layout of the rows |
| 916 | A folder's card | **Its own folders and repositories, one level, read as it is picked; Look for repositories here makes it the scanned folder** | A deeper listing would be a second scan |

**Not in NX5 (later)**: what waits for the person in each Symbiote (plans ready, reviews) in its
card; several scanned folders (a list in the same file); the launcher in the tab row (option C);
the viewer forwarding Ctrl K from a frame.
