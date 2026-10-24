# Journal: Fix — Symbiote's window opening maximized on WSLg took no clicks

[Index](../JOURNAL.md)

## Fix — Symbiote's window opening maximized on WSLg took no clicks (2026-10-21, branch `fix/wslg-open-maximized`)

The person, right after N1d's merge: "I can't click on anything form the interface...". Their
window opened maximized (as they had left it) through `symbiote view`, and closed 28 s later.

**Learned**:
- **Playwright's clicks are not the mouse's.** N1d's real-window check clicked Symbiote's buttons
  through the DevTools protocol, which reaches the page whatever Windows shows; the person's
  clicks go through WSLg. Real clicks from Windows (`SendInput`, PowerShell) need the window in
  front first (`SetForegroundWindow` after an Alt press); without it they went to VS Code or
  nowhere, and an `INPUT` struct of 48 bytes (40 on x64) made `SendInput` send nothing.
- **A window maximized before WSLg maps it is stranded.** Unmaximized, it went to the left
  screen's corner, (0, 0), while it had been asked at (2560, 0); the hold's move back was
  refused, with or without a 1 px size change first, and Electron's bounds still read (2560, 0).
  Windows showed it at (−32, −32)–(2592, 1424), X11 took it for the right screen: clicks landed
  outside it. 3 runs in 3 with the work area's size as the place to open at, the person's saved
  state (WSLg's own maximize had saved it); 0 in 1 with 1200×800, where the move also resizes.
- **The launcher's run with the same state was not stranded** (1 run: its clicks landed); not
  explained. N1d's own check opened at 1200×800, where the move also resizes.
- **`show()` does not map at once**: showing first and maximizing right after still mapped the
  window maximized. Maximized after WSLg's park and back (15 and 28 ms after `show`), then 50 ms
  still, it is held on its own screen: 4 runs in 4, as soon as 50 ms after `show`.
- **PowerShell output from inside a callback is lost**: `EnumWindows`' script block printed
  nothing until its lines were collected and printed after it.

**Verification**: `maximize.test.ts`, 14 tests: the fake window manager now maps a window as WSLg
does and strands one maximized before it is mapped (a test shows it); opening maximized through
`maximizeOnceShown` and a place as large as the screen restored to 1440×900 were red first. The
real window through `symbiote view` with the person's state, twice: Windows shows it at (2528, −32)–
(5152, 1424), the right screen's work area; real clicks reached the History list and the sidenav
at their coordinates; Restore put it at (3120, 246), 1440×900, where Windows shows it too. Not
verified: the person's own try.

Merged into main (2026-10-21), no conflicts (`main` had not moved). `main` verified after the
merge: frozen install, `pnpm check` 1,094 tests, build, e2e 170 of 171 (the shell's keys spec,
`shell.spec.ts:117`, its focus lost under load as before N1; 8 of 8 alone).
