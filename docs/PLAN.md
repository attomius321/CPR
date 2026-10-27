# Symbiote — Plan (draft v0.1)

> Status: living plan, kept as an index: each milestone's plan is a file in [plan/](plan/), its
> journal (what we learn along the way) the file of the same name in [journal/](journal/), by
> date in [JOURNAL.md](./JOURNAL.md).

## North Star

**Review decisions, not lines.** Every feature must help a reviewer answer, faster than
reading the diff:

1. **What changed in behavior or contract?** (added, removed, signature, body)
2. **Who is affected?** (callers, blast radius)
3. **What is risky?** (findings)

Tie-breakers when trading off: precise beats complete (a wrong finding costs more trust than a
missing one), explainable beats clever (every finding links to code), local and fast beats
hosted.

## How the plan is kept

- **Read** the North Star and the index below, then only the files of your area. A decision by
  its number: `grep -rn '^| 246 |' docs/plan`; a term: `grep -rln <term> docs/plan docs/journal`.
- **A milestone** has a plan, `plan/<id>-<slug>.md` (status, problem, goal, design,
  verification, risks, decisions; after it is built, "As built" and results), and a journal of
  the same name, `journal/<id>-<slug>.md` (its spike, parts and merge: what was measured and
  learned, how it was verified). A fix or a chore on a branch of its own has a journal file
  only, `journal/fix-<slug>.md` or `journal/chore-<slug>.md`. Each file's third line links the
  index and its twin.
- **The v1 design** (§1–§11), its risks (§13) and decisions 1–19 and 119 (§14) are in
  [plan/design.md](plan/design.md); the phases, their milestone tables and "Proposed next" as
  it stood at V44 in [plan/roadmap.md](plan/roadmap.md).
- **Decisions** are numbered across the project and kept in their milestone's plan; the index
  gives each milestone's. 242 and 243 are each used twice (a V26 fix and V36).
- **The index**: one row per milestone, fix and chore, by area, in the order they were built.
  ✅ is merged into `main`. The ID links the plan.

## Index

### Engine and analysis

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [M0–M7, S1](plan/roadmap.md#phase-1-milestones) | Phase 1: the engine | ✅ | | [journal](journal/phase-1-engine.md) |
| [D1](plan/design.md#8-detectors-v1) | Detectors from real reviews | ✅ | | [journal](journal/d1-detectors.md) |
| [R1](plan/r1-receiver-aware-references.md) | Receiver-aware references | ✅ | | [journal](journal/r1-receiver-aware-references.md) |
| Fix | `.symbioteignore` from the working folder, with gitignore's rules | ✅ | | [journal](journal/fix-symbioteignore.md) |
| [P1](plan/roadmap.md) | One program for both sides | measured, not pursued | | [journal](journal/p1-shared-parsing.md) |
| [W1](plan/w1-multi-project.md) | Repositories with several projects | ✅ | 26–28 | [journal](journal/w1-multi-project.md) |
| Fix | a doc-comment reference crashed the analysis | ✅ | | [journal](journal/fix-jsdoc-reference-crash.md) |
| [E1](plan/e1-explained-changes.md) | Decisions and their ripples | measured | | [journal](journal/e1-explained-changes.md) |
| [L1–L2](plan/l1-l2-stylesheets.md) | Stylesheets in the graph (CSS and SCSS), and the markup that uses them | ready for review | 299–312, 329–331 | [journal](journal/l1-l2-stylesheets.md) |

### Framework plugins

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| Trial | Angular 11 trial | measured | | [journal](journal/angular-11-trial.md) |
| [A1–A2](plan/a1-a2-angular-templates.md) | Angular templates, the `angular` plugin | ✅ | 20–24 | [journal](journal/a1-a2-angular-templates.md) |
| [X1](plan/x1-plugins.md) | Plugins | ✅ | | [journal](journal/x1-plugins.md) |
| [A3](plan/a3-angular-libraries.md) | Angular library components, directives and pipes | ✅ | 25 | [journal](journal/a3-angular-libraries.md) |
| [Q1–Q2](plan/q1-q2-qwik.md) | Qwik, the `qwik` plugin | ✅ | 29–32 | [journal](journal/q1-q2-qwik.md) |

### Forges and CI

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [G1–G3](plan/roadmap.md#phase-3-milestones-github-and-gitlab) | Phase 3: GitHub and GitLab | ✅ | | [journal](journal/phase-3-forges.md) |
| [I1–I2](plan/roadmap.md#phase-4-milestones-interdiff) | Phase 4: interdiff | ✅ | | [journal](journal/phase-4-interdiff.md) |
| [C1–C2](plan/roadmap.md#phase-5-milestones-ci-both-forges) | Phase 5: CI on both forges | ✅ | | [journal](journal/phase-5-ci.md) |
| [C3](plan/roadmap.md) | GitHub annotations | proposed | | |

### The graph and its diff

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V1–V5](plan/roadmap.md#phase-2-milestones-viewer) | Phase 2: the viewer | ✅ | | [journal](journal/phase-2-viewer.md) |
| Fix | diff colours across the full line | ✅ | | [journal](journal/fix-diff-row-width.md) |
| [V6](plan/v6-navigable-graph.md) | A graph you can navigate | ✅ | | [journal](journal/v6-navigable-graph.md) |
| Feature | Change-list search | ✅ | | [journal](journal/change-list-search.md) |
| [V7](plan/v7-app-boundaries.md) | Apps in the graph | ✅ | 33–36 | [journal](journal/v7-app-boundaries.md) |
| [V8](plan/v8-smooth-viewer.md) | A smooth viewer | ✅ | 37–41 | [journal](journal/v8-smooth-viewer.md) |
| [V12](plan/v12-open-in-vscode.md) | Open in VS Code | ✅ | 60–64 | [journal](journal/v12-open-in-vscode.md) |

### History

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V9](plan/v9-commit-picker.md) | Pick two commits | ✅ | 42–46 | [journal](journal/v9-commit-picker.md) |
| [V10](plan/v10-commit-graph.md) | A commit graph (V10a) | ✅ | 47–53 | [journal](journal/v10-commit-graph.md) |
| [V11](plan/v11-checkout.md) | Checkout from the commits page | ✅ | 54–59 | [journal](journal/v11-checkout.md) |
| [V13](plan/v13-compare-mode.md) | Compare mode | ✅ | 65–67 | [journal](journal/v13-compare-mode.md) |
| [V14](plan/v14-checkout-submenu.md) | Checkout submenu | ✅ | 68–70 | [journal](journal/v14-checkout-submenu.md) |
| Fix | Compare mode at the header's right | ✅ | | [journal](journal/fix-compare-button-right.md) |
| [V10c](plan/v10c-picks-across-branches.md) | Picks across branches | ✅ | 88–90 | [journal](journal/v10c-picks-across-branches.md) |
| [V10b](plan/v10b-branches-panel.md) | Branches panel | ✅ | 91–94 | [journal](journal/v10b-branches-panel.md) |
| Fix | lanes-check and root commits | ✅ | | [journal](journal/fix-lanes-check-root-commits.md) |
| [V23](plan/v23-branches-that-need-you.md) | Branches that need you, first | ✅ | 120–121 | [journal](journal/v23-branches-that-need-you.md) |
| Fix | Compare mode's toggle stays put with wider fonts | ✅ | | [journal](journal/fix-compare-toggle-wrap.md) |

### Reviews

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V15](plan/v15-branch-reviews.md) | Branch reviews in the repository | ✅ | 71–75 | [journal](journal/v15-branch-reviews.md) |
| [V16](plan/v16-finish-review.md) | Finish a review | ✅ | 76–81 | [journal](journal/v16-finish-review.md) |
| Fix | a review's mark you can see on a badge | ✅ | | [journal](journal/fix-review-mark-visible.md) |
| [V17](plan/v17-approve-means-merge.md) | Approve means "merge it" | ✅ | 82–87 | [journal](journal/v17-approve-means-merge.md) |
| [V60](plan/v60-files-page.md) | A Files page in the review, the default: the changed files, a file's diff, comments on its lines | ready for review | 431–436 | [journal](journal/v60-files-page.md) |

### Workspaces

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V18](plan/v18-start-a-feature.md) | Start a feature: a branch, a worktree, an agent | ✅ | 95–110, 118 | [journal](journal/v18-start-a-feature.md) |
| Chore | Features → Workspaces, in the UI | ✅ | | [journal](journal/chore-workspaces-term.md) |
| Fix | "Open again" after a stop asks first | ✅ | | [journal](journal/fix-open-again-race.md) |
| [V24](plan/v24-structured-brief.md) | A structured brief | ✅ | 122–128 | [journal](journal/v24-structured-brief.md) |
| [V25](plan/v25-workspaces-home.md) | Workspaces first, History beneath | ✅ | 135–141 | [journal](journal/v25-workspaces-home.md) |
| Fix | a workspace's commits counted from its fork point | ✅ | | [journal](journal/fix-commits-from-fork-point.md) |
| [V30](plan/v30-start-page.md) | Start a workspace on a page, with the agent's effort | ✅ | 205–211 | [journal](journal/v30-start-page.md) |
| Fix | the Brief tab draws the brief as Markdown | ✅ | | [journal](journal/fix-brief-markdown.md) |
| [V33](plan/v33-start-from-branch.md) | Start a workspace from a branch | ✅ | 230–232 | [journal](journal/v33-start-from-branch.md) |
| Fix | Symbiote's git reads take no optional lock | ✅ | | [journal](journal/fix-background-status-no-lock.md) |
| [V40](plan/v40-workspace-documents.md) | Documents for a workspace's agent | ✅ | 266–270 | [journal](journal/v40-workspace-documents.md) |
| [V44](plan/v44-workspace-group-icons.md) | An icon for each group of workspaces | ✅ | 289 | [journal](journal/v44-workspace-group-icons.md) |
| Fix | the start page named the plan Claude Code's token kept from login | ✅ | | [journal](journal/fix-workspace-start.md) |
| [V43](plan/v43-changed-file-diff.md) | A changed file opens as its diff | ✅ | 285–288 | [journal](journal/v43-changed-file-diff.md) |
| [V45](plan/v45-workspace-terminals.md) | More terminals in a workspace: shells in its worktree | ready for review | 294–298 | [journal](journal/v45-workspace-terminals.md) |
| [V47](plan/v47-agent-model.md) | A model for a workspace's agent, from the agent's own list; Scout's, Scribe's and the merger's in Settings | ready for review | 336–343 | [journal](journal/v47-agent-model.md) |
| [V43](plan/v43-changed-file-diff.md) | A changed file opens as its diff | ✅ | 285–288 | [journal](journal/v43-changed-file-diff.md) |
| [V45](plan/v45-workspace-terminals.md) | More terminals in a workspace: shells in its worktree | ready for review | 294–298 | [journal](journal/v45-workspace-terminals.md) |
| [V47](plan/v47-agent-model.md) | A model for a workspace's agent, from the agent's own list; Scout's, Scribe's and the merger's in Settings | ready for review | 336–343 | [journal](journal/v47-agent-model.md) |
| Fix | a new file in a workspace's changes opens in VS Code as it is, not as a diff | ready for review | | [journal](journal/fix-workspaces-new-files.md) |
| Fix | a workspace's agent is told its worktree and branch are ready, and to make no other | ready for review | | [journal](journal/fix-initial-workspace-bug.md) |
| [V48](plan/v48-workspace-activity.md) | Workspaces that show what their agents are doing, and which wait for you | ready for review | 367–377 | [journal](journal/v48-workspace-activity.md) |
| [V53](plan/v53-workspaces-view.md) | A working agent's spinner, its mark before what it does, every workspace's kind | ready for review | 394–396 | [journal](journal/v53-workspaces-view.md) |
| Fix | a merge at work spins; the spinner a comet; Merging first in the sidenav | ready for review | | [journal](journal/fix-merging-status.md) |
| [V55](plan/v55-done-workspace-cleanup.md) | A done workspace or a landed merge, removed from its card and its head | ready for review | 403–406 | [journal](journal/v55-done-workspace-cleanup.md) |
| [V57](plan/v57-cleaning-up-card.md) | A card being cleaned up (or its merge removed): disabled, saying so, until it goes | ready for review | 411–414 | [journal](journal/v57-cleaning-up-card.md) |
| Fix | Codex's mark is OpenAI's blossom, in OpenAI's white or black | ready for review | | [journal](journal/fix-codex-icon.md) |

### Agents

### Agents

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V21](plan/v21-agent-terminal.md) | The agent's terminal in its panel | ✅ | 111–117 | [journal](journal/v21-agent-terminal.md) |
| Fix | an interrupted agent waits for you | ✅ | | [journal](journal/fix-agent-idle-after-interrupt.md) |
| Fix | agents' reports drawn as Markdown | ✅ | | [journal](journal/fix-thread-markdown.md) |
| [V20](plan/v20-other-agents.md) | Other agents | V20a ✅, V20b dropped, V20c planned | 129–134, 163 | [journal](journal/v20-other-agents.md) |
| [V27](plan/v27-codex-terminal.md) | Codex in the panel's terminal | ✅ | 154–162 | [journal](journal/v27-codex-terminal.md) |
| [V28](plan/v28-agent-prompts.md) | Every agent's prompts in the project's settings | ✅ | 165–171 | [journal](journal/v28-agent-prompts.md) |
| [V35](plan/v35-scout.md) | Scout: an agent to ask about the repository | ✅ | 236–241 | [journal](journal/v35-scout.md) |
| Fix | Scout starts at an effort level; every effort setter a stepper | ✅ | | [journal](journal/fix-scout-effort-level.md) |
| [V36](plan/v36-terminal-images.md) | Images in an agent's terminal | ✅ | 242–245 | [journal](journal/v36-terminal-images.md) |
| [V38](plan/v38-terminal-links.md) | Paths and links in an agent's terminal | ✅ | 251–256 | [journal](journal/v38-terminal-links.md) |
| [V41](plan/v41-skills-and-scribe.md) | Skills, and Scribe | ✅ | 271–278 | [journal](journal/v41-skills-and-scribe.md) |
| Fix | Attach images beside a workspace's terminal: no drop reaches the window on WSL | ready for review | | [journal](journal/fix-drop-file-in-workspace.md) |
| Fix | one Settings page per prebuilt agent (Merger, Scout, Scribe), under Prebuilt agents | ready for review | | [journal](journal/fix-scout-merger-scribe-settings.md) |
| Fix | Scribe starts at the project's effort level (`scribe.effort`), set in Settings | ready for review | | [journal](journal/fix-scribe-effort-level.md) |
| [MC1](plan/mc1-symbiote-mcp.md) | Symbiote's MCP: Scout as the person's assistant, from a workspace's start to its merge | ready for review | 358–365 | [journal](journal/mc1-symbiote-mcp.md) |
| [V50](plan/v50-scout-terminal.md) | Scout is a terminal: opened with no question; the agent, model and effort in its head | ready for review | 383–385 | [journal](journal/v50-scout-terminal.md) |
| [V52](plan/v52-scout-next-conversation.md) | Scout's head picks the next conversation: a choice starts nothing until New conversation | ready for review | 391–393 | [journal](journal/v52-scout-next-conversation.md) |
| [V58](plan/v58-hermes-agent.md) | Hermes as a workspace's agent, in its terminal | ready for review | 415–421 | [journal](journal/v58-hermes-agent.md) |
| Fix | Scout's head on one line: Effort and its stepper centred with the selects | ready for review | | [journal](journal/fix-scout-not-aligned.md) |
| [SK1](plan/sk1-skill-library.md) | A skill library: a folder or repository of skills outside the project, on the Skills page and for Scribe; commits as set | ready for review | 426–430 | [journal](journal/sk1-skill-library.md) |

### The merger

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V26](plan/v26-merger.md) | A merger | ✅, V26b dropped | 142–153, 164, 242–243 | [journal](journal/v26-merger.md) |
| Fix | `symbiote/merge.md` can be committed | ✅ | | [journal](journal/fix-merge-md-shared.md) |
| Fix | Merge into names no branch; the dropdown does | ✅ | | [journal](journal/fix-merge-into-main-button.md) |
| Chore | the merge page remake, built | ✅ | | [journal](journal/chore-lost-feature.md) |
| Fix | a resolution's failed check is said, not taken for a wrong one; Check again | ✅ | | [journal](journal/fix-merger.md) |
| [V46](plan/v46-merger-logs.md) | Merger logs: steps, the check's output and the agent's thinking live; a resolution's files; the merger's effort | ready for review | 313–319 | [journal](journal/v46-merger-logs.md) |
| Fix | the merge page on a conflict: red for what is lost or doubled, amber for what the agent wrote; a question answered there | ready for review | | [journal](journal/fix-merge-viewer-on-conflict.md) |
| Fix | a merge that failed or waits for you holds the next one into its target; Check again on a moved target merges again | ready for review | | [journal](journal/fix-merger-queue-wrong-behaviour.md) |

### Shell and look

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V29](plan/v29-workbench.md) | A workbench: a sidenav, a new look, usage | ✅ | 172–189 | [journal](journal/v29-workbench.md) |
| Fix | usage keeps Symbiote's own last read, reads every 5 min; a program's output read to its end | ✅ | | [journal](journal/fix-usage-keeps-live-numbers.md) |
| [V31](plan/v31-symbiote-style.md) | Symbiote's style, beyond its colours | ✅ | 212–217 | [journal](journal/v31-symbiote-style.md) |
| [V32](plan/v32-type-scale.md) | Text one can read | ✅ | 226–229 | [journal](journal/v32-type-scale.md) |
| Feature | the usage bars' colours back | ✅ | | [journal](journal/usage-bar-colours.md) |
| [V34](plan/v34-resizable-panels.md) | Panels one can resize | ✅ | 233–235 | [journal](journal/v34-resizable-panels.md) |
| [V37](plan/v37-not-dated.md) | A look that is not dated | ✅ | 246–250 | [journal](journal/v37-not-dated.md) |
| [Refactor](plan/refactor-viewer-folders.md) | The viewer's files in folders | ✅ | 257–258 | [journal](journal/refactor-viewer-folders.md) |
| [V39](plan/v39-first-time-intro.md) | A first-time intro | ✅ | 259–265 | [journal](journal/v39-first-time-intro.md) |
| Fix | the intro's koi on a lost WebGL context: a blank tile for 5 s | ✅ | | [journal](journal/fix-intro-lost-context.md) |
| [V42](plan/v42-koi.md) | Koi: colours from the intro | ✅ | 279–284 | [journal](journal/v42-koi.md) |
| [V49](plan/v49-start-page-look.md) | Start a workspace: a centred page in two cards | ready for review | 378–382 | [journal](journal/v49-start-page-look.md) |
| [V51](plan/v51-settings-look.md) | Settings and Skills: centred, in cards | ready for review | 386–390 | [journal](journal/v51-settings-look.md) |
| [V56](plan/v56-skills-page-layout.md) | Skills: the page's own, the whole main area | ready for review | 407–410 | [journal](journal/v56-skills-page-layout.md) |
| [V54](plan/v54-tooltips.md) | Tooltips drawn by Symbiote, one form per context | ready for review | 397–402 | [journal](journal/v54-tooltips.md) |
| [V59](plan/v59-scout-waiting-mark.md) | Scout's and Scribe's links, whole, in Waiting for you's amber band while they wait | ready for review | 422–425 | [journal](journal/v59-scout-waiting-mark.md) |
| [V61](plan/v61-complete-revamp.md) | The mockup's black theme on every page, the new S as the icon, text a step bigger | ready for review | 437–440, 445 | [journal](journal/v61-complete-revamp.md) |
| [V62](plan/v62-settings-layout.md) | Settings as the person's mockup: two cards to the bottom, the page one card | ready for review | 446–450 | [journal](journal/v62-settings-layout.md) |
| [V63](plan/v63-start-page-mockup.md) | Start a workspace as the person's mockup: the S in the head, kinds as tabs, the run as seven cards | ready for review | 451–457 | [journal](journal/v63-start-page-mockup.md) |
| Feature | Settings at the sidenav's bottom, under the workspaces | ready for review | | [journal](journal/sidenav-settings-at-the-bottom.md) |

### Native window

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [N1](plan/n1-native-window.md) | A native window (Electron) | ✅ | 190–204 | [journal](journal/n1-native-window.md) |
| [N1d](plan/n1d-rounded-window.md) | Rounded window corners | ✅ | 218–225 | [journal](journal/n1d-rounded-window.md) |
| Fix | Symbiote's window opening maximized on WSLg took no clicks | ✅ | | [journal](journal/fix-wslg-open-maximized.md) |
| Fix | The app shows a page as a browser does, under its title bar | ready for review | | [journal](journal/fix-title-bar-desktop.md) |

### Repository monitoring

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [RM1](plan/rm1-code-concentration.md) | Code concentration: where a repository's code is | ready for review | 320–328 | [journal](journal/rm1-code-concentration.md) |
| [RM2](plan/rm2-monitor-styling.md) | The Monitor's look: long files in heat, the folder in view as the heading, a way back | ready for review | 332–335 | [journal](journal/rm2-monitor-styling.md) |

### Logs

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [LG1](plan/lg1-logs.md) | Symbiote's logs: lines from every Symbiote process, uncaught errors kept, read by another app (Grafana, Loki) | ready for review | 349–357, 366 | [journal](journal/lg1-logs.md) |
| [LG2](plan/lg2-dashboard.md) | A readable logs dashboard: at a glance, problems by level and kind, what Symbiote did, the server; the e2e tests' lines out of the person's folder | ready for review | 441–444 | [journal](journal/lg2-dashboard.md) |

### Docs and the repository

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| Chore | Working rules for Claude Code | ✅ | | [journal](journal/chore-agent-guidance.md) |
| Chore | README rewrite | ✅ | | [journal](journal/chore-update-readme.md) |
| [V22](plan/roadmap.md) | Fixes: stale text outside the README | ✅ | | [journal](journal/v22-stale-text.md) |
| Feature | README remade around workspaces; commands, configuration and review pages | ready for review | | [journal](journal/remake-readme.md) |
| Rename | Rename to Symbiote | ✅ | | [journal](journal/rename-to-symbiote.md) |
| [Refactor](plan/refactor-plan-journal-folders.md) | The plan and the journal in folders | ready for review | 290–293 | [journal](journal/refactor-plan-journal-folders.md) |
| [Refactor](plan/refactor-readability.md) | The CLI's services and the viewer's pages in modules one can read | ready for review | 344–348 | [journal](journal/refactor-readability.md) |
