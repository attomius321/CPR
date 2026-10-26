# SK1 — A skill library: skills kept outside the project, written and kept from Symbiote

[Index](../PLAN.md) · [Journal](../journal/sk1-skill-library.md)

**Status:** built, ready for review (2026-10-26), on branch `feature/skillbar-support` (the
workspace's), `main` (V59) merged in; the plan confirmed by the person with four answers: the place
is "a git repository, or a file path to a folder on the disk"; committing and pushing "should be a
setting"; using the skills from other projects "for later"; "One skill repository or folder!".

**Problem** (asked: "a way to create and maintain skills, but these will reside in another
repository"). Measured on `00d88e1`, Claude Code 2.1.310, Codex 0.163:

| What | Measured |
|---|---|
| What Symbiote can edit | The Skills page (V41) and Scribe know only the checkout's `.claude/skills` and `.agents/skills`: the server refuses any other path (`skillAt` in `packages/cli/src/skills.ts`), Scribe's gate any write outside `.claude/skills` (`scribe-gate.ts`) |
| The person's skills today | 103 entries in `~/.claude/skills` (68 `gsd-*`), 14 of them links into `~/.agents/skills`, copies `npx skills` made from one GitHub repository (`~/.agents/.skill-lock.json`). Symbiote shows none of them |
| Where tools look for a repository's skills | `npx skills` searches `skills/`, `.claude/skills/`, `.agents/skills/` and about 60 others, walking each container three levels deep; a Claude Code plugin keeps its skills in `skills/` |
| What agents read outside a project | Claude Code: `~/.claude/skills`, a linked skill folder followed, changes seen without a restart (its docs); `--add-dir` loads that folder's `.claude/skills`. Codex: `~/.agents/skills` (`codex debug prompt-input` listed `brandkit`, not `explain-code`, which is only in `~/.claude/skills`) |

**Goal**: one skill library on this machine: a folder of skills (`<folder>/<name>/SKILL.md`), a
plain folder or one in a git repository, set once in Settings. Every repository's Skills page
lists its skills beside the checkout's; the person checks, edits, adds and deletes them there,
Scribe writes them, and, when the setting says so, the page commits and pushes them.
**Unchanged** without a library: `/api/skills` answers what `main` answers, the Skills page and
Scribe are `main`'s; Settings lists one more entry.

## The library (SK1a)

- **What it is** (decision 426): one folder whose sub-folders are skills
  (`<folder>/<name>/SKILL.md`, the layout of the checkout's `.claude/skills`). It may be a plain
  folder, or inside a git repository at any depth (its root, or `skills/` in it); git is found
  from the folder (`git rev-parse --show-toplevel`). A git URL is cloned into a folder the person
  names (`GIT_TERMINAL_PROMPT=0`, SSH in batch mode, so a clone never waits for a password); the
  library is then the clone's `skills/` when it has one, else its root. A folder that does not
  exist is made when the person asks (Create), never on a typo.
- **Where it is set** (decision 427): Settings, a group **This machine** before **This browser**,
  its entry **Skill library**: the folder (or a URL and where to clone it), what is there (a plain
  folder; a git repository, its branch and remote; nothing yet), Commits (below), Save and Forget
  (Forget deletes nothing). Kept in Symbiote's config folder (`~/.config/symbiote/library.json`
  on Linux, beside `intro.json`), read at each request: every `symbiote view` on this machine
  shows the same library. Not in `symbiote/config.json`: a path on one machine.
- **Commits** (decision 428, the person: "This should be a setting"): `commits` in
  `library.json`, three choices:
  - **Leave git to me** (the default): Symbiote writes the files; the page shows the library's
    git state; the person commits.
  - **Commit**: Commit… on the Skills page lists the library's changes and takes a message; it
    commits only the library's folder (`git add -A -- <folder>`, then
    `git commit -- <folder>`): anything else staged in that repository stays staged.
  - **Commit and push**: Commit… then pushes; Push when the branch is ahead (a push that failed);
    Pull (`git pull --ff-only`). Push goes to the branch's upstream, else to `origin` with `-u`.
  - Never a force, a branch switch, a rebase or a stash; on no branch (detached), Commit is
    refused. Git's own words when it refuses (a hook, no identity, a diverged branch).
- **The server** (`packages/cli/src/library.ts`, `skills.ts`): `SkillsState` gains `library`
  (absent without one): the folder, whether it is there, its git state (repository root, branch,
  upstream, ahead and behind as git last knew them, the changed files under the folder), the
  commits setting. Its skills are listed after the checkout's, `folder: 'library'`, named
  `library/<name>/SKILL.md` on the page and in a change (decision 429); the server maps that
  under the folder, and refuses a skill folder whose real path is outside it, as for the
  checkout's. `save`, `new` (with `where: 'library'`) and `delete` work there as in the checkout,
  versions and 409s included. New actions: `library` (set: folder or URL, clone folder, create,
  commits), `forget`, `commit` (message), `push`, `pull`. A folder that is the checkout's own
  `.claude/skills` (or `.agents/skills`) is listed once, as the checkout's.
- **The Skills page**: a group **Library** under the checkout's (its folder, with `~` for the
  home), its skills in the same editor, checks, drafts, Ctrl+S and stale-save notice. Its first
  entry opens the library's pane: where it is, its git state, its changed skills, and Commit…,
  Push, Pull as the setting allows, with a link to Settings. New skill asks where: this
  checkout's `.claude/skills` or the library. Without a library, one line under the list says it
  can be set in Settings. In `symbiote-style`.

## Scribe writes there too (SK1b)

- **Both folders** (decision 430): one conversation per repository, as before. Its gate is given
  the checkout's `.claude/skills` and the library's folder: a write is allowed in a skill's folder
  of either, by real path; anything else refused as before. Claude Code starts with `--add-dir
  <library>`; Codex's confined thread gets the library as a writable root
  (`sandbox_workspace_write.writable_roots`). The library is read when a conversation starts: a
  library changed in Settings reaches the next conversation.
- **The prompt**: Scribe's text gains `{library}`, filled from a new prompt `library` (group
  Scribe, `{folder}` required), as a start prompt's `{documents}` is: the person keeps skills for
  every project in `{folder}`; write there when asked for a skill in the library, and keep there
  only what holds outside this checkout. Without a library, the line holding `{library}` goes
  with the blank line after it: Scribe's prompt is `main`'s. A project prompt without
  `{library}` still works.
- **The page**: Improve with Scribe on a library skill fills "Improve
  `<folder>/<name>`: "; Scribe's help names both folders. Scribe never commits.

## Verification

1. **Tests first** (red for the right reason):
   - `library.test.ts` (CLI): the record read and written (a missing, broken or foreign file reads
     as none); set to a plain folder, to a folder in a repository, to a missing folder (refused,
     then made with Create), to a URL (a local bare repository cloned; its `skills/` taken);
     git state (branch, upstream, ahead, changed); commit of only the folder with another staged
     file left staged; refused on no branch and with `none`; push to a bare remote, with and
     without an upstream; pull `--ff-only`, refused when diverged; forget.
   - `skills.test.ts`: without a library, the state as `main`'s (no `library` key); the library's
     skills listed after the checkout's; save, new, delete there; 409s; `library/../x`, a link
     out of the folder refused; the checkout's own folder as library listed once.
   - `scribe-gate.test.ts`: a write in a library skill's folder allowed, the library's root and
     a file beside it refused; Scribe's start arguments (`--add-dir`, Codex's writable root) with
     and without a library; `prompts.test.ts`: `library`, and Scribe's text `main`'s without one.
   - The viewer: the groups with a library, New skill's place, the commit's default message
     (`skills.test.ts`); Settings' entries (`settings.test.ts`).
   - e2e `skills.spec.ts` and `settings.spec.ts`, with temporary folders and a bare remote, the
     config folder the test's own (`XDG_CONFIG_HOME`): set a plain folder and a repository in
     Settings; list, edit, save, new, delete there; Commit and Commit and push; Pull; Forget; the
     narrow layout; no page errors.
2. **Nothing else changes**: every other unit and e2e test as on `main`; `serveWorkspaces` given
   a config folder of the test's, so no spec reads the person's library.
3. **Real agents**, in a throwaway clone of this branch and a throwaway library (never this
   checkout's `symbiote/`): Claude Code's Scribe writes a library skill, and its gate refuses the
   library's README; Codex's Scribe writes one, and its sandbox refuses a file outside; Commit
   and push to a real remote (a throwaway bare repository).
4. **Viewer**: `pnpm test:e2e`; `viewer-check` screenshots at 1440×900 and 390×844, dark and
   light: Settings' Skill library (empty, a plain folder, a repository), the Skills page with a
   library, its pane (nothing to commit, changes, Commit…), New skill's place; `/history` first
   paint against `main`'s build. No analysis code changes: no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| A commit in a repository nobody reviews in Symbiote | Off unless set; only the library's folder; Commit… lists what goes in and takes the person's message |
| A clone or a push waits for a password nobody sees | `GIT_TERMINAL_PROMPT=0` and SSH `BatchMode=yes`; a time limit; git's words shown |
| Scribe writes outside the two folders | The gate decides by real path, as in V41; Codex's sandbox has only the two folders writable |
| Tests read or write the person's own library | Every server the e2e harness starts has a config folder of the test's own; unit tests are given the file |
| Two `symbiote view`s change the library at once | Versions: a stale save is refused (409), as in the checkout; git refuses a second commit's lock |

**Order**: the record and the server (SK1a), Settings, the Skills page; then Scribe (SK1b); then
the real runs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| SK1a | The library | Settings' Skill library; the Skills page lists, edits, adds and deletes its skills, commits and pushes them as set |
| SK1b | Scribe in the library | Scribe writes skills in the library too; the prompt `library` |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 426 | What the library is | **One folder of skills (`<folder>/<name>/SKILL.md`): a plain folder, or one in a git repository; a URL cloned into a folder the person names** | The person: "a git repository, or a file path to a folder on the disk"; "One skill repository or folder!" |
| 427 | Where it is set and kept | **Settings → This machine → Skill library; `library.json` in Symbiote's config folder** | A path on one machine, the same for every repository there; `symbiote/config.json` is committed and shared |
| 428 | Who commits | **A setting: Leave git to me (default), Commit, Commit and push; only the library's folder; never a force** | The person: "This should be a setting"; as `merge.push`, nothing reaches a remote unless set |
| 429 | How a library skill is named | **`library/<name>/SKILL.md` on the page and in a change; the server maps it under the folder** | The page keys drafts and addresses by path; it cannot meet `.claude/skills/…` or `.agents/skills/…` |
| 430 | Scribe | **One conversation, both folders: the gate by real path, `--add-dir` for Claude Code, a writable root for Codex; `{library}` from the prompt `library`** | One agent for the person's skills; without a library its prompt and gate are `main`'s |

**Not in SK1 (later)**: using the library's skills from other projects and agents (links in
`~/.claude/skills` and `~/.agents/skills`, or a copy in a project's `.claude/skills`): the person,
"For later". Several libraries. The desktop app's folder dialog for the path. A skill's other files
edited on the page.

## As built (SK1)

- **Settings' first entry without prompts** (found by `settings.spec.ts`): with the Skill library
  listed before Appearance, a Settings page whose prompts cannot be read opened the library. The
  order of what opens first keeps Appearance first, as before; the list shows This machine, then
  This browser.
- **An address for a Settings entry**: the Skills page links to `/settings?prompt=skill-library`.
  The settings route takes `prompt` to make that address only; the route read back is Settings,
  and the page reads `?prompt=` as it did (`pages.ts`).
- **Every e2e server has a config folder of its own** (`XDG_CONFIG_HOME`, `e2e/symbiote.ts`): until
  now a spec's server read the person's own `~/.config/symbiote`; with a library set there, the
  Skills specs would have listed it. `serveWorkspaces` gives the folder to the test (`config`).
- **One line of actions in the library's pane** (seen in screenshots): Commit and Pull on one line,
  Change in Settings on another, read as two forms. The commit button submits its form from the
  pane's one line (`form="library-commit"`).
- **Settings' rows stacked on a phone** (seen in screenshots): at 390 px the Commits choices
  wrapped inside their buttons and ran over the note under them. Under 520 px each control goes
  under its name, as the effort stepper's does; a choice keeps its words on one line.
- **Scribe's gate follows the library at each wake**: its settings file is written at each start
  and wake (V41), so the gate takes the library set then; Claude Code's `--add-dir` and Codex's
  writable folder are the conversation's start's. The plan's "the next conversation" holds for
  both agents' own access.
- **Settings' back button** moved to its own module (`settings/BackToList.tsx`) for the new page.

**Results.** Tests first, red for the right reason: the library's server 16 (`library.test.ts`), the
skills service 8, the probe's route 1, Scribe's gate 2, Scribe's starts and `--add-dir` 4, the
prompts 4, the viewer's library helpers 8 (`library.test.ts`), and expectations added to the groups,
a new skill's place and the route; e2e `library.spec.ts` 7. Expected changes elsewhere: Settings
lists one more entry and group, Scribe's page one more prompt (`settings.spec.ts`); the prompts list
ends with `library` (`prompts.test.ts`). `pnpm check`: 1,842 tests in 131 files. e2e: 282 of 282
before `main` was merged in; with it merged in, 283 of 284: V55's done-card test
(`workspaces.spec.ts`) found its card 31 px lower between two reads once, then passed 5 of 5 alone
and in its spec's rerun (48 of 48).

| Run (throwaway checkout and library, real agents) | What happened |
|---|---|
| Codex's Scribe (0.163, its default model, low): "a short skill named reading-logs" in the library, then a line in the library repository's README | The skill written in the library's folder in 22 s (28 lines, its description 117 characters); the README write declined by Codex itself, from its instructions, without a try |
| Codex's Scribe, asked to run the two writes as commands | `printf … >> <library repo>/README.md`: exit 1, "Read-only file system"; `printf … > <library>/reading-logs/probe.txt`: exit 0. Its sandbox writes the library's folder and nothing beside it |
| Claude Code's Scribe | Not run: Claude Code refuses a folder it was never trusted in ("Workspace not trusted"), and its trust prompt is the person's to accept |
| Scribe's gate, built, run with the command Symbiote wrote in the checkout's `scribe-settings.json` | A Write in `<library>/tailing-logs/SKILL.md` and in `.claude/skills/x/SKILL.md`: no answer (Claude Code's own rules ask the person); the library repository's README and the checkout's README: denied, naming both folders |

`/history`, this branch's build and `main`'s alternated, 7 rounds each, medians: first paint 64
and 60 ms, first rows 131 and 133 ms. The viewer's main chunk: 798,885 bytes against 785,680
(+13.2 KB). Screenshots at 1440×900 and 390×844, dark and light: Settings' Skill library (empty,
a repository), the Skills page with a library (its pane with changes, a library skill, New skill's
place) and without one; no page error. Not verified: Claude Code's Scribe writing a library skill
for real (above); Windows and macOS paths; a clone or a push over SSH or HTTPS (the tests use local
bare repositories); a library on another file system than the checkout.
