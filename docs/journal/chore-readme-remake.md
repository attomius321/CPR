# Journal: Chore — A README a person can read

[Index](../JOURNAL.md) · [The README remade before](remake-readme.md)

## A README a person can read: every feature, fresh screenshots (2026-11-02, branch `chore/readme-remake`)

Asked: the README "is not easy to read for a human". It should read top to bottom for someone new to
Symbiote, include every feature built so far, and show them with screenshots. Written to the
`writing-docs` skill. Hive drove the workspace, so the layout below was decided here, not agreed
with the person.

**Before and after** (`readability.mjs`):

| | Words | Words a sentence | Longest | Over 25 words | Paragraphs over 80 words | Images |
|---|---|---|---|---|---|---|
| README on `main` | 5,210 | 15.2 | 125 | 24 | 18 | 7 (94–219 KB) |
| README now | 3,625 | 12.3 | 31 | 5 | 4 | 17 (23–84 KB) |
| `docs/guide/workspaces.md` (new) | 2,134 | 13.2 | 26 | 1 | 2 | |
| `docs/guide/pages.md` (new) | 1,745 | 13.3 | 26 | 2 | 3 | |

**The README's order**: what Symbiote is, the review graph as the first picture, four reasons to use
it, what you need, install (with "Symbiote's window", whose heading two CLI messages name), "Try it"
(a branch as a graph; a first workspace from start to merge), then one short section a feature with
its picture, what Symbiote writes and sends, limits, the documentation's pages, and development. No
milestone IDs or decision numbers; each term (workspace, worktree, symbol, finding, lands, merger,
Nucleus, Scribe, skill library) is defined where it first appears.

**Decided: two new guide pages.** The brief asked for details to move to the reference pages, not to
be deleted. Most of the old README's detail is neither an option, a key nor CI: the start page's
cards, the sidenav's cards, the agent's tabs, merge strategies, conflicts, History, the Git page's
actions, Nucleus, Skills, the Monitor, Settings and the nexus. It moved to
`docs/guide/workspaces.md` and `docs/guide/pages.md`, edited to the same rules; nothing was dropped.
The README links both. The reference pages changed only where a fact belongs there: the logs image's
caption (`configuration.md`), the review image's caption and a pointer to the workspaces guide
(`review-and-ci.md`). The anchor other pages use, `README.md#what-symbiote-writes-and-sends`, is
kept, and so is "Symbiote's window" (`packages/cli/src/main.ts`, `app.ts` and
`packages/nexus/src/app-window.ts` name it).

**Inventory**: every area of `docs/PLAN.md`'s index with ✅ rows, and where it is now.

| Feature (index rows) | README section | Details |
|---|---|---|
| The review graph: symbols, uses, context, projects in a monorepo (M0–M7, R1, W1, V1–V8, V12) | Review a change as a graph (`review.png`) | review guide (`review-detail.png`) |
| Findings (D1) | Review a change as a graph: the table | review guide, Findings |
| `symbiote diff`, `view`, `pr`, `--since` (G1–G3, I1–I2) | Review a change as a graph; Pull and merge requests, and CI | commands reference |
| GitHub Action, GitLab CI template (C1–C2) | Pull and merge requests, and CI | review guide, Run in CI |
| Framework plugins: Angular, Qwik, your own (A1–A3, Q1–Q2, X1) | Frameworks and stylesheets | review guide |
| Stylesheets (L1–L2), `.symbioteignore` | Frameworks and stylesheets | review guide; configuration |
| Branch reviews, Finish review, the Files page, the Review tab (V15–V17, V60, V76) | Review a change as a graph; Review the branch and tell the agent (`review-files.png`) | workspaces guide; review guide |
| Start a workspace: kinds, brief, start from, documents, effort (V18, V24, V30, V33, V40, V63, V68) | Start a workspace (`start.png`) | workspaces guide |
| Suggest settings (V75) | Start a workspace | workspaces guide |
| The agents: Claude Code, Codex, Hermes (V20, V27, V58) | What you need; Run agents in workspaces | workspaces guide |
| The sidenav's groups and cards, the running model (V25, V44, V48, V53, V55, V57, V79, V83) | See what needs you (`workspace.png`) | workspaces guide |
| The agent's terminal, images, links, shells (V21, V36, V38, V45) | Work with the agent | workspaces guide |
| The Activity tab and its export (V48, V73, V74, V84) | Work with the agent (`activity.png`) | workspaces guide; commands reference |
| Plan first (V18, V24) | Try it; Start a workspace | workspaces guide |
| Reviewed against a picked branch (V65) | | workspaces guide, The Changes panel |
| Merge queue, check, landing, strategies, the merger (V26, V46, V67, V69) | Merge (`merge.png`) | workspaces guide; configuration |
| Clean up and History (V55, V57, V77) | Clean up and History (`history.png`) | workspaces guide |
| Hive mode: the switch and its look (V82, V85, V86) | Hive mode (`hive.png`) | configuration, Hive mode |
| Hive's runner, the check, the running reviewer, live progress (HV2, HV3) | Hive mode | configuration |
| Landing on its own (HV4), through a pull or merge request (HV8) | Hive mode (`hive-settings.png`) | configuration |
| Usage pacing and the budget (HV5); Hive on and off | Hive mode | configuration |
| Nucleus and Alpha Ceph, its web, its Activity tab (V35, V50, V52, V78, V80, NU1, NU2) | Nucleus (`nucleus.png`); Hive mode | pages guide |
| Symbiote's tools over MCP, `suggest_settings` (MC1, MC2) | Nucleus | commands reference |
| Start workspaces without a Confirm (NU8) | What Symbiote writes and sends | pages guide; configuration |
| Prompts in Settings (V28) | Settings (`settings.png`) | configuration, Prompts |
| Skills, Scribe, the skill library, Link for Codex (V41, SK1) | Skills and Scribe (`skills.png`) | pages guide; configuration |
| The Git page (V9–V14, V10b, V10c, V23, V66, V70) | Git (`git.png`) | pages guide |
| The Monitor (RM1, RM2) | Monitor (`monitor.png`) | pages guide |
| Appearance: theme, text size, Git's details (V29, V87) | Settings | pages guide |
| Usage in the status bar (V29) | Settings; What Symbiote writes and sends | pages guide |
| The first-time intro (V39) | Try it | configuration, `SYMBIOTE_INTRO` |
| Symbiote's window, the taskbar's dot (N1, N2) | Symbiote's window; See what needs you | workspaces guide |
| Symbiote nexus, pinned folders (NX1–NX4) | Several Symbiotes in one window (`nexus.png`) | pages guide; configuration |
| Logs and the Grafana dashboard (LG1, LG2) | Logs | configuration (`logs-dashboard.png`) |
| `./install.sh` (IN1) | Install | |

**Screenshots**: 17, all new, at 1440 × 900 (two cropped), device scale 1, the default text size,
dark, from this branch's build. They show a neutral example project, `storefront`: a small
TypeScript shop with six dated commits by three made-up people, made by a generator in
`packages/viewer/coverage/readme-shots/` (ignored, not committed). Each scenario is a Playwright
script there, on a copy of the e2e harness (`e2e/symbiote.ts`) that builds `storefront` in place of
a fixture:

- **Workspaces**: six workspaces started from the Start page, on the fake Claude Code, Codex and
  Hermes. The agents' tool calls go through Symbiote's real hooks; the records' times were then
  spread over 30 minutes, so the Activity tab shows minutes, not milliseconds. The plan and the
  reports are written for the shots. The review, its comments and its verdict, the merge with its
  check (`npm test`, really run), the clean-up and History are the app's own.
- **Nucleus**: the conversation in its terminal is staged (the fake prints it). Its request to start
  a fix is a real `start_workspace` call through Symbiote's MCP bridge, so the Confirm bar is the
  app's.
- **Hive**: Hive turned on in a scratch copy of `storefront`. The fake writer committed, the check
  ran, the fake reviewer proved a defect with a failing test that Symbiote reran under bubblewrap,
  the writer fixed it, the second review approved, and Hive landed and pushed it.
- **The nexus**: three example repositories in a scratch home, two `symbiote view`s and one pin.
- **The logs dashboard**: a second copy of `ops/logs` (its own project name, ports 3191 and 3391,
  and volumes, removed after) reading the scenarios' scratch logs: 106 lines, no path of the
  person's. The person's own logs stack, running on 3100 and 3300, was not touched.

Playwright's PNGs (72–424 KB) were quantized to 256 colours by a small script in the same folder:
23–84 KB each, 0.95 MB for all 17. Its first version folded small green and red marks into grey;
saturated colours now get palette slots of their own.

**Found, not fixed** (out of scope here: no code or look changes):

- **The verdict resets on the other page.** A verdict picked in the Graph page's Review tab is back
  to **Comment** after `g` to Files, so **Finish review** there sends a comment. The tab keeps it in
  local state (`packages/viewer/src/diff/ReviewTab.tsx:84`).
- **`symbiote --help`** says `view` without revisions opens "History"; the page is Git.
- **Git's rows at 1440 px** with the sidenav and the details pane: a commit's ref labels leave its
  subject one letter ("S." for "Start src/pricing/rules.ts").
- **The graph's map**: after **Fit the view** on a small change, `cart.ts`'s label was drawn over
  `checkout.ts`'s box.
- **The clone URL** (`attomius321/Symbiote`), like the Action's `uses:` and the GitLab template's
  URLs, names a GitHub repository that does not exist; origin is `attomius321/CPR`. Kept as it was.
- **The old `logs-dashboard.png`** showed a home folder's paths in a stack trace. Replaced.

**Reader test** (the skill's): a fresh agent with no tools but the README answered 12 questions:
what Symbiote is and where it runs; what to install; a branch as a graph; the findings; reviewing
and telling the agent; starting a workspace with Claude Code; files written and git; the network;
CI; Hive mode and its limits; Nucleus; several Symbiotes in one window.

- Round 1: all 12 answered from the page, with guesses on six points. Its notes found what the fact
  checks had not: `g` read as one key for two things (Graph, and the Git page); "lands", "check",
  "normal mode" and a usage "window" used before they were explained; "the review file" never named;
  the budget's unit, whether Nucleus may message an agent without asking, the CSS finding's name,
  which findings fail CI, and which token CI uses all left to guessing; "You approve a commit" where
  everything else approves a branch. Each was fixed on the page.
- Round 2, a new agent reading the file itself: 11 of 12 answered from the page; the levels of
  `signature-changed` and `exported-api-changed` were guessed. The findings' table got a Level
  column, from the review guide. Its notes also fixed "It sends a message to an agent without asking
  you" (read as a prohibition), a usage "window" sentence read with "limits" as a noun, and two
  apparent contradictions: Hive's "no step waits for you" against a pull request you merge, and
  `merge.push` against Hive's pushes.
- Round 3, another new agent: 12 of 12 answered from the page and quoted. Its notes led to two small
  fixes (the Action's token by name; Nucleus's web traffic next to "three things"). Terms still used
  before their section, such as Hive mode in the opening and the tabs in the quick start, are named
  on screen where the reader meets them; they were left.

**Verification**:

- Facts: the commands against `symbiote --help`; the kinds' questions against
  `packages/viewer/src/workspaces/brief.ts`; Settings' Appearance choices, the Skills page's Link
  for Codex, the Monitor's colours and the intro's end against their components; Hive, pacing and
  the network against `configuration.md` (current since HV5). Each screenshot shows what its section
  says.
- Links: a script with GitHub's heading rules over the README, the guides, the references and the
  graph schema: 101 relative links and anchors, none broken (it reports a broken one when given
  one). Each of the 17 images in `docs/images/` is referenced once; plans and journals that link
  `review.png`, `merge.png`, `start.png` and `workspace.png` still resolve.

- `pnpm check`: format, lint and typecheck pass; 2,899 of 2,900 unit tests pass. The one that
  failed, `packages/cli/test/hive-request-checkout.test.ts` ("tried again each minute", 5.1 s), is a
  timing test, and this branch changes no code; alone it passed 3 runs of 3, at a load average of
  13.
- `pnpm build` passes (it ran before the shots, which use its output).

Not verified: an install from a clean clone (the install's text is unchanged in substance); macOS;
Symbiote's window (no shot of it); real agents; Grafana's Logs Drilldown (its plugin download was
turned off in the scratch copy); the GitHub Action and the GitLab template.
