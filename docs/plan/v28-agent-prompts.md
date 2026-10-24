# V28 — Every agent's prompts in the project's settings

[Index](../PLAN.md) · [Journal](../journal/v28-agent-prompts.md)

**Status:** V28a and V28b merged into main (2026-10-20, from branch
`milestone/v28-agent-prompts`). As built and results: "As built (V28a)" and "As built (V28b)"
below.

**Problem** (asked: "We need a settings page where you can extend the predefined agents with more
specific things for it"; then "Every meta prompt of every agent should be configurable, with the
defaults set as current. Can be saved in config.json"; the changes shared with everyone, only the
agents' prompts at first). Symbiote writes every word its agents are told, and a project can change
none of them. Measured on `main` (`eadc0ce`, 2026-10-20):

| What Symbiote tells an agent | Where | Size | A project can change it today |
|---|---|---|---|
| A workspace's start prompt, one per kind (Feature, Fix, Refactor, Chore, Spike) | `workspacePrompt` and `KINDS[kind].line` (`workspaces.ts`) | 654–840 characters besides the brief, 12–14 lines | No. `agent.kind`, `agent.model` and `agent.permissionMode` choose the agent, not its words |
| Plan first or not: one of two sentences in every start prompt | `workspacePrompt` | 132 and 69 characters | No |
| A verdict for a branch's agent: approved with a target, approved to push, changes or comments, where the review is | `verdictText` (`reviews.ts`) | 4 sentences around the person's comments | No |
| The review instructions, `symbiote/AGENTS.md` | `AGENTS` (`reviews.ts`) | 2,935 characters, 62 lines | No. Symbiote rewrites the file when its text differs, and the file sends the project's rules to its own CLAUDE.md or AGENTS.md |
| The merger's instructions, its system prompt | `MERGER_INSTRUCTIONS` (`merge-agent.ts`) | 1,410 characters, 16 lines | Only adds: `symbiote/merge.md` goes into the prompt after the sides' titles (git-ignored until `fix/merge-md-shared`) |

So 0 of these 13 texts can be changed. What a project would change is not measured: of the 5
workspace sessions on this machine (16 messages from the person), one corrected how the agent
worked ("ask for my permission to do something, but don't do it", started before Plan first
existed); the rest were answers, "continue", and merges that V26 now makes. One disagreement is
in this repository: the Spike prompt says "Commit nothing unless the brief asks for it" and
"keep experiments out of the project's code", while its CLAUDE.md keeps experiments in `spikes/`
and ends every session "with everything pushed".

Writing the setting is measured: `symbiote/config.json` is the project's file and its formatter's.
Prettier checks it in this repository, and a `JSON.stringify` rewrite turns its one-line
`merge.checks` into 6 lines, which fails `pnpm check`. `jsonc-parser` 3.3.1's `modify` changes
only the member it sets; removing that member gives back the file byte for byte.

**Goal**: a Settings page in `symbiote view`, beside Workspaces and History, lists every agent's
prompts: the start prompt of each kind, the two plan sentences, the verdict's sentences, the
review instructions and the merger's instructions. Each shows Symbiote's text until it is changed. A
change is saved under `prompts` in `symbiote/config.json`, which the project commits to share; Reset
removes the key, so Symbiote's text applies again, a later version's too. Agents started, conflicts
sent to the merger and `symbiote/AGENTS.md` written after a save use it. Unchanged: with no `prompts`,
every prompt is today's byte for byte (one case aside, decision 171); config.json's other keys
and formatting; the start dialog; and the data in a prompt (the brief, conflict regions, comments).

## The prompts and their placeholders

| Key in `prompts` | What | Placeholders |
|---|---|---|
| `start.feature`, `start.fix`, `start.refactor`, `start.chore`, `start.spike` | A workspace's start prompt for that kind | `{branch}`, `{start}` (`main at abc1234`, or `the commit abc1234`), `{brief}` (required), `{plan}`, `{into}`, `{record}`, `{reviews}`, `{agents}`, `{symbiote}` |
| `plan.first`, `plan.direct` | What `{plan}` becomes with Plan first, and without | none |
| `verdict.approve`, `verdict.push`, `verdict.address`, `verdict.where` | A verdict's sentences: approved with a target, approved to push (no target), changes requested or comments, where the review is | `{branch}`, `{at}`, `{into}`; `{reviewer}`, `{what}`; `{review}`, `{agents}` |
| `reviews` | `symbiote/AGENTS.md` | none |
| `merger` | The merger's instructions | none |

- Each default is today's text with today's values as placeholders. One start prompt per kind,
  its kind's line written in, not a frame plus a line: the page shows what that agent is told,
  whole, and changing the Fix prompt cannot change the Spike's.
- Only the names listed for a prompt are replaced; any other brace is text (the merger's
  instructions show JSON).
- **The merger's answer format stays Symbiote's** (decision 169): the last paragraph of today's
  instructions ("Answer with one JSON object …") is appended after `merger`, so the default gives
  today's system prompt, and the page shows it read-only. `symbiote/merge.md` is read as today.
- What stays data: the brief and its parts, the conflict regions and symbols, the "asked again"
  words, the verdict's summary and comments, the `about` lines in records.

## Storage: `prompts` in `symbiote/config.json`

```json
{
  "prompts": {
    "start": {
      "spike": [
        "You are starting a new spike in this repository, on the branch {branch}, started from {start}. This folder is a git worktree of its own with that branch checked out: work only here.",
        "",
        "The person's brief:",
        "",
        "{brief}"
      ]
    },
    "verdict": {
      "approve": "Approved the branch {branch} at {at}: Symbiote merges {at} into {into}; do not merge it yourself."
    }
  }
}
```

- A prompt is a string, or an array of lines joined with `\n`. Symbiote writes a one-line prompt as a
  string and a longer one as lines, so git diffs and Symbiote reviews it line by line; as one string,
  any change would be one changed line of ~800 characters.
- Read where the other keys are (`symbiote/config.json`, else `symbiote.config.json`), at each use: a save
  applies at once, committed or not, as `.symbioteignore` does. Shared once committed: `config.json` is
  the one file `symbiote/.gitignore` lets through.
- Written with `jsonc-parser`'s `modify` and `applyEdits`, only `prompts.<key>`. An emptied
  `start`, `plan`, `verdict` or `prompts` is removed; a text equal to Symbiote's is saved as no key;
  with neither file, `symbiote/config.json` is created. New runtime dependency of `@symbiote/cli`: MIT, no
  dependencies of its own, 112 KB of ESM. The reason is the file's formatting, measured above.
- A hand-edited value that is not text, or a start prompt without `{brief}`: Symbiote's text is used,
  and the page says why (decision 170).

## Server

- `GET /api/settings/prompts`, in Workspaces mode only, like `/api/workspaces…`: the config
  file's path, a `version` (a hash of its text), its git state (committed, changed, new, none),
  and per prompt its key, agent, title, purpose, the text in use, Symbiote's text, whether it is
  changed, the placeholders and what each means, its limit, a warning when the file's value is
  not used, and, for the merger, the answer format Symbiote adds.
- `PUT /api/settings/prompts/<key>` with `{ text: string | null, version }`. `null`, or Symbiote's
  text, removes the key. 409 when the file changed since `version`; 400 for an unknown key, a
  missing required placeholder, or a text over the limit.
- Limits: a start prompt 8,000 characters (it goes on the agent's command line with a brief of up
  to 20,000, and Windows takes 32,767); a verdict sentence 1,000; `reviews` and `merger` 20,000.
- One reader, `promptsOf(root)`, for every use: Claude Code's `--bg` start, Codex's `exec` and app
  server start, "Copy the prompt", the merger (Claude Code's `--system-prompt`, Codex's stdin),
  `prepareSymbioteFolder` (`AGENTS.md`) and `verdictText`.

## Viewer

- A third tab, Settings, at `/settings` (`pages.ts`, `PageTabs.tsx`).
- On the left, the agents and their prompts: Workspaces (Feature, Fix, Refactor, Chore, Spike,
  Plan first, Plan without), Reviews (the verdict's sentences, `symbiote/AGENTS.md`) and Merger; a
  mark on each changed one.
- On the right, the prompt in a monospace text area; its placeholders, each with what it means;
  "Symbiote's" or "Changed"; Save, and Reset to Symbiote's. Under Save, what saving does:
  "Saved in symbiote/config.json, not committed: commit it to share it with everyone who uses this
  repository." Characters and about how many tokens. For the merger, the answer format Symbiote adds,
  read-only.
- An unsaved edit is kept while another prompt is open; leaving the page with one asks first.

## Verification

1. **Tests first**: with no `prompts`, each start prompt equals today's for 5 kinds × Plan first
   or not × a default branch or none, against strings recorded from `main` before the change; the
   merger's system prompt (Claude Code and Codex), `AGENTS.md` and each kind of verdict text equal
   today's. Each configured prompt replaces its default, placeholders filled and other braces
   left. A value that is not text, and a start prompt without `{brief}`, give Symbiote's text and a
   warning. Writing: this repository's `config.json` with a prompt set, then reset, is the file
   it was byte for byte; a stale version gets 409; the limits hold; a one-line prompt is written
   as a string and a longer one as lines.
2. **E2E** (`settings.spec.ts`, with `serveWorkspaces`' fake agent): the tab; Fix changed and
   saved, then a Fix workspace's "Copy the prompt" has the change; Reset; a save from another tab
   gives "changed since you opened it"; an unsaved edit kept across prompts; no page errors.
3. **Real agents**: a Spike started with a changed Spike prompt (commit the experiment under
   `spikes/`) in a throwaway repository with the real Claude Code, which follows it; the merger
   with changed instructions on one of V26c's replays; a Codex start through the app server with
   a changed prompt.
4. **viewer-check**: the page at 1440 × 900 and 390 × 844, light and dark.
5. **Nothing else changes**: unit and e2e tests as on `main`. No analysis code changes, so no
   regression-check.

**Risks**

| Risk | Mitigation |
|---|---|
| A changed prompt loses what the agent needs (its brief, its branch) | `{brief}` is required; the page lists the placeholders; Reset |
| A changed merger prompt answers in a form Symbiote cannot read | The answer format is Symbiote's and always appended (decision 169) |
| A project's changed prompt misses Symbiote's later rewording | Only changed prompts are stored; the page shows Symbiote's text beside the project's |
| The project's formatter disagrees with what Symbiote writes inside `prompts` | Outside `prompts` the file is unchanged byte for byte; arrays of long lines are what Prettier writes too (checked here) |
| A long merger prompt costs tokens on every conflict | Characters and tokens shown under each prompt; the limits |

**Order**: V28a first (the prompts read from and written to config.json, the server), then V28b
(the page).

## Milestones

| # | Milestone | Output |
|---|---|---|
| V28a ✅ | Prompts from config.json | The 13 prompts as defaults with placeholders; `promptsOf`; every use reads it; writing with `jsonc-parser`; `GET`/`PUT /api/settings/prompts`; README's config table |
| V28b ✅ | The Settings page | `/settings`, the tab, the list, the editor, Save, Reset, the git state, e2e and screenshots |

**Decisions** (165–171, as built):

| # | Question | Decision | Why |
|---|---|---|---|
| 165 | Where a project's prompts are kept | **`prompts` in `symbiote/config.json`, only the changed ones** | The user's choice. Shared once committed (the one file `symbiote/.gitignore` lets through); a missing key keeps Symbiote's text, and a later version's |
| 166 | What can be changed | **Each prompt whole, with placeholders; one start prompt per kind** | "Every meta prompt … configurable, with the defaults set as current": additions after Symbiote's text could not change Symbiote's words, as this repository's Spike rule needs |
| 167 | How config.json is written | **`jsonc-parser`'s `modify`: only `prompts.<key>` changes** | A `JSON.stringify` rewrite changed this repository's `merge.checks` line and failed its `pnpm check`; `modify` and its removal give the file back byte for byte |
| 168 | A prompt's form in the file | **One line, a string; more, an array of lines** | Git diffs and Symbiote reviews it line by line |
| 169 | The merger's answer format | **Symbiote's, appended after the project's instructions, not changeable** | Symbiote parses the answer: a changed format is a merger whose every answer fails |
| 170 | A value Symbiote cannot use (not text; a start prompt without `{brief}`) | **Symbiote's text, and the page says why** | An agent started without its brief does the wrong work; precise beats complete |
| 171 | `{into}` when Symbiote knows no default branch (no `origin/HEAD`, no `main` or `master`) | **"the branch the person picks"** | Since V26 the person picks it at Merge into ▾. Today's sentence stops before the target there; the one case where the default's output changes |

**Not in V28 (later)**: the other config.json keys on the page (asked: the prompts first);
prompts per person (asked: shared); the Done when texts each kind fills in (the brief's, edited in
the start dialog); the merger's conflict frame and its "asked again" sentence; new kinds of work;
a diff of a changed prompt against Symbiote's; folding `symbiote/merge.md` into `merger`.

## As built (V28a)

- **A write is `POST /api/settings/prompts` with `{ key, text, version }`**, not `PUT …/<key>`:
  every write of `symbiote view`'s server is a POST with `x-symbiote: 1` and a JSON body (`written`).
- **Symbiote's texts moved into `packages/cli/src/prompts.ts`**: the kinds' lines (out of `KINDS`),
  `symbiote/AGENTS.md` (out of `reviews.ts`) and the merger's instructions (out of
  `merge-agent.ts`), so `reviews.ts` can read the prompts without an import cycle. `AGENTS` and
  `MERGER_INSTRUCTIONS` are still exported, built from the defaults.
- **`symbiote/AGENTS.md` follows a change while `symbiote view` runs.** It was written at most once a run;
  now again whenever the text in use differs from what was written.
- **The file's git state** comes from a new core helper, `fileGitState`: committed, changed,
  new, `ignored` (a project's own `symbiote/.gitignore` may hide `config.json`), none.
- **A save keeps the text as given**, but with `\n` line ends and no blank end; one equal to
  Symbiote's is no key. `{plan}`'s texts are not filled again: one pass, so a brief or a plan sentence
  that holds `{branch}` keeps it as text.
- Limits as planned; the plan sentences have 1,000 characters, as a verdict's.

**Results (V28a).** With no `prompts`, the 48 start prompts recorded from `main`'s build (6
kinds, a record from before V24 among them, × Plan first × a default branch or none × `from` or
not), the merger's system prompt, `symbiote/AGENTS.md` and 8 verdict texts are byte for byte
`main`'s, except the 20 start prompts with no default branch (decision 171). This repository's
`symbiote/config.json` with a prompt set, then reset, is the file it was. 917 unit tests (18 new);
lint, typecheck, build. Through the built CLI in a throwaway repository with a fake `claude`:
`GET /api/settings/prompts` listed the 13 prompts, a save wrote `symbiote/config.json` as lines
(git: new), the Spike started next got the project's prompt filled in, and a stale save got 409.
The real Claude Code (2.1.303, `sonnet`, read-only, Plan first) on Symbiote's Spike prompt planned
"nothing in the project, and no commits"; on a Spike prompt that keeps experiments, it planned
`spikes/line-count-bench.ts`, a commit and a push (19.2K–20.3K input tokens). Not verified: Codex
started with a changed prompt, and the merger with changed instructions on a real conflict
(both get the text through the code the tests cover); Windows' command-line limit.

## As built (V28b)

- **Settings is a third tab, `s`**, at `/settings` (served when `symbiote view` has the settings
  service). The list groups the prompts as the server gives them (Workspaces, Reviews, Merger)
  and marks each "changed", "not saved" or "not used" (a value Symbiote cannot use).
- **The editor**: the prompt in a monospace text area that grows with its text, wrapped lines
  too, up to 70 % of the window (a line count left the merger's long lines scrolling inside);
  its size in characters and about how many tokens; the placeholders, each inserted at the
  cursor on a click; the merger's answer format read-only; Symbiote's text under a disclosure once
  the project has its own. Save (also Ctrl+S, Ctrl+Enter) is off while the text would be
  refused: the page checks the required placeholder and the limit as the server does.
- **What saving says** comes from the file's git state: "Saved in symbiote/config.json, not
  committed: commit it to share the prompts with everyone who uses this repository", changes
  not committed, committed, ignored, none. A save refused as stale offers "Read it again", which
  keeps the drafts.
- **Drafts** are kept per prompt while others are open; leaving the page with one asks first
  (`beforeunload`, which the tabs' links and keys trigger too). Reset asks once, inline.
- **On a phone** the list comes first and a prompt takes the page, with "← All prompts" back, as
  Workspaces does with its panel.

**Results (V28b).** 7 unit tests for the page's logic (red first), 4 e2e tests
(`settings.spec.ts`: a Fix prompt changed and saved, then the next Fix workspace's agent told it,
Reset leaving no `prompts`; drafts kept across prompts, `beforeunload` on leaving, a save refused
as stale then saved after "Read it again"; the merger's fixed answer format; the phone layout,
nothing wider than 390 px). V25's tabs test now expects three tabs. 124 of 124 e2e, 924 unit tests. Screenshots at
1440 × 900 and 390 × 844, light and dark, no page errors. The merger with changed instructions,
the real Claude Code (`sonnet`) on one conflict (a version constant changed on both sides): Symbiote's
instructions answered `2.1.0`; a rule that versions are the person's gave "needs you", naming the
two values and the decision (4.2K input tokens, 3–5 s a run). Not verified: Codex started with a
changed prompt; Windows.
