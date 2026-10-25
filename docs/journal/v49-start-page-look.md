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

## V49 — the centred page, its cards and its rows (2026-10-25, branch `feature/improve-start-workspace-ui`)

The start page centred in the main area, its head's title and buttons laid out in the cards'
width; the brief and the run as cards; the run's choices as rows, name left and control right,
the stepper and the documents under their names; Plan first a switch; the optional parts at 2
rows and the goal at 12 on a tall window, the cards lower there. Decisions 378–382.

**Learned**:
- **The head and the body line up by arithmetic, not by a shared box**: the head's padding is
  `max(16px, (100% − 1164px) / 2)` (760 in one column), which equals where the body's centred grid
  starts while the body does not scroll. A scrolling body would shift the cards by half its
  scrollbar; at the sizes measured nothing scrolls.
- **A switch drawn on the checkbox needs its own `:checked`**: `input[type][role='switch']` weighs
  what `input[type]:checked` does, and the later rule (the off track) won, so on looked off: a
  pale track in light, a navy one in dark.
- **Bare text in a wrapping `<label>` cannot be a row's name**: it can be neither styled apart
  from the select nor found by `getByText` (the label's text includes the options). Start from
  and Permission became `<label htmlFor>` + `id`, as Model was.
- **The draft is saved 400 ms after a change**: a test that reloads to check the draft waits for
  the `POST /api/workspaces/draft` first.
- **The fake agent's refusal does not refuse the start**: with `distrust()` the workspace is made
  and opened ("Not started: Workspace not trusted"); the words under the head show only for a
  failed `POST /api/workspaces`. Their screenshot faked one with a route.
- **The area used hardly changes at 2560 (18 → 21 %)**: the brief stays at 760 px to keep its
  lines readable. The room is now around the cards, the same on both sides.

**Verification**: tests first: in `start.spec.ts`, "centred in a wide main area, the head over
the cards; the run as rows" (red: a 16 px margin on the left) and "Plan first is a switch" (red:
no switch); then 16 of 16. `pnpm check` (1,674 unit tests, the tokens' contrast, radii and sizes
guards among them); `pnpm build`; the whole e2e suite 247 of 247 (Chromium 153 with
`env -u WAYLAND_DISPLAY`). Screenshots, dark and light, from a spec outside the repository: 1280×720,
1440×900, 1920×1080, 2560×1440 and 390×844; More open with two documents (no scroll at 1440×900),
Codex picked (the Sandbox row), a taken branch's words under Branch, a refused start, from a
History row, no agent. Computed colours: every row's name `--muted` at 500, the values `--text`.
Other pages: the classes changed (`.workspace-field`, `.workspace-check`, `.start-*`, a
`role="switch"` checkbox) are used only by the start page's three components; not screenshotted
again.

Not verified: a real agent's start from the new page (the fake's starts pass in e2e; nothing in
the request changed); Firefox and Safari (the switch's `translate` and `field-sizing` were not run
there); the person's own window size (2167×1323 main area), only the four measured.
