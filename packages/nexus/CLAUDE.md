# @symbiote/nexus

Symbiote nexus (NX1, `docs/plan/nx1-nexus.md`): `symbiote-nexus` lists every `symbiote view`
running on this machine and shows each as a tab of one page, in Symbiote's window or a browser
tab. It reads their records and their `/api/status`. Since NX2
(`docs/plan/nx2-open-from-folders.md`) its Folders tab lists this PC's folders, and the nexus
starts `symbiote view` in one and stops a running one (decision 543); it never writes inside a
folder, nor into a Symbiote. NX3 (`docs/plan/nx3-nexus-look.md`) split the row into the nexus's
own pages and the Symbiotes, made Symbiotes and Folders cards, and made a repository the end of
Folders' way down. NX4 (`docs/plan/nx4-pinned-folders.md`) keeps the person's pinned folders in
Symbiote's settings folder. Since fix/nexus-pinned-symbiotes (decisions 626–628, in NX4's plan)
Symbiotes is the nexus's one page: a pinned repository is a card among its Symbiotes, and this
PC's folders, the pinned ones under their places, are under the cards; Folders is no tab.

## Where things are

| File | What |
|---|---|
| `src/registry.ts` | The running servers' records, `<cache>/running/<pid>.json`: `announce`, `withdraw`, `readRecords` (MC1's `<cache>/views/*.json` too), the cache folder's rule. **`symbiote view` imports it** (`@symbiote/nexus/registry`): Node's modules only, nothing else of the nexus |
| `src/symbiotes.ts` | Which records are live (their process, `/api/status` within 1 s), one per folder |
| `src/folders.ts` | A folder's folders (no files, no hidden ones, 1,000 at most), repositories marked by their `.git` with their branch from `HEAD`, the places (home, the Symbiotes' folders, `/`, WSL's drives), a folder's repository root (`git rev-parse`); a folder inside a repository answers the folder holding it, the repository `picked` |
| `src/pins.ts` | The pinned folders (NX4): `nexus.json` in Symbiote's settings folder (`configDir`, `src/config-dir.ts`), read with each listing, described (a repository by its `.git` with its branch from `HEAD`, a gone folder `missing`), written one at a time through a file renamed into place; a pin refused inside a repository |
| `src/start.ts` | Starting this checkout's `symbiote view --no-open` in a folder, detached (output in `<cache>/nexus/<pid>.log`), started once its record appears; stopping a live record's process by SIGTERM |
| `src/server.ts` | The page, its scripts, the viewer's built assets, `GET /api/symbiotes`, `GET /api/folders` (with the pins), `POST /api/symbiotes` (start), `/api/symbiotes/stop` and `/api/pinned`; its own hosts only |
| `src/main.ts`, `src/bin.ts` | The command: options, the app's window or the browser, as `symbiote view` opens them |
| `src/app-window.ts` | Starting the desktop app in its `--url` mode: a copy of `packages/cli/src/app.ts`'s (the CLI's modules load the engine), tested on the same cases |
| `src/page/` | The page's scripts, compiled by `tsc` to `dist/page/` and served as they are: `tabs.ts` and `folders-tab.ts` (pure: the tabs from each read, the address, Symbiotes' cards with the pins, the crumbs, the words, the pins under the places, the arrows on a grid), `reach.ts` (when a frame gets its address: once this browser reaches the Symbiote), `main.ts` (the DOM: the row's two groups, frames, Symbiotes' page: its cards, running or pinned, each with its pin, the folders under them; Stop's question), `folders-view.ts` (the folders' DOM under Symbiotes, its field for Symbiotes' head, the pinned folders under the places), `cards.ts` (a repository's card in the folder listed, with its pin), `dom.ts` (elements, icons, a pin's button) |
| `page/` | `index.html` (the server fills in the viewer's stylesheet and font), `nexus.css` (layout only), `mark.png` (the viewer's `ui/mark-96.png`) |

## Rules

- **The viewer's look, by its own stylesheet** (decision 523): the page links the viewer's built
  CSS (`@symbiote/viewer/dist`, found from its `index.html`) and draws its markup in the
  viewer's classes (`.workspace-views` tabs, `.page-head`, `.icon-button`, `.window-buttons`…).
  `test/page.test.ts` fails when a class it uses leaves the viewer's CSS; add a new one to its
  list. `nexus.css` lays out only, its text sizes the viewer's `--size-*` tokens, no font named.
  Follow the `symbiote-style` skill for anything drawn.
- **The page runs in the browser**: `src/page/` imports only `./*.js` at run time, types from
  elsewhere (`import type`); the same test checks it.
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
- **The row has two groups** (decision 551): the nexus's own pages (icons, kept at the strip's
  left; Symbiotes alone since decision 626) and, after the viewer's `.views-divider`, the
  Symbiotes (a state dot each). A new page of the nexus's own joins `.nexus-own`; never an icon on
  a Symbiote's tab or a dot on a page's.
- **The folders are under Symbiotes' cards** (decision 626): drawn once, never again with the
  cards, so their listing, focus and field keep. `#folders:<path>` (Folders' old address) lists
  that folder there; the address names a folder only once the person went to one.
- **A repository is the end of the folders' way down** (decision 554): its card opens its Symbiote,
  never its folders, and `GET /api/folders` never lists inside one (the holder, `picked`), but
  in a home kept in git.
- **Pins are the person's** (NX4, decisions 617–620): kept in the settings folder, never in the
  page's storage (a new port each run) nor the cache; a pin whose folder is gone stays, marked,
  until the person unpins it. A pinned repository is a card among the Symbiotes, first (decision
  627): its click is the person's start; a pinned folder is a place (628), its click lists it.
  Nothing starts by itself or by a pin. Specs and tests keep their own settings folder
  (`XDG_CONFIG_HOME`; `startNexus`' `config`), never the person's.
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
  Symbiotes lists a folder as it opens).
  `app.spec.ts` needs `pnpm app:setup` and Xvfb, as the viewer's.
