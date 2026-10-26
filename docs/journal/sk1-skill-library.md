# Journal: SK1 — A skill library: skills kept outside the project, written and kept from Symbiote

[Index](../JOURNAL.md) · [Plan](../plan/sk1-skill-library.md)

## SK1 spike — where skills from another repository live today, and what reads them (2026-10-26, branch `feature/skillbar-support`)

Asked: "a way to create and maintain skills, but these will reside in another repository". Read
the Skills page and Scribe (V41, V56), the `npx skills` documentation and Claude Code's skills
documentation; looked at this machine's skills; probed Codex 0.163 with `codex debug
prompt-input` in an empty repository.

**Learned**:
- **Skills from other repositories arrive as copies today**: 14 of the 103 entries in
  `~/.claude/skills` are links into `~/.agents/skills`, where `npx skills` copied them from one
  GitHub repository and recorded each one's source and hash (`~/.agents/.skill-lock.json`).
  Symbiote shows none of them.
- **Codex reads `~/.agents/skills` and not `~/.claude/skills`**: `brandkit` (in both, through the
  link) was listed, `explain-code` (only in `~/.claude/skills`) was not.
- **Claude Code follows a linked skill folder and watches it** (its documentation): a library's
  skill linked from `~/.claude/skills` would reach every project without a copy. Left for later,
  as the person asked.
- **"skillbar" is not a repository yet**: none under `attomius321` on GitHub (SSH, "Repository
  not found"). The person: the place may be a git repository or a plain folder.
- **IDs**: `feature/scout-waiting-for-you`, started from the same `main` two minutes after this
  workspace, took V59 and decisions 422–425 while this plan was written; SK1 takes 426–430.

Decided with the person: a plain folder or a git repository, one only; committing and pushing a
setting; using the skills from other projects later. Plan: [SK1](../plan/sk1-skill-library.md).

## SK1 — a skill library on the Skills page and for Scribe (2026-10-26, branch `feature/skillbar-support`)

Built: a skill library, one folder of skills outside the checkout (a plain folder or one in a git
repository, a URL cloned), set in Settings (This machine, Skill library) and kept in Symbiote's
config folder; every repository's Skills page lists, edits, adds and deletes its skills, and
commits, pushes and pulls them as Settings says; Scribe writes there too. Decisions 426–430.

**Learned**:
- **`git commit -- <path>` keeps the rest of the index**: after `git add --all -- :/<library>`,
  `git commit -- :/<library>` committed the library's files and left a README staged by the person
  staged (`library.test.ts`). The library's commit cannot sweep in someone else's work.
- **A clone, a push or a pull must never wait for a password**: Symbiote's server has no terminal
  the person sees. `GIT_TERMINAL_PROMPT=0` covers HTTPS; SSH gets `BatchMode=yes` unless the
  person set their own SSH command for git; and a 2-minute limit.
- **Codex obeys its instructions before its sandbox**: told by Scribe's prompt that it writes only
  in skills' folders, it declined the library repository's README without a try. Asked to run the
  write as a command, its sandbox refused it ("Read-only file system", exit 1) and wrote in the
  library's folder (exit 0): `sandbox_workspace_write.writable_roots` works for a confined thread
  as for a workspace's.
- **e2e servers read the person's own config folder**: `XDG_CONFIG_HOME` was inherited, so a
  library set on this machine would have shown in every Skills spec. Every server now gets a
  folder of its own.
- **Two layout faults showed only in screenshots**: the pane's two lines of actions, and Settings'
  Commits choices wrapping inside their buttons at 390 px over the note under them. e2e found
  both pages correct.
- **Settings opened the new entry when the prompts could not be read**: the first of the entries
  opens then, and the library came before Appearance. Found by `settings.spec.ts`.
- **Claude Code's real run needs the person**: a folder Claude Code was never trusted in refuses
  `--bg` ("Workspace not trusted"); accepting that prompt for the person was not done. The gate
  was run as Claude Code runs it instead.
- **`main` moved during the work**: V59 merged with three lines at the end of `JOURNAL.md`, where
  SK1's spike line was; merged in, both kept. `feature/simpler-reviewe` took decisions 431–436
  after SK1's.

**Verification**: tests first, red for the right reason (CLI 35, viewer 8, e2e 7). `pnpm check`:
1,842 tests in 131 files. e2e: 282 of 282 before `main` was merged in; with it merged in, 283 of
284: V55's done-card test found its card 31 px lower between two reads once, then passed 5 of 5
alone and in its spec's rerun (48 of 48).
Codex's Scribe in a throwaway checkout and library: a skill written there in 22 s, the
repository's README beside the library refused by its sandbox. Scribe's built gate on four
writes: the two skills' folders passed to Claude Code's own rules, the two READMEs denied.
`/history` first paint 64 ms against `main`'s 60, first rows 131 against 133 (7 rounds,
alternated); the main chunk 13.2 KB larger. Screenshots of every new state at 1440×900 and
390×844, dark and light.

Not verified: Claude Code's Scribe writing a library skill; Windows and macOS; a clone or push
over SSH or HTTPS (local bare repositories only).
