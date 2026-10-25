# Journal: V56 — Skills: the page's own, the whole main area

[Index](../JOURNAL.md) · [Plan](../plan/v56-skills-page-layout.md)

## V56 spike — Skills' width, Scribe's terminal (2026-10-25, branch `feature/skills-page-styling`)

Skills on `main` (`da991b5`) in Chromium, `serveWorkspaces` with the fake Claude Code, at
1280×720, 1440×900, 1920×1080, 2560×1440 and 390×844, dark and light, from a spec outside the
repository: the main area's, the list's, the editor's and the text area's boxes, Scribe's terminal
in columns (its screen's width over xterm's measured character) and rows; the Monitor's title.

**Learned**:
- **Skills is centred because Settings is**: it draws with Settings' classes (V41), and V51
  centred them (decision 390): 1,024 px wide at every width, 648 px empty each side at 2560.
- **Scribe's terminal stops at 93 columns**: 744 px of screen in a 760 px card from 1440 up; 91
  at 1280. Rows follow the window (26–66).
- **The text area is 201 px at first** (seven rows), whatever the window; it grows with its text.
- **The Monitor's head lost its padding in V51**: it borrows `.settings-bar`, whose padding is
  `var(--settings-side)`, defined only on `.settings`; undefined, the padding computes to 0. Its
  title is at the main area's left edge (0 px in), its commit chip at the right edge.
- **Free numbers**: V54 and V55 are taken on `feature/tooltips-revamp` and
  `feature/done-workspace`; decisions go up to 406 on every branch.
