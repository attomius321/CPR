# Journal: HV10 — A Hive workspace from an issue the classifier took

[Index](../JOURNAL.md) · [Plan](../plan/hv10-workspace-from-issue.md)

## HV10a — the writer's reach, measured (2026-11-13, branch `spike/hv10a-writer-reach`)

Asked: what a Hive writer started with `claude --bg`, as Symbiote starts one, reaches today. That
means its environment, the person's `gh` login, `git` to `origin`, `ssh` to the forge, and the
web. Also: with Claude Code's sandbox as the running reviewer has it (decision 677), which hosts
do a writer's own installs need, for any ecosystem and not only this repository's pnpm? The
answer gives decision 1015's details before HV10b builds the writer's confinement.

**The answer in short.** Today a writer, in normal mode or Hive's, reaches everything the
person's shell reaches: the `gh` login, `origin` over SSH with the person's key, any web page,
WebFetch and WebSearch, and the person's MCP servers and claude.ai connectors. Auto mode's
classifier refused none of the 12 probes. Three findings change the plan's design:

- The writer's environment is the environment of Claude Code's daemon, not Symbiote's. Starting
  `claude --bg` without the forge variables would not remove them from the writer.
- The sandbox alone does not hide the person's credentials. With `github.com` allowed, the
  writer reached `origin` with the person's SSH key.
- Installs in the sandbox need a writable cache.

What works, measured on the same start path: `env` in `--settings`, and the sandbox's
`credentials` deny on variables and files. Add a cache folder for each workspace, the hosts of
each ecosystem, `--strict-mcp-config` and a deny on the two web tools. Decisions 1050–1054 in the
plan.

**What ran.** A scratch repository, `/tmp/hv10a-reach/loc`, with one commit and `origin` set to
this repository on GitHub. Each run had a worktree of its own, as Symbiote makes them. The person
trusted the folder in Claude Code. A script imported the built `claudeCode()` and
`agentSettings()` from `packages/cli/dist` and called `start()` with the hooks' settings file,
`--add-dir` on the repository's `symbiote/` and the run's permission mode. It runs `claude
--bg` through `runProgram`, as Symbiote does. The script ran with the environment of the person's
running `symbiote view`, copied from `/proc/<pid>/environ`. Two variables were added: a marker
and a fake `GITHUB_TOKEN`. The writer's brief listed 12 read-only probes, and it wrote what each
reached into a file. Hive's runs had `hive.start`'s text after the brief.

- **A**: normal mode, `default`, today's settings.
- **B**: Hive, `auto`, today's settings.
- **C**: B plus the reviewer's sandbox block (`enabled`, `failIfUnavailable`,
  `autoAllowBashIfSandboxed`, `allowUnsandboxedCommands: false`). Its `allowedDomains` were
  `registry.npmjs.org` and `github.com`.
- **D**: C plus `sandbox.credentials`. Its `envVars` deny covered the six `FORGE_TOKENS`, and its
  `files` deny covered `~/.config/gh`, `~/.ssh`, `~/.git-credentials` and `~/.config/glab-cli`.
  D also had `permissions.deny` on `WebFetch` and `WebSearch`.
- **F**: C plus an `env` key in `--settings`: a second marker, an empty `GH_CONFIG_DIR`, and the
  caches pointed into one folder.
- **G**: D's settings with `--strict-mcp-config`, to see which tools remained.

A and B ran twice: once from inside this spike's own Claude Code session, and once from the
view's environment. The results matched. The sandboxed installs ran under `claude -p` (Haiku,
`--setting-sources ""`, `dontAsk`, `--tools Bash`) in a seventh worktree. One script ran each
install in a folder of its own and printed its exit code. The hosts came from a small logging
CONNECT proxy (`HTTPS_PROXY`), with an empty cache for each install. The probe table and the
hosts table are in the plan's As built section.

**What was learned.**

- **`claude --bg` hands the session to the daemon's spare process.** `claude daemon status`
  says the daemon is transient, started on demand by the first `claude` that needed it (here an
  interactive session in another worktree). It keeps `bg-spare` processes ready, and `--bg`
  claims one. The writer's commands saw the daemon's variables (`INVOCATION_ID`, `AI_AGENT`,
  `COREPACK_ENABLE_AUTO_PIN`), which the view does not have. Neither of the spawning process's two
  added variables reached them: 0 of 7 writers. Claude Code 2.1.323 has code that applies a
  claiming client's variables to the spare, with a warning for each variable it drops. None was
  applied here, and no warning was shown. So the writer's environment depends on whoever started
  the daemon. If that was a shell with `GITHUB_TOKEN` exported, every writer has the token.
- **`--settings` reaches a background writer.** Its sandbox block applied in C and D, and its
  `env` key in F: the marker was set and `GH_CONFIG_DIR` pointed to the empty folder. A variable
  set to `""` in `env` only empties it, which is enough for `gh` and `glab`. The sandbox's
  `credentials.envVars` deny removed a variable entirely. Under `claude -p`, a fake
  `GITHUB_TOKEN` read `set` with C's settings and empty with D's.
- **The sandbox lets the writer read the whole home folder.** In C, `hosts.yml` and the SSH key
  were readable. `git ls-remote origin` reached GitHub because the sandbox sets `GIT_SSH_COMMAND`
  to tunnel SSH through its proxy for allowed hosts. A plain `ssh -T` failed for lack of DNS.
  `gh` failed only because `api.github.com` was not allowed. In D, the files were unreadable, `gh`
  had no login, and SSH failed host key verification (`~/.ssh/known_hosts` was hidden too).
- **The person's MCP servers reach the writer, outside the sandbox.** In every run of A–F, the
  writer had the claude.ai connectors (Claude Docs, and the Gmail, Calendar, Drive, Mermaid Chart
  and tldraw sign-ins) and the `cloudflare` server, whose tools include `execute`. The user
  settings' `kubernetes` server did not appear. G with `--strict-mcp-config` had none of them.
  Claude Code's own tools that reach claude.ai stay (`RemoteTrigger`, `SendToProject`,
  `ArtifactComments`, `PushNotification`). Page agents already start with a `--tools` list; HV10b
  should measure one for the writer.
- **WebFetch moved.** In 2.1.323 a session has no WebFetch tool. It has a built-in `web-fetch`
  agent that does, and the writers used it. `permissions.deny` on `WebFetch` and `WebSearch`
  removed WebSearch and the `web-fetch` agent (D and G).
- **Hosts per ecosystem are few.** npm, pnpm and bun need `registry.npmjs.org`, and Yarn 1
  needs `registry.yarnpkg.com`. pip needs `pypi.org` and `files.pythonhosted.org`, and Cargo
  needs `index.crates.io` and `static.crates.io`. Go needs `proxy.golang.org`, `sum.golang.org`
  and `storage.googleapis.com`, or the module's own host with `GOPROXY=direct`. This
  repository's `pnpm install` with an empty store made 94 connections, all to
  `registry.npmjs.org`. Maven, Gradle, Bundler, NuGet, Composer, uv and Deno are not installed
  here; their hosts in the plan come from their documentation.
- **Installs need somewhere to write.** With the hosts allowed and no writable cache, npm
  (`EROFS`), pnpm (`EROFS` on its store), bun ("unable to write files to tempdir"), Cargo and Go
  failed. pip and Yarn 1 passed without their cache. Allowing the person's caches (`~/.npm`,
  `~/.local/share/pnpm`, `~/.bun/install/cache`, `~/.cargo/registry`, `~/.cargo/git`,
  `~/go/pkg`) made all 8 pass. Go also needs `~/go/pkg/sumdb`, not only `pkg/mod`. One folder
  for the workspace made all 8 pass too, with these set in `env`: `npm_config_cache`,
  `npm_config_store_dir`, `YARN_CACHE_FOLDER`, `BUN_INSTALL_CACHE_DIR`, `PIP_CACHE_DIR`,
  `CARGO_HOME`, `GOPATH`, `GOMODCACHE`, `GOCACHE` and `TMPDIR`. That folder is the only
  `allowWrite`. Decision 1053 takes it: a writer that can write the person's npm cache or pnpm
  store can plant a package in their next install. The Go module needed Go 1.26, and this machine
  has 1.22.5, so Go fetched a 346 MB toolchain through `proxy.golang.org`. Go makes its module
  cache read-only, so `rm -rf` of the folder failed with "Permission denied" until
  `chmod -R u+w`. Removing a workspace's cache folder (decision 1053) needs that step, or
  `go clean -modcache` with the folder's `GOMODCACHE`.
- **Commits work in a linked worktree.** In the sandbox, `git commit` in a worktree, whose git
  folder is in the main checkout's `.git`, passed.
- **`git add -A` does not.** The sandbox mounts `/dev/null` placeholders for 23 denied paths
  that do not exist in the worktree: 11 dotfiles at the root and 12 under `.claude/`. Git lists
  them as untracked and fails: ".bash_profile: can only add regular files". Listed in the
  repository's `.git/info/exclude`, they are ignored, and `git add -A` and the commit passed.
  Outside the sandbox the placeholders are gone. A worktree's `info/exclude` is the main
  checkout's, so Symbiote writes it once per repository. The sandbox already uses
  `GIT_CONFIG_COUNT` for its own keys, so a `core.excludesFile` set through `env` could clash.
- **Normal mode's `default` is `auto`.** Symbiote passes no `--permission-mode` for `default`.
  Claude Code 2.1.323 started A in `auto` (the transcript's `permissionMode` is `auto` on every
  line) and asked for nothing. Its modes are now `acceptEdits`, `auto`, `bypassPermissions`,
  `manual`, `dontAsk` and `plan`. Outside HV10: a fix of its own should pass `manual` when the
  person picks "ask".
- **Traps of the setup.** `--tools` takes several values, so a prompt after it is read as a
  tool: give `claude -p` its prompt on stdin. Haiku carried `cd` from one command to the next and
  cut lines off. A script run as one command gave exact results. In D, Haiku first refused to run
  the probes, which looked to it like credential hunting. It ran them once the prompt said who
  asked and that only names and yes or no are printed. A `--bg` session started from inside
  another Claude Code session is told to call EnterWorktree before it edits. It then fetched
  `origin` for a fresh worktree under `.claude/worktrees/`. Symbiote's writers run in a linked
  worktree, which that rule accepts.

**Verified.** Every probe ran on the real start path: the built `claudeCode().start()`, the
view's environment and a real `claude --bg`. Every install ran inside the real sandbox. Not
verified: Maven, Gradle, Bundler, NuGet, Composer, uv and Deno; `~/.netrc` and `glab-cli` in the
files deny; a daemon started by `symbiote view` itself (stopping the daemon ends every background
session, this one included); and a `--tools` list for the writer. No secret's value was printed
or written. The probes printed variable names, yes or no, `gh`'s account name and the first 12
characters of `origin`'s HEAD. The fake token's value was `hv10a-fake-not-a-secret`. Nothing was
pushed or posted, and nothing was written to a forge. The scratch folder and its sessions were
removed after the runs. `pnpm check` passes.

## HV10b, HV10c — the start from an issue, the writer's reach, landing with Closes #n (2026-11-14, branch `feature/hv10-workspace-from-issue`)

Built as the plan says, with decisions 1061–1066 decided before the code and 1067–1070 from the
real run. `startFromIssue` behind Start in Hive and `start_from_issue`; the issue in the request,
the record, the summary and the branch `<kind>/<number>-<slug>`; `#n` on the workspace's card and
head; the row's branch and Hive's step. An issue's writer gets its own settings in Symbiote's
cache: the variables in `env`, the sandbox on and required with a strict allowlist, the forge's
credentials hidden, one install cache, no web, claude.ai or other-session tools, no MCP server,
`hive.issue` after `hive.start`. A host the sandbox refuses stops the workspace. Work from an issue
lands by `hive.issues.lands` (a request by default), with `Closes #n` in the request and in the
queue's merge commit. A take is judged right when it lands and wrong when its request is closed.

**Learned**:

- **The classifier's parts are every kind's.** HV9's schema asks for all eleven parts and the
  model leaves the other kinds' empty; `start()` refuses a part its kind lacks, empty or not. The
  first test of the start, on HV9a's real answer, caught it: the request keeps only the kind's
  parts with text.
- **`TMPDIR` is the sandbox's, not the cache's.** With `TMPDIR` in the writer's `env` (decision
  1053), every command failed: "Failed to create bridge sockets after 5 attempts". The sandbox
  makes its Unix sockets there, and a cache path of 83 characters left no room for their names.
  Two short sessions, one each way, showed it. The installs' caches stay in the folder; `TMPDIR`
  does not (1070).
- **A flag at resume starts a copy.** Claude Code 2.1.325 says so itself: "background session
  e43b1a53 keeps its own saved options, so the flags you passed started a copy as d259a122.
  Without flags, the same command continues e43b1a53 itself." Giving `--settings` and
  `--strict-mcp-config` again at each resume (1063) made a copy of the writer at every Hive
  message, and Hive took the first for an unseen turn. Without them the person's reply continued
  `f9f663ec`, its settings kept (1069).
- **A command can widen the sandbox's network unless the allowlist is strict.** 2.1.325's Bash
  takes `allowed_domains`, "reviewed by the auto-mode classifier", and Hive's writers run in auto
  mode. Its refusal text pointed there ("re-run the command with this host listed"), and Claude
  Code's own schema named the setting: `sandbox.network.strictAllowlist`, "deterministically
  denies hosts not in allowedDomains", settable from `--settings` (1067).
- **The writer's tools change with Claude Code.** HV10a listed four claude.ai tools; the writer
  of 2.1.325 listed `Artifact`, `ArtifactData`, `DesignSync`, `SendToProjectContext`, and
  `ListAgents` and `SendMessage`, which reach the person's other sessions, Nucleus among them.
  All are denied (1068). A deny list needs reading again on each version: the probe that lists
  every tool, deferred ones too, is the way.
- **An Edit deny is a write deny in the sandbox.** A deny on `Edit(//<cache>/writers/**)`, meant
  to keep the writer off its settings file, made its install cache read-only: npm "Log files were
  not written due to an error writing to the directory". Only its own settings file is denied now.
- **The sandbox's placeholders are the same 23 on 2.1.325**, and `git add -A` still fails on
  them; the exclude stays. A scratch repository under `~/.claude/` gets no writable git folder at
  all: the sandbox protects that folder. Real runs go under `/tmp` (the repository) and the home
  folder's `.cache` (Symbiote's cache): `/tmp` inside the sandbox is its own, so a cache there is
  not found (npm's `ENOENT`).
- **A host the writer refers to in its own words** (`(sandbox: deny network-outbound
  github.com:22)`) made the parser take the bracket; it reads a host's characters only now.

**Verification**: tests first, red for the right reason: `startFromIssue` (10, each guard removed
fails its own), the merge commit's body (3), `start_from_issue` (4), the writer's settings,
hosts, cache and exclude (13), an issue's workspace under Hive (7, five red), the start's and
resume's arguments, `hive.issues.lands`, the request's description, `judgeTake`, Start in Hive's
route, the card's offer and the row's step (3). e2e `issues-start.spec.ts` (2) on the fake forge
and the fake agent: Classify, Start in Hive, the card's and row's branch and step, `#1` on the
sidenav and the head, the writer's arguments and settings, Settings' two rows. Screenshots of
each new part in both themes at 1440×900. The real run: five runs of the built view, Claude Code
2.1.325, a scratch repository with `origin` on the fake forge; the fifth reached none of the
forge's variables or files, no SSH, no web page, no web, claude.ai or other-session tool, and
`registry.npmjs.org` only; its install passed; a command's own `allowed_domains` was refused;
Hive stopped it naming both refused hosts; the reply continued the same session. The probes
printed names, yes or no, exit codes and the first 12 characters of a line, never a value; the
fake token was `hv10b-fake-not-a-secret`. Nothing was pushed or posted; the scratch folders, the
caches and the sessions were removed.

Not verified: a real landing (the scratch check was `false`), `Closes #n` on a real forge, the
`judged` lines outside the tests, a judged "stopped by the person" (not built: Hive does not
record who stopped an agent), and Maven, Gradle, Bundler, NuGet, Composer, uv and Deno's hosts
(HV10a's documentation, not measured).
