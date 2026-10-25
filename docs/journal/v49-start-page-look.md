# Journal: V49 — Start a workspace: a centred page in two cards

[Index](../JOURNAL.md) · [Plan](../plan/v49-start-page-look.md)

## V49 spike — the start page's empty space (2026-10-25, branch `feature/improve-start-workspace-ui`)

The start page on `main` (`94e1feb`) in Chromium, `serveWorkspaces` with the fake Claude Code, at
1280×720, 1440×900, 1920×1080 and 2560×1440, dark and light, measured with a spec outside the
repository (the union of the brief's and the run's children against the main area).

**Learned**:
- **The form never grows**: 1092×524 px at every width from 1440, pinned to the top left. It uses
  78 % of the body at 1280×720, 57 % at 1440×900, 34 % at 1920×1080, 18 % at 2560×1440; the
  person's 2167×1323 main area is between the last two.
- **No room left at 1440×900 with More open**: the brief is 790 px of the body's 832 (16 px
  padding above, 24 below). Cards with padding need that room back: the optional parts at 2 rows
  instead of 3 give 61 px.
- **The run is the taller column** (524 px against the brief's 440 with More closed): eight names
  over full-width fields. As rows, name left, it is about 330 px.
- **The effort stepper needs ~280 px**: at 220 px (a row's control beside a 104 px name) the
  stops are 41 px apart and "Default" (44 px, left-aligned) runs into "low".
- **Agent launchers** (Claude Code on the web, GitHub Copilot's Agents panel) centre one box for
  the task with the run's choices attached and one Start; the plan follows their centring and
  grouping, and keeps the stepper and the head's Start.
