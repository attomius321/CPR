# Journal: V40 — Documents for a workspace's agent

[Index](../JOURNAL.md) · [Plan](../plan/v40-workspace-documents.md)

## V40 spike — where a workspace's documents can go (2026-10-23, branch `feature/providing-documents-on-workspace-ceation`)

Asked: "I need a way to provide you with images, documents, etc on workspace creation", put in a
folder after the worktree and branch are made, and the agent guided there. Measured in a
throwaway detached worktree of this repository (`node_modules` linked from the main checkout),
with six sample files (`.md`, `.json`, `.ts`, `.js`, `.yaml`, `.png`) in a folder holding a
`.gitignore` of `*`; then Codex 0.163 in a throwaway repository.

**Learned**:
- **A folder's own `.gitignore` keeps git out, not the project's tools.** `git status` listed
  nothing of it, and `git worktree remove` (Clean up) removed it without `--force`. But Prettier
  3 reads only the root's `.gitignore` and `.prettierignore`: `prettier --check .` flagged the
  `.json`, `.yaml`, `.js` and `.ts` (the `.md` is in this repository's `.prettierignore`, the
  `.png` has no parser). ESLint's flat config ignores no dot-folder: `eslint .` gave 2 errors
  there, the repository's only ones (an unused variable; a `.ts` "not found by the project
  service"). A JSON the person gives would fail an agent's `pnpm check` in its worktree. `tsc -p`
  listed none of them (its `include`s).
- **Codex's sandbox reads outside the worktree; its model does not assume so.** Asked to read a
  file in another folder and give the word in it, Codex 0.163 (`workspace-write`, low effort)
  answered "I can't access that file: it's outside the permitted workspace" and ran nothing.
  Asked to run `cat` on it, the command exited 0 with the file's text. The prompt must say the
  folder can be read.
- **`symbiote/` already fits**: out of git by `symbiote/.gitignore` (`*`, `!config.json`,
  `!merge.md`), and Claude Code is started with it as `--add-dir`. `prettier --check symbiote` in
  the main checkout passes today: Symbiote's own JSON is written as Prettier would.
- The merger's checks run in its own worktree, not the main checkout: a document there never
  reaches them.

The person chose the files beside the record ("Make the alternative as long as the agent see
them") and no setting for the folder. Cleaned up: the worktree, the Codex repository.

## V40 — documents for a workspace's agent (2026-10-23, branch `feature/providing-documents-on-workspace-ceation`)

Asked: "a way to provide you with images, documents, etc on workspace creation", and "a way to
guide the agent to that folder". Planned on the spike's measurements; the person chose the files
beside the record, not in the worktree, and no setting for the folder. Start a workspace takes
files (Add files, a drop anywhere on the page, a pasted screenshot), each uploaded to Symbiote's
cache as it is added; the start moves them into `symbiote/documents/<branch>/` and the agent's
first prompt names the folder and each file.

**Learned**:
- **The start page had 2 px to spare** at 1440 × 900 with More open (V30a's goal): any field in
  the brief's column scrolls it. The run's column had 448 px free; Documents went there.
- **A grid's implicit track grows to its longest item**: a long file name widened the list past
  its 300 px column, in a field (`.workspace-field`, a grid) that never held anything wider than
  an input before. `grid-template-columns: minmax(0, 1fr)` on the field and on the list.
- **Both agents read the folder outside their worktree when the prompt says they can**: Claude
  Code with its Read tool (the folder is its `--add-dir`), Codex with shell commands in its
  sandbox. In the spike Codex's model, not told, refused without trying.
- **A screenshot taken in the frame a tab switches** shows the old tab selected: the tabs fade
  their background in 150 ms. Read 500 ms later, the Brief tab was the selected one.
- One upload at a time keeps one file's base64 in memory; a file over 20 MB is refused in the
  page before it is read, as V36's images.

**Verification**: tests first (13 red: functions, fields and the route missing), `pnpm check`
1,323 tests; e2e 210 of 211 (`shell.spec`'s keyboard test, flaky on `main`,
5 of 5 alone); the e2e test red with the request's documents left out. Real Claude
Code (Haiku 5.5) and Codex (low effort) each named the PNG's colour and the PDF's word, 14 and 18
s after the start, no permission asked. Screenshots dark and light at 1×. The main bundle +5,297 bytes (+1,651 gzipped), the stylesheet +2,036.

Cleaned up: both workspaces (Clean up, through the API), the repository and its worktrees'
folder, Symbiote's cache for the run, Claude Code's records of the worktree (`claude purge`),
and the trust entry Codex wrote for the repository (its configuration restored as it was). The
spike folder's own Claude Code records and trust entry were left as they were, as V18c left them.

Not verified: a drag from the system's file manager or a real clipboard; Symbiote's window on
WSLg; Firefox, Safari; macOS and Windows (an upload moved across file systems copies, untested).
