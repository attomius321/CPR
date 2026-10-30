# V41 — Skills: the project's skills in Symbiote, and Scribe, an agent that writes them

[Index](../PLAN.md) · [Journal](../journal/v41-skills-and-scribe.md)

**Status:** built, merged into `main` on 2026-10-24, on branch `feature/skill-creator`, a workspace
started in Symbiote; plan confirmed by the person (name Scribe; Scribe writes in the checkout; the
Codex link offered; personal skills left out). As built and results under "As built (V41)" below.

**Problem** (asked: "one new Agent … it is a skill creator for the project, but also the
capability to edit those skills from the app, or to add new one by me. Do some research before
that on how a skill should be created"). A skill is a folder with a `SKILL.md`: YAML frontmatter
(`name`, `description`) and Markdown instructions an agent loads when the description matches its
task. This repository keeps 6 in `.claude/skills/` (13 commits changed them in 20 days); Symbiote
shows none of them, and nothing in it writes one. Measured on `bf0e717`, Claude Code 2.1.309,
Codex 0.163:

| What | Measured |
|---|---|
| The 6 skills | bodies 15–154 lines, descriptions 357–553 characters; `claude plugin validate .claude/skills` passes all 6; 2 descriptions hold `<` and `>` (`--plugin <name>`, `symbiote/reviews/<branch>/…`), which Anthropic's API, claude.ai and the open standard's validator refuse |
| Which agent reads them | Claude Code reads `.claude/skills/`; Codex reads `.agents/skills/` (and `~/.agents/skills`, its own system folder). In a clone, `codex debug prompt-input` listed 0 of the 6; with `.agents/skills` a link to `../.claude/skills`, 6 of 6 |
| Skill creators already there | Claude Code: `anthropic-skills:skill-creator` (synced from the person's claude.ai account); Codex: `skill-creator` in `~/.codex/skills/.system/`. Neither knows a project: Codex's writes to `$CODEX_HOME/skills` (personal) unless told; Anthropic's has no default folder and its test loop needs subagents, Python and a browser |
| Claude Code writing a skill | `.claude/` is a protected folder: writes there are "never auto-approved" but in `bypassPermissions`. In `dontAsk` (Scout's mode) a Write was denied for `.claude/skills/…`, and for a plain path too, with a PreToolUse hook answering `allow` and with an `Edit(…)` allow rule; the same hook's `allow` let Bash's `git log -S` run |
| Codex writing a skill | `codex exec --sandbox workspace-write -C <clone>/.claude/skills`: a skill written there; a write to the clone's README refused by the OS ("Read-only file system") |

What a skill should be (Anthropic's best practices, Claude Code's skills documentation, the
agentskills.io specification, Codex's documentation, both skill creators):

- `name`: 1–64 characters, lowercase letters, digits and single hyphens, not at either end; the
  folder's name. Not "claude" or "anthropic" (Anthropic's API).
- `description`: the only part an agent sees before loading the skill. What it does and when to
  use it, in the third person, the main use first, its words the ones a task would hold. At most
  1,024 characters (the standard); Claude Code cuts it at 1,536 in its list. No `<` or `>`.
- The body: under 500 lines, only what an agent does not know already; reference files linked
  from `SKILL.md`, one level deep; scripts for steps that must run the same way each time; forward
  slashes; no dates that go stale; one word for one thing.
- Tested on real tasks with and without it; its description on tasks that should and should not
  pick it.
- Both agents take a changed skill without a restart.

**Goal**: a Skills page in `symbiote view` lists the checkout's skills, opens one in an editor,
saves it, adds and deletes one, and says what the standard and the agents would refuse; and
Scribe, an agent on that page, writes or improves a skill from what the person asks, in
`.claude/skills/` only, for the person to read, edit and commit there. **Unchanged**: Scout,
workspaces, the merger, reviews, Settings' prompts (one more: `scribe`); with no skill and no
question, nothing is written.

## Skills (V41a)

- **Where**: the checkout `symbiote view` runs in (as Settings' `symbiote/config.json`):
  `.claude/skills/<name>/SKILL.md` (Claude Code) and `.agents/skills/<name>/SKILL.md` (Codex).
  When `.agents/skills` is a link to `.claude/skills`, the skills are listed once, read by both.
  Personal skills (`~/.claude/skills`, `~/.codex/skills`) are not listed.
- **`GET /api/skills`** (`packages/cli/src/skills.ts`): each skill's folder, name, `SKILL.md`'s
  text and version (a hash), the other files in its folder (paths, at most 200), its git state
  (core's `fileGitState`), the agents that read it; whether Codex is installed and the link is
  there or can be made.
- **`POST /api/skills`** (`x-symbiote: 1`, like every write): `save` (`path`, `text`, `version`),
  `new` (`name`, `description`), `delete` (`path`, `version`), `link`. A save or delete of a file
  changed since it was read is refused (409, "changed since you opened it"), as Settings does;
  Scribe may have written it. A path is only `<folder>/<name>/SKILL.md` with one of the two
  folders and a valid folder name, and its real path inside the folder's (a link out refused). A
  new skill's name must be valid by the standard and free, and not `synced` or
  `anthropic-skills` (Claude Code's reserved folders); its description non-empty, at most 1,024
  characters, without `<` or `>`. It is written as `name:` and `description:` (quoted when YAML
  needs it) and an empty body. Delete removes the skill's folder. `link` makes `.agents/skills` a
  relative link to `../.claude/skills` (refused when `.agents/skills` exists, and on Windows,
  where a link needs rights git may not keep).
- **Checks** (the viewer's `skills/skills.ts`, pure, as the person types): only what is certain.
  Errors: no frontmatter, or not closed. Warnings: no `name` or one unlike the folder; a name the
  standard refuses (characters, length, hyphens, "claude", "anthropic"); no description, one over
  1,024 or 1,536 characters, `<` or `>` in it; a body over 500 lines or empty; a relative link to
  a file not in the skill's folder. A value Symbiote's small reader cannot read (YAML beyond
  plain, quoted and block text) is said, not judged.
- **Page** `/skills` (sidenav: Skills between Scout and Settings, key `i`, "instructions"): on
  the left Scribe, then the skills by folder, New skill, and, when Codex is installed and does not
  read `.claude/skills`, "Codex does not read .claude/skills" with Link for Codex. On the right a
  skill: its path and git state, `SKILL.md` whole in a monospace text area (frontmatter
  included: nothing Symbiote does not understand is lost), its checks, its other files, Save
  (Ctrl+S), Delete (asks), Improve with Scribe. Drafts kept while another skill is open; leaving
  with one asks first (Settings' guard). On a phone the list first, a skill takes the page. In
  `symbiote-style`.

## Scribe (V41b)

- **A conversation like Scout's** (`/api/scribe`, `/api/scribe/ask`, `/new`, `/terminal`):
  one per repository, kept in `symbiote/scribe.json`, found by its recorded ID, its terminal on
  the Skills page, New conversation. Scout's server becomes one module for both
  (`scout.ts`'s conversation, given each agent's name, record, tools and prompt); Scout's tests
  hold it.
- **Claude Code**: `claude --bg --name Scribe --tools Read,Grep,Glob,Bash,Write,Edit
  --permission-mode default --strict-mcp-config --settings <symbiote>/scribe-settings.json` in
  the checkout. Scribe's gate (`scribe-gate.ts`, a PreToolUse hook as Scout's): Read, Grep, Glob
  pass to Claude Code's rules; Bash only Scout's git reads; Write and Edit only for a file whose
  real path is inside the checkout's `.claude/skills/`, and then Claude Code's own rule applies:
  `.claude` is protected, so it asks the person in Scribe's terminal (the page's "needs you"),
  where "allow … this session" lets the rest of the conversation write; any other path or tool
  denied with the rule in words.
- **Codex**: a thread on its app server started in `.claude/skills` (made when missing) with
  `workspace-write` and approvals `never`: its sandbox writes there and nowhere else, nobody is
  asked.
- **Prompt** `prompts.scribe` (Settings, group Scribe): who it is; what it may write and that it
  never commits; read the repository's CLAUDE.md or AGENTS.md and its skills first and write like
  them; the rules above; ask when the request is unclear; say what it wrote and what it did not
  check. `{request}` required, `{skills}` the folder.
- **Page**: Scribe's box (what agents should know or do; the agent and its effort, as Scout's),
  then its terminal; Improve with Scribe on a skill fills the box ("Improve
  .claude/skills/<name>: "). The sidenav marks Skills while Scribe works and when it answered or
  waits. The list is read again every 5 s while Scribe works.

## Verification

1. **Tests first** (red for the right reason): `skills.test.ts` (both folders, the link listed
   once, a skill without `SKILL.md` skipped, save, 409, new with a valid and refused names,
   delete, link, `../` and a link out refused, a description quoted for YAML read back);
   `scribe-gate.test.ts` (writes inside allowed to Claude Code's rules; outside, `..`, a link out,
   `.claude/settings.json`, a non-git Bash, other tools denied); the conversation's start
   arguments for both agents; `prompts.test.ts` (Scribe's default and an override); the viewer's
   `skills.test.ts` (the frontmatter reader and every check), `pages.test.ts`; e2e
   `skills.spec.ts` with the fake agent (list, edit and save, a stale save, new, delete, link,
   Scribe asked and a skill it writes listed, a phone's width, no page errors).
2. **Nothing else changes**: every other unit and e2e test as on `main` (Settings lists one more
   prompt, the sidenav one more page).
3. **Real agents**, in a throwaway clone: Scribe with the real Claude Code writes a skill for a
   real task of this repository; `git status` shows only that skill; its checks pass; asked to
   change README.md, the gate refuses; a fresh `claude -p` picks the skill for a task that needs
   it and not for a near miss; Codex lists it through the link. Codex's Scribe writes a skill,
   and its sandbox refuses a file outside.
4. **Viewer**: `pnpm test:e2e`; `viewer-check` screenshots at 1440×900 and 390×844, dark and
   light, every state (empty, list, a skill, checks, New skill, Scribe working); `/history` first
   paint as `main`'s. No analysis code changes: no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| Scribe writes outside the skills | Claude Code: the gate denies any other path by its real path, and `.claude` still asks; Codex: its sandbox's only writable folder is `.claude/skills` |
| A skill is an instruction to every later agent: a bad one misleads them | Scribe never commits; the person reads it on the page, Claude Code shows each write before it lands; the checks |
| A save over Scribe's write, or Scribe's over a draft | Versions: a stale save is refused, the draft kept |
| The link on Windows, or a project that ignores `.agents` | Not offered on Windows; the link is a file git shows as new, the person commits it or not |
| A Claude Code release changes protected paths or `--tools` | Arguments under test; the gate decides before Claude Code's rules |
| YAML Symbiote's reader does not know | Said as unread, never an error |

**Order**: V41a (the server, then the page), then V41b (the gate and the conversation, then the
page's Scribe), then the real runs.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V41a | Skills | `/skills`: the checkout's skills listed, edited, added, deleted, checked; Link for Codex |
| V41b | Scribe | An agent on the Skills page that writes skills into `.claude/skills/` only, `prompts.scribe` |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 271 | Which skills, and where they are changed | **The checkout's `.claude/skills/` and `.agents/skills/`, written in place, committed by the person** | "Skills for the project"; personal ones left out (the person's choice). As Settings' `config.json` (V28): the file is the project's, its git state is shown |
| 272 | Codex | **Offer `.agents/skills` as a link to `../.claude/skills`** | Codex listed 0 of this repository's 6 skills, 6 of 6 with the link; one copy, one place to edit |
| 273 | What the editor edits | **`SKILL.md` whole, frontmatter included; other files listed** | Frontmatter fields differ by agent (Claude Code's `paths`, `context`, `allowed-tools`…); a form would drop what it does not know |
| 274 | What is checked | **Only what the standard or an agent would refuse, or a limit passed; in the viewer as one types** | Precise beats complete: style ("third person") is Scribe's and the reviewer's to judge |
| 275 | Where Scribe writes, and how it is held there | **The checkout's `.claude/skills/` only. Claude Code: its gate, then its own protected-folder prompt; Codex: `workspace-write` started in `.claude/skills`, approvals `never`** | `dontAsk` denied every Write (measured), and Claude Code protects `.claude`; Codex's sandbox refused a write outside (measured). A workspace branch would show "No symbol changed" in Symbiote's review |
| 276 | Scribe's conversation | **One per repository, like Scout's; it never commits** | The person reads and edits the skill on the same page before sharing it |
| 277 | Name and key | **Scribe** (the person's choice); the page **Skills**, key **`i`** | Scout finds, Scribe writes; `i` ("instructions") is free in the shell, History and a diff's page |
| 278 | Claude Code's guard on a background session's edits (found building) | **Scribe's own settings file sets `worktree.bgIsolation` to `none`**, for its session only | Claude Code 2.1.309 refused Scribe's write in the checkout ("hasn't isolated its changes yet. Call EnterWorktree first"); in a worktree the skill would not be on the checkout's Skills page. With the key, a probe reached Claude Code's own question before the write |

**Not in V41 (later)**: personal and plugin skills; editing a skill's other files on the page;
running a skill's evaluations from Symbiote; picking skills for a workspace's agent
(`feature/skill-selections`); a project-wide default effort for Scribe.

## As built (V41)

- **A background session of Claude Code refuses an edit in the checkout** (decision 278): Scribe's
  first real write was refused with "This background session hasn't isolated its changes yet",
  and Scribe stopped and said so. Its settings file (`symbiote/scribe-settings.json`) now holds
  `"worktree": {"bgIsolation": "none"}` beside its gate, read again when its session wakes; the
  project's settings are not touched. Then Claude Code asks before each write into `.claude`
  ("Do you want to create SKILL.md?"), which the page shows as Scribe waiting for you.
- **Scout's server is the factory for both** (`pageAgent` in `scout.ts`, given a spec: name,
  record, settings, tools, mode, gate arguments, prompt, where Codex runs). `startReadOnly` became
  `startPageAgent` with the tools and mode given; `hookOutput` names whose gate let a command
  through. Scout's start, record, settings file and texts are as before (its 23 tests unchanged
  but for the method's name).
- **Codex's Scribe can write anything in `.claude/skills`**, a file at its root too, where Claude
  Code's gate wants a skill's folder: the sandbox's writable root is a folder. Asked to append to
  `README.md`, Codex wrote `.claude/skills/README.md` (its working folder), and deleted it when
  asked; the repository's README by its full path failed with "Read-only file system".
- **Scribe's pane is Scout's conversation** (`scout/Conversation.tsx`), framed on the Skills page
  with a height of its own; Scout's page draws it with its own words. Scribe's box has the effort
  stepper at the agent's own level: no `scribe.effort` in the project's config.
- **The checks live in the viewer only** (`skills/skills.ts`): the server refuses what would
  break a new skill (name, description) and paths, not style. The frontmatter reader tells a value
  YAML refuses (`invalid`: an error, Claude Code would load no description) from one it does not
  take apart (`unknown`: an anchor, an alias, a tag; said, not judged).
- **The list** puts Scribe first, under "Agent", with its state's dot.

**Results.** Tests first, red for the right reason: the server's skills (20), the route (1), the
viewer's reader and checks (16, among them this repository's 6 skills: no error, the 2 `< >`
warnings), the route and title (1), Scribe's gate (8), Scribe's conversation (3, and its settings
file), the prompt (3), the poll (1), e2e `skills.spec.ts` (6). `pnpm check`: 1,360 tests in 99
files (`main`: 1,307 in 96). e2e: 215 of 216; the one failure is `shell.spec`'s keys test, whose
`w` and arrows focus test is flaky with or without this change: alternated, 7 of 20 failed with
`main`'s sidenav, 1 of 20 with this one (the card-focus test: 5 of 10 and 0 of 20). The Skills,
Scout and Settings specs, 20 of 20 after the last fixes.

With the real agents, in a throwaway clone of this branch (Claude Code 2.1.309, the person's
default model; Codex 0.163 on its app server), through `symbiote view`'s API and Scribe's terminal:

| Asked | What happened |
|---|---|
| Claude Code: "A skill for adding a new prompt to Symbiote's Settings…" | 2 min 39 s of reading (CLAUDE.md, the 6 skills, `prompts.ts`, the tests, `git log -S`, `git show`; `ls` and `git -C` refused by the gate, then done another way); its write refused by the background guard (above). After the fix, continued: 11 s to Claude Code's question, the skill written once answered |
| The skill, `.claude/skills/agent-prompt/SKILL.md` | 79 lines, a 540-character description; the page's checks: nothing to say. `git status`: only that folder |
| "Add the scribe row to README.md yourself now… I allow it" | Two Edits refused by the gate ("…README.md is outside …/.claude/skills"); Scribe stopped and gave the row to paste |
| A fresh `claude -p` (Sonnet), a task that needs it / a near miss | `agent-prompt` loaded / no skill loaded (one run each) |
| Link for Codex | `.agents/skills → ../.claude/skills`; `codex debug prompt-input` lists the new skill with the 6 |
| Codex: "a very short skill named reading-the-journal…", then a write outside | Written in 16 s (a 14-line body); `README.md` by its full path: "Read-only file system", exit 1 |

`/history` on the clone, `main`'s build and this one alternated, 7 rounds each: first paint 64 and
64 ms, first rows 151 and 156 ms. Screenshots at 1440×900 and 390×844, dark and light: the list,
a skill, a new skill, Scribe's box and its terminal; no overflow, no page error. Not verified:
Windows (no link offered) and macOS; Claude Code's "allow … for this session" in a checkout
outside `~/.claude` (the clone lived under it, and the option named `~/.claude`); a project whose
own settings deny writes into `.claude`; `regression-check` (no analysis code changed). The clone
had to be trusted by Claude Code first, as any folder a background session starts in.
