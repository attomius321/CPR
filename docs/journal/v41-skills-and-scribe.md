# Journal: V41 — Skills: the project's skills in Symbiote, and Scribe, an agent that writes them

[Index](../JOURNAL.md) · [Plan](../plan/v41-skills-and-scribe.md)

## V41 spike — what a skill is, and what each agent lets a skill writer do (2026-10-23, branch `feature/skill-creator`)

Asked: an agent that creates the project's skills, and editing or adding skills from Symbiote,
"research before that on how a skill should be created". Read: Anthropic's skill authoring best
practices, Claude Code's skills and permissions documentation, the agentskills.io specification,
Codex's skills documentation, and the two skill creators installed here (Anthropic's, synced from
the person's claude.ai account; Codex's, in `~/.codex/skills/.system/`). Probed in a throwaway
clone of this repository at `bf0e717`, Claude Code 2.1.309 (`haiku` for the probes), Codex 0.163.

**Learned**:
- **Codex does not read `.claude/skills/`.** `codex debug prompt-input` (the model's input, no
  model call) listed none of this repository's 6 skills; with `.agents/skills/viewer-check` a copy,
  that one; with `.agents/skills` a link to `../.claude/skills`, all 6, by their real path.
- **Claude Code's `dontAsk` refuses every Write**, whatever approves it: a PreToolUse hook
  answering `allow`, or an `Edit(<path>/**)` allow rule (a `Write(…)` rule is refused at load:
  "only Edit(path) rules are" matched). For `.claude/skills/…` and for a plain path alike. The same
  hook's `allow` let `git log -S'MERGER_ANSWER'` run in `dontAsk`, as Scout's gate does.
- **`.claude` is protected in Claude Code**: its writes are prompted in `default` and
  `acceptEdits`, routed to a classifier in `auto`, denied in `dontAsk`, allowed only in
  `bypassPermissions`; allow rules do not change that. The prompt offers "allow Claude to edit
  files in this project's .claude folder for this session".
- **Codex's sandbox can hold a writer to one folder**: `codex exec --sandbox workspace-write -C
  <clone>/.claude/skills` wrote `probe-codex/SKILL.md` there; `printf 'x' >> <clone>/README.md`
  failed with "Read-only file system". The cwd is the only writable root (with temporary folders).
- **This repository's skills** pass `claude plugin validate .claude/skills`; 2 of 6 descriptions
  hold `<` and `>`, which Anthropic's validator (`quick_validate.py`) and the API refuse.
- **What both skill creators leave to the project**: where a project's skills live (Codex's
  writes to `$CODEX_HOME/skills`), the project's own conventions, and the other agent's folder.

Decided with the person: the name Scribe; Scribe writes in the checkout, as Settings writes
`config.json`; the Codex link offered; personal skills left out. Plan: PLAN.md, V41.

## V41 — Skills in Symbiote, and Scribe, an agent that writes them (2026-10-24, branch `feature/skill-creator`)

Asked: "one new Agent … a skill creator for the project, but also the capability to edit those
skills from the app, or to add new one by me". Built: a Skills page (`/skills`, i) that lists,
checks, edits, adds and deletes the checkout's skills and links them for Codex; Scribe, an agent
there that writes them into `.claude/skills/` only. PLAN.md, V41.

**Learned**:
- **A background session of Claude Code (2.1.309) refuses every edit outside a worktree of its
  own**: "This background session hasn't isolated its changes yet. Call EnterWorktree first",
  whatever the hook, the mode or the folder. `"worktree": {"bgIsolation": "none"}` in the session's
  own `--settings` file lifts it for that session; Claude Code's protected-folder rule for
  `.claude` then asks before the write. Fakes cannot show this: only a real run did. (Scout never
  writes; workspaces run in worktrees.)
- **`--bg` refuses a folder Claude Code was never trusted in** ("Workspace not trusted. Run
  `claude` … once"): the throwaway clone was trusted with Claude Code's own dialog, where the first
  option is "No, exit". Started from a Claude Code session, `symbiote view` passes on its
  `CLAUDE_CODE_*` variables (the agent printed "inherited CLAUDE_CODE_CHILD_SESSION marker"): the
  real runs unset them first.
- **The gate shapes how the agent works, and it works around a refusal the right way**: Scribe's
  `ls` and `git -C` were refused, and it used Glob and plain `git log -S`; told to edit README.md
  "I allow it", it tried twice, was refused twice, and gave the row to paste instead.
- **Codex's sandbox is a folder, not a skill**: started in `.claude/skills`, a relative
  `README.md` landed at that folder's root (allowed), the repository's by its full path failed
  ("Read-only file system").
- **A skill Scribe writes is used**: a fresh `claude -p` loaded `agent-prompt` for "add a prompt
  for an agent called Herald", and no skill for moving the Appearance switch (one run each).
- **An inline dot has no size**: `.state-dot` inside an inline `span` drew 0×0; the sidenav's
  are flex items. Seen only in a screenshot; e2e found it (aria-hidden) fine.
- **`shell.spec`'s focus tests are flaky on this machine either way**: alternated with `main`'s
  sidenav, the keys test failed 7 of 20 against 1 of 20 here, the card test 5 of 10 against 0 of
  20; a 300 ms wait after the arrow made it pass 3 of 3.

**Verification**: tests first, red for the right reason (skills server 20, route 1, viewer checks
16 with this repository's own skills, page route 1, Scribe's gate 8, Scribe's conversation 3,
prompt 3, poll 1, e2e 6). `pnpm check` 1,360 tests in 99 files; e2e 215 of 216 (the flaky keys
test above). Real Claude Code and Codex in a throwaway clone: PLAN.md's table. `/history` first
paint 64 ms on both builds, first rows 151 and 156 ms. Screenshots of every state at 1440×900 and
390×844, dark and light.

Not verified: Windows and macOS; "allow … for this session" in a checkout outside `~/.claude`; a
project whose own settings deny writes into `.claude`.
