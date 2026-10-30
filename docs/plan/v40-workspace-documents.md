# V40 — Documents for a workspace's agent

[Index](../PLAN.md) · [Journal](../journal/v40-workspace-documents.md)

**Status:** merged into `main` on 2026-10-24 (built 2026-10-23), on branch `feature/providing-documents-on-workspace-ceation`
(a workspace started in Symbiote, from `main` at `bf0e717`); the plan's choices answered by the
person. As built and results under "As built (V40)" below.

**Problem** (asked: "I need a way to provide you with images, documents, etc on workspace
creation … inside a defined folder … along with a way to guide the agent to that folder"). The
start page takes text only: a screenshot, a PDF or a sample file has to be put somewhere by hand
and its path typed into the brief. V36 attaches an image to a running agent's message, but only
an image and only once the agent runs. Measured before choosing where files go (a throwaway
worktree of this repository, journal "V40 spike"):

| Where | Measured |
|---|---|
| A folder in the worktree with its own `.gitignore` (`*`) | `git status` lists nothing of it; `git worktree remove` (Clean up) removes it |
| The same folder, the project's tools | `prettier --check .` flags 4 of 6 sample files there (`.json`, `.yaml`, `.js`, `.ts`); `eslint .` 2 errors, the repository's only 2: neither reads a nested `.gitignore` |
| `symbiote/` in the main checkout | Ignored by `symbiote/.gitignore` (V15); Claude Code is started with it as `--add-dir` (V18) |
| Codex 0.163 in its `workspace-write` sandbox, a file outside its worktree | `cat` reads it (exit 0); asked only to read it, the model answered "I can't access that file: it's outside the permitted workspace" without trying |

The person's choices: the files beside the workspace's record, not in the worktree ("as long as
the agent sees them"); no setting for the folder ("not needed anymore").

**Goal**: on the start page, files are chosen, dropped or pasted with the brief; once the branch
and worktree are made they are in `symbiote/documents/<branch>/`, and the agent's first prompt
names the folder and each file. **Unchanged**: a workspace started without files — its prompt is
byte for byte today's, nothing is written; the worktree's files.

## Where the files go (`packages/cli/src/workspaces.ts`)

- `<symbiote folder>/documents/<branch>/`, the branch's slashes as folders (as `reviews/`):
  `symbiote/documents/feature/x/` in the main checkout, or under Symbiote's cache when the
  workspaces are kept there (`place: 'cache'`). Both are what Claude Code gets as `--add-dir`; out
  of git by the folder's `.gitignore`; never in the worktree, so its checks and `git status` do
  not see them.
- A folder that already holds files when the workspace starts (a branch name used before, not
  cleaned up): the start is refused before the branch is made.
- Clean up removes the folder with the worktree; the record keeps the files' names.

## Getting them there (`server.ts`, `workspaces.ts`, types in `packages/core/src/workspaces.ts`)

- `POST /api/workspaces/documents { name, data }`: one file as base64, under the write rule
  (JSON, `x-symbiote`, same origin). Saved in Symbiote's cache, `<cache>/documents/<32 hex>` (folder
  0700, file 0600, as V36's images); answers `{ id, name, size }`, `name` made safe (below). Any
  kind of file, at most 20 MB (413 from `Content-Length` before the body is read, as V36). Files
  kept more than a week are removed when the next one is saved.
- `WorkspaceRequest.documents: { id, name }[]`: at most 20 files and 100 MB in all, every file
  still kept — all checked before the branch is made. After the worktree is made, each is moved
  into the workspace's folder under its name.
- Safe names: the last part of a path; control characters and `\ / : * ? " < > |` as `-`; no
  leading or trailing dots and spaces; at most 120 characters, the extension kept; empty is
  `document`; a name taken in the folder becomes `name (2).ext`.
- The record (`symbiote/workspaces/<branch>.json`) keeps `documents: [names]`, so starting its
  agent again tells it the same; `WorkspaceSummary.documents { folder, files }` for the page;
  `WorkspaceOptions.documents { folder, maxFiles, maxBytes, maxTotal }` for the start page, the
  folder with `<branch>` as `worktrees` has it.

## Telling the agent (`packages/cli/src/prompts.ts`, V28)

- A new placeholder `{documents}` in Symbiote's five start prompts, on a line after the brief. It
  becomes a new prompt, Settings → Workspaces → **Documents** (`prompts.documents`), when files
  were given; otherwise its line goes, and the prompt is today's. The new prompt's placeholders:
  `{folder}` (absolute) and `{files}` (one per line). Symbiote's text says the folder is outside
  the worktree and can be read (Codex's model, not told, did not try), that the files are part of
  the brief, and not to change them there.
- Each file is named in the prompt: an agent's search tools that honour `.gitignore` (ripgrep)
  skip `symbiote/`.
- A project's own start prompt without `{documents}`: the documents' text is added after it, so
  an agent given files is always told.
- `symbiote/AGENTS.md` (`prompts.reviews`): one line under Workspaces on the record's
  `documents` and their folder.

## The page (`packages/viewer/src/workspaces/`)

- Start a workspace: **Documents** (optional) in the brief's column after Done when: Choose
  files; files dropped anywhere on the page (a frame while they are dragged; a drop never opens
  the file in the window); a file or image pasted when the clipboard holds no text (text pastes
  as today, V36's rule). Each file is uploaded when added and listed with its name, size, its
  error and a remove button; Start waits for uploads. A line says where they will go. The draft
  (V24c) keeps them.
- A workspace's page lists its documents under the brief.

## This repository

- `symbiote/documents` in `.prettierignore` and `eslint.config.js`'s ignores: `pnpm check` run in
  the main checkout would otherwise check a `.json` or `.ts` the person gave (measured above). The
  README says so for other projects.

## Verification

1. **Tests first** (red before): `packages/cli/test/workspaces.test.ts` — files and their bytes
   in `symbiote/documents/<branch>/`, the record, the prompt naming the folder and each file; no
   documents: no folder and the prompt equal to today's; a missing upload, too many, too large,
   a folder holding files, all refused with no branch made; safe names and numbered duplicates;
   the agent started again; a project's prompt without `{documents}`; Clean up removes them.
   `prompts.test.ts` (the new prompt and placeholder), `server.test.ts` (the route: 403, 400, 413,
   the bytes saved, the name), the viewer's pure parts (which pasted or dropped items, sizes, the
   draft).
2. **e2e**: `start.spec` — choose, drop and paste files, remove one, an error shown; Start; the
   fake agent's prompt names them; the files in the folder; the workspace's page lists them. The
   other specs as before.
3. **Real agents** on a throwaway repository through `symbiote view`: Claude Code and Codex, each
   given a PNG and a PDF, asked what they show; read with no permission asked.
4. **Viewer**: screenshots at 1440×900, 1×, dark and light (the start page empty, with files,
   with an error, while dragging; a workspace's page), spacing measured on each.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`. No analysis code: no regression sets.

**Risks**

| Risk | Mitigation |
|---|---|
| An agent does not read files outside its worktree | The prompt says the folder can be read and names each file; checked with both real agents |
| A document committed by accident | Outside the worktree; `symbiote/` is out of git by its `.gitignore` (unless the person shares it, V15) |
| Large files | 20 MB each, 100 MB in all; moved, not copied twice |
| Uploads left behind (a draft never started) | Removed after a week; a start naming one refused with what to do |
| The main checkout's own checks see the files | This repository ignores the folder; the README says so |

**Order**: the server (tests, routes, the start), the prompts, then the page (tests, e2e), then
the real agents, screenshots, README.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V40 | Documents for a workspace's agent | `…/documents` and the start's `documents`; `symbiote/documents/<branch>/`; `prompts.documents` and `{documents}`; the start page's Documents; the workspace page's list; README. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 266 | Where the files go | **`symbiote/documents/<branch>/`, beside the record; no setting** | The person's choice. In the worktree the project's tools see them (Prettier 4 of 6 files, ESLint 2 errors); `symbiote/` is out of git already and is Claude Code's `--add-dir`; Codex's sandbox reads outside the worktree. |
| 267 | How the files reach `symbiote view` | **Each uploaded when added, kept in Symbiote's cache, moved at the start** | The draft keeps them like the rest of the form; Start stays one small request; a file too large is said at once. |
| 268 | How the agent is told | **`{documents}` in the start prompts, a prompt of its own; each file named; "you can read it" said; added after a project's prompt that lacks it** | Every text an agent is told is the project's to change (V28). Codex's model did not try a file outside its worktree when not told it could. Search tools skip ignored folders. |
| 269 | What and how much | **Any kind of file; 20 at most, 20 MB each, 100 MB in all** | "Images, documents, etc". 20 MB is V36's image limit. |
| 270 | After the work | **Clean up removes them; the record keeps their names** | They are copies, for this work; the worktree goes at the same time. |

**Not in V40 (later)**: adding files to a running workspace (V36 attaches images to its
terminal); documents for Scout; a setting for the folder (declined).

## As built (V40)

- **Documents in the run's column**, not after Done when. In the brief's column the empty field
  (56 px and its margin) took the start page, More open, 66 px past 1440 × 900, which V30a keeps
  without a scroll (it had 2 px to spare). The run's column ended at 444 px of 892: there it fits,
  with room for about a dozen files. On a phone the run is under the brief, as before.
- **Uploads kept per repository**, `<cache>/state/<repo>/uploads/` beside the start page's draft,
  not `<cache>/documents/`: with the records in the cache (no `user.email`), a workspace's
  documents are `<cache>/state/<repo>/documents/<branch>/`, the folder Claude Code is given as
  `--add-dir`.
- **Start waits for a file not added** too, not only for uploads: it is listed with why (larger
  than 20 MB, one file too many, more than 100 MB in all) until the person removes it, so the
  agent gets what the page lists.
- **A long name is cut in its row**: the screenshots showed the list wider than the 300 px
  column, the field's and the list's grids sizing their one track to the longest name.
- **Clean up also removes the folders left empty** above the branch's, up to `documents/`.
- `fileBase64` moved from `AgentTerminal.tsx` to `ui/http.ts`, shared with V36's images.

**Results.**

- **Tests first**, red for the right reason: 13 (the functions, fields and route missing); now
  `pnpm check` 1,323 tests in 97 files (`main` 1,307: 16 new). The e2e test passed first time;
  with the request's documents left out, it failed where it should (the prompt named none).
  Two tests were written after the code and passed first time: documents kept in the cache, and
  `isImageName`. e2e: 210 of 211 with the new Documents test; the one failure, `shell.spec`'s keyboard
  test, passed 5 of 5 alone (flaky on `main`, as the journal says). The first full run's other
  failures were this change's: Settings lists 16 entries, Tab reaches Documents' help and Add
  files, and the start page no longer fit 1440 × 900 (above).
- **Nothing changes without documents**: the 48 start prompts recorded before V28 are given
  byte for byte (`prompts.test.ts`); no folder is made; `symbiote/AGENTS.md` gains one line.
- **Real agents**, through `symbiote view` from this branch on a throwaway repository (the
  person's trusted spike folder), each given a 64 × 64 red PNG and a one-page PDF ("The code word
  is HERON.") through `…/documents` and the start, plan without, asked for the colour and the word:

  | Agent | Answer | Time | How it read them |
  |---|---|---|---|
  | Claude Code 2.1.309, Haiku 5.5 | "The square is **red**, and the code word in the PDF is **HERON**." | 14 s | Its Read tool on both files; no permission asked |
  | Codex 0.163, low effort | "The square is **red**, and the code word in the PDF is **HERON**." | 18 s | `rg --files` and `file` on the folder, the PNG decoded in Python, in its sandbox; no approval asked |

  Clean up removed both worktrees and `symbiote/documents/` (empty parents too); the records kept
  `["square.png", "brief.pdf"]`; no upload left; `git status` empty in the checkout.
- **Viewer**: screenshots at 1440 × 900, 1×, dark and light (the start page empty, with four files
  and one too large, while files are dragged; a workspace's Brief; Settings' Documents; a phone),
  no page errors. The main bundle 669,162 → 674,459 bytes (+5,297; +1,651 gzipped), the
  stylesheet 104,620 → 106,656 (+2,036).

Not verified: a drag from the system's file manager and a real clipboard (e2e dispatches the
events, as V36's); Symbiote's window on WSLg; Firefox and Safari; macOS and Windows, where an
upload moved across file systems takes the copy path (untested); a file of megabytes given to a
real agent (1.3 MB uploaded in the screenshots' run only).
