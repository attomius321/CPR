# V74 — The Activity tab in colour

[Index](../PLAN.md) · [Journal](../journal/v74-activity-colours.md)

**Status:** ready for review (2026-10-28), on branch `feature/workspace-activity-improvements` (a
workspace's branch). Plan agreed by the person ("1. Yes. 2 Yes. Ok": the palette, purple for git
included, and bubbles for their messages). Its "As built" and results below.

**Problem** (asked: "It is hard to read the activity UI. Make some styling changes to it, so the
UI is more friendly. Add some colors."). V73's timeline, screenshot on copies of three of the
person's recorded workspaces (`workspace-activity`, 299 calls drawn as 41 phases;
`layout-fixing`, 355 calls; `extend-view-with-wrapper`, 60 calls), at 1440 and 760 px, dark and
light:

| What | Today |
|---|---|
| A phase's marks | a 16 px icon in `--muted`, a 9 px ring on the rail in `--faint`; the same on every phase |
| Colour on a screen of 12 rows | only "Passed" / "Failed" badges and a test's "passed" |
| The person's messages, the agent's reports | the phases' layout: a filled 9 px dot and weight 600; a report cut to one line |
| The rail | 1 px of `--line`, 1.21:1 on the dark ground |
| A phase's duration | `--faint`, 13 px |

What causes it: V73 drew the phases in the state's tone only ("16 px icons in the state's tone,
not 32 px colour tiles (colour is for state in Symbiote's style)"), so a phase's kind has no colour
while the person's V73 mockup (`Dark Developer Activity Timeline.png`) gave each a coloured tile.

**Goal**: each phase's kind at a glance by its colour; the conversation (the person's words, the
agent's reports) apart from the work; the rail and the times readable. **Kept**: the grouping, the
words, the data and every other tab; no text smaller (the `--size-*` scale); statuses in their
state colours.

## Colours (`ui/base.css`)

Seven tokens, one a kind of work, in the dark, light and system-light blocks; a hue each that
stays the same in both themes (History's lanes 5 and 6 change hue between themes: tan and olive,
lime and brown), ≥ 3:1 on the four backgrounds and on their own tile:

| Token | Phase | Dark | Light | Lowest dark / light |
|---|---|---|---|---|
| `--phase-explore` | Exploration | `#40b0a6` | `#0a7f6f` | 6.62 / 4.22 |
| `--phase-implement` | Implementation | `#6aa8ff` | `#2f62cc` | 7.18 / 4.82 |
| `--phase-docs` | Documentation | `#e0a548` | `#9a5b00` | 8.00 / 4.66 |
| `--phase-test` | Testing | `#8ccf3e` | `#4d7a00` | 9.21 / 4.40 |
| `--phase-visual` | Visual inspection | `#ec6fae` | `#bf3989` | 6.18 / 4.33 |
| `--phase-debug` | Debugging | `#f2815a` | `#c2410c` | 6.69 / 4.45 |
| `--phase-git` | Git, a commit | `#c08cff` | `#8a3fd1` | 6.99 / 4.86 |

A tile is a wash of its colour: 16 % over the ground (12 % light), as a selection is.

## The timeline (`ActivityTab.css`, `activity/GroupRow.tsx`)

- **A tile on the rail**: the group's icon moves from its line onto the rail, in place of the 9 px
  node: a 28 px tile, 8 px radius, the 16 px icon in the phase's colour on its wash. Milestones (a
  prompt, a message, a report, a question, a commit, the verdict) a stronger tile (a wash and an
  edge); what only marks the way (the workspace made, a session's start and end, a notice) a
  hollow tile, its icon in `--faint`.
- **Status**: the tile's ring in the status's colour (failed `--error`, running `--info`, waiting
  `--warning`); the badge keeps its words and gains an icon (Passed a check, Failed a cross,
  Running the working mark, Waiting the waiting mark).
- **The conversation**: the person's messages and Symbiote's prompt in a bubble (`--raised`, 10 px
  radius, as wide as its words); a report's and a message's words two lines before the cut.
- **The rest**: a group's count chip in its phase's wash; the rail 2 px, a 22 % mix of `--muted`;
  durations in `--muted`; titles and summaries keep the text's colours.
- **Open**: each event's icon in its own call's colour (a Read inside an Implementation is
  teal): `phaseOf(event)` in `words.ts`, pure.
- **The live strip**: a tile in the running phase's colour; `LiveActivity` gains `kind`.
- **Raw events**: a tool line's chip in its call's colour; "start" and "end" in `--muted` beside
  the tool's name.
- **Narrow**: under 400 px the time column goes as today; the tiles stay.

## Verification

1. **Unit, red first**: `tokens.test.ts` — the seven tokens, their values in both themes, ≥ 3:1
   on the four backgrounds and on their own wash; `activity-*.test.ts` — `phaseOf` on reads,
   edits, docs, tests, screenshots, git, commits and calls of no kind; the live strip's `kind`.
2. **e2e** (`e2e/activity.spec.ts`): a phase's tile in its kind's colour (computed style), a
   failed one's ring, the person's message in its bubble; V73's four specs pass.
3. `pnpm check`, `pnpm build`, `pnpm test:e2e`.
4. **Screenshots** on the same three records, before and after: 1440 and 760 px, dark and light,
   1×; closed, opened, the raw stream, the live strip (the e2e fake agent); the workspace's other
   tabs unchanged.

**Risks**

| Risk | Mitigation |
|---|---|
| Seven hues read as a rainbow | colour on the tiles and counts only; titles and summaries in the text's colours; quiet rows hollow |
| A kind near a state: lime Testing and green Passed, amber Documentation and amber Waiting | different shapes: a tile against a badge or a ring, as in the person's mockup |
| Purple git 22° of hue from the violet accent | the person's choice (asked); the accent keeps its roles (`tokens.test.ts`'s guard) |
| Rows taller | about 11 rows on a 900 px window against 12 (measured on the preview) |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V74a | Colours | the seven tokens and their tests |
| V74b | The timeline | tiles on the rail, statuses, bubbles, events', live strip's and raw lines' colours |
| V74c | Verification | e2e, screenshots, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 528 | Colour for a kind of work | **Each phase's kind its own colour, as History's lanes and the Monitor's kinds; states keep theirs; the accent stays out** (V73's "colour is for state" for the Activity tab) | the brief: "Add some colors"; the person's V73 mockup gave each phase a coloured tile |
| 529 | Where kind and status show | **The kind on a tile on the rail; the status on the badge and the tile's ring** | one mark a row; a kind is never read as a status |
| 530 | Which colours | **Seven `--phase-*` tokens, one hue in both themes, ≥ 3:1 (tested)** | History's lanes 5 and 6 change hue between themes |
| 531 | The conversation | **The person's messages in a bubble; a report and a message two lines before the cut** | they were drawn as the work's phases, a report in one line |

**Not in V74 (later)**: a legend of the colours (each tile's title names its kind); colour in the
Thread tab.

## As built (V74)

- **Built as planned**, in `ui/base.css` (the tokens and `--phase-wash`), `ActivityTab.css`,
  `activity/GroupRow.tsx` (`PhaseTile`, `phaseClass`, the badges' icons), `LiveStrip.tsx`,
  `RawStream.tsx`, and pure `phaseOf`, `groupPhase`, `rawPhase` in `words.ts`.
- **The bubble is the Thread tab's**: the person's messages there are a 7 % mix of the text over
  `--panel`, 10 px radius; the Activity tab's bubble takes the same, not `--raised` (the preview's).
- **A status ring has its own variable** (`--status-ring`): `--ring` is the focused field's token,
  and a failed group would have recoloured the focus ring of a control inside it.
- **Inherited colour stops at an event**: `--phase` is inherited, so an event of no kind of work (a
  task's update) would take its group's colour; `.activity-event:not([class*='phase-'])` resets it.
- **The badge's icons**: Passed a check, Failed a cross, Running the sidenav's hourglass, Waiting
  its bell, Stopped its pause; "No end recorded" has none.

**Results.** `pnpm check`: 2,073 unit tests (2,067 before: 3 for the tokens, 3 for the colours'
words; the live strip's `kind` in two of V73's). e2e: 335 of 336 (5.0 min), the new Activity
spec among them; Scout's `scout.spec.ts:475` failed under the full run's load and passed alone on
the final build. The e2e spec found the bubble's radius reset by
its own padding rule before any screenshot did. Screenshots, before and after, on copies of three of
the person's recorded workspaces (299, 355 and 60 calls), 1440 and 760 px, dark and light, 1×:
every phase's kind on its tile, 11 rows on the first screen of the 299-call record against 12. The
states the records lack (a failed test, debugging, a commit, a running call, a question waiting)
were drawn with the e2e suite's fake agent in both themes: the failed tile ringed red, the running
one cyan with the live strip's tile, the waiting question amber.

**Not verified**: the desktop app (Electron) drawing the tab; how the seven hues read to a
colour-blind eye (each tile's title names its kind, so nothing is said by colour alone).
