# V53 — A working agent's spinner, its mark, and every workspace's kind

[Index](../PLAN.md) · [Journal](../journal/v53-workspaces-view.md)

**Status:** ready for review (2026-10-25), on branch `feature/workspaces-view-improvements` (a
workspace started in Symbiote, from `main` at `c136ee3`). The person OK'd the plan with their
answers: "1. Recommended 2. The vendors colours 3. Recommended. OK" — read by the plan's three
parts: the spinner as planned, the agents' marks in their vendors' colours, the kind chip as
recommended (the name's line, neutral). Planned as V51 with decisions 386–388; renumbered (other
workspaces took them meanwhile). Built as planned, with three changes; "As built" and results at
the end.

**Problem** (asked: "The pulse at the moment is way to subtle, maybe is better to put a loading
spinner. Also, before agent action from workspace card (eg. "Thinking") Put the icon of the agent,
the claude icon if it is claude code, the codex icon if it is codex." Then: "Also, put a tag chip
with the type of workspace (eg. "feature", "fix", "chore") so i can easily make a difference").
Today (V48, `shell/Sidenav.css`):

- A working agent is a 7 px cyan dot whose halo (`::after`) starts at 55 % opacity and is gone by
  70 % of a 2.4 s cycle, eased out: most of its fade is in its first half second. The dot itself
  never changes, and it is the same dot as To review's, a step from it in hue.
- A working card's line says what runs ("Thinking", "Running pnpm test") but not which agent: a
  Claude Code workspace and a Codex one read alike.
- `KindTag` draws nothing for a Feature (V24c: "the common case"): a fix, a chore, a spike or a
  refactor has a small bordered tag on the card's third line, before its branch, and a feature has
  none. The kind is read from the branch's prefix or not at all.

**Goal**: a working agent is a spinner that reads at a glance; its card names the agent by its
mark before what it does; every card says its kind in a chip on its first line. **Unchanged**: the
other states' dots (waiting's halo, review's and done's dots, stopped's ring), the groups, the
card's height (64 px at most), the status bar's vendor names (decision 181), what the line says.

## The spinner (`shell/Sidenav.css`)

- `.state-dot.tone-working` becomes a spinner after lucide's `Loader2` (the style's one spinning
  icon): a ¾ arc in `--moved`, about 11 px across with a 2 px stroke, a turn a second, drawn by
  its `::after` (a border with one side clear, `transform: rotate`: the compositor turns it,
  nothing is laid out again, as the halo did).
- Drawn around the dot's place, past its 7 px box: every state keeps the same box, so a card that
  starts or stops working does not move (the viewer's rule: layout never depends on state). If the
  name sits too close to the arc, the head's gap widens for every card alike.
- **Starting** takes the same spinner: busy is busy, and its card's words say "Starting".
- **Reduced motion**: the arc holds still — its own shape beside waiting's halo and stopped's ring.
- Wherever a working dot is drawn: the cards, the workspace's heading, Scout's and Skills' dots in
  the sidenav, Scout's and Scribe's conversations (all `.state-dot.tone-working`).

## The agent's mark (`ui/icons.tsx`, `workspaces/WorkspaceFacts.tsx`)

- `ClaudeIcon` and `CodexIcon` in `icons.tsx`: filled marks, not line drawings, inline as the
  others are (no icon package). Claude's spark from Simple Icons (CC0) in Claude's terracotta
  `#d97757` (Simple Icons' colour for it); Codex's mark from Lobe Icons (MIT,
  `@lobehub/icons-static-svg` 1.100.0) in its own gradient, `#b1a7ff` to `#7a9dff` to `#3941ff`,
  top to bottom. A credit line for each. The gradient's id comes from `useId`: several cards draw
  the mark, and an `id` repeated on a page may resolve to one inside a folded group.
- `WorkspaceState` draws the agent's mark, 14 px, before its words while the agent works (the
  `working` group): the line is then the agent's action. "Ready for review", "Stopped" and the
  rest are Symbiote's words about the workspace: no mark. Named for screen readers and on hover
  ("Claude Code", "Codex").
- The agent is `agent.kind`, Claude Code when absent: records from before Codex (V20a) are all
  Claude Code's, as `workspaces.ts` already reads them.
- **Decision 181** (V29: the status bar names vendors, "their marks are theirs") stays for the
  status bar. Here the person asked for the marks: they are drawn unaltered, to say which program
  runs, the name beside them in the label.
- **Contrast** (the marks are graphics, measured on the four backgrounds): Claude's `#d97757` is
  4.90–6.42:1 in dark, 2.68–3.12:1 in light (2.94 on the sidenav); Codex's gradient 2.46–9.39:1 in
  dark, 1.83–6.22:1 in light. Vendors' colours, as asked; the name is in the mark's label.

## The kind chip (`workspaces/WorkspaceFacts.tsx`, `Workspace.css`, `shell/Sidenav.css`)

- `KindTag` draws every recorded kind: feature, fix, refactor, chore, spike. A workspace started
  before V24 has no recorded kind: no chip (its branch's prefix would be a guess).
- The style's metadata chip (`components.md`): `--raised` fill, `--muted` text, 4 px radius,
  18 px high, the caption size; no border. Neutral: colour on a card means its state.
- On the card's first line, at its right end: the kinds make a column down the list, the name
  ends in "…" before its chip. The third line is the branch alone. The workspace's heading keeps
  the chip before its name.

## Verification

1. **Tests first** (red for the right reason), `e2e/workspaces.spec.ts`:
   - A working dot spins (`::after` turns, `state-spin`, a ¾ arc); under reduced motion it holds
     still, an arc. It replaces V48's pulse test.
   - A Claude Code workspace's working card shows Claude's mark before "Thinking" and before a
     tool's words; a Codex one (the fake Codex, `codex: true`) Codex's; a card that does not work
     shows none.
   - A feature's card shows "feature" on its first line, a fix's "fix"; a workspace from before
     V24 none (the test there stays).
2. `pnpm check`, `pnpm build`, the whole `pnpm test:e2e`.
3. **The look** (`viewer-check`, `symbiote-style`): screenshots at 1× in both themes of every
   card state — working with Claude Code and with Codex, starting, waiting, to review, stopped,
   done — the workspace's heading, Scout's and Skills' dots and Scout's page; spacing checked on
   each.
4. **Cost**: style recalculations in 10 s with a working card, against V48's halo (601).
5. No analysis or graph change: no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| An 11 px arc around a 7 px box crowds the name | Screenshots; the head's gap widened for every card if so |
| The marks' colours under 3:1 in light | Measured above; the name in the label; the person's choice |
| A gradient `id` repeated across cards | `useId` per mark; checked in the e2e by the fill drawn |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V53 | The spinner, the agent's mark, the kind chip | e2e, CSS, two icons, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 394 | A working agent's indicator | **A spinner: a ¾ arc turning once a second around the dot's place; starting the same; still under reduced motion** (replaces decision 370's breathing halo for working) | The person found the pulse too subtle and asked for a spinner |
| 395 | Which agent works | **Its mark before its words while it works, in its vendor's colours; none on Symbiote's own words** (decision 181 stays for the status bar) | The person asked for Claude's and Codex's icons, and their colours |
| 396 | A workspace's kind | **A neutral chip on every card with a recorded kind, Feature included, at the end of the name's line** (V24c's "none for a Feature" dropped) | The person asked to tell kinds apart; a column is read at a glance; colour stays for state |

**Not in V53 (later)**: a mark on a waiting card's ask; the marks in the status bar or History's
badges; a tint per kind.

## As built (V53)

- **The still arc is turned −45°**: under reduced motion its gap sat at the right and the arc read
  as a "C" before the name at 1×; turned, the gap is at the top right, as `Loader2` draws it. The
  arc ends 5 px from the name (the dot ended 7 px from it): kept, the head's gap unchanged.
- **The line's title names the agent**: "Claude Code: Thinking · no commits yet" while it works,
  besides the mark's own label.
- **The waiting card's time takes its own width**: it kept History's 8.5 em `.commit-date` column
  and ended 2 px past its line (the state line had reset it, the Respond row had not), so its chip
  could not sit over it. Fixed with the chip; an e2e checks both ends meet.
- **The rail hides the chip**: it hides a card's lines, and the chip is now on the dot's line.
- **Cost**: four working dots idle for 10 s (headless Chromium, three rounds, the halo put back by
  an injected style in the same page): still 0 style recalculations, 11–14 ms of main thread; V48's
  halo 24, 25–26 ms; the spinner 53–54, 44–66 ms; no layout from either. About twice the halo,
  under 0.7 % of a core.
- **Renumbered**: V51 and decisions 386–388 were free at plan time; `feature/settings-style` (V51,
  386–390) and `feature/scout-view-settings` (V52, 391–393) took them while this was built. The
  plan's commit, already pushed, says V51.

**Results.** Tests first, red for the right reason (6), then green: `workspaces.spec.ts` (the
spinner and its still arc, the starting card's spinner, Claude's mark and none on Symbiote's words,
the chip on every card, over its time, hidden in the rail, a fix's chip; the waiting card's chip
over its time), `codex.spec.ts` (Codex's mark, two marks with gradients of their own). `pnpm check`
(1,739 tests), `pnpm build`, `pnpm test:e2e`: 257 of 258 (`merges.spec.ts:187`, a merge log's
second line, failed once under the full run's load and passed 3 of 3 alone; that page draws no
card or working dot). Screenshots at 1×, both themes, every card
state, the heading and Scout's link: each card's chip, time and line end at one x; cards stay 64
px. Not verified: the desktop app on WSLg; real Claude Code and Codex sessions (the fakes set the
same `agent.kind`).
