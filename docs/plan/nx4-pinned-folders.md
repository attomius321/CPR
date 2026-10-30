# NX4 — Pinned folders in the nexus

[Index](../PLAN.md) · [Journal](../journal/nx4-pinned-folders.md)

**Status:** built (2026-10-30) on branch `feature/pinned-in-symbiote-nexus` (a workspace started
in Symbiote), ready for review. Planned and OK'd by the person the same day, with their answers
(decisions 617–620); NX4a–c built. "As built" and results at the end.

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
  repository; its name; a green dot when a Symbiote serves it. Two pins of one name also show
  their parent's ("Symbiote · Symbiote.worktrees").
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

## As built (NX4)

- **The places card is 260 px wide** (NX3's 220): a pin's row keeps room for its unpin, and at 220
  "Symbiote.worktrees" was cut to "Symbiote.worktr…" and a gone folder's name to "old-not…". The
  folder's card is 40 px narrower; under 960 px nothing changes.
- **A pin's unpin is the sidenav's bin** (V55): over the row's end, the row keeping its room
  (36 px), so the row's hover and current wash span it as a place's do. It shows on the row's
  hover or keyboard focus (`:has(:focus-visible)`), and always without hover (`@media (hover:
  hover)`); a card's pin the same. The first try kept the unpin beside the row, in a grid: the
  row's wash ended 30 px short of the places'.
- **No tooltip with the full path**: the viewer never draws one by `title` (V54) and the nexus has
  no tooltips of its own. Two pins of one name show their parent's name, or their parent's path
  when those are alike as well; a pin's click shows its path in the crumbs.
- **An unpin from its own row** puts the focus on the next pin's row (the one before it when it was
  the last), else on the first place.
- **A pin of a file** is refused, 400 "Not a folder", beside the planned 404 and 422.
- **Each pin and unpin is a line of the nexus's log** (`folder pinned`, `folder unpinned`, LG1).
- **The places come with a listing**, as before NX4: a Symbiote started from Folders makes its
  folder a place at the next listing. The spec of a running Symbiote's folder pinned lists again
  first.
- **NX3's spec** counted every `.nexus-group-head` on the page; the places card has one now
  (Pinned): scoped to the folder's card.
- **NX4a's commit message** says the unit tests went from 97 to 104: they went from 94. The amend
  that would have fixed it needed a force-push, refused.

**Results (NX4).** Tests first for the pins (red: no `pins.ts`, no route) and the page's pure part
(red: `pinNames`, `placesShown`, `currentPlace`, `pinnable` missing): the nexus's unit tests went
from 94 to 108 (the pins file and its writes 7, the routes 3, the page's pure part 4; the listing's
test now expects the pins). e2e: a new `pins.spec.ts`, 3 specs (a folder pinned from its head, kept
from one nexus to the next on the same settings folder, unpinned from its row; a repository pinned
from its card, its pin showing it picked with no Symbiote started until Enter, then its green dot,
and a running Symbiote's folder pinned drawn once; a gone folder's pin, "not found", unpinned); the
nexus's 18 specs pass, the 3 in Symbiote's window under Xvfb among them. `pnpm check` passes
(2,465 tests); the whole e2e suite passes (`pnpm test:e2e`: the viewer's 349 specs in 5.3 min, then
the nexus's 18 in 21.7 s). `git diff --stat main`
touches `packages/nexus`, the docs and the README only: no analysis change, no regression-check.

The pins' cost, on this machine (WSL2), five runs after a warm-up, the person's own folders (read
only), taken while the e2e suite ran:

| What | Time |
|---|---|
| The pins read and described, none pinned | 0.1–0.4 ms |
| Five pins (`~/projects`, `Symbiote`, `Symbiote.worktrees`, `/mnt/c/Users`, one gone) | 0.6–0.7 ms |
| `~/projects` listed (46 folders, 16 repositories) | 3.3–4.3 ms |
| `~/projects` listed and five pins read at once (`GET /api/folders`' work) | 3.6–4.5 ms |
| A pin or an unpin of a folder (git asked on a pin) | 0.7–2.7 ms |
| A repository pinned | 2.2–2.5 ms |

Screenshots at 1×, dark and light, Hive mode in both, 1440 and 800 px wide (48): Folders with no
pins (the hint), with four (a folder, a running repository, a folder in home, one gone), a card's
pin on hover beside a pinned one, a pin's row on hover, a pinned folder listed (its row current),
home (no pin in the head). The hint and the Pinned head start at x 33 at both widths, as the
places card's title.

Not verified: macOS and Windows outside WSL; the person's own window on WSLg (Xvfb only); two
nexuses pinning in the same few milliseconds (the last write wins: not tested); the person's real
settings folder (never written: every test and screenshot had its own); a reader test of the
README's paragraph by a fresh reader.

## Fix: pinned Symbiotes on Symbiotes, the folders under them (fix/nexus-pinned-symbiotes)

**Problem** (2026-10-30, the person: "I would like to see the pinned Symbiotes in Symbiotes tab of
nexus...Also i don't like the Folders...Put them in Symbiotes page. It is redundant"). From their
settings folder and logs, read only:

| What | Before the fix |
|---|---|
| The person's pins (`nexus.json`) | Two repositories, `~/projects/Starknet` and `~/projects/Symbiote`; `projects` pinned and unpinned twice within 1.5 s |
| Symbiotes the nexus started on 2026-10-30 | 9: Symbiote 7, Starknet 2, the two pinned |
| Where a pin shows | Only Folders' places card, as a row; Symbiotes shows none |
| Symbiotes' "Repositories in projects" | The repositories of the folder Folders opens on (the newest running Symbiote's): the same cards twice |

**Decisions 626–628** (planned, and OK'd by the person: "Go for it"):

| # | Question | Decision | Why |
|---|---|---|---|
| 626 | Where the folders are | **Under Symbiotes' cards, on the nexus's one page: the row's own group is Symbiotes alone; Go to folder in its head; "Repositories in", Show in Folders and Open a folder go. `#folders:<path>` lists that folder under Symbiotes, and is its address once the person goes to one** | "It is redundant": Folders opened on the folder "Repositories in" showed; old addresses keep working |
| 627 | What a pinned repository is | **A card among the Symbiotes, first, in the order pinned, then the other running ones by name: a running one's card as before (its tab, Stop); one not running with its branch, read from its `HEAD`, and Open Symbiote, a click its start. Every card has its pin in its corner** | The person pins repositories to start them: all 9 starts of the day were the two pinned. Decision 619 kept: nothing starts by itself or by a pin |
| 628 | What a pinned folder is | **A place, under Pinned in the places card, as NX4 drew it; so is a pin whose folder is gone. A pinned repository is not listed there** | A folder is where the person goes, not a Symbiote to open |

```
 ▦ Symbiotes 2 │ ● Symbiote main  ● ky main
 [S] Symbiotes                              [ Go to folder: /path or ~/path ]
     2 running on this machine
 ┌──────────────────── 📌 ■ ┐ ┌────────────────────── 📌 ┐ ┌──────────── ■ ┐
 │ ● Symbiote               │ │ ○ Starknet                │ │ ● ky          │
 │ ⑂ main · 3 files · 19:40 │ │ ⑂ main · Open Symbiote    │ │ ⑂ main · …    │
 └──────────────────────────┘ └───────────────────────────┘ └───────────────┘
 ┌ Places ─────┐ ┌ ↑ Home / projects        16 repositories · 30 folders 📌 ┐
 │ ⌂ Home  …   │ │ Repositories 16 …   Folders 30 …                         │
 │ Pinned 1    │ │                                                          │
 │ ▭ worktrees │ │                                                          │
 └─────────────┘ └──────────────────────────────────────────────────────────┘
```

- **`src/page/main.ts`**: the row without Folders; Symbiotes' head (the S, the count, Go to folder),
  what went wrong, the cards, then the folders' section. Only the line and the cards are drawn
  again: the folders keep their state and focus. A card's focus (its open, its pin, Stop) is kept
  across a drawing by its kind and path, or moves to the card in its place when it left.
- **`src/page/tabs.ts`**: `symbiotesShown(tabs, pins)`, the cards in order; `selectedFrom` reads
  `#folders…` as Symbiotes. `nearFolders` went with "Repositories in".
- **`src/page/folders-view.ts`**: a section, not a tab: no page head, its field handed to
  Symbiotes'. It keeps the pins from each listing and pin, tells the page when they change, and
  pins for Symbiotes' cards (`setPin`). The address names a folder only once the person asked for
  one (a place, a row, a crumb, a typed path, a pin): a listing where the folders open (`null`)
  leaves Symbiotes' address empty.
- **`src/page/folders-tab.ts`**: `pinnedPlaces`; `idleRepositories` and `currentPlace` went (no
  pinned repository is a row any more).
- **`src/pins.ts`**: a pinned repository's checkout, read as a listing reads it (`checkoutOf`,
  exported from `src/folders.ts`).

**As built**: as planned, with these differences:

- **The places' Pinned shows only while a folder is pinned, or nothing is**. With pinned
  repositories only, as the person has, its hint ("Pin a folder from its head, a repository from
  its card.") would stand under the places for good.
- **A pinned folder's row has no green dot**: a running Symbiote's folder is a repository's, and
  a repository is never such a row.
- **The specs' nexus gets a home of its own by default** (`startNexus`): Symbiotes lists a folder
  as it opens, and a spec without one would have listed the person's home.
- **`main` moved under the branch**: fix/first-time-symbiote-from-nexus (decision 625, the frames'
  `address()`) was merged first; merged into this branch without a conflict, its spec passing as
  it is on the one page.

**Results.**

- Tests first, red before: 5 unit tests (`selectedFrom` of `#folders…`, `symbiotesShown` twice,
  `pinnedPlaces`, a pinned repository's checkout: the function missing, or `folders` for null, or
  no `branch`) and 8 e2e specs on main's build (`pins.spec.ts`' 4: a pinned repository among the
  Symbiotes, kept from one nexus to the next and started only by its card; a running Symbiote
  pinned from its card, first; a pinned folder under the places; a gone pin; and `nexus.spec.ts`'
  4 that drew the row with Folders or "Repositories in").
- After: the nexus's unit tests 111 → 113 (4 went with `nearFolders`, `idleRepositories`,
  `currentPlace` and Folders' selection; 6 new); `pnpm check` passes (2,477 tests, main 2,475);
  `pnpm build`. The nexus's e2e, 20 specs, pass (main 19; `pins.spec.ts` 3 → 4), the 3 in
  Symbiote's window under Xvfb among them. `pnpm test:e2e`: the viewer's 352 specs ran, 351
  passed; `workspaces.spec.ts:458` (a card's chip, a box read null) failed under 16 workers and
  passed 3 times of 3 alone. This branch changes nothing in `packages/viewer`.
- `git diff --stat main`: `packages/nexus`, the docs and the README. No analysis change: no
  regression-check.
- A pinned repository's branch, read with the pins (built `pins.js`, five runs after a warm-up):
  the person's two pins 0.3–1.0 ms; five (two repositories, three folders, one on `/mnt/c`)
  0.9–1.2 ms, 4.6 ms the first run. NX4 measured 0.6–0.7 ms for five without it.
- Screenshots at 1×, dark and light, 1440 and 800 px (16): two pinned (one running, one not) and
  one running Symbiote with a pinned folder and a gone pin; a running card's pin on hover; nothing
  running, nothing pinned.

Not verified: macOS and Windows outside WSL; the person's own window on WSLg (Xvfb only); a
pinned repository on `/mnt/c` started from its card (git over 9p); a reader test of the README's
section by a fresh reader.
