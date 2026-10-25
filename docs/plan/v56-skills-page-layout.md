# V56 — Skills: the page's own, the whole main area

[Index](../PLAN.md) · [Journal](../journal/v56-skills-page-layout.md)

**Status:** ready for review (2026-10-25), on branch `feature/skills-page-styling` (the
workspace's); the plan confirmed by the person ("OK"), with two answers: the cards go, and the
Monitor's head is fixed here. "As built" and results at the end.

**Problem** (asked: "I don't like skills page layout, maybe should be separated stiling from
skills. and be rendered on full page width. The terminal is to small, do not keep everything in
the center. Use the space"). Measured on `main` (`da991b5`) in Chromium, `serveWorkspaces` with
the fake Claude Code, the sidenav 240 px, a skill of eight lines open:

| Window | Main area | Left and right of the column | Scribe's terminal (cols × rows) | The skill's text area |
|---|---|---|---|---|
| 1280×720 | 1040×696 | 16 / 16 px | 91 × 26 | 710 × 201 px |
| 1440×900 | 1200×876 | 88 / 88 | 93 × 36 | 726 × 201 |
| 1920×1080 | 1680×1056 | 328 / 328 | 93 × 46 | 726 × 201 |
| 2560×1440 | 2320×1416 | 648 / 648 | 93 × 66 | 726 × 201 |

- **Skills is Settings' layout** (V41, V51 decision 390): `SkillsPage.tsx` draws with
  `.settings`, `.settings-body`, `.settings-list`, `.settings-editor` and `.settings-card`, so V51's
  centring of Settings centred Skills: a 1,024 px column, 1,296 px of a 2,320 px main area left
  empty at 2560.
- **Scribe's terminal is a 760 px card**: 93 columns from 1440 up, however wide the window.
- **The text area starts at 201 px** and grows with its text to 70 % of the window; the checks
  and the skill's other files are under it, out of view once a skill is long.
- **The Monitor borrows `.settings-bar`** outside `.settings`, where V51's `--settings-side` is
  not defined: its padding computes to 0, and its title "Monitor" touches the sidenav (0 px in;
  History's is 16), its commit chip the window's right edge.

**Goal**: Skills drawn with rules of its own (no `settings-*` class), over the whole main area:
the list a column at its left edge, the open skill, New skill or Scribe to its right and bottom
edges, no cards; Scribe's terminal edge to edge as Scout's and a workspace's are. The Monitor's
head 16 px in, as History's. Unchanged: Settings (V51's centred cards), what is saved and when,
the drafts and the leave guard, Ctrl+S, `?skill=`, `?new` and `?scribe`, the list's groups and
order, the narrow layout (the list, then a page with All skills), the tokens, every other page.

## The page

```
┌ Skills ?  (the head strip, its title 16 px in) ────────────────────────── [+ New skill] ┐
├──────────────┬──────────────────────────────────────────────────────────────────────────┤
│ Agent        │ style  [Committed]                                                       │
│   Scribe     │ .claude/skills/style/SKILL.md · read by Claude Code · committed          │
│ .claude/…    │ ┌───────────────────────────────────────────────┐  Checks                 │
│   review     │ │ ---                                           │  • …                    │
│   style ▌    │ │ name: style                                   │  Its other files        │
│              │ │ … (to the bottom of the window)               │  palette.md             │
│              │ └───────────────────────────────────────────────┘                         │
│              │ 8 lines, about 23 tokens        notice   Delete…  Improve with Scribe [Save] │
└──────────────┴──────────────────────────────────────────────────────────────────────────┘
```

- **Its own rules** (decision 407): `SkillsPage.tsx` uses no `settings-*` class; `SkillsPage.css`
  holds the page's rules, named `skills-*`. Settings is not changed but for the `.added` badge,
  which only Skills used. `styles.css` no longer needs Skills after Settings.
- **The whole main area** (decision 408): the page a column the main area's height (no page
  scroll); its head strip as History's (title 16 px in, New skill 12 px from the right), the
  Codex note and errors under it, 16 px in. Under it a grid: the list (240 px, at the main area's
  left edge, a hairline at its right, its own scroll), then the open pane to the right and bottom
  edges. No cards: the pane is the frame (the person's answer).
- **A skill** (decision 409): its name and chip, where it is, then the text area filling the
  pane's height; the checks and its other files in a 280 px column beside the text where the pane
  is 880 px wide or more (a container query: windows from ~1440 with the sidenav open), under it
  otherwise; the size, the notice and the actions (Delete…, Improve with Scribe, Discard, Save) on
  a line under the text. The text area no longer grows with its text (the auto-height effect
  goes): it is as tall as the pane allows, and scrolls.
- **New skill**: its heading and fields left in the pane, the fields up to 760 px (a form, the
  start page's brief width).
- **Scribe** (decision 410): its head strip (as Scout's) at the pane's top, its terminal to the
  pane's right and bottom edges, no frame; its box (before a conversation) left in the pane.
  Expected: ~98 × 33 at 1280, ~118 × 43 at 1440, ~178 × 53 at 1920, ~258 × 73 at 2560.
- **Narrow** (under 900 px): as today, the list, or the picked pane with All skills.
- **The Monitor's head** (the person's answer): `commits-title monitor-bar`, its own rule for the
  title; the strip's padding History's.

## Verification

1. **e2e first** (red on `main`), in `skills.spec.ts`, replacing V51's "centred" test: at
   1440×900, 1920×1080 and 2560×1440 the list at the main area's left edge, the skill's pane at
   its right edge (±1 px), the head's title 16 px in, the text area within 80 px of the bottom,
   the checks right of the text from 1920; no element of the page with a `settings-` class.
   Scribe's terminal to the main area's right and bottom edges (±1 px), at least the main area
   less the list wide. In `monitor.spec.ts`: the Monitor's title 16 px in. Kept: the phone test,
   Settings' centred tests.
2. **The rest**: `pnpm check` (the tokens' contrast, radii, sizes; the stylesheet's order),
   `pnpm build`, the whole `pnpm test:e2e`.
3. **Screenshots** before and after, dark and light, at 1280×720, 1440×900, 1920×1080, 2560×1440
   and 390×844: a skill with an error, a warning and other files; an unsaved draft; a notice; the
   delete confirm; New skill; Scribe's box and its terminal; the Codex note; text at 3× for uneven
   gaps. History, Scout, Settings, Start and a workspace before and after: unchanged. The table
   above measured again.
4. The graph, the fonts and the layout code are not touched: no Bitwarden timing.

**Risks**

| Risk | Mitigation |
|---|---|
| A 1,700 px text area at 2560: long lines | a SKILL.md's lines are mostly wrapped by their writer (this repository's at 100); the checks' column takes 280 px |
| A short window: the text area squeezed | a minimum height (240 px); under it the pane scrolls |
| The checks beside the text at 1440 leave it ~620 px | ~85 characters a line; under 880 px of pane they go under the text |
| Tests that find Skills by `.settings-*` | `skills.spec.ts` finds the editor by `.skills-editor` and roles; checked in the same commit |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V56 | Skills' own rules over the whole main area; Scribe's terminal edge to edge; the Monitor's head | `SkillsPage.*`, `SettingsPage.css`, `MonitorPage.*`, `styles.css`, `skills.spec.ts`, `monitor.spec.ts` |

**Proposed decisions** (confirmed by the person with the plan):

| # | Question | Decision | Why |
|---|---|---|---|
| 407 | Whose rules draw Skills | **Its own (`skills-*`); no `settings-*` class; Settings keeps V51's** | the person's ask; V51 centred Skills by centring Settings (replaces decision 390) |
| 408 | Where Skills stands in the main area | **All of it: the list at its left edge, the open pane to its right and bottom edges; no cards** | 1,296 px empty at 2560; the person's answer on the cards |
| 409 | A skill's text and its checks | **The text area the pane's height; the checks and files beside it from 880 px of pane, under it below** | the checks stay in view while one types; 201 px at first today |
| 410 | Scribe's terminal | **Edge to edge in the pane, as Scout's and a workspace's** | 93 columns at every width from 1440 today |

**Not in V56 (later)**: a list one can resize (the diff's sidebar's `Resizer`); a monospace
editor for SKILL.md.

## As built (V56)

- **The checks' column has headings**: "Checks" and "Its other files" (`h3`, the list's caption
  style), beside the text or under it; the text's size ("8 lines, about 23 tokens") moved to the
  left of the line of actions, under the text.
- **The checks' "?"** follows the last word ("refuse. ?"): in the 280 px column the line wraps,
  and the flex line put the mark at the column's right edge.
- **The notes under the head** (the Codex note, what Link did, an error) are a strip 16 px in, a
  hairline under it, over the list and the pane.
- **Fields**: the skill's text area and New skill's description had Settings' field rules through
  `.settings-editor textarea`; they are listed by their own selectors in `ui/controls.css` (the
  description keeps growing with its text, the skill's text does not).
- **The Monitor's commit chip** was at the right edge too (0 px): 12 px now, as History's actions.
- **The test at 1280**: there the checks are under the text, so the 80 px from the bottom is the
  checks' column's, not the text's.

**Results.** Measured as the problem was (Chromium, `serveWorkspaces`, sidenav 240 px, a skill of
eight lines open; no Codex note):

| Window | The list | The pane | Right of it | The head's title | Scribe's terminal | The skill's text area |
|---|---|---|---|---|---|---|
| 1280×720 | 0 px from the left | 800 px | 0 px | 16 px in | 98 × 33 (91 × 26) | 768 × 386 px, checks under it (710 × 201) |
| 1440×900 | 0 | 960 | 0 | 16 | 118 × 43 (93 × 36) | 624 × 701, checks beside it (726 × 201) |
| 1920×1080 | 0 | 1,440 | 0 | 16 | 178 × 53 (93 × 46) | 1,104 × 881 (726 × 201) |
| 2560×1440 | 0 | 2,080 | 0 | 16 | 258 × 73 (93 × 66) | 1,744 × 1,241 (726 × 201) |
| 390×844 | the list, then the pane | 390 | 0 | 16 | 47 × 35 (42 × 34) | 358 × 392 (332 × 201) |

The Monitor's title 16 px in (0 before), its commit 12 px from the right (0). e2e: the three new
tests red first (the list 16 px in at 1280, the terminal 89 px short of the right edge at 1440,
the Monitor's title 0 px in), then green; the whole suite 264 of 264 on the first run. `pnpm
check` 1,739 unit tests (the tokens' contrast, radii, sizes; the stylesheet's order). Screenshots,
dark and light, at 1280×720, 1440×900, 1920×1080, 2560×1440 and 390×844: a skill, one with an
error and three warnings, a draft with the delete confirm, New skill with a wrong name, Scribe's
box and its terminal, the Codex note, the phone's list; History, Scout, Settings, the Monitor and
Start at 1440. Letter gaps even at 3×.

