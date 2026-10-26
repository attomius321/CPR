# Journal: V62 — Settings laid out as the person's mockup

[Index](../JOURNAL.md) · [Plan](../plan/v62-settings-layout.md)

## V62 spike — Settings beside the mockup (2026-10-26, branch `feature/layout-settings`)

Settings on `main` (`e2d0415`) in Chromium, `serveWorkspaces` with the fake Claude Code, at
1440×900, 1700×925 (the mockup's size), 1920×1080 and 2560×1440, from a spec outside the
repository; the mockup's edges and colours read pixel by pixel from the image in the same browser.

**Learned**:
- **V51's column leaves the mockup's room empty**: at 1700×925 the list (240 px) and the page (760)
  stand centred with 206 px of ground at the left and 230 at the right; the mockup's two cards take
  1,373 of the main area's 1,436 px.
- **The mockup's cards run to the bottom**: both end 24 px over the window's bottom, so each card
  scrolls on its own; today the page scrolls as a whole (1,077 px high at 1700×925).
- **The mockup's window has the desktop app's title bar** (45 px): its sidenav starts under it.
  The browser's page has none, so its cards start 45 px higher; the spacing is compared, not the
  y values.
- **Its texts are a generator's**: the state chip reads "symbiote" in lowercase mono, the
  placeholders `(branch)`, and the Feature prompt's lines are cut short. The layout is the brief;
  the words stay Symbiote's where they mean something.
