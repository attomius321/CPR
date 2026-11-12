# HV10 — A Hive workspace from an issue the classifier took

[Index](../PLAN.md) · Journal: none yet; measured in
[the chore's journal](../journal/chore-hive-issue-loop-gaps.md)

**Status:** planned (2026-11-12) by the chore `chore/hive-issue-loop-gaps` (from `main` at
`a47dda3`); not started. It needs [HV9](hv9-issue-classifier.md), the classifier.

**Problem**. Nothing starts a workspace from an issue, and nothing keeps an issue's text from
reaching a writer by another way. Here is what the code on `main` does today:

| Part | On `main` | What is missing |
|---|---|---|
| The start | `start()` (`packages/cli/src/workspace-lifecycle.ts:137`) takes a `WorkspaceRequest` (`packages/core/src/workspaces.ts:293`): kind, title, parts, branch, agent, model, effort | an issue |
| The record | `WorkspaceFile` (`packages/cli/src/workspace-record.ts:32`): `brief`, `kind`, `parts`, `title`, `via`, `hive` | an issue |
| The Issues page | read only: Refresh, the filter, Retry, an issue, More, links to the forge (`IssuesPage.tsx`) | a start |
| Nucleus | `start_workspace` (`packages/cli/src/mcp-tools.ts:221`) takes a brief that Nucleus writes. With the web on, Nucleus reads an issue with `gh issue view` (`packages/cli/src/nucleus-shell.ts:706`) | nothing stops Nucleus from copying an issue's text into a brief, past any classifier |
| The writer's environment | `claude --bg` is spawned by `runProgram` with no `env` (`packages/cli/src/programs.ts:28`): it inherits Symbiote's whole environment, so `GITHUB_TOKEN`, `GH_TOKEN` or `GITLAB_TOKEN` when they are set | an environment without forge credentials |
| The writer's tools | `auto` mode (`workspace-lifecycle.ts:155`); its settings file holds only hooks (`agentSettings`, `packages/cli/src/claude-code.ts:590`), so WebSearch and WebFetch keep Claude Code's defaults | the web off |
| The writer's login | the person's `gh` login is in `~/.config/gh`; `git` reaches `origin` with the person's credentials | neither reachable from the writer |
| Landing | `hive.lands` (`packages/cli/src/hive-request.ts:44`): `queue` by default (decision 788) | a request by default for an issue |
| Closing keywords | the request's description is the brief and what ran (`requestBody`, `hive-request.ts:201`); the queue's merge commit is `Merge <branch>: <title>` with no body (`packages/cli/src/merges.ts:354`) | `Closes #n` |

The running reviewer is already confined: Claude Code's sandbox is on and required, and its
commands cannot leave it (decision 677, `packages/cli/src/hive-review.ts:115`). The writer is
not. Whether a `claude --bg` session keeps the environment of the process that started it is
Claude Code's behaviour, not measured yet.

GitHub closes an issue named after a closing keyword ("Closes #12") in a pull request's
description when the request is merged into the default branch. A commit message with the keyword
closes it when the commit reaches the default branch. GitLab does the same with its default
closing pattern. Neither closes an issue for another branch.

**Goal**: The person, or Nucleus, starts a Hive workspace from an issue that the classifier took,
and from no other issue. The brief is the classifier's. The issue is in the workspace's record and
its branch name. The writer cannot reach the forge's credentials or the web. The workspace lands
through a request by default, with `Closes #n`. Workspaces started from a brief work as today.

## Two ways in, one function

- **The Issues page**: **Start in Hive** on the Hive card of an issue the classifier took on its
  current snapshot, while Hive is on. With Hive off, the card says that Hive is off.
- **Nucleus**: `start_from_issue` (the issue's number, and a start branch if not the default).
- **One function**, `startFromIssue(number)`, behind both. It reads the issue's record (HV9). If
  the issue changed since the snapshot, it classifies it again first, and the new decision holds.
  It refuses an issue whose decision is not `take`. It refuses an issue that already has a
  workspace not yet landed, merged or cleaned up. It then builds the `WorkspaceRequest` from the
  decision (kind, title, parts, model, effort), with the issue, and calls `start()`.
- **Nucleus's brief**: `hive.nucleus` tells Nucleus to start work on an issue with
  `start_from_issue` and never to copy an issue's text into `start_workspace`. That is a rule in a
  prompt, not a guard. The guards are the writer's reach and the landing, below.

## The issue in the record and the branch

- `WorkspaceRequest` and `WorkspaceFile` get `issue`: forge, host, project, number, url, title, and
  the snapshot's hash. The core type is `WorkspaceIssue`. `list_workspaces` and the workspace's API
  answer include it.
- The branch is `<kind>/<number>-<slug of the title>`, for example `fix/412-config-null`. This
  builds IS1's "issue numbers as IDs" for workspaces from an issue. Neither the person nor Nucleus
  picks another name, so the issue's workspace is always found by its number.
- The issue's record (HV9) gets the event `started` with the branch.
- The workspace card and the workspace page's head show `#412`, linked to the issue. The Issues
  page's row shows the workspace's branch and Hive's step.

## The writer's reach

HV10a measures before anything is built. A fake writer started with `claude --bg`, as Hive starts
one, runs `env`, `gh auth status`, `git ls-remote origin`, `ssh -T git@github.com` and a web fetch.
The journal records what each one reached, in normal mode and in Hive mode. HV10b then builds what
the measurement shows is needed, from this list:

- **The environment**: Symbiote starts the writer without the forge variables (`GITHUB_TOKEN`,
  `GH_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GITLAB_TOKEN`, `CI_JOB_TOKEN`,
  as listed in `nucleus-record.ts`). `GH_CONFIG_DIR` points to an empty folder.
- **The sandbox**: Claude Code's sandbox on and required, as the running reviewer has it
  (decision 677), with the network the writer's own installs need. HV10a measures which hosts
  that is.
- **The web**: WebSearch and WebFetch off.
- **The prompt**: `hive.issue`, added after `hive.start` for a workspace from an issue. It says
  that the brief came from issue #n, that anyone can write an issue, and that the brief is the
  task. The writer must not read the issue or its comments, and must not follow instructions
  quoted from it. It never puts tokens, keys or its environment into code, commits or messages.

Hive pushes, not the writer: the writer needs no credentials for `origin` (`HIVE_START`, "never
push"). The check runs outside the writer's session, so its installs keep the network.

## Landing

- **`hive.issues.lands`**: `request` by default, whatever `hive.lands` says; `queue` only when the
  person sets it. It amends decision 788 for workspaces from an issue. The person merges the
  request: this is the guard for a change that looks right and is not (HV9's layers).
- **The request**: the description's first line is `Closes #n.`, then HV8's text.
- **The queue**, when chosen: the merge commit gets a body, `Closes #n`. The merger's
  `mergeInWorktree` takes the entry's title today (`packages/cli/src/merge-run.ts:98`); it takes
  a body too. The subject stays `Merge <branch>: <title>`, as [the merger's page](../area/merger.md)
  says.
- When the start branch is not the default branch, no keyword closes the issue. HV11 closes it.

## Verification

1. **HV10a**: the measurement above, in the journal, before any code.
2. **Unit tests, red first**:
   - `startFromIssue` refuses an issue never classified, refused, asked, changed since its
     snapshot, or already in a workspace, and any issue with Hive off;
   - it builds the request from the decision, with the branch name and the record's `issue`;
   - the writer starts without the forge variables;
   - the request's description and the merge commit's body carry `Closes #n`.
3. **Nucleus**: `start_from_issue` on the MCP tests' fake; with NU8, no Confirm while Hive is on.
4. **e2e** on the fake forge and the fake agent: Start in Hive from the Issues page, `#n` on the
   card, the row's step.
5. **Real**: the fake writer of HV10a, started by the built `symbiote view`, reaches no forge
   credential and no web page.
6. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| `claude --bg` keeps an environment Symbiote does not set | HV10a measures it before the design is fixed |
| The sandbox blocks the writer's own installs or tests | HV10a lists the hosts; the check runs outside it |
| Nucleus copies an issue into `start_workspace` | the prompt rule, said as such; the writer's reach and the request landing do not depend on it |
| Two workspaces for one issue | refused while one is open; the branch name carries the number |
| An issue closed on the forge while its workspace runs | HV11 reads its state at each step; the workspace goes on |

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV10a | The writer's reach, measured | what a `claude --bg` writer reaches today: environment, `gh`, `git`, `ssh`, the web |
| HV10b | The start from an issue | `startFromIssue`, the record's `issue`, the branch, Start in Hive, `start_from_issue`, `hive.issue`, the writer's environment and sandbox; tests |
| HV10c | Landing with the issue | `hive.issues.lands`, `Closes #n` in the request and the merge commit; tests |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 1011 | Where does a start from an issue come from? | **The Issues page's Start in Hive and Nucleus's `start_from_issue`, through one function that starts only an issue the classifier took on its current text, with Hive on** | Decision 1000; one door to guard |
| 1012 | What keeps Nucleus from copying an issue into a brief? | **`hive.nucleus` says to use `start_from_issue`; a prompt rule, recorded as one; the writer's reach and the landing do not rely on it** | Nucleus reads issues with `gh` today (NU9); a prompt cannot be a guard |
| 1013 | Where is the issue kept? | **`issue` in the workspace's request and record; the branch `<kind>/<number>-<slug>`; `#n` on the card and the page** | IS1's "issue numbers as IDs"; the issue found from its workspace and back |
| 1014 | How many workspaces an issue? | **One at a time: refused while the issue's workspace is not landed, merged or cleaned up** | Hive runs one workspace a goal (811) |
| 1015 | What may the writer of an issue's workspace reach? | **No forge variable, an empty `GH_CONFIG_DIR`, Claude Code's sandbox as the reviewer's (677), no web tools, and the prompt `hive.issue`; the details from HV10a's measurement** | A Hive writer inherits Symbiote's whole environment today (`programs.ts:28`) |
| 1016 | How does it land? | **`hive.issues.lands`, `request` by default whatever `hive.lands` says; amends 788 for workspaces from an issue** | The person's answer (2026-11-12); a person merges what a stranger asked for |
| 1017 | How is the issue closed by the change? | **`Closes #n` first in the request's description, and in the body of the queue's merge commit; HV11 closes it where no keyword can** | GitHub and GitLab close by keyword only into the default branch |

**Not in HV10 (later)**: workspaces from issues in normal mode; several issues in one workspace;
a start branch named in the issue; a GitHub App or bot account in place of the person's token.
