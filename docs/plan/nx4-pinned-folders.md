# NX4 — Pinned folders in the nexus

[Index](../PLAN.md) · [Journal](../journal/nx4-pinned-folders.md)

**Status:** planned (2026-10-30) on branch `feature/pinned-in-symbiote-nexus` (a workspace started
in Symbiote). OK'd by the person the same day, with their answers (decisions 617–620).

**Problem** (asked: "I need pinned feature in symbiote-nexus"; to the plan's questions: what is
pinned, "Folders"; a pinned one not running, "Wait for my start"; a pin on a repository's card, "As
you wish"). Measured on this machine (WSL2) from the person's logs (`~/.cache/symbiote/logs`,
2026-10-28 to 30) and `src/folders.ts` over their folders:

| What | Today |
|---|---|
| The nexus's runs | 14 in three days, each on a new port (`--port 0`): a page's own storage starts empty at each |
| Symbiotes started from the nexus | 10: 9 in `~/projects/Symbiote`, 1 in `~/projects/eth-wallet` |
| Folders' places with nothing running | Home, `/`, `C:`, `D:` (the tab opens at home: 10 folders, no repository) |
| Folders' places with Symbiote running | Home, `projects`, `/`, `C:`, `D:`: `projects` is a place only while a Symbiote in it runs |
| `~/projects` | 46 folders, 16 repositories |
| A folder the person goes back to, e.g. `~/projects/Symbiote.worktrees` | Home, projects, then found among 46 folders: three clicks and a search by eye, at every run |
| A running `symbiote view` | 229 MB resident |

What causes it: Folders' places are home, the folders the running Symbiotes are in (three at
most), the top and the drives (NX2, decision 540). Nothing the person chooses is kept: the nexus
keeps no state of its own, and its selection lives in the address only (decision 521).

**Goal**: the person pins a folder or a repository in Folders, and it stays in the places card,
under **Pinned**, from one run of the nexus to the next. A click on a pin shows it; nothing starts
until the person asks. **Unchanged**: the row, Symbiotes, starting and stopping (decisions
541–543), kept frames (521), the address, a repository the end of the way down (554),
`symbiote view`, the viewer, the engine, the desktop app.

## What a pin is (decision 617)

```
 ▭ Folders                                          [ Go to folder: /path or ~/path ]
 ┌ Places ───────────┐ ┌ ↑ Home / projects       16 repositories · 30 folders  📌 ┐
 │ ⌂ Home            │ │ Repositories 16                                         │
 │ ▭ projects        │ │ ┌────────────📌┐ ┌─────────────┐ ┌─────────────┐        │
 │ ⛁ /               │ │ │⎇ Symbiote   │ │⎇ eth-wallet  │ │⎇ ky          │        │
 │ ⛁ C:              │ │ │⑂ main       │ │⑂ main        │ │⑂ main        │        │
 │ Pinned 3          │ │ │Running · Show│ │Open Symbiote │ │Open Symbiote │        │
 │ ▭ Symbiote.worktr…│ │ Folders 30                                              │
 │ ⎇ Symbiote      ● │ │ ▭ Agentic      ›   ▭ CryptoTokens ›   ▭ Ethereum     ›  │
 │ ▭ Desktop         │ │                                                         │
 └───────────────────┘ └─────────────────────────────────────────────────────────┘
```

- **A folder or a repository**, kept in the places card under its own head, **Pinned** and their
  count, after the places the nexus finds itself (home stays at the top, where it always is), in
  the order pinned.
- **A pin's row** is a place's (the sidenav's row): the folder's icon, or the repository's for a
  repository; its name; a green dot when a Symbiote serves it. The full path is its tooltip. Two
  pins of one name also show their parent's ("Symbiote · Symbiote.worktrees").
- **A folder that is gone** keeps its pin, marked "not found": the person unpins it. A pin is the
  person's; the nexus never drops one silently.
- **A place the nexus found that is pinned too** (a running Symbiote's folder) is drawn once, as
  the pin.
- **No pins**: a muted line under Pinned says how to make one.
- Under 960 px (the places a row over the folder's card, NX3) the pins follow the places in that
  row, after their head.

## Where pins are kept (decision 618)

- **`nexus.json` in Symbiote's settings folder** (`configDir`: `~/.config/symbiote` on Linux,
  beside `hive.json` and `library.json`): `{ "pinned": ["/home/…/Symbiote.worktrees", …] }`.
- **Not the page's storage**: the nexus serves on any free port, a new origin at each of the 14
  runs; the pins would not outlive one. **Not the cache**: it holds what can be rebuilt.
- **Read with each listing**: `GET /api/folders` answers `pinned` beside `places`, each pin with its
  name, path, whether it is a repository (its `.git`, as a listing marks one) and whether it is
  gone. A second nexus's pins show at the next listing.
- **Written by `POST /api/pinned`** `{ path, pinned }`, answered with the pins; taken as the
  nexus's other writes are (decision 543): JSON, `x-symbiote: 1`, its own origin. A pin must be
  an absolute folder that exists and is not inside a repository (git's top level, as decision 554
  asks it; a repository's root is fine); an unpin takes any pinned path. Written to a file beside
  it, then renamed (the registry's way): a reader never sees half a file. A broken file reads as
  no pins; the next pin writes a new one.

## A pin never starts anything (decision 619)

- The person: "Wait for my start". **A pinned folder's click lists it**, as a place's does. **A
  pinned repository's click lists the folder holding it, its card picked** (focused, scrolled to),
  as a typed path does (decision 554): Open Symbiote, or Enter on the picked card, is the
  person's start. Its row is the current place while its card is picked.
- Pinning or unpinning starts and stops nothing.

## Where the person pins (decision 620)

- **The folder listed**: a pin button at the end of its card's head, beside the counts; filled in
  the accent when pinned (a click unpins). Not for home, `/` and the drives: always places.
- **A repository**: a pin button in its card's top-right corner (the person: "As you wish"), as a
  repository is never listed (decision 554). The card stays one button that opens its Symbiote;
  the pin stands beside it, as Symbiotes' Stop stands beside its card (a button cannot hold a
  button, NX2). It shows on the card's hover or focus, and always when pinned; its room is kept
  either way (layout never depends on hover).
- **A pin's row**: an unpin button at its end, shown on hover or focus: the way to unpin a folder
  that is gone.
- **A folder's row has none**: going in is one click, then the head's pin.
- Pins are only in Folders: Symbiotes' "Repositories in" draws the same cards without one.

## Verification

1. **Unit tests first** (red before): the pins file (missing, broken, not a list, a relative path
   or a duplicate in it, the order kept; pin, pin twice, unpin, unpin one not pinned; written
   through a temporary file); a pin's description (a folder, a repository by its `.git` folder or
   file, one gone); `places()` without the pinned folders; the routes (`GET /api/folders`'
   `pinned`; `POST /api/pinned` without `x-symbiote` 403, not an object 400, a relative path 400,
   a folder gone 404, a folder inside a repository 422, a pin and an unpin 200 with the list, the
   file written); the page's pure part (two pins of one name, the current place, which folders
   the head may pin); the page's guard with any new viewer class.
2. **e2e** (`packages/nexus/e2e`, real builds, a settings folder of the spec's own, never the
   person's): pin `projects` from its head, its row under Pinned, a click lists it; stop the nexus
   and start another on the same settings folder: the pin is there; pin a repository from its card,
   its row's click lists `projects` with the card picked and starts nothing (no record in the
   cache); Open Symbiote, then the row's green dot; unpin from the row; a pinned folder removed
   shows "not found" and unpins; the app's spec under Xvfb; no page errors.
3. **Nothing else changes**: `git diff --stat main` touches `packages/nexus`, the docs and the
   README; `pnpm check`, `pnpm build`, `pnpm test:e2e`. No analysis change: no regression-check.
4. **The look** (`symbiote-style`): screenshots at 1×, dark and light, Hive mode, 1440 and 800 px:
   Folders with no pins (the hint), three pins (a folder, a running repository, one gone), the
   head's pin both ways, a card's pin on hover and pinned, a pin's row on hover.
5. **Numbers**: `GET /api/folders`' work with no pins and with five (one on `/mnt/c`); the
   write's.

**Risks**

| Risk | Mitigation |
|---|---|
| Two nexuses pin at once and one write is lost | Each write reads the file first, then renames a whole file; the last one wins in the same few ms. Rare: one person, one click at a time |
| A pin on WSL's drives (9p) slows each listing | Each pin costs two `stat`s; measured in step 5 |
| A pin's button on every card is noise (16 in `~/projects`) | Shown on hover or focus only, unless pinned |
| The settings folder is the person's: a test writes there | Every spec and unit test has its own (`XDG_CONFIG_HOME`, a temporary folder) |
| The viewer's class names change | `test/page.test.ts`'s list, the screenshots |

**Order**: NX4a the pins on the server; NX4b Folders' pins and buttons; NX4c the look, numbers and
docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| NX4a | The pins kept | `src/pins.ts`, `nexus.json`, `GET /api/folders`' `pinned`, `POST /api/pinned`; their tests |
| NX4b | Pins in Folders | Pinned in the places card, the head's and the cards' pins, a pin's row; e2e |
| NX4c | The look, numbers, docs | Screenshots, numbers; README, configuration, CLAUDE.md |

**Decisions** (the person's answers, 2026-10-30):

| # | Question | Decision | Why |
|---|---|---|---|
| 617 | What is pinned | **Folders and repositories, in Folders' places card under Pinned, after the places the nexus finds, in the order pinned** (the person: "Folders") | The places are what the person jumps from; home keeps its place at the top |
| 618 | Where pins are kept | **`nexus.json` in Symbiote's settings folder, read with each listing, written by `POST /api/pinned` with decision 543's guard** | A new port at each run empties a page's storage; the cache is for what can be rebuilt |
| 619 | What a pin's click does | **Shows it: a folder listed, a repository picked in the folder holding it; nothing starts** (the person: "Wait for my start") | A start is the person's: 229 MB a Symbiote here |
| 620 | Where the person pins | **The listed folder from its head, a repository from its card's corner, an unpin on a pin's row; none on a folder's row** (the person: "As you wish") | A repository is never listed (554); a folder is one click from its head; a gone folder needs a way out |

**Not in NX4 (later)**: dragging pins to reorder them (unpin and pin again moves one to the end);
pins on Symbiotes' page or in the row; a Restart button (6 of the person's 7 stops from the nexus
were followed by a start of the same repository 4–22 s later).
