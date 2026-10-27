# V69 — The merge page as the person's mockup, in Symbiote's theme

[Index](../PLAN.md) · [Journal](../journal/v69-merge-page-mockup.md)

**Status:** in progress (2026-10-27), on branch `feature/merger-page-revamp`.

**Problem** (asked: "Make like in the screenproof… but keep the current theme of the app", with a
mockup of a landed merge, `Dark Symbiote Merge Build Dashboard.png`, 1704×923). The page already
has the mockup's layout: a head with the branches, the state and the actions; the state and the
title; the steps beside the log. It differs in its details, measured on a landed merge served by
e2e's harness at the mockup's size:

| What | Today | The mockup |
|---|---|---|
| The head's branch and target | words in their colour on `--raised`, 13 px, 18 px tall; a loose "→" between | each a chip tinted by its colour, ~14 px, ~20 px tall; the arrow an icon inside the target's |
| The state | a round pill, a dot | a chip as the branches', an icon (✓ for Landed) |
| The state and the title | `--muted`, 24 px apart | the text's colour, 20 px apart |
| The steps | names regular; times `--faint` captions | Merge and Land at weight 500; times muted, near the names' size |
| The log | no edge; the window's height less 260 px (at most 900): 115 px of empty ground under it at 923 | a card: a hairline edge (`#1b202c`), round corners; down to ~13 px above the page's end |

**Goal**: the mockup's details on every state of the page, in Symbiote's tokens. **Kept** (the
theme): the branch magenta (`--lane-4`) and the target cyan (`--info`), not the mockup's violet
branch (the violet is the accent, kept to what a person acts with: `tokens.test.ts`); dark words on
the primary (white is 4.01:1); the head's 52 px; the sidenav's merge card; a conflict's regions
and files list. Asked after the plan: a conflict's Files / Log tabs become the line tabs (V61,
decision 445), which the mockup does not show.

## Design

- **Head** (`Merge.tsx`, `Merge.css`): the branch, the target and the state are one kind of chip,
  History's HEAD tint (a 12 % fill, a 30 % edge as an inset shadow, the colour as its words):
  22 px tall, 8 px radius, `--size-small` at weight 500. The target's chip starts with an arrow
  icon (lucide's `arrow-right`, `ArrowIcon` in `ui/icons.tsx`); the "→" text goes. The state's chip
  starts with its tone's icon, the sidenav groups' (V44, V48): done `DoneIcon` (circle-check), wait
  `WorkingIcon` (hourglass), you `WaitingIcon` (bell), bad `AlertIcon` (circle-alert). "by
  fast-forward" and the buttons stay.
- **The state and the title**: `--text`, `--size-small`, 20 px apart.
- **Steps** (`MergeLog.tsx`, `MergeLog.css`): Symbiote's own steps (Merge, Merger agent, Land) at
  weight 500; a check's command stays mono, regular. Times `--muted` at `--size-small`.
- **The log**: the terminal a card — a `--line` hairline, 10 px radius, its black kept
  (`terminal.ts`'s theme). The page is a column: the log takes what is left of the main area,
  16 px above its end, at least 320 px; what is above it growing (an answer, a failed check's
  output) scrolls the page. Narrow (under 700 px) as today: the steps above a 360 px log.
- **Files / Log**: line tabs on the page's ground (`components.md`, Tabs): 40 px, 15 px weight 500 in
  `--muted`, the picked one `--text` on `--tab-picked` with a 3 px `--primary` line, a `--line`
  hairline under the strip. `--primary` there is the accent's tab-line role.

## Verification

- **Tests first** (`e2e/merges.spec.ts`), red before the change: the head has no "→" text, the
  target's chip an icon, the state's chip its tone's icon (landed and a resolution to review); the
  log's terminal has a 1 px edge and ends 16 px (±1) above the main area's end at 1440×900 and
  1440×700; the picked tab carries the line (a 3 px `::after`). The existing "last line whole at
  every height" stays green.
- `pnpm check` (tokens: contrast, radii, sizes, accent roles), `pnpm build`, `pnpm test:e2e`.
- Screenshots from a spec outside the repository on e2e's harness: landed, a resolution's Files
  and Log, a merge waiting for an answer; 1704×923, 1440×900, 390 wide; dark and light; at 1×
  for uneven gaps; beside the mockup.
- No graph, layout or font change: no Bitwarden timings.

## Risks

- **The log's height**: `fix/scribe-terminal-problem` found xterm's fit counting padding as rows;
  the box's padding stays outside `.merge-terminal-fit`, and the e2e of every height checks it.
- **Class names are global**: `.merge-chip` and the tabs' rules are new names; checked with grep.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V69 | The merge page as the mockup | the head's chips and icons, the state's lines, the steps, the log a card filling the page, line tabs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 494 | The mockup's colours or the theme's | **The theme's: the branch magenta, the target cyan, states in their colours; the mockup's shapes and sizes** | Asked: "keep the current theme". The mockup's violet branch is the accent, which marks only what a person acts with (a tokens guard) |
| 495 | The head's branches and state | **One chip for the three: HEAD's tint, 22 px, 8 px radius, 14 px words; the arrow an icon in the target's chip, the state's dot its tone's icon (the sidenav groups')** | The mockup; an icon over a symbol glyph (the style); one icon per state across the app |
| 496 | The log's height | **What is left of the main area, 16 px above its end, at least 320 px** | The mockup fills the page; the window less 260 px left 115 px of empty ground at 923 px and stopped at 900 |
| 497 | A conflict's Files / Log | **Line tabs (decision 445)** | Asked after the plan ("Yes switch to those"): the flat buttons were the style before V61 |
