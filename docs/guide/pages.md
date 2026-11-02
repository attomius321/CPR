# Symbiote's pages

This guide describes the pages of `symbiote view` besides the workspaces, and Symbiote nexus,
which shows several of them in one window. Workspaces have their own
[guide](workspaces.md), and a change's Files and Graph pages are in the
[review guide](review-and-ci.md). Each page has a key, listed in the
[commands reference](../reference/commands.md#keys).

## Git

**Git** (`g`) draws the repository's commits and branches as a graph. It is the page
`symbiote view` opens on.

- **A commit.** Select one to see its message, author, parents and files in the details pane.
  Click a file to see its diff in the commits' place, and **Open in VS Code** (`o`) to open that
  diff in VS Code. `j` and `k` step through the files, and Esc goes back to the commits. Beside
  **Diff**, **History** lists the commits that changed the file, and **Blame** shows each line's
  commit: click one to go to it.
- **A commit's menu.** Right-click a commit to check it out (`c`) or start a workspace from it.
  The menu also makes a branch or a tag there, cherry-picks or reverts it, or resets your branch
  to it. A reset keeps
  your changes on disk.
- **The branches panel.** Right-click a branch to review, rename, delete, merge or hide it, or to
  rebase your branch onto it. A remote branch can be deleted from its remote. Double-click a
  branch to check it out. Each branch you reviewed carries a badge with your verdict.
- **Your uncommitted changes** are a row above the commits. Stage files, or only the lines you
  pick in a file's diff, write a message and commit them in the details pane. **Stash…** puts
  them aside; the stashes are listed under the branches.
- **Conflicts.** When a merge, a rebase or a cherry-pick stops on conflicts, resolve and stage
  the files, then click **Continue** or **Abort** in the details pane.
- **The toolbar** has **Fetch**, **Pull** (fast-forward only, merge or rebase) and **Push**, and
  **Find a commit** (`f`), which searches the messages, authors and SHAs.
- **Compare two commits**: press `x`, click two commits, then click **Compare**.

When a branch moves elsewhere (an agent commits, say), the page lists it without closing what you
look at. Symbiote never forces a push or a reset, and asks before anything it does would lose
changes. When git refuses, it says why.

## Nucleus

*Nucleus* (`a`) is your orchestrator in Symbiote: an agent you talk to in its terminal on this
page. Ask it about the repository: where something is decided, why it works this way, or what
waits for you. It reads the checkout and your workspaces' worktrees, so it can answer about an
agent's work before it is committed. It searches the web and reads web pages, to research tools,
libraries and docs. The README says what that sends
([What Symbiote writes and sends](../../README.md#what-symbiote-writes-and-sends)).

Nucleus can also act on your workspaces for you: start one, answer an agent, review or merge a
branch. Before a start, it can ask for suggested settings, as **Suggest settings** does, and you
choose what it starts with. Nucleus never edits files.

- **What waits for your Confirm.** Nucleus can send a message to an agent without asking you. A
  start, a verdict, a merge and a clean-up each wait until you click **Confirm** in the bar it
  shows on every page.
- **Starting without a Confirm.** To let Nucleus start workspaces at once, turn on **Start
  workspaces without a Confirm** on Nucleus's page in **Settings**. It is on while Hive mode is
  on. See [Starting workspaces without a Confirm](../reference/configuration.md#starting-workspaces-without-a-confirm).
- **New conversation** starts over.
- **Its Activity tab** shows what it did, across conversations. It lists your messages and its
  answers with their tokens, and every command, file read, search and page it asked for. Each
  shows what its gate allowed or refused. Each call of Symbiote's tools is there too, and each
  **Confirm** with your answer. **Export** takes
  it out as a workspace's does (`symbiote activity --nucleus`).

While Hive mode is on, Nucleus is called *Alpha Ceph*, its icon is the Hive Mind, and it is told
what Hive does. Turning Hive on or off starts its next conversation, unless it is answering or
waiting on you.

Nucleus was called Scout before. A conversation that Scout started stays open on this page,
without the web, until you press **New conversation**.

## Skills and Scribe

**Skills** (`i`) lists the repository's *skills*: the instruction files agents load for a kind of
task (`.claude/skills/<name>/SKILL.md`).

- **Read and edit them.** Search them by name or description. Read and edit one here, with line
  numbers or as a Markdown preview, or open it in VS Code. As you type, the page flags what an
  agent would refuse, such as a missing name or description.
- **Scribe**, an agent on the same page, writes a new skill or improves one. You ask in its
  terminal, and **Improve with Scribe** types the skill's path there for you. Scribe only writes
  skills and never commits.
- **Codex.** Codex reads `.agents/skills`, not `.claude/skills`. If Codex is installed and sees
  none of the skills, **Link for Codex** makes `.agents/skills` a link to `.claude/skills`, so
  both agents read one copy. Commit the link to share it.
- **Your skill library** is a folder of skills kept outside the repository, a plain folder or one
  in a git repository. Set it once in **Settings**, and every repository's Skills page lists its
  skills too: you edit and add them there, and Scribe writes them. If Settings says so, the page
  also commits and pushes the library's changes. See
  [the skill library](../reference/configuration.md#the-skill-library).

## Monitor

**Monitor** (`m`) shows how the code of the checked-out commit is spread across folders and
files, to spot the files that have grown too large.

- **The map.** Each file is a tile sized by its lines of code: lines that are not blank and not
  only a comment. A file's colour is its length: yellow from 250 lines, orange from 500, red from
  1,000. **Colour: Kind** gives each kind of file its own colour instead.
- **Kinds.** The buttons at the top count and show source, tests, docs, data and other files, and
  the files Symbiote sets aside, such as generated code. Turn a kind off to leave it out.
- **Folders.** Click a folder to go in. Back, Backspace or Esc goes up a folder.
- **The list** ranks the same numbers: **In this folder**, or the **Largest files** under it. A
  line in it marks where half of the code is reached.

## Settings

**Settings** (`s`) holds:

- **The prompts** Symbiote gives its agents, grouped by agent. They include a workspace agent's
  first prompt for each kind of work, the verdicts sent to agents, and the instructions of the
  merger, Nucleus and Scribe. Hive's messages are listed while Hive is on. Change each one, insert its placeholders
  with a click, or reset it to Symbiote's text. See [Prompts](../reference/configuration.md#prompts).
- **Symbiote's own agents**: the model and effort of the merger, Nucleus and Scribe. They are set
  only here; their pages have no such choices. **Suggest settings** has its model and effort too.
- **This repository**: **Hive mode**, its switch and its settings (see
  [Hive mode](../reference/configuration.md#hive-mode)).
- **This machine**: the **Skill library**, its folder or a repository to clone, and who commits
  its changes.
- **Appearance**: dark, light or your system's theme, and the text size: Compact, Default or
  Large. The text size changes the text and not the rows. Appearance also sets whether Git's
  commit details show on the right or below the commits.

The status bar at the bottom of every page shows how much of your Claude and Codex subscription
limits you have used. To read no usage, set `SYMBIOTE_USAGE=off`.

## Symbiote nexus

Each `symbiote view` serves one repository. Symbiote nexus shows every one running on this machine
as a tab of one window, and starts new ones in any repository on your computer. Run it anywhere:

```sh
symbiote-nexus
```

It opens like `symbiote view`: in Symbiote's window when it is set up, otherwise in your browser.
It takes `--browser`, `--no-open` and `--port` too.

### Its tabs

The row at the top has two groups, with a line between them. On the left is the nexus's own page,
**Symbiotes**. After the line, each tab is one Symbiote, with a dot for its state: green while it
runs, an empty ring once it stopped. A Symbiote's tab shows it as its own window would. A Symbiote
you opened stays loaded while you look at another, so switching back is instant. A `symbiote view`
started in a terminal gets its tab within 2 seconds.

### The Symbiotes page

**Symbiotes** shows your Symbiotes as cards: the ones you pinned first, in the order you pinned
them, then the other running ones. A running Symbiote's card shows its folder, branch and changed
files: click it to open its tab. A pinned repository with no Symbiote running shows its branch and
**Open Symbiote**: click it to start one. Nothing starts on its own. To pin a Symbiote or unpin it,
use the pin in its card's corner, which shows when you point at the card.

Under the cards are your computer's folders, one folder at a time, starting in the folder of the
newest running Symbiote, or in your home folder.

- A folder's repositories come first, as cards that show the checked-out branch. The other
  folders follow as rows: click one to go into it.
- A repository is as far as you go: clicking it opens a Symbiote there, or shows the one already
  running. A path inside a repository shows the folder that holds it, with the repository picked.
- The places are on the left: your home folder, the folders your Symbiotes are in, `/`, and on
  WSL the Windows drives (`C:`).
- To go to any folder, hidden ones included, type its path in **Go to folder**, at the top right,
  and press Enter.

To keep a folder at hand, pin it with the pin at the right of the folder's head. Pinned folders are
listed under **Pinned**, below the places, and stay there the next time you open the nexus. A
repository you pin from its card's corner joins the Symbiotes' cards instead. A pinned folder that
was moved or deleted stays marked "not found" until you unpin it with the pin at the end of its row.
See [the nexus's pinned folders](../reference/configuration.md#the-nexuss-pinned-folders).

### Stopping

Closing the nexus stops no Symbiote, not even the ones it started, so their agents keep working.
To stop a Symbiote, click the stop button on its card in **Symbiotes**, then **Stop**. Its
terminals, and the agents working in them, stop with it. If you had opened its tab, the tab stays,
marked stopped, with **Start again** and **Close tab**.
