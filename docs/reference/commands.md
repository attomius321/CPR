# Commands and keys

This page lists the `symbiote` command's commands and options, and the keys of the app it opens.
To install Symbiote and start a first workspace, see the [README](../../README.md). It also
explains the terms this page uses: workspace, merger, verdict, Nucleus and the others.

## Commands

| Command | What it does |
|---|---|
| `symbiote view [<base> [head]]` | Opens the app. Without revisions, it opens on Git, with your workspaces in the sidenav. With revisions, it opens on that comparison. It runs until you press Ctrl+C or close its window. It serves the pages it started with: after Symbiote is built again (`pnpm build`, `./install.sh`), start it again to get the new ones. |
| `symbiote diff <base> [head]` | Compares `head` (default `HEAD`) with `base` and prints the changed symbols and the findings. |
| `symbiote pr [<number>]` | Opens a GitHub pull request or a GitLab merge request for review. `symbiote mr` is the same command. |
| `symbiote merge <branch>` | Merges the commit that your review of `branch` approved, as **Merge into** does in the app, and prints each step. |
| `symbiote mcp` | Gives an agent of yours Symbiote's tools. See [Symbiote's tools for your own agent](#symbiotes-tools-for-your-own-agent). |
| `symbiote app install` | Adds Symbiote's window to your desktop's apps, on Linux and WSL. `symbiote app uninstall` removes it. |
| `symbiote-nexus` | Opens Symbiote nexus: every `symbiote view` running on this machine, as tabs in one window, and **Folders**, to start one in any repository. It runs until you press Ctrl+C or close its window. Closing it stops no Symbiote, not even the ones it started. `./install.sh` adds it to `~/.local/bin`. |

`symbiote diff` and `symbiote view` compare `head` with the *merge base*: the last commit that
`head` and `base` share. A pull request is compared the same way. To compare with `base` itself,
add `--no-merge-base`.

In a GitHub Actions or GitLab CI job for a pull or merge request, `symbiote pr` takes the number
from the job.

To see a command's options, run `symbiote <command> --help`.

## Sample output

This is `symbiote diff main` on a branch that adds one function, removes one and changes one:

```
main (4254d3d) → HEAD (af06839), merge-base 4254d3d
1 file changed · 3 symbols changed: 1 added, 1 removed, 1 modified

Findings
  ✖ removed-still-referenced  src/math.ts#legacy
      legacy was removed but is still used by 1 symbol: old
  ⚠ orphan-added              src/math.ts#triple
      triple is new and nothing references it
  ℹ signature-changed         src/math.ts#add
      add changed its signature compatibly; existing users keep working (2 users, 1 untouched)

M  src/math.ts
     ~ function    add  (signature, body)  · used by 2
     - function    legacy  · used by 1
     + function    triple
```

The [review guide](../guide/review-and-ci.md#findings) explains each finding.

## Options

| Option | Commands | What it does |
|---|---|---|
| `--json` | diff, pr | Prints the graph JSON instead of the summary. The [graph schema](../graph-schema.md) describes it. |
| `--out <file>` | diff, pr | Also writes the graph JSON to a file. |
| `--codequality <file>` | diff, pr | Also writes the findings as a GitLab Code Quality report. |
| `--fail-on <level>` | diff, pr | Exits with 1 if a finding is at or above the level you give: `error`, `warning` or `info`. |
| `--since <rev>` | diff, view, pr | Marks each changed symbol as new, updated or the same as in an earlier head of the change, for example before a push or a rebase. |
| `--project <path>` | diff, view, pr | The tsconfig to load, relative to the repository root. Default: `tsconfig.json`. |
| `--depth <n>` | diff, view, pr | How many steps of unchanged callers and callees to include. Default: 1. |
| `--plugin <name\|path>` | diff, view, pr | Analyzes with a framework plugin, such as `angular` or `qwik`. You can repeat it. |
| `--no-merge-base` | diff, view | Compares with `base` itself. |
| `--port <n>` | view, pr, symbiote-nexus | The app's port. Default: any free port. |
| `--browser` | view, pr, symbiote-nexus | Opens your browser instead of Symbiote's window. |
| `--no-open` | view, pr, symbiote-nexus | Opens neither. Open the address it prints yourself. |
| `--summary` | pr | Prints the summary instead of opening the app. |
| `--post-findings <level>` | pr | Posts new findings at or above the level as comments on their lines, instead of opening the app. A finding posted by an earlier run is not posted again. |
| `--forge <name>` | pr | `github` or `gitlab`, for a host whose name does not say which it is. |
| `--remote <name>` | pr | The remote to read and fetch from. Default: `origin`. |
| `--into <branch>` | merge | The branch to merge into. Default: the branch the workspace is reviewed against, else the branch it started from, else the target named in your approval, else the default branch. |
| `--strategy <how>` | merge | `merge` (a merge commit) or `fast-forward` (the target moves to the approved commit, with no new commit; refused when the target has commits the branch lacks). Default: `merge.strategy`, else `merge`. On a fast-forward that waits because its target moved, `--strategy merge` merges it with a merge commit instead. |
| `--land` | merge | Lands a merge that waits for you: one with no check, or one that git refused to land. |
| `--approve` | merge | Approves the merger's resolution of a conflict, which lands it. |
| `--again <words>` | merge | Asks the merger again, with what to change or your answer to its question. |

Every command exits with 0 when it succeeds, 1 when it fails or a `--fail-on` level is reached,
and 2 when its arguments are wrong.

## Keys

Keys work when the focus is not in a text box. Git also lists its keys under the **?** in its
toolbar.

| Key | On Git | A change's Files page | A change's Graph page |
|---|---|---|---|
| j, k | Next or previous commit (above the first: your uncommitted changes); with a file shown, its next or previous file | Next or previous file | Next or previous changed symbol |
| / | Find a branch | | Search the change list |
| c | Check out the commit or one of its branches (asks first) | Comment on the file's first change | Comment on the selected symbol |
| r | Review the branch | | Mark the selected symbol reviewed |
| x | Compare mode: pick two commits | | |
| f | Find a commit: Enter and Shift+Enter step through what it finds | | Show only the selected symbol and its neighbours |
| d | Show or fold the commit's details | | |
| p, P | | | Next or previous project, in a monorepo |
| o | Open the file shown as a diff in VS Code | Open the file in VS Code at its first change | Open the selected symbol in VS Code |
| g | | The Graph page | The Files page |
| Esc | Back to the commits from a file shown; leave compare mode | Close the comment box | Close the detail panel |

These keys work on Git, Nucleus, Skills, Monitor, History, Settings and a workspace's page. In a
change, only n and [ work.

| Key | What it does |
|---|---|
| n | Open **Start a workspace** |
| g, s | Git, Settings |
| a | Nucleus |
| i | Skills |
| m | Monitor |
| h | History: the cleaned-up workspaces. ↑ and ↓ move between them in its list. |
| w | Move to the workspaces in the sidenav. ↑ and ↓ move between them, and Enter opens one. |
| [ | Fold the sidenav to a row of icons, or open it again |
| ] | In a workspace: hide or show the **Changes** panel |

In Symbiote nexus, with the focus on its tabs, ← and → move to the previous or next tab, and Home
and End to the first or the last. In **Folders**, the arrows move between the repositories and
the folders by their place on the page. Enter opens a folder, or a Symbiote in a repository, and
Backspace goes up a folder. In a Symbiote's tab, that Symbiote's keys work.

In a text box where you write a comment, a brief, a reply, a prompt or a commit's message,
Ctrl+Enter saves, starts, sends or commits. On macOS, use Cmd instead of Ctrl.

## Symbiote's tools for your own agent

`symbiote view` offers what its pages do as tools over MCP, the Model Context Protocol: list the
workspaces, start one, review a branch, merge it. Nucleus uses these tools, and you can give them to
your own agent. The agent reaches them through `symbiote mcp`, which finds the `symbiote view`
running for the repository the agent works in. If none is running, each tool says so.

To add the tools to Claude Code:

```sh
claude mcp add symbiote -- symbiote mcp
```

To add them to Codex, put this in `~/.codex/config.toml`:

```toml
[mcp_servers.symbiote]
command = "symbiote"
args = ["mcp"]
```

An agent does not read your shell's aliases. `./install.sh` adds `symbiote` as a command, which an
agent finds on your `PATH`. If `symbiote` is only an alias, write the full command instead:
`node <Symbiote's folder>/packages/cli/dist/bin.js mcp`.

| Tools | What they do | Asks you |
|---|---|---|
| `overview` | What needs you: workspaces that wait or are ready, merges that wait | |
| `workspaces`, `workspace`, `thread` | The workspaces; one workspace with its brief, its worktree's folder, commits and files; its agent's thread | |
| `start_options`, `start_workspace` | What a start takes here; a start. Its **Confirm** names the model and the effort it starts with | Yes, to start |
| `suggest_settings` | Suggested settings for a brief, as **Suggest settings** on the Start page: a model, an effort level, plan first and why. It runs one turn of the agent's small model and starts nothing | |
| `reply`, `stop_agent`, `restart_agent` | Send a message to a workspace's agent; stop it; start it again | Yes, to start again |
| `clean_workspace` | Clean a workspace up | Yes |
| `review`, `finish_review` | A branch's change as Symbiote's graph; a verdict on it | Yes, for a verdict |
| `merges`, `merge_log` | The merge queue; a merge's log | |
| `queue_merge`, `land_merge`, `merge_resolution`, `retry_merge`, `recheck_merge`, `remove_merge` | The merge page's actions; `queue_merge` takes a `strategy`, `merge` or `fast-forward`, as `--strategy` | Yes |
| `usage`, `code_map` | Your subscriptions' usage; where the code is, by folder | |
| `wait` | Waits until a workspace's agent or a merge changes state, 10 minutes at most | |

When a tool asks, a bar on every page of the app says which agent asks and what it will do, with
**Decline** and **Confirm**. Nothing happens before you click **Confirm**. If you click
**Decline**, or do not answer within 10 minutes, the agent is told that nothing was done.
