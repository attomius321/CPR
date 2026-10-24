# Journal: N1d — Rounded window corners

[Index](../JOURNAL.md) · [Plan](../plan/n1d-rounded-window.md)

## N1d spike — rounded window corners on Linux (2026-10-21, branch `milestone/n1d-rounded-window`)

Asked: "I want the window corner to have some radius..". A 640×400 Electron 44.9 test window per
variant, opened through WSLg and captured from Windows (PowerShell, `GetWindowRect`; only the
window's corners kept, enlarged 3×).

**Learned**:
- **Electron picks X11 here** (XWayland): `WAYLAND_DISPLAY` is set but `XDG_SESSION_TYPE` is not.
  WSLg's window rectangle has a 32 px invisible margin around an X11 window, none around a
  Wayland one.
- **A transparent window rounds**: the page's 10 px radius shows, and inside the corner the pixels
  are the desktop's (12, 12, 12), not black: WSLg composites the window's alpha.
- **A transparent window has no system buttons**: Electron drops the title bar overlay on Linux,
  its colour transparent or opaque, on X11 and Wayland.
- **Wayland is no way out**: the hidden title bar is square there too, with a close button only.

So on Linux Symbiote draws the frame and the buttons itself (decision 218).

## N1d — rounded window corners on Linux (2026-10-21, branch `milestone/n1d-rounded-window`)

On Linux Symbiote's window is transparent and its pages draw it: a 10 px radius with a hairline edge,
square while maximized or full screen, and Symbiote's own minimize, maximize/restore and close. macOS
and Windows keep their own corners and buttons.

**Learned**:
- **`setTitleBarOverlay` throws on a window without an overlay**, in the main process, and
  Electron's error dialog then blocks the app: every app e2e passed its body and hung in its
  teardown. Found by screenshotting the e2e display (ffmpeg's `x11grab`), not by the test's log.
- **A rounded clip over the page costs**: `overflow: hidden` with a radius on the root took select
  on Bitwarden's graph from 73–74 to 88–89 ms (3 rounds alternated). Rounding the strips at the
  corners instead costs nothing measurable.
- **A shell-less page is a title bar too**: `symbiote pr` in the app would have had no buttons.
- **A bisect in `dist/` survives `tsc -b`**: an emitted file edited by hand is not re-emitted
  while its source is unchanged; restore it from a copy.

**Verification**: tests first (`frame.test.ts`; 4 app e2e red before); `pnpm check` 1,080 tests;
e2e 171 of 171. Bitwarden `737ee3f` without and with the frame: first paint 278–284 / 278–283 ms,
select 73–89 / 72–88 ms, pan 63 fps both. On this machine the real window, opened by `symbiote view`
with a fresh app config and captured from Windows: rounded, the edge, Symbiote's buttons. Not verified:
resizing from an edge, maximizing through the window manager, `symbiote pr` in the app, macOS and
Windows.

## N1d — a maximized window on WSLg, held by Symbiote (2026-10-21, branch `milestone/n1d-rounded-window`)

The person's try of N1d: "The full screen is not working properly from wsl". Maximized, Symbiote's
window was 32 px right and down of the work area: the desktop showed in the strip above and left,
and the right end, with the window's buttons, and the bottom went off it, under the taskbar.

**Learned**:
- **WSLg forgets its own margin when it maximizes.** It pads a frameless X11 window with the
  invisible 32 px margin the spike saw; maximized, the window's X11 bounds are the work area,
  (2560, 0) 2560×1392, but on the screen it starts at (2592, 32). Transparent or opaque alike, so
  N1c's window had it too; full screen and a window with the system's frame are right. Known
  upstream, not fixed (microsoft/wslg#1015, #530).
- **Electron does not know the taskbar there**: its work area on WSLg's X11 is the whole screen
  (1440 high). The window manager knows it (1392): the first maximize on a screen goes through
  it, and the bounds it gives are the area to hold the window to.
- **WSLg's Wayland maximizes right but places nothing**: a window asked at (2700, 150) on the
  right screen opened at (249, 253) on the left one. Remembering the window's place would go.
- **A size asked of a maximized window is ignored, and an unmaximize lands 15–60 ms after it is
  asked**: setting the bounds right after `unmaximize()`, or 50 ms after it, was undone by it.
  The hold waits for the `unmaximize` event and the bounds to be still for 50 ms.
- **A window mapped maximized restores to the screen's corner**: Symbiote opening maximized came
  back, on Restore, at (2560, 0) instead of (2700, 150). The hold keeps the place it was asked
  from.
- **WSLg parks a window off the screen as it shows it** (at −32736 for 14 ms); minimize and
  restore send no event at all. A held window lets go only when its bounds stay off the area.
- **Playwright drives the real app on the person's desktop**, and PowerShell samples the screen
  from Windows: the check of a window manager's behaviour that the e2e's Xvfb (no window
  manager) cannot give.

**Verification**: `maximize.test.ts`, 12 tests on a fake window manager with WSLg's measured
timings, red first (no module; then the start maximized restored to the screen's corner). The
real window on this machine, sampled from Windows at the right screen's work-area corners: Symbiote's
`#171717` at all four and the taskbar below, for the first Maximize, the second (the area known,
no round trip), and a start maximized; Restore back to (2700, 150) each time. Not verified: a
double-click on the title bar and Windows' snap (held as any maximize), dragging a held window
(it moves at full size; a native maximized window restores as it is dragged).

Merged into main (2026-10-21) from branch `milestone/n1d-rounded-window`, no conflicts (`main` had
not moved since the branch): frozen install, `pnpm check` 1,092 tests, build; e2e 169 then 170 of
171 in two full runs on `main`, a different spec each time (`changes.spec.ts:94` and
`shell.spec.ts:160`, then `open-pr.spec.ts:48`), each a key press lost under load, each passing
alone (16 of 16, 8 of 8). Not N1d's: its viewer changes apply only in the app, and these specs run
in the browser.
