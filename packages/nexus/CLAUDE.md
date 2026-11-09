# @symbiote/nexus

Symbiote nexus (NX1, `docs/plan/nx1-nexus.md`): `symbiote-nexus` lists every `symbiote view`
running on this machine and shows each as a tab of one page, in Symbiote's window or a browser
tab. It reads their records and their `/api/status`. Since NX2
(`docs/plan/nx2-open-from-folders.md`) its Folders tab lists this PC's folders, and the nexus
starts `symbiote view` in one and stops a running one (decision 543); it never writes into a
Symbiote, and in a folder only `git init`, after the person's yes (NX6, decision 928). NX3 (`docs/plan/nx3-nexus-look.md`) split the row into the nexus's
own pages and the Symbiotes, made Symbiotes and Folders cards, and made a repository the end of
Folders' way down. NX4 (`docs/plan/nx4-pinned-folders.md`) keeps the person's pinned folders in
Symbiote's settings folder. Since fix/nexus-pinned-symbiotes (decisions 626–628, in NX4's plan)
Symbiotes is the nexus's one page; Folders is no tab. NX5 (`docs/plan/nx5-nexus-revamp.md`,
decisions 908–916) made it one list of every repository the nexus knows (running, pinned, opened
before, found in the one folder the person chose to scan), a field that finds one by any part of
its path or types a path, and the picked one's card beside the list. NX6
(`docs/plan/nx6-nexus-explorer.md`, decisions 923–929) serves it on port 7347 (a second start
opens the running one), scans the person's home at the start and on ⟳ and lists it as a tree
under the groups, and opens a selected folder: a repository's Symbiote, or a plain folder made a
repository with `git init` after a question.

## Where things are

| File | What |
|---|---|
| `src/registry.ts` | The running servers' records, `<cache>/running/<pid>.json`: `announce`, `withdraw`, `readRecords` (MC1's `<cache>/views/*.json` too), the cache folder's rule. **`symbiote view` imports it** (`@symbiote/nexus/registry`): Node's modules only, nothing else of the nexus |
| `src/symbiotes.ts` | Which records are live (their process, `/api/status` within 1 s), one per folder |
| `src/folders.ts` | A folder's folders (no files, no hidden ones, 1,000 at most), repositories marked by their `.git` with their branch from `HEAD`, the places (home, the Symbiotes' folders, `/`, WSL's drives; the page draws none since NX5), a folder's repository root (`git rev-parse`); a folder inside a repository answers the folder holding it, the repository `picked` |
| `src/pins.ts` | `nexus.json` in Symbiote's settings folder (`configDir`, `src/config-dir.ts`): the pinned folders (NX4), read with each listing, described (a repository by its `.git` with its branch from `HEAD`, a gone folder `missing`); written one at a time through a file renamed into place, other keys kept (NX5's `scanned`, no longer read); a pin refused inside a repository |
| `src/scan.ts` | The scan of home (NX6, decision 925): breadth first, every level, no hidden or build folders, links not followed, a repository the end of the way down, 20,000 folders or 5 s at most; read only; every folder read or found kept (`tree`, `unread` when stopped short). `scanner`: one at a time, the last kept in `<cache>/nexus/scan.json` (another folder's, NX5's, is none) |
| `src/opened.ts` | The Symbiotes the nexus saw running (decision 912), `<cache>/nexus/opened.json`, 50 at most, newest first: "Opened before" |
| `src/checkouts.ts` | A repository's checkouts (decision 914): its folder and its worktrees from `.git/worktrees/*/gitdir`, no git process; the cache's worktrees left out by the caller |
| `src/repositories.ts` | The history and the scan merged by path (`knownRepositories`), what `GET /api/repositories` answers (home, the drives, the pins, the scan's facts); `scanTree`, what `GET /api/tree` answers |
| `src/init.ts` | Opening a selected folder (NX6, decisions 927, 928): a repository (or a folder in one, or a `.git` git rejects) started; a plain folder answered 409 `init`, and with `init: true` checked again, `git init` (no commit), started. The guards, on real paths: `/`, home, a drive root, the cache and settings folders, a home kept in git, outside home but on a drive |
| `src/start.ts` | Starting this checkout's `symbiote view --no-open` in a folder, detached (output in `<cache>/nexus/<pid>.log`), started once its record appears; stopping a live record's process by SIGTERM |
| `src/server.ts` | The page, its scripts, the viewer's built assets, `GET /api/nexus` (a second nexus asks it), `GET /api/symbiotes`, `GET /api/folders` (with the pins), `GET /api/repositories`, `GET /api/tree` (the last scan's folders), `GET /api/checkouts`, `POST /api/symbiotes` (`{ folder, init? }`: open, through `src/init.ts`), `/api/symbiotes/stop`, `/api/pinned` and `/api/scan` (home again); its own hosts only |
| `src/main.ts`, `src/bin.ts` | The command: options (`--port` 7347 by default, decision 923), the app's window or the browser, as `symbiote view` opens them; the port taken: a nexus there opened, anything else named (924) |
| `src/app-window.ts` | Starting the desktop app in its `--url` mode: a copy of `packages/cli/src/app.ts`'s (the CLI's modules load the engine), tested on the same cases |
| `src/page/` | The page's scripts, compiled by `tsc` to `dist/page/` and served as they are. Pure: `tabs.ts` (the tabs from each read, the address, the words, times), `folders-tab.ts` (`#folders:<path>`), `search.ts` (the list's rows in their groups and orders, home's rows, the search, the marks), `tree.ts` (home's tree from the scan, the folders shown), `complete.ts` (a typed path: its folder, Tab, →, Backspace), `pick.ts` (the pick kept by path and which of its path's rows, moved by the keys, the card's kind), `reach.ts` (when a frame gets its address). Pure but for the reads it asks: `home-view.ts` (what the list shows for the field's text or a path, why a folder cannot be made a repository). DOM: `main.ts` (the frames, `render`, `select`, the page's own listeners; it makes the parts below over one state and wires them), `state.ts` (the page's state, one object), `listings.ts` (folders' listings and checkouts, read and kept), `reads.ts` (the 2 s read, what the nexus knows, home's tree), `home.ts` (Symbiotes' head, list and card), `field.ts` (the field and its keys, the pick, the tree's folders), `actions.ts` (start, stop, open, pin, scan again, copy), `strip-view.ts` (the row of tabs and its keys), `stopped-view.ts` (a stopped tab's panel), `dialog.ts` (Stop's and `git init`'s questions), `window-buttons.ts`, `list-view.ts` (the field, the groups and rows, the foot), `detail-view.ts` (the picked row's card), `dom.ts` (elements, icons, a pin's button) |
| `page/` | `index.html` (the server fills in the viewer's stylesheet and font), `nexus.css` (layout only), `mark.png` (the viewer's `ui/mark-96.png`) |

## Rules

- **The viewer's look, by its own stylesheet** (decision 523): the page links the viewer's built
  CSS (`@symbiote/viewer/dist`, found from its `index.html`) and draws its markup in the
  viewer's classes (the session tabs' `.workspace-tabs` and `.stab`, `.page-head`,
  `.icon-button`, `.window-buttons`…). `test/page.test.ts` fails when a class it uses leaves the
  viewer's CSS; add a new one to its list. A class that stays while the viewer's rules move to
  another (V89 took the tabs' look from `.workspace-views button` to `.workspace-tabs .stab`)
  passes that test: `e2e/nexus.spec.ts` measures the row's tabs. `nexus.css` lays out only, its
  text sizes the viewer's `--size-*` tokens, no font named. Follow the `symbiote-style` skill for
  anything drawn.
- **The page runs in the browser**: `src/page/` imports only `./*.js` at run time, types from
  elsewhere (`import type`); the same test checks it.
- **One state, parts made over it** (refactor/viewer-pages, decision 959): the page's state is one
  `PageState` (`state.ts`); each part is a factory taking it and the few functions of other parts
  it calls, made and wired by `main.ts`, as `listView` and `detailView` are. No import cycle: a part
  never imports `main.ts` or a part that calls it back.
- **A frame per opened Symbiote, kept** (decision 521): hidden, never reloaded, until its
  Symbiote stops (unloaded) or serves on another port (moved). The nexus's own selection is in
  the hash by `replaceState`: no history entry.
- **A frame gets its address once the page's browser reaches it** (decision 625), asked every
  500 ms for 10 s at most. The nexus's server reaches a Symbiote from inside WSL as it listens; a
  browser on Windows reaches the port up to ~0.9 s later, and a frame refused once stays on the
  error page. Never set a frame's `src` directly: go through `address()`.
- **Symbiote's window is the desktop app's `--url` mode, untouched** (decision 524). Its preload
  is the top page's only: a framed viewer draws as in a browser.
- **Writes as the viewer's server takes them** (decision 543): JSON, `x-symbiote: 1`, its own
  origin if one is sent. A stop signals only the process of a live record (its pid alive, its
  `/api/status` answering), never a pid the page sends.
- **One port, 7347** (decisions 923, 924): `--port` overrides it, `0` is any free one. Every test
  and spec passes `--port 0` (`startNexus`, `runNexus`, `main.test.ts`'s `nexus`): other
  workspaces run them at once, and the person's nexus may serve on 7347. The "taken" cases hold a
  port of their own.
- **The one write in a folder is `git init`** (decision 928): only after the person's yes in the
  question (Cancel the default), only with `init: true`, the guards checked on the server at each
  ask (`src/init.ts`); no commit. A folder holding a `.git` is never offered it.
- **The row has two groups** (decision 551): the nexus's own pages (icons, kept at the strip's
  left; Symbiotes alone since decision 626) and, after the viewer's `.views-divider`, the
  Symbiotes (a state dot each). A new page of the nexus's own joins `.nexus-own`; never an icon on
  a Symbiote's tab or a dot on a page's.
- **One list and the picked one's card** (decisions 908, 909, 913, 926): Running by name (as the
  tabs), Pinned by name (folders and gone pins too), Opened before last seen first, then Home, its
  folders as a tree (a running or pinned one in its place too); searched, Home is every folder of
  the scan, flat, by path, none of the groups above. There is always a pick, kept by its path and
  which of its path's rows it is when the list is drawn again (every 2 s); a click picks, Enter, a
  double click or the card's button acts: a folder too (927). The list and the card are drawn again only when what they show changed: the field is
  never drawn again while the person types, and the focus stays in it while ↑↓ move the pick.
- **One field** (decision 910): any part of a path (from home, as `~`) searches; `~` or `/` first
  lists that folder (`GET /api/folders`), Tab completes, → goes in, Backspace after a `/` goes up.
  `#folders:<path>` fills it; the address names a folder only while one is typed.
- **Home is scanned at the start and on ⟳ only** (decision 925, supersedes 911): never on a timer
  nor on the 2 s read; Windows' drives never (7 to over 30 s here). The page reads the tree again
  when the scan's time changes. A folder's listing and a folder's card read one folder, never
  deeper (916); a folder of the tree the scan did not read is listed when opened. The scan and the
  reads never write in a folder and never start a Symbiote.
- **A repository is the end of the folders' way down** (decision 554): typing into one lists the
  folder holding it, the repository picked; `GET /api/folders` never lists inside one (the holder,
  `picked`), but in a home kept in git.
- **Pins are the person's** (NX4, decisions 617–620): kept in the settings folder, never in the
  page's storage (a new port each run) nor the cache; a pin whose folder is gone stays, marked,
  until the person unpins it. A pinned repository's card opens it, the person's start (619; a
  folder's too since 927).
  Nothing starts by itself or by a pin. Specs and tests keep their own settings folder
  (`XDG_CONFIG_HOME`; `startNexus`' `config`, `settingsFolder`), never the person's.
- **What the nexus remembers is in its cache** (decision 912): `<cache>/nexus/opened.json` and
  `scan.json`, beside the started Symbiotes' logs; never the person's settings.
- **A Symbiote the nexus starts outlives it** (decision 541): detached, its output in a file, not
  a pipe (a pipe breaks when the nexus ends). Specs stop such Symbiotes themselves
  (`stopRecorded` in `e2e/nexus.ts`).

## Tests

- Unit (vitest from the repo root): `test/*.test.ts`. The registry's test writes MC1's records with
  the CLI's own `writeViewRecord` and checks the cache rule against core's `defaultCacheDir`.
- `test/start.test.ts` starts a stand-in for `symbiote view` (a script that writes its record),
  never the CLI; the real CLI is the e2e's.
- e2e: `e2e/*.spec.ts` (`pnpm build` first; `pnpm test:e2e` runs them after the viewer's).
  `e2e/nexus.ts` serves real `symbiote view`s in throwaway repositories and the nexus on one cache
  folder of the spec's own, with a home of its own (`homeFolder`, `HOME`; an empty one by default:
  a first run lists home's tree) and a settings folder (`settingsFolder`: the pins), on `--port 0`.
  `list.spec.ts` is NX5's: the field, the list, the tree, the scan's two moments.
  `explorer.spec.ts` is NX6's: `git init` asked and run, refused, the port taken (`runNexus`).
  `app.spec.ts` needs `pnpm app:setup` and Xvfb, as the viewer's.
