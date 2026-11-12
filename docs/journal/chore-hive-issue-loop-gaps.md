# Journal: Chore — Hive's full loop from an issue: what is left to build

[Index](../JOURNAL.md) · Plans it wrote: [HV9](../plan/hv9-issue-classifier.md),
[HV10](../plan/hv10-workspace-from-issue.md), [HV11](../plan/hv11-issue-answered.md),
[HV12](../plan/hv12-issue-loop-real-run.md), [HV13](../plan/hv13-issue-intake.md)

## The loop from an issue, step by step, and what to build first (2026-11-12, branch `chore/hive-issue-loop-gaps`)

Asked: what is left to build for Hive mode's full loop. In that loop a GitHub or GitLab issue
comes in, and a Hive workspace starts from it. Hive drives it through the writer, the check and
the running reviewer, and lands it through the merge queue or a request. The issue is then linked
and answered on the forge. For each step: what exists on `main`, what is missing, and what is
unproven on a real run. The person's direction: a classifier agent is the first step of the pipe,
and no workspace starts from an issue it has not passed.

**The answer in short.** Half of the loop exists and has run for real in this repository: the
start through Nucleus, the writer, the check, the running reviewer, and landing through the queue.
Landing through a request exists but has never met a real forge. Nothing else exists. Nothing
brings an issue in, and there is no classifier. Nothing turns an issue into a brief or puts the
issue in a workspace's record. Nothing writes to an issue. Five milestones build what is missing,
in this order: the classifier (HV9), a workspace from an issue (HV10), the issue answered (HV11),
a real run (HV12), then a label watch (HV13), with three of HV7's parts before it. The code read
for this entry is `main` at `a47dda3`.

### How Hive's workspaces ran

Symbiote's records hold 14 Hive workspaces, from 2026-10-31 to 2026-11-02
(`symbiote/hive/<branch>.json(l)`, `symbiote/workspaces/`). A writer's spend is its Claude Code
transcripts at list prices, each message's usage counted once. These match HV7's figures for HV8
($29.08) and HV5 ($19.21).

| Workspace | Started by | How it ended | Hours | Checks (failed) | Reviews | Writer | Reviews' cost |
|---|---|---|---|---|---|---|---|
| `chore/check-timeout-comment` | the API (HV2's real run) | never landed | — | 3 (2) | 0 | $1.00 | $0 |
| `chore/hive-north-star` | Nucleus | the person's Land (before HV4) | 0.41 | 1 (0) | 1 approved | $1.43 | $0.82 |
| `feature/alpha-ceph-hive-name` | Nucleus | the person's Land (before HV4) | 1.90 | 1 (0) | 0 | $14.91 | $0 |
| `feature/hv3-running-reviewer` | Nucleus | the person's Land (before HV4) | 2.84 | 3 (1) | 0 | $38.94 | $0 |
| `feature/hive-live-progress` | Nucleus | the person's Land (before HV4) | 1.70 | 3 (0) | 3 | $17.20 | $2.29 |
| `feature/hive-honeycomb-background` | Nucleus | merged by the person | — | 1 (0) | 1 with defects | $28.14 | $2.22 |
| `fix/hive-spurious-decide` | Nucleus | Hive's queue | 0.49 | 1 (0) | 1 approved | $3.57 | $1.50 |
| `feature/hive-pull-requests` | Nucleus | Hive's queue | 4.80 | 9 (1) | 8: 7 with defects, then approved | $29.08 | $18.02 |
| `chore/docs-merged-hive` | Nucleus | Hive's queue | 0.27 | 1 (0) | 1 approved | $0.37 | $0.35 |
| `feature/hv5-usage-pacing` | Nucleus | Hive's queue | 0.99 | 1 (0) | 1 approved | $19.21 | $3.30 |
| `spike/hv6-graph-measurement` | Nucleus | stopped by the person (HV7) | — | 0 | 0 | $16.01 | $0 |
| `chore/readme-remake` | Nucleus | merged outside Hive's queue | 1.29 | 2 (2) | 0 | $26.89 | $0 |
| `fix/hive-turn-end-flaky-tests-verdict` | Nucleus | merged by the person | — | 0 | 0 | $18.52 | $0 |
| `feature/redesign-of-the-app` | the Start page | merged by the person | — | 0 | 0 | $29.92 | $0 |

Hours run from Hive's first event to `landed`. Before HV4 they include the wait for the person's
Land. In all:

- **Starts**: 12 of 14 came from Nucleus, with briefs of 2,157 to 5,582 characters. No brief came
  from an issue.
- **Spend**: the writers spent $245.19, $17.86 at the median (from $0.37 to $38.94). 16 reviews in
  7 workspaces cost $28.50: 5 approved, 9 proved defects, and 2 could not run because the sandbox
  was missing.
- **Checks**: 26 checks ran, and 6 failed. A whole check took 6.8 to 7.6 minutes at the median in
  10 of the 11 workspaces that ran one. The README workspace's 2 checks both failed, after 2.5
  minutes at the median.
- **Landings**: Hive's queue landed 4, from 16 minutes to 4.8 hours after the start. All 4
  recorded `pushed: false` for the start branch. The merges reached GitHub's `main` by a later
  push, and the logs do not say why Hive's push did not run.
- **The person stepped in** 11 times in 3 workspaces (`rounds-again`: 7 in HV3, 3 in HV8, 1 in
  live progress). HV8's writer asked for a person 4 times, and Hive stopped it once for that.

### The loop's steps

Each step names what exists on `main` (file and line, and the milestone that built it), what is
missing (and the plan that builds it), and what no real run has shown yet.

**0. Something brings an issue to the classifier.**

- *Exists*: IS1's read-only Issues page. `issuesService` (`packages/cli/src/issues.ts:29`) serves
  `/api/issues` (`packages/cli/src/server.ts:466`). The forge reads issues with `listIssues`
  (`packages/forge/src/github.ts:199`, `gitlab.ts:155`) and `getIssue` (`github.ts:246`,
  `gitlab.ts:178`). The page's buttons only read (`packages/viewer/src/issues/IssuesPage.tsx`).
  With the web on, Nucleus reads an issue with `gh issue view` or `list`
  (`packages/cli/src/nucleus-shell.ts:706`, NU9).
- *Missing*: a click that starts work, **Start in Hive** (HV10); Nucleus's `classify_issue`
  (HV9) and `start_from_issue` (HV10); a label watch and a start queue (HV13).
- *Unproven*: nothing. IS1 read vite and gitlab-runner for real.

**1. The classifier reads the issue: the first step of the pipe.**

- *Exists*: nothing. V75's advisor is the part to reuse: `advise`
  (`packages/cli/src/workspace-advice.ts:265`) runs one turn of Claude Code on Haiku at `low`
  (`ADVISOR_DEFAULTS`, line 29). Its arguments give it no tools, MCP servers, hooks or saved
  session (`claudeAdviceArgs`, line 151; `--tools ''` at line 169). The answer is held to a
  schema (`adviceSchema`, line 51), and the text goes in `<task>` tags (`adviceTask`, line 73).
  Other parts to reuse are its prompt (`ADVISOR`, `packages/cli/src/prompt-text.ts:320`), Nucleus's
  `suggest_settings` (`packages/cli/src/mcp-tools.ts:203`) and `scripts/advisor-eval.mjs`.
- *Missing*: all of it (HV9). It decides take, ask or refuse with reasons, and for a take the kind,
  size, model and effort. It flags what an issue asks beyond a change. It reads a cleaned snapshot
  with no tools and no repository, writes the brief, and keeps a record the Issues page shows. Its
  precision is measured on a labelled and a hostile set, with a bar before it starts work with no
  click.
- *Unproven*: the advisor it builds on sized 18 of 18 written briefs as their author expected. Its
  sheet of the person's own 24 briefs still has 0 labels, 15 days after it was written.

**2. The issue becomes a brief.**

- *Exists*: V24's kinds, parts and headings (`packages/cli/src/workspace-brief.ts`), with
  `MAX_BRIEF` at 20,000 characters (line 12) and `MAX_TITLE` at 200 (line 15). `workOf` builds a
  request's brief (`packages/cli/src/workspace-start.ts:198`). The Issues page cleans an issue's
  HTML in the browser (`issueTokens`, `packages/viewer/src/issues/issue-text.ts:17`).
- *Missing*: the brief written from the classifier's parts, never the issue's text, and the
  cleaning done on the server (HV9).
- *Unproven*: whether a restated brief keeps what a fix needs (HV9a, then HV12).

**3. A Hive workspace starts.**

- *Exists*: `start()` (`packages/cli/src/workspace-lifecycle.ts:137`). With Hive on, it allows
  Claude Code only (line 144) in `auto` mode (line 155). It marks the record `hive: true` (line
  215) and asks HV5's gate before the writer starts (line 220). `hive.start`
  (`packages/cli/src/prompt-text.ts:207`) is filled by `hiveText`
  (`packages/cli/src/workspace-agent.ts:137`). Nucleus's `start_workspace` (`mcp-tools.ts:221`)
  starts with no Confirm while Hive is on (NU8: `packages/cli/src/nucleus-start.ts:37`,
  `packages/cli/src/mcp.ts:150`). The Start page posts the brief
  (`packages/viewer/src/workspaces/StartPage.tsx:384`). Its Hive card, `StartHive.tsx`, shows
  Hive's loop and posts nothing.
- *Missing*: an `issue` in `WorkspaceRequest` (`packages/core/src/workspaces.ts:293`) and in the
  record (`WorkspaceFile`, `packages/cli/src/workspace-record.ts:32`). Also a branch named by the
  issue's number, one workspace an issue, and one start function that refuses an issue the
  classifier has not taken (HV10).
- *Also found*: plan first is forced off only in the browser (`StartPage.tsx:243`). The server
  keeps the request's `planFirst` (`workspace-lifecycle.ts:213`), so a start through the API can
  ask for a plan. Hive then answers the plan with `hive.plan`
  (`packages/cli/src/hive-writing.ts:187`). It does no harm, so it is noted here, not planned.
- *Unproven*: nothing for the start itself: 12 of 14 Hive workspaces started through Nucleus.

**4. The writer works.**

- *Exists*: Claude Code started with `--bg` and `--permission-mode auto`
  (`packages/cli/src/claude-code.ts:449`). A turn's end leads to the check
  (`hive-writing.ts:160`, `turn-ended` at line 190). A failed writer is started again once, then
  stopped with why (`hive-writing.ts:131`), and this is also how Claude Code's "not trusted"
  refusal ends: no code names it. `hive.decide` answers what the writer asks (decision 773).
- *Missing for an issue* (HV10):
  - The writer's environment. `runProgram` spawns `claude --bg` with no `env`
    (`packages/cli/src/programs.ts:28`), so the writer inherits Symbiote's whole environment,
    forge tokens included when set. The person's `gh` login and git's credentials are reachable
    too.
  - The web. The writer's settings file holds only hooks (`agentSettings`, `claude-code.ts:590`),
    so WebSearch and WebFetch keep Claude Code's defaults. The running reviewer, by contrast, runs
    in Claude Code's required sandbox (decision 677, `packages/cli/src/hive-review.ts:115`).
  - A prompt that says where the brief came from (`hive.issue`).
- *Unproven*: whether a `claude --bg` session keeps the starting process's environment at all
  (HV10a). Three of HV7's findings stand: the budget does not see a writer before its first stop
  ($24 to $26 first turns); Hive off leaves the writer's background processes running; an untrusted
  folder waits unsaid.

**5. The check.**

- *Exists*: `checking()` (`packages/cli/src/hive-checking.ts:55`) and `runCheck` (line 120). A
  failure goes back to the writer (`nextRound` with `hive.check`, line 210). There are 3 rounds
  (`HIVE_ROUNDS`, `packages/cli/src/hive-record.ts:25`, decision 651), and the workspace stops at
  the cap (`packages/cli/src/hive-round.ts:288`). HV2, AR2.
- *Missing*: nothing for issues.
- *Unproven*: nothing; 26 real checks. HV7's findings 2 and 3 still cost rounds: flaky timing
  tests failed 3 of 5 checks under the load of four workspaces.

**6. The running reviewer.**

- *Exists*: `reviewing()` (`packages/cli/src/hive-reviewing.ts:68`) starts a review
  (`startReview`, line 124) through HV5's gate (line 84). Approved goes to landing (line 210), and
  proven defects start a round (line 252). HV3.
- *Missing*: nothing for issues. It proves defects, not intent: a harmful change whose tests pass
  gets past it.
- *Unproven*: nothing; 16 real reviews.

**7. Landing.**

- *Exists*:
  - The switch: `hive.lands` (`readLandsBy`, `packages/cli/src/hive-request.ts:44`, `queue` by
    default) at `packages/cli/src/hive-landing.ts:142`.
  - Through the queue (HV4): Hive approves with `via: 'hive'` (`hive-landing.ts:177`) and queues
    the entry (line 187). The merge commit is `Merge <branch>: <title>`
    (`packages/cli/src/merges.ts:354`, made at `packages/cli/src/merge-run.ts:98`). Hive's entries
    are pushed (`packages/cli/src/merge-land.ts:51`).
  - Through a request (HV8): opened by `openRequest` (`packages/cli/src/hive-forge.ts:65`, the
    forge call at line 107). Its description is the brief, what ran and the approval
    (`requestBody`, `hive-request.ts:201`). It is read every 60 s (`REQUEST_POLL_MS`,
    `packages/cli/src/hive-runner.ts:64`). Merged lands the workspace (`hive-forge.ts:332`), and
    closed stops it (line 389).
- *Missing*: `Closes #n` in the request's description and in the merge commit's body; a request
  by default for a workspace from an issue, whatever `hive.lands` says (HV10).
- *Unproven*:
  - The queue landed 4 workspaces here and 2 in HV4's scratch repository. The push of the start
    branch never reached GitHub: the 2 scratch runs pushed to a local bare `origin`, and the 4 here
    recorded `pushed: false`.
  - The request path never met a real forge. That includes GitHub's lazily computed `mergeable`.

**8. The issue linked and answered on the forge.**

- *Exists*: nothing. The `Forge` interface (`packages/forge/src/types.ts:71`) writes only to
  requests: opening one, its description and a review (`github.ts` lines 149, 170 and 292).
  `requestBody` puts the brief on the forge in a request's description.
- *Missing*: all of it (HV11).
  - Comments at each step: taken, asked, refused, request opened, landed, stopped.
  - A label for the step.
  - Closing a landed issue: the forge's keyword closes it into the default branch, and Symbiote
    closes it anywhere else.
  - Only Symbiote's fixed sentences and the classifier's cleaned question are posted.
  - Both forges. The person's `gh` token has the `repo` scope, which can write to issues.
- *Unproven*: everything, until HV12.

**9. Limits.**

- *Exists*: HV5's one gate before every agent Hive starts (`paced`, `hive-round.ts:338`). It
  checks the budget (line 343) and the usage pause (line 364). The start asks only the usage
  check, not the budget (`workspace-lifecycle.ts:220`). `hive.budget` and `hive.usage.pauseAt`
  are read in `packages/cli/src/hive-pacing.ts:36`. A writer's spend comes from its transcript's
  last `cost-state` line (`costIn`, line 230). Hive off stops checks, reviews and writers
  (`turnOff`, `packages/cli/src/hive-off.ts:23`).
- *Missing*: how many issues are worked at once, how many start a day, the classifier's own cost
  and a cap on it (HV13). The budget's blind first turn (HV7).
- *Unproven*: a pause on real usage (HV5).

### A hostile issue: what keeps it from steering the writer

An issue's text is anyone's: 82 of the 100 newest open vite issues came from people with no role
in the project. In the loop it would become an autonomous agent's task. The classifier reads that
text, so a crafted issue can steer it too. It catches the plain cases: an issue that asks for
tokens, speaks to an agent, or asks to change CI or reach outside the repository. It also catches
honest issues that are not work. It does not stop a careful attacker. The plans put seven layers
around it ([HV9](../plan/hv9-issue-classifier.md#what-the-classifier-guards-and-what-it-does-not)):

1. who may bring an issue (the person's click, or a label from someone with write access);
2. Symbiote's rules in code, which refuse what the model may not take;
3. the brief in place of the issue's text;
4. the writer's reach: no forge credentials and no web;
5. the check and the reviewer;
6. a request a person merges, the default for a workspace from an issue;
7. the limits.

Layers 1, 4 and 6 do not depend on any model. Today layer 4 is open: a Hive writer inherits
Symbiote's environment and has the web.

### Ranked: what to build

Sizes compare with lines added under `packages/` by earlier Hive milestones: HV2 2,338, HV4 2,421,
HV5 2,708, HV3 3,565, IS1 3,962 and HV8 6,757. S is under 1,500 lines, M is 1,500 to 4,000, and
L is more.

| Rank | ID | What | Size | Depends on |
|---|---|---|---|---|
| 1 | [HV9](../plan/hv9-issue-classifier.md) | The classifier: the eval first (HV9a), then the CLI (HV9b), then the page and Nucleus (HV9c) | L: HV9a S, HV9b M, HV9c M | IS1, V75 |
| 2 | [HV10](../plan/hv10-workspace-from-issue.md) | A Hive workspace from a taken issue: one start, the issue in the record and branch, the writer confined (measured first, HV10a), a request by default, `Closes #n` | M | HV9 |
| 3 | [HV11](../plan/hv11-issue-answered.md) | The issue answered: comments, labels and closing on both forges, fixed sentences only | M | HV10 |
| 4 | [HV12](../plan/hv12-issue-loop-real-run.md) | A real run on private scratch forges: eight issues, both landing modes | S, a day with the person | HV11 |
| 5 | [HV7](../plan/hv7-steadier-loop.md) (proposed 2026-11-02) | Its budget from the first turn, Hive off stopping what writers started, trust said before a start | its own plan | — |
| 6 | [HV13](../plan/hv13-issue-intake.md) | The label watch and the start queue, with their limits | M to L | HV12, HV7's three parts |

Why this order:

- **The classifier comes first** because nothing may start without it (decision 1000). Its eval
  sets the bar that HV13 needs.
- **HV10 and HV11 make the loop whole on a click.** The person sees every start, as long as no
  watch exists.
- **The real run comes before the watch**, because proven beats claimed. HV12 proves the landing
  through a request and the start branch's push, which no real run has shown.
- **HV7's three parts come before the watch.** Once work starts with no person watching, the
  budget must see the first turn, and Hive off must stop everything.

HV7 keeps its own proposal: this chore ranks it and names the parts the watch needs, without
rewriting it.

### What was measured

Public issues, read only, with the person's `gh` token (one GraphQL query) and without a token on
GitLab (one list and 5 label-event reads):

| | vitejs/vite | gitlab-org/gitlab-runner |
|---|---|---|
| The newest 100 open issues, opened | 2026-04-23 to 2026-11-12 | 2026-09-11 to 2026-11-12 |
| Opened in the last 30 days | 38 | 62 |
| Authors with no role in the project | 82 (9 contributors, 9 members) | not given without a token |
| Comments from outside the project | 108 of 187, on 49 issues | needs a token |
| Edited after they were opened | 26 | not in the list |
| Body length: median, 90th percentile, longest | 3,159, 5,182, 43,716 | 2,445, 7,456, 50,221 |
| Label events set by the issue's own outside author | 52 of 138 (`pending triage` 50, `documentation` 2) | 401 without a token, 5 of 5 |

**Learned**:

- **A label proves nothing by itself.** Issue forms set labels as the author: 52 of 138 vite label
  events. A watch must read who set the label and check their access.
- **A Hive writer inherits Symbiote's environment** (`programs.ts:28`) and has Claude Code's web
  tools. The running reviewer is sandboxed and the writer is not. This matters as soon as a brief
  can come from someone other than the person.
- **Hive's push of the start branch is unproven on GitHub.** All 4 real landings through the queue
  recorded `pushed: false`.
- **3 of the 4 landings through Hive's queue ran with no person after the start**: the
  spurious-decide fix, HV5, and the "Docs: merged" chore. The fourth, HV8, landed after the
  person stepped in 3 times. In all, the person stepped in 11 times in 3 workspaces, 2 of them
  before HV4 removed the person's Land. Every one of the 14 started on the person's request, and
  none from an issue.
- **The advisor's eval of the person's briefs never got its labels** (0 of 24 in 15 days). HV9's
  eval keeps the labelling to one sitting of 40 issues, with a fallback after a week.
- **GitLab tells who set a label, and an author's role, only with a token.** Its watch needs one.
- **Plan first is forced off only in the browser** (`StartPage.tsx:243`). It is harmless, because
  Hive answers a plan, so it is noted and not planned.

**Verification**:

- Every `path:line` in this entry and the five plans was checked against `main` at `a47dda3` by a
  script that reads each cited line and looks for the name the text gives it.
- The IDs HV9 to HV13 and decisions 1000 to 1033 were checked as free on `main` and every branch
  (local and `origin`) before the commit. The highest decision on any branch was 999.
- `node scripts/plan/consolidate.mjs` (without `--write`) reads the new decision rows with no
  message about them.
- Every relative link and anchor in the changed files resolves.
- The writing-docs skill's counter: 11.5 to 14.5 words a sentence on average in the six new
  files, none over 40.
- `pnpm check` passes: 267 test files, 3,684 tests. The branch changes only files under `docs/`.

Not verified:

- No Hive run was made, and no classifier was tried (the person's choices).
- No reader test by a fresh agent was run on these pages.
- That GitHub and GitLab close an issue by keyword only into the default branch comes from their
  documentation, not from a run.
- Whether `claude --bg` keeps the starting process's environment is HV10a's first measurement.
- Why the 4 landings recorded `pushed: false` was not found in the logs.
