# Journal: V82 — Hive mode: a dangerous switch and an ink and crimson look

[Index](../JOURNAL.md) · [Plan](../plan/v82-hive-mode.md)

## V82 mockups — two looks tried on the running viewer (2026-10-30, branch `feature/hive-mode-setting`)

Both mockups were real screenshots: `symbiote view` on this worktree, 1440×900 at 1×, both themes,
a trial stylesheet and the new Settings page added in the browser by a Playwright script (outside
the repository). The first, a neutral ink tint with white highlights and faint line tendrils, was
too quiet: "more like this, but redish and black", with a picture of glossy black liquid. The
second (ink and crimson, glossy tapered tendrils, the dialog always in the look with tendrils
joining into a hexagon) was approved.

**Learned**:
- **A token overridden for dark Hive under `:root[data-hive]` alone also reaches light**: the
  first mockup's dialog was dark on the light theme (`--dialog-bg`), its words dark on dark. Dark
  Hive's block is `:root[data-hive]:not([data-theme='light'])`.
- **Line tendrils read as wires on near-black**: only their rims showed. Filled, tapered shapes
  (a centreline offset by a width that thins to a point) with a crimson edge and a white
  highlight read as glossy liquid.
- **A trial `--edge` of `#6e575b` was 2.995:1** on `--side`, under the 3:1 rule by rounding;
  `#725b5f` is 3.07.
- **Opening `/nucleus` in a worktree's `symbiote view` shows the person's live Nucleus
  conversation** and touched the main checkout's `symbiote/` files: screenshots leave Nucleus out.

## V82 — Hive mode in Settings and its ink and crimson look (2026-10-30, branch `feature/hive-mode-setting`)

Built as planned (decisions 611–616): `hive.json` in Symbiote's config folder and `/api/hive`;
the server writes `data-hive` on `<html>` with every page, the nexus with its own; Settings' Hive
mode entry, its warning and danger button, the question in Hive's own look with tendrils joining
into a hexagon; the tokens, the sheen, the tendrils at the sidenav's foot and the crimson S while
it is on.

**Learned**:
- **An ink element in a light page needs the whole dark set**: Hive's names alone left light
  Hive's sidenav with light states (amber `#9a6700` on near black). The theme's dark block also
  matches `:root[data-hive] .sidenav` and `.hive-ink`, Hive's after it. Two tests looked the dark
  block up by its selector (`tokens.test.ts`, `icons.test.ts`): both follow it.
- **`position: relative` for the tendrils broke the narrow drawer on paper**: Shell.css's
  `.shell.drawer-open .sidenav { position: fixed }` has the same specificity and comes earlier.
  `:where(:root[data-hive]) .sidenav` has none; the drawer measured `fixed` in both themes.
- **The tendrils showed through the workspace cards** in a 700 px window: a card is a 3.5 % wash.
  They take at most 45 % of the sidenav, their tops cut (`slice`) and faded by a mask.
- **`pgrep -f`'s pattern matched the shell running it twice**, once through a restart later in
  the same command line: find a server by its port (`ss -ltnp`), stop it by PID.
- **"Off is main" needs a baseline of noise**: `main` against itself differs on Workspace History
  (a live timeline, ~175,000 px), Git (times, ~120–220 px), a graph's corners (57–74 px) and the
  working spinner (~115 px); the branch against `main` differs by those and Settings' new entry
  only.

**Verification**: tests first (red: the record, `/api/hive`, the nexus's page, the Hive token
blocks; the geometry test's straight line was wrong, not the code: a cubic's parameter is not its
length unless its control points are evenly spaced). `pnpm check` 2,451 tests (once 2,450:
`nucleus.test.ts`'s temp folder removed while a file was written, `ENOTEMPTY`; three reruns
passed, a file this branch does not touch); `pnpm build`;
`pnpm test:e2e` 349 viewer and 15 nexus
tests (the Hive, Settings, shell and look specs again on the final build: 39). Every page with Hive off and on, dark and light,
1440×900 at 1×, no page errors; the drawer at 820 px; 3× zooms of the new page's text. Pan of a
3,468-symbol diff: 60–61 fps on and off, three runs each, alternated (headless).

Not verified: an open workspace's page and Nucleus's page (they attach to live agents'
terminals); the nexus's page in a browser; the app's window; panning on a GPU.

## Fix — Hive per repository, Settings readable, the ink takes the page (2026-10-30, branch `fix/hive-per-symbiote`)

Hive mode moved from the machine's settings folder to each repository's `symbiote/hive.json`
(decision 621, replacing 611); the nexus's page never takes it (622); its Settings entry is under
This repository (623). Settings at the sidenav's foot is readable again, and turning Hive on
animates until still (624).

**Learned**:
- **"Not visible" was "not readable"**: Settings' row was there and took clicks
  (`elementFromPoint` found its link), but the tendrils filled the sidenav's bottom 45 %, its
  row included, and their white highlights ran through the gear and the word. They are drawn in
  the workspaces' column now; the sidenav stays their stacking context (`isolation`), so they
  still sit behind the cards.
- **A reveal of the new look through a growing mask would show little in dark**: `#090b0e`
  against `#070506`. The ink is drawn instead, over the window, and the look changes under it.
- **The ink's strokes need `vector-effect: non-scaling-stroke`**: the layer scales from 0.3 to
  about 20; a 1.5 px crimson edge would have grown to 30 px.
- **A pseudo-element cannot go in `:is()`**: `:is(.a, .b::before)` is dropped whole; the
  reduced-motion rule lists its three selectors.
- **The e2e repositories have no git user** (`GIT_CONFIG_GLOBAL=/dev/null`), so their reviews,
  and Hive, go to the cache. The spec gives its `symbiote view` one through git's own variables
  (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`), as the person's repositories
  have, and checks `symbiote/hive.json` and a clean `git status`.
- **Env set in a `describe` body leaks into every other describe of the file** (they are all
  collected before any test runs): the new `main.test.ts` block sets its variables in
  `beforeAll`.

**Verification**: tests first (red: two `symbiote view`s both marked by the machine's record;
the nexus's page marked; no This repository; the tendrils' bottom at 876 against Settings' top
at 827.5; no ink). `pnpm check` 2,457 tests; `pnpm build`; `pnpm test:e2e` 352 viewer and 15
nexus tests (one workspace card's position check failed once beside screenshot scripts, Hive
off; 5 of 5 alone, then the whole suite). Frames of the arrival in both themes at 1440×900;
every page with Hive on, both themes, and the narrow drawer; `on()` 7–11 ms a page load.

Not verified: the app's window; the off fade's look.

## Hive tentacles spike — three candidates, then Carnage (2026-10-30, branch `feature/hive-tentacles`)

A prototype engine (outside the repository: springs and noise, tubes on a canvas, goo strands, a
Hive Mind) drew three candidates, Venom, Hive and Carnage, in place of today's art in this branch's
`symbiote view` (a scratch repository, a full workspace list mocked with `page.route`), recorded
frame by frame (the prototype stepped by 1/30 s, a screenshot each frame, the CSS animations seeked
to the same time) and shown live on a page with the costs. The person picked Carnage, then asked for
tendrils that stay attached, a more natural feel, and a turning-on of "only the Hive mind, and the
blackout animation". Planned as decisions 629–633.

**Learned**:
- **The blur behind the question costs more than any drawing in it.** With hardware acceleration
  off (as the app runs on WSL), a canvas loop, SVG paths rewritten each frame and today's SVG under a
  moving displacement filter all took 99–112 % of a core at 16–31 fps in the open dialog; with both
  blurs off, 61, 25 and 19 % at 60 fps. The 3 px blur over the whole window is most of it: the
  software compositor blurs it again on any change above it.
- **A canvas's drawing is mostly raster, not script**: for the question, 0.2 ms to step, 1.8 to
  record the drawing, 4.4 ms to raster it (forced by reading a pixel). A clipping mask per tube cost a
  third of it; shading drawn exactly to each tube's outline looks the same.
- **The heavy frames of a cover are the covered ones**: everything is drawn under solid ink. The
  covered window is one picture, taken once and moved (19–21 ms a frame to 2–3 ms at 2560×1440).
- **Tentacles count, not their size**: binding tentacles doubled the tubes and took the arrival to
  53–56 fps at 2560×1440; slimmer ones barely helped, the lean tube did. Without tentacles the
  blackout and the Mind cost 3 ms a frame.
- **A grabbing tip must not ride its spring back out**: an under-damped strike overshoots into the
  cell and swings back below it, the tip leaving the cell ("like sucking", the person). Once it
  grabs, the strike's spring is held at the cell and the bounce goes into the body; the old re-grip
  events went too.
- **What made it look artificial**: tendrils as parallel bands from edge to centre (hoses), even
  widths, a twitchy noise, dashed veins along them, light outlines on the comb's cells (hex nuts).
- **Recording motion**: real time in a headless browser stutters under load; stepping the scene by
  exact time and seeking the page's CSS animations gives smooth films (30 frames a second, 6 s of a
  dialog in about 15 s). The arrival was recorded in the real page: today's ink made to run at once
  and hidden, the real Turn on clicked on the frame the candidate's cover was complete.
- **The Artifact tool reads only the worktree**: the plan's page and media were published from the
  worktree's ignored `coverage/` folder.

**Verification**: costs measured in this branch's viewer with `--disable-gpu
--enable-unsafe-swiftshader`, headless and in a window on a private Xvfb (2560×1440), CPU from
`/proc` for every browser process; the graph for the pan is this repository's last 40 commits
(474 files, 2,923 symbols, 599 nodes drawn). Not measured: the app's window itself (Electron is not
installed here).

## Hive tentacles — built (2026-10-30, branch `feature/hive-tentacles`)

Built as planned (decisions 629–633): `ui/hive-art.ts` (pure: springs, ropes, the tendrils, goo,
the Hive Mind, the three scenes), `ui/hive-draw.ts` (the canvas), `ui/HiveArt.tsx` (the question's
and the sidenav's canvases and their runner), `shell/hive-arrival.ts` (the Mind and the blackout),
`hive.css` (Carnage's palette as custom properties, no blur on the question).

**Learned**:
- **Filled art behind words is a contrast problem outlines never were**: against the brightest pixel
  behind each word (the words hidden, the page screenshot read in the page), the muted times fell to
  3.14:1 over the tendrils' crimson rims; today's thin outlines rarely cross a word (7.44). At 0.6
  opacity with highlights at half: 4.46.
- **Noise that scales a feature can switch it off**: the lumps were scaled by noise reaching 0, and a
  test caught two tendrils as plain tapers. A feature that must always show gets a floor.
- **Playwright's clock flows in real time after `install()`**: frames recorded with `runFor` ran ahead
  until `pauseAt` stopped it before the dialog opened; then the page's own rAF loop records frame for
  frame.
- **The real page costs more than a page of screenshots**: the arrival measured 61 fps over two
  screenshots and 54–56 in the real page in a 2560×1440 window. The extra frames are the swap (the
  whole shell drawn again in Hive's look) and today's streak and sheen fade after it, which run at
  about 30 frames a second on `main` too; today's arrival is 33–35 fps.
- **A cover can be tested pixel by pixel**: a MutationObserver on `data-hive` reads the blackout's
  canvas in the same task as the swap, before the next frame is drawn: every sampled pixel opaque.

**Verification**: tests first (red: no exports, no canvas); `pnpm check` 2,483 tests; `pnpm build`;
`pnpm test:e2e` 352 viewer and 20 nexus tests. The built question and arrival recorded in both
themes and set beside the plan's; screenshots at 1x in both themes, a 700 px and a 1200 px window, a
full workspace list. Costs on the build with hardware acceleration off: the question 21 % of a core
while open (4 % with reduced motion), the pan 59.3–59.8 fps with Hive on, the arrival 59 fps
headless and 54–56 in a window at 2560×1440 (today's 33–35).

Not verified: the app's window, a GPU, WSLg's own display.

## Hive's question candidates — three robotic heads, then the Circuit (2026-10-31, branch `feature/hive-mode-dialog-prompt`)

The person: "The tentacles right now does not really fit the context... more like the Hive mind
style, more futuristic, robotic... make some screenproofs, and show me first." A prototype
(`spikes/hive-question-candidates/proto.js`, each candidate a pure function of time) drew three heads
in place of the question's canvas in this branch's `symbiote view`: Circuit, Conduits, Swarm, all
round one machined Hive Mind. They were filmed frame by frame in the real dialog and shown on a page
with their costs. The person picked the Circuit and kept the Swarm "for the future"; then asked for
turning on in the same style. Planned as decisions 665–667, then 673.

**Learned**:
- **A pure function of time films itself**: with no springs, any frame is `draw(t)`, so the
  candidates were filmed by calling it at 1/30 s steps, with no clock to fake and no stutter.
- **At 1×, small hexes read as dots**: the Swarm's first drones (a 2.4–4 px radius on their own fine
  lattice) looked like an LED matrix. Docked on the Mind's own lattice (radius 11, smaller toward the
  edges) and kept one ring away from it, they read as a hive.
- **Ports decide a route's angles**: the traces were laid out for a Mind at 64 and the prototype
  put it at 62; the last run of each came in 2 px off level. Build the routes from the cells' ports.

**Verification**: the candidates' costs, the question open 10 s, every browser process, hardware
acceleration off, two runs: Carnage 17 and 18 % of a core; Circuit 13 and 18 %; Conduits 13 and
16 %; Swarm 10 and 10 %; still 3 %.

## Hive circuit — built (2026-10-31, branch `feature/hive-mode-dialog-prompt`)

Built as planned (decisions 665–667, 673): the question's circuit board and machined Mind, pure in
time (`ui/hive-art.ts`, `ui/hive-draw.ts`, `ui/HiveArt.tsx`); turning on as a hex shutter with traces
into the grown ring (`shell/hive-arrival.ts` unchanged but for its words); the tendrils' engine and
the liquid blackout removed (1,985 lines to 1,383).

**Learned**:
- **Endless signals need slots, not a list**: a timetable of one departure in each seeded slot
  answers "which left between a and b" in constant time, so a cell's glow is a pure sum and an hour
  open costs what a second does; a precomputed list ran out after its horizon.
- **A picture through a clip opens a cover tile by tile**: the covered window, taken once, drawn
  through a clip of the tiles still shut, opens the shutter at 60 fps at 2560×1440 in software; the
  traces' surge has to go inside the same clip, or it lingers over the new page.
- **Decision numbers move while a branch waits for an answer**: 668 was free at plan time and taken
  by `feature/export-activity` two hours later; the recheck before committing the turn-on caught it.

**Verification**: tests first (red: 9 of 12 for the question, then 4 for the shutter), now 15 in
`hive-art.test.ts` and 5 in `hive.spec.ts`; the built question filmed beside the approved candidate;
the turn-on filmed in both themes; the costs against `main`'s build (the question 12 and 15 % of a
core against 17 and 18; turning on at 2560×1440 59.5–60 fps against 58.4–60).

Not verified: the app's window, a GPU, WSLg's own display, the turn-on in a window.

## Alpha Ceph — Nucleus's name and icon in Hive mode (2026-10-31, branch `feature/alpha-ceph-hive-name`)

Built as planned (decisions 682–687, planned as 674–679): `NUCLEUS_NAMES` in core, the viewer's
literals typed by it; `{name}` in Nucleus's prompt; a conversation's name in its record and its
gate's arguments; the Hive Mind as `NucleusIcon` while Hive is on.

**Learned**:
- **The art's gunmetal vanishes at icon size**: the Mind's plates (`#3b2f34` to `#0c0809`) drawn at
  18 px on the ink showed only their red chambers. A step lighter (`#8a767d` to `#241b1e`) with a
  faint bevel reads; 19 cells blur to a dotted disc, and outlines in the text's colour merge into a
  flower (five candidates in `spikes/alpha-ceph-icon/`).
- **A placeholder changes what Settings shows even when it changes nothing given**: the default
  text in the editor reads `{name}`, and the page gains a Placeholders section. Proving "as main"
  for the agent took a hash of main's text, not a look at the editor.
- **Settings' agent page title came from the agent's key**, not its entry's name: only the
  screenshots showed it; the e2e checks it now.
- **Nucleus's record comes after its session is found**: an e2e reading `nucleus.json` as soon as
  the fake agent was started passed alone and failed in the full suite. It polls for the record now.
- **Decision numbers moved again**: `feature/hv3-running-reviewer` planned 674–681 twenty minutes
  after this plan took 674; the check before finishing caught it.

**Verification**: tests first (CLI 12 and viewer 8 red before); `pnpm check` 2,614 unit tests;
`pnpm test:e2e` 368 of 369, the one this branch's race, fixed (16 of 16 runs, 6 at a time); Claude
Haiku with the built prompt says "I'm Alpha Ceph" (Hive on) and "I'm Nucleus" (off); the built gate
through its settings file's command refuses as Alpha Ceph; Hive off's prompt hashes to main's;
screenshots of every changed page, both themes, Hive on and off, at 1×.

Not verified: a real Claude Code session started by Symbiote (the trust prompt), a real Codex
thread, the app's window title.
