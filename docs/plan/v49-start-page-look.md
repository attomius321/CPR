# V49 — Start a workspace: a centred page in two cards

[Index](../PLAN.md) · [Journal](../journal/v49-start-page-look.md)

**Status:** planned (2026-10-25), on branch `feature/improve-start-workspace-ui` (the workspace's);
the plan confirmed by the person ("Yes"), Start kept in the head as proposed.

**Problem** (asked: "Start workspace needs improvements. There is too much empty space. And the
UI feels old. Find current standards that look like this, and follow them", with a screenshot of
the page in a 2167×1323 main area). Measured on `main` (`94e1feb`) in Chromium, `serveWorkspaces`
with the fake Claude Code, the form empty and More closed:

| Window | Main area | The form | Empty on its right | Empty below it | Area used |
|---|---|---|---|---|---|
| 1280×720 | 1040×696 | 1008×524 | 16 px | 112 px | 78 % |
| 1440×900 | 1200×876 | 1092×524 | 92 | 292 | 57 % |
| 1920×1080 | 1680×1056 | 1092×524 | 572 | 472 | 34 % |
| 2560×1440 | 2320×1416 | 1092×524 | 1,212 | 832 | 18 % |

With More open at 1440×900 the brief is 790 px of the body's 832: 2 px from scrolling.

What causes it:
- **A fixed grid pinned to the top left** (V30a, decision 206): 760 + 32 + 300 px from the main
  area's left edge. Every pixel a window adds goes to the right and below.
- **No grouping**: the fields stand on the canvas; the brief and the run are told apart only by a
  gap, and the run is a stack of a bold name over a full-width select, eight high (524 px, the
  taller column).
- **Names at weight 600** (`.workspace-field`), where the style gives labels 500; Start is at the
  head's far right, 1,200 px from the form at 2560.

**The standards found.** Agent-task launchers put the task in one centred box, the run's choices
(repository and branch, model, permission mode) as compact controls attached to it, and one Start:
[Claude Code on the web](https://code.claude.com/docs/en/web-quickstart) (the repository and branch
selectors under the input, the permission mode beside it), GitHub Copilot's
[Agents panel](https://github.blog/changelog/2025-08-19-agents-panel-launch-copilot-coding-agent-tasks-anywhere-on-github-com)
(repository, [base branch](https://github.blog/changelog/2025-07-23-agents-page-set-the-base-branch-for-github-copilot-coding-agent-tasks/),
[model](https://github.blog/changelog/2026-02-19-model-picker-for-copilot-coding-agent-for-copilot-business-and-enterprise-users/),
Start task). Creation pages and issue trackers' property panels: a centred column of grouped
cards, settings as rows with the name left and the control right (from experience of those
products; no page found that documents it).

**Goal**: the page centred in the main area at every width, the brief and the run each a card,
the run's choices as rows; a tall window gives the goal more room. Unchanged: what a start does,
the draft, the keys (Ctrl+Enter, Escape, `n`, 1–5 on the kinds), drop and paste, the kinds, More,
the check guess, the field style (decision 246), the tokens, every other page.

## The page

```
┌────────────────────────────────────────────────────────────────────────────────────┐
│        Start a workspace  From main at 94e1feb                  Cancel Clear [Start] │
├────────────────────────────────────────────────────────────────────────────────────┤
│        ╭─────────────────────────────────────────────╮ ╭──────────────────────────╮ │
│        │ [Feature] Fix  Refactor  Chore  Spike  ?    │ │ Start from    [main    ▾]│ │
│        │ Title                                       │ │ Branch ?   [feature/new ]│ │
│        │ [A short name: the workspace's and its…   ] │ │ Agent         Claude Code│ │
│        │ Goal                                        │ │         your Max subscr. │ │
│        │ [What should it do, and why?              ] │ │ Model ?    [default    ▾]│ │
│        │ [                                         ] │ │ Effort ?                 │ │
│        │ Done when  optional                         │ │ ●───·───·───·───·───·    │ │
│        │ [How will you know it works? …            ] │ │ Permission [default    ▾]│ │
│        │ Check: pnpm run check, from package.json    │ │ Plan first and wait  [━●]│ │
│        │ › More: Where to look, Out of scope, Notes  │ │ Documents ?  [+ Add files]│ │
│        ╰─────────────────────────────────────────────╯ ╰──────────────────────────╯ │
```

- **Centred** (decision 378): `.start-columns` is centred in `.start-body`, the brief up to 760 px
  and the run 380 px, 24 px apart, where the main area is at least 1,000 px wide (the container
  query of V30a); one column of up to 760 px, centred, below it. The head keeps its full-width
  strip in `--side`; its title, where it starts and its buttons are laid out in the same width as
  the cards, so Start stands over the run card's right edge.
- **Two cards** (decision 379): `.start-brief` and `.start-run` are cards: 14 px radius (the
  style's card), `--panel`, a `--line` hairline, `--shadow-lift`, 16 px padding (12 on a phone).
- **The run as rows** (decision 379): each choice a row, its name (and its "?") left in a 104 px
  column, the control right, a hairline between rows: Start from, Branch, Agent and its account,
  Model and its note, Effort, Permission (or Codex's Sandbox), Plan first, Documents. Effort keeps
  the drag stepper the person asked for (`fix/scout-effort-level`) under its name, the card's
  width: at 220 px beside a name its six words overlap.
- **Plan first a switch** (decision 380): the style's switch (an on/off setting), still the
  `<input type="checkbox">` with `role="switch"`, the same label ("Plan first and wait for my
  OK"), Space toggles it.
- **Start stays in the head** (decision 381): in view while the form scrolls (V30a), Ctrl+Enter
  as before; the composer's Start at the card's corner would scroll away on a phone.
- **Heights** (decision 382): names at weight 500; the optional parts (Where to look, Out of
  scope, Notes) open at 2 rows and grow as typed (`field-sizing`), which pays for the cards'
  padding: More open at 1440×900 still fits. Where the main area is at least 1,000 px high, the
  goal opens at 12 rows (7 today) and the cards stand 48 px under the head (16 today).

## Verification

1. **e2e first** (`start.spec.ts`, red on `main`): at 1920×1080 and 2560×1440 the cards' left
   and right margins equal (±1 px); Start's right edge over the run card's (±1 px); Plan first
   found as a switch, checked, and Space turns it off; the goal taller at 1440 px high than at
   900. Kept: side by side, More open without a scroll at 1440×900, the goal over 640 px wide,
   one column at 390×844 with Start in view.
2. **The rest**: `pnpm check`, `pnpm build`, the whole `pnpm test:e2e`.
3. **Screenshots** before and after, dark and light, at 1280×720, 1440×900, 1920×1080, 2560×1440
   and 390×844; More open, documents listed, a refused start, Codex, no agent, from a History row;
   text at 3× for uneven gaps; the table above measured again. Every other page once, unchanged.

**Risks**

| Risk | Mitigation |
|---|---|
| More open scrolls at 1440×900 once the cards have padding | 2-row optional parts (61 px back); the e2e checks it |
| A row's control too narrow for a long model name | the select takes the row's rest and ellipsizes; checked with the fake's longest name |
| The stepper's words overlap in a row | under its name, the card's width (≥ 348 px) |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V49 | The centred page, its cards and rows | `StartPage.css`, `StartAgent.tsx`, `StartPage.tsx`, `StartDocuments.*`, `start.spec.ts` |

**Proposed decisions** (confirmed by the person with the plan):

| # | Question | Decision | Why |
|---|---|---|---|
| 378 | Where the page stands in a wide main area | **Centred, the head's contents in the same width** | 18–57 % of the area used at 1440–2560; creation pages and agent launchers centre their form |
| 379 | How the brief and the run are grouped | **Two cards; the run's choices as rows, name left, control right** | the run was the taller column (524 px) as a stack of names over fields |
| 380 | Plan first | **A switch, the same checkbox and label** | an on/off setting (the style's switch); `getByLabel` and the draft unchanged |
| 381 | Where Start is | **The head, over the run card's edge** | in view while the form scrolls (V30a) |
| 382 | The heights | **Optional parts 2 rows; the goal 12 rows on a main area ≥ 1,000 px high** | More open must still fit 1440×900; a tall window's room goes to what is written most |

**Not in V49 (later)**: Scout's and Settings' pages, left-aligned the same way; a composer with
the run as pills under the goal (the effort stepper does not fit a pill).
