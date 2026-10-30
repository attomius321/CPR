# V82 — Hive mode: a dangerous switch and an ink and crimson look

[Index](../PLAN.md) · [Journal](../journal/v82-hive-mode.md)

**Status:** built, ready for review (2026-10-30), on branch `feature/hive-mode-setting` (the
workspace's). The plan was confirmed by the person ("YES. Do it") after two rounds of mockups: the
first (a neutral ink tint, white highlights) was "more like this, but redish and black", with a
reference picture of glossy black liquid; the second (below) was approved. Then: "Also change the
icon to match this style" (decision 616). Merged into `main` (6cd7fc0). Then
[Hive per repository](#fix-hive-per-repository-fixhive-per-symbiote) (decisions 621–624), on
`fix/hive-per-symbiote`, ready for review.

**Problem** (asked: "Add a Hive mode setting to Settings. Its control must look dangerous to
press… While Hive mode is on, the whole interface takes a subtle Venom look"). Hive is the planned
"graph" loop mode: an orchestrator with full access, a main agent, a researcher and a reviewer in
each workspace. It is not built. Settings has no switch for it, and Symbiote has one look per
theme (decision 179, V61's tokens).

**Goal**: Settings has a Hive mode entry whose control reads as dangerous; turning it on asks
first; while it is on, every page takes an ink and crimson look, glossy, in both themes, contrast
checked; the choice survives a reload, a new `symbiote view` and the app. **Unchanged**: with Hive
off, every page as on `main`; Hive's orchestration (no agent, permission or workspace changes);
no artwork, logo or name from the films: the mood only, our own drawing.

## Where the choice is kept (decision 611; replaced by 621)

Since [the fix below](#fix-hive-per-repository-fixhive-per-symbiote): per repository, in its
`symbiote/hive.json`. What V82 built:

Per person, on this machine: `hive.json` in Symbiote's config folder (`{ "on": true, "since":
"<ISO date>" }`), read and written by `symbiote view` at `/api/hive`, as the intro's record
(`packages/cli/src/intro.ts`, V39).

- Not `symbiote/config.json`: it is committed. Once Hive exists it gives an orchestrator full
  access to the machine; a commit must not switch that on for everyone who clones the repository.
- Not the browser's storage, as the theme: each `symbiote view` has a port, so an origin, of its
  own (decision 17). The app, a browser and the nexus's tabs would disagree on whether Hive is on.

`packages/cli/src/hive.ts`: `hiveRecord(file)` with `on()` (a missing, broken or foreign file is
off) and `set(on)` (written whole, `writeFileWhole`). `/api/hive`: `GET` → `{ on }`; `POST { on }`
(the `x-symbiote` header, as every write) → `{ on }`.

## The first paint (decision 612; the nexus's part removed by 622)

The server writes `data-hive="on"` on `<html>` as it serves `index.html` (every page's route ends
in `serveFile`): the look from the first frame, no flash and no storage. The viewer's
`shell/hive.ts` reads the attribute, and on a change sets it and posts. The nexus's server reads the
same file for its own page (its stylesheet is the viewer's). Other open windows follow on their
next load.

## The control (decision 613; its entry moved by 623)

- **The entry**: "Hive mode" under This machine, a hexagon on a tile in `--error` (the only entry
  not in its group's tint), an "on" chip while it is on.
- **The page** (`settings/HivePage.tsx`): a warning in the error's tint (12 % fill, 30 % edge, the
  style's state tint): **"Hive runs agents with full access to this machine."**, what Hive is, and
  "Hive is not built yet: turning it on now changes only Symbiote's look." Under it a **Turn on Hive
  mode** button in `.button.danger` (moved from `GitPage.css` to `controls.css`), and where the
  choice is kept. On, **Turn off Hive mode** (secondary), and no question: off is the safe way.
- **The question** (decision 615): an `alertdialog`, Cancel focused, Escape and the backdrop cancel.

## The look (decision 614)

Every rule is under `:root[data-hive]`; nothing else changes. Tokens in `ui/base.css` after the
themes, the rest in `ui/hive.css` (last in `styles.css`'s list).

| Token | Hive dark | Hive light | |
|---|---|---|---|
| `--bg` / `--side` / `--raised` | `#070506` / `#0d090a` / `#1b1214` | `#ffffff` / `#f7f4f4` / `#ece5e6` | ink with a breath of red |
| `--line` / `--edge` | `#2b1d20` / `#725b5f` | `#e2d8da` / `#87787b` | 1.23 / 3.07; 1.27 / 3.84 |
| `--text` / `--muted` / `--faint` | `#f7f2f2` / `#bcaeb0` / `#86787b` | `#120a0c` / `#5e5053` / `#84777a` | lowest 16.57, 8.59; 15.74, 6.16 |
| `--accent`, `--focus` | `#ffc4cc` (blush) | `#9b1230` (wine) | 12.26 / 6.71 |
| `--primary` / hover | `#c8102e` / `#b00d28`, white words | `#b0102b` / `#960c24`, white words | 5.88, 7.16 / 7.11, 8.84 |
| `--selected` | crimson 20 % | crimson 10 % | |

- **Light**: the content stays white; the sidenav takes the dark Hive tokens (the ink at the edge).
- **The sheen**: one layer over the main area (`pointer-events: none`): two faint diagonal
  highlights, light on wet black, and a crimson glow from the far corner (2.4 % white, 9 % red at
  most; less in light).
- **Tendrils**: glossy tapered shapes, near-black with a crimson edge and white highlights, up from
  the sidenav's foot, behind its rows. Drawn by `ui/hive-art.ts` (pure: a cubic centreline offset
  by a width that thins to a point), our own geometry.
- **Gloss** on the primary: a highlight from above (a gradient over its colour).
- **Settings' tiles** one ink (`--muted`) but Hive mode's red: the groups' five colours fight the
  crimson.
- **Unchanged**: diff kinds, findings, states, git lanes, the Activity tab's kinds; type, spacing,
  radii; graph nodes and edges (no shadow, filter or transition added: the sheen is one layer over
  the canvas, measured while panning).

## The dialog (decision 615)

Always ink and crimson, whatever the theme and whether Hive is on: the question is the threshold.
Its tokens are the dark Hive set, scoped to it (`.hive-ink`); a red edge and glow over a backdrop
darkened to red. Its head: tendrils grow from both sides (masks drawn along their centrelines,
900 ms), meet, and a hexagon closes where they meet (crimson, then a white inner line, by 1.4 s),
then everything is still. `prefers-reduced-motion`: the last frame at once.

## The mark (decision 616)

While Hive is on, the S (`SymbioteMark`: sidenav, Start) and the tab's icon are crimson: the
person's logo through a gradient map (black → `#16040a` → `#6e081a` → `#c8102e` → `#ff96a0` →
white by brightness), so its gloss and highlights stay. Cut by `scripts/desktop/icon.mjs` beside
the others: `ui/mark-hive.png`, `ui/mark-hive-96.png`, `shell/favicon-hive.png`. The app's own
icon (taskbar) stays.

## Verification

1. **Unit** (red first): `packages/cli/test/hive.test.ts` (the record: missing, broken, on, off;
   the server: `/api/hive`, the attribute in every page's `index.html`, none when off);
   `packages/viewer/test/hive-art.test.ts` (paths closed, widths thin to the tip);
   `tokens.test.ts` (the Hive blocks: the same contrast rules, light equal to system-light,
   the same names in both).
2. **e2e** `hive.spec.ts`: the entry and its warning; Cancel and Escape leave it off; Turn on →
   the dialog → on: `data-hive`, the tokens; a reload keeps it; Turn off removes it.
3. **Off is `main`**: screenshots of every page with Hive off on this branch and on `main`'s build,
   compared pixel by pixel (Settings differs only by the new entry).
4. **Every page on and off**, both themes, 1440×900 at 1×: Git, a diff (Files, Graph), Nucleus is
   left out (opening it touches the person's live conversation), Skills, Monitor, History,
   Settings (each kind of entry), Start, a workspace, the dialog; zoomed for letter gaps.
5. **Cost**: pan frames per second on a large graph, Hive on against off.

**Risks**

| Risk | Mitigation |
|---|---|
| The sheen over the canvas costs frames while panning | one static layer; measured; drop it over the canvas if it costs |
| Light's wine accent is 1.71:1 from the error red: a selected row read as an error | rows keep the wash, not red text; the person saw it in the mockup |
| A token missed in one Hive block (the first mockup's dark dialog in light) | the test compares the blocks' names |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V82a | The record and the server | `hive.ts`, `/api/hive`, `data-hive` |
| V82b | The look | tokens, `hive.css`, tendrils, mark |
| V82c | Settings and the dialog | the entry, the page, the question |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 611 | Where the choice is kept | **Per person on this machine, `hive.json` in Symbiote's config folder, `/api/hive`** (replaced by 621) | Hive will give full access to the machine: not a commit's to switch on for every clone; browser storage is per port (decision 17) |
| 612 | The first paint | **The server writes `data-hive` on `<html>` as it serves `index.html`** | no flash, no storage |
| 613 | The control | **A danger button under a warning in the error's tint, asked before on, not before off; the entry under This machine, a hexagon on a red tile** | a button reads as deliberate where a switch reads as routine |
| 614 | The look | **Ink and crimson tokens under `:root[data-hive]` in both themes (light: white content, ink sidenav), a sheen layer, glossy tendrils at the sidenav's foot, one-ink tiles; states and type unchanged** | the person's reference: glossy black liquid, red and black, "not that much" |
| 615 | The question | **Always ink and crimson; tendrils grow and join into a hexagon, then still; reduced motion: the last frame** | the person: "the alert dialog should have that theme always, with an animation of symbiote combining and then static" |
| 616 | The mark | **The S and the tab's icon crimson while Hive is on: the logo through a gradient map** | the person: "change the icon to match this style" |
| 621 | Where the choice is kept (replaces 611) | **Per repository: `symbiote/hive.json` beside the reviews (the main checkout's, its worktrees share it), or the cache where the reviews are; written after `symbiote/.gitignore`; a record git tracks reads as off. The machine's `hive.json` is no longer read, nor removed** | the person: Hive per symbiote; a commit must still never turn it on for a clone; reading the old file would turn every repository on |
| 622 | The nexus | **Its page never takes Hive's look; its reader, option and route change removed** | each tab is its own `symbiote view`'s page, marked by its own server |
| 623 | Settings' entry (amends 613) | **Under a new group, This repository, above This machine** | the choice is this repository's |
| 624 | Turning it on | **Ink bursts from the question's hexagon and covers the window, the look changes under it, the ink thins away, the sidenav's tendrils grow and a streak of light crosses once; still after about 2 s. Reduced motion: at once. A page loaded with Hive on: still. Off: a 250 ms fade** | the person: "animate its background until it is static… surprise me"; "even those tendrils should have an animation" |

**Not in V82 (later)**: Hive itself; the app's taskbar icon and the desktop start page; other
open windows following a change at once.

## As built (V82)

- **The question** is a dialog of Hive's own (`settings/HivePage.tsx`), not `ConfirmDialog`: its
  art, its ink and its two buttons (a danger, a secondary Cancel focused) shared nothing with
  "Stay" and its primary.
- **The ink sidenav in light Hive** needs the whole dark set, not only Hive's names: its cards show
  states, an agent's status and lanes. The theme's dark block also matches
  `:root[data-hive] .sidenav` and `.hive-ink`; Hive's dark block comes after it.
- **The sidenav's place**: the tendrils need it positioned, but the narrow shell's drawer is
  `position: fixed` at the same specificity, and `hive.css` comes after `Shell.css`. The rule is
  `:where(:root[data-hive]) .sidenav`: no specificity, the drawer keeps its place.
- **The tendrils** take at most 45 % of the sidenav, their tops cut and faded: whole, they showed
  through a workspace card's wash in a 700 px window.
- **The nexus** reads `hive.json` from its own copy of the config folder's rules (a test keeps it
  equal to the app's): it does not import the CLI.
- **The S** is cut by `scripts/desktop/icon.mjs` like the others; the existing icons came out byte
  for byte the same.

**Results.**

- Unit: `pnpm check`, 2,451 tests (CLI: the record and `/api/hive` in both modes, every page's
  `<html>`; the nexus's page; the viewer: Hive's token blocks against the same contrast rules,
  the tendrils' geometry).
- e2e: `hive.spec.ts` (3 tests), `settings.spec.ts` (20 entries, Hive mode's red tile); the whole
  suite, 349 viewer and 15 nexus tests.
- **Off is `main`**: every page (Git, Settings with three entries open, Skills, Monitor, History,
  Start, a diff's Files and Graph), both themes, from `main`'s build and the branch's, back to
  back, pixel by pixel. Identical but Settings' list (the new entry, and where the list scrolls
  for an entry under it) and what changes between two shots of `main` itself: the working
  spinner (≈ 115 px), relative times, a workspace's live timeline, the canvas card's corner
  pixels (57–74 px).
- **On**: every page above, dark and light, at 1×, no page errors; text at 3× shows even gaps.
- **Cost**: panning a diff of 3,468 changed symbols (55 nodes drawn), three runs each,
  alternated: 60–61 fps with Hive on and off (headless Chromium, its frame clock's cap: the sheen
  costs no frame there, not measured on a GPU).

Not verified: an open workspace's page and Nucleus's (they attach to live agents' terminals);
the nexus's page in a browser (its server is unit-tested); the app's window.

## Fix: Hive per repository (fix/hive-per-symbiote)

**Problem** (2026-10-30, the person: "Hive mode per symbiote, not on the nexus"). Decision 611
made Hive one switch for the machine: turning it on in one `symbiote view` turned it on in every
other one and on the nexus's page, at their next load. Also: "bottom settings from symbiote view
is not visible in hive mode". The tendrils took the bottom 45 % of the sidenav, Settings' row
included: their box ended at 876 px in a 900 px window, Settings' row starts at 827, and their
white highlights crossed its gear and its word. And: "When going from normal mode to hive mode,
the symbiote view should animate its background until it is static… Surprise me"; "Even those
tendrils should have an animation".

**Decisions 621–624** (the table above).

- **The record** (`repositoryHive`, `packages/cli/src/hive.ts`): `hive.json` in the folder
  `reviewPlace` gives the reviews' parent, as the workspaces' records. The main checkout's
  `symbiote/`, so a linked worktree's `symbiote view` shares its repository's switch; Symbiote's
  cache (`state/<repo id>/hive.json`) without a git user or when `symbiote/` holds the project's
  files. `set` writes `symbiote/.gitignore` first (`prepareSymbioteFolder`, without
  `AGENTS.md`). `on` reads a record that git tracks as off: even a forced `git add` and a commit
  turn no clone on.
- **The machine's `hive.json`** (V82's) is left as it is and never read: every repository starts
  off. Reading it once to carry it over would turn every repository on, the bug itself.
- **The nexus**: `packages/nexus/src` is as before V82 but `config-dir.ts` (`configDir`, which
  only Hive used, moved unchanged with its test: NX4, decision 618, plans `nexus.json` there).
- **Settings**: Hive mode under This repository, untinted (its tile is Hive's red); the note
  "For this repository: every window of its symbiote view. Kept with its reviews, never
  committed." (true in the cache too).
- **Settings readable**: the tendrils are drawn in the workspaces' column (`.sidenav-workspaces`
  positioned, the sidenav still their stacking context): they rise from the hairline over
  Settings, at most 70 % of the column.
- **The arrival** (`shell/hive-arrival.ts`, `FLOOD` and `floodCover` in `ui/hive-art.ts`): a
  layer over the window (`.hive-flood`, z-index 90, under the window's edge) draws the ink: a
  hexagon with eleven tendrils, glossy (the tendrils' crimson edge and white highlight), from the
  question's hexagon (its place measured) to the scale where the hexagon's inner circle reaches
  the farthest corner, turning 28° (850 ms). Then `data-hive-arriving` and the look under it (the
  question closes in the same `flushSync`); the ink thins away still turning (650 ms); under
  `data-hive-arriving`, `hive.css` grows the sidenav's tendrils along masks on their centrelines
  (900 ms each, 110 ms apart), fades the sheen in and sends one streak across the main area. The
  attribute goes once every `hive-arrive-*` animation has finished: nothing runs after.

**As built** (what differs from the plan given to the person):

- **The ink is drawn, not a view transition's reveal**: dark (`#090b0e`) and dark Hive
  (`#070506`) are both near black; the new page shown through a growing mask barely showed. A
  view transition is used only for off's fade, where the browser has one.
- **The note names no file**: where a repository's reviews are in the cache, "Kept in
  symbiote/hive.json" would be wrong.

**Results.**

- Tests first, red before: `main.test.ts` (two real `symbiote view`s in two repositories, the
  machine's record on: both pages were marked before anything was turned on); the nexus's
  `main.test.ts` (its page marked by the machine's record); `hive.spec.ts` (no This repository;
  the tendrils' bottom at 876 against Settings' top at 827.5; no ink); `settings.spec.ts` (the
  groups). Now: one repository on, the other off; on after a restart; `git status` clean;
  the machine's record as it was; the nexus never marked.
- `pnpm check`: 2,457 tests. `pnpm build`. e2e: 352 viewer and 15 nexus tests (a first run,
  beside screenshot scripts, failed one workspace card's position check in `workspaces.spec.ts`,
  Hive off; alone it passed 5 of 5, and the whole suite again).
- Frames of the arrival, 1440×900, both themes: the burst at 0.3 s, covered from 0.42 to 0.9 s,
  the page back by 1.3 s, the tendrils grown by 1.7 s; no animation running at 3 s.
- Cost: reading the record (`reviewPlace`'s two git calls, a third when on) takes 7–11 ms
  (median of 30) a page load, against one file read before; `/` answered in 18 ms (median of
  20) with Hive on, `/api/status` in 26.

Not verified: the app's window (its rounded frame takes the ink's corners by `frame.css`, not
seen); the off fade's look (a view transition, checked only to end in main's look).
