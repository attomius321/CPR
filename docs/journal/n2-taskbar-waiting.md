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
