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
| [L1–L2](plan/l1-l2-stylesheets.md) | Stylesheets in the graph (CSS and SCSS), and the markup that uses them | ✅ | 299–312, 329–331 | [journal](journal/l1-l2-stylesheets.md) |
| [D2](plan/d2-review-precision.md) | Findings precision on real pull requests (spike) | measured: not yet | | [journal](journal/d2-review-precision.md) |
| [D2b](plan/d2b-review-time-findings.md) | Findings at review time, on every push (spike) | proposed | | |
| [D2c](plan/d2c-review-graph.md) | Is the review graph right, and does it lead to the problems? (spike) | proposed | | |
| [D3](plan/d3-true-warnings.md) | True warnings: orphans, users that use the change, compatibility | proposed | | |

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
| Fix | `open-pr.spec.ts`: two opens raced to VS Code's log; the spec waits for each | ✅ | | [journal](journal/fix-open-pr-spec-race.md) |

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
| [V66](plan/v66-git-page.md) | Git: History renamed; a commit's details, changes staged and committed, branches and tags, fetch/pull/push, find a commit | ✅ | 475–484 | [journal](journal/v66-git-page.md) |
| [V70](plan/v70-git-file-view.md) | Git: a commit's file shown in the rows' place; Open in VS Code (its diff) from the pane | ✅ | 498–501 | [journal](journal/v70-git-file-view.md) |
| [Fix](plan/v66-git-page.md#fix-the-page-lists-in-place-more-of-git-fixgit-page-feature-extend) | Git lists in place (the file shown kept); continue/abort, cherry-pick, revert, merge, rebase, stash, reset, discard, hunks and lines, a file's history and blame, remote branches deleted, branches hidden | built, in review | 634–645 | [journal](journal/fix-git-page-feature-extend.md) |
| Fix | A commit's menu opens at once: no Review in it (the branches panel keeps its own), so no wait for every branch review | ready for review | | [journal](journal/fix-git-right-click-on-commit.md) |

### Reviews

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V15](plan/v15-branch-reviews.md) | Branch reviews in the repository | ✅ | 71–75 | [journal](journal/v15-branch-reviews.md) |
| [V16](plan/v16-finish-review.md) | Finish a review | ✅ | 76–81 | [journal](journal/v16-finish-review.md) |
| Fix | a review's mark you can see on a badge | ✅ | | [journal](journal/fix-review-mark-visible.md) |
| [V17](plan/v17-approve-means-merge.md) | Approve means "merge it" | ✅ | 82–87 | [journal](journal/v17-approve-means-merge.md) |
| [V60](plan/v60-files-page.md) | A Files page in the review, the default: the changed files, a file's diff, comments on its lines | ✅ | 431–436 | [journal](journal/v60-files-page.md) |
| [V76](plan/v76-review-tab-layout.md) | The Review tab in sections — comments, your review, the merge — and a Merge into that fits the sidebar; Files and Graph that stay put | ✅ | 557–560, 568 | [journal](journal/v76-review-tab-layout.md) |

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
| [V45](plan/v45-workspace-terminals.md) | More terminals in a workspace: shells in its worktree | ✅ | 294–298 | [journal](journal/v45-workspace-terminals.md) |
| [V47](plan/v47-agent-model.md) | A model for a workspace's agent, from the agent's own list; Scout's, Scribe's and the merger's in Settings | ✅ | 336–343 | [journal](journal/v47-agent-model.md) |
| Fix | a new file in a workspace's changes opens in VS Code as it is, not as a diff | ✅ | | [journal](journal/fix-workspaces-new-files.md) |
| Fix | a workspace's agent is told its worktree and branch are ready, and to make no other | ✅ | | [journal](journal/fix-initial-workspace-bug.md) |
| [V48](plan/v48-workspace-activity.md) | Workspaces that show what their agents are doing, and which wait for you | ✅ | 367–377 | [journal](journal/v48-workspace-activity.md) |
| [V53](plan/v53-workspaces-view.md) | A working agent's spinner, its mark before what it does, every workspace's kind | ✅ | 394–396 | [journal](journal/v53-workspaces-view.md) |
| Fix | a merge at work spins; the spinner a comet; Merging first in the sidenav | ✅ | | [journal](journal/fix-merging-status.md) |
| [V55](plan/v55-done-workspace-cleanup.md) | A done workspace or a landed merge, removed from its card and its head | ✅ | 403–406 | [journal](journal/v55-done-workspace-cleanup.md) |
| [V57](plan/v57-cleaning-up-card.md) | A card being cleaned up (or its merge removed): disabled, saying so, until it goes | ✅ | 411–414 | [journal](journal/v57-cleaning-up-card.md) |
| Fix | Codex's mark is OpenAI's blossom, in OpenAI's white or black | ✅ | | [journal](journal/fix-codex-icon.md) |
| [V65](plan/v65-review-against.md) | A workspace reviewed against where it started, or a branch picked in it | ✅ | 471–474 | [journal](journal/v65-review-against.md) |
| [V68](plan/v68-start-from-search.md) | Start from with a search: the branches narrowed as you type, picked with the keys | ✅ | 490–493 | [journal](journal/v68-start-from-search.md) |
| [V73](plan/v73-activity-timeline.md) | The Activity tab as a timeline of phases: a live strip, groups that open to every event, the raw stream | ✅ | 513–518 | [journal](journal/v73-activity-timeline.md) |
| [V74](plan/v74-activity-colours.md) | The Activity tab in colour: a phase's kind on a coloured tile on the rail, the conversation in bubbles | ✅ | 528–531 | [journal](journal/v74-activity-colours.md) |
| [V75](plan/v75-suggested-settings.md) | Suggested settings: a small model sizes the work and fills the Start page's model, effort and plan first | V75a, V75b, V75c ✅ | 544–550, 556 | [journal](journal/v75-suggested-settings.md) |
| Fix | Suggest settings could not read the agents' models: `symbiote view` serves the pages it started with, not a newer build's on its older API | ✅ | | [journal](journal/fix-suggest-settings-models.md) |
| [V77](plan/v77-workspace-history.md) | History: finished workspaces under Monitor, each with its activity, thread, brief and changes | ✅ | 561–567 | [journal](journal/v77-workspace-history.md) |
| [V79](plan/v79-workspace-cards.md) | Workspace cards one can read: whole names, the state on its own lines, the facts as icons, cards apart; the sidenav 300 px | ✅ | 576–581, 585 | [journal](journal/v79-workspace-cards.md) |

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
| Fix | Attach images beside a workspace's terminal: no drop reaches the window on WSL | ✅ | | [journal](journal/fix-drop-file-in-workspace.md) |
| Fix | one Settings page per prebuilt agent (Merger, Scout, Scribe), under Prebuilt agents | ✅ | | [journal](journal/fix-scout-merger-scribe-settings.md) |
| Fix | Scribe starts at the project's effort level (`scribe.effort`), set in Settings | ✅ | | [journal](journal/fix-scribe-effort-level.md) |
| [MC1](plan/mc1-symbiote-mcp.md) | Symbiote's MCP: Scout as the person's assistant, from a workspace's start to its merge | ✅ | 358–365 | [journal](journal/mc1-symbiote-mcp.md) |
| [V50](plan/v50-scout-terminal.md) | Scout is a terminal: opened with no question; the agent, model and effort in its head | ✅ | 383–385 | [journal](journal/v50-scout-terminal.md) |
| [V52](plan/v52-scout-next-conversation.md) | Scout's head picks the next conversation: a choice starts nothing until New conversation | ✅ | 391–393 | [journal](journal/v52-scout-next-conversation.md) |
| [V58](plan/v58-hermes-agent.md) | Hermes as a workspace's agent, in its terminal | ✅ | 415–421 | [journal](journal/v58-hermes-agent.md) |
| Fix | Scout's head on one line: Effort and its stepper centred with the selects | ✅ | | [journal](journal/fix-scout-not-aligned.md) |
| [SK1](plan/sk1-skill-library.md) | A skill library: a folder or repository of skills outside the project, on the Skills page and for Scribe; commits as set | ✅ | 426–430 | [journal](journal/sk1-skill-library.md) |
| Fix | An agent's terminal fits its box: no scrollbars coming and going on Scribe's pane, no last row cut off | ✅ | | [journal](journal/fix-scribe-terminal-problem.md) |
| Fix | `scout.spec.ts`: Scout's record read before Codex's start wrote it; the spec waits for it | ✅ | | [journal](journal/fix-scout-record-spec-race.md) |
| [V78](plan/v78-scout-scribe-terminals.md) | Scout and Scribe are terminals: no choices on their pages, their model and effort set in Settings | ✅ | 569–572 | [journal](journal/v78-scout-scribe-terminals.md) |
| [MC2](plan/mc2-mcp-suggest-settings.md) | `suggest_settings`: the advisor's proposal through Symbiote's MCP, before a start Scout makes | ✅ | 582–584 | [journal](journal/mc2-mcp-suggest-settings.md) |
| [V80](plan/v80-scout-reads-worktrees.md) | Scout reads the workspaces' worktrees: their files and uncommitted changes, by its gate at each call; still read-only | ✅ | 596–599 | [journal](journal/v80-scout-reads-worktrees.md) |
| [NU1](plan/nu1-nucleus.md) | Nucleus: Scout renamed, with the agents' web search and pages; its next steps planned | ✅ | 589–595 | [journal](journal/nu1-nucleus.md) |
| [NU2](plan/nu2-nucleus-activity.md) | Nucleus's Activity tab: its messages, calls, the gate's decisions, Symbiote's tools and Confirms, recorded across conversations | ready for review | 604–610 | [journal](journal/nu2-nucleus-activity.md) |
| [HV1](plan/hv1-hive-graph.md) | Spike: Hive's agentic graph — a runner of Symbiote's own; a graph of workspaces against one agent (no gain, twice the cost); a reviewer that runs code (4 of 4 defects) | measured | 646–651 | [journal](journal/hv1-hive-graph.md) |

### The merger

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [V26](plan/v26-merger.md) | A merger | ✅, V26b dropped | 142–153, 164, 242–243 | [journal](journal/v26-merger.md) |
| Fix | `symbiote/merge.md` can be committed | ✅ | | [journal](journal/fix-merge-md-shared.md) |
| Fix | Merge into names no branch; the dropdown does | ✅ | | [journal](journal/fix-merge-into-main-button.md) |
| Chore | the merge page remake, built | ✅ | | [journal](journal/chore-lost-feature.md) |
| Fix | a resolution's failed check is said, not taken for a wrong one; Check again | ✅ | | [journal](journal/fix-merger.md) |
| [V46](plan/v46-merger-logs.md) | Merger logs: steps, the check's output and the agent's thinking live; a resolution's files; the merger's effort | ✅ | 313–319 | [journal](journal/v46-merger-logs.md) |
| Fix | the merge page on a conflict: red for what is lost or doubled, amber for what the agent wrote; a question answered there | ✅ | | [journal](journal/fix-merge-viewer-on-conflict.md) |
| Fix | a merge that failed or waits for you holds the next one into its target; Check again on a moved target merges again | ✅ | | [journal](journal/fix-merger-queue-wrong-behaviour.md) |
| [V67](plan/v67-merge-strategies.md) | Merge strategies: a merge commit, or a fast-forward to the approved commit | ✅ | 485–489 | [journal](journal/v67-merge-strategies.md) |
| [V69](plan/v69-merge-page-mockup.md) | The merge page as the person's mockup, in the theme: tinted chips with icons, the log a card filling the page, line tabs | ✅ | 494–497 | [journal](journal/v69-merge-page-mockup.md) |

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
| [V49](plan/v49-start-page-look.md) | Start a workspace: a centred page in two cards | ✅ | 378–382 | [journal](journal/v49-start-page-look.md) |
| [V51](plan/v51-settings-look.md) | Settings and Skills: centred, in cards | ✅ | 386–390 | [journal](journal/v51-settings-look.md) |
| [V56](plan/v56-skills-page-layout.md) | Skills: the page's own, the whole main area | ✅ | 407–410 | [journal](journal/v56-skills-page-layout.md) |
| [V54](plan/v54-tooltips.md) | Tooltips drawn by Symbiote, one form per context | ✅ | 397–402 | [journal](journal/v54-tooltips.md) |
| [V59](plan/v59-scout-waiting-mark.md) | Scout's and Scribe's links, whole, in Waiting for you's amber band while they wait | ✅ | 422–425 | [journal](journal/v59-scout-waiting-mark.md) |
| [V61](plan/v61-complete-revamp.md) | The mockup's black theme on every page, the new S as the icon, text a step bigger | ✅ | 437–440, 445 | [journal](journal/v61-complete-revamp.md) |
| [V62](plan/v62-settings-layout.md) | Settings as the person's mockup: two cards to the bottom, the page one card | ✅ | 446–450 | [journal](journal/v62-settings-layout.md) |
| [V63](plan/v63-start-page-mockup.md) | Start a workspace as the person's mockup: the S in the head, kinds as tabs, the run as seven cards | ✅ | 451–457 | [journal](journal/v63-start-page-mockup.md) |
| [V64](plan/v64-skills-page-mockup.md) | Skills as the person's mockup: Settings' head, a search, the text with line numbers and Markdown's colours, Checks a card, Open in VS Code | ✅ | 458–464 | [journal](journal/v64-skills-page-mockup.md) |
| Feature | Settings at the sidenav's bottom, under the workspaces | ✅ | | [journal](journal/sidenav-settings-at-the-bottom.md) |
| [V71](plan/v71-analyzing-page.md) | The analyzing page in the style: a card on the start page's arcs, the phases as steps, a review named | ✅ | 502–506 | [journal](journal/v71-analyzing-page.md) |
| [V72](plan/v72-page-frame.md) | One page frame: every page the whole main area, one head, 16 px margins and gutters, the same insets inside cards | ✅ | 507–512 | [journal](journal/v72-page-frame.md) |
| [V81](plan/v81-settings-list-icons.md) | Settings' list scanned: a lucide icon per entry, on a tile tinted by its group | ✅ | 600–603 | [journal](journal/v81-settings-list-icons.md) |
| [V82](plan/v82-hive-mode.md) | Hive mode: a dangerous switch in Settings and an ink and crimson look while it is on | ready for review | 611–616 | [journal](journal/v82-hive-mode.md) |
| [Fix](plan/v82-hive-mode.md#fix-hive-per-repository-fixhive-per-symbiote) | Hive mode per repository, never on the nexus; Settings readable under the tendrils; the ink takes the page as it turns on | ready for review | 621–624 | [journal](journal/v82-hive-mode.md) |
| [Feature](plan/v82-hive-mode.md#feature-hive-tentacles-featurehive-tentacles) | Hive's tendrils alive: Carnage's red and black in the question and the sidenav, a Hive Mind they grab and hold, turning on as the Mind and a blackout, then a boom | ready for review | 629–633 | [journal](journal/v82-hive-mode.md) |
| [Fix](plan/v82-hive-mode.md#fix-no-tendrils-in-the-sidenav-fixremove-hive-tendrils-from-sidenav) | No Hive tendrils in the sidenav (633 withdrawn) | ready for review | | [journal](journal/fix-remove-hive-tendrils-from-sidenav.md) |

### Native window

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [N1](plan/n1-native-window.md) | A native window (Electron) | ✅ | 190–204 | [journal](journal/n1-native-window.md) |
| [N1d](plan/n1d-rounded-window.md) | Rounded window corners | ✅ | 218–225 | [journal](journal/n1d-rounded-window.md) |
| Fix | Symbiote's window opening maximized on WSLg took no clicks | ✅ | | [journal](journal/fix-wslg-open-maximized.md) |
| Fix | The app shows a page as a browser does, under its title bar | ✅ | | [journal](journal/fix-title-bar-desktop.md) |
| [N2](plan/n2-taskbar-waiting.md) | The taskbar's icon says something waits for you: an amber dot, a blink where the desktop has one | ✅ | 465–470 | [journal](journal/n2-taskbar-waiting.md) |

### The nexus

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [NX1](plan/nx1-nexus.md) | Symbiote nexus: every running `symbiote view` found, as tabs in one window or browser tab | ✅ | 519–527 | [journal](journal/nx1-nexus.md) |
| [NX2](plan/nx2-open-from-folders.md) | Open a Symbiote from the nexus: this PC's folders, Open Symbiote, Stop and Start again | ✅ | 539–543 | [journal](journal/nx2-open-from-folders.md) |
| [NX3](plan/nx3-nexus-look.md) | The nexus's own tabs apart from the Symbiotes', fuller pages, a repository the end of Folders | ✅ | 551–555 | [journal](journal/nx3-nexus-look.md) |
| [NX4](plan/nx4-pinned-folders.md) | Pinned folders: the person's folders and repositories kept in Folders' places from one run to the next | ready for review | 617–620 | [journal](journal/nx4-pinned-folders.md) |
| [Fix](plan/nx2-open-from-folders.md#fix-a-symbiote-framed-once-this-browser-reaches-it-fixfirst-time-symbiote-from-nexus) | A Symbiote opened from the nexus in Chrome on Windows is framed once Chrome reaches it, not left on Chrome's error page | ready for review | 625 | [journal](journal/fix-first-time-symbiote-from-nexus.md) |
| [Fix](plan/nx4-pinned-folders.md#fix-pinned-symbiotes-on-symbiotes-the-folders-under-them-fixnexus-pinned-symbiotes) | Pinned repositories among Symbiotes' cards, first; Folders no tab: this PC's folders under the Symbiotes | ready for review | 626–628 | [journal](journal/fix-nexus-pinned-symbiotes.md) |

### Repository monitoring

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [RM1](plan/rm1-code-concentration.md) | Code concentration: where a repository's code is | ✅ | 320–328 | [journal](journal/rm1-code-concentration.md) |
| [RM2](plan/rm2-monitor-styling.md) | The Monitor's look: long files in heat, the folder in view as the heading, a way back | ✅ | 332–335 | [journal](journal/rm2-monitor-styling.md) |

### Logs

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| [LG1](plan/lg1-logs.md) | Symbiote's logs: lines from every Symbiote process, uncaught errors kept, read by another app (Grafana, Loki) | ✅ | 349–357, 366 | [journal](journal/lg1-logs.md) |
| [LG2](plan/lg2-dashboard.md) | A readable logs dashboard: at a glance, problems by level and kind, what Symbiote did, the server; the e2e tests' lines out of the person's folder | ✅ | 441–444 | [journal](journal/lg2-dashboard.md) |

### Docs and the repository

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| Chore | Working rules for Claude Code | ✅ | | [journal](journal/chore-agent-guidance.md) |
| Chore | README rewrite | ✅ | | [journal](journal/chore-update-readme.md) |
| [V22](plan/roadmap.md) | Fixes: stale text outside the README | ✅ | | [journal](journal/v22-stale-text.md) |
| Feature | README remade around workspaces; commands, configuration and review pages | ✅ | | [journal](journal/remake-readme.md) |
| Rename | Rename to Symbiote | ✅ | | [journal](journal/rename-to-symbiote.md) |
| [Refactor](plan/refactor-plan-journal-folders.md) | The plan and the journal in folders | ✅ | 290–293 | [journal](journal/refactor-plan-journal-folders.md) |
| [Refactor](plan/refactor-readability.md) | The CLI's services and the viewer's pages in modules one can read | ✅ | 344–348 | [journal](journal/refactor-readability.md) |
| [IN1](plan/in1-one-command-install.md) | Install in one command (`./install.sh`), with no native build: the agents' terminal prebuilt | ✅ | 532–538 | [journal](journal/in1-one-command-install.md) |

### Across the app

| ID | What | Status | Decisions | Journal |
|---|---|---|---|---|
| Fix | Security and bugs: saves at once, forge tokens, framing, agents' `--`, Scout's gate, cross-site GETs, 400 and 413 | ✅ | | [journal](journal/fix-security-and-bugs.md) |
