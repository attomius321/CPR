# Journal: V12 — Open in VS Code

[Index](../JOURNAL.md) · [Plan](../plan/v12-open-in-vscode.md)

## V12 spike — opening VS Code from the viewer (2026-10-13, branch `milestone/v12-open-in-vscode`)

Measured before planning "open in VS Code" from the diff panel. **Which line**: for the last
60–68 first-parent commits of Symbiote, ky and zod, each reviewed as `c^1..c` with the working copy at
the branch tip, 1–62 % of the added lines of code files sat at another line number at the tip
(Symbiote 29–46 %, ky 23–62 %, zod 1–26 % by distance), and up to 23 % had been changed since (ky
6–20 commits back). Head's number is right only for the checked-out commit, so the server maps
it, with `git diff -U0 <commit> -- <file>` against the working copy (under 10 ms on a
3,195-line file). **Which window**: `code <folder> -g <file>:<line>` returned in 50 ms here
(WSL, VS Code 1.141 on Windows), and the window that had the folder got the file (`code
--status`: one window before and after). `launch-editor`, the usual package for this, runs
`code -r -g`: the last active window, whatever project it shows, so it cannot do what was asked.
**Windows**: `code.cmd` runs `Code.exe` with a `cli.js` under a folder named for the build, which
changes with each update, and Node refuses to start a `.cmd` without a shell; the plan reads
`code.cmd` to run what it runs. The user wants it on every platform: running VS Code from the
server, where the files are, needs no case for WSL, SSH or containers, unlike a `vscode://` link
from the browser.

## V12 — Open in VS Code (2026-10-13, branch `milestone/v12-open-in-vscode`)

"Open in VS Code" beside the panel's file line (or `o`), Ctrl/⌘+click on a row, or a click on a
line number opens that line in VS Code: in the window that has the repository open, else a new
one with it, at the line's place in the working copy. The server maps the line with `git diff
<commit> -- <file>` and runs `code <repo root> --goto <file>:<line>:<col>`.

**Learned**:
- Git pathspecs are globs: `git diff <sha> -- 'src/[id].ts'` also matched `src/i.ts` and
  `src/d.ts`, and their edits moved `[id].ts`'s lines. A path from a graph handed to git as a
  pathspec needs `--literal-pathspecs` (Qwik routes use `[param]` folders).
- A command that may start a long-lived process (VS Code) must be awaited on `exit`, not
  `close`: the process it starts can inherit and hold the stderr pipe.
- A button inside the file line changed the text two existing specs read (the path); beside it,
  nothing else changed. Text assertions on a container break when controls are added to it.
- `scripts/viewer/measure.mjs` serves graphs with `?graph=`, where no server can open files, so
  the controls never show there; the cost was measured with a short script against a real `symbiote
  view` of each build instead.
- Under `symbiote view` the code rows had no click action (picking a comment line is `symbiote pr`'s), so
  Ctrl/⌘+click means the same in both, and a plain click keeps its meaning under `symbiote pr`.
- The first "Open in VS Code" was link-styled 12 px text beside the path, and the user did not
  see it. An action the reviewer is meant to find needs to look like a button (now outlined, in
  the accent colour, with an icon and its key). At the same time the user had "This commit"
  removed from every commits row: picking one commit and Compare already does it.

**Verification**: tests first — `mapLine` (insertions, removals, replacements, the file's start
and end), `workingLine` on temp repositories (uncommitted edits, a later commit, deleted and
renamed files, a `[id]` path, a bad SHA), `findVsCode` with injected platforms (PATH, PATHEXT,
VS Code 1.141's and the older `code.cmd`, an unknown `code.cmd`, the macOS bundle, `SYMBIOTE_CODE`),
the `cmd.exe` quoting and its refusals, `runVsCode` with a stand-in (arguments, failure,
a command that keeps running, a missing command), `vsCodeOpener` on a temp repository, the
endpoint (each side's commit, 404 and 502, refusals), the viewer's `src/open.ts`. E2E with a
stand-in for VS Code (`SYMBIOTE_CODE`): 5 under `symbiote view`, 1 under `symbiote pr`. 557 unit tests, 59 e2e.
On this machine (WSL, VS Code 1.141 on Windows): a function at line 449 of `24396ab` opened at
480 in the working copy, 105 ms, in the existing window. Selecting a 300-row symbol: 31–37 ms
median on `main`, 33–34 ms with V12. Not verified: native Windows and macOS, a repository not
open in VS Code, Remote SSH and dev containers.

Merged into main (2026-10-13), with the button made visible and "This commit" removed from the
commits rows at the user's request. `main` verified after the merge: 557 unit tests, build, 59
e2e.
