# Refactor — The viewer's and the nexus's large files in modules one can read

[Index](../PLAN.md) · [Journal](../journal/refactor-viewer-pages.md) ·
[The first round](refactor-readability.md)

**Status:** built (2026-11-09), on branch `refactor/viewer-pages` (a workspace started in Symbiote,
from `main` at `371be1d`); ready for review. The person's OK: "Whatever you plan, do it with your
recommendations" (2026-11-09). As built and results at the end.

**Problem** (the brief: "The person finds these files too big and wants all of them done").
Eleven files of the viewer and the nexus page hold 12,764 lines. The first round
(`refactor-readability.md`, 2026-10-25) took four of them under 850 lines; they grew back (History
832 → 1,737, a workspace's page 649 → 1,320). Measured at `371be1d` by a walk of each file's syntax
tree: its top-level declarations, every function over 100 lines, and in each component the state
it declares and which of its inner functions read and write it.

| File | Lines | Its largest unit | State at its top | Shared most |
|---|---|---|---|---|
| `viewer/src/history/HistoryPage.tsx` | 1,737 | `History` 1,477 (its JSX 326) | 82 hook calls | `current` read by 22 inner functions, `relistRef` by 9; `error` written by 8 |
| `viewer/src/settings/SettingsPage.tsx` | 1,423 | `SettingsPage` 383, `PromptEditor` 228 | 22 | the agents' settings: 190 lines of data at the top |
| `viewer/src/workspaces/Workspace.tsx` | 1,320 | `WorkspacePanel` 969 (its JSX 490) | 30 | `said` written by 5 functions, `split` by 4; `opened` read by 4 |
| `nexus/src/page/main.ts` | 1,265 | `view` 93, `onKey` 84 | 25 module variables | `problem` written by 6 functions, `known` by 6, `pick` by 5; `selected` read by 8 |
| `viewer/src/workspaces/workspaces.ts` | 1,153 | `workspaceNext` 158 | pure, 58 declarations | 45 importers |
| `viewer/src/workspaces/activity/groups.ts` | 1,054 | `milestone` 149, `workGroup` 115 | pure, 50 declarations | `Context` read by 15 functions |
| `viewer/src/workspaces/Merge.tsx` | 1,034 | `MergeEntryView` 453 (its JSX 345) | 11 | 9 views of a conflict, 360 lines |
| `viewer/src/workspaces/HiveRunTab.tsx` | 1,002 | `RunFacts` 151, `HiveRunTab` 139 | 2 | 21 components and hooks |
| `viewer/src/skills/SkillsPage.tsx` | 982 | `SkillsPage` 467, `SkillEditor` 231, `NewSkill` 126 | 14 | `notice` written by 5 |
| `viewer/src/diff/App.tsx` | 946 | `App` 630 | 35 | the keys' effect 75 lines; 8 head and legend parts, 245 |
| `viewer/src/workspaces/StartPage.tsx` | 848 | `StartForm` 618 (its JSX 379) | 19 | `latest` ref read by 7 |

- **The length is in a few components and in pure files of many topics.** Five components hold
  4,147 lines (`History`, `WorkspacePanel`, `App`, `StartForm`, `SkillsPage`); `workspaces.ts` and
  `groups.ts` are pure, but each holds five topics.
- **The nexus page is one script over 25 module variables**: an ES module cannot assign another's
  `let`, so its functions cannot move as they are.
- Baseline: `pnpm check` passes, 3,428 tests in 245 files (110 s).

**Goal**: none of the eleven files over 600 lines, each new module of one concern; the pages
behave and look as on `main`. **Unchanged**: behaviour (the tests' assertions, `pnpm check`, the
e2e suite), every class name, CSS rule, text, route and JSON; no dependency.

## Conventions

In force: decisions 257–258 (a folder per area, the stylesheet's order), 344–348 (a factory keeps
only what needs its state, no re-exports, a type with what implements it; in the viewer data
access, components another page draws and hooks of one unit move, no CSS and no class name).
Added here (decisions 955–960):

- **What a split follows** (955): a page's sections become components named after what they draw
  (a card, a pane, the head's actions); state and the effects and callbacks that only it uses
  become a hook; pure derivations go to pure modules by topic. The page's component keeps the state
  its parts share and draws them. No file of the eleven over 600 lines.
- **Effects keep their order** (956): a hook is called where its first line was; a key handler that
  moves keeps its dependency list value for value. A window listener added again goes behind the
  others: an effect run less often would change which listener sees a key first.
- **A pure function that leaves a component gets a test** (957) where it has none, asserting what
  it gives today.
- **Pure files split into a graph without cycles, types included** (958): the most imported names
  stay where they are (`AGENT_NAMES`, `workspaceName`, `workspaceHref` in `workspaces.ts`); types
  several modules share go to the lowest one.
- **The nexus page: one state object, parts made by factories over a context** (959), as its list
  and card already are (`listView`, `detailView`); `main.ts` makes the elements and wires them.
- **`Workspace.tsx` last, around refactor/workspace-tabs** (960): if that branch is on `main` by
  then, `main` is merged in first; otherwise the lines it changes (the tab shown, `WorkspacePanel`'s
  lines 299–330) stay where they are.

## The modules

Each file is its own commits: whole components and functions moved first, unchanged (reviewed with
`git diff --color-moved`), then hooks and components cut out of the large ones and their inputs
narrowed. Names are checked against `test/files.test.ts` (no two differing by case) and against the
folder's own files (no `StartNext.tsx` beside `start-next.ts`).

| File | Keeps | Becomes beside it |
|---|---|---|
| `workspaces.ts` | `AGENT_NAMES`, how an agent's session opens (`talkCommand`, `opensTerminal`…), names and links (`workspaceName`, `briefTip`, `workspaceHref`, `shortAge`) | `run-choices.ts` (models, levels, a run's choices and their words: `modelChoices` … `runsOnWords`, `viaName`), `start-branch.ts` (`proposeBranch`, `branchProblem`, `startedNotice`), `workspace-next.ts` (what a workspace waits on: `workspaceNext`, `activityText`, `workspaceFacts`), `workspace-groups.ts` (the sidenav's groups, Hive's, History's chips: `workspaceGroups`, `hiveGroups`, `hiveRowWords`, `workspaceChips`, `workspacesFirst`), `thread-items.ts` (`threadItems`, `askedFor`, `replyMode`, `verdictToSend`) |
| `activity/groups.ts` | `activityGroups`, `waitingAsk`, `sameness` | `group-parts.ts` (the group's types, a run, the context, the small reads of a call), `runs.ts` (calls into runs: `runsOf`, the merging rules, debugging), `work-group.ts` (a run as a group and its words), `milestones.ts` (`milestone`, the confirm, Nucleus's and the end groups, `questionsOf`) |
| `HiveRunTab.tsx` | `HiveRunTab`, the rounds (`OpenRound`, `FoldedRound`, `RequestLine`, `FailedLanding`) | `RunFacts.tsx` (the side card's facts, Workspace's), `useHiveDetail.ts` (Hive's record, read), `RoundItems.tsx` (writer, check, review, land items), `RunLog.tsx` (a check's log tail and full log), `run-words.ts` (times and short SHAs, pure, tested) |
| `Merge.tsx` | `MergeView`, `MergeEntryView` (state, head, the output card) | `MergeFiles.tsx` (the conflicts' files and regions, 9 components), `MergeStepsCard.tsx` (the steps card, its commands) |
| `SettingsPage.tsx` | `SettingsPage`, the list and its tiles | `agent-settings.tsx` (what each prebuilt agent's and the advisor's page sets), `AgentPage.tsx` (`AgentPage`, `AdvisorPage`, their rows), `AppearancePage.tsx`, `PromptEditor.tsx` (with its `Notice`) |
| `SkillsPage.tsx` | `SkillsPage` | `SkillEditor.tsx`, `NewSkill.tsx`, `scribe-agent.tsx` (Scribe as its pane shows it); `folderOf` to `library.ts` |
| `StartPage.tsx` | `StartPage`, `StartForm` (its state, the draft) | `StartBrief.tsx` (the brief's fields: title, goal and its tools, done when, the more parts), `StartSource.tsx` (Source: starts from, branch), `NextSteps.tsx` (What happens next) |
| `diff/App.tsx` | `App` (state, the page shown) | `DiffHead.tsx` (`PageSwitch`, `DiffName`, `HeadFacts`, `FindingPills`, `SinceChip`, `WorkspaceLink`), `GraphPage.tsx` (the Graph page: sidebar, canvas card and legend with its toggles, detail panel; `DropZone`, `Legend`), `useDiffKeys.ts` |
| `HistoryPage.tsx` | `HistoryPage`, `History` (rows, cursor, picks, the page's frame) | `WorkingRow.tsx`, `git-asks.ts` (the six questions before a git write, pure, tested), `GitMenus.tsx` (the row's, a branch's and a stash's menus with their dialogs, `useGitMenus`), `useShownFile.ts` (V70's file), `useRowsInView.ts`, `useFindRows.ts` (the search), `useRelist.ts` (listing in place, decision 634), `useHistoryKeys.ts`, `useWorkingChanges.ts` (uncommitted changes, upstream, stashes, fetch/pull/push), `CommitsHead.tsx` (the rows' card head), `GitDetailsPane.tsx`; `headLine` to `details.ts` |
| `nexus/src/page/main.ts` | the elements, `render`, `select`, the page's listeners, the wiring | `state.ts` (the page's state, one object), `listings.ts` (folders' listings and checkouts, read and kept), `home-view.ts` (what the list shows, pure, tested), `home.ts` (drawing the list and the card), `strip-view.ts` (the row of tabs and its keys), `stopped-view.ts`, `actions.ts` (start, stop, open, pin, scan, copy), `field.ts` (the field and its keys, the pick, the tree's folders), `reads.ts` (what the nexus knows, the 2 s read), `dialog.ts` (Stop's and `git init`'s questions), `window-buttons.ts` |
| `Workspace.tsx` (last) | `WorkspaceView`, `NotListed`, `WorkspacePanel` (its tabs' state, the page's frame) | `WorkspaceActions.tsx` (the head's actions and its ⋯ menu), `WorkspacePipeline.tsx` (the steps card, its icons and cells), `TermPanes.tsx` (the agent's and a shell's panes), `useShells.ts` (a workspace's shells: read, opened, closed), `useWorkspaceActions.ts` (act, send, clean, a verdict typed), `SideFacts.tsx` (the side card's Workspace and Now sections); `startedAt`, `briefFirst`, `mergeOf` pure and tested |

The counts are estimates from the measured spans; the journal gives the real ones.

## Verification

1. Each commit: `pnpm check` and `pnpm build`; the e2e suite (viewer, then nexus) after each file
   and on the last commit.
2. The tests' assertions: a script compares every changed test file with `main`'s, its import
   declarations removed: no other line differs (decision 346).
3. Moves verbatim: `git diff --color-moved` on each move commit; `symbiote diff main HEAD` lists
   moved symbols with their body hashes.
4. No import cycle in the viewer or the nexus page that `main` does not have (a walk of the
   imports, types included).
5. `viewer-check`, `main`'s build (a `git archive` copy) against the branch's, back to back:
   screenshots of every page touched (Git, Settings' pages, Skills, Start, a workspace's tabs, a
   merge, Hive's Run tab, a diff's Files and Graph, the nexus) in both themes, compared pixel by
   pixel; first paint on Bitwarden's graph and `/git`, and the first script's size, within ±5 %.

**Risks**

| Risk | Mitigation |
|---|---|
| An effect runs in another order, a listener is added again less often | Decision 956; hooks with no effect move freely; e2e |
| A prop not passed: a section draws `undefined` | `strict` types (no optional prop added for what was always there); screenshots |
| An import cycle at run time in the nexus page (a `const` read before its module ran) | No cycle (decision 959); the nexus e2e |
| Conflicts with refactor/workspace-tabs, refactor/layout-flow | Workspace.tsx last (960); `flow.ts` not touched |
| Decision numbers taken by another workspace meanwhile | Checked again before finishing |

**Not in this refactor**: `graph/flow.ts` (refactor/layout-flow), `intro/koi-intro.ts`,
`ui/icons.tsx`, the CSS, `packages/cli` and `packages/core` (refactor/cli-services); bugs found on
the way (in the journal, not fixed).

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 955 | How a large page is split | **Its sections into components named after what they draw, state of one unit into hooks, pure derivations into pure modules by topic; the component keeps the state its parts share. None of the eleven files over 600 lines** | 347 extended to the five components of 600–1,477 lines; the e2e suite finds elements by class and the cascade is `styles.css`'s order, neither touched |
| 956 | Effects' order when hooks move | **A hook is called where its first line was; a moved key handler keeps its dependency list value for value** | React runs effects in the order they are declared; a window listener added again goes behind the others |
| 957 | Tests for code that moves | **A pure function leaving a component gets a test of today's output where it has none** | The brief; a moved helper with no test is only checked through the e2e suite |
| 958 | How pure files split | **Into a graph without cycles, types included: the most imported names stay, shared types go to the lowest module** | `workspaces.ts` has 45 importers; the first round left a type-only cycle in History |
| 959 | The nexus page's 25 module variables | **One state object in `state.ts`; the parts made by factories over a context (as `listView`, `detailView`); `main.ts` makes the elements and wires them** | An ES module cannot assign another's `let`; drawing and acting call each other, which a factory's callbacks resolve without a cycle |
| 960 | `Workspace.tsx` and refactor/workspace-tabs | **Last; `main` merged in first if that branch landed, else the lines it changes (the tab shown) stay in `WorkspacePanel`** | The brief; that branch changes 39 of its lines |

## As built

- **History: more hooks, and four section components the plan did not name.** With the menus out
  (`GitMenus.tsx`, 502 lines) and seven hooks (the plan's six and `useCompare`), `HistoryPage.tsx` was still 885
  lines: History's body was hook calls and 280 lines of JSX. Four more hooks of one unit each
  (`useHistoryRows`: the reads and the lanes; `useBranchesPanel`; `useWorkspaceChips`;
  `useSyncRun`) and four sections as components (`GitHead`, `CommitsHead`, `CommitList`,
  `GitDetailsPane`) took it to 591. `useRowsInView` holds `reveal`; `jump` stayed with the cursor.
- **The diff: `CanvasCard.tsx`, not `GraphPage.tsx`.** The Graph page's sidebar and detail panel
  read the state the Files page and the keys share; the canvas card (the canvas, its waiting
  words, the legend and the view's toggles) is the one section that reads only the view. Moving
  it, its keys' hook and the head's parts took `App.tsx` to 574.
- **A workspace's page: `WorkspaceHead.tsx`, `SideCard.tsx` and `useRespond.ts`.** The head's
  actions went with its whole head (the line too) and its ⋯ menu; the side card's `ChangesPanel`
  joined its two sections (`SideFacts.tsx` renamed `SideCard.tsx`); responding to the agent
  (`respond`, `message`, the respond event) is a hook of its own. `openShell` takes its `then`:
  its default was `showShell`, which the hook cannot see; the one caller without it passes it.
- **One effect that runs earlier** (decision 956 places a hook where its first line was):
  `useShells`' read of the shells (its state was at the panel's top, above the tab shown that
  reads it) now starts before `useChanges`' and `useHiveDetail`'s reads. None of the three reads
  what another writes. Every other hook sits where its first effect was: History's
  (`useWorkingChanges`, `useShownFile`, `useHistoryRows`, `useRowsInView`, `useBranchesPanel`,
  `useWorkspaceChips`, `useCompare`, `useFindRows`, `useRelist`, `useHistoryKeys`), the diff's
  keys, a workspace's `useRespond` and `useWorkspaceActions`.
- **State that moved into a section**: the merge's output toggle (`MergeStepsCard`), Start's
  goal preview and more parts' fold (`StartBrief`), a workspace's reply being typed (`typing`) and
  the verdict's fill mark (`filled`, both `useWorkspaceActions`). Each section is drawn whenever
  its parent is, so the state lives as long as it did.
- **The nexus page**: one `PageState` object (`state.ts`), rewritten by the type checker's symbols;
  then ten modules made by factories over it (decision 959). `view` and `refusedFor` take the
  state, `confirmInit` the known repositories; the list's `key` calls `onKey` through an arrow
  (the field is made after the list); the strip and the stopped panel keep their own "what I
  drew". Its `main.ts` is 211 lines.
- **Small things on the way**: 29 helpers the moves had exported went back to module-private;
  `import { type X }` lines became `import type`; WorkspaceView's doc comment, which sat above
  `TURN_WORDS` on `main`, is above WorkspaceView again; `WORKING` lives with `WorkingRow`.
- **refactor/workspace-tabs** was not on `main` when `Workspace.tsx` was split: the lines it
  changes (the tab shown, `WorkspacePanel`'s `shellNumber` … `shownShell`) are where they were,
  with the tab state around them; only the shells' state moved out above them (decision 960).

**Results** (`main` at `371be1d` → the branch's 23 code commits):

| File | Lines before | After | Beside it now |
|---|---|---|---|
| `history/HistoryPage.tsx` | 1,737 | 591 | `GitMenus.tsx` 502, `git-asks.ts` 81, `WorkingRow.tsx` 47, `GitHead.tsx` 74, `CommitsHead.tsx` 102, `CommitList.tsx` 149, `GitDetailsPane.tsx` 83, eleven `use*.ts` 36–192 |
| `settings/SettingsPage.tsx` | 1,423 | 538 | `agent-settings.tsx` 197, `AgentPage.tsx` 329, `AppearancePage.tsx` 111, `PromptEditor.tsx` 253 |
| `workspaces/Workspace.tsx` | 1,320 | 595 | `WorkspaceHead.tsx` 317, `WorkspacePipeline.tsx` 160, `TermPanes.tsx` 166, `SideCard.tsx` 163, `useShells.ts` 91, `useRespond.ts` 55, `useWorkspaceActions.ts` 169, `workspace-words.ts` 26 |
| `nexus/src/page/main.ts` | 1,265 | 211 | `state.ts` 107, `listings.ts` 107, `home-view.ts` 149, `home.ts` 149, `field.ts` 183, `actions.ts` 190, `reads.ts` 101, `strip-view.ts` 127, `stopped-view.ts` 65, `dialog.ts` 82, `window-buttons.ts` 56 |
| `workspaces/workspaces.ts` | 1,153 | 105 | `run-choices.ts` 247, `start-branch.ts` 78, `workspace-next.ts` 335, `workspace-groups.ts` 257, `thread-items.ts` 163 |
| `workspaces/activity/groups.ts` | 1,054 | 135 | `group-parts.ts` 156, `runs.ts` 270, `work-group.ts` 261, `milestones.ts` 306 |
| `workspaces/Merge.tsx` | 1,034 | 463 | `MergeFiles.tsx` 392, `MergeStepsCard.tsx` 201 |
| `workspaces/HiveRunTab.tsx` | 1,002 | 287 | `RoundItems.tsx` 449, `RunFacts.tsx` 162, `RunLog.tsx` 96, `useHiveDetail.ts` 39, `run-words.ts` 12 |
| `skills/SkillsPage.tsx` | 982 | 549 | `SkillEditor.tsx` 270, `NewSkill.tsx` 139, `scribe-agent.tsx` 37; `folderOf` in `library.ts` |
| `diff/App.tsx` | 946 | 574 | `DiffHead.tsx` 209, `CanvasCard.tsx` 188, `useDiffKeys.ts` 134 |
| `workspaces/StartPage.tsx` | 848 | 593 | `StartBrief.tsx` 213, `StartSource.tsx` 131, `NextSteps.tsx` 48 |

- **12,764 lines in eleven files → 4,641**, beside 66 new modules of 12–502 lines; none of the
  eleven over 600.
- **Tests**: `pnpm check` passes, 3,450 tests in 251 files (3,428 in 245 on `main`): 22 new tests in
  6 new files for the pure functions that left a component (`headLine`, `gitAsks`, `run-words`,
  `folderOf`, `mergeOf`/`startedAt`/`briefFirst`, the nexus page's `view`/`refusedFor`/`folderName`).
  14 existing test files changed, each in its imports only (a script compared each with `main`'s,
  its import declarations removed): 12 of the viewer's and two of the CLI's, which import
  `workspaceNext` from the viewer.
- **e2e**: 436 of 436 (viewer) and 32 of 32 (nexus) on the final viewer and nexus code (`23f96dbb`;
  the commit after it changes two CLI tests' import lines); earlier runs after
  the pure splits (436/32), after the component splits (435 of 436: `events.spec.ts`' 500 ms
  timing at 539 ms under load, 12 of 12 alone) and the Git specs after each History step.
- **Screenshots**, `main`'s build (a `git archive` copy) against the branch's, the same spec, the
  same records (fixture commits at one date, mocked records and the page's clock at one instant):
  23 pages in both themes (Git, Settings and eight of its pages, Skills and its form, Start, a
  merge, a workspace's Thread, Activity and Brief, Hive's Run tab landed, live and stopped,
  Hive's Start, a diff's Files and Graph) and the nexus in 4 states, both themes: **54 of 54
  identical, 0 pixels apart**. Masked: the sidenav's top row (the repository's name is a
  temporary folder's) and the nexus list's foot (the scan's time and duration, the server's).
- **First paint**, Bitwarden's `737ee3f` (1,288 symbols, `measure.mjs`, alternated 3 rounds):
  `main` 348, 329, 331 ms; the branch 333, 346, 331 ms (medians 331 and 333, +0.6 %); the same
  269 nodes, 135 edges and 3,124 elements. `/git` on zod (3,250 commits), 9 loads each: first
  contentful paint median 80 ms both; first rows 203 ms (`main`) and 196 ms.
- **The first script** (`index-*.js`): 1,170,056 → 1,180,498 bytes (+0.9 %); gzipped 363,232 →
  365,991 (+0.8 %): the hooks' parameters and returns, and the factories' wiring.
- **Import cycles**: none in the viewer or the nexus, types included (none on `main` either).
- No dependency, CSS file, class name, text, route or JSON changed; `packages/cli` and
  `packages/core` untouched.

Not verified: Firefox and Safari; the desktop app's window beyond its e2e specs; screenshots of
states the spec does not reach (a merge's conflicts, a workspace's terminal with a live session,
Split, the History page's menus and dialogs open) — the e2e suite drives those, the pixels are
unchecked.
