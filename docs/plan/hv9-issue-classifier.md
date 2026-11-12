# HV9 — The classifier: an agent reads an issue before anything starts

[Index](../PLAN.md) · Journal: none yet; measured in
[the chore's journal](../journal/chore-hive-issue-loop-gaps.md)

**Status:** planned (2026-11-12) by the chore `chore/hive-issue-loop-gaps` (from `main` at
`a47dda3`); not started. It is the first of five milestones that bring a forge's issues into
Hive's loop (HV9 to HV13). The chore's journal ranks them and says what each step of the loop has
today.

**Problem** (the person, 2026-11-12: "a classifier agent is the first step of the pipe. It reads
an issue before anything else runs and decides what happens to it; no workspace starts from an
issue it has not passed"). Today nothing reads an issue for Hive. The Issues page (IS1) shows a
repository's issues and writes nothing. Every Hive workspace so far started from a brief that the
person or Nucleus wrote. A workspace from an issue would put text that anyone can write into the
prompt of an agent that runs in Claude Code's `auto` mode and that Hive lands with no person.

Issues on two public projects, read on 2026-11-12 (the 100 newest open issues of each):

| | vitejs/vite (GitHub) | gitlab-org/gitlab-runner (GitLab) |
|---|---|---|
| Opened in the last 30 days, still open | 38 | 62 |
| Authors with no role in the project | 82 of 100; 9 contributors, 9 members | not given without a token |
| Comments by people outside the project | 108 of 187, on 49 of 100 issues | read only with a token |
| Edited after they were opened | 26 of 100 | not in the list's answer |
| Body length: median, 90th percentile, longest | 3,159, 5,182 and 43,716 characters | 2,445, 7,456 and 50,221 |
| Longer than a brief may be (20,000 characters) | 1 | 1 |
| Bodies with HTML tags; with links | 41; 93 | 5 hold HTML comments |

Symbiote's own Hive workspaces, from its records (14, the chore's journal):

- 12 of 14 were started by Nucleus, with briefs of 2,157 to 5,582 characters. The other 2 came
  through Symbiote's Start page or its API, with briefs of 176 and 487 characters. No brief came
  from a stranger's text.
- A writer spent $17.86 at the median, from $0.37 to $38.94, at list prices from its Claude Code
  transcripts. The running reviews added $0 to $18.02 a workspace.

A wrong "take" therefore costs about $18 of a writer and an hour of the machine, and with
`hive.lands: queue` it lands in the start branch with no person. A classification is one turn of
a small model on at most 20,000 characters.

What exists to reuse is V75's advisor (`packages/cli/src/workspace-advice.ts`). It runs one turn
of Claude Code on Haiku at `low` (`ADVISOR_DEFAULTS`, line 29). Claude Code gets no tools, no
hooks, no MCP servers and no saved session (`claudeAdviceArgs`, line 151). The answer is held to a
JSON schema (`adviceSchema`, line 51), and the brief goes on stdin between `<task>` tags
(`adviceTask`, line 73). On 18 written briefs it gave the size its author expected 18 times, in
3.3 s at the median ([V75's journal](../journal/v75-suggested-settings.md)). Its eval sheet of the
person's own 24 briefs still has 0 labels, 15 days after it was written.

**Goal**: Before any Hive workspace starts from an issue, a classifier reads the issue and answers
take, ask or refuse, with its reasons. For an issue it takes, the classifier gives the kind of
work, the size, the writer's model and effort, and the brief that the writer gets in place of the
issue's text. Symbiote records each decision and shows it on the Issues page. The classifier's
precision is measured on a labelled set before it may start anything without a click (HV13).
Where no one uses issues, nothing changes: the Start page, Nucleus and Hive's loop work as today.

## What the classifier decides

The classifier answers one JSON object, held to a schema that Symbiote builds for each run:

| Field | Values | What it is for |
|---|---|---|
| `decision` | `take`, `ask` or `refuse` | the three ways an issue can go on |
| `reasons` | 1 to 3 sentences of at most 300 characters | shown on the Issues page; never posted on the forge (HV11) |
| `refusal` | `not-a-change`, `out-of-scope`, `too-large` or `unsafe` | why an issue is refused, in a word HV11 can answer with |
| `question` | with `ask`: one question of at most 500 characters | what the issue's author must answer first (HV11 posts it) |
| `kind` | `feature`, `fix`, `refactor`, `chore` or `spike` | V24's kinds; the brief's parts follow from the kind |
| `title` | at most 200 characters (`MAX_TITLE`) | the workspace's name and branch |
| `parts` | the kind's parts (V24), in the classifier's own words | the brief |
| `size` | `small`, `medium` or `large` | shown, and the reason for the model and effort |
| `model`, `effort` | from the writer agent's own list, as V75's schema builds it | the writer's settings |
| `flags` | `agent-instructions`, `secrets`, `outside-actions`, `ci-or-release`, `new-dependency` | what the issue asks beyond a change to the code |

`not-a-change` covers a question, a support request or a discussion. `too-large` covers an issue
with more than one goal: Hive runs one workspace a goal (decision 811). Plan first is not a field,
because Hive answers a plan with `hive.plan` (decision 773).

Symbiote's code applies its own rules around the model's answer:

- **Before the model**: Symbiote looks for hidden text (HTML comments, zero-width and
  bidirectional characters) and adds the flag `hidden-text` itself. A body longer than 20,000
  characters is cut there, and the flag `cut` is added.
- **After the model**: an answer with `secrets`, `agent-instructions` or `outside-actions` is
  refused as `unsafe`, whatever the model decided. The model cannot take such an issue.
- **The schema** holds every field to its type and length. An answer that does not fit fails. It
  is tried once more, and then recorded as failed. Nothing starts from a failed classification.

## What the classifier reads

The classifier reads a snapshot of the issue: its title, body and labels, the author's role, when
it was opened and last edited, and the comments of the project's members. Members are GitHub's
`OWNER`, `MEMBER` and `COLLABORATOR`, or on GitLab an access level of Developer or above (read with
a token). Symbiote counts the comments of people outside the project and does not pass them on. On
vite, 49 of 100 issues carry such a comment, and anyone can add one after a maintainer has looked.
The body is read, as data: the issue is its author's request.

Symbiote cleans the text the way the Issues page does (`issue-text.ts`, IS1 decision 949). It
drops HTML comments, scripts and styles whole, and turns images into links. This runs on the
server, before the model sees anything.

The record keeps the snapshot's hash and time. If someone edits the issue after the snapshot (26
of 100 vite issues were edited), Symbiote classifies it again before anything starts from it.

The classifier also gets a short project card. The card holds the repository's name, the kinds of
work, the check's commands, and the text of `hive.issues.about` from `symbiote/config.json`. The
person writes that text: what the project is, and what Hive may take on. The card holds no file
of the repository.

## What the classifier may do

The classifier may only answer. It runs the way V75's advisor runs: one turn (`-p`), its system
prompt replaced by the prompt `hive.classify`, `--tools ''`, `--safe-mode`, `--strict-mcp-config`
and `--no-session-persistence`. It runs in an empty folder of its own in Symbiote's cache. The
issue goes on stdin between `<issue>` tags. The classifier has no access to the repository, not
even to read it.

Three reasons keep the repository out:

- The decision does not need it: V75 sized 18 of 18 briefs without reading a file.
- A hostile issue could steer what the classifier reads. Its question is posted on the forge
  (HV11), so reading would open a way for the repository's content to leave.
- What needs the code, such as whether a bug is already fixed, is the writer's first step. A fix's
  brief has a "How to reproduce" part for it.

## The brief the writer gets

Symbiote writes the brief from `kind`, `title` and `parts`, with V24's headings
(`workspace-brief.ts`). The first line says where the brief came from: "From issue #n (link),
classified at <time>." The writer never gets the issue's own text. A part may quote the issue's
code, commands or error output in a fenced block marked as quoted from the issue, because a fix
needs the exact error. The prompt `hive.classify` tells the classifier to restate the request in
its own words and never to carry an instruction aimed at an agent.

The brief is public when Hive lands through a request. `requestBody` puts the brief at the top of
the request's description (`packages/cli/src/hive-request.ts:201`).

## What the classifier guards, and what it does not

The classifier is a language model that reads text anyone can write. A crafted issue can make it
answer `take` and restate the attacker's request in the brief. So the classifier is not the guard
against a crafted issue. It catches the plain cases: an issue that asks for tokens, speaks to an
AI agent, or asks to change CI, publish a release or reach outside the repository. It also
catches honest issues that are not work: questions, support requests, discussions, and issues too
vague to do. HV9a measures how often, on a hostile set written for it.

The guards against a crafted issue sit around the classifier, in layers:

1. **Who may bring an issue**: the person's click (HV10), or a label set by someone with write
   access (HV13). A label alone proves nothing: on vite, outside authors set 52 of 138 labels
   themselves, through the project's issue forms.
2. **Symbiote's rules in code**: hidden text, the length, and the flags that refuse whatever the
   model decided.
3. **The brief in place of the issue's text**, every field held to the schema.
4. **The writer's reach** (HV10): no forge token or login, no web tools, and a prompt that says
   where the brief came from. Today a Hive writer inherits Symbiote's whole environment and has
   Claude Code's web tools (HV10's problem).
5. **The check and the running reviewer**. They prove defects, not intent: a harmful change
   whose tests pass gets past both.
6. **The landing**: through a request by default for a workspace from an issue (HV10), so that
   a person merges it. This is the guard for a change that looks right and is not.
7. **The limits**: `hive.budget`, HV5's pause, and HV13's caps on issues at once and per day.

## Which model

The classifier runs on Claude Code's small model at `low`, as the advisor does (V75 decision
544). Settings can change it: `hive.classifier.model` and `hive.classifier.effort`. HV9a compares
Haiku at `low`, Sonnet at `medium` and Opus at `high` on the eval set. It measures the precision
of take, the hostile set, the time and the cost. Larger models may resist injected instructions
better, and the eval says whether that is worth their cost. Hive drives Claude Code only (decision
658), so there is no Codex classifier.

## The record and what the person sees

Symbiote writes `symbiote/issues/<number>.json`. Like Symbiote's other records, git ignores it.
The record holds:

- the forge, host and project, so that a record of another origin is never read;
- the snapshot: its hash and time, what was read, and how many comments were left out;
- the classifier's model, effort, time and cost (Claude Code's `total_cost_usd`);
- the decision with every field, and the flags Symbiote added;
- what followed: the workspace's branch, the question, the comments posted (HV10, HV11).

Each step is an event in `symbiote/issues/<number>.jsonl`: `classified`, `failed`,
`classified-again`, then HV10's and HV11's events.

The Issues page shows the decision in two places:

- **A row** carries a chip: Taken, Asked, Refused or Failed. An issue never classified has none.
- **The issue's view** gets a Hive card: the decision, the reasons, the flags, the brief it would
  start, the model and effort, the cost, and when it ran. **Classify** runs the classifier, and
  **Classify again** shows once the issue has changed since.

Nucleus gets the tool `classify_issue` (an issue's number), which answers the decision. Like
`suggest_settings` (decision 582), it asks for no Confirm: it changes nothing in the repository.

The classifier serves Hive. With Hive off, the page shows past decisions and offers no
**Classify**: normal mode's loop is out of this milestone's scope.

## A refused issue

Nothing starts from a refused issue. The record keeps the decision, and the Issues page shows it.
HV11 answers it on the forge, with a fixed sentence for its refusal and a label. Symbiote offers
no "Start anyway". The person can still start a workspace of their own from the Start page, with
a brief they write. That workspace is not "from an issue", and the classifier is not asked. After
the issue changes, **Classify again** asks the classifier once more.

## Measuring its precision

HV9a measures the classifier before it is built into Symbiote, with a script modelled on
`scripts/advisor-eval.mjs` (`sheet` and `run`):

- **The set**: 80 issues.
  - 40 real issues from vite and gitlab-runner, open and closed, across their labels.
  - 20 of this repository's own briefs, written as issues: the 14 Hive workspaces and 6 others.
    Each should be taken, and its kind is known.
  - 20 hostile issues written for the eval. Some carry an instruction to an agent in the body, in
    an HTML comment, in a code block or in the title. Some ask for tokens or the environment, or to
    change CI or publish. The rest are honest issues with alarming words, which must not be
    refused.
- **The labels**: the person labels the 40 real issues blind (take, ask or refuse, and the kind),
  in one sitting of about 30 minutes. V75's sheet of 24 has waited 15 days with no label. If the
  person's labels have not come within a week, the eval goes on with the plan author's labels,
  marked as theirs.
- **The numbers**, for each model:
  - the precision of take: of the issues it took, the share that the label also takes;
  - the share of the hostile set taken, and the share of honest alarming issues refused;
  - agreement on the kind, and the share of asks;
  - the time and the cost, at the median and the 90th percentile.
- **The bar** before HV13 may start a workspace with no click: a precision of take of at least
  95 % on the real issues and none of the hostile set taken, on the model chosen. Below the bar,
  the classifier still runs on a click (HV10), and the person sees its decision.
- **The live count**, on Hive's Settings page: how each taken issue ended (landed, stopped, or its
  request closed without a merge), and each refused issue the person later started by hand.

## Verification

1. **Unit tests, red first**, on IS1's recorded answers from vite and gitlab-runner and on the
   hostile set:
   - the snapshot: outside comments left out, the cleaning, the hash;
   - the rules: the refusing flags whatever the decision, hidden text, a cut body;
   - the schema built from the agent's models, and the brief built from the parts;
   - the record and its events.
2. **The classifier's arguments**: no tools, no MCP servers, no saved session, its own folder, as
   V75 tests `claudeAdviceArgs`.
3. **The server**: `POST /api/issues/<n>/classify` refused for a pull request's number, with no
   forge, and with Hive off; the record read back.
4. **The viewer**: unit tests of the card's words; an e2e spec on the fake forge with a fake
   classifier (the e2e suite's fake agent): Classify, each decision shown, Classify again after
   an edit.
5. **Real**: HV9a's numbers in the journal; the built classifier on 10 vite issues on the person's
   machine, read only.
6. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| A crafted issue passes the classifier | it is one of seven layers; the request landing (HV10) puts a person before `main` |
| The person's labels never come (V75's 24 still wait) | a set of 40, one sitting, a date; the author's labels after a week, marked |
| Haiku misreads a large or vague issue | HV9a compares three models; Settings can change it |
| A body over 20,000 characters loses its end | cut and flagged; the card says so; vite and gitlab-runner had 1 each in 100 |
| An issue edited after it was taken | the snapshot's hash; classified again before a start |
| Members' comments on GitLab need a token | without one, only the body is read, and the card says so |

**Order**: HV9a first. Its numbers choose the model and set the bar before any code is written.

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV9a | The eval (a spike) | the set of 80, the labels, `scripts/classifier-eval.mjs`, three models measured, the prompt's first text |
| HV9b | The classifier in the CLI | the snapshot, the run, Symbiote's rules, the record, `POST /api/issues/<n>/classify`; tests |
| HV9c | The page, Nucleus and Settings | the Hive card and chips, `classify_issue`, the prompt and model in Settings; unit and e2e tests |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 1000 | What comes first in Hive's loop from an issue? | **The classifier: no workspace starts from an issue that it has not taken on the issue's current text** | The person's direction (2026-11-12); 82 of 100 vite issues come from people with no role in the project |
| 1001 | What does the classifier read? | **A snapshot: the title, the body, the labels, the author's role and the members' comments, cleaned as IS1 cleans an issue, at most 20,000 characters; outside comments counted, not read; an edit after the snapshot means classifying again** | 108 of 187 vite comments came from outside, on 49 of 100 issues; 26 of 100 were edited |
| 1002 | What may the classifier do? | **Answer only: one turn, no tools, no MCP servers, no hooks, no saved session, an empty folder, no access to the repository; a project card from `hive.issues.about` instead** | V75 sized 18 of 18 briefs with no file; reading would give a hostile issue a way out through the posted question |
| 1003 | What does it decide? | **`take`, `ask` or `refuse` with reasons; for a take, the kind, title, parts, size, model and effort; flags for what the issue asks beyond a change** | The person's list: take or not and why, the kind, the size and settings, a question, whether it is safe |
| 1004 | What does the writer get? | **A brief that Symbiote writes from the classifier's parts with V24's headings, never the issue's text; quotes of code or errors only in fenced blocks marked as the issue's** | The writer runs in `auto` mode with no person; a fix needs the exact error |
| 1005 | Which answers refuse whatever the model decided? | **Any answer flagged `secrets`, `agent-instructions` or `outside-actions` is refused as `unsafe` by Symbiote's code; `hidden-text` and `cut` are Symbiote's own flags** | The rule must hold when an issue persuades the model |
| 1006 | Which model? | **Claude Code's small model at `low`, as the advisor, until HV9a's eval says otherwise; `hive.classifier.model` and `.effort`; the prompt `hive.classify`, edited in Settings** | V75 decision 544; Hive drives Claude Code only (658) |
| 1007 | Where is a decision kept? | **`symbiote/issues/<number>.json` and `.jsonl`: the snapshot, the run, the decision, Symbiote's flags and what followed** | Recorded beats silent; one place for HV10, HV11 and HV13 |
| 1008 | Where is it shown? | **The Issues page: a chip on each row, a Hive card on the issue with Classify; Nucleus's `classify_issue`, with no Confirm; only with Hive on** | The person sees every decision; normal mode's loop is out of scope |
| 1009 | What happens to a refused issue? | **Nothing starts; the decision is recorded, shown and answered (HV11); no "Start anyway"; the person's own Start page stays theirs** | No workspace starts from an issue the classifier has not passed |
| 1010 | When may it start work with no click? | **Only on a model whose precision of take is at least 95 % on the person's labelled real issues and which took none of the hostile set; below that, a click (HV10) starts work** | A wrong take costs about $18 and an hour, and with the queue it lands with no person |

**Not in HV9 (later)**: reading the repository; finding duplicate or already fixed issues;
classifying pull requests; a Codex classifier; classifying in normal mode.
