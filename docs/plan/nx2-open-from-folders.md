# NX2 — Open a Symbiote from the nexus, in any folder of this PC

[Index](../PLAN.md) · [Journal](../journal/nx2-open-from-folders.md)

**Status:** built (2026-10-28), ready for review, on branch `feature/symbiote-nexus-upgrades` (a
workspace started in Symbiote). Planned and OK'd by the person the same day, with their answers
(decisions 539–543); NX2a–c built. "As built" and results at the end.

**Problem** (asked: "Would be nice if i can control where symbiotes view can spawn. I need to see
the file structures of my PC, and open a symbiote there."; then "choose the folder where symbiote
view spawn"). Measured on this machine (WSL2, main's build at `e980dde`, 2026-10-28):

| What | Today |
|---|---|
| Starting a Symbiote | Only `symbiote view` in a terminal, in the repository. The nexus cannot: it is read only (decision 526); NX1 left "starting or stopping a Symbiote from the nexus" for later |
| Stopping one | Ctrl+C in its terminal, or closing its window |
| Folders on this PC | `~/projects`: 48 entries, 46 folders, 16 repositories (a `.git` folder or file); home: 46 folders, 1 repository; Windows' drives at `/mnt/c`, `/mnt/d` |
| A folder listed, its repositories marked (`readdir` + a `stat` of each folder's `.git`) | 2–6 ms (home, `~/projects`), 3 ms (`/mnt/c`, over WSL's 9p), 10 ms (`/usr/bin`, 1,070 entries), 38 ms (`/mnt/c/Windows/System32`, 4,950 entries) |
| `symbiote view --no-open` to its record (`<cache>/running/<pid>.json`) | 216–223 ms, a throwaway repository |
| Spike: started detached by another process (`detached`, output to a file) | Serves on after that process exits (a session of its own); SIGTERM stops it in ~11 ms and removes its record |
| Spike: started outside a repository | Exits 1 in 217 ms: `symbiote: not inside a git working tree: <path>` |
| The nexus's server | GET and HEAD only (405 otherwise); its own hosts only |

What causes it:
- The nexus only reads (decision 526): it lists what runs and starts nothing.
- No page in Symbiote shows the PC's folders; the desktop app's start page has the system's
  folder dialog only, which on WSL opens on the Windows desktop.

**Goal**: in the nexus, a **Folders** tab shows this PC's folders and marks the repositories;
**Open Symbiote** on one starts `symbiote view` there and opens its tab. A Symbiote can be
**stopped** from the nexus and a stopped one **started again**. **Unchanged**: `symbiote view`
(the CLI, its record, its server), the viewer, the engine, the desktop app; the nexus's list and
tabs as NX1 built them.

## The Folders tab (decisions 539, 540)

- **A tab of its own**, second in the row after Symbiotes, always there. Its address is
  `#folders:<path>`: a reload comes back to the folder (a Symbiote's tab is `#<root>`, always
  absolute, so the two never meet).
- **Head**: the page head (the S, "Folders", "Open a Symbiote in any repository on this PC").
  Then the **places**: Home, the folder the running Symbiotes are in (the newest one's parent,
  here `~/projects`), `/`, and on WSL each Windows drive (`/mnt/<letter>` holding a folder, named
  `C:`). Then **Go to folder**: a field for a typed or pasted path (`~` is home).
- **The card**: the folder's path as crumbs (each opens its folder) with Up, then its folders by
  name. A repository (a `.git` folder or file inside: worktrees count) is marked *repository*,
  and *running* when a live Symbiote serves it. **Folders only** (the person: "Only folders
  atm"): no files. Hidden folders are left out (the field reaches them). At most 1,000 rows, then
  "and N more folders".
- **Where it opens**: the address's folder; else the folder the running Symbiotes are in; else home.
- **Keys**: ↑ and ↓ between rows, Enter opens a folder, Backspace goes up.
- **Unreadable or missing folders**: the error in the card ("Permission denied", "No such
  folder"), the crumbs still there to go back.

## Opening a Symbiote (decision 541)

- **Open Symbiote** on each repository row, and on the head of a folder inside a repository (its
  root named). A running one's row says **Show** and opens its tab.
- **What runs**: this checkout's CLI, `packages/cli/dist/bin.js view --no-open`, by the nexus's
  own `node`, in the folder; the nexus's environment. The CLI resolves the repository's root as
  it does in a terminal. Found beside the nexus's own build (`../../cli/dist/bin.js` from
  `packages/nexus/dist`): the install builds both (decision 535); one checkout, one version.
- **Detached**: a session of its own, stdin closed, its output into `<cache>/nexus/<pid>.log`
  (the files of processes that are gone removed at the next start). It outlives the nexus (the
  person: "Yes"): its agents keep working; a nexus opened later lists it again.
- **Started** once its record appears (`running/<pid>.json`, the contract NX1 built); the POST
  answers with it and the page opens its tab and focuses its frame. **Failed**: it exits first:
  the CLI's last error line, in the card. **Too slow**: no record in 30 s: stopped, the last lines
  shown.
- **Already running** (a live Symbiote of that folder's repository root): its tab opens, nothing
  starts.

## Stopping and starting again (decision 542)

- **Stop** on each row of Symbiotes (an icon button), for every Symbiote (the person: the
  recommendation): a question first, in the page ("Stop <name>? Its terminals and agents stop
  with it."). The server sends SIGTERM, what Ctrl+C does, to the process of a **live** record
  of that root (its process alive, its `/api/status` answering), never to a pid the page sends,
  and answers once its record is gone (5 s at most).
- **Start again** on a stopped tab: the same start in its folder.

## The server (decision 543)

- `GET /api/folders?path=<absolute>` → `{ path, parent, repository, places, folders, more }`.
- `POST /api/symbiotes` `{ folder }` → `{ symbiote }`, or 422 `{ error }`.
- `POST /api/symbiotes/stop` `{ root }` → 204, or 404 when none runs there.
- Writes as the viewer's server takes them: JSON, `x-symbiote: 1`, and its own origin if one is
  sent; anything else 403. The host check stays (DNS rebinding); no CORS headers, so no other
  site reads a listing.
- Modules: `src/folders.ts` (a listing, the places, the repository's root by
  `git rev-parse --show-toplevel`), `src/start.ts` (starting, waiting, stopping); the page's pure
  part in `src/page/folders.ts` (crumbs, rows, the address).
- Its logs (LG1): "symbiote started" / "symbiote stopped" with the root, pid and url, and failures.

## Verification

1. **Unit tests first** (red before): a listing of a temporary tree (folders by name, files left
   out, a repository with a `.git` folder, a worktree with a `.git` file, hidden ones out, a link
   to a folder, an unreadable folder, the 1,000 cap); the places (home, the Symbiotes' folder, WSL's
   drives from `/proc/version` and `/mnt`); the routes (403 cross-origin or without the header,
   400 a relative path, 422 a failed start); starting (the record appears; it exits first with
   its error; already running: no process; the 30 s timeout); stopping (only a live record's pid;
   none: 404); the page's pure part (crumbs, the address, a row's button).
2. **e2e** (`packages/nexus/e2e`, real builds, a cache and `HOME` of the spec's own): Folders lists
   a folder with two repositories and a plain folder; Open Symbiote shows its Git page; again: no
   second record; a folder that is no repository: its error; Stop from the list: the tab stopped;
   Start again: back; a started Symbiote serves on after the nexus stops; no page errors in any
   frame. In Symbiote's window (Xvfb): open one from Folders.
3. **Nothing else changes**: `git diff --stat main` shows `packages/nexus` and the docs;
   `pnpm check`, `pnpm build`, `pnpm test:e2e` (the viewer's specs, then the nexus's). No analysis
   change: no regression-check.
4. **The look** (`symbiote-style`): screenshots at 1×, dark and light, of every nexus state:
   Folders at home, in a repository, a big folder (the cap), an error; Stop's question; a stopped
   tab with Start again; Symbiotes; 800 px wide.
5. **Real numbers**, on a copy of this repository (`git archive`) and throwaways, never the
   person's running Symbiote or cache: Folders listing `~/projects` and `System32` through the
   API, and from Open Symbiote's click to its Git page's first row.

**Risks**

| Risk | Mitigation |
|---|---|
| Symbiotes started from the nexus run on after it closes | The person's choice: a nexus opened later lists them, Stop ends them |
| A worktree's Symbiote opened beside its main checkout's replaces MC1's one record per repository (decision 358), which `symbiote mcp` reads | As with two started by hand today; recorded |
| A pid reused after a crash | Stop signals only a record whose process lives and whose server answers its status as a Symbiote |
| The nexus can now start processes | Only `symbiote view` of this checkout, in a folder the page names, by a same-origin JSON request with the custom header; the folder is the cwd, never an argument |

**Order**: NX2a the server (folders, start, stop; usable with curl); NX2b the page (Folders, Stop,
Start again); NX2c the e2e in the window, the look, the numbers, the docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| NX2a | Folders, starting and stopping | `src/folders.ts`, `src/start.ts`, the server's routes, their tests |
| NX2b | The page | The Folders tab, Open Symbiote, Stop and its question, Start again; e2e |
| NX2c | The window, the look, the docs | The app's spec, screenshots, numbers; README, commands, CLAUDE.md |

**Decisions** (the person's answers to the plan's questions, 2026-10-28):

| # | Question | Decision | Why |
|---|---|---|---|
| 539 | Where the folders are shown | **A Folders tab, second in the row, always there** (the person: the recommendation) | Tabs are the nexus's way (decision 522); the list of Symbiotes stays as it is |
| 540 | What it shows | **Folders only, repositories marked by their `.git` (worktrees count), hidden ones left out, 1,000 at most; places: home, the Symbiotes' folder, `/`, WSL's drives** (the person: "Only folders atm") | A Symbiote opens on a folder; listing one costs 2–38 ms here |
| 541 | How a Symbiote starts, and how long it lives | **This checkout's `symbiote view --no-open`, by the nexus's node, detached, output to `<cache>/nexus/<pid>.log`; started once its record appears; it outlives the nexus** (the person: "Yes") | The record is NX1's contract; an agent at work keeps working when the nexus closes |
| 542 | Stopping | **Every Symbiote, after a question; SIGTERM to a live record's process only** (the person: the recommendation) | What Ctrl+C does; a pid from the page is never trusted |
| 543 | What the nexus may do (decision 526 widened) | **Read records, statuses and folder names; start and stop `symbiote view`; never write in a folder; writes only same-origin JSON with `x-symbiote: 1`** | Starting is asked for; the viewer's server guards its writes so |

**Not in NX2 (later)**: files in the listing; a `symbiote view` run in a terminal opening as a
nexus tab instead of its own window; `git init` on a plain folder; `symbiote pr` from the nexus;
Symbiotes on other machines.

## As built (NX2)

- **The server and the start** (NX2a, decisions 540–543): as planned. The CLI is found at
  `../../cli/dist/bin.js` from the nexus's own module; when it is missing, a start answers
  "symbiote is not built (<path>): run pnpm build". The registry gained `readRecord(cache, pid)`:
  a start waits on that one record. A folder whose repository a live Symbiote serves answers with
  that Symbiote, from any folder inside it; nothing starts.
- **`~` is the page's**: the server takes absolute paths only (400 otherwise); the page, which
  has home among the places, expands `~` in **Go to folder**. Each place has a `kind` (home, the
  Symbiotes' folder, the top, a drive) for its icon and for the crumbs, which start at Home or a
  drive (`C:`) when the folder is in one.
- **A row of Symbiotes is two buttons**: the row (its tab) and Stop at its end, since a button
  cannot hold a button. Stop's question is the viewer's `ConfirmDialog`, drawn in its classes:
  **Keep it running** is the default (primary, focused), **Stop** a ghost, Escape keeps it.
- **Rows of Folders**: lucide's folder-git-2 and a neutral *repository* chip mark a repository; a
  running one has a *running* chip and **Show**. The empty list of Symbiotes gained **Open a
  folder**.
- **The keys stay in the tab**: in a folder with no folders, focus goes to Up, so Backspace still
  goes up (found writing the e2e: focus fell to the page's body).
- **The newest listing wins**: an answer to an older request is dropped (a folder typed while Up
  is on its way); the first listing is asked once, not again at each 2 s read while on its way.

**Results (NX2).** Tests first, red for the right reasons (no modules; the routes answering 404
and 405): the nexus's unit tests went from 46 to 80 (the listing and places 10, starting and
stopping 9, the server's routes 8 new and 1 changed, the page's pure part 6, the command 1). `pnpm
check` passes (2,165 tests; 2,114 before). e2e: the whole suite passes (`pnpm test:e2e`: the
viewer's 336 specs in 5.1 min, then the nexus's 14 in 16.1 s, 8 before): 5 new Folders specs in a
browser, 1 in Symbiote's window under Xvfb, NX1's updated for the new tab. `git diff --stat` against
`e980dde` touches `packages/nexus`, the docs, the README and `CLAUDE.md`, nothing else: no
analysis change, no regression-check. Measured with the built nexus on a cache of its own, headless
Chromium at 1440×900:

| What | Result |
|---|---|
| A listing through `GET /api/folders`, five times | `~/projects` (46 folders, 16 repositories) 5–6 ms, 18 ms the first; home 3–4 ms; `/mnt/c` 9–10 ms; `System32` (180 folders of 4,950 entries) 44–47 ms |
| Open Symbiote on a 300-deep clone of this repository (962 commits, 1,538 files), three runs | the start answered in 288–290 ms; its Git page's first row 487–608 ms after the click |
| … on throwaway repositories (one commit), screenshot runs | 837–846 ms after the click |
| Stop (curl, a throwaway) | 66 ms, its record gone |
| A Symbiote started from the nexus, the nexus stopped by Ctrl+C | still answering `/api/status`; a new nexus lists it and stops it |

Screenshots at 1×, dark and light, 1440 and 800 px wide: Symbiotes with Stop, Folders at the
Symbiotes' folder, in a repository, a typed folder that is missing, a Symbiote opened, Stop's
question, a stopped tab with Start again.

Not verified: macOS (its places: `/Volumes` is reached through `/`, not a place of its own) and
Windows outside WSL; the person's own window on WSLg (Xvfb only); a start on a repository on
`/mnt/c` (git over WSL's 9p); a Symbiote stopped while an agent works in one of its terminals
(the specs run no agent); a reader test of the README's section by a fresh reader.

