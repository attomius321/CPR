# V80 — Scout reads the workspaces' worktrees

[Index](../PLAN.md) · [Journal](../journal/v80-scout-reads-worktrees.md)

**Status:** built, ready for review (2026-10-29), on branch `feature/scout-reads-worktrees` (the
workspace's), `main` (V77, V78, MC2) merged in; the plan confirmed by the person ("Do as you recommend.
Go"), the real run in a throwaway clone. Planned as V79 (576–579), renumbered when another branch
took them.

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
to read there); a Scout conversation whose settings file was written before V80 keeps `main`'s gate
until Symbiote writes the file again at its next wake.

## What is opened (decision 585)

- **An open workspace's worktree**: the `worktree` of a record in `symbiote/workspaces/` (or the
  cache's stand-in) without `finished`, that `git worktree list --porcelain` lists as a linked
  worktree of this repository. The main checkout is not one.
- **Decided by the gate at each tool call**, from the records as they are then. Not the folder
  holding the worktrees: a configured `workspaces.worktrees` may put it anywhere, and today it holds
  a worktree with no open workspace. Not a list read at the start: a workspace started during the
  conversation would be missed (one was, while this plan was written).
- **No `--add-dir`**: nothing is opened for the whole session, and nothing depends on a
  `--resume` keeping it.

## Claude Code: Read, Grep and Glob (decision 586)

- Scout's gate (`scout-gate.ts`) answers `allow` for Read (`file_path`), Grep and Glob (`path`)
  when the path is absolute, holds no `..`, and its real path (the nearest folder that exists,
  made real, as Scribe's gate does) is in an open workspace's worktree.
- Otherwise it gives no answer, and Claude Code's own rules decide as today: the checkout is read,
  anything else is denied in `dontAsk`. A path inside the checkout is answered without reading the
  records.
- The gate is given the checkout and the records folder as arguments in Scout's settings file
  (`gateArgs`), written at each start and wake. Without them (a file from before V80) it is
  `main`'s gate.

## The Bash gate: git in a worktree (decision 587)

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

## Codex (decision 588)

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
| V80 | Scout reads the workspaces' worktrees | The gate opens open workspaces' worktrees to Read, Grep, Glob and `git -C`; the prompt and the `workspace` tool say where |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 585 | What Scout reads beyond the checkout | **Open workspaces' worktrees: a record without `finished` whose folder git lists as this repository's worktree, decided at each tool call; no `--add-dir`, not the holder** | Measured: a hook's `allow` opens a path in `dontAsk`; the holder can be anywhere and holds a worktree of no open workspace; a list at start misses a workspace started later |
| 586 | How Claude Code's reads are opened | **The gate allows Read, Grep and Glob by real path (absolute, no `..`); Claude Code's rules elsewhere** | Read follows symlinks; Node's `realpathSync` takes `..` before links |
| 587 | git in a worktree | **`-C <worktree>`; `status` only with `--no-optional-locks`; `diff-index` for the patch; `diff` refused there; Scribe's gate unchanged** | Measured: `status` and `diff` rewrite a worktree's index, `diff-index` does not |
| 588 | Codex | **Nothing passed: read-only, no writable folder** | Its read-only sandbox reads every folder and writes none; Codex's `folders` would be writable |

**Not in V80 (later)**: finished workspaces' worktrees (gone at Clean up); a worktree made by hand
or by the analysis cache, which no record names.

## As built (V80)

- **One rule for Scout's git, here and in a worktree**: `diff-index` and `--no-optional-locks
  status` are Scout's in the checkout too, not only with `-C`; `git diff` is refused only with
  `-C`. Simpler to say in the prompt, and neither writes anything.
- **One real-path rule for both gates**: `realTarget` moved from `scribe-gate.ts` to
  `scout-gate.ts`, which Scribe's gate imports; Scribe's rule and tests are unchanged.
- **The gate says why it allows a read**: `Scout: a workspace's worktree` in Claude Code's
  permission log, beside `Scout: one of git's read commands`.
- **`git blame` in a worktree** was added to the forms checked against the index: it writes
  nothing, as `log`, `show`, `grep` and `ls-files` do.
- **Scout's prompt** names the two git forms and why not `git diff`: 2,472 characters, 2,980 with
  MC2's `suggest_settings` lines merged in (limit 8,000).

**Results.** Tests first: 49 of the 53 new gate tests failed on `main`'s gate, for the right reason
(`-C` and `--no-optional-locks` refused, no `openWorktrees`); the other 4 are guards that held
before and after (paths left to Claude Code, two shell refusals, Scribe's rule). Scout's start
test and its new worktree test, the `workspace` tool's and the prompt's tests failed too; the
Codex test is a guard, green before and after. `pnpm check`: 2,301 tests in 162 files before
`main` was merged in, 2,318 in 164 with V77 and V78, 2,324 with MC2. e2e: Scout's and the MCP
specs 13 of 13; the viewer's suite 339 of 340 before the first merge and 341 of 342 after it, each
time one merger test bound to timing (`merges.spec.ts:200`, then `:373`), each 5 of 5 alone; with
MC2 merged in, 342 of 342 and the nexus's 15 of 15.

| Run | What happened |
|---|---|
| The built hook, as Claude Code runs it, on this machine's 103 records | A Read and a Grep in two open workspaces' worktrees allowed; `milestone-v75-suggested-settings` (no open record), the holder, another project and the checkout: no answer; `git --no-optional-locks -C <wt> status` allowed; `git -C <wt> diff` and `-C` into the v75 folder denied. Without arguments: `main`'s answers |
| Its cost per call, medians of 20 | A Read in the checkout 21.8 ms (`main`'s gate 20.9); in a worktree 30.0 ms, elsewhere 31.1 ms: the records and `git worktree list` read |
| `claude -p` (Claude Code 2.1.312, haiku) with Scout's tools, `dontAsk` and the built gate, in a throwaway clone with one workspace | Allowed: Read of its uncommitted file, `git --no-optional-locks -C <wt> status --short` (` M README.md`, `?? WIP-NOTES.md`), `git -C <wt> diff-index -p HEAD` (the uncommitted line), a Grep there. Refused: a worktree with no record, a file outside, `git -C` into that worktree, `git -C <wt> diff`. The worktree's index unchanged |

Not verified: a real Scout conversation started by `symbiote view` (it needs the person to trust
the throwaway clone in Claude Code); Codex's Scout in a conversation (its read-only sandbox was
measured with `codex sandbox`); Windows and macOS paths.
