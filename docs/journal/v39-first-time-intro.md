# Journal: V39 — A first-time intro: two koi form the S

[Index](../JOURNAL.md) · [Plan](../plan/v39-first-time-intro.md)

## V39 spike — the koi intro in Chromium (2026-10-23, branch `feature/first-time-intro`)

Asked: "a first time intro into the app", with `koi-intro.zip`: a WebGL1 engine (`koi-intro.ts`,
1,285 lines), its rig, five WebP images, a splash for a web app's first launch and the Python that
made the assets. The engine was read whole before running it: WebGL, Web Audio, and nothing
fetched but its own images. Run out of the repository (transpiled with the repository's
TypeScript, the assets served as files) in Playwright's Chromium 1.63, headless, 1440×900.

**Learned**:
- **It runs as designed on software GL**: SwiftShader (Vulkan, Subzero) keeps 60 fps (frame gap
  median 16.7 ms, p95 16.7–16.8); the engine's own work is 0.6 ms a frame (p95 0.9): the water is a
  144×144 grid on the CPU, the koi two meshes of 170×24 vertices. Assets and GL ready in 65–86 ms;
  the S formed at 4,185–4,188 ms of its 4,200.
- **The tile's corners are transparent**: on the light theme's white page it is the same dark
  tile, nothing to redraw per theme.
- **Without WebGL** (`--disable-webgl`) `create` throws `KoiIntroError` `webgl-unavailable`
  before drawing anything.
- **The zip's splash keeps "seen" in `localStorage`**, and each `symbiote view` is a new origin
  (decision 17): in a browser it would play on every run. The app keeps five viewer keys across
  runs (`CHOICES`); anything else is lost with the port.
- **The final frame is not the three layers composited**: the koi cast soft shadows on the floor
  (`uShadowOn`), so the icon must be the engine's own frame, not a stack of the images.
- **Under the repository's options** the engine has 103 type errors, all reads of typed arrays
  under `noUncheckedIndexedAccess`; under `strict` alone, none.
- The server sends `.webp` as `application/octet-stream` today; the 200 e2e tests each open a
  fresh browser, where a first-visit intro would cover the page for 5.6 s.

## V39 — a first-time intro: two koi form the S (2026-10-23, branch `feature/first-time-intro`)

The person's koi intro plays once over the first page `symbiote view` or `symbiote pr` serves,
with sound from the start; its last frame is the app's icon. Chosen on the plan: "Sound on from
the start", "we need the final S formation as an icon", and the app's start page left out.

**Learned**:
- **In Symbiote's window there was no WebGL at all.** Electron 44 on WSLg finds no GL
  (`gl=none,angle=none` on Microsoft's virtual GPU, `"webgl":"disabled_off"`), and under Xvfb
  neither; since Chromium 137 it falls back to SwiftShader only with
  `--enable-unsafe-swiftshader` (Playwright's Chromium passes it, which is why the spike drew).
  Probed with a hidden window on the person's display, then the switch in the app: SwiftShader's
  WebGL on both displays. Without it the intro would have been skipped, silently, on the one
  machine it is for: only the app spec, run in a real Electron, showed it.
- **The icon is the engine's frame, not the layers stacked**: the koi cast soft shadows on the
  floor. Drawn with reduced motion (the engine's last frame at once), it equals the frame a full
  swim stops on: at 3.5 s after the S the drop's ripple still runs (peak 0.034 over the 0.02 it
  stops at; 22,692 pixels differ, by 1–9 levels), at 3.8 s the engine stops and 0 pixels differ.
- **A WebGL canvas is read in the task that drew it**: `toDataURL` after `await play()` works
  (the continuation runs before the frame is shown); later, the buffer is gone.
- **Electron's `isCurrentlyAudible()`** tells a spec the window plays sound, even on Xvfb with no
  audio device.
- **The JSON rig and `.webp` imports** need nothing in Vite 8: the images are emitted as they are
  (byte for byte, as `koi-aux.webp`'s data map needs), the rig inlined in the chunk.

**Verification**:
- Tests first, red for the right reason: the record and `/api/intro` (no module, 404s,
  `application/octet-stream`), `intro.spec` (no `.intro`), the app's intro test (no overlay: no
  WebGL, which led to the switch). Then `pnpm check`: 1,305 tests in 95 files (15 new).
- e2e: 207 of 208, with `intro.spec`'s 7 (first visit and the page beneath, not on the next;
  Escape and a click; Settings, nothing recorded with `off`; no WebGL; reduced motion; `?graph=`
  never asks) and the app's (audible at once, under the title bar, the window's corners). The one
  failure, `shell.spec`'s keyboard test, passed 5 of 5 alone: flaky on `main` (the refactor's
  entry).
- The engine: its emitted JavaScript diffed against the zip's (one `Promise.all`), its last frame
  against the zip's engine's (0 of 1,048,576 channels).
- In the app (Electron 44 under Xvfb, SwiftShader, 1440×900): 243–245 frames in 4.06–4.08 s,
  gap median, p95 16.7 ms, worst 16.8; dark and light screenshots: the tile centred under the
  title bar.
- `/history`, 10 rounds alternated with `main`'s viewer, the intro seen: first contentful paint 52
  ms, first rows 94 ms, on both. First visit: overlay 41 ms, first paint 64, koi 133, rows 251.
- Settings' bar at 1×, dark and light: the button and the theme switch share top and bottom (28
  px), 12 px apart, the bar's gap.
- The two 404s a History page logs are its `/api/graph` probe, `main`'s viewer too.

Not verified: the intro's frames in the person's own window (the probe there showed no GL, and
SwiftShader's WebGL with the switch); sound on a real device; a desktop browser's autoplay; macOS,
Windows, a GPU.
