# HV10 — A Hive workspace from an issue the classifier took

[Index](../PLAN.md) · [Journal](../journal/hv10-workspace-from-issue.md); first measured in
[the chore's journal](../journal/chore-hive-issue-loop-gaps.md)

**Status:** planned (2026-11-12) by the chore `chore/hive-issue-loop-gaps` (from `main` at
`a47dda3`); HV10a measured, ready for review (As built, below: decisions 1050–1054 give 1015's
details); HV10b and HV10c in progress on `feature/hv10-workspace-from-issue` (from `main` at
`834128a`; decisions 1061–1066 below). It needs [HV9](hv9-issue-classifier.md), the classifier.

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

## As built (HV10a)

HV10a ran on 2026-11-13 on `spike/hv10a-writer-reach` (from `main` at `4bfdfde`), with Claude
Code 2.1.323, in a scratch repository with its own worktrees (`/tmp/hv10a-reach`, trusted by the
person, removed after). Each fake writer was started by the built `claudeCode().start()`, with
`agentSettings()`'s hooks and `runProgram`. The spawning process had the environment of the
person's running `symbiote view`, plus a marker and a fake `GITHUB_TOKEN`. The repository's
`origin` was this repository on GitHub, for reads only. The journal has how it ran and what was
learned. Nothing was pushed or posted.

What differs from the plan:

- **The environment Symbiote spawns `claude --bg` with does not reach the writer.** `--bg` hands
  the session to a process that Claude Code's daemon started beforehand (`bg-spare`). The writer's
  commands see the daemon's variables, which come from whichever `claude` started the daemon.
  The marker and the fake token reached 0 of 7 writers. Removing the forge variables when
  spawning `claude --bg` (1015's first clause) would therefore do nothing. The `env` key of
  `--settings` does reach the writer (run F), and so does the sandbox's `credentials` (run D).
- **The sandbox alone keeps the person's credentials within reach.** It denies writes and the
  network, but it lets the writer read the whole home folder. With `github.com` allowed,
  `git ls-remote origin` reached GitHub with the person's SSH key, through the sandbox's proxy
  (`GIT_SSH_COMMAND`). `~/.config/gh/hosts.yml` was readable too. The sandbox's `credentials`
  setting (`files` and `envVars`, each `deny`) hid both.
- **An empty `GH_CONFIG_DIR` is not a guard.** `gh` then has no login, but the file it would
  have read stays readable at its usual path.
- **The probes left out the person's MCP servers.** Every writer had the person's claude.ai
  connectors (Claude Docs, Gmail, Google Calendar, Google Drive, Mermaid Chart, tldraw) and their
  `cloudflare` server. MCP tools run outside the sandbox. `--strict-mcp-config` removed all of them.
- **WebFetch is not a main tool in 2.1.323**: it sits in the built-in `web-fetch` agent.
  `permissions.deny` on `WebFetch` and `WebSearch` removed WebSearch and that agent.
- **Installs need a writable cache.** In the sandbox, npm, pnpm, bun, cargo and go failed with
  "read-only file system" on their caches in the home folder. All 8 installs passed once `env`
  pointed the caches at one folder for the workspace, the sandbox's only writable folder outside
  the worktree.
- **The sandbox's placeholders break `git add -A`.** To deny writes to files that do not exist,
  the sandbox mounts `/dev/null` at 23 paths in the worktree (`.bashrc`, `.gitconfig`,
  `.mcp.json`, `.vscode`, `.claude/settings.json`…). Git lists them as untracked and refuses to
  add them. Listed in `.git/info/exclude`, they are ignored, and `git add -A` and the commit pass.
- **Normal mode's `default` runs in `auto` (outside HV10).** Symbiote passes no
  `--permission-mode` for `default` (`claude-code.ts:457`). Claude Code 2.1.323 started those
  sessions in `auto`, without asking for any of the probes. 2.1.323's modes are `acceptEdits`,
  `auto`, `bypassPermissions`, `manual`, `dontAsk` and `plan`: a writer that asks before each
  command now needs `manual`. A fix of its own.

**Results (HV10a)**. Runs A (normal mode, `default`) and B (Hive, `auto`, `hive.start`) ran with
the settings Symbiote gives today. Run C added the reviewer's sandbox (decision 677), with
`allowedDomains` set to `registry.npmjs.org` and `github.com`. Run D added the sandbox's
`credentials` deny and `permissions.deny` on the web tools. Each probe reads only. "Yes" means
reached.

| # | Probe | A normal | B Hive | C sandbox | D sandbox + deny |
|---|---|---|---|---|---|
| 1 | a variable set by the process that runs `claude --bg` | no | no | no | no |
| 2 | the daemon's variables (`INVOCATION_ID`, `AI_AGENT`) | yes | yes | yes | yes |
| 3 | `gh auth status`: the person's login | yes | yes | no: `api.github.com` refused | no |
| 4 | the same with an empty `GH_CONFIG_DIR` | no | no | no | no |
| 5 | `~/.config/gh/hosts.yml` and `~/.ssh/id_ed25519` readable | yes | yes | yes | no |
| 6 | `gh api user` | yes | yes | no | no |
| 7 | `git ls-remote origin` (SSH) | yes | yes | **yes**, through the proxy | no |
| 8 | `ssh -T git@github.com` | yes | yes | no: no DNS | no |
| 9 | `curl https://example.com` | yes | yes | no | no |
| 10 | `curl https://registry.npmjs.org/is-odd` | yes | yes | yes | yes |
| 11 | WebFetch (the `web-fetch` agent) | yes | yes | yes | no tool |
| 12 | WebSearch | yes | yes | yes | no tool |
| 13 | the person's MCP servers and claude.ai connectors | yes | yes | yes | yes; none with `--strict-mcp-config` |

Auto mode's classifier refused none of the probes in A, B or C. The same settings under
`claude -p`, the path the reviewer takes, inherit the spawning environment. There a fake
`GITHUB_TOKEN` reached the commands with C's settings and not with D's.

**The hosts a sandboxed writer needs**, by ecosystem. "Measured" means an install with an empty
cache behind a logging proxy, then the same install in the sandbox with only these hosts allowed.

| Ecosystem | Hosts | Cache it writes | How known |
|---|---|---|---|
| npm, pnpm, bun; corepack's pnpm | `registry.npmjs.org` | `~/.npm`, `~/.local/share/pnpm`, `~/.bun/install/cache` | measured |
| Yarn 1 | `registry.yarnpkg.com` | `~/.cache/yarn` | measured |
| pip | `pypi.org`, `files.pythonhosted.org` | `~/.cache/pip` | measured |
| Cargo | `index.crates.io`, `static.crates.io` | `~/.cargo/registry`, `~/.cargo/git` | measured |
| Go | `proxy.golang.org`, `sum.golang.org`, `storage.googleapis.com`; with `GOPROXY=direct`, each module's host (`github.com`) | `~/go/pkg`, `~/.cache/go-build` | measured. A module that needs a newer Go fetches the toolchain through the proxy (346 MB here) |
| This repository (`pnpm install`, empty store) | `registry.npmjs.org` (94 connections) | the pnpm store | measured |
| Yarn 2 and later | `registry.yarnpkg.com`; `repo.yarnpkg.com` for Yarn itself | `.yarn/cache` in the repository | documented |
| uv | `pypi.org`, `files.pythonhosted.org`; `github.com` when it installs a Python | `~/.cache/uv` | documented |
| Maven | `repo.maven.apache.org` | `~/.m2` | documented |
| Gradle | `services.gradle.org`, `downloads.gradle.org`, `plugins.gradle.org`, `repo.maven.apache.org`; Android `dl.google.com` | `~/.gradle` | documented |
| Bundler | `rubygems.org`, `index.rubygems.org` | `~/.gem`, `vendor/bundle` | documented |
| NuGet | `api.nuget.org` | `~/.nuget/packages` | documented |
| Composer | `repo.packagist.org`; archives from `api.github.com`, `codeload.github.com` | `~/.cache/composer` | documented |
| Deno | `jsr.io`, `deno.land`, `registry.npmjs.org` | `~/.cache/deno` | documented |
| Toolchains | `nodejs.org`, `static.rust-lang.org`, Playwright's `cdn.playwright.dev` | their own folders | documented |

A dependency taken from a git repository needs its host: `github.com`, and `codeload.github.com`
for npm's tarballs. A private registry needs its own host, named in `.npmrc`, `pip.conf`,
`.cargo/config.toml` or `GOPROXY`. The check still runs outside the sandbox, so `pnpm check` and
its installs keep the network.

**How a repository sets its own hosts (for HV10b).** Symbiote reads the lockfiles and manifests
at the worktree's root when it starts the writer:

| Files | Ecosystem |
|---|---|
| `package-lock.json`, `pnpm-lock.yaml`, `bun.lock` | npm |
| `yarn.lock` | Yarn |
| `requirements*.txt`, `pyproject.toml`, `uv.lock` | Python |
| `Cargo.lock` | Cargo |
| `go.sum` | Go |
| `pom.xml`, `build.gradle(.kts)` | Maven, Gradle |
| `Gemfile.lock` | Bundler |
| `*.csproj` | NuGet |
| `composer.lock` | Composer |
| `deno.json` | Deno |

It allows the hosts of each ecosystem found. A new key, `hive.sandbox.allowedDomains` in
`symbiote/config.json`, adds the repository's own hosts: private registries, git dependencies, a
toolchain's downloads. Settings → Hive shows the list in force. A writer stopped by the sandbox
says which host it needed: Claude Code reports `deny network-outbound <host>` in the command's
output. Hive then stops the workspace and says so, rather than allowing the host itself.

**Decision 1015's details** (new decisions 1050–1054; 1045–1049 are left for HV9b, which runs
beside this spike):

| # | Question | Decision | Why |
|---|---|---|---|
| 1050 | Where does the writer's environment come from? | **Claude Code's daemon, not the process that runs `claude --bg`. Symbiote sets the writer's variables in `--settings`' `env`, and hides secrets with the sandbox's `credentials.envVars`; it does not rely on the environment it spawns `claude` with.** Amends 1015's "no forge variable" | The marker reached 0 of 7 writers; `env` in `--settings` and the `credentials` deny both reached the writer |
| 1051 | Which credentials does the writer's sandbox hide? | **`credentials.envVars` deny for `FORGE_TOKENS` and every name `secretName` matches in Symbiote's environment; `credentials.files` deny for `~/.config/gh`, `~/.config/glab-cli`, `~/.ssh`, `~/.git-credentials` and `~/.netrc`; `GH_CONFIG_DIR` set to an empty folder in `env`** | With the sandbox alone, the person's SSH key reached `origin` and `hosts.yml` was readable; with the deny, neither (run D). `~/.netrc` and `glab-cli` were not measured |
| 1052 | Which hosts may the writer reach? | **The hosts of each ecosystem the repository's lockfiles and manifests name (the table above), plus `hive.sandbox.allowedDomains`; no forge API host and no `github.com` unless the repository lists them** | 1 to 3 hosts per ecosystem, measured for 7; what a repository needs beyond its registries only it knows |
| 1053 | Where may the writer's installs write? | **One cache folder for the workspace in Symbiote's cache, the sandbox's only `allowWrite` outside the worktree; `env` points the caches of npm, pnpm, Yarn, bun, pip, Cargo and Go there, and `TMPDIR`. Removed with the workspace (Go's module cache is read-only: `chmod -R u+w` first)** | Without it, 5 of 8 installs failed. Allowing the person's own caches would let a writer plant a package that their next install uses |
| 1054 | What else is cut from an issue's writer? | **`--strict-mcp-config` with no MCP config; `permissions.deny` on `WebFetch` and `WebSearch`; `allowUnsandboxedCommands: false`; the sandbox's placeholder paths in the repository's `.git/info/exclude`** | The person's connectors and MCP servers reached every writer, outside the sandbox. The deny removed both web tools. `git add -A` failed on the placeholders until they were excluded |

For HV10b to measure: the writer still has Claude Code's own tools that reach claude.ai
(`RemoteTrigger`, `SendToProject`, `ArtifactComments`, `PushNotification`). A `--tools` list,
as page agents have (`startPageAgent`), would remove them. Decision 1051 leaves `CLAUDE_CODE_*`
variables untouched, such as `CLAUDE_CODE_MESSAGING_TOKEN`, which Claude Code sets for its own
use. It names only the secrets that Symbiote can see in its own environment: a secret that only
the daemon has, with a name not in `FORGE_TOKENS`, is still not hidden. Verification 5 reruns this spike's probes on the built `symbiote view`.

## HV10b and HV10c: the plan's open points, decided (2026-11-14)

Planned on `feature/hv10-workspace-from-issue` with the person's OK. Decisions 1061–1066 (1060 the
highest on `main` and every branch that day):

| # | Question | Decision | Why |
|---|---|---|---|
| 1061 | Who starts a held take? (details 1011, 1034) | **Only the person, with Start in Hive on the Issues page; `start_from_issue` refuses it, from Nucleus or `symbiote mcp`, with the hold's reasons. Only `startFromIssue` sets a request's `issue`: `POST /api/workspaces` drops one sent** | 1034: a hold waits for the person's click; a start that claims an issue gets its keyword and its landing |
| 1062 | What if the issue's branch exists? (details 1013) | **A branch left by an earlier workspace of the issue, cleaned up, gives `-2`, `-3`… after the slug: the branch still starts `<kind>/<number>-`** | 1014 allows a new workspace once the old one is cleaned up; its unmerged branch stays (V18c) |
| 1063 | Where are an issue writer's settings and install cache? (details 1050, 1053, 1054) | **In Symbiote's cache, a folder per workspace: `settings.json` beside `cache/`, the sandbox's only `allowWrite` outside the worktree. Edit and Write denied on Symbiote's cache; Claude Code's claude.ai tools (`RemoteTrigger`, `SendToProject`, `ArtifactComments`, `PushNotification`) denied; `--settings` and `--strict-mcp-config` given again at each resume** | The `symbiote/` folder is the writer's `--add-dir`: a settings file there could be rewritten for its next wake; HV10a left the claude.ai tools to measure |
| 1064 | What does Hive do when the sandbox refuses a host? | **A writer's turn whose commands printed `deny network-outbound <host>` stops the workspace (`stuck`), the note naming each host and Settings → Hive's `hive.sandbox.allowedDomains`. Hive never allows a host itself** | HV10a: the person knows which hosts the repository needs beyond its registries; a writer that works around a refusal is no better |
| 1065 | Which merges carry `Closes #n`? (details 1017) | **Every merge commit the queue makes for a workspace with an issue, Hive's or the person's Approve, in its body; a fast-forward makes no merge commit and closes nothing (HV11 closes it)** | One rule for the queue; the subject stays `Merge <branch>: <title>` (the merger's page) |
| 1066 | When is a take judged? (details 1040, 1059) | **`judged` in the issue's `<number>.jsonl`, with the identity that took it: right when Hive moves its workspace to `landed`; wrong when its request was closed without a merge, or the person stopped its agent; nothing for a stop by Hive's limits. Once per workspace** | 1059: "written from HV10 on"; Hive already knows these three ends |
