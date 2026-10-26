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
