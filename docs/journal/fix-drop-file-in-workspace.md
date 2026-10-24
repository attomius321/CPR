# Journal: Fix — Attach images beside a workspace's terminal: no drop reaches the window on WSL

[Index](../JOURNAL.md)

## Fix — Attach images beside a workspace's terminal (2026-10-24, branch `fix/drop-file-in-workspace`)

The person: "seems like i can't drop a file in workspace. I run symbiote view from wsl"; asked
on the plan: dragged from Windows Explorer onto Symbiote's window, the "not allowed" cursor, an
image.

**Learned**:
- **WSLg carries no drag and drop between Windows and Linux windows** (microsoft/wslg#84, open
  since 2021). Over Symbiote's window (Electron through WSLg) Windows shows "not allowed" and the
  page never gets a `dragenter`: nothing in the page can take the drop. A file copied in Explorer
  does not cross WSLg's clipboard either (#467). The page's handlers were right: V36's and V40's
  e2e drops pass.
- **Nothing had ever arrived**: this machine's Symbiote cache had no `images` folder (made by a
  terminal's first image, V36) and this repository's state no `uploads` folder (V40's).
- **On WSL a file picker reaches Windows' files** (under `/mnt/c`). Start a workspace had Add
  files (V40); a running workspace's terminal took images only by a drop or a paste.
- **Symbiote's window opens its file dialog through the desktop portal**, not in its own
  process: Chromium uses xdg-desktop-portal when the session bus has one, and WSL's has
  (xdg-desktop-portal-gtk, started with the session). The portal runs with neither `DISPLAY` nor
  `WAYLAND_DISPLAY`, so GTK takes WSLg's default Wayland socket: the dialog is a window of its own
  on the Windows desktop (WSLg's log names it `xdg-desktop-portal-gtk`), and the portal logs
  "Failed to associate portal window with parent window x11:…": it is not tied to Symbiote's
  X11 window. It is drawn there even for an app on another display: run on an Xvfb, the check
  below opened its dialogs on the person's desktop (17:19:38 and 17:19:46), not on the Xvfb. A
  dialog check should keep the app off the session bus (not tried).
- **`main` failed its own `pnpm check` where the branch started** (f6e5408): `monitor/Treemap.tsx`
  beside `treemap.ts` (`files.test.ts`), renamed on `main` meanwhile (14dfbbe). The branch, with
  no commit yet, was fast-forwarded to `main` (e887f49) before the fix was committed.

**Done**: an icon button, Attach images, in the workspace's head while the agent's terminal is
shown (beside Send the verdict, the head's other terminal action; in Symbiote's window the tabs
move to the title bar, the head stays). It opens the system's picker for PNG, JPEG, GIF and WebP,
several at once. What it picks takes the drop's own path: the open terminal's new `attach()`
(`OpenedTerminal`), each image uploaded in order and its path pasted, anything else said ("Only
images can be attached"), the keys given back to the terminal. Scout's terminal and the shells
have no button: a paste and a drop as before.

**Verification**: the e2e test first (`workspaces.spec.ts`, "images chosen with Attach images…"),
red for the right reason: no Attach images button, the click timed out. Green with the fix, as is
V36's test beside it. `pnpm check` 1,543 tests; build; e2e 233 of 233. Screenshots of the
workspace page at 1440×900, 1×, dark and light: the button left of Stop the agent, spaced as the
Changes toggle. In Symbiote's window (Electron 44, `_electron` on an Xvfb), the button's click
asked the portal for a file dialog (its log, and WSLg's, at 17:19:38 and 17:19:46); WSLg's log
shows the person's own window had opened the same dialog three times before (22:41 the day
before, 11:12 and 16:51, the last 38 s before this workspace was started).

Not verified: a drag from Windows Explorer (WSLg has none to give); picking a file by hand in the
dialog on WSLg (the person's to try); a screenshot pasted from Windows on WSLg (WSLg hands Linux
apps clipboard images as BMP, #833, and V36 takes PNG, JPEG, GIF or WebP: not measured); macOS and
Windows.
