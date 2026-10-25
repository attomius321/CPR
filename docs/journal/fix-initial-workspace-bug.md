# Journal: Fix — a workspace's agent is told its worktree and branch are ready

[Index](../JOURNAL.md)

## Fix — a workspace's agent is told its worktree and branch are ready (2026-10-25, branch `fix/initial-workspace-bug`)

Asked: "On initially created workspaces, sometimes, the agents does not know they are already in
the workspace, on the selected branch. Make the default prompts clearer about that."

**Learned**:
- **The start prompt said it once, quietly, against two louder instructions.** Its first line
  ended "This folder is a git worktree of its own with that branch checked out: work only here",
  with no path and nothing against making another.
  - Claude Code's background sessions (`--bg`, 2.1.310) are told, in the session's own
    instructions: "Before making any code changes, use the EnterWorktree tool … unless your cwd
    is already under `.claude/worktrees/`". Symbiote's worktrees are in
    `../<repo>.worktrees/<branch>` (decision 96), so the exception never matches. This
    workspace's own session was given that text. Claude Code does not enforce it in a linked
    worktree (V18 spike); only the instruction is wrong.
  - A project's workflow may give each piece of work a branch of its own: this repository's
    CLAUDE.md says `milestone/<id>-<slug>` and `fix/<slug>` from `main`, and an agent made a
    `milestone/` branch in a workspace on 2026-10-24.
- **The start prompt is the only time a workspace's agent is told where it is.** A verdict sent
  later names the branch but not the worktree, so the first start is where it matters, as the
  brief says.

**Fixed**: each kind's start prompt (`packages/cli/src/prompts.ts`) opens with: Symbiote has
already made its branch and its worktree; you are in that worktree now, `{worktree}`, with
`{branch}` (started from `{start}`) checked out; work only here; do not create another branch or
worktree or switch branches (`git checkout -b`, `git switch`, `git worktree add`, EnterWorktree),
even where the project's instructions or your tools say new work gets one: this branch is the one
the person reviews and merges. `{worktree}` is a new placeholder (optional), filled from the
record's `worktree` (`workspace-start.ts`) and listed on the Settings page. `symbiote/AGENTS.md`'s
Workspaces bullet says the same, for an agent that reads it first. README: the placeholder, and
step 6 of starting a workspace. A project's own start prompts are left as they are.

**Verification**: tests first, red for the right reason on `main`'s prompts: `workspacePrompt`
for each of the five kinds names the worktree's path, says the branch is checked out and says to
make no other branch or worktree (it found the old sentence); `AGENTS` holds the new bullet (it
found "Work only in its worktree, on its branch."). The 48 start prompts recorded before V28 are
compared with the new opening in place of the old sentence, as decision 171's sentence is.
`pnpm check`: 1,573 tests in 113 files; `pnpm build`.

Not verified: e2e. `workspaces.spec` and `settings.spec` failed every test here, each a click
waiting 60 s for an element to be visible and stable, while two other workspaces ran Playwright
on the machine (load 4.4); `settings.spec`'s first test failed the same way on `main` (278b3e7,
built in a worktree of its own). No viewer code changed; the e2e checks of the prompt read its
opening words, "You are starting a new <kind> in this repository", which stay.

Not verified: a real workspace started with the new prompt. Whether agents stop making a branch
or a worktree shows only on real runs, and the old behaviour was intermittent.

Not tried: `"worktree": {"bgIsolation": "none"}` in the workspace session's settings file, as
Scribe's has (decision 278). It might drop Claude Code's EnterWorktree instruction for these
sessions altogether, but it changes how the agent is started, and only a real `claude --bg` run
can show what it does to the session's instructions.
