# Configuration

This page lists every setting Symbiote reads: the project's settings file, the text Symbiote
gives its agents, the files it skips, and its environment variables. All of them are optional.
To install Symbiote, see the [README](../../README.md).

## The settings file, `symbiote/config.json`

A project's settings are in `symbiote/config.json`, at the root of the repository. Commit it to
share the settings with everyone who runs Symbiote there. **Settings** in the app writes some of
these keys for you and leaves the rest of the file as it is.

```jsonc
{
  "plugins": ["angular"],
  "workspaces": { "branchPrefixes": { "fix": "bugfix/" }, "worktrees": "../{repo}.worktrees" },
  "agent": { "kind": "claude", "permissionMode": "default", "model": "opus" },
  "merge": { "checks": ["pnpm install --frozen-lockfile", "pnpm check"], "push": false }
}
```

| Key | Default | What it does |
|---|---|---|
| `plugins` | none | Framework plugins every analysis uses, by name or path. |
| `workspaces.branchPrefixes` | `feature/`, `fix/`, `refactor/`, `chore/`, `spike/` | The start of a new workspace's branch name, for each kind of work. Give only the kinds you change. |
| `workspaces.worktrees` | `../{repo}.worktrees` | Where workspaces' worktrees go, relative to the checkout. `{repo}` is the checkout's folder name. |
| `agent.kind` | `claude` | The agent offered first, if it is installed: `claude` or `codex`. |
| `agent.permissionMode` | `default` | The permission mode offered first for Claude Code: `default`, `acceptEdits` or `auto`. |
| `agent.model` | Claude Code's own | The model Claude Code starts on. Codex uses its own configuration's model. |
| `scout.model`, `scribe.model` | `agent.model`, else the agent's own | The model each Scout or Scribe conversation starts on, if the agent offers it. |
| `scout.effort`, `scribe.effort` | the agent's own | The effort level each Scout or Scribe conversation starts at, if the agent offers it. |
| `merge.checks` | a command Symbiote finds | The check a merge runs before it lands: one command, or a list run in order. Put an install first if the check needs dependencies. |
| `merge.push` | `false` | If `true`, Symbiote pushes the target branch after a merge lands. |
| `merge.agent` | `agent.kind`, else Claude Code, else Codex | The agent that resolves conflicts: `claude` or `codex`. |
| `merge.model` | `sonnet` for Claude Code, else the agent's own | The model the merger runs on. |
| `merge.effort` | the agent's own | The effort level the merger runs at, if its model takes one. |
| `prompts` | Symbiote's text | The text Symbiote gives its agents. See [Prompts](#prompts). |

To pick a model or an effort level from the agent's own list, use **Settings** rather than
editing the file.

If there is no `merge.checks`, Symbiote looks for a check in the target branch's files. It tries
these in order:

- a `check` or `test` script in `package.json`, run after the package manager's install;
- a `check` or `test` target in a Makefile;
- `scripts/test.sh`, `cargo test`, `go test ./...` or `pytest`.

The **Start a workspace** page names the check it found.

## Rules for the merger, `symbiote/merge.md`

If `symbiote/merge.md` exists, Symbiote adds it to the merger's prompt for every conflict. Write
your project's rules for resolving conflicts there, such as "keep both entries of a changelog".
Commit it to share it.

## Prompts

**Settings** (`s`) shows every text Symbiote gives its agents, grouped by agent. You can change
each one, insert its placeholders with a click, and reset it to Symbiote's text. Symbiote saves
your changes under `prompts` in `symbiote/config.json`, and keeps only the prompts you changed. A
change applies to the next agent that starts.

A prompt is a string, or a list of lines. Symbiote fills in each `{name}` that the prompt allows,
and leaves any other brace as text:

```json
{
  "prompts": {
    "start": {
      "spike": [
        "You are starting a new spike on the branch {branch}, started from {start}.",
        "",
        "{brief}",
        "",
        "Commit what you try under spikes/, and push the branch."
      ]
    }
  }
}
```

| Key | What it is | Placeholders |
|---|---|---|
| `start.feature`, `start.fix`, `start.refactor`, `start.chore`, `start.spike` | A workspace agent's first prompt, for that kind of work | `{brief}` (required), `{branch}`, `{worktree}`, `{start}`, `{plan}`, `{documents}`, `{into}`, `{record}`, `{reviews}`, `{agents}`, `{symbiote}` |
| `plan.first`, `plan.direct` | What `{plan}` becomes, with **Plan first** on and off | none |
| `documents` | What `{documents}` becomes when you gave files with the brief | `{folder}` (required), `{files}` |
| `verdict.approve`, `verdict.push`, `verdict.address`, `verdict.where` | The lines of a verdict sent to a branch's agent | `{branch}`, `{at}`, `{into}`, `{reviewer}`, `{what}`, `{review}`, `{agents}` |
| `reviews` | The text of `symbiote/AGENTS.md`, which tells agents how to act on a review | none |
| `merger` | The merger's instructions | none |
| `scout` | Scout's instructions | none |
| `scribe` | Scribe's first prompt | `{request}` (required), `{skills}`, `{checkout}` |

Settings lists what each placeholder stands for. Symbiote ignores a prompt it cannot use, and
uses its own text instead. A prompt cannot be used if it is not text, if it lacks a required
placeholder, or if it is too long. The limits are 8,000 characters for a start prompt and for
Scout's and Scribe's prompts, 1,000 for a single line, and 20,000 for the others.

Whatever its prompt says, Scout cannot edit files, Scribe writes only in `.claude/skills/`, and
Symbiote still asks you before any action that changes a branch.

## Files Symbiote skips, `.symbioteignore`

Symbiote lists changed files in these folders but does not analyze them, so they show no symbols
and no findings: `examples/`, `playground/`, `fixtures/`, `__fixtures__/`, `__snapshots__/` and
`generated/`. It does the same for `*.generated.*` files. To change that, write a
`.symbioteignore` file at the repository root, in the same syntax as `.gitignore`:

```gitignore
# every `interfaces` folder, at any depth
interfaces/
# only the top-level `tools` folder
/tools/
# but keep this one
!apps/web/interfaces/public.ts
```

Symbiote reads the file from your working folder, so a change applies at once, even before you
commit it. The **Monitor** sets the same files aside.

## Environment variables

| Variable | What it does |
|---|---|
| `SYMBIOTE_CLAUDE` | The Claude Code program to start. Default: `claude` on your `PATH`. |
| `SYMBIOTE_CODEX` | The Codex program to start. Default: `codex` on your `PATH`. |
| `SYMBIOTE_CODE` | The editor command that **Open in VS Code** runs, such as `cursor`. Default: VS Code's `code`. |
| `SYMBIOTE_TERMINAL` | `off`: no agent terminals. A workspace shows its thread and a reply box instead. |
| `SYMBIOTE_USAGE` | `off`: Symbiote does not read your subscriptions' usage, and the status bar shows none. |
| `SYMBIOTE_INTRO` | `off`: no intro the first time Symbiote opens. |
| `SYMBIOTE_APP` | `off`: always open the browser, never Symbiote's window. |
| `SYMBIOTE_CACHE_DIR` | Where Symbiote keeps its cache. Default: `$XDG_CACHE_HOME/symbiote`, else `~/.cache/symbiote` (`~/Library/Caches/symbiote` on macOS). |
| `SYMBIOTE_LOG` | `off`: Symbiote writes no logs. |
| `SYMBIOTE_LOG_LEVEL` | The lowest level a log line must have to be written: `debug`, `info` (default), `warn` or `error`. |
| `SYMBIOTE_LOG_DIR` | Where the logs go. Default: `logs` in the cache folder. |
| `GITHUB_TOKEN`, `GH_TOKEN` | The GitHub token for `symbiote pr`. Without one, Symbiote asks `gh auth token`. |
| `GITLAB_TOKEN` | The GitLab token for `symbiote pr`. |
| `GITHUB_API_URL`, `GITLAB_API_URL` | The forge's API address, for a self-hosted GitHub or GitLab. |
| `SYMBIOTE_FORGE` | `github` or `gitlab`, as `--forge` does. |

The CI templates read a few more variables. The [review guide](../guide/review-and-ci.md#run-in-ci)
lists them.

## Logs

Every Symbiote process writes its log lines into one folder: `~/.cache/symbiote/logs/` on Linux.
There is one file a day, with one JSON object a line, and Symbiote keeps 14 days. A log line never
holds a prompt, a file's contents, what a terminal shows, or a token.

To read the logs in Grafana, run `pnpm logs:up` in Symbiote's folder and open
http://localhost:3300. It needs Docker, and `pnpm logs:down` stops it. Without Docker, read the
files with `jq` or `lnav`.

## Older names

Symbiote had another name until 2026-10-21. On first use, it moves what it kept under that name
into `symbiote/`. It still reads `symbiote.config.json` at the repository root, and a `features`
section in place of `workspaces`.
