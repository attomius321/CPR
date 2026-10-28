# @symbiote/nexus

Symbiote nexus (NX1, `docs/plan/nx1-nexus.md`): `symbiote-nexus` lists every `symbiote view`
running on this machine and shows each as a tab of one page, in Symbiote's window or a browser
tab. It connects Symbiotes and changes none of them: it reads their records and their
`/api/status`, nothing else (decision 526).

## Where things are

| File | What |
|---|---|
| `src/registry.ts` | The running servers' records, `<cache>/running/<pid>.json`: `announce`, `withdraw`, `readRecords` (MC1's `<cache>/views/*.json` too), the cache folder's rule. **`symbiote view` imports it** (`@symbiote/nexus/registry`): Node's modules only, nothing else of the nexus |
| `src/symbiotes.ts` | Which records are live (their process, `/api/status` within 1 s), one per folder |
| `src/server.ts` | The page, its scripts, the viewer's built assets, `GET /api/symbiotes`; its own hosts only; reads only |
| `src/main.ts`, `src/bin.ts` | The command: options, the app's window or the browser, as `symbiote view` opens them |
| `src/app-window.ts` | Starting the desktop app in its `--url` mode: a copy of `packages/cli/src/app.ts`'s (the CLI's modules load the engine), tested on the same cases |
| `src/page/` | The page's scripts, compiled by `tsc` to `dist/page/` and served as they are: `tabs.ts` (pure: the tabs from each read, the address, the words), `main.ts` (the DOM) |
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

## Tests

- Unit (vitest from the repo root): `test/*.test.ts`. The registry's test writes MC1's records with
  the CLI's own `writeViewRecord` and checks the cache rule against core's `defaultCacheDir`.
- e2e: `e2e/*.spec.ts` (`pnpm build` first; `pnpm test:e2e` runs them after the viewer's).
  `e2e/nexus.ts` serves real `symbiote view`s in throwaway repositories and the nexus on one cache
  folder of the spec's own. `app.spec.ts` needs `pnpm app:setup` and Xvfb, as the viewer's.
