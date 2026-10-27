# Commands and keys

This page lists the `symbiote` command's commands and options, and the keys of the app it opens.
To install Symbiote and start a first workspace, see the [README](../../README.md). It also
explains the terms this page uses: workspace, merger, verdict, Scout and the others.

## Commands

| Command | What it does |
|---|---|
| `symbiote view [<base> [head]]` | Opens the app. Without revisions, it opens on Git, with your workspaces in the sidenav. With revisions, it opens on that comparison. It runs until you press Ctrl+C or close its window. |
| `symbiote diff <base> [head]` | Compares `head` (default `HEAD`) with `base` and prints the changed symbols and the findings. |
| `symbiote pr [<number>]` | Opens a GitHub pull request or a GitLab merge request for review. `symbiote mr` is the same command. |
| `symbiote merge <branch>` | Merges the commit that your review of `branch` approved, as **Merge into** does in the app, and prints each step. |
| `symbiote mcp` | Gives an agent of yours Symbiote's tools. See [Symbiote's tools for your own agent](#symbiotes-tools-for-your-own-agent). |
| `symbiote app install` | Adds Symbiote's window to your desktop's apps, on Linux and WSL. `symbiote app uninstall` removes it. |

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
| `--port <n>` | view, pr | The app's port. Default: any free port. |
| `--browser` | view, pr | Opens your browser instead of Symbiote's window. |
| `--no-open` | view, pr | Opens neither. Open the address it prints yourself. |
| `--summary` | pr | Prints the summary instead of opening the app. |
| `--post-findings <level>` | pr | Posts new findings at or above the level as comments on their lines, instead of opening the app. A finding posted by an earlier run is not posted again. |
| `--forge <name>` | pr | `github` or `gitlab`, for a host whose name does not say which it is. |
| `--remote <name>` | pr | The remote to read and fetch from. Default: `origin`. |
| `--into <branch>` | merge | The branch to merge into. Default: the branch the workspace is reviewed against, else the branch it started from, else the target named in your approval, else the default branch. |
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
| j, k | Next or previous commit (above the first: your uncommitted changes) | Next or previous file | Next or previous changed symbol |
| / | Find a branch | | Search the change list |
| c | Check out the commit or one of its branches (asks first) | Comment on the file's first change | Comment on the selected symbol |
| r | Review the branch | | Mark the selected symbol reviewed |
| x | Compare mode: pick two commits | | |
| f | Find a commit: Enter and Shift+Enter step through what it finds | | Show only the selected symbol and its neighbours |
| d | Show or fold the commit's details | | |
| p, P | | | Next or previous project, in a monorepo |
| o | | Open the file in VS Code at its first change | Open the selected symbol in VS Code |
| g | | The Graph page | The Files page |
| Esc | Leave compare mode | Close the comment box | Close the detail panel |

These keys work on Git, Scout, Skills, Monitor, Settings and a workspace's page. In a
change, only n and [ work.

| Key | What it does |
|---|---|
| n | Open **Start a workspace** |
| g, s | Git, Settings |
| a | Scout |
| i | Skills |
| m | Monitor |
| w | Move to the workspaces in the sidenav. ↑ and ↓ move between them, and Enter opens one. |
| [ | Fold the sidenav to a row of icons, or open it again |
| ] | In a workspace: hide or show the **Changes** panel |

In a text box where you write a comment, a brief, a reply, a prompt or a commit's message,
Ctrl+Enter saves, starts, sends or commits. On macOS, use Cmd instead of Ctrl.

## Symbiote's tools for your own agent

`symbiote view` offers what its pages do as tools over MCP, the Model Context Protocol: list the
workspaces, start one, review a branch, merge it. Scout uses these tools, and you can give them to
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

An agent does not read your shell's aliases. If `symbiote` is an alias, write the full command
instead: `node <Symbiote's folder>/packages/cli/dist/bin.js mcp`.

| Tools | What they do | Asks you |
|---|---|---|
| `overview` | What needs you: workspaces that wait or are ready, merges that wait | |
| `workspaces`, `workspace`, `thread` | The workspaces; one workspace with its brief, commits and files; its agent's thread | |
| `start_options`, `start_workspace` | What a start takes here; a start | Yes, to start |
| `reply`, `stop_agent`, `restart_agent` | Send a message to a workspace's agent; stop it; start it again | Yes, to start again |
| `clean_workspace` | Clean a workspace up | Yes |
| `review`, `finish_review` | A branch's change as Symbiote's graph; a verdict on it | Yes, for a verdict |
| `merges`, `merge_log` | The merge queue; a merge's log | |
| `queue_merge`, `land_merge`, `merge_resolution`, `retry_merge`, `recheck_merge`, `remove_merge` | The merge page's actions | Yes |
| `usage`, `code_map` | Your subscriptions' usage; where the code is, by folder | |
| `wait` | Waits until a workspace's agent or a merge changes state, 10 minutes at most | |

When a tool asks, a bar on every page of the app says which agent asks and what it will do, with
**Decline** and **Confirm**. Nothing happens before you click **Confirm**. If you click
**Decline**, or do not answer within 10 minutes, the agent is told that nothing was done.
