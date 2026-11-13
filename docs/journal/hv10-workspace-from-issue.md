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
