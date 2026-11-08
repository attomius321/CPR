# Symbiote's pages

This guide describes the pages of `symbiote view` besides the workspaces, and Symbiote nexus, which
shows several of them in one window. Workspaces have their own [guide](workspaces.md), and a
change's Files and Graph pages are in the [review guide](review-and-ci.md). Each page has a key,
listed in the [commands reference](../reference/commands.md#keys).

## Overview

**Overview** (`t`) is the page `symbiote view` opens on, first in the sidenav. "Today" is your
calendar day, from your midnight.

- **In normal mode**, five figures: what waits for you, the agents at work, the workspaces with
  commits to review, what merged into the default branch this week (a bar a day) and the median
  time from a workspace's start to its merge. Then the inbox: each workspace that waits for you,
  the oldest first, with its one action. **Respond** opens a plan in the agent's terminal, where
  **Approve plan** is; **Answer** does the same for a question or a permission; **Review** opens
  the change; **Merge into** queues an approved one; **Open** goes to a merge that needs you;
  **Read** opens a report that came without commits. Under it, the agents at work, the merges
  under way and what merged today; beside it, your subscription's usage and today's events.
- **In Hive mode**, five figures: the workspaces in flight by step, landed today (a bar a day for
  the week), the defects Hive's reviews proved today, the median time from brief to landed, and
  what was spent since midnight: each review's cost when it ran, and the writer's from Claude Code's
  own counts in its session files. A workspace Hive stopped is called out with why, and **Read
  why** opens its Run tab. Each workspace in flight shows its steps, what runs now, its round,
  time and spend; then what landed today. Beside them, the usage at which Hive pauses, the budget
  per workspace, the reviewer and how Hive lands, then today's events. **Turn off Hive** asks as
  Settings does.

Merged today counts git's merges into the default branch, and the merge queue's fast-forwards; a
fast-forward made outside the queue has no record of when, and is not counted. A review's findings
are not shown here: Symbiote finds them when the review opens.

## Git

**Git** (`g`) draws the repository's commits and branches as a graph.

- **A commit.** Select one to see its message, author, parents and files in the details pane. Click
  a file to see its diff in the commits' place, and **Open in VS Code** (`o`) to open that diff in
  VS Code. `j` and `k` step through the files, and Esc goes back to the commits. Beside **Diff**,
  **History** lists the commits that changed the file, and **Blame** shows each line's commit: click
  one to go to it.
- **A commit's menu.** Right-click a commit to check it out (`c`) or start a workspace from it. The
  menu also makes a branch or a tag there, cherry-picks or reverts it, or resets your branch to it.
  A reset keeps your changes on disk.
- **The branches panel.** Right-click a branch to review, rename, delete, merge or hide it, or to
  rebase your branch onto it. A remote branch can be deleted from its remote. Double-click a branch
  to check it out. Each branch you reviewed carries a badge with your verdict.
- **Your uncommitted changes** are a row above the commits. Stage files, or only the lines you pick
  in a file's diff, write a message and commit them in the details pane. **Stash…** puts them aside;
  the stashes are listed under the branches.
- **Conflicts.** When a merge, a rebase or a cherry-pick stops on conflicts, resolve and stage the
  files, then click **Continue** or **Abort** in the details pane.
- **The toolbar** has **Fetch**, **Pull** (fast-forward only, merge or rebase) and **Push**, and
  **Find a commit** (`f`), which searches the messages, authors and SHAs.
- **Compare two commits**: press `x`, click two commits, then click **Compare**.

When a branch moves elsewhere (an agent commits, say), the page lists it without closing what you
look at. Symbiote never forces a push or a reset, and asks before anything it does would lose
changes. When git refuses, it says why.

## Nucleus

*Nucleus* (`a`) is your orchestrator in Symbiote: an agent you talk to in its terminal on this page.
Ask it about the repository: where something is decided, why it works this way, or what waits for
you. It reads the checkout and your workspaces' worktrees, so it can answer about an agent's work
before it is committed. It searches the web and reads web pages, to research tools, libraries and
docs. The README says what that sends ([What Symbiote writes and
sends](../../README.md#what-symbiote-writes-and-sends)).

Nucleus can also act on your workspaces for you: start one, answer an agent, review or merge a
branch. Before a start, it can ask for suggested settings, as **Suggest settings** does, and you
choose what it starts with. Nucleus never edits files.

- **What waits for your Confirm.** Nucleus can send a message to an agent without asking you. A
  start, a verdict, a merge and a clean-up each wait until you click **Confirm** in the bar it shows
  on every page.
- **Starting without a Confirm.** To let Nucleus start workspaces at once, turn on **Start
  workspaces without a Confirm** on Nucleus's page in **Settings**. It is on while Hive mode is on.
  See [Starting workspaces without a
  Confirm](../reference/configuration.md#starting-workspaces-without-a-confirm).
- **New conversation** starts over.
- **Its Activity tab** shows what it did, across conversations. It lists your messages and its
  answers with their tokens, and every command, file read, search and page it asked for. Each shows
  what its gate allowed or refused. Each call of Symbiote's tools is there too, and each **Confirm**
  with your answer. **Export** takes it out as a workspace's does (`symbiote activity --nucleus`).

While Hive mode is on, Nucleus is called *Alpha Ceph*, its icon is the Hive Mind, and it is told
what Hive does. Turning Hive on or off starts its next conversation, unless it is answering or
waiting on you.

Nucleus was called Scout before. A conversation that Scout started stays open on this page, without
the web, until you press **New conversation**.

## Skills and Scribe

**Skills** (`i`) lists the repository's *skills*: the instruction files agents load for a kind of
task (`.claude/skills/<name>/SKILL.md`).

- **Read and edit them.** Search them by name or description. Read and edit one here, with line
  numbers or as a Markdown preview, or open it in VS Code. As you type, the page flags what an agent
  would refuse, such as a missing name or description.
- **Scribe**, an agent on the same page, writes a new skill or improves one. You ask in its
  terminal, and **Improve with Scribe** types the skill's path there for you. Scribe only writes
  skills and never commits.
- **Codex.** Codex reads `.agents/skills`, not `.claude/skills`. If Codex is installed and sees none
  of the skills, **Link for Codex** makes `.agents/skills` a link to `.claude/skills`, so both
  agents read one copy. Commit the link to share it.
- **Your skill library** is a folder of skills kept outside the repository, a plain folder or one in
  a git repository. Set it once in **Settings**, and every repository's Skills page lists its skills
  too: you edit and add them there, and Scribe writes them. If Settings says so, the page also
  commits and pushes the library's changes. See [the skill
  library](../reference/configuration.md#the-skill-library).

## Monitor

**Monitor** (`m`) shows how the code of the checked-out commit is spread across folders and files,
to spot the files that have grown too large.

- **The map.** Each file is a tile sized by its lines of code: lines that are not blank and not only
  a comment. A file's colour is its length: yellow from 250 lines, orange from 500, red from 1,000.
  **Colour: Kind** gives each kind of file its own colour instead.
- **Kinds.** The buttons at the top count and show source, tests, docs, data and other files, and
  the files Symbiote sets aside, such as generated code. Turn a kind off to leave it out.
- **Folders.** Click a folder to go in. Back, Backspace or Esc goes up a folder.
- **The list** ranks the same numbers: **In this folder**, or the **Largest files** under it. A line
  in it marks where half of the code is reached.

## Issues

**Issues** (`u`) lists the issues of the GitHub or GitLab repository that `origin` points to. It
only reads them: nothing is written to the forge.

- **The list.** Each issue shows its number, title, labels, author, when it was last updated and
  its comments. **Open** is the default; **Closed** and **All** are beside it. The search finds
  words in titles, on the forge, so it covers every issue, not only the ones shown. The list shows
  30 issues at a time: **Load more** reads the next 30.
- **One issue.** Pick one to read its text and its first 100 comments, with each author's role in
  the project (owner, member, contributor). **Open on GitHub** (or GitLab) opens it in the
  browser. The issue stays in the address (`/issues?number=12`).
- **Untrusted text.** Anyone can open an issue on a public repository. Symbiote shows its text
  without its HTML: images are links, never loaded, and links open in the browser.
- **Tokens.** The page uses the tokens of [`symbiote pr`](review-and-ci.md#review-a-pull-or-merge-request).
  Without one, it still reads public issues, and says what to set: GitHub then allows 60 requests
  an hour, and GitLab shows no comments. **Refresh** reads the list again; an answer that has not
  changed does not count against GitHub's limit.

If `origin` is missing, or is on neither GitHub nor GitLab, the page says so.

## Settings

**Settings** (`s`) lists what you set, the same way in both modes. Type in **Find a setting**
to narrow the list: an entry's name, an agent's prompt, or a config key such as `merge.checks`.

- **This repository**: **Checks** and **Hive mode**. **Checks** is the check: the commands the
  merger runs before a merge lands, and Hive on every commit, in order until one fails. One check
  serves both modes. Add, remove or reorder the commands and save them as `merge.checks`. With none
  set, the page shows the check Symbiote finds, and **Reset to found** goes back to it. **Hive
  mode** is Hive's switch and its settings (see [Hive
  mode](../reference/configuration.md#hive-mode)); its row **The check** opens **Checks**.
- **Agents**: Nucleus (Alpha Ceph while Hive is on), the merger, Scribe, Hive's running reviewer
  while Hive is on, and **Suggest settings**. Each page has the agent's model, its effort and its
  prompts. These are set only here; the agents' own pages have no such choices.
- **Prompts**: what Symbiote tells a workspace's agent (one prompt for each kind of work, plan
  first or not), the verdicts and files of a review, and Hive's messages while Hive is on. Each
  group folds; a folded group still shows **not saved** or **changed**. Change a prompt, insert its
  placeholders with a click, or reset it to Symbiote's text. See
  [Prompts](../reference/configuration.md#prompts).
- **This machine**: the **Skill library**, its folder or a repository to clone, and who commits its
  changes.
- **Appearance**: dark, light or your system's theme, and the text size: Compact, Default or Large.
  The text size changes the text and not the rows. Appearance also sets whether Git's commit details
  show on the right or below the commits.

The status bar at the bottom of every page shows, at the left, the checkout's branch and commit,
how many things wait for you and how many agents work (in Hive mode: Hive on, the workspaces in
flight and landed today). At the right, how much of your Claude and Codex subscription limits you
have used. To read no usage, set `SYMBIOTE_USAGE=off`.

## Symbiote nexus

Each `symbiote view` serves one repository. Symbiote nexus shows every one running on this machine
as a tab of one window, and starts new ones in any repository on your computer. Run it anywhere:

```sh
symbiote-nexus
```

It opens like `symbiote view`: in Symbiote's window when it is set up, otherwise in your browser. It
takes `--browser`, `--no-open` and `--port` too. It serves on port 7347, so its address stays the
same: `http://127.0.0.1:7347/`. Run it again while it runs, and it opens the running one instead of
starting a second. If another program holds the port, it says so; choose another with `--port`.

### Its tabs

The row at the top has two groups, with a line between them. On the left is the nexus's own page,
**Symbiotes**. After the line, each tab is one Symbiote, with a dot for its state: green while it
runs, an empty ring once it stopped. A Symbiote's tab shows it as its own window would. A Symbiote
you opened stays loaded while you look at another, so switching back is instant. A `symbiote view`
started in a terminal gets its tab within 2 seconds.

### The Symbiotes page

**Symbiotes** lists every repository the nexus knows, then your home's folders, in four groups:

- **Running**: each running Symbiote, by name, as the tabs are. A pinned one has a small pin.
- **Pinned**: what you pinned that does not run, by name: repositories, folders, and pins whose
  folder is gone.
- **Opened before**: repositories whose Symbiote this nexus saw running, last seen first.
- **Home**: your home's folders as a tree, the repositories among them. At first it shows home's
  own folders. Click a folder's arrow, or press → with the field empty, to open it; ← closes it, or
  goes to the folder holding it. A repository is as far as the tree goes.

Each row shows the state (a green dot while it runs), the name, the path, the branch, and since
when it runs or when it was last opened. A running one also shows how many files are changed.

There is always one row picked, and its card is beside the list: its status, its path (click a
part of it to list that folder), its branch and changes, its other worktrees, and the folder it is
in. The card's buttons are **Show** (a running one's tab), **Open Symbiote**, **Stop**, the pin,
and the copy button for the path. A folder's card lists its folders, and has **Go in** (it opens
the folder in the tree) and **Open Symbiote**. A click on a row picks it; Enter or a double click
opens it. Nothing starts on its own.

To find a repository or a folder, type any part of its name or path in the field at the top of the
list: `acme bill` finds `~/work/acme/billing-service`. The matching words are marked, and a name
that matches comes first. The search covers every folder of your home that the nexus scanned.

To type a path, start with `~/` or `/`. The list then shows that folder: Tab completes the name
(the rest shows faint in the field until you press it), → goes into a folder, and
Backspace right after a `/` goes up one folder. **Browse…** puts `~/` in the field. A repository is
as far as you go: a path inside one lists the folder that holds it, with the repository picked.

#### Opening a folder that is no repository

Enter on a folder that is no git repository, or its **Open Symbiote**, asks first: "Make notes a
git repository?". **Cancel** is the default, and Escape cancels. **Make it a repository** runs
`git init` in the folder, which adds a `.git` folder and nothing else, then opens its Symbiote. No
commit is made: until you commit, from its **Git** page or a terminal, Monitor has nothing to read
and no workspace can start. A folder inside a repository opens that repository instead.

The nexus never makes a repository of `/`, your home, a Windows drive such as `/mnt/c`, Symbiote's
cache or settings folders, a folder of a home kept in git, or a folder outside your home other
than on a Windows drive. The card says why.

#### How your home is scanned

The nexus scans your home when it starts, and again only when you click the refresh button at the
bottom of the list. It goes as deep as your folders go, skips hidden folders and folders such as
`node_modules`, stops at a repository, and stops at 20,000 folders or 5 seconds. On a PC measured
for it, home was 2,780 folders and 42 repositories, scanned in under 0.2 seconds. Under WSL it does
not scan Windows' drives, which took from 7 to over 30 seconds: type a path such as `/mnt/c/` to
go there, or pin a folder. The scan only reads folder names and each repository's branch.

To keep a repository or a folder at hand, pin it with the pin on its card. Pins stay the next time
you open the nexus. A pinned folder that was moved or deleted stays marked "folder gone" until you
unpin it from its card.

### Stopping

Closing the nexus stops no Symbiote, not even the ones it started, so their agents keep working. To
stop a Symbiote, pick it in **Symbiotes**, click **Stop** on its card, then **Stop**. Its terminals,
and the agents working in them, stop with it. If you had opened its tab, the tab stays, marked
stopped, with **Start again** and **Close tab**.
