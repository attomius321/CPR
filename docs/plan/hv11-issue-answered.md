# HV11 — The issue answered on the forge

[Index](../PLAN.md) · Journal: none yet; measured in
[the chore's journal](../journal/chore-hive-issue-loop-gaps.md)

**Status:** planned (2026-11-12) by the chore `chore/hive-issue-loop-gaps` (from `main` at
`a47dda3`); not started. It needs [HV10](hv10-workspace-from-issue.md), whose record links a
workspace to its issue, and [HV9](hv9-issue-classifier.md), whose decisions it answers.

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

**Not in HV11 (later)**: a bot account or GitHub App in place of the person's token; answering
in the issue's language; reactions in place of comments; reopening an issue whose change is
reverted.
