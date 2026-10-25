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

## V56 — Skills' own rules over the whole main area; Scribe's terminal edge to edge; the Monitor's head (2026-10-25, branch `feature/skills-page-styling`)

Skills drawn with rules of its own (`skills-*`, no `settings-*` class) over the whole main area:
its head as History's, the list a 240 px column at the main area's left edge, the open pane to its
right and bottom edges, no cards. A skill's text as tall as the pane, its checks and other files
beside it from 880 px of pane (a container query), under it below; Scribe's terminal edge to edge
under its head strip. The Monitor's head given History's padding back. Decisions 407–410.

**Learned**:
- **A class borrowed from another page carries that page's variables**: `.settings-bar`'s padding
  is `var(--settings-side)`, set on `.settings` only. Under the Monitor the variable is undefined
  and the padding computes to its initial 0, silently: V51 moved the Monitor's title to the edge.
  Each page names its own head (`skills-bar`, `monitor-bar`) over the shared strip
  (`commits-title`).
- **Field rules are listed by selector** in `ui/controls.css`: renaming `.settings-editor` on
  Skills took the field's edge, focus ring and padding from both text areas until their own
  selectors were added. Grep `controls.css` for a class before renaming it.
- **A text area that fills a grid cell**: `height: 100%` in a `minmax(0, 1fr)` row of a grid
  that is a flex item of the pane; no auto-height effect. The pane's minimum (240 px of work
  area) makes it scroll on a short window rather than squeeze the text.
- **A "?" after wrapping text** sits at the line's end only in inline flow: in a flex line it
  went to the column's right edge once the text wrapped in 280 px.
- **The measurements in the plan held**: 98, 118, 178 and 258 columns, as estimated from 8 px a
  character.

**Verification**: tests first: "uses the whole main area…" and "Scribe's terminal fills the
pane…" in `skills.spec.ts` (red: the list 16 px in, the terminal 89 px from the right edge), and
the Monitor's head in `monitor.spec.ts` (red: 0 px); then green. V51's centred test replaced; the
phone test and Settings' tests unchanged and green. `pnpm check` (1,739 unit tests); `pnpm build`;
the whole e2e suite 264 of 264. Screenshots, dark and light, at five sizes, from a spec outside the
repository (every Skills state, and History, Scout, Settings, the Monitor and Start at 1440); the
table in the plan measured again; text at 3×.

Not verified: a real Claude Code in Scribe's wider terminal (the fake's pane only); a long
SKILL.md (hundreds of lines) beyond the e2e skills; Firefox and Safari. History, Scout, Settings
and Start were looked at, not compared pixel by pixel with `main` (their stylesheets are not
changed but for selectors that match only Skills' elements).

