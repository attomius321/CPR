# V89 — Redesign step 2: the workspace page and the terminal view

[Index](../PLAN.md) · [Journal](../journal/v89-redesign-workspace-terminal.md)

**Status:** built (3 November 2026), on branch `feature/redesign-workspace-terminal` (the
workspace's, from `main` at `98e28e2`); merged into `main` on 2026-11-03.

**Problem** (the brief: "Bring a workspace's page and its terminal view to the designs, in both
modes. The person spends most of their time in the terminal view: weigh every change by it, and
nothing in it may get slower or less reliable"). The designs are on `main`:
`spikes/normal-redesign` (02-plan-ready, 08-terminal, 09-terminal-split) and `spikes/hive-redesign`
(08-terminal, 02-run-live for the head's track); their shared styles `spikes/hive-redesign/src/term.css`.
V88 built the shared parts and placed `StageTrack` nowhere (decision 818). Today, on `98e28e2`:

| | Today | The designs |
|---|---|---|
| Where the workspace is | A state line under the title (`WorkspaceState`, `StateFor`); in Hive a sentence (`HiveNowLine`) | The steps on one line among the head's actions: the track, the step's word, its detail; Commits and Files, or round, time and spend |
| The tabs | `Terminal`, `Thread`, `Activity`, `Brief` (Hive: `Review`), `Shell 1`… | The agent's tab by its name with a dot for its state; each shell with the program in its foreground |
| What waits | A strip under the head (`WorkspaceStrip`, V48) with Respond and Next waiting | A bar under the terminal: what waits in the agent's words and the keys that answer it, or who drives |
| Focus, Split | None | Focus: the sidenav's rail, no side card. Split: the agent and a shell side by side |
| The side card | The changes panel (V29d): commits, files, not committed | Now, Not committed (live), Commits, as the designs draw it |
| A plan that waits | The thread read only, "To answer, open its terminal" | The plan typeset, Send reply and Approve plan under it |

**Goal**: a workspace's page and terminal view as the proofs draw them, in both modes and both
themes, derived from what Symbiote records; typing, focus, paste, attaching images, Send the
verdict, scrolling, resizing and reload (the tab and shell kept in the address) as reliable and as
fast as today.

## The steps in the head (decisions 823–826)

- `workspaces/HeadSteps.tsx` (`.head-steps`, term.css's `.steps-inline`) first among the head's
  actions: the track, the step's word and its detail, a hairline, then `Commits n · Files n`
  (normal) or `round 2 of 3 · Time · Spend` (Hive). It replaces the state line under the title
  and the head's `HiveNowLine`; the line under the title becomes the branch, from, started and
  what the agent runs on. Inline in every view, the plan's too: proof 02-plan-ready draws a
  pipeline card there, the brief asks for one line.
- **Normal mode** (`normalSteps`, pure, in `workspaces/workspace-steps.ts`): Build, Review, Merge,
  Plan and Your OK first when plan first is on. From the agent's state, the commits ahead, merged,
  the merge queue (`useWorkspaces().merges`) and the review's verdict (`row.next`):
  - planning (plan first, no commits, no message of the person's after the plan's report) → Plan;
    else Build while the agent works, waits, stopped or failed with work to do;
  - plan ready → Your OK, the person's;
  - commits and its turn ended, or a verdict to send → Review, the person's; finished without
    commits → Review (its report);
  - in the merge queue → Merge (a failed entry red); merged → every step done.
  The person's turn (waiting, a question, interrupted, stopped, plan ready, to review) is violet;
  working amber; failed and not started red.
- **Hive** (`hiveSteps`): Write, Check, Review, Land from `hive.step`; landed and answered all done;
  stuck red at the step it stopped at (the last check failed: Check; the last review kept
  findings: Review; a landing's outcome: Land; else Write). Time from `created`, to the landing's
  end once landed; none while stuck (no stop time is recorded). Spend and its budget from
  `WorkspaceHiveDetail.spend` (`/api/workspaces/hive`), the read the Review tab already makes, now
  once per list read and shared by the head and the tab: no new server data.
- **`StageTrack` gets a `you` mark** (violet; decision 826 amends 818): the proofs draw the
  person's waiting step so.
- The head keeps V88's one primary (decision 819).

## Session tabs (decision 827)

- The agent's tab is named by its agent (`Claude Code`, `Codex`; Hive's `Writer` with
  `Claude Code` beside it), with a dot: violet when it waits for the person (plan ready and
  interrupted too), amber while it works. Then Thread, Activity, Brief, Hive's Review as it is.
- Each shell: its name, the program in its foreground (`WorkspaceShell.running`, node-pty's name:
  `node`, not "npm run dev", and no port: Symbiote does not record them), a green dot while one
  runs, ×; the `+` after them. Shells are read again with each read of the list (once today).
- The strip's end: Attach images (from the head), Split, Focus. No search: xterm's search add-on
  would be a new dependency.

## The bar under the terminal (decisions 828–829)

- Its words, the first recorded: Claude Code's own notification (its `Notification` hook's
  message in the thread, newer than the wait's start: "Claude needs your permission to use
  Bash"); else what it asked ("Asks to run Bash: npm install pg", `activity.asks`); else
  `waitingFor`. Then how long it has waited (`activity.since`).
- Its keys, only those measured: a permission shows `Enter` allows (Yes is picked) and `Esc` says
  no and ends its turn (both measured in V21's spike). Symbiote does not record a permission
  prompt's options, and "don't ask again" varies by tool: no 1/2/3. A question
  (`AskUserQuestion`, its options recorded) shows its options numbered only if a real Claude
  Code session shows number keys pick them; else its options as words and "answer in its
  terminal". Codex and an interrupted turn: words only.
- Working: what it does now, then Symbiote's own keys (Ctrl+Click opens a path, Ctrl+V pastes an
  image; ⌘ on macOS). Failed: red, with Read its thread. Hive: "Hive drives this writer", and
  "What you type reaches the writer too, recorded as yours"; while Hive checks or reviews,
  `HiveNowLine`'s words.
- It replaces V48's strip and its Respond: Next waiting (n) stays at the bar's end; on Thread,
  Activity and Brief the bar has a link that opens the terminal. Never a button that answers
  the agent's prompt.

## Focus and Split (decisions 830–831)

- **Focus**: the sidenav as its rail and no side card, the person's fold untouched; remembered in
  the browser as the sidenav's fold is (the person's choice), not per workspace in the address.
- **Split**: the agent and one shell side by side, `&split=<n>` in the address; the last shell
  shown, else a new one. A shell's tab swaps the right pane; a view's tab, or a pane's maximize,
  leaves Split. Each pane its own fit box with no padding (the fit add-on's trap); the panes
  stack below about 720 px of card.
- Neither re-attaches the agent: its terminal keeps its place in the tree, so a toggle only
  resizes it. e2e checks `attaches()` does not change.

## The side card (decision 832)

Today's changes panel redrawn: **Now** (what the agent does and since when, each shell's
program), **Not committed** live with a pulse on the file the agent edits now
(`activity.doing.subject`), then Commits (with "review against") and Files. Its one read of the
changes moves up into the panel, for the head's counts too.

## A plan that waits (decisions 833–834)

The plan's report typeset as a document; under it a box with Attach, Send reply and Approve
plan (Ctrl+Enter), which sends a fixed OK, as in the proof: "Your plan is approved. Build it as
planned, and commit in small steps." With the agent's terminal open (the person's choice, A), both
are typed into its terminal and sent with Enter, offered only while the plan is ready. Without a
terminal, both go through today's reply route.

## Verification

1. **Tests first, seen red**: unit tests for `normalSteps` and `hiveSteps` in every state of both
   modes, the bar's words and keys, the tabs' names and dots, `StageTrack`'s `you`;
   `e2e/terminal-view.spec.ts` (the tabs, the bar from hook events, Focus, Split, reload keeping
   them, Approve plan); a Split case in `terminal-fit.spec.ts`; the new parts in the page-frame
   and targets specs; old specs updated (the `Terminal` tab's name, the strip, Send the verdict).
2. **Kept**: typing, paste, attaching images, Send the verdict, shells opened and closed, reload
   keeping the tab, by their e2e.
3. **Speed**: a key to its echo (V21's method, 30 keys) and the terminal's rows at 1440 × 900,
   before and after; the bar's clock ticks in a component of its own.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`.
5. **Screenshots** with the e2e fake agent, before (this branch at `main`) and after, beside the
   proofs, at 1×, both themes, both modes: working, waiting, plan ready, interrupted, stopped,
   failed, not started, merged, no terminal (Codex without its app server), a gone
   worktree, many shells, a narrow window, Hive writing, checking and stopped.

**Risks**

| Risk | Mitigation |
|---|---|
| The agent's tab's new name and the bar break specs that name them | Each failure read before the spec is updated |
| Split keeps two terminals open at once | A shell is 9 MB and the server keeps it anyway (V45) |
| A step derived wrong | Pure rules, unit-tested per state; what is not recorded is left out, never guessed |
| Approve plan sends a prompt half-typed in the terminal with it | Recorded in decision 834; offered only at a finished turn |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V89 | The workspace page and the terminal view, both modes | This branch |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 823 | Where the workspace's steps are (places 818's track) | **Inline among the head's actions in every view: track, word, detail, then Commits and Files or round, time and spend; the state line and Hive's head sentence go** | the brief: "on one line"; the proofs 08 and 09 |
| 824 | Normal mode's steps | **Derived: Plan until the person answers the plan, Your OK while it is ready, Build, Review once its turn ended with commits, Merge in the queue; violet the person's turn, amber working, red failed** | what Symbiote records: the agent's state, the thread, commits, the queue, the verdict |
| 825 | Hive's steps and figures | **From `hive.step`; stuck red where it stopped; time from the start; spend from the detail the Review tab reads, read once per list read** | no new server data |
| 826 | The person's step on the track (amends 818) | **A fourth mark, `you`, violet** | the proofs draw it so |
| 827 | Session tabs (replaces 297's "the agent's tabs keep their names") | **The agent's tab by its agent's name with a dot (violet waiting, amber working); shells with their foreground program and a green dot; attach, Split and Focus at the strip's end; no search** | the designs; node-pty names only the program; search needs a new dependency |
| 828 | The bar's words (replaces V48's strip) | **Claude Code's notification, else its ask, else `waitingFor`, and how long; Next waiting at its end; a link to the terminal on other tabs; never a button that answers** | "in the agent's own words" |
| 829 | The bar's keys | **Only measured keys: a permission's Enter and Esc; a question's numbers only if a real session confirms them; none for Codex or an interrupted turn** | Symbiote does not record a permission prompt's options |
| 830 | Focus | **The sidenav's rail and no side card; remembered in the browser as the fold is** | the person's choice |
| 831 | Split | **The agent and one shell, `&split=<n>`; each pane fits its own box; no re-attach on toggle** | the terminal comes first |
| 832 | The side card | **Now, Not committed (live, the edited file pulsing), Commits, Files; one changes read shared with the head** | the designs; no extra request |
| 833 | A plan that waits | **The plan typeset; Send reply and Approve plan (a fixed OK) under it** | proof 02-plan-ready |
| 834 | Approve plan and Send reply with the terminal open (amends 114 for a plan) | **Typed into the agent's terminal and sent with Enter, offered only while the plan is ready (its turn ended, nothing interrupted). Risk: a prompt the person left half-typed in the terminal is sent with it; Symbiote cannot see it** | the person's choice A: one click; a stop and resume would end the open terminal |

**Not in V89 (later)**: Hive's Review tab as Run and its timeline, the sidenav's groups, Settings'
Hive page, Start in Hive mode, turning Hive on (step 5); reviews (step 3); the Overviews (step
4); normal mode's Merge and Start screens; the terminal's own theme and size; search in the
terminal; a tool-call count and a shell's command line, which Symbiote does not record.

## As built (V89)

- **The side card stays 256 px**, not the proof's 300: the bar under the terminal already takes
  37 px of its height, and the terminal comes first. The person can drag it wider (V34).
- **The bar costs the terminal two rows**: 103 × 39 where it was 103 × 41 at 1440 × 900; 42.3 %
  of the window beside the side card (44.6 % before), 58.9 % without it (59.7 %). The two specs
  that guard the terminal's room (`changes.spec`, `shell.spec`) say the new numbers; the terminal
  still reaches the bar, and the bar the status bar.
- **A question shows what it asks and its options in words**, from its recorded ask, with
  "Answer in its terminal" and no keys: no real Claude Code session was run to measure its number
  keys (repositories an agent makes are not trusted by Claude Code), so none are shown
  (decision 829).
- **Hive's pause is said in the bar** (found by `hive-pacing.spec`): the head's sentence that said
  it went with `HiveNowLine`'s place; the bar takes the sidenav's words, in the paused tone.
- **Approve plan waits for the agent's input**: typed at once, as the first build did, the text
  reached a terminal still opening and its Enter was lost. `OpenedTerminal.submit` types once the
  agent's input is drawn, as V78's paste does, and sends Enter as its own write. A reply of
  several lines is typed as one line: a line break typed would send it early.
- **The head's agent mark** (V53, in the old state line) is gone with the line; the card keeps
  it, and the agent's tab names it.
- **A shell's × is always shown** (term.css's `.stab .x`), 24 px: shown only on hover it was out
  of the targets spec's sight; always shown at 20 px it failed it.
- **Two names taken**: the side card's region is "What its agent does" (the Activity tab has a
  "Now"), the head's "started" `.workspace-since` (the Brief tab has `.workspace-started`).
- **The head's line**: what the agent runs on is plain text and takes only the room left (flex
  shrinks in proportion, so no factor makes one item give way first: every item lost a pixel and
  got an ellipsis), then the branch gives way.
- **A pane clips its terminal**: with a gone worktree, xterm was fitted before the error line
  above it showed and overflowed 38 px onto the bar.
- **`WorkspaceStrip.tsx` removed**; its Respond is the bar's "Answer in its terminal" on the other
  tabs, its Next waiting the bar's.
- **Not built, as planned**: search in the terminal, a tool-call count, a shell's command line and
  port. Hive stopped at the round cap was not shot (the e2e harness has no quick way there); its
  steps are unit-tested.

**Results.**

- Tests first: `workspace-steps.test.ts` (14) and `terminal-bar.test.ts` (10) red on missing
  modules, StageTrack's `you` red on its label; `terminal-view.spec.ts` (6) and the Split fit
  red on missing parts. `pnpm check`: 2,930 tests pass; `pnpm build` passes.
- e2e: `pnpm test:e2e` all pass: the viewer's 405, the nexus's 20 (the first full run: 25 specs failed, 21 naming what moved, 4 real faults, each fixed).
- A key to its echo (V21's method, 30 keys, three runs): median 4 ms, max 7–9 ms before;
  median 4 ms, max 7–8 ms after.
- Screenshots: 34 before (this branch at `main`) and 40 after (Split, Focus and Hive in Focus are
  new), every state of the brief at 1×, both themes, beside the proofs:
  `spikes/v89-workspace-terminal/shots/`, and the page <https://claude.ai/artifact/PKqtWPXW8rxCtQ61Rj4gRF> (private).
- The README's `docs/images/workspace.png` and `hive.png` show the page before V89 (the waiting
  strip, the Terminal tab, the state line). Not retaken here.
