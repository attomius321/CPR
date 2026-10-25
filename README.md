# Symbiote

Symbiote runs coding agents on your machine and keeps you in charge of what they ship. Each task
gets a *workspace*: a branch, a folder and an agent of its own, Claude Code or Codex. You read the
agent's plan, answer its questions, review its branch and approve it. When you click **Merge
into**, Symbiote merges the commit you approved, and lands it once your project's check (its
tests, for example) passes on the merge.

![A workspace in Symbiote: the sidenav lists the workspaces by what they need from you, and the open workspace shows its agent's plan in the agent's terminal](docs/images/workspace.png)

Several agents can work at once, each on its own branch, while you keep working in your own
checkout. Everything runs locally: Symbiote is a command, `symbiote`, and an app that the command
opens in a window of its own or in your browser.

[Install](#install) · [Quick start](#quick-start-your-first-workspace) ·
[Workspaces](#workspaces) · [Other pages](#the-other-pages) ·
[Review without an agent](#review-without-an-agent) ·
[Files and network](#what-symbiote-writes-and-sends) · [Limits](#limits) ·
[Development](#development)

## Requirements

- Linux, or Windows through WSL. macOS runs the same code but is not tested yet.
- git, Node 22.12 or newer, and pnpm 12 (`npm install -g pnpm@12`).
- Claude Code or Codex, installed and logged in. Symbiote starts them with your own login, so
  their work counts against your own subscription or API key. This includes Symbiote's own
  helper agents: the merger, Scout and Scribe, described below.
- On Linux, python3, make and a C++ compiler. `pnpm install` uses them to build the terminal that
  shows each agent in the app. Without them, everything else works, and you answer the agent in a
  text box instead.

## Install

Run these commands once. The last line adds a `symbiote` alias to your shell's profile, with the
path of the folder you are in. Use `~/.zshrc` instead of `~/.bashrc` if your shell is zsh.

```sh
git clone https://github.com/attomius321/Symbiote.git
cd Symbiote
pnpm install
pnpm build
echo "alias symbiote='node $PWD/packages/cli/dist/bin.js'" >> ~/.bashrc
```

Open a new terminal, then run `symbiote --help` to check the install. It lists the commands.

### Symbiote's window

If you skip this step, Symbiote opens in your browser. To give it a window of its own, run this
in Symbiote's folder. It downloads Electron, about 100 MB:

```sh
pnpm app:setup
```

After that, `symbiote view` opens Symbiote's window. Closing the window stops `symbiote view`,
but agents keep running. To use a browser tab anyway, add `--browser`. To start Symbiote from
your desktop's app list instead of a terminal, run `symbiote app install` once (Linux and WSL).

Two limits apply to the window:

- On Ubuntu 24.04 and later, AppArmor can refuse the sandbox that Electron needs. Symbiote then
  says so and opens your browser instead.
- On WSL, files dragged from Windows never reach the window. Use the **Add files** and **Attach
  images** buttons instead. Windows' files are under `/mnt/c`.

## Quick start: your first workspace

This walks one task from start to merge. You need a git repository of your own, and Claude Code
or Codex. Claude Code starts only in a repository you have trusted, and its workspaces count as
part of it. If you have never run `claude` in this repository, run it there once and accept its
trust prompt. Codex needs no such step.

1. In the repository, run `symbiote view`. Symbiote opens on **History**, the repository's
   commits and branches. The list on the left is the *sidenav*: its pages, then your workspaces.
2. Press `n`, or click **+** beside **Workspaces** in the sidenav. The **Start a workspace** page
   opens.
3. Leave **Feature** picked. Type a **Title**, such as "Add a discount code", and describe the
   **Goal**: what it should do, and why. Leave **Plan first and wait for my OK** on.
4. Click **Start**. Symbiote creates the branch and its own folder, starts the agent there, and
   opens the workspace on the agent's terminal.
5. Wait for the plan. The workspace moves to **Waiting for you** in the sidenav. Read the plan in
   the terminal, then type your answer there: "OK", or what to change.
6. When the agent has finished, the workspace moves to **To review**. Click **Review** at the top
   of the workspace. The branch's changes open as a graph. In the **Review** tab on the left,
   pick **Approve** and click **Finish review**.
7. Click **Merge into**. Symbiote merges the commit you approved into the branch the workspace
   started from, and runs your project's check. If the check passes, Symbiote *lands* the merge:
   it moves that branch to the merge commit.
8. The workspace moves to **Done**. Click **Clean up** to remove its folder, its branch and the
   agent's sessions.

## Workspaces

A workspace is one task for one agent. It has a branch and a *worktree*: a second working folder
of the same repository, checked out on that branch. It also has the agent's session and a record
of what you asked. Agents never work in your own checkout, so you can keep working while they
do.

### Start a workspace

The **Start a workspace** page (`n`) asks what the work is. Each kind of work asks its own
question and names its branch with its own prefix:

| Kind | It asks | Branch |
|---|---|---|
| Feature | What should it do, and why? | `feature/` |
| Fix | What happens, and what should happen? | `fix/` |
| Refactor | What should be restructured, and why? | `refactor/` |
| Chore | What should change, and why now? | `chore/` |
| Spike | What is the question, and what will the answer decide? | `spike/` |

A spike answers its question in a written report and commits nothing unless you ask, so it
usually has nothing to merge.

Every kind also takes a title, an optional **Done when** (how you will know it works), and more
notes under **More**. If Symbiote finds your project's check, such as `npm run test`, `cargo
test` or `pytest`, it names it under **Done when**. The form is kept as a draft until you start,
so leaving the page loses nothing.

The card beside the form holds the workspace's choices:

- **Start from**: the branch to start from. The default branch, unless you pick another.
- **Branch**: the new branch's name, made from the title. You can edit it.
- **Agent**, **Model** and **Effort**: the agent, the model it starts with, and its effort level
  (how long the model thinks before it answers). The lists come from the agent itself.
- **Permission** (Claude Code): Claude Code's own permission mode, which decides what it may do
  without asking you. Symbiote never grants the agent more than the mode you pick.
- **Plan first and wait for my OK**: the agent writes a plan and stops before it changes
  anything. It is on by default.
- **Documents**: files for the agent, such as screenshots, PDFs or samples. Up to 20 files, 20 MB
  each.

When you click **Start** (or press Ctrl+Enter), Symbiote:

1. writes the agent's *brief* (the task in words) from your answers;
2. creates the branch and its worktree next to your checkout, in `../<repo>.worktrees/`;
3. records the workspace in `symbiote/workspaces/<branch>.json`;
4. starts the agent in the worktree, in the background, with the brief.

The agent keeps running when you close the page or Symbiote's window.

### See what needs you

The sidenav lists your workspaces in groups, by what each one needs from you:

| Group | What is in it |
|---|---|
| **Merging** | Merges Symbiote is making |
| **Waiting for you** | Agents stopped on you: a plan to read, a question, a permission to give |
| **To review** | Finished work: a branch to review, or an approval to merge |
| **Not running** | Agents that failed, were stopped, or have not started |
| **Working** | Agents at work, with what each one is doing right now |
| **Done** | Merged workspaces, ready to clean up |

Each card shows the workspace's title, its kind, its state, and how long it has been in that
state. A waiting card has **Respond**, which opens the agent's terminal. The window's title counts
the workspaces waiting for you.

### Work with the agent

Click a workspace to open it. Its page has four tabs:

- **Terminal**: the agent's own terminal, as Claude Code or Codex draws it. Answer questions and
  permission prompts here, as you would in your own terminal. Leaving the tab does not stop the
  agent. To give the agent an image, paste it (Ctrl+V) or use **Attach images**.
- **Thread**: the agent's plans and reports, your messages, and what it waited for.
- **Activity**: what happened, one line each: the commands the agent ran, the files it edited,
  its commits and your reviews.
- **Brief**: what the agent was asked, with the documents you gave it.

The **+** after the tabs opens a shell in the workspace's worktree, for tests, a dev server or git.
Where the window is wide enough, the **Changes** panel on the right lists the branch's commits and
changed files. Click a file to open its diff in VS Code.

The top of the page has these buttons:

- **Review** opens the branch's changes for review.
- **Stop** stops the agent, and **Start** starts it again.
- **⋯** holds **Open in VS Code**, which opens the worktree, and **Copy the prompt**, which copies
  the agent's first prompt.

### Review the branch and tell the agent

**Review** shows the branch's changes as a graph. The graph draws a box for each changed file,
and in it the *symbols* that changed: functions, classes, methods and types, coloured by what
changed. Lines between symbols are calls and other uses. *Findings* mark the risky changes: a
function removed while code still calls it, new code that nothing uses, or a signature changed
under callers that were not updated. The [review guide](docs/guide/review-and-ci.md) explains
the graph and the findings.

![Review of a workspace's branch: the changed symbols as a graph, with the Review tab open](docs/images/review.png)

To review:

1. Click a symbol to see its diff and who uses it. Press `r` to mark it reviewed.
2. To comment on a symbol or one of its lines, select it and press `c`.
3. In the **Review** tab, pick **Approve**, **Request changes** or **Comment**, then click
   **Finish review**.

Symbiote writes your *verdict* (the decision and your comments) to
`symbiote/reviews/<branch>/<your git email>.json`. If you approved, there is nothing to tell the
agent: you merge next. If you requested changes or commented, click **Send to the agent**.
Symbiote types the verdict and the review file's path into the agent's terminal, and you send it
with Enter. The agent reads your comments from that file.

After the agent adds commits, review the branch again. Only what is new or changed since your
last review is left to look at.

### Merge

After you approve a branch, **Merge into** appears in the **Review** tab and on the workspace's
page. The target is the branch the workspace started from, unless you pick another. Symbiote then:

1. merges the commit you approved (not any later one) in a worktree of its own, so neither your
   checkout nor the agent's worktree is used;
2. runs your project's check on the merge. The check is `merge.checks` in
   [`symbiote/config.json`](docs/reference/configuration.md), or a command Symbiote finds in the
   project, such as a `test` script in `package.json`;
3. lands the merge if the check passes: it moves the target branch forward to the merge commit.

If the target branch is checked out in your own checkout, landing updates your files too. If that
would overwrite changes you have not committed, git refuses, nothing changes, and the merge waits
for you to click **Land** again.

Symbiote does not push unless you set `merge.push` to `true` in `symbiote/config.json`. Merges
run one at a time, in the order you asked for them. Click one under **Merging** to see its steps
and their output as they run. If the check fails, nothing
lands, and the merge page shows the check's output. If the project has no check, the merge waits
for you to click **Land**.

If the branch conflicts with the target, Symbiote gives the conflict to the *merger*, an agent
that proposes a resolution for each conflicting part. Nothing lands until you review it. The
merge page shows each resolved part, marks in red the lines a side's change lost, and marks in
amber the lines the merger wrote itself.

**Approve** lands the resolution, and **Request changes** asks the merger again with your words.
If the resolution's check failed, **Check again** runs the check again without asking the merger.

![A merge in Symbiote: its steps, and the log of the merge and the check](docs/images/merge.png)

### Clean up

When a workspace is merged, it moves to **Done**. **Clean up** removes the agent's sessions, the
worktree, the documents and the branch. To remove a workspace that was not merged, use **Clean
up…** under **⋯**. Symbiote asks first and keeps the branch. Symbiote cleans up no workspace whose
worktree has changes that are not committed.

## The other pages

The sidenav also opens these pages. Each has a key.

- **History** (`h`): the repository's commits and branches, drawn as a graph. Right-click a commit
  to check it out, review its branch (`r`), or start a workspace from it. Press `x` to compare
  two commits.
- **Scout** (`a`): an agent you can ask about the repository: where something is decided, why it
  works this way, or what waits for you. Scout can also act on your workspaces for you: start one,
  answer an agent, review or merge a branch. Scout never edits files. A start, a verdict, a merge
  and a clean-up each wait until you click **Confirm**.
- **Skills** (`i`): the repository's *skills*, the instruction files agents load for a kind of
  task (`.claude/skills/<name>/SKILL.md`). Read and edit them here. As you type, the page flags
  what an agent would refuse, such as a missing name or description. *Scribe*, an agent on the
  same page, writes a new skill or improves one. Scribe only writes in `.claude/skills/` and
  never commits.
- **Monitor** (`m`): where the code is, to spot the files that have grown too large. A map shows
  each file sized by its lines of code, and marks the long ones.
- **Settings** (`s`): the prompts Symbiote gives its agents, such as a workspace agent's first
  prompt; the model and effort of the merger, Scout and Scribe; and **Appearance** (dark, light
  or your system's).

The status bar at the bottom shows how much of your Claude and Codex subscription limits you have
used.

![History: the branches panel, and the commits drawn as a graph with branch labels](docs/images/history.png)

## Review without an agent

The graph works on any change, with or without a workspace:

```sh
symbiote view main     # this branch against main, as a graph
symbiote diff main     # the same comparison, printed in the terminal
symbiote pr 123        # a GitHub pull request or a GitLab merge request
```

`symbiote pr` posts your comments to the pull request as one review. A GitHub Action and a GitLab
CI template post the findings on the lines they are about. The
[review guide](docs/guide/review-and-ci.md) covers these, the tokens they need, the framework
plugins for Angular and Qwik, and CSS and SCSS. Every command and option is in the
[commands reference](docs/reference/commands.md).

## What Symbiote writes and sends

In your repository, Symbiote keeps its files in the `symbiote/` folder: workspace records,
reviews, the agents' threads and activity, documents, and the settings of the agents it starts.
It also writes `symbiote/AGENTS.md`, which tells any agent how to act on a review. Symbiote's own
`symbiote/.gitignore` keeps everything there out of git, itself included, except two files. They
are yours to commit and share: `config.json` holds your settings, and `merge.md` your rules for
the merger.

Two of your own actions write elsewhere in the repository. Saving a skill writes in
`.claude/skills/`, and landing a merge updates the branch you have checked out.

Outside the repository, Symbiote writes:

- the workspaces' worktrees, next to your checkout, in `../<repo>.worktrees/`;
- its cache, `~/.cache/symbiote` on Linux, with the worktrees it compares and merges in, the
  list of merges, drafts, pasted images and its logs.

Symbiote itself sends three things over the network:

- Your Claude usage is read from `api.anthropic.com`, with the token Claude Code stored. Codex's
  usage comes from Codex on your machine. Set `SYMBIOTE_USAGE=off` to read neither.
- `symbiote pr` and the CI jobs call the GitHub or GitLab API, and fetch the pull request.
- A merge is pushed only if you set `merge.push`.

The agents talk to their own services, as they do when you run them yourself. Symbiote's fonts
and pages are served by `symbiote view` itself.

All settings are in the [configuration reference](docs/reference/configuration.md).

## Limits

- Workspaces start Claude Code or Codex. Other agents are not supported yet.
- The graph reads TypeScript, JavaScript, CSS and SCSS. If a branch changes only other files, its
  review shows no symbols, but you can still approve and merge it. Workspaces work in any git
  repository.
- The analysis is static: it reads code and does not run it.
- Symbiote is tested on Linux and WSL. macOS is not tested yet. On Windows, use WSL.

## Development

```sh
pnpm install
pnpm check        # format, lint, typecheck and unit tests
pnpm build        # compile the packages and bundle the app
pnpm test:e2e     # the app's end-to-end tests, after pnpm build
```

The code is in `packages/`. The main ones are `cli`, the `symbiote` command and its server;
`viewer`, the app; `core`, the analysis; and `desktop`, Symbiote's window. `CLAUDE.md` holds the
working rules for agents in this repository.

- [Plan](docs/PLAN.md): every milestone, with its design and results.
- [Journal](docs/JOURNAL.md): what each change learned and measured.
- [Graph schema](docs/graph-schema.md): the graph JSON that `symbiote diff --json` prints.
