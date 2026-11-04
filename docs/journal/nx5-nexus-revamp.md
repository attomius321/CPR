# Journal: NX5 — Nexus revamp: search by path, one ordered list, the picked repository's card

[Index](../JOURNAL.md) · [Plan](../plan/nx5-nexus-revamp.md)

## NX5 spike — three designs, the scan's cost, where a history could come from (2026-11-04, branch `feature/nx5-nexus-revamp`)

Three designs for the nexus's page were drawn as static screens in the redesign's kit
(`spikes/hive-redesign/src/kit.css`, `spikes/normal-redesign/src/normal.css`), 1440 × 900 at 1×,
dark and light, in four states each (the page, a search, a path completing, the first run), with
today's nexus on the same data as the before: A one list with columns, B a list and the picked
repository's card, C a launcher in the tab row. They went on one review page; the person picked
B, then asked that only a folder they choose be scanned. Today's nexus was shot by serving the
built nexus with its two reads answered from the designs' data (`page.route`), nothing running.

**Learned**:
- **A scan of home is cheap here**: 913 folders and 41 repositories, 5 levels, 35 ms cold and
  6–12 ms warm; depth 3 already finds 31. `~/projects` alone: 256 folders, 21 repositories,
  3–6 ms. The person chose to scan one folder of their choosing, not home.
- **MC1's records are no history**: `<cache>/views/*.json` is removed when a view stops
  (`removeViewRecord`), so only running views are there. The nexus's own logs name the Symbiotes
  it started, not those started in a terminal. NX5 keeps its own history.
- **Worktrees are mostly Symbiote's own**: this repository has 26 (`.git/worktrees`), 25 of them
  analysis checkouts in `~/.cache/symbiote/worktrees`. A repository's checkouts must leave the
  cache's out.
- **Keys in a Symbiote's frame never reach the nexus**: each Symbiote serves on its own port, so
  its frame is another origin. A launcher bound to Ctrl K (option C) would work only on the
  nexus's own page.
- **Today's page shows 9 repositories at 900 px, 4 of them twice**: a running repository is a
  Symbiote card and, in the folder listed under them, a repository card.

## NX5a — the scan of the chosen folder, the history, the checkouts (2026-11-04, branch `feature/nx5-nexus-revamp`)

The server's side (decisions 911, 912, 914): `src/scan.ts`, `src/opened.ts`, `src/checkouts.ts`,
the folder scanned in `nexus.json` beside the pins (`src/pins.ts`), and the routes
`GET /api/repositories`, `GET /api/checkouts`, `POST /api/scanned` and `/api/scan`.

**Learned**:
- **A test tree's `+` marked only its last folder**: `'app+/packages/inner+'` made a folder named
  `app+`. Nested repositories need their own entries.
- **`checkoutOf` already reads a worktree's `HEAD` through its `.git` file**, so the scan and the
  checkouts read branches with no git process; a worktree whose `gitdir` points nowhere is still a
  repository, with no branch to say.
- **The pins' write queue serves the folder scanned too**: both are in `nexus.json`, and a pin and
  a choice asked at once must not write over each other.

**Verification**: tests first (red for a missing module, then for the missing methods); 151 nexus
unit tests; the scan proven to read nothing beside the folder and to change nothing in it (every
path's modification time compared), a read-only folder read, a locked one passed over.

## NX5b — the page's pure parts (2026-11-04, branch `feature/nx5-nexus-revamp`)

`src/page/search.ts` (the groups, their orders, the search, the marks), `complete.ts` (a typed
path, Tab, →, Backspace) and `pick.ts` (the pick kept by path, the keys, the card's kind).

**Learned**:
- **The common start of `Brand-assets` and `brand-site` is `Brand-`**, in the first hit's case:
  the test had guessed `Br`.
- **Ties in Opened before keep the order listed**: two Symbiotes first seen in one read share their
  time.

**Verification**: 21 new tests, red first; 172 nexus unit tests.

## NX5c — the list, the card, the field (2026-11-04, branch `feature/nx5-nexus-revamp`)

The page (decisions 908–910, 913, 915, 916): `list-view.ts`, `detail-view.ts`, `main.ts`'s
Symbiotes, `nexus.css`'s home; `folders-view.ts`, `cards.ts`, the grid's arrows and the places go.

**Learned**:
- **The pick landed on a pin**: the list was drawn once what the nexus knows was read and before
  the running Symbiotes were, so its first row was a pin, kept by its path. The pick now waits for
  both reads.
- **After Enter the search stayed**: back on Symbiotes, the list was still filtered to the
  repository just opened. Showing or opening one clears the field.
- **The pin's button changes its name when pressed**, so focus kept by the button's name was lost
  on every pin; the card puts it back on the pin by its class.
- **`nexus.css` may name no font** (`page.test.ts`): the branch is a `code`, which the viewer sets
  in mono.

**Verification**: e2e first (`list.spec.ts`: 7, red until the page was built), then 24 nexus e2e
with the three older specs ported; `pnpm check` (3,196 tests).

## NX5d — screens, measures, docs (2026-11-04, branch `feature/nx5-nexus-revamp`)

Every state at 1440 × 900, 1×, dark and light, from the built nexus with the designs' example
data served to it (`page.route`); the scan and the page timed on this PC; the README's
`nexus.png` retaken (34 KB, 256 colours); the guide, the configuration and commands references and
`packages/nexus/CLAUDE.md` updated.

**Learned**:
- **Home here is 1,691 folders, not the spike's 913**: the spike also skipped `snap`, `go` and
  `Library`. Still 41–48 ms for 43 repositories.
- **A branch shorter than its `min-width` left a gap** before the time; the branch now has none and
  gives way four times faster than the path.
- **The viewer's `app.spec.ts` title test races** under the full run (the window still titled
  "Symbiote"): 20 of 20 pass on Xvfb alone. Not this branch's.

**Verification**: `pnpm build`; the nexus's e2e 24 + 3 (app, Xvfb); the viewer's 429 of 431 in
the full run, the 2 others passing alone; `pnpm check`.

Not verified: a person's real use of Ctrl K inside the desktop app's window (the e2e presses it in
Chromium); a home or folder near the 5,000-folder limit on a slow disk.

Merged into main (2026-11-04).
