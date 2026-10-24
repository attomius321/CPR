# V12 — Open in VS Code

[Index](../PLAN.md) · [Journal](../journal/v12-open-in-vscode.md)

**Status:** merged into main (2026-10-13, from branch `milestone/v12-open-in-vscode`). As built
and results: "As built — V12" below.

**Problem** (asked: "is there a way to jump to vs code at a specific selected line from the file
from the diff?", then "i want it to work on any platform", and "i want it to open the project in
vs code … if there is already an opened instance of that project, reuse that vscode"). The diff
panel shows a symbol's lines; going to them in the editor means finding the file and the line by
hand. And the number shown is the commit's: when the working copy is not that commit, it is
often another line. Measured: the last 60–68 first-parent commits of each repository, each
reviewed as `c^1..c` with the working copy at the branch tip; where each added line of a code
file (`.ts`, `.tsx`, `.js`, …) is at the tip:

| Repo | Commits back | Added lines | Same line number | Moved (right after mapping) | Changed since |
|---|---|---|---|---|---|
| Symbiote | 1–5 | 5,648 | 60.0 % | 34.8 % | 5.2 % |
| Symbiote | 6–20 | 3,930 | 70.5 % | 28.5 % | 1.0 % |
| Symbiote | over 20 | 25,655 | 48.1 % | 46.2 % | 5.7 % |
| ky | 1–5 | 5,484 | 76.8 % | 23.0 % | 0.2 % |
| ky | 6–20 | 2,233 | 14.9 % | 61.9 % | 23.2 % |
| ky | over 20 | 8,491 | 25.9 % | 54.3 % | 19.8 % |
| zod | 1–5 | 98 | 94.9 % | 4.1 % | 1.0 % |
| zod | 6–20 | 213 | 91.5 % | 0.9 % | 7.5 % |
| zod | over 20 | 4,052 | 73.1 % | 26.2 % | 0.8 % |

The checked-out commit itself is right as is, unless the working copy has uncommitted edits.
`symbiote pr` of a pull request that is not checked out is like a commit some way back. What else
the plan rests on, measured on this machine (WSL, VS Code 1.141 on Windows):

- `code <folder> -g <file>:<line>` took 50 ms (3 runs). The window that had the folder open got
  the file: `code --status` listed one window before and after, its title then "README.md - Symbiote".
- `git diff -U0 <commit> -- <file>` (a commit against the working copy) took under 10 ms, on a
  3,195-line file 30 commits back.
- `launch-editor` 2.14.2 (Vite's "open in editor") runs `code -r -g <file>:<line>`: the last
  active window, whatever folder it has open. It never opens the project.
- VS Code's Windows `bin\code.cmd` runs `"%~dp0..\Code.exe"
  "%~dp0..\2a59476c9b\resources\app\out\cli.js" %*` with `ELECTRON_RUN_AS_NODE=1`; the folder is
  the commit's and changes with every update. Node refuses to start a `.cmd` without a shell
  (EINVAL since 18.20.2 and 20.12.2, CVE-2024-27980).

**Goal**: from the diff panel, open the symbol, or one of its lines, in VS Code: in the window
that has the repository open, else in a new window with the repository; at the line where that
code is in the working copy now, saying so when it moved or changed since. The same on Linux,
macOS, Windows, WSL, Remote SSH and dev containers: VS Code runs on the machine where `symbiote`
runs. Without a working copy (a graph opened with `?graph=`) nothing shows. The graph JSON does
not change.

## Running VS Code (cli)

- `openInVsCode(command, folder, file, line, column)` in `packages/cli/src/editor.ts` runs
  `<code> <folder> --goto <absolute file>:<line>:<column>`, without a shell, and waits for it to
  exit (10 s at most; the CLI returns once VS Code has the request). VS Code focuses a window
  whose folder is `folder` and opens the file there, or opens a new window with the folder.
  `folder` is the repository's root (`repo.root`: the worktree `symbiote` runs in, never Symbiote's cached
  worktrees).
- `findVsCode(env, platform, fs)` finds the command at the first open, and keeps it:
  1. `SYMBIOTE_CODE`, a path or a command: Insiders, VSCodium, Cursor or an unusual install (same
     flags).
  2. `code` on `PATH` (on Windows with `PATHEXT`: `code.cmd`). In a VS Code terminal (local, WSL,
     SSH, container) this is the CLI that talks to that terminal's window. In WSL outside VS Code
     it is Windows' `bin/code`, a script that handles WSL itself.
  3. The usual install places: macOS `/Applications/Visual Studio
     Code.app/Contents/Resources/app/bin/code` and the same under `~/Applications`; Windows
     `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd` and `%ProgramFiles%\Microsoft VS
     Code\bin\code.cmd`; Linux `/usr/share/code/bin/code` and `/snap/bin/code`.

  Not found: "VS Code's `code` command was not found: run 'Shell Command: Install 'code' command
  in PATH' in VS Code, or set SYMBIOTE_CODE".
- On Windows, `code.cmd` is read and what it runs is run: `Code.exe` with its `cli.js` and
  `ELECTRON_RUN_AS_NODE=1`, so no shell sees a path. A `code.cmd` of another shape goes through
  `cmd.exe /d /s /c` with every argument quoted, refused if a path holds `%`, `"`, `!` or a line
  break.
- A non-zero exit gives the CLI's stderr as the error (e.g. "Unable to connect to VS Code server"
  after the terminal's window was closed).

## Which line (cli)

- `workingLine(repo, sha, file, line)` runs `git diff -U0 --no-color --no-ext-diff --no-textconv
  <sha> -- <file>`: the side's commit against the working copy, uncommitted edits included. Its
  hunks give one of:
  - `exact`: the file is unchanged, or the line is outside every hunk: the line plus what was
    added and removed above it;
  - `nearest`: the line is inside a hunk (changed since, or removed): the hunk's first line in
    the working copy;
  - `missing`: the file is not in the working copy (deleted, renamed since, untracked, or a pull
    request's new file that is not checked out). Nothing opens; the answer says so.
- The pure part apart from git: `mapLine(hunks, line)`.
- The viewer names the side: `head` for a row with a head number (added and unchanged rows) and
  for a symbol with a head range; `base` for a removed row and a removed symbol. A removed line
  maps like a changed one: to where the removal is in the working copy (when the working copy is
  head, the line after it).

## Server

- `POST ./api/open { side, file, line, column? }`: a write like the others (same-origin JSON with
  `x-symbiote: 1`). `file` must be in `site.allowed[side]` (files the graph mentions); `line` and
  `column` positive integers. 200 `{ line, how: 'exact' | 'nearest', moved }`; 404 when the
  working copy lacks the file; 502 with the message when VS Code's command is missing or fails.
- The side's commit: the diff's pair under `symbiote view`, the analyzed revisions under `symbiote pr`.
- `/api/capabilities` gains `open: true` when the server has a working copy (`symbiote view`,
  `symbiote pr`). Whether `code` is found is not checked there: a click says how to fix it, a hidden
  button would not.

## Viewer

- The file line above the code gets an "Open in VS Code" button: the symbol's first line (head's
  range, else base's).
- On a row, Ctrl+click (⌘+click on macOS) opens at that row's line, and the line numbers are
  links that do the same. A plain click still picks the comment line.
- `o` opens the selected symbol at the picked comment line when there is one, else at its first
  line; it joins the keyboard help.
- After an open, a line under the file line for a few seconds: "Opened in VS Code at line 52",
  "… at line 52 (48 at head: moved in your working copy)", "Line 48 changed in your working
  copy: opened at line 60, where it was", or the error.
- Nothing shows without `capabilities.open` (older servers, `?graph=`).

## Verification

1. **Unit** (red first): `mapLine` — no hunks, lines added and removed above, a line inside a
   hunk, an insertion just before it, a pure removal, the last line. `workingLine` on temp
   repositories — the commit checked out, uncommitted edits above the line, a later commit
   checked out, a file deleted, renamed or untracked, a base line removed at head.
   `findVsCode` with an injected platform, environment and file system — `SYMBIOTE_CODE`, `PATH`,
   `PATHEXT`, the `code.cmd` of 1.141 (versioned folder) and of the older layout
   (`resources\app\out\cli.js`), the macOS bundle, not found; the Windows command line for a
   path with spaces, `&` and `%`. Server — `/api/open`'s refusals (another site, no header, a
   file not in the graph, a bad line), the command's arguments (a fake CLI), its failure as 502,
   `capabilities.open`.
2. **Nothing else changes**: goldens, every e2e spec, `symbiote diff` and `symbiote pr` tests. No analysis
   code changes, so no `regression-check` run.
3. **E2E**: `SYMBIOTE_CODE` set to a fake that writes its arguments to a file — the button, Ctrl+click
   on a row, `o` with a picked line; a fixture whose working copy moved the line (the note, the
   line passed); a removed symbol; no controls under `?graph=`; no page errors.
4. **Real**: on this machine (WSL, VS Code on Windows), `symbiote view` on Symbiote: the window with Symbiote
   gets the file (`code --status`: still one window); a repository not open in VS Code gets a
   new window (by hand, by the user). Native Windows and macOS cannot be run here (CI runs
   Ubuntu and macOS unit tests); asked of the user, and said so in the results.
5. **Cost**: from the click to the CLI's exit under 200 ms with VS Code running (git diff under
   10 ms, `code` 50 ms here).

**Risks**

| Risk | Mitigation |
|---|---|
| A page starts a program on the machine | Only VS Code's command, found by Symbiote, with a folder and a `file:line` the server makes from the graph's own files; a write like the others, which other sites cannot send; no shell (on Windows, `Code.exe` and `cli.js`, as `code.cmd` runs them). |
| The wrong line, silently | Lines mapped against the working copy through git; a changed line says so; a missing file opens nothing. |
| `code` missing or stale (macOS without the shell command; the IPC of a VS Code terminal closed since) | The usual install places; `SYMBIOTE_CODE`; VS Code's own error shown with the fix. |
| VS Code's Windows layout changes again | `code.cmd` is read, not the folder guessed; `cmd.exe` with strict quoting otherwise. |
| The user opens a subfolder or a `.code-workspace` | VS Code matches the exact folder: a second window opens for the root. Recorded; a setting for the folder later. |
| Windows and macOS not run here | Unit tests with injected platforms; CI on macOS; tried by hand by the user. |

**Order**: V12a (cli: `mapLine`, `workingLine`, `findVsCode`, `openInVsCode`, `POST ./api/open`),
then V12b (viewer), on one branch.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V12a | Open from the server | `editor.ts` (find and run VS Code), `workingLine` and `mapLine`, `POST ./api/open`, `capabilities.open`. |
| V12b | Open from the viewer | The file line's button, Ctrl/⌘+click and line-number links, `o`, the line after an open. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 60 | Who opens the editor | **The `symbiote` server runs VS Code's command; no `vscode://` link** | The server runs where the files are. A link opens on the browser's machine, needs another URL form for WSL, SSH and containers, and the browser asks before each one. |
| 61 | Which window | **`code <repo root> --goto <file>:<line>:<col>`: the window with that folder, else a new one with it** | Asked: "open the project … reuse that vscode". Measured: VS Code gave the file to the window with the folder; `launch-editor`'s `code -r -g` takes the last active window, whatever its project. |
| 62 | Which line | **Mapped to the working copy through `git diff <side's commit> -- <file>`; a changed line opens where it was, and says so** | Reviewing anything but the checked-out commit, 1–62 % of added lines sat at another line (Symbiote 29–46 %, ky 23–62 %, zod 1–26 %) and up to 23 % were changed since. |
| 63 | Other editors | **VS Code and its forks through `SYMBIOTE_CODE` (same flags); no others in V12** | Asked for VS Code; JetBrains and the rest take other flags and have no rule like VS Code's window per folder. |
| 64 | New dependencies | **None**: `git diff` maps lines, `node:child_process` runs VS Code | `launch-editor` does not open the project; the `diff` package would redo what git does. |

**Not in V12 (later)**: other editors (JetBrains, Sublime, Vim); a setting for the folder to open
(a subfolder, a `.code-workspace`); opening the commit's own version when the working copy lacks
the file (a read-only copy, or VS Code's git URIs); opening from graph nodes and the change list.

## As built — V12

- **Which line** lives in core, not the CLI: `mapLine` and `workingLine` in
  `src/git/working-line.ts`, next to `readFileAtRevision`. `git --literal-pathspecs` is needed:
  without it git reads a path like Qwik's `src/routes/[id]/index.tsx` as a glob, and edits of
  `i.ts` or `d.ts` moved its lines (a test maps line 3 to 1 without the flag).
- **Running VS Code** (`packages/cli/src/editor.ts`): as planned, plus: the run ends at the
  command's `exit`, not `close` (a VS Code it starts may keep the pipe open); off Windows it runs
  detached, so Ctrl+C on `symbiote` does not reach it; the command is found at the first open and
  looked up again after a failure.
- **Server**: `startViewServer`'s `open` option (`OpenRequest` → `OpenResult`); `symbiote view` and
  `symbiote pr` pass `vsCodeOpener(repo, env)`. A graph without a commit for the side (two folders
  compared) answers 404.
- **Viewer**: `src/open.ts` (pure: what a button, a row or a line number opens, the note; and the
  request). The button sits beside the file line, not in it: inside, its text became part of the
  path two specs read (projects, Angular 11). The button and `o` open the line picked for a
  comment when there is one (`symbiote pr`), else the symbol's first line. A line number opens its own
  side (unchanged rows have both); Ctrl/⌘+click opens the head line when the row has one, else
  the base line. Under `symbiote view` rows had no click action before (comments are `symbiote pr`'s), so
  Ctrl/⌘+click means the same in both. A note stays 8 s; an error stays until the next open.
- **The button** (asked after the first build: "make a nice button for Open in VS Code … so i
  can see it"): link-styled 12 px text at first, it went unseen. Now an outlined button in the
  accent colour, with an icon and its key (`o`), on the line under the file name.
- **"This commit" removed from the commits page** (asked at the same time): every row had it. One
  commit picked alone, then Compare (or `x`, Enter), compares it with its parent, as before.

**Results (V12)**: 557 unit tests (35 new: core 9, CLI 19, viewer 7), 59 e2e (6 new: the button,
Ctrl/⌘+click and a removed line's number, `o` after the working copy moved the line, a file the
working copy lacks, no controls under `?graph=`; under `symbiote pr`, a click still picks the comment
line while Ctrl/⌘+click and line numbers open, and `o` opens the picked line). On this machine
(WSL, VS Code 1.141 on Windows), `symbiote view 24396ab~1 24396ab`: `parseCheckoutTarget`, at line 449
in that commit, opened at 480, its place in the working copy, 105 ms from the request to the
answer, in the window that had Symbiote open (`code --status`: one window before and after). Selecting
`startViewServer` (300 rows, 559 line numbers as buttons): median 31–37 ms on `main`, 33–34 ms
with V12 (8 rounds per run, two runs each, back to back); the panel has 1,720 elements instead of
1,717. Not verified: native Windows and macOS, a repository not open in VS Code (a new window),
Remote SSH and dev containers.
