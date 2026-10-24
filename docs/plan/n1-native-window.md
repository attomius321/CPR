# N1 — A native window: Symbiote as a desktop app (Electron)

[Index](../PLAN.md) · [Journal](../journal/n1-native-window.md)

**Status:** N1a, N1b and N1c merged into main (2026-10-21, from branch
`feature/tauri-integration`, a workspace started in Symbiote). The engine, the title bar and the plan's
recommendations OK'd by the person (2026-10-20); 201–204 made while building. Their "As built"
and results below.

**Problem** (asked: "I want it to feel more like a native application. Not something you open in
a browser. Check tauri", done when "You can open the app with a feel of native"; then "It should
also work on native linux … not only on this machine"; on the engine, "Should we go with
Chromium? is it better?", then "Yes, plan go with Electron. Also, can we edit that window topbar?
to make it more stylish?", with a screenshot of a reference's title bar). Measured on this machine (WSL2
on Windows 11 with WSLg, Ubuntu 24.04):

| What | Today |
|---|---|
| How Symbiote opens | `symbiote view` serves `127.0.0.1:<any port>` and runs `xdg-open` (`open` on macOS): a tab among the browser's others, with its tabs, address bar and menus. The person runs `--no-open` (three servers running) and opens the address in a Windows browser |
| Without a terminal | No way: Symbiote is a command run in a repository |
| The server's start | 211, 232 and 232 ms from `symbiote view --no-open` to its `Symbiote viewer:` line (a clone of this repository) |
| What Ctrl+C stops | The server and the analyses in progress (V9). Agents are `claude --bg` sessions or Codex's daemon and outlive it (decision 95, V27) |
| Windows reaching WSL | `127.0.0.1:<port>` 2.4 ms, `localhost:<port>` 218 ms (`curl.exe` from Windows) |

The engine (Tauri was asked to be checked):

| | Tauri 2.12 | Electron 44.9 |
|---|---|---|
| Engine | The system's: WebKitGTK (Linux), WebView2 = Chromium (Windows), WKWebView (macOS) | Chromium, bundled, the same on every OS |
| Chromium on Linux | A CEF runtime, incomplete (an open issue of March 2026 asks for back, forward and reload) | — |
| Size | ~10 MB | ~100 MB download (published figures, not measured) |
| Around Symbiote's Node server | Rust | Node |
| To build here | Rust ✓; `libwebkit2gtk-4.1-dev` and five more packages, with sudo | npm only |
| Tests of the real app | `tauri-driver` with WebKitWebDriver | Playwright's `_electron`, with e2e's fixtures |

Symbiote in WebKitGTK 2.52.6 (Ubuntu's, what a Tauri build here uses; under Xvfb, software rendering)
and in Playwright's Chromium (headless), at 1440×900, on a 445-symbol diff of this repository
(`26ac1c6~12..26ac1c6`, 103 files) served by `symbiote view`:

| | Chromium | WebKitGTK |
|---|---|---|
| History, first contentful paint | 48 ms (V29a's measure) | 214 ms (one run) |
| The diff, first contentful paint | 52, 60, 84 ms | 57, 59, 60 ms |
| `j` (next change), key to next paint, median of 10 | 33, 33, 33 ms (two frames: the measure's floor) | 77, 145 ms (2 of 3 rounds reported) |
| … the first `j` | 30–32 ms | 360–415 ms |
| … the slowest | 34 ms | 160–174 ms |
| Page errors | 0 | 0 |

Both draw Symbiote alike (History, the diff's map). What causes the problem:
- Symbiote's viewer is a page served by a command: it has no window of its own.
- Every speed measure since V6, and every e2e test, is Chromium's.

**Goal**: Symbiote opens as an application, from the desktop's launcher (no terminal) or from
`symbiote view`: a window of its own, with its icon, its taskbar entry and Symbiote's own title bar; no
tabs, no address bar. Closing the window closes Symbiote. On Linux, verified here and
through WSLg; macOS runs the same code (not verified: no Mac). **Unchanged**: the server and its
API, every page in a browser (`--browser`, `symbiote pr` in CI, `?graph=`), graph JSON, `symbiote diff`.

## The app (`packages/desktop`, Electron)

- `@symbiote/desktop`: Electron's main process in TypeScript (`src/main.ts`), a sandboxed preload
  (`src/preload.cts`), a start page (`start/`) and the icon. No Node in the page
  (`contextIsolation`, `sandbox`, no `nodeIntegration`).
- **A window on a server.** `--url <address>` opens a window on it (what `symbiote view` does). With
  no address the app starts the server itself (`node …/bin.js view --no-open` in the repository)
  and reads the address from its `Symbiote viewer: <url>` line, which a CLI test pins. The server stays
  a child on the person's Node, not inside Electron: node-pty would need Electron's ABI, and
  `symbiote view` stays one program.
- **One window per repository**, each with its own server. Launched again, the app brings that
  window to the front (single instance); another repository opens another window.
- **Closing the window stops its server**, as Ctrl+C does. A server the app started also stops
  when the app dies: it ends when its stdin closes.
- **What stays in the window**: the server's own address. Any other link (`target=_blank`, a
  navigation, `window.open`) opens in the default browser (`shell.openExternal`, http and https
  only).
- **Keys and mouse**: Ctrl/⌘ + = − 0 zoom (kept), Ctrl+R and F5 reload, Alt+←/→ and the mouse's
  back and forward buttons, Ctrl+Shift+I the inspector. A right click gives Cut, Copy, Paste and
  Select all on text, nothing elsewhere.
- **Remembered**: the window's size, place and maximized state, and the page's own choices
  (theme, folded sidenav, the changes panel). Each run's port is a new origin with empty storage:
  the preload puts the choices back before the page's scripts run and keeps them on `pagehide`.
- **The title** is the page's `document.title`, which the viewer sets per page (History and the
  repository, a workspace's title, a diff's pair): in the taskbar and Alt+Tab.

## The CLI (`packages/cli`)

- `symbiote view` and `symbiote pr` open the app when it is set up (Electron's binary present), otherwise
  the browser as today. `--browser` opens a tab; `--no-open` as today. With the app, closing its
  window ends the command.
- `symbiote app install` adds a launcher entry for this user, without root (Linux:
  `~/.local/share/applications/symbiote.desktop`, the icon under `~/.local/share/icons/hicolor/`). It
  records the node, the CLI and the shell's `PATH` in `$XDG_CONFIG_HOME/symbiote/app.json`: a launcher
  does not read `.bashrc`, where nvm puts node, and the server finds `git`, `claude`, `codex` and
  `code` on the `PATH`. Each `symbiote view` that opens the app records them again. `symbiote app
  uninstall` removes them. On macOS and Windows it says it is not supported yet.
- `pnpm app:setup` downloads Electron's binary (`allowBuilds: electron: false`): `pnpm install`
  does not fetch ~100 MB for CI and contributors.

## The title bar (viewer, in the app only)

After the person's screenshot: one 38 px row across the window in the sidenav's colour,
cut along the window's columns, with no title text.

- **Over the sidenav**: on macOS the window's own buttons (its traffic lights), then Symbiote's mark
  and the repository (moved up from the sidenav's brand row), the fold button (`[`), and ← →
  (back and forward, off when there is nowhere to go).
- **Over the main area**: the page's tabs, moved up into the row (a workspace's Terminal · Thread
  · Brief, History's All branches · This branch), otherwise the page's name. Free space drags the
  window; a double click maximizes it.
- **At the right**, on Windows and Linux: the OS's own window buttons (Electron's
  `titleBarOverlay`) on Symbiote's colour, which follows the theme (`setTitleBarOverlay`). The page
  keeps clear of them (`env(titlebar-area-width)`).
- **A diff page**: its bar becomes the row, with the same room for the buttons.
- **In a browser nothing changes**: the row shows only where the preload marks the page
  (`<html data-app>`).
- `window.confirm` (Settings' unsaved prompts, headed "127.0.0.1:<port> says") becomes Symbiote's
  own dialog, in a browser too.

## Verification

1. **Tests first** (red before). Desktop: which addresses stay in the window, the ready line, the
   arguments, the remembered state read back safely, the launcher entry's text. CLI: app,
   browser, `--browser`, `--no-open`; the window's exit ends the command; `symbiote app
   install`/`uninstall` in a temporary home; the server ending with its stdin. Viewer: the
   titles, the dialog.
2. **The real app** (`packages/desktop/e2e`, Playwright's `_electron`, under Xvfb): History, a
   workspace with the fake agent (typing reaches its terminal), a diff, a link to elsewhere not
   opening in the window, back and forward, zoom, the title bar's parts and buttons, the buttons'
   colour with the theme, closing stops the server; screenshots.
3. **Nothing else changes**: every e2e test as today (the browser), `pnpm check`, build. No
   analysis code changes: no regression-check.
4. **Speed**: first paint and `j` in the app against Chromium's (the same engine: expected equal);
   from the launcher to the first paint, under 1 s.
5. **The person's machine**: launched from the Windows Start menu through WSLg (to verify: that
   WSLg lists `~/.local/share/applications`), screenshots; the person's try is the done-when.

**Risks**

| Risk | Mitigation |
|---|---|
| Size and memory: Chromium is bundled | A dev tool run from a checkout; the binary only with `pnpm app:setup` |
| Chromium's security fixes come with Electron's releases | The window shows only Symbiote's own address, others go to the browser; no Node in the page; Electron pinned and updated as a dependency |
| WSLg draws Linux windows: frame, fonts and scaling differ from Windows apps | The title bar is Symbiote's own; a Windows build (N2) if WSLg is not enough |
| On Linux the OS's buttons keep their desktop's symbol colour (`symbolColor` is Windows only) | Their background takes Symbiote's colour; checked in screenshots |
| A server started from the launcher lacks the person's environment | The recorded `PATH`; the start page shows the server's error (no node, not a repository) |

**Order**: N1a, the window from `symbiote view` (the core, reviewable alone); N1b, the launcher; N1c,
the title bar and the dialog.

## Milestones

| # | Milestone | Output |
|---|---|---|
| N1a | The window | `@symbiote/desktop`; `symbiote view` and `symbiote pr` open it, `--browser`; closing stops the server; links, keys, zoom, the remembered window and choices, titles |
| N1b | From the launcher | The app starts the server; a start page (open a repository, recent ones); `symbiote app install`/`uninstall`; the recorded environment |
| N1c | The title bar | Symbiote's own row in the app; the OS's buttons on Symbiote's colour; Symbiote's own confirm |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 190 | The engine | **Chromium, through Electron** (confirmed: "Yes, plan go with Electron") | On a 445-symbol diff `j` takes 33 ms in Chromium, 77–145 ms in WebKitGTK (its first 360–415 ms); every speed measure since V6 and every e2e test is Chromium's; Symbiote is Node: no Rust and no sudo to build, Playwright drives the app. Tauri's own Chromium runtime is incomplete |
| 191 | What the app is | **A window on `symbiote view`'s server, which stays a child on the person's Node** | The server and its API unchanged; inside Electron node-pty would need Electron's ABI |
| 192 | What `symbiote view` opens | **The app when it is set up; `--browser` for a tab** (OK'd with the plan) | "Not something you open in a browser" |
| 193 | Closing the window | **Stops its server, as Ctrl+C** (OK'd with the plan) | Agents outlive the server (decision 95); a tray icon is hidden on GNOME without an extension |
| 194 | The title bar | **Symbiote's own row: the sidenav's part (mark, repository, fold, back and forward), the page's tabs, the OS's buttons on Symbiote's colour** (confirmed: "Unified strip", the screenshot, "the OS's, in our colours") | The OS's buttons keep Windows 11's snap layouts and each desktop's behaviour |
| 195 | A Windows build | **Later (N2), after the person tries the WSLg window** (OK'd with the plan) | One Linux build serves Linux and this machine; Electron has Windows binaries, no cross-compiling, when one is wanted |
| 196 | Electron's binary | **Fetched by `pnpm app:setup`, not by `pnpm install`** | ~100 MB for every install and CI run otherwise |
| 197 | A launcher's environment | **Node, the CLI and `PATH` recorded by `symbiote app install`, again by each `symbiote view` that opens the app** | Launchers do not read `.bashrc` (nvm); the server finds the agents on the `PATH` |
| 198 | Windows and repositories | **One window per repository, with its own server; launched again, it comes to the front** | A server serves one repository |
| 199 | The page's choices across runs | **Kept by the app, put back before the page's scripts run** | Each run's port is a new origin: the theme and the folded sidenav would reset at every start |
| 200 | In a browser | **Unchanged, but for the titles and Symbiote's own confirm** | `symbiote pr` in CI, `--browser`, `?graph=` |
| 201 | Processes (made in N1a) | **Each `symbiote view` its own app process, with a profile of its own; the launcher's one process, single instance** | The process ties the window to its command: closing one ends the other, Ctrl+C reaches both, with no protocol between them. Two processes on one Chromium profile would fight over its storage |
| 202 | Keys (N1a) | **Zoom and the inspector taken by the app before the page; back, forward and reload only where the page leaves them** | The agent's terminal needs Ctrl+R (a shell's search) and Alt+arrows; it stops them first |
| 203 | Electron's version (N1a) | **44.9.0, not the newest 44.9.2** | 44.9.2 was out that day: the repository's minimum release age refused it, and `pnpm install` added an exclusion of its own, removed. 44.9.0 is 3 days old |
| 204 | The workspace's tabs (N1c) | **Moved up into the title bar, the head strip under it kept** | The reference's tabs live in its title bar; the head strip holds the state and the actions (Stop, Merge, Review), which have no place there |

**Not in N1 (later)**: a Windows build (N2); the server inside Electron (one process); updates and
packages (`.deb`, `.AppImage`, `.dmg`); a tray icon; a command search in the title bar.

## As built (N1)

- **Processes** (decision 201): `symbiote view` starts the app with `--url` and waits for its
  `Symbiote window: <url>` line, then says "Symbiote's window is open: close it, or Ctrl+C, to stop"; the
  window's end ends the command, Ctrl+C reaches both. Each such app
  has a Chromium profile of its own (`~/.config/symbiote/app/run/<pid>`, removed at a later start).
  The launcher's app is one process with one profile (`app/launcher`) and a single-instance lock.
- **What lasts** is `~/.config/symbiote/app/state.json`: the window's place, the zoom, the viewer's five
  choices (`symbiote.viewer.theme`, `.sidenav`, `.sidenav.diff`, `.changes`, `.widths`; nothing else),
  the recent repositories. The preload gives the choices back before the page's scripts run (a
  synchronous message) and keeps them on `pagehide`.
- **A window that does not open** sends `symbiote view` to the browser with the app's own words: its
  `symbiote app:` line ("could not load …"), or Chromium's sandbox refused ("No usable sandbox", the
  AppArmor of Ubuntu 23.10 and later), never Chromium's other noise.
- **Keys** (decision 202): Playwright's keys (the DevTools protocol) never reach Electron's
  `before-input-event`; the specs press the app's keys with `webContents.sendInputEvent`, as the
  system would.
- **The launcher's server** reads its stdin (`SYMBIOTE_STDIN_STOPS=1`): a killed app closes the pipe
  and the server stops (measured: gone within the poll after `SIGKILL`). It is started with the
  recorded node, CLI and `PATH`; its address read from the same `Symbiote viewer:` line.
- **The start page** is a file of the app (`packages/desktop/start/`), in the viewer's tokens and
  Geist (`@fontsource-variable/geist` 5.3.0, the viewer's version, now the app's too). It may ask
  the app four things (`symbioteStart`: recent, forget, open, choose); Symbiote's pages get none of them,
  and only `symbioteApp` (the system, the title bar's colours).
- **The title bar**: the page is marked `data-app` by index.html's own script, from what the preload
  exposes, so before the first paint. Pages put their parts in it with a portal (`InTitleBar`):
  a workspace's tabs and its changes' toggle (decision 204), History's scopes; in a browser the
  same parts render where they were. A diff keeps its own bar under the row, its name hidden;
  `symbiote pr`'s page, with no shell, makes its bar the row. Below 900 px the row's fold button opens
  the sidenav's drawer.
- **Leaving with a prompt not saved**: Electron keeps a window open, saying nothing, when the
  page's `beforeunload` asks; the app answers `will-prevent-unload` with the system's dialog
  (Leave · Stay). Playwright hears that `beforeunload` too, and without a listener of its own
  tries to dismiss a dialog Electron never shows (a protocol error). In the shell, Symbiote's dialog
  (`role=alertdialog`) replaces `window.confirm`; the guard is a question and what is at stake.
- **Titles**: `History · ky — Symbiote`, a workspace by its title, a diff by its request, the branch it
  reviews or its pair. The title moved from the shell's render to a component of its own: a new
  read of the workspaces rendered the whole shell.
- **The app's specs on a display of their own** (after the first merge's check failed): they start
  Xvfb on the first free number from :99, ready when it writes that number back (`-displayfd`),
  and skip without it. Run as Symbiote's merge check runs `pnpm test:e2e`, on the person's desktop,
  their windows had opened there through WSLg, where a window manager moved them.
- **CI**: the e2e job runs `pnpm app:setup` and lifts Ubuntu 24.04's AppArmor restriction for the
  run; the specs bring their own display. Its runs on the pushed branch were not read from here
  (a private repository, no `gh`).
- **Not as planned**: none of the plan's parts was dropped. `symbiote app install` warns, as planned,
  where AppArmor refuses the sandbox; the plan's "launched again, the window comes to the front"
  holds for the launcher only (decision 201).

**Results (N1).** Tests first, red before: 33 desktop unit tests (the addresses that stay, the
arguments, keys, the right click's menu, state read back safely, placement on screens, the ready
line, recent repositories, the recorded environment, starting `symbiote view` against fake CLIs), 16
CLI (app or browser, `--browser`, `--no-open`, the window's end, Ctrl+C closing it, the app's own
words, the sandbox's; the Desktop Entry's quoting; install, uninstall, recording again; `symbiote app`'s
usage), 7 viewer (titles, the page's mark). `pnpm check` 1,047 unit tests (989 before). e2e: 16 on
the real app under Xvfb — 7 from `symbiote view` (the window, links to the browser, keys, what lasts
across two servers, closing, a dead server, `symbiote view` itself opening the app and ending with it),
5 from the launcher (the last repository, the server stopped with the window and with a killed app,
the start page refusing a folder then opening a repository, a second launch, nothing recorded), 4
of the title bar; the full suite 154 of 156: the shell's keys test fails under load on `main` too
(4 of 12 runs at 6 workers on `main`, 3 of 12 on the branch), and a Codex spec lost a lazily loaded
chunk to its server's stop. Measured under Xvfb on this machine (Electron 44.9.0, Chromium 152):

| What | Result |
|---|---|
| From the launcher (no window yet) to History's first paint, its server started by the app | 383, 393, 400, 422, 493 ms |
| The 445-symbol diff in the app: first paint | 100, 112, 124 ms (Chromium headless, spike: 52–84 ms) |
| … `j`, key to next paint, median of 10 | 32, 33, 33 ms: Chromium's (33), as expected of the same engine |
| The app's memory, the sum of its processes' resident sets (shared pages counted in each) | History with its server: 771–779 MB; the diff without its server: 846–893 MB |
| Electron's binary | 284 MB unpacked, fetched in 29 s here |

Not verified: macOS (no Mac: the traffic lights' place, ⌘ keys, the menu); a Windows build (N2);
native Linux desktops (GNOME, KDE) and their window managers (a double click on the row to
maximize, snapping; Xvfb has no window manager); Ubuntu 24.04's AppArmor on a real install (this
WSL kernel has no such restriction: the message is tested with Chromium's words, not with the
refusal itself); whether WSLg lists `symbiote app install`'s entry in the Windows Start menu; a real
Claude Code or Codex in the app's terminal (the fake agent only); a GPU (software rendering
throughout).
