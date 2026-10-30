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

