# V79 — Scout reads the workspaces' worktrees

[Index](../PLAN.md) · [Journal](../journal/v79-scout-reads-worktrees.md)

**Status:** planned (2026-10-29), on branch `feature/scout-reads-worktrees` (the workspace's); the
plan confirmed by the person ("Do as you recommend. Go"), the real run in a throwaway clone.

**Problem** (asked: "Scout can read the files of every workspace's worktree, its uncommitted
changes included, so it can look at an agent's work in progress and answer about it. Scout stays
read-only"). Today Scout reads only the checkout: in Claude Code's `dontAsk` mode its Read, Grep
and Glob are refused outside it, and its gate refuses `git -C`. It sees a worktree's uncommitted
work only as the `workspace` tool's paths and line counts. Measured on `b3e8c03`, Claude Code
2.1.312, Codex 0.163, git 2.43:

| What | Measured |
|---|---|
| Claude Code, `dontAsk`, Read/Grep/Glob outside the cwd | 4 of 4 denied; with a PreToolUse hook answering `allow`, 4 of 4 ran; a path the hook did not allow was still denied |
| Symlinks out of an allowed folder | Grep and Glob did not follow them; Read did (the spike's hook matched the path as written) |
| Node's `realpathSync('<wt>/link/../x')` | `..` taken before the link: another file than the OS opens; `realpathSync.native` gives the OS's |
| Codex's `read-only` sandbox (Scout's) | Reads any folder (a file outside its cwd, `git -C <worktree> log`); writes nothing, in its cwd or outside ("Read-only file system", exit 2); `writable` is not passed in read-only mode (`app-server.ts:563`) |
| git in a linked worktree whose files' stat data changed | `status`, `diff`, `diff HEAD` rewrite its index; `--no-optional-locks` stops it for `status`, not for `diff`; `diff-index -p HEAD`, `ls-files`, `log`, `show`, `grep` write nothing |
| This repository | 5 open workspace records, their worktrees in `Symbiote.worktrees/`; that folder also holds `milestone-v75-suggested-settings`, no open record; git lists 30 worktrees, 21 of them analysis caches in `~/.cache` |

**Goal**: in a new Scout conversation, Scout reads, searches and lists the files of every open
workspace's worktree, and sees its uncommitted changes through git, while it writes nothing,
anywhere. **Unchanged**: Scribe and the workspace agents' permissions; Codex's Scout (already able
to read there); a Scout conversation whose settings file was written before V79 keeps `main`'s gate
until Symbiote writes the file again at its next wake.

## What is opened (decision 576)

- **An open workspace's worktree**: the `worktree` of a record in `symbiote/workspaces/` (or the
  cache's stand-in) without `finished`, that `git worktree list --porcelain` lists as a linked
  worktree of this repository. The main checkout is not one.
- **Decided by the gate at each tool call**, from the records as they are then. Not the folder
  holding the worktrees: a configured `workspaces.worktrees` may put it anywhere, and today it holds
  a worktree with no open workspace. Not a list read at the start: a workspace started during the
  conversation would be missed (one was, while this plan was written).
- **No `--add-dir`**: nothing is opened for the whole session, and nothing depends on a
  `--resume` keeping it.

## Claude Code: Read, Grep and Glob (decision 577)

- Scout's gate (`scout-gate.ts`) answers `allow` for Read (`file_path`), Grep and Glob (`path`)
  when the path is absolute, holds no `..`, and its real path (the nearest folder that exists,
  made real, as Scribe's gate does) is in an open workspace's worktree.
- Otherwise it gives no answer, and Claude Code's own rules decide as today: the checkout is read,
  anything else is denied in `dontAsk`. A path inside the checkout is answered without reading the
  records.
- The gate is given the checkout and the records folder as arguments in Scout's settings file
  (`gateArgs`), written at each start and wake. Without them (a file from before V79) it is
  `main`'s gate.

## The Bash gate: git in a worktree (decision 578)

For Scout only: Scribe's gate calls `gitReadProblem` without worktrees and keeps `main`'s rule.

- `-C <folder>` once, before the command, beside `--no-pager`: absolute, no `..`, its real path in
  an open workspace's worktree. Relative, `~`, a second `-C` refused.
- `git --no-optional-locks status` (refused without the option) and `git diff-index` (`-p HEAD`,
  `--stat HEAD`): the uncommitted work, without writing the index; in the checkout too, so one
  rule holds where Scout reads.
- `git -C <worktree> diff` refused, naming `diff-index`: it rewrites that worktree's index, which
  its agent commits from. `git diff` in the checkout stays as it is.
- Every refusal of f51d03e kept: options that write, run a program or read a file outside after
  the command; the filters after a pipe.

## Codex (decision 579)

Nothing passed: Scout has no `folders`, its thread starts `readOnly` with `writable: []`, and its
sandbox reads the worktrees already. Its prompt says the same as Claude Code's.

## What Scout is told

- The `workspace` MCP tool answers `worktree: <folder>` when it exists, so Scout knows where to
  read; the `workspaces` list is unchanged.
- `prompts.scout`: Scout answers from the checkout and the workspaces' worktrees, by full path,
  nothing else on the machine; in a worktree, `git -C <folder>` with the forms above, and why not
  `git diff`. A project's own text keeps working: the gate decides what runs.
- Docs: the README's Scout entry, `docs/reference/configuration.md` ("Prompts cannot widen…"),
  `docs/reference/commands.md` (the `workspace` tool).

## Verification

1. **Tests first** (red for the right reason):
   - `scout-gate.test.ts`: `-C <worktree>` with `status --no-optional-locks`, `diff-index`, `log`,
     `ls-files --others`, a quoted folder with a space, a sub-folder accepted; `-C` to the
     checkout's parent, `/home`, the holder, a finished workspace's worktree, a folder git does not
     list, a symlink out, `..`, relative, `~`, two `-C`s, `-C <wt> diff`, `status` without the
     option refused; f51d03e's refusals with `-C <wt>` in front; without worktrees (Scribe), `-C`,
     `status` and `diff-index` refused as today. Read, Grep and Glob allowed in an open worktree,
     no answer for the checkout, the holder, a finished or unlisted worktree, `/etc`, a symlink
     out, `..`, a relative path, no path. Real git: each allowed `-C` form leaves a stale
     worktree's index as it was; `diff` changes it.
   - `scout.test.ts`: Scout's start passes no `addDirs`, its gate the checkout and the records
     folder; Codex's start read-only with no writable folder.
   - `mcp.test.ts`: `workspace` gives `worktree`; `prompts.test.ts`: Scout's text.
2. **Nothing else changes**: Scribe's gate and start as on `main`; every other test as before.
3. **Real runs**: the built hook run as Claude Code runs it on this machine's records (read only),
   with its time per call; `claude -p` with Scout's tools, `dontAsk` and the built gate in a
   scratch clone; a real Scout conversation started by this branch's `symbiote view` in a
   throwaway clone the person trusted: a worktree's file read, one outside refused.
4. `pnpm check`, `pnpm build`, the e2e Scout spec (its settings file changes). No analysis change:
   no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| A record or `.git/worktrees` edited to point elsewhere | Both must agree; a workspace agent (same user) could edit both, so this guards against mistakes and stale records, not against it |
| Scout's git writes a worktree's index while its agent commits | `diff` refused there; `status` only with `--no-optional-locks`; a real-git test of every form |
| The hook slows every tool call | Records and git read only for a path outside the checkout; timed |
| Programs git runs from config (`core.fsmonitor`, `diff.external`, textconv) | The worktrees share the checkout's config: Scout's git runs them in the checkout already; unchanged |
| V78 (`feature/remove-scout-in-page-settings`) edits `scout.ts` and `prompts.ts` | Small conflicts, resolved at merge |

**Order**: the gate and its tests, then Scout's start and the MCP tool, the prompt and docs, then
the real runs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V79 | Scout reads the workspaces' worktrees | The gate opens open workspaces' worktrees to Read, Grep, Glob and `git -C`; the prompt and the `workspace` tool say where |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 576 | What Scout reads beyond the checkout | **Open workspaces' worktrees: a record without `finished` whose folder git lists as this repository's worktree, decided at each tool call; no `--add-dir`, not the holder** | Measured: a hook's `allow` opens a path in `dontAsk`; the holder can be anywhere and holds a worktree of no open workspace; a list at start misses a workspace started later |
| 577 | How Claude Code's reads are opened | **The gate allows Read, Grep and Glob by real path (absolute, no `..`); Claude Code's rules elsewhere** | Read follows symlinks; Node's `realpathSync` takes `..` before links |
| 578 | git in a worktree | **`-C <worktree>`; `status` only with `--no-optional-locks`; `diff-index` for the patch; `diff` refused there; Scribe's gate unchanged** | Measured: `status` and `diff` rewrite a worktree's index, `diff-index` does not |
| 579 | Codex | **Nothing passed: read-only, no writable folder** | Its read-only sandbox reads every folder and writes none; Codex's `folders` would be writable |

**Not in V79 (later)**: finished workspaces' worktrees (gone at Clean up); a worktree made by hand
or by the analysis cache, which no record names.
