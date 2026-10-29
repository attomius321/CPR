# Journal: V80 — Scout reads the workspaces' worktrees

[Index](../JOURNAL.md) · [Plan](../plan/v80-scout-reads-worktrees.md)

## V80 spike — what opens a folder to Scout, and what git writes there (2026-10-29, branch `feature/scout-reads-worktrees`)

Measured in a scratch folder under the job's tmp, never the person's `symbiote/`: Claude Code
2.1.312 (`claude -p --model haiku --tools Read,Grep,Glob --permission-mode dontAsk` with a
PreToolUse hook from `--settings`), Codex 0.163 (`codex sandbox -c sandbox_mode="read-only"`), git
2.43 in a scratch repository with a linked worktree; this repository's records and worktrees read.

**Learned**:
- **A hook's `allow` opens a path in `dontAsk`**: four calls outside the cwd (two Reads, a Grep and
  a Glob with `path`) were all denied without the hook ("Permission to use Read has been denied
  because Claude Code is running in don't ask mode"), and ran when the hook answered `allow`. A
  Read the hook left alone stayed denied. So the gate can open each worktree at each call, from
  the records as they are, without `--add-dir`.
- **Read follows a symlink; Grep and Glob do not**: a link in the allowed folder to a file outside
  was read, because the spike's hook matched the path as written. A Grep and a Glob there skipped
  a linked folder. The gate must take the real path.
- **Node's `realpathSync` takes `..` before links**: `<dir>/link/../x.txt` gave `<dir>/x.txt`;
  the OS (and `realpathSync.native`) resolves `link/..` to the link target's parent. Scribe's gate
  refuses `..` before taking the real path; Scout's does the same.
- **Codex's Scout reads every folder already**: its `read-only` sandbox printed a file outside its
  cwd and ran `git -C <worktree> log`; writes failed in its cwd and outside ("Read-only file
  system", exit 2). Symbiote does not pass `writable` in read-only mode. Nothing to open for Codex.
- **git rewrites a worktree's index on `status` and `diff`**: after `touch` on two unchanged files,
  `git status`, `git diff`, `git diff HEAD` and `git diff --stat HEAD` each wrote the worktree's
  index; `--no-optional-locks` kept `status` from it, not `diff` (2 of 2 rounds). `diff-index -p
  HEAD`, `diff-index --stat HEAD`, `diff-files -p`, `ls-files --others`, `log`, `show` and `grep`
  wrote nothing, and `diff-index` did not list the touched files. A write there can meet the
  workspace agent's own `git add` on `index.lock`. Scout's `git diff` in the checkout does the
  same today.
- **The holder is not the workspaces**: `Symbiote.worktrees/` held 6 worktrees, one
  (`milestone-v75-suggested-settings`) with no open record; 103 records, 98 finished. git lists 30
  worktrees, 21 of them the analysis cache's. A workspace (`feature/mcp-suggest-settings`) was
  started while this was measured: a list read at Scout's start would have missed it.
- **IDs**: V77 and V78 (twice) are taken on other branches, decisions to 575; this took V79 and
  576–579 first, then V80 and 585–588 when `feature/workspaces-card-revamp` took V79 and 576–581,
  and `feature/mcp-suggest-settings` 582–584, while it was built.

## V80 — Scout reads the workspaces' worktrees (2026-10-29, branch `feature/scout-reads-worktrees`)

Built: Scout's gate opens each open workspace's worktree at each tool call: Read, Grep and Glob
there by real path, and git with `-C <worktree>`, `--no-optional-locks status` and `diff-index`;
`git diff` there refused. Its settings file gives the gate the checkout and the records. Codex
gets nothing new. The `workspace` tool names the worktree's folder; the prompt, the README and
`configuration.md` say what Scout reads. Decisions 585–588.

**Learned**:
- **IDs moved twice while this was built**: `feature/workspaces-card-revamp` took V79 and 576–581,
  `feature/mcp-suggest-settings` 582–584, and `main` merged V77 and V78. Renumbered V80, 585–588;
  `main` merged in with only the two index files in conflict, both sides appended. MC2 then
  changed Scout's prompt, its test, the MCP tools' table and the README's Scout entry beside V80:
  merged in again, both sides kept in each.
- **A hook's arguments are the safe way to change an old conversation's gate**: the gate is
  `dist/scout-hook.js`, which a build replaces under every running Scout. Without its arguments it
  answers as `main`'s, so a conversation whose settings file was written before V80 keeps
  `main`'s rules until Symbiote writes the file again at its next wake.
- **The checkout is answered first**: a Read there needs neither the records nor git, 21.8 ms
  against 20.9 for `main`'s gate; a path outside it costs about 9 ms more (103 records parsed,
  `git worktree list`).
- **The merger's e2e tests are timing-bound under a full run**: `merges.spec.ts:200` failed once
  in 340, `:373` once in 342 after the merge; each passed 5 of 5 alone. This change touches
  neither the merger nor the viewer.

**Verification**: tests first (49 of 53 new gate tests red on `main`'s gate, the 4 others guards;
Scout's start and worktree tests, the `workspace` tool's and the prompt's red). `pnpm check`:
2,324 tests in 164 files with `main` (V77, V78, MC2) merged in. e2e: the viewer's 339 of 340
before the first merge and 341 of 342 after it (above); with MC2 merged in, 342 of 342, the
nexus's 15 of 15.
The built hook on this machine's records; `claude -p` with Scout's tools, mode and the built
gate in a throwaway clone: 4 reads of a workspace's uncommitted work allowed, 4 refused, the
worktree's index unchanged.

Not verified: a real Scout conversation started by `symbiote view` (the throwaway clone is not
trusted in Claude Code yet); Codex's Scout in a conversation; Windows and macOS.

