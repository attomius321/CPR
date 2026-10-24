# V43 — A changed file opens as its diff

[Index](../PLAN.md) · [Journal](../journal/v43-changed-file-diff.md)

**Status:** ready for review (2026-10-24), on branch `feature/agentic-terminal-view` (a workspace
started in Symbiote, from `main` at `ab9e352`); the plan OK'd by the person ("Ok"), with VS Code's
diff editor as what a click opens (their choice between it and a diff in Symbiote). As built and
results under "As built (V43)" below.

**Problem** (asked: "The list on the right with changes. When i click on it, it should open in the
diff so i can see the actual changes, not the current state of the file"). A workspace's changes
panel (V29d) lists the files its branch changes and those its worktree has not committed. A click
on one runs `code <worktree> --goto <file>:<line>:1` (decision 188): the file as it is now, at
its first change. What changed in it — the lines removed, what a line was before — is not shown,
and a deleted file is not a button at all. Measured on `main` (`ab9e352`):

| What | Measured |
|---|---|
| What a click opens | The worktree's file at its first change (`--goto`); a deleted file: nothing |
| The files of the last seven branches merged (five features, a fix, a refactor; `git diff --name-status -M` of each merge) | 311 files: 204 `.ts`/`.tsx`, **107 others (34 %)** — CSS, Markdown, JSON, images; 76 added, 1 deleted |
| What Review (Symbiote's own diff) shows of them | Symbols only: none of the 107, and nothing a worktree has not committed |
| VS Code 1.143.1's command line (`mainImpl.js`, read here) | A folder goes to the folders to open, the files to open; with `--diff` the first two files become a diff editor, in that folder's window — as `--goto` does today |
| A file at a commit (`git cat-file blob`, 31 KB) · a file against a commit (`git diff --quiet`) | 2 ms · 1–2 ms, warm |

**Goal**: a click on a file in the changes panel opens VS Code's diff editor of that file, the
change on one side and what was there before on the other, in the worktree's window. The diff
shows exactly what the row counts. **Unchanged**: the panel's lists and look, the head's Open in
VS Code (the worktree's folder), the terminal's paths (V38, at the line printed), Review.

## What each row compares

| Row | Left | Right |
|---|---|---|
| Files (the branch's, committed) | The file at the fork point (`changesBase`, as the panel's list); its path before a rename | The worktree's own file when it is what the tip has; else the file at the tip |
| Not committed | The file at the worktree's `HEAD`; its path before a staged rename | The worktree's file |
| A new file (added, untracked) | Empty | As above |
| A deleted file | As above | Empty |

- A side from a commit is a copy in Symbiote's cache, `state/<repo>/revisions/<sha>/<path>`: its
  own name and extension (VS Code colours it), read-only, written once per commit and path
  (written to a temporary name, then renamed). The bytes a checkout writes:
  `git cat-file --filters <sha>:<path>` in the worktree (its line endings, its LFS smudge), so the
  diff against the worktree's file shows no line-ending noise. A submodule as `git diff` shows
  it, `Subproject commit <sha>`. An empty side is an empty file at `revisions/empty/<path>`.
- The worktree's own file is the right side of a Files row when `git diff --quiet <tip> -- <path>`
  finds no difference (the usual case): it is editable there, with VS Code's language features.
  When it also has changes not committed, the right side is the tip's copy: those changes are the
  Not committed row's.
- The fork point and tip are read at the click, not from the list (up to 5 s old).
- Without a worktree (cleaned up), a Files row opens from the commits alone, in the repository's
  window; a Not committed row is refused (409, "its worktree is gone").

## Server (`packages/core/src/git/`, `packages/cli/src/workspaces.ts`, `editor.ts`, `server.ts`)

- Core: `gitBytes` (git's stdout as bytes) beside `git`; `fileForCheckout(repo, sha, path)`
  (`git ls-tree`, then `cat-file --filters`; null when the commit has no file there).
- `POST /api/workspaces/diff { branch, file, previousPath?, uncommitted? }` → `{}` once VS Code
  has it. Paths outside the worktree 400 (as `…/open`); a branch gone 409; a file in neither side
  409; VS Code failing 502 with its words; no editor 409.
- `vsCodeFolder`'s `at` gains `{ left, right }`: `code <folder> --diff <left> <right>`
  (`diffArgs`).
- `POST /api/workspaces/open` keeps opening the worktree's folder; its `file` (V29d's first
  change) goes, and core's `firstChangedLine` with it: nothing else calls them.

## Viewer (`packages/viewer/src/workspaces/ChangesPanel.tsx`, `changes.ts`)

- Every file row is a button, a deleted one too: "Open the changes to `<path>` in VS Code"; its
  hover's last words "Opens its changes in VS Code"; the head's status "Opened the changes to
  `<path>` in VS Code". A Not committed row sends `uncommitted: true`.
- Nothing else changes in the panel: its CSS, its rows' layout, its commits (still read only).

## Verification

1. **Tests first** (red before): core — `fileForCheckout` (a file, its bytes exactly, a binary
   file, none there, a folder, a submodule); CLI `workspaces.test.ts` — the two sides for each row
   of the table (a committed change; one with changes not committed too, the tip's copy; not
   committed; untracked; added; deleted, committed and not; renamed), a copy written once and
   read-only, a worktree gone, paths outside refused; `editor.test.ts` — `diffArgs` and
   `vsCodeFolder` with `{ left, right }`; `server.test.ts` — the route (405, 400, the answer);
   the viewer's `changes.test.ts` — the rows' words, a deleted file opening.
2. **e2e** (`changes.spec.ts`): a click on a Files row gives the fake VS Code
   `[worktree, --diff, <copy at the fork point>, <worktree>/half.ts]`, the copy with the fork
   point's content (empty for a new file); a Not committed row, `HEAD` against the worktree's
   file; a deleted file is a button and opens against an empty side; the status's words.
3. **Real VS Code**, once, on this machine (1.143.1 through WSL): a Files row and a Not committed
   row open as diffs in the worktree's window.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`; the panel's screenshot in both themes
   (`viewer-check`). No analysis change (core gains a git reader only): no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| A copy edited and saved, taken for the file | Read-only, in the cache; the right side is the worktree's own file whenever it can be |
| Copies pile up in the cache | Only for files clicked, a few KB each, once per commit and path; said in the results, not pruned |
| A smudge filter that fetches (LFS) on a click | What a checkout of that commit would do; only for the file clicked |
| VS Code titles both sides with one name (`a.ts ↔ a.ts`) | The hover gives each side's path; looked at with the real VS Code |
| macOS and Windows | `code --diff` is the same command line there; unit-tested only |

**Order**: core's reader; the endpoint and its sides; the editor's arguments; the panel; e2e;
the real VS Code; docs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V43 | A changed file opens as its diff | `fileForCheckout`, `POST /api/workspaces/diff` and its copies, `code --diff`, the panel's rows, e2e, README |

**Proposed decisions** (285 the person's):

| # | Question | Decision | Why |
|---|---|---|---|
| 285 | Where a changed file opens (revises 188) | **VS Code's diff editor, in the worktree's window** | The person's choice. A third of the files the last seven merges changed (107 of 311) have no symbol, and files not committed no commit: Symbiote's own diff would show neither |
| 286 | What the two sides are | **Exactly what the row counts: a Files row from the fork point to the tip, a Not committed row from `HEAD` to the worktree; a side with no file an empty one** | Precise beats complete: the `+a −r` beside the name is what opens |
| 287 | The right side of a Files row | **The worktree's own file when it is the tip's; else a read-only copy of the tip's** | Editable, with VS Code's features, in the usual case; never a change the row does not count |
| 288 | Where a commit's side is kept | **A read-only copy in Symbiote's cache, `state/<repo>/revisions/<sha>/<path>`, as a checkout writes it (`cat-file --filters`); not pruned** | `code --diff` takes files only; a commit's file never changes, so one copy serves every click |

**Not in V43 (later)**: a commit's own diff from its row; a diff inside Symbiote (the workspace's
page) for a machine without VS Code; another editor; pruning the cache's copies.

## As built (V43)

- **The tip's copy is written for every Files row**, even when the worktree's own file is the
  right side: it is how the server knows the tip has the file at all. Without it, an untracked file
  of the same name in the worktree (a deleted file written again) passes `git diff --quiet`, which
  ignores untracked files, and would be taken for the tip's. A click writes at most two copies.
- **`git`'s error handling is shared** by `git` and the new `gitBytes` (`failure` in `exec.ts`);
  `git show`, which `readFileAtRevision` uses, is unchanged.
- **`FolderAt`** (`editor.ts`) is what `vsCodeFolder` takes: a file at a line, or `{ left, right }`.
  The terminal's and the workspace service's `OpenFolder` use it.
- **What went**: `/api/workspaces/open`'s `file` and core's `firstChangedLine` (V29d's first
  change), nothing else calling them; `opensInEditor` in the viewer (every row opens).
- **VS Code draws the diff inline in a narrow editor**: in the real window the editor was about
  790 px beside its chat panel, and VS Code chose its inline view
  (`diffEditor.useInlineViewWhenSpaceIsLimited`). Its tab reads `a.ts ↔ a.ts`, with the left
  side's path in the cache beside it.

**Results.** Tests first, red for the right reason: core 3 (`fileForCheckout` and
`fileChangedSince` missing), CLI 3 (`openDiff` and `diffArgs` missing, the route a 405), viewer 1
(the hover's words); the new e2e test and the changed one, run with this spec on the plan's commit
(`c8416bc`), failed as they should (the rows' new names not found, a deleted row not a button).
The guard for a deleted file written again fails when the tip's check is dropped. `pnpm check`
1,383 tests. e2e 217 of 218: `shell.spec`'s keys test failed once and passed 6 of 6 alone, the race
`feature/workspaces-list-upgrades` fixes (`b447ce3`, 2 of 32 runs on `main`'s build too).

| What | Measured |
|---|---|
| The real VS Code 1.143.1 through WSL, `vsCodeFolder` from this build, a throwaway repository | A new window for the folder; its tab `a.ts ↔ a.ts`, the cache copy's path beside it, the added line marked, TypeScript colours on both sides; the window closed after |
| `code` through WSL | 1.8 s, as `--goto` |
| A click's git reads (`listRefs`, the fork point, two `cat-file --filters`, `diff --quiet`; a 100 KB file of this repository) | 19–22 ms, four rounds |
| The panel at 1440×900, dark and light | As before; the deleted row takes the others' hover; no page errors |

Graph JSON, layouts and the analysis are untouched: core gained git readers only (`flow.ts`, the
goldens and `symbiote diff` unchanged), so no `regression-check`.

Not verified: a click through the page with the real VS Code (the page to `code` is the e2e's,
with a fake `code`; `code` to VS Code was run directly); macOS and Windows (`code --diff` is the
same command line there; unit-tested only); an LFS repository's smudge; a real agent's workspace
(the fake agent only); VS Code's side-by-side view (the real window, being narrow, drew it inline).
