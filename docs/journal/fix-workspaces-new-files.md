# Journal: Fix — a new file in a workspace's changes opens as it is

[Index](../JOURNAL.md)

## Fix — a new file opens as it is, not as a diff (2026-10-25, branch `fix/workspaces-new-files`)

Asked: "Workspaces New added files should not open vscode in diff mode, just the file as it
is..there is no need for a diff there". A click on a file in a workspace's Changes panel opens
what its row counts in VS Code (V43). A file with nothing before it — added on the branch, not
tracked, or new and staged — had an empty file in Symbiote's cache put in as its left side
(decision 286: "a side with no file an empty one"), so VS Code drew
`code <worktree> --diff <cache>/revisions/empty/<path> <file>`: every line green, beside an
empty pane.

**Cause**: `openDiff` (`packages/cli/src/workspaces.ts`) always asked for two sides. Now a file
with no left side opens alone, `code <worktree> <file>`: `vsCodeFolder`'s `FolderAt` gains
`{ path }`, one file by its own path. The file is the one the row counts, as before (decision
287): the worktree's own when it is the tip's, editable there; else the tip's read-only copy
(added on the branch, then changed without a commit). A deleted file is unchanged, a diff against
an empty side: the side that is gone is what says it was deleted. This revises decision 286 for
new files only. The panel's words are unchanged ("Open the changes to `<path>` in VS Code"): a new
file's changes are the whole file.

**Verification**: tests first, red for the right reason — the CLI's V43 test (an added file, one
added then changed without a commit, an untracked one, a staged one: each `--diff` against
`revisions/empty/…`), `editor.test.ts` (`vsCodeFolder` with `{ path }`: no such form, the call
fell through to `--goto` and threw), and `changes.spec.ts`'s first test (a click on the new
`half.ts` gave the fake `code` `[worktree, --diff, …/revisions/empty/half.ts, <worktree>/half.ts]`).
The CLI test also checks no empty copy is written for a new file. `pnpm check` 1,572 tests,
`pnpm build`, e2e 240 of 240.

Not verified: the real VS Code. `code <folder> <file>` puts the file in the folder's window as
`--goto` and `--diff` do (V43 read 1.143's `mainImpl.js`, and ran `--diff` with a file outside the
folder); this command line was run with the fake `code` only.
