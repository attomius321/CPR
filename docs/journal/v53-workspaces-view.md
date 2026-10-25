# Journal: V53 — A working agent's spinner, its mark, and every workspace's kind

[Index](../JOURNAL.md) · [Plan](../plan/v53-workspaces-view.md)

## V53 — the spinner, the agent's mark, the kind chip (2026-10-25, branch `feature/workspaces-view-improvements`)

A working or starting agent's dot is a spinner (a ¾ arc, 11 px around the dot's 7 px place, a turn
a second, still under reduced motion); a working card's line and its heading's start with the
agent's mark in its vendor's colours (Claude's spark, Codex's mark in its gradient); every
workspace with a recorded kind, Feature included, shows it in a neutral chip at the end of its
name's line. Decisions 394–396. Planned as V51; renumbered before finishing (below).

**Learned**:
- **IDs are taken while a workspace is built**: V51 and decisions 386–388 were free on every branch
  at plan time; by the end `feature/settings-style` had V51 and 386–390, and
  `feature/scout-view-settings` V52 and 391–393. Renumbered to V53 and 394–396; the plan's commit,
  already pushed, says V51.
- **A ¾ arc at rest reads as a letter**: with reduced motion the still arc, its gap at the right,
  was a "C" before the name at 1×. Turned −45°, its gap sits at the top right, as lucide's
  `Loader2` draws it.
- **`.commit-date` is History's 8.5 em column**: the card's state line resets it to `width: auto`,
  the waiting card's Respond row did not, and its time ended 2 px past its line (218 against 220
  px, measured in the page). Unseen until a chip at the end of the name's line had to sit over it.
- **The chip now lives on the dot's line**: the rail hides a card's lines, not its head, so it
  hides the chip by name.
- **Cost of the spinner**: four working dots idle for 10 s in the e2e's headless Chromium, three
  rounds, the halo put back by an injected style in the same page: still (reduced motion) 0 style
  recalculations and 11–14 ms of main thread; V48's halo 24 and 25–26 ms; the spinner 53–54 and
  44–66 ms; no layout from either (2 in one spinner round, the list's own refresh). About twice
  the halo, under 0.7 % of a core. V48's 601 recalculations were a different run (a window drawing
  every frame); compare within one run only.
- **Two marks, one page**: the card's and the heading's Codex marks each hold a gradient whose id
  is `useId`'s (React 19.3: `_r_…_`, valid in `url(#…)`); the e2e reads each mark's fill back to its
  own gradient.

**Verification**: tests first, red for the right reason (6: the dot still `state-pulse 2.4s` at
7 px, the starting ring `state-spin 0.9s` at 7 px, no mark, no feature chip, the fix chip on the
branch line), then green; the rail and the waiting card's column added after the screenshots.
`pnpm check` (1,739 tests), `pnpm build`, `pnpm test:e2e`: 257 of 258 — `merges.spec.ts:187` (a
merge log's second line while its check runs, V46a) failed once in the full run and passed 3 of 3
alone; that page draws no card or working dot. Screenshots at 1× in both
themes, read pixel by pixel at 4×: working with Claude Code and with Codex, starting, waiting, to
review (with commits and without), the heading, Scout's link with a working dot; every card's
chip, time and line end at one x (222 px; 218 in the waiting band); cards stay 64 px.

Not verified: the desktop app on WSLg (its window opens on the person's desktop: not run unasked);
the marks against a real Claude Code or Codex session (the fakes give the same `agent.kind`).
