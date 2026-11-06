# V97 — The viewer's choices kept across runs in a browser

[Index](../PLAN.md) · [Journal](../journal/v97-choices-kept.md)

**Status:** planned (2026-11-06), to be built on branch `feature/v97-choices-kept` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** feature (milestone) · **Branch** `feature/v97-choices-kept` · **Size** M · **Depends on**
none (P22, the nexus's theme, can read the same file once this lands) · **Plan** P33 of 51 (the
audit's order)

## The brief

**What to change**: in a browser tab (`symbiote view --browser`, or with no app installed) the
person's theme, text size, sidenav fold and panel widths go back to their defaults at every new
`symbiote view`. Keep them across runs, as Symbiote's window already does.

**Where to look**:
- `packages/viewer/src/shell/theme.ts` (`THEME_KEY`, `setTheme`: `localStorage` only),
  `src/shell/text-size.ts`, `src/ui/widths.ts`, `packages/viewer/index.html:20-35` (the inline
  script that sets the theme and text size before the first paint).
- `packages/desktop/src/state.ts:5-14` (`CHOICES`, the six keys the app keeps in
  `<config>/app/state.json` and puts back before the page's scripts run), `:35-37`, `:111-120`
  (`readChoices`).
- `packages/cli/src/server.ts:1286-1294`: `index.html` is already rewritten per request when Hive
  is on (`withHive`), the place to put the choices in.
- `packages/cli/src/intro.ts:15-25` (`symbioteConfigDir`, the settings folder the CLI, the app and
  the nexus share).

**Out of scope**: the choices that are about one checkout's page and stay per browser (Settings'
folds, History's folds, Focus); the nexus's own page (P22); review state (already on the server,
`/api/state`).

**Done when**:
- In a browser, a theme, text size, sidenav fold or panel width chosen in one `symbiote view` is
  there in the next one, on another port, before the first paint (no flash of the dark theme).
- Symbiote's window behaves as today: its `state.json` is the same choices.
- A second browser or a private window sees the same choices: they are this machine's, not one
  browser's.

## Problem (asked: "find what can be improved"; finding V10 of the audit)

Code, from the audit; not run across two views.
- `symbiote view` serves on any free port by default (`--port`'s help), and each port is a new
  origin, so the page's `localStorage` starts empty.
- The viewer keeps 12 keys there (`symbiote.viewer.theme`, `.text-size`, `.sidenav`,
  `.sidenav.diff`, `.changes`, `.widths`, `.settings-folds`, `.hive-earlier`, `.focus`,
  `.done-earlier`, `.done`, `.details`).
- `packages/desktop/src/state.ts:35-37` says so: "Each run's server has a port of its own, so a
  new origin with empty storage: the app puts them back before the page's scripts run". It keeps
  the first six.
- Nothing does that for a browser tab. The nexus in a browser shows the same symptom (P22): it is
  always dark.

**Goal**: one place for the six choices, this machine's settings folder, read by `symbiote view`
and the app alike. A browser tab gets them in the page before its first paint. Nothing changes in
Symbiote's window, and a page served by `?graph=` (no server) keeps using its own storage.

## Design

### Where the choices live

- `<config>/symbiote/viewer.json`: `{ "choices": { "symbiote.viewer.theme": "light", … } }`, the
  same six keys and the same reader as the app's `readChoices` (moved to core's or kept in two
  places with one shared test).
- Written whole through a renamed temp file (as `pins.ts` writes `nexus.json`).
- `symbiote view` reads it when it serves `index.html`, and puts it in the page as
  `<script>window.symbioteChoices = {…}</script>` before the inline theme script (the same
  rewrite `withHive` does).
- The inline script and `theme.ts`/`text-size.ts`/`widths.ts` read `window.symbioteChoices`
  first, then `localStorage`, then the default.

### Writing a choice

- `POST /api/choices { key, value }` (a known key, a string ≤ 4,096 characters, as `readChoices`
  allows): the write rules of every write (JSON, `x-symbiote: 1`, same origin; SC1's secret once it
  lands).
- `setTheme`, `setTextSize` and the widths' save call it and keep writing `localStorage`, so a
  page that loses its server keeps the choice until it closes.

### Symbiote's window

- The app keeps its `state.json` for the window's place and zoom. Its `choices` are read from
  `viewer.json` when present, else from its own as today, so nothing is lost on update.
- From then on the app writes `viewer.json`. Its preload's put-back stays, as the page's cache.

### Decision 179

179 says "chosen per browser in Settings". The choice is still made in Settings, but it is kept
per machine. Decision 940 supersedes 179 for where the choice is kept, not for its default (dark).

## Verification

1. **Unit** (red first): the CLI's reader and writer (`test/choices.test.ts`): a known key kept, an
   unknown or oversized one refused, a broken file read as none. The `index.html` rewrite holds the
   choices before the inline script.
2. **e2e** (`settings.spec.ts` or a new `choices.spec.ts`): pick Light and a narrower sidenav in a
   `serveWorkspaces()` view; `restart({ samePort: false })`; the new origin's first paint is light
   (the `<html>` `data-theme` at `DOMContentLoaded`) and the width is kept. Red today.
3. **App**: `app.spec.ts`, as today, plus a `state.json` with choices and no `viewer.json` still
   gives the window its theme.
4. **First paint**: `/git` and Bitwarden's graph against `main` (viewer-check): today 307–340 ms
   on Bitwarden. One small inline script more, so at most +5 ms.

**Risks**

| Risk | Mitigation |
|---|---|
| Two views write `viewer.json` at once | Whole-file writes through a rename; the last write wins, as with `localStorage` across tabs |
| A person wants different themes per repository | Not asked; per machine is what the app does today |
| A test writes the person's settings folder | Every spec has its own `XDG_CONFIG_HOME` (the harness does); the unit tests pass a folder |

**Order**: the reader and the `index.html` rewrite first (the theme survives a restart), then the
write endpoint, then the app reading `viewer.json`.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V97a | `viewer.json`, read into `index.html` | the CLI's reader, the rewrite, the inline script reading it; unit tests |
| V97b | `POST /api/choices` from Settings, the sidenav and the widths | the e2e across a restart on a new port |
| V97c | The app reads and writes `viewer.json` | `state.json`'s choices as a fallback; `app.spec.ts` |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 940 | Where the viewer's choices are kept (supersedes 179's "per browser") | **In this machine's settings folder (`viewer.json`), put into the page by `symbiote view` before its scripts; the browser's storage only a cache** | Every run is a new origin: the choices reset in a browser; the app already keeps them per machine (`state.ts`) |
| 941 | Which choices | **The app's six: theme, text size, sidenav, sidenav on a diff, a workspace's changes panel, widths; the rest stay per browser** | The six are the ones the app keeps; folds and Focus are about a moment's work |

**Not in V97 (later)**: the nexus reading `viewer.json` (P22 can, once this lands); per-repository
choices.
