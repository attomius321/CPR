# Journal: V43 — A changed file opens as its diff

[Index](../JOURNAL.md) · [Plan](../plan/v43-changed-file-diff.md)

## V43 spike — what a changed file can open as (2026-10-24, branch `feature/agentic-terminal-view`)

Asked: "The list on the right with changes. When i click on it, it should open in the diff so i
can see the actual changes, not the current state of the file". Read on `main` (`ab9e352`): the
changes panel (V29d) and its `POST /api/workspaces/open`, Review's graph, VS Code 1.143.1's
command line as installed here (its `mainImpl.js`), and the last seven merges' files.

**Learned**:
- **A click opens the file, not its change**: `code <worktree> --goto <file>:<first change>:1`
  (decision 188). A deleted file is not a button.
- **Symbiote's own diff could not show most of it**: Review is a graph of symbols. Of the 311 files
  the last seven merges changed, 107 (34 %) are CSS, Markdown, JSON or images, with no symbol; a
  file not committed is in no commit. The person chose VS Code's diff editor.
- **`code <folder> --diff <a> <b>` opens in that folder's window**: VS Code sorts what it is given
  into folders and files before `--diff` takes the first two files, as `--goto` relies on. It takes
  files only, no `git:` address: a commit's side must be a file on disk.
- **A commit's side as a checkout writes it**: `git cat-file --filters <sha>:<path>` applies the
  worktree's line endings and smudge filters (LFS), so a diff against the worktree's file shows
  only the change. `git show`, which `readFileAtRevision` uses, gives the blob decoded as UTF-8:
  not byte-exact for a binary file.
- **Cheap**: a file at a commit 2 ms, a file against the tip (`git diff --quiet`) 1–2 ms, warm.

## V43 — a changed file opens as its diff (2026-10-24, branch `feature/agentic-terminal-view`)

A click on a file in a workspace's changes panel opens VS Code's diff editor of that file, in the
worktree's window, exactly what its row counts: a Files row from the fork point to the tip (the
worktree's own file when it is the tip's), a Not committed row from the worktree's `HEAD` to the
file on disk, an empty side for a file added or deleted. A commit's side is a read-only copy in the
cache (`state/<repo>/revisions/<sha>/<path>`), as a checkout writes it. Deleted files are buttons
too.

**Learned**:
- **Whether the tip has the file is its own question**: `git diff --quiet <tip> -- <path>` says
  nothing for a file git does not track, so a deleted file written again in the worktree would have
  passed for the tip's. The tip's copy is read first; a guard test fails without it.
- **VS Code's diff tab names both sides alike** (`a.ts ↔ a.ts`), the left side's path beside it,
  and draws the diff inline when the editor is narrow (about 790 px beside its chat panel here).
- **The cost is VS Code's**: `code` through WSL 1.8 s, as `--goto` before; the git reads of a
  click about 20 ms on a 100 KB file of this repository (four rounds: 19–22 ms).

**Verification**: tests first, red for the right reason — core 3 (`fileForCheckout` and
`fileChangedSince` missing), CLI 3 (`openDiff`, `diffArgs` missing; the route a 405), viewer 1
(the hover's words); the two e2e tests on the plan's commit (`c8416bc`) with this spec: the rows'
new names not found, a deleted row not a button. The guard for a deleted file written again
fails without the tip's check. `pnpm check` 1,383 tests; e2e 217 of 218, `shell.spec`'s keys
test failing once (6 of 6 alone; the race `feature/workspaces-list-upgrades` fixes). The real VS
Code 1.143.1 through WSL, given `code <folder> --diff <copy> <file>` by this build's
`vsCodeFolder`: the diff in that folder's window. Screenshots of the panel, dark and light: as
before. Not verified: a click through the page with the real VS Code (e2e's `code` is a fake);
macOS and Windows; an LFS repository; a real agent's workspace.
