# N1d — Rounded window corners

[Index](../PLAN.md) · [Journal](../journal/n1d-rounded-window.md)

**Status:** merged into main (2026-10-21, from branch `milestone/n1d-rounded-window`): its "As
built" and results below. Asked by the person; the merge: "Yes".

**Problem** (asked: "I want the window corner to have some radius.."). Symbiote's window (N1) is
frameless (`titleBarStyle: 'hidden'`) with Electron's overlay for the system's buttons. macOS rounds
such a window itself; Windows 11 keeps its rounded frame. On Linux, and so on this machine through
WSLg, the corners are square. Measured with Electron 44.9 on this machine (WSL2, WSLg, Windows 11),
a 640×400 test window captured from Windows (`GetWindowRect`, corners only):

| Window | Platform Electron picks | Corners | System buttons |
|---|---|---|---|
| As Symbiote's today: hidden title bar, the overlay | X11 (XWayland; `WAYLAND_DISPLAY` is set, `XDG_SESSION_TYPE` is not) | square | drawn |
| Transparent, the page draws a 10 px radius | X11 | **round**: inside the corner the pixels are the desktop's (12, 12, 12), not black | **none**, the overlay's colour transparent or opaque |
| Transparent, `--ozone-platform=wayland` | Wayland | round | none |
| As today, `--ozone-platform=wayland` | Wayland | square | the close button only |

What causes it: Electron rounds a frameless window on Linux "only when the desktop environment
supports client-side decorations" (its `roundedCorners` docs); WSLg's X11 and Wayland do not. A
transparent window lets the page draw its own corners, but Electron then draws no overlay buttons.

**Goal**: on Linux, Symbiote's window has rounded corners (10 px, the style's dialog radius) and a
hairline edge, with Symbiote's own minimize, maximize/restore and close buttons at the title bar's right;
square and edgeless when maximized or full screen. The start page (N1b) too. **Unchanged**: macOS
and Windows (their own corners and buttons, the overlay on Windows), every page in a browser.

## The window (desktop)

- The window's options from one pure function per platform (`frame.ts`, unit-tested): Linux
  `transparent: true`, a transparent background, no overlay; Windows the overlay; macOS the
  traffic lights. The colours before the page paints become the style's (V31: `#0a0a0a`/`#ffffff`,
  the title bar `#171717`/`#fafafa`).
- Its state to the page: maximized or full screen, at load (`sendSync`) and as it changes (the
  window's `maximize`, `unmaximize`, `enter-full-screen`, `leave-full-screen`).
- The page's actions: minimize, maximize or restore, close; accepted only from the window's own
  pages (its server's, or the start page), as the title bar's colours are.

## The page (viewer and start page)

- `index.html`'s first script sets `data-frame="own"` and `data-window` on `<html>` when the app
  says the frame is Symbiote's; the preload updates `data-window` as the window changes.
- The page's root clips to a 10 px radius with a hairline edge (`--menu-line`) when the window is
  not maximized; `html` and `body` are transparent there, the root carries `--bg`.
- The title bar's right end: three 28 px icon buttons (lucide's minus, square, copy, x), labelled
  Minimize, Maximize or Restore, Close; Close's hover in the error colour.

## Verification

1. **Tests first**: `frame.test.ts` (each platform's options, red: no module); the app's e2e
   (Xvfb, Linux): the frame is Symbiote's, the root rounded, the three buttons; Maximize asks the window
   (recorded, as N1c's overlay test records its calls: Xvfb has no window manager), a `maximize`
   event squares the root and names the button Restore; the start page's buttons.
2. **Nothing else changes**: in a browser no `data-frame`; `pnpm check`, e2e.
3. **This machine**: the app opened through WSLg, its corners captured from Windows, maximized and
   restored; the person tries resizing from an edge.
4. **Cost**: the rounded clip on the page's root: Bitwarden `737ee3f` pan fps and first paint with
   and without it, in Chromium.

**Risks**

| Risk | Mitigation |
|---|---|
| A transparent window cannot be resized on some platforms (Electron's docs) | WSLg's window keeps its 32 px resize margin (the spike's captures); the person tries it |
| A rounded clip over the graph costs frames | Measured on Bitwarden's graph before keeping it |
| The window buttons differ from the system's | The style's icon buttons; the system's are back on Windows and macOS |
| No window manager in the e2e display | The window's calls recorded, its events sent, as N1c's spec does |

## Milestones

| # | Milestone | Output |
|---|---|---|
| N1d | Rounded window corners | Linux: a transparent window, its frame and buttons drawn by Symbiote's pages; the style's pre-paint colours |

**Decisions** (218–222, as built; merged with the person's "Yes", 2026-10-21):

| # | Question | Decision | Why |
|---|---|---|---|
| 218 | How to round the window on Linux | **A transparent window, the frame and the buttons drawn by Symbiote** | The spike: the only way to round corners there; the overlay is gone with transparency |
| 219 | The radius | **10 px**, square when maximized or full screen | The style's dialog radius; a maximized window meets the screen's edges |
| 220 | Windows and macOS | **Unchanged** | Their frameless windows are rounded already, with their own buttons |
| 221 | Wayland | **Not forced** | Square there too without transparency, and only a close button |
| 222 | Maximize on WSLg (found in the person's try) | **Symbiote holds it: the work area WSLg chose, as a normal window** | WSLg's maximize of a frameless X11 window is 32 px off (microsoft/wslg#1015); Wayland maximizes right but ignores where the app places a window |
| 223 | The name (asked, 2026-10-21) | **Symbiote** everywhere: the command `symbiote`, `@symbiote/*`, `symbiote/`, `SYMBIOTE_*`, `x-symbiote`, `refs/symbiote/*`, history included | Asked: no trace of the former name. One script over the tracked files, by case; the analysis unchanged (the graph of the last 20 commits identical but for `generator.name`) |
| 224 | What was kept under the former name | **Moved once, on first use**: the repository's folder (entry by entry, folders merged; `.gitignore`, `AGENTS.md`, `claude-settings.json` written again), the cache's state but not its worktrees, the app's settings folder and choices; `app install` replaces the old desktop entry | Asked: keep the person's workspaces and reviews. Worktrees are not moved: git records their paths. A folder of that name with the project's own tracked files is left alone. The former name stays in `former-name.ts` (CLI, app) and their tests only |
| 225 | A config or ignore file at the root under the former name | **Not read** | Project files: the project renames them in a commit of its own |

**Not in N1d (later)**: a shadow drawn by Symbiote (it would need a transparent margin inside the
window); the Windows build (N2).

## As built (N1d)

- **No clip over the page**: a rounded `overflow: hidden` on the root cost 15 ms on every select
  of Bitwarden's graph (88–89 ms against 73–74, 3 rounds). The root's background follows its
  radius, and the strips at the corners take it: the title bar (or a shell-less page's bar) at
  the top, the status bar (or its legend) at the bottom; fixed overlays (a dialog's backdrop, the
  drawer's scrim) take it too.
- **No overlay colours where there is no overlay**: the page sent the theme's colours for the
  system's buttons, and `setTitleBarOverlay` on a window without an overlay throws in the main
  process, where Electron's error dialog blocks the app (every app e2e hung in its teardown). The
  page sends none and the app ignores them where Symbiote draws the frame.
- **A page without the shell** (`symbiote pr` in the app) is the window's title bar: it draws the
  window's buttons too. Not tested in the app (no e2e opens `symbiote pr` there).
- **The start page** is in the style (V31's tokens, the primary button, neutral focus) besides
  its frame; a synchronous `frame.js` marks `<html>` before its first paint (its CSP allows no
  inline script).
- **The window's state comes from its events** (`maximize`, `unmaximize`, the full screen's), and
  the page asks for `restore` or `maximize` by name: a window manager may answer `isMaximized`
  late, and the e2e display has none.
- **Maximize on WSLg is Symbiote's** (decision 222, the person's try: "the full screen is not working
  properly"). WSLg pads a frameless X11 window with an invisible 32 px margin and forgets it when
  it maximizes one: on this machine's 2560×1440 screens the window landed at (2592, 32), the
  desktop showing in the strip above and left, its right end (the buttons) and its bottom 32 px
  off the work area. Opaque or transparent alike (N1c's window too); full screen, and a window
  with the system's frame, are right. On WSLg's X11 (`maximize.ts`) the first maximize on a
  screen goes through the window manager, which knows the taskbar (Electron's work area there is
  the whole screen): its bounds read, unmaximized, the window set to them as a normal window. The
  area is kept for the run; the next Maximize on that screen sets it at once. Win+Up is held the
  same way; a window that opens maximized is shown first and maximized once WSLg has mapped it
  (fix, below). Restore puts back the place it was asked from; a place as large as the screen
  (WSLg's own maximize saved it) restores to 1440×900, centred. Moved or resized, the window is
  no longer maximized; a passing move (WSLg parks a window it shows at −32736 for 14 ms) is not.
- **Fix: opening maximized** (the person: "I can't click on anything"). A window maximized
  before WSLg maps it, and unmaximized by the hold, restored to the left screen's corner and
  stayed there: Windows showed it at (−32, −32) on the left screen while X11 took it for (2560,
  0) on the right, so every click landed outside it. A move asked there was refused, with or
  without a 1 px size change. Shown first and maximized once mapped (the park and back, then
  50 ms still), it is held on its own screen.

**Results.** Tests first: `frame.test.ts` (red: no module), and 4 app e2e red on the build before
(the overlay gone on Linux, the buttons in the theme's colours, the corners round until maximized
with the window's calls recorded, the start page's frame). `pnpm check` 1,080 tests; e2e 171 of
171. Bitwarden `737ee3f` in Chromium, without and with the frame, alternated (3 rounds): first
paint 278–284 / 278–283 ms, select 73–89 / 72–88 ms, mark reviewed 33–34 ms, pan 63 fps both. On
this machine (WSLg), the real window opened by `symbiote view`, captured from Windows: rounded corners,
the hairline edge, Symbiote's buttons. Not verified: resizing from an edge and maximizing with the
window manager (the person's try), a `symbiote pr` window in the app, macOS and Windows (unchanged
code paths, no machine).

Maximize on WSLg (decision 222): `maximize.test.ts` red first (no module; then a start maximized
restored to the screen's corner, as the real window did), against a fake window manager with
WSLg's measured timings. Before, a test window with Symbiote's options, captured from Windows: its
red edge at x 2592 and y 32, the right and bottom ones off the work area. After, Symbiote's real
window driven by Playwright on this machine, sampled at the right screen's work-area corners:
Symbiote's `#171717` at all four and the taskbar below, for the first Maximize, the second (no round
trip), and a start maximized; Restore back to (2700, 150) each time. Not
verified: a double-click on the title bar and Windows' snap (held as any maximize; not tried),
dragging a held window (it moves at full size, where a native maximized window restores).
