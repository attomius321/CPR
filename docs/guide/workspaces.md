# Work with agents in workspaces

This guide covers every step of a workspace: starting one, answering its agent, reviewing its
branch, merging it and cleaning it up. The [README](../../README.md#start-your-first-workspace)
walks one task through these steps; this page says what each choice does. Options and keys are
in the [commands reference](../reference/commands.md), and settings in the
[configuration reference](../reference/configuration.md).

A *workspace* is one task for one agent. It has a branch and a *worktree*: a second working
folder of the same repository, checked out on that branch. It also has the agent's session and a
record of what you asked. Agents never work in your own checkout, so you can keep working while
they do.

## Start a workspace

The **Start a workspace** page (`n`) asks what the work is. Each kind of work (Feature, Fix,
Refactor, Chore, Spike) asks its own question and names its branch with its own prefix, such as
`feature/` or `fix/`. The [README](../../README.md#start-a-workspace) lists them.

Every kind also takes these:

- a **Title**, which also names the branch;
- an optional **Done when**: how you will know it works. If Symbiote finds your project's check,
  such as `npm run test`, `cargo test` or `pytest`, it names it there;
- more notes under **More**, such as where to look or what is out of scope.

Under the main question, the Markdown button shows it as the agent's brief will read, and the
paperclip adds documents. A count shows the brief's length, at most 20,000 characters. The form
is kept as a draft until you start, so leaving the page loses nothing.

### The workspace's choices

The kinds are tabs over the form; the form also says which check the merge will run. The cards
beside it hold the workspace's choices, and **What happens next** says the steps your choices
make (plan first or not, the agent, where it merges):

- **Start from**: the branch to start from, the default branch unless you pick another. Its list
  has a search: type words from a branch's name, in any order, then pick it with ↑, ↓ and Enter.
- **Branch name**: the new branch's name, made from the title. You can edit it; the button
  beside it names it after the title again.
- **Agent**, **Model** and **Effort**: the agent, the model it starts with (its description in its
  tip), and its effort level, how long the model thinks before it answers, as a row of steps
  (arrow keys move it). The lists come from the agent itself.
- **Permissions** (Claude Code): Claude Code's own permission mode, which decides what it may do
  without asking you. Symbiote never grants the agent more than the mode you pick.
- **Approvals** (Hermes): Hermes asks in its terminal before a dangerous command. Its card says
  **Working** while it waits there.
- **Plan first and wait for my OK**: the agent writes a plan and stops before it changes
  anything. It is on by default.
- **Documents**: files for the agent, such as screenshots, PDFs or samples. Up to 20 files, of
  20 MB each.

### Suggest settings

To have the model, the effort and **Plan first** picked for you, write the brief and click
**Suggest settings**. A small model reads the brief: by default Haiku 5.5 for Claude Code, and
GPT-6 Luna for Codex. In 3 to 5 seconds, a card proposes the settings with one sentence on why.

Your cards change only if you click **Use these settings**; **Dismiss** keeps them. It never
changes the agent or its permissions, and it runs only when you click. In **Settings**, the
**Suggest settings** page holds the model and effort it runs on for each agent. It also holds its
instructions, including which models it counts as small, mid and large.

### What Start workspace does

When you click **Start workspace**, or press Ctrl+Enter, Symbiote:

1. writes the agent's *brief*, the task in words, from your answers;
2. creates the branch and its worktree next to your checkout, in `../<repo>.worktrees/`;
3. records the workspace in `symbiote/workspaces/<branch>.json`;
4. starts the agent in the worktree, in the background, with the brief.

Hermes has no background mode. It runs in a terminal of `symbiote view`, given the brief as its
first message. It keeps running when you leave its tab or reload the page, and stops when
Symbiote quits. Its **Terminal** tab then continues the session (`hermes --resume`).

## See what needs you

The sidenav lists your workspaces in groups, by what each one needs from you: **Merging**,
**Waiting for you**, **To review**, **Not running**, **Working**, then **Done today** and
**Earlier**, folded. The [README](../../README.md#see-what-needs-you) says what is in each.

Each workspace is a row of two lines:

- its state's icon (violet when it waits for you, an amber spinner while its agent works) and its
  title;
- its state in a word, such as **Plan ready** or **Running**, then its facts (commits, findings,
  what runs) and how long it has been so.

Hover a row for the rest: its kind, branch, agent, model and effort, and its state in full. Enter
on a row opens it; **Respond** is on the Overview's list of what waits and in the bar under the
agent's terminal. When Nucleus or Scribe waits for you, its page's link turns violet and says
**Waits**.

The window's title counts everything that waits for you: workspaces, merges, Nucleus, Scribe and
agents' requests to use a tool. In Symbiote's own window, the taskbar icon also gets a violet dot
while anything waits. When something new waits while you are in another window, Symbiote asks
the desktop to blink its taskbar button until you come back. Desktops that blink a window asking
for attention do so, KDE and XFCE among them. On WSL the taskbar shows the dot but cannot blink.

## Work with the agent

Click a workspace to open it. Under its head a card shows its steps, the current one amber while
the agent works and violet when it waits for you, with whose turn it is and its commits (in Hive
mode: the round, the time and the spend). On the agent's terminal the steps sit in the head
instead. The head shows the model and effort its agent runs on, such as
**Opus · high effort**. Symbiote reads them from the agent's session: Claude Code's latest answer,
or Codex's thread. If you change them in the terminal (`/model`, `/effort`), the head follows from
the agent's next answer. Until the agent answers, it shows what the agent started with; hover it
to see that.

The page has four tabs:

- **Terminal**: the agent's own terminal, as Claude Code, Codex or Hermes draws it. Answer
  questions and permission prompts here, as you would in your own terminal. Leaving the tab does
  not stop the agent. To give the agent an image, paste it (Ctrl+V) or use **Attach images**.
- **Thread**: the agent's plans and reports, your messages, and what it waited for.
- **Activity**: the agent's work as phases, such as exploring the code, implementing, testing,
  debugging and committing. Each kind of phase has its own colour on the timeline. Your messages,
  the agent's questions and its reports sit between the phases.
- **Brief**: what the agent was asked, with the documents you gave it.

On the **Activity** tab, each phase shows when it started, how long it took and its status.
Click a phase to see its events, and click an event to see its whole command, output and exit
code. While the agent works, a line at the top says what it is running. **Raw events** lists every
line Symbiote recorded. **Export** saves the whole activity as one Markdown file, for you or
another agent to read, or copies it to paste into an agent's chat. `symbiote activity` prints the
same file in a terminal (see [An exported activity](../reference/commands.md#an-exported-activity)).

The **+** after the tabs opens a shell in the workspace's worktree, for tests, a dev server or git.

### The Changes panel

Where the window is wide enough, the **Changes** panel on the right lists the branch's commits and
changed files. Beside the terminal it starts with what the agent does now, how long, and how many
tools it ran this turn; beside the other tabs, with the workspace's kind, agent, model and Plan
first, and its brief. Click a file to open its diff in VS Code. `]` hides or shows the panel.

The commits count from where the workspace started. For a workspace started from another branch,
that means only its own commits, not that branch's. To review it against another branch, pick
that branch in **since** above the commits. **Review**, the commit count, the merge check and the
target of an approval follow the pick. Pick **where it started** to go back.

The top of the page has these buttons:

- **Review** opens the branch's changes for review.
- **‹›** opens the worktree in VS Code.
- **⋯** holds **Stop the agent** (**Start the agent** is in the head once it stopped) and **Copy
  the prompt**, which copies the agent's first prompt.

## Review the branch and tell the agent

**Review** opens on the branch's **Files**: every changed file and its diff. **Graph** (`g`)
shows the same change as a graph. The [review guide](review-and-ci.md) explains both pages and
the findings. To review:

1. On **Files**, read each file's diff. Click a line to comment on it.
2. On **Graph**, click a symbol to see its diff and who uses it. Press `r` to mark it reviewed.
   To comment on a symbol, select it and press `c`.
3. In the **Review** tab, pick **Approve**, **Request changes** or **Comment**, then click
   **Finish review**.

Symbiote writes your *verdict*, the decision and your comments, to
`symbiote/reviews/<branch>/<your git email>.json`. If you approved, there is nothing to tell the
agent: you merge next. If you requested changes or commented, click **Send to the agent**.
Symbiote types the verdict and the review file's path into the agent's terminal, and you send it
with Enter. The agent reads your comments from that file.

After the agent adds commits, review the branch again. Only what is new or changed since your last
review is left to look at.

## Merge

After you approve a branch, **Merge into** appears in the **Review** tab, under **Merge**, and on
the workspace's page. The target is the branch the workspace is reviewed against: the one it
started from, unless you picked another in **since**. You can pick another here too. Symbiote then:

1. merges the commit you approved, not any later one, in a worktree of its own, so neither your
   checkout nor the agent's worktree is used;
2. runs your project's check on the merge. The check is `merge.checks` in
   [`symbiote/config.json`](../reference/configuration.md), or a command Symbiote finds in the
   project, such as a `test` script in `package.json`;
3. lands the merge if the check passes: it moves the target branch forward to the merge commit.

Merges run one at a time, in the order you asked for them. Click one under **Merging** to see its
page: its steps on a card (approved, merge, check, land) with its place in the queue and its
time; the steps with who approved it, each check command's time against the last passing run, and
what a failure does; and the merge's log, its changes, and its conflicts when it has some. While it
waits its turn, **Take out of the queue** removes it. Symbiote does not push unless you set `merge.push` to `true`.

While its merge is in the queue, a workspace shows only under **Merging**. Once the merge fails,
the workspace is back in its own group, since its agent has the fix to make; **Send to the agent**
opens it. The branch's name on a merge's page links to its workspace.

### Merge commit or fast-forward

Beside the target, pick how the merge lands: **with a merge commit**, the default, or **by
fast-forward**. A fast-forward makes no new commit: the target moves to the commit you approved,
once the check has passed on that commit. It is offered only when the target has no commits the
branch lacks; otherwise the control says so.

If the target moves while a fast-forward waits its turn, the merge waits for you. Click **Merge
commit instead**, or bring the target into the branch and review it again. `merge.strategy` in
`symbiote/config.json` sets which one is picked first.

### When the check fails, or there is none

If the check fails, nothing lands, and the merge page shows the check's output. **Send to the
agent** gives the failure to the branch's agent, which says whether its branch caused it. If the
project has no check, the merge waits for you to click **Land**.

If the target branch is checked out in your own checkout, landing updates your files too. If that
would overwrite changes you have not committed, git refuses and nothing changes. The merge then
waits until you click **Land**.

### Conflicts and the merger

If the branch conflicts with the target, Symbiote gives the conflict to the *merger*, an agent
that proposes a resolution for each conflicting part. Nothing lands until you review it. The
merge page shows each resolved part. It marks in red the lines where either branch's change was
lost, and in amber the lines the merger wrote itself.

**Approve** lands the resolution, and **Request changes** asks the merger again with your words.
If the resolution's check failed, **Check again** runs the check again without asking the merger.
To give the merger your project's rules, such as "keep both entries of a changelog", write them
in [`symbiote/merge.md`](../reference/configuration.md#rules-for-the-merger-symbiotemergemd).

## Clean up

When a workspace is merged, it moves to **Done**. **Clean up** stops and removes the agent's
sessions, and removes the worktree, the documents and the branch. To remove a workspace that was
not merged, use **Clean up…** under **⋯**: Symbiote asks first and keeps the branch. Symbiote does
not clean up a workspace while its worktree has changes that are not committed.

### History

A cleaned-up workspace goes to **History** (`h`, under Monitor in the sidenav). History lists
them newest first, by the day they were cleaned up. Search them by title, branch or brief, or
show one kind of work.

Pick one to read it: its **Activity**, **Thread**, **Brief** and **Changes**, as its page showed
them, with nothing to answer or run. Its commits are still shown after its branch is deleted:
Symbiote finds them from the commit you approved, which the merge keeps. **Open the change** shows
those commits' files and graph, as comparing two commits in Git does. A workspace's old link
(`/?branch=…`) opens it in History.

## In Hive mode

With Hive mode on, Symbiote drives each workspace you start from its brief to landed, and answers
for you. The start page is then **New goal**: it offers only Claude Code, with no permission choice
and no **Plan first**, shows the check Hive will run, and says how Hive runs the goal. Its button
is **Start goal**. The sidenav's groups are **In flight**, **Stopped**, **Landed today** and
**Earlier**, and the workspace's **Run** tab shows what Hive did, round by round. The
[configuration reference](../reference/configuration.md#hive-mode) describes each step.
