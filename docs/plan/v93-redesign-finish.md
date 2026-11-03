# V93 — Redesign finished: every page as its proof

[Index](../PLAN.md) · [Journal](../journal/v93-redesign-finish.md)

**Status:** merged into `main` on 2026-11-03; built (3 November 2026), on branch `feature/redesign-finish` (the workspace's, from
`main` at `eb5f9e4`); the person's OK with one rule for every choice: "Should be like in design."

**Problem** (the brief: "I need everything to look like in the screenproofs"; "I know for sure
that workspaces cards don't look like in the design"). V88–V92 built the redesign's five steps;
normal mode's Merge (05-merge) and Start (06-start) were never built, and no step redesigned normal
mode's sidenav cards. Measured on `main`'s build at 1440 × 900, 1×, with the proofs' records
(`e2e/overview-data.ts`) beside `spikes/normal-redesign` and `spikes/hive-redesign`:

| Part | The proof | `main` |
|---|---|---|
| The sidenav's width | 260 px | 300 px (decision 581) |
| Its top row | a 24 px mark, the repository at 15 px 600, a bare fold icon | a 28 px mark, 18 px, a framed fold button |
| Its pages | 30 px rows, 31 px apart, a hairline before Workspaces | 32 px apart, no hairline |
| Workspaces' head | 13 px 600, a bare + | 15 px, a count pill, a framed + |
| A group's heading | faint 13 px name and a count pill | an icon, a 15 px muted name; Waiting for you a framed box |
| Normal mode's card | two lines, about 52 px: the state's icon and the title; the state's word bold, facts, time | up to five lines, about 150 px (V79, V83): title and time, state, Respond and the kind, the model, the branch |
| Rows in view at 900 px | all nine, Done today folded | the merge and two waiting cards; To review at y = 800 |
| The status bar's left | `main 7aeb0ad`, "4 wait for you", "2 agents working" (Hive: Hive on, in flight, landed today) | nothing |
| 05-merge | a head with the state pill, a track (Approved, Merge, Check, Land), Queue and Time, the steps on a timeline, Log and Changes | V26's chips, one line, "Waiting for its turn", the log |
| 06-start | the kinds as line tabs, the fields, the merge's check, Source, Agent (agent, model, permissions, effort segmented), Plan first, What happens next | V63's page: the S's art, Clear, a card a field, an effort slider, the "Be specific" tip |
| 02/03/07 | a pipeline card under the head | the steps inline in the head (decision 823) |
| The side card | 300 px | 256 px (V89) |
| A review | no zoom to the picked symbol, a 336 px detail, Open ↗ per use, syntax colours | zoomed, 400 px, none, none (decision 845) |
| Settings' list | plain icons, 31 px rows | tinted tiles (decision 600), 29 px rows, a 300 px list |

**Goal**: every proof (both modes, both themes, each state they draw) and an after-screenshot of
the app beside it on one review page, matching, the sidenav's cards included; what is not drawn
because Symbiote cannot know it listed with why. What Symbiote records changes only by small,
read-only additions to what the merger and the server already write (choice 8). Hive, the merger
and the agents behave as today. Pages the proofs never drew (Git, Skills, Monitor, History, Nucleus,
Alpha Ceph's page) keep the tokens as they are. Performance as measured in V89–V92.

## The method

- **One screenshot spec** (`packages/viewer/coverage/v93/`, ignored) renders the app at each
  proof's state from the proofs' records: the Overviews' and Hive pages' mocks, extended with the
  merge, the start page and the reviews; the e2e fake agent for the terminal and plan states; the
  repository named `storefront`. Both themes for every screen: where a proof exists only dark, its
  light one is rendered from `src/*.html?theme=light` with the spikes' `shoot.mjs`.
- **The review page**: every pair side by side, both themes, the differences listed under each,
  fixed or kept with why.

## The sidenav (decisions 875–878)

- **260 px at first** (875, supersedes 581); dragging stays (V34). Start's run column (585) follows
  the proof's 380 px.
- **Normal mode's rows** (876, supersedes 576, 579 and 580; replaces 662's card row and V48's
  Respond on the card): `kit.css`'s `.ws`, two lines — the state's icon (violet the person's turn,
  amber spinner the agent's, the merge icon), the title cut with "…"; the state's word in 500
  `--muted`, then facts and time faint. The words come from a new pure `rowWords()` in
  `workspaces.ts`, tested per state first. What leaves the card (the branch, the kind, the model and
  effort, the facts' words, the whole state) goes into the row's tip. Respond stays on the
  Overview's inbox, the bar under the terminal and Enter on a row. A conflict, a worktree gone, a
  failed or stopped agent take the second line in their state's colour.
- **Groups** (877, replaces V44's group icon and 859's kept Done icon): Merging, Waiting for you,
  To review, Working, Done today folded, as `nkit.js`: a faint name and a count pill, no icon, no
  box. Hive's groups (868) take the same heading.
- **The chrome** (878): the top row, pages, the hairline, Workspaces' head, the foot, as
  `kit.css`'s `.nav-*`; the rail keeps its icons.

## The status bar (decision 879)

Its left side, as the proofs: the checkout's branch and short commit; "N wait for you" in violet;
"N agents working" with the spinner; in Hive mode the Hive pill's dot, "Hive on", in flight and
landed today, the branch. From the reads the sidenav already makes.

## 05-merge (decisions 880–882)

- **The page** (880): the head (title → into, branch, "approved by you at …", the queue position;
  the state as a status pill; Take out of the queue secondary); a track card (Approved, Merge,
  Check, Land, each with its line) with Queue and Time cells; Steps as a timeline (the approval
  with its words, the merge with its commits, the check's commands with their times, Land, a note
  on what a failure does); Log and Changes as tabs (the merge log as today, the merge's files).
  Conflicts, the resolution, failed and needs-you keep their content, in the same frame.
- **What the merger writes** (881, read-only for it): the check's `started` and each command's
  `steps` (`command`, `ms`, `ok`), and the merge step's `mergeMs`. A command's expected time is the
  last passing check's with the same commands, derived in the viewer.
- **Which review approved it** (882): the review list serves the verdict's number among the
  branch's verdicts and its text ("your review, 2nd", the quote).

## 06-start (decision 883)

Normal mode's Start as the proof: the kinds as line tabs in the form's card head; Title, Goal, Done
when; the merge's check line (from `/api/hive/state`'s `check`, V92's read); More folded; Documents
as one row; on the right Source (starts from, branch), Agent (agent, model, permissions, effort as
a segmented control), Plan first, and What happens next (from Plan first and the target, pure and
tested). Clear, the S's art and the "Be specific" tip go, as V92 did in Hive mode.

## The rest, page by page (decisions 884–893)

- **The pipeline card** on a workspace (884, amends 823): the proofs' 02, 03 and 07, its steps,
  then Turn and Commits (normal) or round, time and spend (Hive); the terminal's rows measured
  before and after.
- **The side card 300 px** (885, amends V89's 256) and its sections as the proof (02: Workspace,
  Brief, Commits, Files); the terminal's columns measured before and after.
- **A review** (886–890): the canvas framed as the proof (not zoomed to the picked symbol); the
  detail 336 px; Open ↗ per use; syntax colours in diffs (889, supersedes 845) from a small
  tokenizer of our own for TS, JS and HTML (keywords, strings, comments, called names), no new
  dependency, measured on a 2,000-row diff; a finding's message as its title (890: a finding records
  one message; splitting it would be a detector change).
- **Settings' list** (891, supersedes 600 and 602's tile): plain icons, the proof's rows, every
  entry kept.
- **Findings per workspace** (892): the Overview's "Findings to read" and a row's "1 error · 2
  warnings", from the graph of the workspace's change when this `symbiote view` has analyzed it;
  absent otherwise (no analysis is started for it).
- **What else the proofs show that Symbiote does not record** (893): a tool-call count and a
  shell's command line; each measured and recorded only if a small read-only addition, else kept
  and listed with why.
- **Every other difference** the pairs list: heads, the composer, tab order, spacing, type, icons,
  copy, in both modes and themes.

## Verification

1. **Unit, red first**: `rowWords` (every state), the merge's steps and expected times, Start's
   What happens next, the tokenizer, the server's new fields (steps, `mergeMs`, the verdict's
   number and text, findings).
2. **e2e**: the specs that read the old cards follow the rows; new ones for the Merge page, Start,
   the status bar, Open ↗; `page-frame`, `targets` and `tokens.test.ts` kept, any change named.
3. **The pairs**: every proof beside the app, both themes, on the review page.
4. **Cost against `main`'s own build, alternated**: a key's echo (V21's method), the terminal's rows
   and columns, first paint (`/overview`, `/git`, Bitwarden `737ee3f`), select, mark and pan on
   Bitwarden's graph, the arrival's fps (V92's `measure-app`), the tokenizer on 2,000 rows.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| The pipeline card costs the terminal rows | Measured and recorded, the person's choice |
| Syntax colours slow a big diff | Tokenize per line, memoised per file; measured on 2,000 rows |
| Many specs read the old cards | Keep class names where their meaning holds; update the rest |
| `codex.spec.ts:148`, `terminal-view.spec.ts:165`, `workspaces.spec.ts:510`, `hive-pacing.spec.ts:108`, `intro.spec` flaky under load | Rerun alone, report |

**Order**: plan; the sidenav and the status bar; 05-merge; 06-start; the rest page by page; the
review page, the costs, the docs and the README's screenshots.

**Proposed decisions** (the person's answers: "Should be like in design"):

| # | Question | Decision | Why |
|---|---|---|---|
| 875 | The sidenav's width at first (supersedes 581) | **260 px; dragging stays** | the proofs; choice 1 |
| 876 | Normal mode's sidenav cards (supersedes 576, 579, 580; replaces 662's card row and V48's Respond on the card) | **Two-line rows: icon, title; state's word, facts, time; the rest in the tip; Respond on the Overview, the terminal's bar and Enter** | `nkit.js`; choice 2 |
| 877 | A group's heading (replaces V44's group icon and 859's kept Done icon) | **A faint name and a count pill; no icon, no box** | the proofs; choice 3 |
| 878 | The sidenav's chrome | **`kit.css`'s top row, pages, hairline, Workspaces' head and foot** | the proofs |
| 879 | The status bar | **Branch and commit, wait for you, agents working; in Hive mode Hive on, in flight, landed today** | the proofs; from reads already made |
| 880 | The Merge page | **Head, track with Queue and Time, Steps timeline, Log and Changes** | proof 05 |
| 881 | What the merger writes | **The check's start and each command's time and result; the merge step's time** | choice 8: read-only for the merger |
| 882 | Which review approved | **The verdict's number and text in the review list** | "your review, 2nd" |
| 883 | Start in normal mode | **Proof 06's layout; What happens next; no Clear, art or tip** | proof 06 |
| 884 | A workspace's steps (amends 823) | **The pipeline card on 02, 03, 07** | choice 4 |
| 885 | The side card (amends V89's 256) | **300 px, the proof's sections** | choice 5 |
| 886 | A picked symbol in the graph | **The canvas framed as the proof; no zoom to the symbol** | choice 6 |
| 887 | The detail panel | **336 px by default** | choice 6 |
| 888 | A use | **Open ↗ beside each** | choice 6 |
| 889 | Syntax colours (supersedes 845) | **Our own tokenizer for TS, JS, HTML: keywords, strings, comments, called names** | choice 6; no dependency |
| 890 | A finding's title | **Its message; no why line unless recorded** | a finding records one message |
| 891 | Settings' list (supersedes 600 and 602's tile) | **Plain icons, the proof's rows, every entry** | choice 7 |
| 892 | Findings per workspace | **From the graph this server analyzed for its change; absent otherwise** | choice 8: no analysis started |
| 893 | A tool-call count, a shell's command line | **Recorded if a small read-only addition; else kept, with why** | choice 8 |
| 894 | The workspace head's actions (found beside proofs 02 and 08) | **Open in VS Code as the head's boxed ‹›; Stop the agent in the ⋯ menu; the head's icon buttons boxed** | the proofs' head draws no Stop |
| 895 | Hive's pipeline card and Run tab (amends 884 for Hive; found beside proofs 02, 03, 07) | **Each step's detail from Hive's record, a mark a round, the spend's bar, the stage's pill; Run first; no bar under it** | the proofs |
| 896 | Settings' list in Hive mode (amends 891) | **The Hive group first, Hive mode and its reviewer leading it; every entry kept** | proof 04; choice 7 |

**Not in V93**: pages the proofs never drew; how Hive, the merger or an agent runs; any analysis,
detector or graph JSON change.

## As built

Built as planned, decisions 875–893, and three more the pairs found (894–896). Every proof sits
beside the app in both themes on the review page (built from `packages/viewer/coverage/v93/`, not
committed); each difference is fixed or kept there with why.

- **The sidenav, the status bar, Merge and Start** as planned (875–883). A workspace with a live
  merge shows only under Merging. Start drops Clear, the S's art, the "Be specific" tip and the
  "?" helps, as the proof; a model's description moved into its tip.
- **The pipeline card** (884) on every workspace view but its terminal's: on the terminal the
  steps stay in the head, so **the terminal loses no row**. Hive's card reads Hive's record
  (895: `hive-pipeline.ts`, pure, five tests): "4 of 4 · 7:23 of ~10 min" with a bar against the
  last passing check, "Opus · high", "merge queue → main, push", "passed in 38 s", "approved ·
  $0.42", "20c37bc in main · pushed", "failed: pnpm test:e2e", "not run on round 3"; one mark a
  round; the spend against its budget; the head's pill "Checking · round 2 of 3", "Landed in main ·
  pushed", "Stopped · 3 of 3 rounds". A stop is read from Hive's record: the list's summary has no
  check, and the stop showed on Write. A stopped run's time ends at its last check.
- **The side card** 300 px (885), its rhythm the kits' (12 px over a section, facts 9 apart);
  outside the terminal its Workspace facts and the brief first. The terminal is 102 × 39 against
  main's 103 × 39: the sidenav gave back 40 px of the side card's 44.
- **The head** (894): Open in VS Code is the boxed ‹›; Stop the agent is in ⋯ and the head says
  "Stopping the agent…" meanwhile; tabs carry the proofs' icons; the branch is in mono.
- **A review** (886–890): the first layout fitted whole at most at 1×, once drawn (React Flow's
  own first fit ran before the worker's layout); a pick pans only when the symbol is out of view,
  and from the map (a wide change fits at about 0.3×) comes to 1×. The sidebar 320 px, the detail
  336, Open ↗ per use, our own tokenizer for colours. A head with an end (Files, Graph) is centred
  in the 64 px head: it stood 11 px high.
- **Settings** (891, 896): the line under the title by mode, no Help; plain icons under the group's
  words; the editor's head 51 px, its title 16 px in (`page-frame.spec` says so for Settings); an On
  or Off pill on Hive mode; selects at most 168 px; in Hive mode the Hive group first.
- **The rail** 52 px with 32 px icons, 4 apart, as the proofs (48 and 31 before).
- **The composer** two lines to start, about 110 px as proof 02 (183): a page hint's 24 px padding
  had made its foot 82 px.
- **Found on the way**: History's and Nucleus's tab strips had lost their line tabs with V89's
  strip (grey default buttons); they take the same style again.

**What Symbiote records now** (choice 8):

| Item | As built |
|---|---|
| A merge-check command's own time and result, when the check started | Recorded by the merger (881), read only for the page |
| A command's expected time | Derived in the viewer from the last passing check of the same commands |
| The merge step's time | Recorded (`mergeMs`, 881) |
| "your review, 2nd" and the approval's words | Served from the review's verdicts (882) |
| Findings per workspace | From the graph this `symbiote view` analyzed for its change (892); none otherwise: no analysis is started for it |
| A tool-call count | Counted from the lines the hooks already write, this turn's tool starts (893); Codex's reasoning is not one |
| A shell's command line and port ("npm run dev, :5173") | **Kept**: only the foreground program's name is recorded; the rest needs `/proc` and socket reads, a change to how shells are watched |
| The reviewer "sandboxed" | **Kept**: not recorded with a review |
| Permissions in the side card | **Kept**: the list's summary does not carry the agent's permission mode |

**Kept, with why** (each on the review page):

- A finding's title is its message (890): a title and a why line would need a detector and graph
  JSON change.
- The agent's tab is named for its agent and comes first (827); in Hive mode Run comes first
  everywhere, though proof 08 puts the writer first.
- No Attach on the Thread tab's composer: images attach to a terminal's message.
- Take out of the queue only while queued: the merger never stops a check it runs.
- Round 1 stays folded on a landed run (861; proof 07 folds, 03 shows it open); a passed check
  keeps its commands listed (`hive-loop.spec` reads each command's time).
- Clean up stays in a landed workspace's head (V55): its next action.
- The graph's legend keeps Focus, Context and Type references; every Settings entry stays (choice 7).
- The kits (06, 07) are sheets of parts: each part is checked in the pages that use it.
- The arrival is measured as frames per second, not as stills.

## Results

Against `main`'s own build (`git archive` of `eb5f9e4`), alternated, 1440 × 900, headless:

| Measure | `main` | V93 |
|---|---|---|
| A key to its echo (30 keys, 3 runs) | median 4, 4, 4 ms; max 8–9 | median 4, 4, 3 ms; max 7 |
| The agent's terminal | 103 × 39 | 102 × 39 |
| First contentful paint, /overview (median of 5, 3 runs) | 56, 64, 52 ms | 60, 64, 60 ms |
| First contentful paint, /git | 48, 52, 56 ms | 56, 56, 44 ms |
| Bitwarden `737ee3f`, first paint (4 runs) | 341–361 ms | 332–355 ms |
| Bitwarden, select | 114–132 ms | 97–101 ms |
| Bitwarden, mark reviewed | 36–69 ms | 33–34 ms |
| Bitwarden, pan | 63 fps | 62–63 fps |
| The arrival's first 2 s | 120 frames, 59.5 fps, one 33 ms frame | the same |
| The tokenizer, 2,000 rows of `server.ts` | — | 2.8 ms median, 8.6 max |

A first version fitted the first layout a second time when React Flow's own fit had framed it:
first paint ran a steady 7–9 ms over `main` (332–341 against 323–334). Comparing the viewport first
took it back.

Tests: `pnpm check` (3,060 unit tests); `pnpm build`; `pnpm test:e2e`: the viewer's 422 passed,
`terminal-view.spec.ts:165` (known flaky) passing alone, and the nexus's 20.
