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

## V62 — Settings as the person's mockup (2026-10-27, branch `feature/layout-settings`)

The list and the open page are two cards filling the main area to its bottom, 24 px from its
edges and 16 apart, centred past 1,400 px; the head has the page's icon, its title and the
mockup's line; the list has hairlines between groups, no icons and the open entry in the accent;
a page is one card (`SettingsCard`), its name and chip over a hairline, Reset to default at the
right, the prompt's description and the placeholders' on the page, the placeholders round accent
chips in two columns, Cancel and Save changes at the bottom right beside the git note. Decisions
446–450.

**Learned**:
- **A card the window's height hides the list's end**: the 18 entries need ~850 px, the card has
  765 at 1440×900, so Appearance opened from its address was out of sight. Scrolled to now, with
  a `scroll-padding`: without it `scrollIntoView` left the entry flush with the edge and a
  fraction of a pixel cut (Playwright's ratio 0.995).
- **A changed entry's name has its mark in it** ("Fix changed"): a screenshot spec that clicked
  `Fix` exactly waited for two minutes.
- **Moving a description out of a "?" breaks the test of the "?"**: `look.spec.ts` checked the
  tooltip on a prompt's description; it checks the head's About Settings now.
- **The text sizes are easy to lose in a restyle**: the placeholders' words went to 14 px with
  the descriptions' rule and came back to 15 when the screenshots showed it.

**Verification**: tests first (red on `main` for the right reasons: the list 240 px, no Save
changes, Cancel or section headings), then green; `pnpm check` (1,881 tests), `pnpm build`, the
whole `pnpm test:e2e` 288 of 288. Measured at 1440, 1700, 1920 and 2560 (the plan's results).
Screenshots dark and light at six sizes and nine states; letter-spacing 0 on every element; 3×
zoom of the head and the chips.

Not verified: the desktop app's window (its title bar makes the cards 45 px shorter, as in the
mockup: the list scrolls a little more); Firefox and Safari.
