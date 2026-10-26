# Journal: Fix — the app shows a page as a browser does, under its title bar

[Index](../JOURNAL.md)

## Fix — the app shows a page as a browser does, under its title bar (2026-10-27, branch `fix/title-bar-desktop`)

The person: "The title bar of desktop app does not match the one from browser, in workspace";
asked on the plan whether History should follow: "Both app should look as the same as it can
get."

**Measured before** (a started workspace on e2e's harness, 1440 × 900, the real app under Xvfb
beside Chromium, dark and light):

- The title bar's left part was 371–380 px wide over a 264 px sidenav: its divider stood
  107–116 px right of the sidenav's border. `.titlebar-side` was `flex: none` with only a
  `min-width`, so its content set its width and the repository's name was never cut.
- Its brand row was a copy of the sidenav's with rules of its own: a 20 px mark, the name at
  15 px, the fold a plain 28 px button. V61 restyled the sidenav's (32 px mark, 17 px, a raised
  32 px square) and not the copy.
- A workspace's tabs moved into the bar (N1c's `InTitleBar`). Since V61 they are its card's
  strip of 40 px line tabs: in the 38 px bar the strip was 48 px high from y = −5.5, the tabs
  cut by the window's top edge (−1.5 to 38.5), and the card below began with the terminal. The
  changes' toggle went to the bar's end, away from Stop the agent. History's branches switch
  left its rows card the same way.

**The fix**: the bar holds what a browser keeps in its own bar — Back, Forward, the window's
title (read from `document.title`, as the taskbar shows it) — and the window's buttons; the page
under it is the browser's. `InTitleBar` and its slots are gone: a workspace's tabs, its changes'
toggle and History's branches stay in their cards. The sidenav's brand row, the narrow strip
that opens the drawer, and a diff's own name in its bar are no longer hidden in the app. Under
900 px the drawer and its scrim open under the bar, so its buttons and the strip that moves the
window stay in reach. The viewer's source and CSS: 244 lines out, 64 in (re-indenting aside).

**Learned**:
- **A second copy of a page's parts drifts**: the title bar's brand and its moved tabs were
  restyled by hand in N1c, and V61's restyle of the cards and the sidenav never reached them. One
  rule now (the viewer's `CLAUDE.md`): in the app, the page is the browser's; only what covers
  the whole window starts under the bar.
- **The app is testable without Electron**: index.html reads `window.symbioteApp` before the
  first paint, so a fake one from `addInitScript` gives Chromium the app's `data-app`, frame and
  title bar. `title-bar.spec.ts` opens each page twice, as a browser (1440 × 900) and as the app
  (1440 × 938), and asks every landmark to be drawn at the same place 38 px lower.

**Verification**: `title-bar.spec.ts`, 5 tests, all 5 red on `main` (the brand row and the fold
missing in the app, the tabs at y = −1 in the bar, Changes at 1308 × 5 instead of 1366 × 50,
History's switch in the bar, no narrow strip, a diff's name hidden), green after: a workspace
with a shell open, History, Scout, Skills, Monitor, Settings, Start a workspace, a diff's Files
page, and History at 800 px with the drawer. `app.spec.ts`'s two title-bar tests follow the new
place of the tabs, the fold and History's switch: 19 of 19 on the real app under Xvfb.
`pnpm check` 1,881 of 1,881; `pnpm build`; `pnpm test:e2e` 293 of 293. Screenshots of every
page in the real app and in Chromium, dark and light, at 1440 × 900 (the app 38 px taller),
folded and at 899 px with the drawer open: under the bar the two are the same.

Not verified: Windows and macOS (the system's buttons over the bar's end, macOS's 78 px at its
left), where the bar's left now holds only Back and Forward.
