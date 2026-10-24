# Journal: N1 — A native window: Symbiote as a desktop app (Electron)

[Index](../JOURNAL.md) · [Plan](../plan/n1-native-window.md)

## N1 spike — a native window: Tauri's engine against Chromium (2026-10-20, branch `feature/tauri-integration`)

Measured before planning, on this machine (WSL2 on Windows 11, WSLg, Ubuntu 24.04), with a
`symbiote view` of its own on a clone of this repository (`SYMBIOTE_CACHE_DIR` in the session's temp,
`SYMBIOTE_USAGE=off`, `SYMBIOTE_TERMINAL=off`), never the person's servers. The scripts stayed in the
session's temp folder.

**Learned**:
- **Tauri draws with the system's engine**: on Linux WebKitGTK, which Symbiote had never run in. Ubuntu's
  WebKitGTK 2.52.6 (the runtime is installed; a Tauri build also needs its `-dev` packages, with
  sudo) draws History and a 445-symbol diff (`26ac1c6~12..26ac1c6`) as Chromium does: no page
  errors, Geist loaded, the map's 701 nodes and 263 edges.
- **It is slower where Symbiote works hardest.** `j` (next change), from the key to the next paint,
  median of 10: Chromium 33 ms in 3 of 3 rounds (two frames, the measure's floor); WebKitGTK 77 and
  145 ms (the third round did not report), its first step 360–415 ms, its slowest 160–174 ms.
  First paint was alike (diff: 52–84 ms against 57–60 ms). Both rendered in software (Xvfb,
  headless): a desktop with a GPU may narrow the gap; Bitwarden's graphs would widen it.
- **Driving WebKitGTK without root**: its GObject typelibs and pycairo from `apt-get download` and
  `dpkg -x`, with `GI_TYPELIB_PATH`. Playwright's own WebKit needs `libgtk-4-1` and three more
  (sudo): not run.
- **Traps in measuring it**: under Xvfb `Gdk.pixbuf_get_from_window` gives a blank image (5,829
  bytes, with every renderer setting tried); WebKit's own `get_snapshot` shows the page.
  Synthetic wheel events do not pan React Flow: a frame count while "panning" measured nothing
  (the view had not moved); keys do work. WebKitGTK printed EGL and MESA errors here (ZINK found
  no device).
- **Tauri's Chromium**: a CEF runtime exists, incomplete (an open issue of March 2026 asks for
  back, forward and reload). Electron 44.9.2 is current.
- **The server starts in 211–232 ms** (3 runs, to its `Symbiote viewer:` line): a window can show Symbiote
  at once, without a terminal. **Agents outlive it** (decision 95), so closing a window is Ctrl+C.
- **Windows reaches a server in WSL** at `127.0.0.1` in 2.4 ms, `localhost` in 218 ms.
- **`pgrep -f` with the pattern on its own command line** matched this session's shell once
  (exit 144, as CLAUDE.md warns); the person's three servers were untouched (the same PIDs
  after). Match a full path or a unique port.

**Decided with the person**: Electron, not Tauri ("Should we go with Chromium? is it better?",
then "Yes, plan go with Electron"); Symbiote's own title bar, with the OS's buttons on Symbiote's
colour. Plan: PLAN.md, N1.

## N1 — Symbiote's own window: Electron, the launcher, its own title bar (2026-10-20, branch `feature/tauri-integration`)

N1a: `symbiote view` and `symbiote pr` open the viewer in an Electron app (`packages/desktop`) when it is
set up (`pnpm app:setup`), else the browser. N1b: `symbiote app install` puts Symbiote in the desktop's apps;
opened there, the app starts the repository's `symbiote view` itself, and a start page opens
repositories. N1c: Symbiote's own title bar, with the system's buttons on Symbiote's colour.

**Learned**:
- **pnpm adds exclusions on its own.** Electron 44.9.2, out that day, was refused by the
  repository's minimum release age, and `pnpm install` added `minimumReleaseAgeExclude:
  electron@44.9.2` to `pnpm-workspace.yaml` to get past it. Removed; 44.9.0 pinned (decision 203).
  Read the workspace file's diff after adding a dependency.
- **Electron cancels a close in silence.** A page whose `beforeunload` asks keeps the window open
  and nothing is shown: the app must answer `will-prevent-unload` itself (the system's dialog).
- **Playwright and Electron's events.** Keys typed by Playwright (the DevTools protocol) never
  reach `before-input-event`, where the app takes zoom: `webContents.sendInputEvent` does. A page's
  `beforeunload` reaches Playwright too, which, with no listener, dismisses a dialog Electron never
  shows and fails on "No dialog is showing".
- **A sandboxed preload is CommonJS and loads nothing of its own**: one `.cts` file, with
  `import x = require('electron')` (`verbatimModuleSyntax`). Logic it shares with the main process
  (which keys) is duplicated in a few lines rather than bundled.
- **Ask the main process for the screen.** Under Xvfb, `Gdk.pixbuf_get_from_window` gave a white
  image of Electron's window as it did of WebKit's; Electron's `desktopCapturer` gives the screen,
  the system's buttons included (Playwright's screenshots have the page only).
- **The title in the shell's render re-rendered the whole shell** at each read of the workspaces;
  moved to a component of its own. Not the cause of the shell's keys test failing in full runs: it
  fails on `main` too under load (4 of 12 runs at 6 workers; 3 of 12 on the branch) — a card's
  group changes as the fake agent moves on, and the focused card is mounted anew. Not changed
  here: its own `fix/` branch.
- **`app.ts` beside `App.tsx`** would be one file to macOS's file systems in an import of
  `./App.js`: the viewer's side of the app is `desktop.ts`.
- **A launcher reads no shell profile**: node from nvm, and `claude`, `codex`, `code` on the
  `PATH`, are recorded by `symbiote app install` and again by each `symbiote view` that opens the window.

**Verification**: 33 desktop, 16 CLI and 7 viewer unit tests, red before; `pnpm check` 1,047. 16
e2e on the real app under Xvfb (7 from `symbiote view`, 5 from the launcher, 4 of the title bar); the
full suite 154 of 156 (the shell's keys test, failing on `main` too under load; a Codex spec's
lazily loaded chunk lost to its server's stop). From the launcher to History's first paint
383–493 ms (5 runs); on the 445-symbol diff `j` 32–33 ms, Chromium's; memory 771–893 MB summed over
the app's processes. Screenshots of History, a workspace, Settings in light and a diff, with the
system's buttons, taken with `desktopCapturer`. Not verified: macOS, Windows, native Linux window
managers, Ubuntu 24.04's AppArmor on a real install, WSLg's Start menu, a real agent in the app's
terminal, a GPU.

## N1 — the first merge's check, and two races on `main` (2026-10-21, branch `feature/tauri-integration`)

The person approved `5709575`; Symbiote's merger ran the project's check on the merge (`pnpm test:e2e`
among it) and stopped on two specs.

**Learned**:
- **A merge check runs where the person is.** `pnpm test:e2e` ran on the person's desktop, not
  under Xvfb: the app's specs opened their windows there through WSLg, and its window manager moved
  them ("remembers the window" asserted exact bounds). Specs that start windows now start their own
  Xvfb. On WSL, Xvfb finds no display number by itself (`-displayfd` alone: /tmp/.X11-unix is not
  world-writable) and listens on an abstract socket only, so there is no socket file to wait for;
  a fixed number from :99 with `-displayfd`, which it answers when ready, works. A spec that died
  before stopping its Xvfb left it running with its lock file: found the next day, stopped.
- **The Codex spec's failure was a race on `main`**: it stops its first server while the page is
  on it, right after a start opened the new workspace, whose thread loads Markdown's chunk lazily.
  1 run in 36 on `main` and on the branch alike; made certain by holding that chunk back 2 s, it
  gave the merge check's exact error. The page now leaves first.
- **A command's only child is not always the one you started.** Run twice as the merge check
  runs, "symbiote view opens its window" timed out: it took `symbiote view`'s only child for the app, and
  under load that child was a short-lived `git`, caught before Electron started; it was stopped,
  the window stayed. The spec now waits for `symbiote view`'s new line, "Symbiote's window is open: close
  it, or Ctrl+C, to stop", and finds the app by its command line.
- **The shell's keys spec failed under load because of a real bug**: a workspace whose agent moves
  on is drawn anew in another group of the sidenav, and the focus fell to the page; arrows then did
  nothing. The sidenav now follows the card the focus was on, when nothing else took it.

- **The Settings spec raced a frame**: the `{plan}` button places the cursor on the next frame;
  filled before it, the new text went in after `{plan}` instead of replacing the text (4 runs in
  48 at 8 workers on `main`, 3 on the branch). The spec waits for the cursor: 48 of 48.
- **Left as it was**: the usage spec's Codex live read, unexplained since V29c, failed once in four
  full rounds and 1 run in 32 of the spec at 8 workers.

**Verification**: the app's 16 specs with the desktop's `DISPLAY` and `WAYLAND_DISPLAY` set, no
window on the desktop, no Xvfb left; the Codex race forced (an error) and fixed (none), 72 runs at
6 workers before and after; a new spec moving the focused card's workspace to Needs you, red then
green; both shell specs 24 of 24 at 6 workers (the keys spec failed 3 and 4 runs in 12 before, on
the branch and on `main`). The merge check's commands, as Symbiote runs them (install, check, build,
e2e) on this machine: before these fixes 155 and 156 of 157 (the app's own spec timing out in
both, the usage spec once); after the spec found the app by name, 157 of 157, then 156 (the
Settings race, then fixed); with every fix, 157 of 157.

Merged into main (2026-10-21) by Symbiote's merger, from the approved `2e44a6f`, no conflicts (`main`
had not moved since the branch). `main` verified after the next merge (the usage fix, below):
frozen install, 1,054 unit tests, format, lint, typecheck, build, 158 of 158 e2e.
