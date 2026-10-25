# Refactor — the CLI's services and the viewer's pages in modules one can read

[Index](../PLAN.md) · [Journal](../journal/refactor-readability.md)

**Status:** ready for review (2026-10-25), on branch `refactor/codebase-refactoring-readability`
(a workspace started in Symbiote, from `main` at `c137455`). As built and results under "As built
(the CLI and the viewer)" below.

**Problem** (the brief: "files with too many lines of code, mixed responsibilities, and logic
that is difficult to follow … the goal is to reduce cognitive complexity", behaviour unchanged).
Measured at `c137455` (64,234 lines of source in `packages/*/src`, `scripts/`, `action/`). Most
of the length is a few factory functions that hold a whole service in one closure, and page
components:

| File | Lines | What is in it |
|---|---|---|
| `packages/cli/src/workspaces.ts` | 3,003 | Seven concerns: the record on disk, kinds of work and the brief, start branches, Claude Code's driver (≈560 lines), the effort and model checks, the config, and `workspaces()`, a 1,502-line closure |
| `packages/cli/src/server.ts` | 1,844 | `startViewServer`, 1,161 lines: `handle()` a 300-line `if` chain in which Scout's and Scribe's routes repeat each other; 480 lines of request parsers |
| `packages/cli/src/merges.ts` | 1,133 | `merger()`, an 857-line closure: the queue file, merging, checks, the conflict resolution (`resolve`, 128 lines), landing, locks |
| `packages/viewer/src/history/HistoryPage.tsx` | 1,260 | The API client, `History` (742 lines), `CommitRow`, `DiffProgress`; the diff's page imports `DiffProgress`, `fetchGraph`, `startDiff` and `BackLink` from it |
| `packages/viewer/src/workspaces/Workspace.tsx` | 1,065 | `WorkspacePanel`, 667 lines (a 357-line JSX return); the sidenav imports four small parts from it |
| `packages/viewer/src/workspaces/StartPage.tsx` | 767 | `StartForm`, 606 lines (a 404-line JSX return) |
| `packages/viewer/src/diff/App.tsx` | 917 | `App`, 476 lines: loading and polling the graph, review state, keys, the page |

- Import cycles: in the CLI `workspaces ↔ codex` (`runProgram`, `WorkspaceFile`), `workspaces ↔
  terminal` (`OpenFolder`), `server → workspaces → reviews → server` (`StateStore`); in the
  viewer one of types only (`history/commits → branchReviews → checkout → commits`).
- Core and the plugins are in better shape: `FileExtractor` is 720 lines in about 50 methods
  of 14 lines on average; `pipeline.ts`'s longest function is 137 lines.
- Baseline: `pnpm check` passes, 1,572 tests in 113 files (50 s).

**Goal**: each service's concerns in modules of their own, each factory closure holding only what
needs its state, the pages' data access and shared parts out of their components. **Unchanged**:
behaviour (the tests' assertions, `pnpm check`, the e2e suite), every exported name's behaviour,
routes and JSON, every class name and every CSS rule.

## Conventions (applied to every file touched)

- **The CLI keeps one folder, its files named area first** (`workspace-record.ts`), as
  `merge-agent.ts`, `scout-gate.ts` and `codex-run.ts` already are (decision 344).
- **A factory keeps only what needs its state**: a helper that needs none moves to module level,
  in its topic's module, with its inputs as parameters (decision 345).
- **A type lives with what implements it** (`OpenFolder` with `vsCodeFolder` in `editor.ts`,
  `StateStore` with `fileStateStore` in `state.ts`), which also ends the CLI's cycles.
- **No re-exports**: every importer, tests included, imports from the new module; in tests only
  import lines change (decision 346).
- **Viewer**: data access and components another page uses get files of their own; a hook only
  where state and effects are one unit, called where the code was so effects keep their order;
  CSS and class names do not move (decision 347).

## CLI

1. `programs.ts`: `runProgram` (from `workspaces.ts`), `runWithInput` (from `merge-agent.ts`),
   `runShell` (from `merges.ts`) — the three ways the CLI runs a program.
2. `claude-code.ts`: Claude Code's driver (`claudeCode`, `ClaudeCode`), what it lists and
   answers (sessions, effort levels, models, account), `findClaude`, a workspace's agent state
   (`agentState`), the hooks' settings file. Codex's counterpart is `codex.ts`.
3. `agent-levels.ts`: the effort and model checks workspaces, Scout and the merger share.
4. `workspace-record.ts` (the record file, `WorkspaceRefused`), `workspace-brief.ts` (kinds of
   work, the brief, a start's brief checked, the prompt), `workspace-documents.ts` (uploads),
   `workspace-changes.ts` (commits and files since the fork point, the files a diff opens with).
5. `workspaces()`: its helpers of `where` alone at module level; its Codex branches in
   `workspace-codex.ts` when they move without handing the service's own functions around.
6. `server-requests.ts`: the parsers. `handle()` a dispatch over named route groups; Scout and
   Scribe one `pageAgentRoutes`. `StateStore` and `StateName` to `state.ts`.
7. `merges.ts`: the queue file in `merge-queue.ts`, `resolve()` in its named steps.

## Viewer

8. History: `history/api.ts` (the calls), `diff/DiffProgress.tsx` (with `BackLink`: the diff's
   page draws them), `history/CommitRow.tsx`, a hook for branch reviews.
9. Workspace: `WorkspaceFacts.tsx` (what the sidenav draws too), `WorkspaceThread.tsx`,
   `WorkspaceBrief.tsx` (not `Brief.tsx` beside `brief.ts`: macOS), a hook for the changes
   panel.
10. Start a workspace: `StartForm`'s sections as components.
11. A diff: `useDiffGraph` (load, poll, retry, drop), `useReviewState` (marks and drafts),
    `Canvas.tsx`.

Then, where the same pattern applies cleanly: `SkillsPage`, `AgentTerminal`, `MonitorPage`,
`Sidenav`, `scout.ts`, `reviews.ts`.

## Verification

1. Each step: `pnpm check` (format, lint, types, 1,572 tests) and `pnpm build`; the e2e suite
   after each viewer step and at the end (it runs a real `symbiote view`: the routes too).
2. The tests' assertions: a script reads `git diff main -- packages/*/test` and finds no
   changed line but import specifiers, and the one path in `naming.test.ts` (decision 348).
3. Moves verbatim: Symbiote's own diff of the branch (`symbiote diff main HEAD`) lists moved
   symbols as moved and unchanged; every symbol it lists as modified is read in the diff.
4. No import cycle left in the CLI; no new dependency.

**Risks**

| Risk | Mitigation |
|---|---|
| A moved effect runs in another order | Hooks called where their code was; e2e |
| A helper hoisted out of a closure reads state it no longer sees | Only helpers of their parameters move; types and tests |
| A runtime path moves (hooks, the Codex runner, `dist/app-server.js`) | No entry point moves (decision 344) |
| The cascade changes | No CSS moves (decision 347) |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 344 | Folders for the CLI, as the viewer got (257)? | **No: one folder, files named area first** | The hooks (`agent-hook.js`, `scout-hook.js`, `scribe-hook.js`), the gates and the Codex runner are found beside their importers at run time and their paths written into settings files on disk; the e2e harness imports `dist/app-server.js`. Area-first names already group them (`merge-agent.ts`, `merge-log.ts`, `merges.ts`). |
| 345 | What stays in a service's closure | **Only what reads its state** (caches, maps, the injected finders); the rest moves to module level, in its topic's module, inputs as parameters | Which helper depends on what shows in its signature; the closure reads as the service's operations. |
| 346 | Re-export moved names from the old module? | **No**: importers and tests import from the new home | A re-export hides where code lives; the tests' assertions stay as they are, only their import lines change. |
| 347 | What moves in the viewer | **Data access, components another page draws, hooks of one unit; no CSS, no class name** | The cascade is the order of `styles.css`'s list (258) and the e2e suite finds elements by class. |
| 348 | `naming.test.ts` names the files where `feature` may be an identifier | **Its one path for the kinds of work becomes `workspace-brief.ts`** (asked and agreed, 2026-10-25) | The rule it checks is unchanged; keeping the kinds of work in `workspaces.ts` would part them from the brief they define. |

**Not in this refactor**: core and the plugins (cohesive, and an analysis change needs the
real-repository comparisons); `koi-intro.ts` (the person's, kept as delivered); the CSS;
`main.ts` (a function per command beside its help: its length is help and wiring, not mixed
concerns); bugs found on the way (in the journal, not fixed).

## As built (the CLI and the viewer)

- **Three workspace modules where two were planned**: the record reads the brief's parts
  (`BRIEF_PARTS`, `ORDER` before) and a start's checks throw the record's refusal, so a record and
  a brief alone made a new cycle. `workspace-brief.ts` (pure) ← `workspace-record.ts` ←
  `workspace-start.ts` (where it starts — `startPoint()`, 25 lines of `start()` before —, its
  brief checked, its prompt).
- **`workspace-codex.ts`** is `workspaceCodex({ codex, now, env })`: it needed no function of the
  service once the record's write and reads moved to the record (`writeRecord`, `readRecord`,
  `readRecords`). Codex's reply returns nothing; the service reads the summary after it, as both
  Codex paths did at their end.
- **The server's routes**: `handle()` is six lines; `repositoryRoute()` gives each service's API
  prefix to its group (`workspacesRoute`, `pageAgentRoute` for Scout and Scribe, `mergesRoute`).
  Each group ends in the `serveSite` fallback `handle()` reached, so an address under a prefix no
  route takes answers as before (405 for a write, 404 for a read). Kept in `server.ts`: the groups
  use the server's request helpers, which read its hosts and its one-at-a-time sets.
- **The viewer's tabs and boxes**: `ThreadTab.tsx` and `BriefTab.tsx` (not `WorkspaceThread.tsx`:
  `WorkspaceThread` is core's type), `WorkspaceTabs.tsx`, `ReplyForm.tsx`, `StartKinds.tsx`,
  `StartAgent.tsx`, `CompareBar.tsx`; their JSX moved as it was, their state stayed with the page.
- **Effects that run earlier**: `useChangesPanel`'s `]` listener (before the shells are read),
  `useDiffGraph`'s polling (its first step only starts a fetch) and `useReview`'s read of the
  store (before the title and the reset effects, which touch other state). No two of them read
  what the other writes.
- **Shared once**: `AGENT_NAMES` (three copies) in `agent-levels.ts`; `real()` (three) from
  `thread.ts`.
- **Not done** (the second pass's candidates): `SettingsPage.tsx` (837 lines, five components:
  the prebuilt agents' page and the prompt editor could be files of their own), `SkillsPage.tsx`
  (688: its editor and new-skill form), `AgentTerminal.tsx`, `MonitorPage.tsx`, `Sidenav.tsx`
  (one cohesive component each), `reviews.ts`, `app-server.ts`. Left: the viewer's type-only cycle
  (`history/commits → branchReviews → checkout`), `plural` defined in several files (one line
  each).

**Results** (main at `c137455` → the branch's 14 commits):

| File | Lines before | After | Now beside it |
|---|---|---|---|
| `cli/src/workspaces.ts` | 3,003 | 1,263 | `claude-code.ts` 581, `agent-levels.ts` 76, `programs.ts` 132, `workspace-record.ts` 258, `workspace-start.ts` 235, `workspace-brief.ts` 111, `workspace-documents.ts` 141, `workspace-changes.ts` 134, `workspace-codex.ts` 343 |
| `cli/src/server.ts` | 1,844 | 1,437 | `server-requests.ts` 467 |
| `cli/src/merges.ts` | 1,133 | 1,055 | `merge-queue.ts` 67 |
| `viewer/…/HistoryPage.tsx` | 1,260 | 832 | `api.ts` 123, `CommitRow.tsx` 135, `CompareBar.tsx` 126, `useBranchReviews.ts` 35, `diff/DiffProgress.tsx` 85 |
| `viewer/…/Workspace.tsx` | 1,065 | 649 | `WorkspaceFacts.tsx` 101, `ThreadTab.tsx` 102, `BriefTab.tsx` 50, `WorkspaceTabs.tsx` 125, `ReplyForm.tsx` 95, `useChangesPanel.ts` 55 |
| `viewer/…/StartPage.tsx` | 767 | 593 | `StartKinds.tsx` 68, `StartAgent.tsx` 170 |
| `viewer/…/App.tsx` | 917 | 542 | `Canvas.tsx` 209, `useDiffGraph.ts` 139, `useReview.ts` 67 |

- The closures: `workspaces()` 1,502 → about 940 lines (its state, `summary`, its 20 operations);
  `startViewServer`'s `handle()` 300 → 6.
- **Import cycles**: the CLI's three are gone; the viewer's one (types only) is left.
- **Symbiote's own diff of the branch** (`symbiote diff main HEAD`, 9 s): 156 symbols moved, every
  one with the same body hash; 43 of them with another signature (an `export` added, or renamed:
  `ORDER` → `BRIEF_PARTS`, `Brief` → `BriefTab`, `Thread` → `ThreadTab`). 10 changed in place: the
  eight closures and components restructured (`workspaces`, `startViewServer`, `merger`,
  `pageAgent`, `History`, `WorkspacePanel`, `StartForm`, `App`), `vsCodeFolder` (returns
  `OpenFolder`) and `real` (exported). 48 added (the helpers out of closures, the hooks, the new
  components, `workspaceCodex`, `mergeQueue`, `startPoint`, `writeAnswer`), 13 removed (the
  duplicates, and types re-declared beside what uses them).
- **Tests**: `pnpm check` 1,572 tests in 113 files at each of the 13 code commits; 8 test files changed, a
  script finding nothing in them but import declarations and `naming.test.ts`'s one path
  (decision 348). e2e 240 of 240 after the CLI's routes, the History split (with the merger's
  queue), the Workspace split, the Start and diff splits, and on the branch's last commit.
- No dependency, `package.json`, core, forge, monitor, plugin or desktop file changed.

Not verified: the desktop app's window beyond what its e2e specs show; screenshots against
`main`'s (the class names and CSS are unchanged, and no element moved in the DOM); Codex and
Claude Code themselves (the tests use fakes, as on `main`).
