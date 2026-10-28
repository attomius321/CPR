# @symbiote/nexus

Symbiote nexus (NX1, `docs/plan/nx1-nexus.md`): `symbiote-nexus` lists every `symbiote view`
running on this machine and shows each as a tab of one page, in Symbiote's window or a browser
tab. It reads their records and their `/api/status`. Since NX2
(`docs/plan/nx2-open-from-folders.md`) its Folders tab lists this PC's folders, and the nexus
starts `symbiote view` in one and stops a running one (decision 543); it never writes inside a
folder, nor into a Symbiote. NX3 (`docs/plan/nx3-nexus-look.md`) split the row into the nexus's
own pages and the Symbiotes, made Symbiotes and Folders cards, and made a repository the end of
Folders' way down.

## Where things are

| File | What |
|---|---|
| `src/registry.ts` | The running servers' records, `<cache>/running/<pid>.json`: `announce`, `withdraw`, `readRecords` (MC1's `<cache>/views/*.json` too), the cache folder's rule. **`symbiote view` imports it** (`@symbiote/nexus/registry`): Node's modules only, nothing else of the nexus |
| `src/symbiotes.ts` | Which records are live (their process, `/api/status` within 1 s), one per folder |
| `src/folders.ts` | A folder's folders (no files, no hidden ones, 1,000 at most), repositories marked by their `.git` with their branch from `HEAD`, the places (home, the Symbiotes' folders, `/`, WSL's drives), a folder's repository root (`git rev-parse`); a folder inside a repository answers the folder holding it, the repository `picked` |
| `src/start.ts` | Starting this checkout's `symbiote view --no-open` in a folder, detached (output in `<cache>/nexus/<pid>.log`), started once its record appears; stopping a live record's process by SIGTERM |
| `src/server.ts` | The page, its scripts, the viewer's built assets, `GET /api/symbiotes`, `GET /api/folders`, `POST /api/symbiotes` (start) and `/api/symbiotes/stop`; its own hosts only |
| `src/main.ts`, `src/bin.ts` | The command: options, the app's window or the browser, as `symbiote view` opens them |
| `src/app-window.ts` | Starting the desktop app in its `--url` mode: a copy of `packages/cli/src/app.ts`'s (the CLI's modules load the engine), tested on the same cases |
| `src/page/` | The page's scripts, compiled by `tsc` to `dist/page/` and served as they are: `tabs.ts` and `folders-tab.ts` (pure: the tabs from each read, the address, the crumbs, the words, the folders near the running Symbiotes, the arrows on a grid), `main.ts` (the DOM: the row's two groups, frames, Symbiotes' cards, Stop's question), `folders-view.ts` (the Folders tab's DOM), `cards.ts` (a repository's card, Folders' and Symbiotes'), `dom.ts` (elements and icons) |
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
- **Symbiote's window is the desktop app's `--url` mode, untouched** (decision 524). Its preload
  is the top page's only: a framed viewer draws as in a browser.
- **Writes as the viewer's server takes them** (decision 543): JSON, `x-symbiote: 1`, its own
  origin if one is sent. A stop signals only the process of a live record (its pid alive, its
  `/api/status` answering), never a pid the page sends.
- **The row has two groups** (decision 551): the nexus's own pages (icons, kept at the strip's
  left) and, after the viewer's `.views-divider`, the Symbiotes (a state dot each). A new page
  of the nexus's own joins `.nexus-own`; never an icon on a Symbiote's tab or a dot on a page's.
- **A repository is the end of Folders' way down** (decision 554): its card opens its Symbiote,
  never its folders, and `GET /api/folders` never lists inside one (the holder, `picked`), but
  in a home kept in git.
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
  folder of the spec's own, with a home of its own for Folders (`homeFolder`, `HOME`).
  `app.spec.ts` needs `pnpm app:setup` and Xvfb, as the viewer's.
