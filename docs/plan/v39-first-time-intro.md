# V39 — A first-time intro: two koi form the S

[Index](../PLAN.md) · [Journal](../journal/v39-first-time-intro.md)

**Status:** ready for review (2026-10-23), on branch `feature/first-time-intro` (a workspace
started in Symbiote, from `main` at `c223db6`); the plan and its three choices OK'd by the person.
As built and results under "As built (V39)" below.

**Problem** (asked: "I want a first time intro into the app. You can find everything you need
here", with `koi-intro.zip`; then, on the plan's choices, "Sound on from the start", "Yes, would
need an icon as well. we need the final S formation as an icon", and the start page "As you
recommend"). The zip holds an intro made for Symbiote's new mark: two koi, a white and a black,
rise out of deep water and lock into an S on a dark rounded tile. A WebGL1 engine
(`koi-intro.ts`, 1,285 lines, no dependency), its rig (`koi-rig.json`, 40 KB: spines and swim
paths), five images (450 KB of WebP, one a lossless data map), a splash for a web app's first
launch, and the Python that made the assets from the icon (the icon itself is not in the zip).
Symbiote has no intro, and its icon is the graph glyph (`packages/desktop/icons/symbiote.svg`).

Measured with the zip's engine in Playwright's Chromium (headless, WebGL on SwiftShader: software,
a worst case) at 1440×900, the tile 380 px:

| What | Measured |
|---|---|
| Assets loaded and GL ready | 65–86 ms |
| The S formed | 4,185 and 4,188 ms (its `duration`, 4,200) |
| Frames | 60 fps: gap median 16.7 ms, p95 16.7–16.8, max 50 (the first) |
| Main-thread work per frame | 0.6 ms median, 0.9 ms p95 |
| On a white page (the light theme) | Drawn alike: the tile's corners are transparent |
| WebGL off (`--disable-webgl`) | `KoiIntroError` `webgl-unavailable`, nothing drawn |
| Under the repository's TypeScript options | 103 errors, all `noUncheckedIndexedAccess` on typed-array reads; none without that option |

What decides the design:
- Each `symbiote view` serves a new port, so browser storage is per run (decision 17): the zip's
  splash keeps "seen" in `localStorage`, which would replay the intro on every run in a browser.
  The desktop app carries a fixed list of the viewer's keys across runs (`CHOICES`, N1a).
- Browsers keep audio locked until a click or a key; the app can lift that for its own window.
- The 200 e2e tests open fresh browser contexts: an intro on every first page would cover them.

**Goal**: the first time a person opens Symbiote on a repository, in the app's window or a
browser, the koi swim in and form the S, with sound, then the page is there. Once per person;
Settings plays it again. The S's final frame is the app's icon. **Unchanged**: every page after
the intro, its first paint (the intro's question is answered in the font wait), the API, `?graph=`
pages, the e2e suite (the intro off).

## The record (`packages/cli/src/intro.ts`, `server.ts`)

- `<config>/intro.json` (`{ "seen": "<ISO date>" }`) in Symbiote's config folder: Linux
  `$XDG_CONFIG_HOME/symbiote` else `~/.config/symbiote`, macOS `~/Library/Application
  Support/symbiote`, Windows `%APPDATA%\symbiote` — the app's folder (`configDir`,
  `packages/desktop/src/state.ts`). Written to a temporary file and renamed.
- `GET /api/intro` → `{ show }`; `POST /api/intro` records it seen (204), under the write rule
  (JSON, `x-symbiote`, same origin). Absolute, as `/api/history`: one answer for every page of
  every mode (`symbiote view` with or without revisions, `symbiote pr`).
- `SYMBIOTE_INTRO=off`: `show` is false and nothing is written (as `SYMBIOTE_USAGE=off`, V29c).
- `.webp` is served as `image/webp` (today `application/octet-stream`).

## The page (`packages/viewer/src/intro/`)

- `main.tsx` asks `/api/intro` beside its font wait (both from Symbiote's own server, in
  milliseconds), never on a `?graph=` page or without an answer within the wait. To show it: an
  overlay in the theme's `--bg` is put up before the app's first render (no flash of the page),
  `intro.json` is marked seen, and the intro's chunk is loaded — the engine, the rig and the image
  URLs, apart from the main bundle. The page renders beneath at once.
- The tile at `min(62vmin, 380px)`, centred. In the app the title bar stays above it (its buttons
  and drag strip), and with Symbiote's own frame (N1d) the overlay takes the window's corners.
- Sound on from the start (asked): the engine's water and the drop as the S locks. In the app,
  Electron's `autoplayPolicy: 'no-user-gesture-required'` lets it play at once; a browser plays it
  when it allows audio (after a gesture on the page, e.g. Settings' button).
- The S forms (4.2 s), holds 0.9 s (the drop's ring), fades in 0.45 s; the sound eases out with
  it. A click, Escape or any key fades it at once. With reduced motion: the finished S, the hold,
  no fade. Without WebGL, or an image or the chunk failing: no intro (it counts as seen). A
  safety stop at 12 s.
- Settings → Appearance: "Play the intro".
- The engine as delivered, but for the repository's checks: Prettier, and non-null reads of its
  typed arrays (`noUncheckedIndexedAccess`). Its final frame is compared, pixel for pixel, with
  the zip's.

## The icon (`scripts/desktop/icon.mjs`, `packages/desktop/icons/`)

- `icon.mjs` renders the engine's final frame (reduced motion: the S at rest, the water still)
  in Chromium and writes `symbiote.png` at 512 px — the window, the taskbar, `symbiote app
  install`'s launcher entry — and the viewer's favicon. `symbiote.svg` goes; the sidenav's and the
  start page's 16-unit mark stay (the S does not read at 16 px).

## Verification

1. **Tests first** (red before): the record (folder by platform, read, write, a broken file,
   `off`), `/api/intro` (GET, POST under the write rule, 404 without a record); the page's
   question (`?graph=`, an answer, no answer); `e2e/intro.spec.ts`: plays on a first visit and
   the page works beneath and after; not on the next; Escape and a click skip it; Settings plays
   it; no WebGL, no intro; reduced motion, the finished S.
2. **Nothing else changes**: the e2e harness runs `symbiote view` with `SYMBIOTE_INTRO=off`; the
   suite and the app's specs as on `main`.
3. **Viewer**: first paint of `/history` against `main`'s; the time to the overlay on a first
   visit; screenshots at 1×, dark and light; the main bundle's size.
4. **The app**: Electron under Xvfb (software GL): frames during the intro, the sound's context
   running without a gesture, the icon in the window.

**Risks**

| Risk | Mitigation |
|---|---|
| A slow GPU path in the person's window (WSLg) | Measured under software GL; the canvas is capped at the rig's 1,254 px and at 2× pixel ratio |
| An intro over a page someone came to use | Once per person, skipped by any key or click |
| Sound where one does not expect it | Asked for; it fades with the intro; reduced motion still plays the drop |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 259 | Where the intro plays | **The first page `symbiote view` or `symbiote pr` serves, in the app's window or a browser; not the app's start page** | One engine, built by the viewer's Vite. The start page is a file of the app's own with no bundler: it would need the engine built a second time (the person: "As you recommend"). |
| 260 | Where "seen" is kept | **`intro.json` in Symbiote's config folder, through `/api/intro`** | Browser storage is per origin and each run has its own port (decision 17): the zip's `localStorage` would replay it every run in a browser. Once per person, whichever repository or window. |
| 261 | Sound | **On from the start; the app lets its window play audio without a gesture** | Asked. Browsers lock audio until a gesture; Electron's `autoplayPolicy` lifts that for Symbiote's own window. |
| 262 | Ending it | **A click, Escape or any key; Settings plays it again** | 5.6 s once is short, but a page someone came to use must not wait. Settings is how to see it again. |
| 263 | The engine | **Vendored as delivered, in its own chunk; only what the checks need changed; no still image without WebGL** | Its look is the person's; a final frame compared with the zip's shows nothing else moved. Most visits are not first ones and load none of it. An intro that cannot play is skipped. |
| 264 | The app's icon | **The engine's final frame at 512 px (`icon.mjs`), and the favicon; the 16-unit mark stays** | Asked: "the final S formation as an icon". The painted koi do not read at 16 px. |
| 265 | WebGL in the app (made while building) | **The app asks Chromium for SwiftShader's WebGL (`enable-unsafe-swiftshader`)** | Without it Symbiote's window had no WebGL on WSLg (`gl=none`) or under Xvfb, and the intro never played where the person uses it. "Unsafe" is for shaders from untrusted pages: the window shows only Symbiote's own (N1a hands anything else to the browser). Where a GPU works, WebGL uses it as before; Playwright's Chromium passes the same switch. |

**Not in V39 (later)**: the intro on the app's start page; the S as the sidenav's or the start
page's mark; the zip's asset builder (it needs the source icon, not in the zip).

## As built (V39)

- **WebGL in the app** (not in the plan, decision 265): Electron 44 had none on WSLg (`gl=none`,
  probed on the person's display with a hidden window) nor under Xvfb; Chromium has fallen back to
  SwiftShader only on request since 137. Only a spec in the real app showed it: the browser specs
  ran on Playwright's Chromium, which asks for SwiftShader itself.
- **Ending it**: any key but a modifier alone (Shift, Ctrl, Alt, Meta…), so a zoom chord's Ctrl
  does not end it; the key that ends it does nothing else (Escape does not also clear a selection).
- **The icon** needed the engine itself: the koi cast soft shadows on the floor, so the last frame
  is not the three layers stacked. `icon.mjs` draws it with reduced motion and reads the canvas in
  the task that drew it; two runs give the same bytes (`symbiote.png` 292 KB, the favicon 8 KB).
- **Sound in a browser**: the context is made with the intro and plays where the browser allows
  audio before a gesture. Playwright's headless Chromium does (the context `running` on a first
  visit); a desktop browser's autoplay policy may hold it until a click, which ends the intro.
  Settings' button is a gesture.

**Results**:

- **The engine**: the JavaScript emitted is the zip's but for one `Promise.all`; its last frame at
  512 px is the zip's engine's, 0 of 1,048,576 channels apart. The images are byte-identical.
- **The icon is the swim's last frame**: once the engine stops on its own (3.8 s after the S), 0
  pixels differ from the icon's frame; at 3.5 s the drop's ripple still runs (22,692 pixels, by
  1–9 levels).
- **In the app** (Electron 44 under Xvfb, SwiftShader, 1440×900, dark and light): the swim at 60
  fps, 243–245 frames in 4.06–4.08 s, gap median and p95 16.7 ms, worst 16.8 ms, none over 20 ms;
  audible with no click; the title bar and its buttons above it; no page errors.
- **First paint** (`/history` of this repository, Playwright's Chromium, 10 rounds alternated with
  `main`'s viewer, the intro seen): first contentful paint 52 ms and first rows 94 ms (medians), on
  both. **A first visit**: the overlay at 41 ms, before the first contentful paint (64 ms): no
  flash of the page; the koi swim from 133 ms; History's rows beneath at 251 ms.
- **Size**: the main bundle +1,219 bytes of JS and +337 of CSS; the intro's chunk 65.4 KB (27.8
  KB gzipped), its images 452 KB, loaded only when it plays.
- **Tests**: `pnpm check` 1,305 tests in 95 files (15 new: the record, `/api/intro` in both modes,
  the page's question and keys). e2e 207 of 208 with `intro.spec` (7) and the app's intro test;
  the one failure, `shell.spec`'s keyboard test, passed 5 of 5 alone (flaky on `main`, as the
  refactor's journal says).

Not verified: the person's own window (the probe showed no GL and SwiftShader's WebGL there, but
the intro's frames were measured on Xvfb); sound through a real device (Electron's
`isCurrentlyAudible` only); a desktop browser's autoplay; macOS and Windows; a machine with a GPU.
