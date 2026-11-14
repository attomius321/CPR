# HV11 — The issue answered on the forge

[Index](../PLAN.md) · Journal: none yet; measured in
[the chore's journal](../journal/chore-hive-issue-loop-gaps.md)

**Status:** planned (2026-11-12) by the chore `chore/hive-issue-loop-gaps` (from `main` at
`a47dda3`). HV11a and HV11b in progress on `feature/hv11-issue-answered` (from `main` at
`d8193b4`, 2026-11-14), with the details the person agreed (decisions 1071–1077); ready for
review (2026-11-14). It needs
[HV10](hv10-workspace-from-issue.md), whose record links a workspace to its issue, and
[HV9](hv9-issue-classifier.md), whose decisions it answers.

**Problem**. Symbiote writes nothing to an issue. The `Forge` interface
(`packages/forge/src/types.ts:71`) reads issues with `listIssues` (line 90) and `getIssue` (line
92). It writes only to pull and merge requests: it opens one, sets its description and posts a
review (`github.ts` lines 149, 170 and 292; `gitlab.ts` lines 130, 151, 247, 278, 281 and 308).
IS1 left "writing anything to the forge" for later. So an issue's author never hears that Hive took
the issue, asked something, refused it, stopped, or landed the change. On a request landing, GitHub
and GitLab close the issue through `Closes #n` (HV10), but only when the request merges into the
default branch. On a queue landing Hive pushes the start branch: an issue closes there only by a
keyword, and only on the default branch.

The tokens Symbiote already reads can write to issues:

- **GitHub**: the person's `gh` token has the `repo` scope (`gh auth status`, 2026-11-12), which
  covers comments, labels and closing. A fine-grained token needs "Issues: write". Symbiote finds
  the token through `githubToken` (`packages/forge/src/github.ts:347`).
- **GitLab**: HV8 already asks for a token with the `api` scope
  (`packages/cli/src/hive-request.ts:108`), which covers notes and issue edits. Symbiote reads it
  in `gitlabHeaders` (`packages/forge/src/gitlab.ts:90`).

**Goal**: The issue says what Hive did with it, in Symbiote's own words, at each step that
matters: taken, asked, refused, request opened, landed or stopped. A label shows the step on the
forge's own list. A landed issue is closed. Nothing that the classifier or the writer wrote in
their own words is posted, except the classifier's question, cut and cleaned. GitHub and GitLab
both. With `hive.issues.answer` off, nothing is written.

## What the forge package gains

| Method | GitHub | GitLab |
|---|---|---|
| `commentOnIssue(number, body)` → `{ url }` | `POST /repos/{o}/{r}/issues/{n}/comments` | `POST /projects/{id}/issues/{iid}/notes` |
| `closeIssue(number, reason)`, reason `completed` or `not-planned` | `PATCH /repos/{o}/{r}/issues/{n}` with `state` and `state_reason` | `PUT /projects/{id}/issues/{iid}` with `state_event: close` |
| `labelIssue(number, { add, remove })` | `POST` and `DELETE` on `/issues/{n}/labels` | `PUT` with `add_labels` and `remove_labels` |
| `issueState(number)` | the issue's `state` (a conditional read, IS1's cache) | the same |

Symbiote creates the labels it uses once per project if they are missing: `symbiote: working`,
`symbiote: question`, `symbiote: declined`, `symbiote: stopped`. The person can rename them in
`hive.issues.labels`.

## What is written, and when

| Step | Comment | Label | Closed |
|---|---|---|---|
| A workspace starts (HV10) | "Symbiote's Hive is working on this in `<branch>`." | `symbiote: working` | no |
| The classifier asks | "Before Symbiote can work on this, it needs an answer: <question>" | `symbiote: question` | no |
| The classifier refuses | one fixed sentence for each `refusal` value | `symbiote: declined` | no |
| A request opens (HV8) | "A pull request is open: <link>." (a merge request on GitLab) | unchanged | no |
| Landed through the queue | "Landed in `<start branch>` at `<sha>`." | removed | yes, as completed |
| Landed through a request | none: the forge links the request | removed | by `Closes #n` into the default branch; otherwise Symbiote closes it |
| The workspace stops | "Symbiote stopped work on this: <the stop's fixed sentence>." | `symbiote: stopped` | no |

A stop's sentence comes from its kind, not from its note: the rounds ran out, the budget was
reached, the writer asked for a person too often, the writer failed twice, or the request was
closed without a merge. Some notes carry Claude Code's own error text
(`packages/cli/src/hive-writing.ts:138`), which is not posted.

A refused issue is labelled and left open. The project's people decide whether to close it.

## What is never posted

The classifier read text that anyone can write. If Symbiote posted the classifier's own words, an
issue could make Symbiote post what it wants under the person's account. So Symbiote posts only:

- its fixed sentences, filled with Symbiote's own values (a branch, a commit, a link);
- the classifier's question, at most 500 characters, with @-mentions and links removed, inside
  the fixed sentence above.

The classifier's reasons, the brief, the writer's report and every word of the issue stay in
Symbiote's records and on the Issues page. The brief does reach the forge in one place: a request
landing puts it at the top of the request's description (`requestBody`,
`packages/cli/src/hive-request.ts:201`). It is the classifier's restatement, not the issue's text.

The comments appear under the token's account, that is, the person's. Settings' Hive page says
so, and names the account.

## Limits and failures

- At most one comment a step, and at most 6 comments an issue. An issue that is asked again and
  again stops getting comments after the sixth; the record says so.
- Before each write, Symbiote reads the issue's state. It writes nothing to an issue that is
  closed or locked, and records why.
- A write that fails is recorded with the forge's answer and tried again at the next tick, 3
  times at most. It never stops or holds the workspace: the landing is the work, the comment is a
  report.
- Each write is an event in the issue's record (`answered`, `labelled`, `closed`, `write-failed`),
  with the comment's link.

## Settings

- **`hive.issues.answer`**: on by default once issues are used. With it off, nothing is written to
  issues; requests still carry `Closes #n` (HV10).
- **Whether the token may write**: Settings' Hive page says it. For a classic GitHub token,
  Symbiote reads the `x-oauth-scopes` header of a read it already makes. A fine-grained token does
  not list its permissions, so the page says "not known until the first write". On GitLab,
  Symbiote reads `GET /personal_access_tokens/self`.

## Verification

1. **The forge, red first**: each method on GitHub and GitLab, on recorded answers as IS1 and HV8
   recorded theirs; the labels created once; a closed or locked issue; a refused write.
2. **The text**: every fixed sentence filled; a question with mentions, links, Markdown and 2,000
   characters comes out cleaned and cut; no field written by an agent reaches a comment.
3. **The runner**: each step's write, once; the sixth comment the last; a failed write retried 3
   times and the workspace not held.
4. **e2e**: the fake forge records the comments, labels and closing for a workspace from an
   issue, through the queue and through a request.
5. **Real**: in [HV12](hv12-issue-loop-real-run.md), on a private scratch repository and project.
6. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| An issue makes Symbiote post its words | only fixed sentences and a cleaned, cut question |
| Comments under the person's own name surprise them | Settings names the account; `hive.issues.answer` turns it off |
| A loop of asks fills an issue | 6 comments an issue at most |
| A token that reads but cannot write | Settings says so; a refused write is recorded, never retried past 3 |

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV11a | The forge writes to issues | the four methods on both forges, the labels; tests |
| HV11b | Hive answers | the steps' comments, labels and closing, the limits, the record's events, Settings; tests |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 1018 | How does Symbiote write to an issue? | **Four methods on the `Forge` interface, `commentOnIssue`, `closeIssue`, `labelIssue` and `issueState`, on GitHub and GitLab, with the tokens Symbiote already reads** | One place for both forges, as IS1's reads (decision 944) |
| 1019 | What is posted? | **Symbiote's fixed sentences with its own values, and the classifier's question cut to 500 characters without mentions or links; never the reasons, the brief or the writer's report** | The classifier read anyone's text; posted free text would be theirs, under the person's name |
| 1020 | At which steps? | **Taken, asked, refused, request opened, landed and stopped; a label for each; landed closes the issue as completed, a refusal leaves it open** | The person's brief: "the issue linked and answered on the forge" |
| 1021 | Who closes a landed issue? | **The forge, through `Closes #n` into the default branch; Symbiote, when the change landed anywhere else** | Keywords close only into the default branch, on both forges |
| 1022 | How many comments? | **One a step and 6 an issue at most; nothing written to a closed or locked issue** | An issue asked again and again must not fill with comments |
| 1023 | A write that fails? | **Recorded with the forge's answer, tried at the next tick 3 times at most; never holds or stops the workspace** | The landing is the work; the comment reports it |

## Details agreed before building (2026-11-14)

Read on `main` at `d8193b4`, after HV9b, HV9c and HV10 moved the code:

- **Where each step happens.** Taken: `issue-start.ts`, after its `started` event. Asked and
  refused: `classify()` in `issue-classifier.ts`, which runs only with Hive on. Request opened:
  the `request-opened` event in `hive-forge.ts`. Landed and stopped: the `landed` and `stuck`
  events, through `event()` in `hive-round.ts`, where HV10 already judges the take.
- **13 places stop a workspace**, each with a note in its own words; 5 of their kinds are in the
  table above. The others: the agent could not be started, the landing failed 3 times or its
  target diverged, the writer's turn could not be seen, the sandbox refused a host.
- **The queue's merge commit already says `Closes #n`** (HV10c): on the default branch the forge
  may close the issue when Hive pushes, before Symbiote writes "Landed in…".
- **1037's check is already in the record** (`personal.question`).
- **The forge's errors carry no status**: "this label does not exist" and "the write was
  refused" read alike. A `ForgeError` keeps the status and the forge's answer.
- **The account behind the token** needs a read the four methods do not make: `tokenAccount`.
- No answer can be recorded from a real forge without writing to one: the write answers are
  made by hand in each API's documented shape, as IS1's `gitlab-notes.json` was.

Each step adds its own label and removes the other three. Settings shows the labels' names;
they are renamed in `symbiote/config.json`. The e2e lands through the queue on GitHub and through
a request on GitLab, so both forges write end to end; the forge's tests cover every method on
both.

**Decisions agreed (2026-11-14)**:

| # | Question | Decision | Why |
|---|---|---|---|
| 1071 | Where does an answer wait? | **A `due` line in an append-only outbox, `symbiote/issues/answers.jsonl`, and in the issue's `<number>.jsonl`, with Symbiote's own values only; Hive's runner writes it at its tick, only while Hive is on** | Steps happen in the view's classifier, the start and the runner; one writer keeps the limits and the retries in one place, and appends are safe across processes |
| 1072 | Which stop's sentence? (details 1020) | **Every `stuck` event carries a `stop` kind beside its note; one fixed sentence a kind: rounds, budget, asked, failed, request-closed, landing, unseen, sandbox** | The note may hold Claude Code's error text; the kind is Symbiote's |
| 1073 | A landed issue the landing closed? (amends 1022) | **The landed step still comments and removes the label on an issue closed by its own `Closes #n`; nothing else is written to a closed issue, nothing at all to a locked one** | The queue's push closes it on the default branch before the next tick: "Landed in…" would be lost |
| 1074 | How does Symbiote know the forge closed it? (details 1021) | **One request poll (60 s) after the request merged, Symbiote reads the issue: closed, recorded as closed by the forge; open, closed by Symbiote as completed** | No need to know the default branch, and the forge's own close is not doubled |
| 1075 | When is a failed write tried again? (details 1023) | **At the first tick at least 60 s after it failed; 3 tries, then given up and recorded** | Ticks are 2 s apart: three tries would be spent on one short outage |
| 1076 | A question 1037's check holds? | **Not posted: the question's label only, and the record says why** | 1037: the question holds the person's email or a folder of this machine |
| 1077 | How does Settings name the account? | **A fifth read, `tokenAccount`: GitHub's `/user` and its `x-oauth-scopes`, GitLab's `/user` and `/personal_access_tokens/self`; read at most every 10 minutes** | The four methods do not say who writes |

## As built (2026-11-14)

As planned and agreed, with these differences:

- **Where the code is.** The forge's methods in `packages/forge/src/github.ts` and `gitlab.ts`;
  `ForgeError` (the status and the forge's answer, cut to 300 characters) in `http.ts`, which every
  refusal now throws with the same message as before. The text in
  `packages/cli/src/issue-answer.ts` (the steps, the sentences, `cleanQuestion`, the settings);
  the outbox, the writer and Settings' service in `issue-answering.ts`; the stop kinds,
  `HIVE_STOPS`, in `hive-record.ts`. Hive's events become steps in `event()` of `hive-round.ts`,
  beside HV10's `judged`; the runner ticks the writer after each look (`hive-runner.ts`), with
  `origin`'s forge from `lander.requests`, so a runner without one writes nothing.
- **The refusals' and stops' sentences** (1072): `not-a-change` "it does not ask for a change to
  the code", `out-of-scope` "it is outside what this project's maintainers set Symbiote to take
  on", `too-large` "it is too large for one change", `unsafe` "it asks for something Symbiote does
  not do on its own". Stops: rounds "its rounds of checks and reviews ran out", budget "it reached
  its budget", asked "the writer asked for a person too often", failed "the writer failed twice"
  (also an agent that could not be started), request-closed "its pull request was closed without
  a merge", landing "the change could not be landed" (not pushed, no branch to land in, no forge,
  a request not opened, taken out of the queue, 3 failed landings or a diverged target), unseen
  "the writer's work could not be followed", sandbox "the writer needed a host it may not reach".
- **The question, cleaned** (1019): plain text, one line. Unicode's format characters (zero-width,
  bidirectional) are dropped; HTML and comments, images whole, links but their text, addresses
  (`scheme://`, `www.`, `javascript:`…, e-mail), @-mentions and teams, references (`#12`, `!12`,
  `&12`, `owner/repo#12`, `GH-12`, `~label`, `%milestone`, `$12`) and Markdown's marks (headings,
  quotes, lists, rules, tables, emphasis, code) go; cut at a word to 500 characters with its
  ellipsis. Nothing left: not posted (`held: 'empty'`).
- **Who writes when a forge cannot be read.** A step waits, not counted as a try, while `origin`'s
  forge cannot be found; with no token, or an issue on another forge than `origin`'s, it is
  recorded as not written.
- **The label calls.** A label to remove is removed only if the issue has it (the state read
  before the writes says), and a step whose labels need no change makes no call. GitHub's adds are
  one call, its removals one each; GitLab's are one edit.
- **The fake forge** answers the writes, the project's labels and the account, and closes an issue
  named by `Closes #n` when a request merges into its `defaultBranch` (`main`): the bare
  repository's HEAD named `master`.
- **Settings' labels row** shows the names and says they are renamed in `hive.issues.labels`; no
  editor, as agreed.

## Results (2026-11-14)

- **Tests, red first**: the forge 19 (17 on hand-made answers in each API's documented shape, 2 of
  both adapters against the fake forge; red on the missing methods); the text 20; the writer and
  Settings' service 21; the start and the classifier 2. Four mutations of the writer (7 comments,
  no landing exception, no retry wait, no lock check) were each caught.
- **e2e** (`issues-answered.spec.ts`, 3 tests, 24 s): through the queue on GitHub, the issue
  commented when taken and when landed, labelled, then closed as completed by Symbiote; through a
  merge request on GitLab, commented when taken and when the request opened, closed by its
  `Closes #1` and recorded as closed by the forge, never closed twice; Settings' rows.
- **Not verified here**: a real forge. HV12 runs it on private scratch repositories, as planned;
  nothing in this branch wrote to GitHub or GitLab.

**Not in HV11 (later)**: a bot account or GitHub App in place of the person's token; answering
in the issue's language; reactions in place of comments; reopening an issue whose change is
reverted.
