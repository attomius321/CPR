# Journal: N2 — The taskbar's icon says something waits for you

[Index](../JOURNAL.md) · [Plan](../plan/n2-taskbar-waiting.md)

## N2 spike — what reaches the Windows taskbar from WSLg (2026-10-27, branch `feature/desktop-app-waiting-for-you`)

Asked: "Is there a way to make the icon from the desktop bar to warn you that something is
waiting for you?", Linux first. Read: the app (`packages/desktop`), the viewer's title count
(V48, `Shell.tsx`'s `WindowTitle`) and its readers, and WSLg's weston at the commit this machine
runs (`/mnt/wslg/versions.txt`: WSLg 1.0.71, weston `2318fec`), its X11 window manager and its
RDP shell.

**Learned**:
- **WSLg passes a new window icon to Windows**: its window manager re-reads `_NET_WM_ICON` on
  every change and its RDP shell sends it to the taskbar. So a dot drawn on the window's icon
  (`setIcon`) is seen there. WSLg blends its Linux mark over the icon's bottom-right quarter: the
  dot goes top-right.
- **WSLg reads no urgency**: no "urgen", "attention" or "flash" in its window manager, RDP shell
  or RDP backend. Electron's `flashFrame` sets X11's urgency hint, which blinks a task on XFCE,
  KDE and others, and does nothing on WSLg.
- **Electron's `app.setBadgeCount` is Unity's on Linux**: it returns false elsewhere, WSLg included.
- **A minimized window's page reads nothing**: `useWorkspaces` and `useAsks` skip their reads while
  `document.visibilityState` is hidden. The dot would never come to a minimized window.
- **The title counts workspaces only**: Scout or Scribe waiting, an agent's ask and a merge that
  needs the person are marked in the sidenav, not counted. The person asked for all of them.

## N2 — an amber dot on the taskbar icon, a blink while you are elsewhere (2026-10-27, branch `feature/desktop-app-waiting-for-you`)

While anything waits for the person, Symbiote's window carries an amber dot on its icon, and its
taskbar button blinks when more starts waiting while they are in another window, until they come
back. The page counts what waits (`shell/waiting.ts`: workspaces in Waiting for you, merges in
`needs-you`, Scout and Scribe waiting, each agent's ask through `symbiote mcp`) and says it through
the preload's `symbioteApp.waiting`; the title's "(N)" is that count. The main process draws the
dot once from `symbiote.png`'s pixels (`badge.ts`), sets it with `setIcon` and blinks with
`flashFrame`. In the app the page reads on while hidden. Decisions 465–470.

**Learned**:
- **Electron's bitmap is BGRA here, and X11 gets it right**: the dot's centre reads `fff5b32a` in
  the window's `_NET_WM_ICON` (ARGB), the S's black `ff000000` before. `flashFrame(true)` sets
  `WM_HINTS`' urgency bit (flags 256), and focusing the window with `flashFrame(false)` clears it
  (0).
- **xprop stops at 250,000 bytes of a property** unless given `-len`: 62,500 of the icon's 262,146
  numbers. The dot's row is within them; the test asks for all.
- **A helper that drops xprop's last arguments prints every property**: the first test "passed"
  its "not amber" check on the wrong number. Each check of a property now starts with its name.
- **A page hidden for 5 minutes wakes once a minute**: a 5 s timer chain in a hidden window woke
  every 6 s, then from the 5th minute at 305, 365 and 425 s (Electron 44.9, Xvfb, a transparent
  window as an opaque one). A minimized Symbiote's dot would have come up to 60 s late. Chromium's
  `IntensiveWakeUpThrottling` is off in the app now (decision 470): from 5 to 8 minutes it woke
  every 6 s, 30 times.
- **Playwright keeps the app's page visible**: after `BrowserWindow.hide()` the page Playwright
  drove still said `visible`, while a plain Electron script's says `hidden`. Hidden timings are
  measured outside Playwright.
- **Xvfb leaves a lock file here** (`/tmp/.X<n>-lock`), so picking the first number without one
  is safe; stopping it is done by its PID, never `pkill` on a display's name, which can match
  another session's Xvfb (another workspace ran its e2e at the same time).

**Verification**: tests first (`badge.test.ts`, `waiting.test.ts`: red, their modules missing);
`pnpm check` 1,911 tests; `pnpm test:e2e` 304 passed (4.9 min) after `main` was merged in, the
app's, title bar's and intro's specs again with decision 470's switch: 34 passed, 305 passed
(4.7 min) after the second merge of `main`, and after the third (V65) `pnpm check` 1,918 tests
and 309 passed (4.6 min). The run before that one failed one test, a starting
card 72.00003 px high against 72 (`workspaces.spec.ts`, V48), not N2's: 4 of 4 alone, and the
next full run passed. The new e2e, each red first: the page's count said to a stand-in app (stays
1 without the hidden reads); the real app's icon and urgency hint read from X11 with xprop (stays
`ff000000` without `setIcon`); the switch on (empty before it). The dot seen at 512, 48, 32 and 24 px (`nativeImage.resize`).

Not verified: the dot on the Windows taskbar through WSLg by eye; the blink on KDE, XFCE or
GNOME; a Wayland session; Windows and macOS.
