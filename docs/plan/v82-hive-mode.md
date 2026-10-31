# V82 — Hive mode: a dangerous switch and an ink and crimson look

[Index](../PLAN.md) · [Journal](../journal/v82-hive-mode.md)

**Status:** built, ready for review (2026-10-30), on branch `feature/hive-mode-setting` (the
workspace's). The plan was confirmed by the person ("YES. Do it") after two rounds of mockups: the
first (a neutral ink tint, white highlights) was "more like this, but redish and black", with a
reference picture of glossy black liquid; the second (below) was approved. Then: "Also change the
icon to match this style" (decision 616). Merged into `main` (6cd7fc0). Then
[Hive per repository](#fix-hive-per-repository-fixhive-per-symbiote) (decisions 621–624), on
`fix/hive-per-symbiote`, merged. Then [Hive tentacles](#feature-hive-tentacles-featurehive-tentacles)
(decisions 629–633), on `feature/hive-tentacles`: built, ready for review, after the person's OK
("Go") on the third round of candidates. Then [Hive's question, a circuit](#feature-hives-question-a-circuit-featurehive-mode-dialog-prompt)
(decisions 665–667 and 673), on `feature/hive-mode-dialog-prompt`: the person's pick of three candidates
("the circuit board one, i love it"), and turning on in the same style.

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
| 629 | Hive's tendrils (amends 614) | **Ropes of points that follow a living pose with under-damped springs and noise, drawn on a canvas as shaded tubes in Carnage's red and black; the same drawing in the question and the sidenav (turning on has none, 632)** | the person: "make the tentacles realer… more symbiotic like Venom… Carnage", then "We'll go with the Carnage one"; only a canvas shades across a bending width and moves strands and forks |
| 630 | The question's centre | **A Hive Mind: a honeycomb round a core that beats, the tendrils plugged into its cells and holding on once they grab, sparks of thought from the cells to the core** | the person: "make it look more like a Hive Mind"; "they should remain attached after the grabing" |
| 631 | The question's motion (amends 615) | **The tendrils come out, draw back, strike and grab, then live while the dialog is open (30 frames a second, nothing after it closes); its backdrop has no blur; reduced motion: one still frame of the joined art** | the person: "never quite still"; with the blur any motion in the dialog took a whole core at 16–31 fps |
| 632 | Turning it on (amends 624) | **The question's Hive Mind grows to the middle of the window and a blackout closes from the edges until only it is lit; the look changes under the cover; it flares and a boom from it throws the ink back; no tentacles; then the streak and the sidenav's rise; the canvas at most 0.9 megapixels; reduced motion: at once** | the person: "then boom, the new UI"; "Keep only the Hive mind, and the blackout animation. No tentacles there"; 61 fps at 2560×1440 in software |
| 633 | The sidenav's tendrils (removed by [fix/remove-hive-tendrils-from-sidenav](#fix-no-tendrils-in-the-sidenav-fixremove-hive-tendrils-from-sidenav)) | **The new drawing behind the rows; they rise as Hive arrives, then are still** | a slow idle cost 21 % of a core on every page against 4 % still |
| 665 | The question's art (replaces 629 and 631's tendrils) | **A circuit board: ten traces at 0° and 45° from both edges to the Hive Mind's outer cells, stubs and vias between them, a honeycomb etched behind; drawn in from the edge with a bright head, landing on pads; packets run in and orders run out while the dialog is open. Every state a function of time; the run as 631 (60 frames a second for the join, 30 after, nothing once closed, one still frame with reduced motion)** | the person: "The tentacles… does not really fit the context… more like the Hive mind style, more futuristic, robotic", then, of three candidates filmed in the dialog, "the circuit board one, i love it" |
| 666 | The Hive Mind (replaces 630's comb) | **Machined: 19 gunmetal plates in a honeycomb, bevels lit from the upper left, dark-glass chambers lit crimson from within, a white-hot core lens; the cells boot with a flicker; a signal lights its cell, then each cell in to the core; a targeting ring round it in the question. The same Mind grows in the arrival** | one Mind for the question and the arrival |
| 667 | The other candidates | **The Swarm (drones docking on the Mind's lattice) kept for later: its prototype and film in `spikes/hive-question-candidates/`; the Conduits only there** | the person: "keep the comb idea for the future… we'll do something with that" |
| 673 | Turning it on (amends 632) | **A hex shutter in place of the blackout: the window's honeycomb of tiles shuts from the edges onto the growing Mind, the front's edges lit; traces at 0° and 45° route across the shut tiles from every edge into the grown targeting ring; covered at 1.0 s (every pixel ink, the look changes under it); the Mind flares and the traces surge; the tiles open from the Mind out to the edges, their edges lit, a ring of light ahead; still by 1.9 s; the canvas at most 0.9 megapixels; reduced motion: at once** | the person: "Turning Hive on animation should be in the Circuit style" |

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

## Feature: Hive tentacles (feature/hive-tentacles)

**Problem** (2026-10-30, the person: "the tentacles should look more real… some motion on it…
also the hexagon on the center… make it look more like a Hive Mind"; "only the left side
navigation is pretty bad… those tentacles… ew"; "the motion should feel natural… more symbiotic
like Venom from Marvel… Carnage, Venom"; "when transitioning to Hive mode… then boom, the new UI").
The sidenav's tendrils are ink on ink (`#120809` on `#0d090a`): only their 1 px crimson edge and
their white lines show, wire outlines over the workspace cards. The question's ribbons have an even
taper, are drawn in along masks (900 ms) and meet at a hexagon, then nothing moves. The arrival is
one transformed group.

**Goal**: living tendrils of glossy symbiote, Carnage's red and black, in the question and the
sidenav; a Hive Mind at the question's centre; turning on as the Mind and a blackout, then the boom.
**Unchanged**: the look Hive turns on (tokens, the sheen, the pages, the streak); the sidenav's rows,
Settings' row and the cards; the dialog's words, buttons, focus and Escape; off's 250 ms fade.

**How it was chosen.** Three candidates were drawn by one prototype engine (Venom, Hive, Carnage),
put in the real viewer at 1x in both themes in place of today's art, recorded frame by frame and
shown live on a page. The person picked Carnage and asked for three changes, each recorded again:
the tendrils stay attached once they grab; turning on keeps "only the Hive mind, and the blackout
animation"; the tendrils "should feel more natural" (no parallel hoses, fine curling tips, an arm
that moves as one when it strikes, no jitter, no dashed veins, no hard outlines on the comb).

**The drawing** (decision 629). A tendril is a rope of 18–26 points. Each point follows a pose with
an under-damped spring, softer toward the tip (the tip trails); a tension between neighbours carries
waves down it. The pose is noise with each tendril's seed and time lag, so the small ones follow the
big ones late. Its width swells and pinches (lumps that crawl, pulses that run into the Mind) and
thins where it is stretched. It is drawn on a canvas as a tube: smoothed (Catmull-Rom), shaded
across its width as a cylinder lit from the upper left like the pages' sheen (a gradient per few
points, by the normal's direction), a crimson rim on its shadow side, a broad sheen and a specular
where the curve faces the light, broken into streaks that run along it. Goo strands form between
neighbours that come close, thin as they part, snap and pull back; small tendrils fork and join.
The palette is `hive.css`'s, read once; nothing new to install.

**The Hive Mind** (decision 630): 16 honeycomb cells of the same ink, chambers lit crimson from
within, a core that breathes and beats twice like a heart, white-hot at its peaks; a tendril that
grabs spreads its foot round a cell's wall and keeps hold; a pulse arriving lights its cell and
sometimes sends a spark along a curved thread to the core.

**The question** (decision 631): tendrils come out of the ink at both sides and over the top
corners, draw back, strike in an arc and grab (0.1–1.4 s, 60 frames a second), then live while the
dialog is open at 30 frames a second; stopped when it closes. Reduced motion: the joined art drawn
once. Its backdrop and the dialog lose their blurs (the dialog's own is under an opaque background).

**Turning on** (decision 632), a canvas over the window (`.hive-flood`, z-index 90): the question's
Mind grows to the middle (0.1–0.4 s); the blackout closes from every edge, a liquid rim of crimson
and light, on the Mind until only it is lit; covered at 1.0 s: the frame drawn fully covered is the
one `swap` runs after, and the question closes under it; the Mind flares (160 ms); boom: the ink
tears out from the Mind, a shockwave ring throws it back to the edges (620 ms); then today's streak,
and the sidenav's tendrils rise. The canvas is at most 0.9 megapixels (half resolution at
2560×1440). The look still changes if the canvas cannot be drawn. Reduced motion: at once, as now.

**The sidenav** (decision 633): the same drawing behind the rows, from the hairline over Settings,
out of a pool of ink with webbing between the roots, at most 70 % of the workspaces' column, its top
faded; drawn once, again on a resize; as Hive arrives they rise (shoot up, overshoot, curl over,
settle), then are still.

**Measured** (this branch's viewer, hardware acceleration off as the app runs on WSL; CPU is every
browser process, in % of one core):

| | fps | worst frame | CPU |
|---|---|---|---|
| The question, today, still | 60 | 16.8 ms | 4 % |
| Any motion in it (canvas, SVG paths, a moving SVG filter) with the backdrop blurs | 16–31 | 50–100 ms | 99–112 % |
| Carnage's idle, 30 fps, no blurs (two runs) | 60 | 16.8 ms | 23–24 % |
| Panning 599 nodes (2,923 changed symbols): Hive off / today / new still / new moving | 59 / 60 / 59 / 59 | | 138 / 156 / 162 / 163 % |
| The sidenav at rest: still / moving at 30 fps | 60 / 60 | | 4 / 21 % |
| Turning on, 2560×1440, full resolution, in a window | 55 | 33 ms | |
| Turning on, 2560×1440, 0.9 megapixels, 2 runs headless and 2 in a window | 61 | 16.8 ms | |

**Files**: `ui/hive-art.ts` (pure: noise, springs, ropes, poses, widths, strands, the Mind, the three
scenes, the arrival's cover and resolution), `ui/hive-draw.ts` (new: the canvas drawing),
`ui/HiveArt.tsx` (the question's and the sidenav's canvases and their runner), `shell/hive-arrival.ts`
(the Mind and the blackout), `ui/hive.css` (the palette, no SVG mask rules, no blurs on the question),
`settings/HivePage.tsx` (the arrival from the question's Mind).

**Verification**: tests first (`hive-art.test.ts`: springs overshoot and settle, ropes stay finite
for minutes, a grabbed tip never leaves its cell, strands form and snap, widths swell and thin, the
blackout covers the window by its end, the resolution budget; `hive.spec.ts`: the question moves
while open and stops when it closes, one still frame with reduced motion, the window's sampled
pixels all opaque on the frame the look changes, nothing moving by 3 s); `pnpm check`, `pnpm build`,
`pnpm test:e2e`; the built question, sidenav and arrival recorded the same way and set beside the
plan's, both themes, 1x, a short and a tall window, a full workspace list; the costs again.

**Risks**: a slower machine (the idle's rate and the canvas's size are set by measured budgets, and
the look still changes on time); without the blur the page behind the question is sharp under its red
darkening; a motion made of noise varies run to run (tests keep it in bounds).

**As built** (what differs from the plan given to the person):

- **The sidenav's tendrils at 0.6 opacity, their highlights at half** (the plan's at 0.9, full): the
  filled tendrils sit behind the words, and against the brightest pixel behind them the muted ones
  (`#bcaeb0`, the times) fell to 3.14:1; at 0.6, 4.46:1 (4.70 in a 700 px window), the others at
  least 8.75:1. Without the tendrils the lowest is 5.1 (white on a Respond button); today's thin
  outlines rarely cross a word (7.44).
- **Every tube is drawn lean**: its shading exactly to its outline, no clipping mask (a third
  cheaper, the same look), smoothed 2 points a segment, a gradient every 3; the arrival's lean tube
  was the plan's, now the question's and the sidenav's too.
- **The lumps never vanish**: the noise that scaled them could reach 0 and leave a plain taper (a
  test found two); they are scaled between 0.5 and 1.
- **The rise**: the sidenav's tendrils wait 0.41 s after the swap (the boom), rise and settle by
  2.2 s; the canvas says `data-moving` until then.
- **The question's art fades at its lower edge** into the question (`mask-image`), and the arrival
  starts from the art's middle and size (`Origin` is `{ x, y, scale }`).

**Results.**

- Tests first, red before (`hive-art.test.ts`: the module's exports missing; `hive.spec.ts`: no
  canvas in the question). Now `hive-art.test.ts` 14, `hive.spec.ts` 6 (the window's sampled pixels
  all opaque on the frame the look changes). `pnpm check`: 2,483 tests; `pnpm build`;
  `pnpm test:e2e`: 352 viewer and 20 nexus tests.
- Recorded on the build the same way as the plan's (Playwright's clock stepping the page 1/30 s, the
  CSS animations seeked), both themes, and set beside them: the join's timing matches frame for frame
  (out 0.3–0.6 s, strike 0.7–0.8 s, grabs 0.8–1.1 s); the arrival's too (covered at 1.0 s, the boom at
  1.2 s, the new look at 1.3 s).
- Costs on the build, hardware acceleration off:

| | fps | worst frame | CPU |
|---|---|---|---|
| The question open, alive / with reduced motion (two runs each) | 60 / 60 | 16.8 / 16.8 ms | 21 / 4 % |
| Panning 599 nodes, Hive off / on (three runs each) | 59.6–59.9 / 59.3–59.8 | 16.8 / 33 ms once | 122–126 / 147–155 % |
| Turning on at 2560×1440, headless (three runs) | 59 | 33 ms once | |
| Turning on at 2560×1440 in a window (Xvfb, three runs) | 54–56 | 50 ms | |
| Today's (`main`'s build) the same, in a window | 33–35 | 117 ms | |

  In a window, of the 6–14 frames over 20 ms, 1–4 fall in the blackout; the rest at the swap (the
  page drawn again in Hive's look under the cover) and after it, where the streak and the sheen's
  fade (kept as they were) run at about 30 frames a second on `main` too.

Not verified: the app's window itself (Electron is not installed here: Chromium with hardware
acceleration off stood in for it), a GPU, WSLg's own display (a private Xvfb stood in for it).

## Fix: no tendrils in the sidenav (fix/remove-hive-tendrils-from-sidenav)

**Status:** built, ready for review (2026-10-31). Asked: "let's remove this tendrils from the
sidenav. We dont need it". Decision 633 is withdrawn: with Hive on, the sidenav draws no canvas.
Its light from above and the crimson glow at its foot stay; so do the question's tendrils, the Hive
Mind and the arrival (decisions 629–632), which now ends with the streak.

**As built:** `HiveTendrils` and its place in `Sidenav.tsx` removed, with what only it used:
`sidenavScene`, `RISE_SECONDS`, `Painter.sidenav` and its webbing, `edgeAt`, `paint`'s `bottom`
fit, and the CSS that placed it (`.hive-tendrils`, the sidenav's `isolation` and the workspaces'
`position: relative`). 303 lines of source out (12 in), and the 25 lines of unit tests for the sidenav's scene.

**Verification:** `e2e/hive.spec.ts` expects no canvas in the sidenav with Hive on (turned on,
reloaded, reduced motion): red on `main` (3 tests, "expected 0, received 1"), green after. The
test of the tendrils' place above Settings and the arrival's "they rise" step went with them.

## Feature: Hive's question, a circuit (feature/hive-mode-dialog-prompt)

**Status:** built, ready for review (2026-10-31): the person's pick of three candidates, and turning
on in the same style, asked after the plan (decision 673).

**Problem** (the person: "The tentacles right now does not really fit the context...make it more
like the Hive mind style, more futuristic, robotic..make some screenproofs, and show me first").
The question's art is Carnage's tendrils (decisions 629–631): wet, organic tubes that strike and
grab a glossy comb. Hive is the graph loop of agents and an orchestrator; the art reads as a
creature, not a machine.

**Goal**: the question's head as a machine in Hive's ink and crimson: traces that route the agents
into a machined Hive Mind, alive while the dialog is open; turning on in the same style (asked
after the plan: "Turning Hive on animation should be in the Circuit style"). **Unchanged**: the
dialog (its words, buttons, focus, Escape, ink and crimson in both themes), the art's 520 × 128
place faded at its lower edge, its run (decision 631), the arrival's timing and the streak after it
(632), Hive's look on the pages, the mark.

**How it was chosen.** A throwaway prototype drew three candidates in place of today's art in this
branch's `symbiote view` (a scratch repository), 1440×900 at 1×, both themes: A, Circuit (traces on
a board); B, Conduits (armoured cables that plug in); C, Swarm (the comb assembles, drones dock on
its lattice). Each was filmed frame by frame (the prototype stepped 1/30 s from the moment the
dialog opens, 7 s) and shown on a page with its cost. The person picked A, and kept C "for the
future" (decision 667).

**The Hive Mind** (decision 666). 19 cells in a honeycomb of radius 2 (a cell's circumradius 11 px),
the core in the middle. Each is a gunmetal plate (a gradient lit from the upper left, its edges
bevelled: light on the edges facing the light, dark on the others), a chamber of dark glass inside
it lit crimson from within (pink at its middle; the core white-hot at its lens). Each cell boots at
its moment with a short flicker; the core first. A signal that reaches a cell lights it, then each
cell one ring in, 75 ms apart, down to the core, which pulses with the signals and a slow breath.
It is drawn the same in the question and in the arrival.

**The question** (decision 665), a 520 × 128 box, the Mind at (260, 64):

- **A board**: a honeycomb etched faintly behind everything, revealed from the middle outward
  (1.3 s); the sides shaded.
- **A targeting ring** (radius 51) drawn in from the top, ticks every 6°, three arcs turning one way
  and two the other.
- **Ten traces**, five a side, from beyond the box's sides to the vertical edge of the Mind's five
  outer cells on that side, each run at 0° and 45° only; vias at their bends; ten thin stubs between
  them that end in vias. Each trace is drawn from its edge with a bright head (in and out of ease,
  0.12–0.8 s apart), lands on a pad that flashes, and lights its cell.
- **Alive**: packets run along each trace into its cell (about every 2.2 s a trace, 230 px a
  second); now and then a white order runs back out from the Mind (about every 6.5 s).
- **Pure**: every state is a function of the time since the dialog opened (no springs, nothing
  stepped); the signals' timetables are seeded slots, so an hour open is as cheap as a second.
  `JOIN_SECONDS` becomes 2 (the last trace lands at about 1.7 s, its cell lit by 1.9).

**Turning on** (decision 673, amends 632; the same times): the arrival's Mind is the new one, fully
booted, a few signals of its own as it grows, its targeting ring with it. The blackout becomes a
shutter: the window's honeycomb of hex tiles (a tile's radius a 26th of the window's shorter side,
at least 16 px), centred on the Mind, shuts from the edges in as the old blackout's front passed
(each tile growing over about 1.6 tiles of the front, its edges lit while it does). Twenty traces,
seven from each side and three from the top and the bottom, route at 0° and 45° across the shut
tiles to the grown ring, drawn up to the front with a bright head. Covered at 1.0 s: every pixel
ink, the look changes under it, the window kept as one picture. The Mind flares and the traces
surge (0.16 s); then the tiles open from the Mind out (0.62 s), the picture seen only through the
tiles still shut, their edges lit, a ring of light ahead; then the streak, as now.

**Measured on the prototype** (the question open 10 s, every browser process, hardware acceleration
off, two runs): today's tendrils 17 and 18 % of a core, the circuit 13 and 18 %, a still question 3 %;
60 frames a second each; 0.7 ms of script a frame.

**Files**: `ui/hive-art.ts` (pure: the Mind, the board and its traces, their timetables; the
arrival's scene with the new Mind, its tiles and traces; the tendrils' springs, ropes, plugs, free
tendrils and goo and the blackout's noise removed), `ui/hive-draw.ts` (the machined Mind, the board,
the traces and packets, the shutter; the tube shading and the liquid edge removed), `ui/HiveArt.tsx` (the same runner, by time), `ui/hive.css`
(the art's colours: metal, glass, lamp; Carnage's removed), `spikes/hive-question-candidates/`
(the prototype, its recorder and the Swarm's film).

**Verification**: tests first (`hive-art.test.ts`: the Mind's 19 cells and their way to the core;
ten traces, five a side, each at 0° and 45° only, from beyond its side to its own cell's edge, inside
the box's height; drawn from the edge and whole by the join's end, never undrawn; a landing lights
its cell, then each cell in, the core last; packets in and orders out after the join, none before,
still running an hour later; the same time gives the same state whatever came before; every cell
booted by the join's end; the shutter's tiles cover the window at four sizes, shut from the edges
in and never one back, all shut once covered, open from the Mind out and none left at the end; the
arrival's traces at 0° and 45° from all four edges onto the grown ring, drawn as it closes; the
arrival's other tests kept); `hive.spec.ts` keeps its checks (moving while
open, nothing once closed, one still frame with reduced motion, the cover when the look changes);
`pnpm check`, `pnpm build`, `pnpm test:e2e`; the built question filmed the same way as the
candidate and set beside it, both themes, 1×; the arrival filmed; the costs again (the question
open, the arrival at 2560×1440).

**Risks**: the art is lines on the dialog's own background, not a filled picture: the e2e still
frame's share of drawn pixels drops (its threshold follows, with the reason); the traces' glow over
the question's words (the art ends above the heading, faded at its lower edge, as now).

**As built** (what differs from the plan given to the person):

- **Turning on in the circuit's style** (decision 673): asked after the plan ("Turning Hive on
  animation should be in the Circuit style. forgot to respond to this question"), built on this
  branch and filmed before review rather than mocked first. Planned as 668, which
  `feature/export-activity` took meanwhile.
- **The Mind at (260, 64)**, the art's middle (the prototype's at 62): the traces then meet its ports
  at 0°, and the arrival grows it from the art's middle as before.
- **The e2e still frame** checks the Mind solid in the middle and a trace in the column 3 % from
  each edge (alpha over 160; the sides' shade alone is about 105 there), in place of a share of
  filled pixels (the board is lines on the dialog's own background).
- **The traces' surge is clipped to the tiles still shut**: drawn over the whole window, it left
  pink lines over the new page for about 0.25 s (seen on the light theme's film).
- **Timing**: the last trace lands at 1.68 s, every cell on by 1.47 s, `JOIN_SECONDS` 2.
- `ui/hive-art.ts`, `ui/hive-draw.ts` and `ui/HiveArt.tsx`: 1,985 lines to 1,383.

**Results.**

- Tests first, red before: `hive-art.test.ts` 9 of 12 for the question (16 cells, no traces, no
  feeds), then 4 for the shutter (no tiles, `shut`, traces, `reached`); now 15. `hive.spec.ts` 5
  (every sampled pixel opaque when the look changes).
- Filmed on the build the same way as the candidate (Playwright's clock paused, then run 1/30 s a
  frame) and set beside it: the same join, frame for frame. The turn-on filmed in both themes.
- Costs, hardware acceleration off, headless, alternating with `main`'s build:

| | `main` | This branch |
|---|---|---|
| The question open 10 s, alive (two runs) | 17, 18 % of a core | 12, 15 % |
| The question still (reduced motion) | 3, 3 % | 3, 3 % |
| Turning on at 2560×1440 (three runs) | 59.5, 60, 58.4 fps | 59.5, 60, 60 fps |
| Turning on at 1440×900 (two runs) | | 60, 60 fps; worst frame 16.8 ms |

Not verified: the app's window (Electron is not installed here), a GPU, WSLg's own display, the
turn-on in a window rather than headless (V82 measured both).

