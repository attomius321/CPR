# Journal: README remade around workspaces

[Index](../JOURNAL.md)

## README remade around workspaces (2026-10-26, branch `feature/remake-readme`)

Asked: the README no longer said what Symbiote is. It has become a way to run coding agents with
the person in the loop, and the README opened with the graph. Start it again from nothing, with
workspaces and their pages at the centre, easy to read, precise, not deep. Written to the
`writing-docs` skill (untracked in the main checkout, not on this branch; its `readability.mjs`
was run from there).

What it was, measured with `readability.mjs`: 1,221 lines, 10,156 words, 20.1 words a sentence
(90th percentile 40, longest 94), 142 sentences over 25 words (28 %), 38 paragraphs over 80
words. Workspaces began at line 403. Its six screenshots dated from 2026-10-15 to -19: the old
name, a Features tab, the look before the sidenav.

What it is now: the README (2,540 words, 12.2 words a sentence, longest 32, 4 sentences over
25) and three pages for what a user looks up, agreed with the person before writing:

- `docs/reference/commands.md` (367 words and 4 tables): commands, options, exit codes, a real
  `symbiote diff` sample, keys, Symbiote's MCP tools.
- `docs/reference/configuration.md` (691 words): `symbiote/config.json`, `merge.md`, prompts,
  `.symbioteignore`, environment variables, logs, older names.
- `docs/guide/review-and-ci.md` (1,685 words): opening a change, reading the graph, findings,
  branch and pull request reviews, CI, plugins, stylesheets.

The README's order follows the skill's: what it is and a picture, requirements, install (with
"Symbiote's window", whose heading two CLI messages name), a quick start from `symbiote view` to
Clean up, workspaces (start, the sidenav's groups, the agent's tabs, review, merge, clean up),
the other pages, review without an agent, what Symbiote writes and sends, limits, development.

**Dropped, with why**: everything below is the old README's detail, which the person asked to
leave out. It stays in the plans and journals of the milestones that built it.

- Internals of how things work: Scout's and Scribe's command gates and flags, Codex's sandbox and
  app server, the hooks' files, `claude attach`, terminal limits (four agents, eight shells,
  memory each), the Changes panel's widths and refresh, image and path rules in terminals, model
  lists read through the SDK, the merge page's line rules.
- Edge cases a first reader does not need: the first-time intro, the window's title bar, keys
  and remembered state, the sidenav's dot shapes, draft and document expiry, the Prettier and
  ESLint note for documents, a merge's binary or deleted files, a counter merged as dropped.
- The Monitor's thresholds and counting rules, Grafana's memory and Drilldown, the regression
  scripts (CLAUDE.md has them), the V20c link in Limits.

**Corrected on the way**: the old configuration table lacked `merge.agent`; `symbiote merge`'s
`--approve` and `--again` were missing; its alias line, pasted into a profile, pointed at the
folder the shell starts in; **Check again** was described as if any failed check offered it
(only a resolution under review does); a `.symbioteignore` `!` line brings back a file in a
skipped folder, unlike git's (checked with the built matcher).

**Reader test** (the skill's): fresh agents read only the pages, with no tools but reading them.
The README's 10 questions: what it is and where it runs; what to install; starting a workspace;
watching and answering the agent; reviewing and telling the agent; approve and conflicts; Scout,
Skills and Monitor; files written and git; network; use without an agent or in CI. The pages' 9:
failing a CI job, MCP tools for one's agent, keys, merge checks and push, a Spike's prompt,
usage and logs, `orphan-added`, the GitHub Action, re-reviewing a pull request.

- Round 1: 10 of 10 and 9 of 9 right, quoted. Their notes found what the fact check had not: the
  alias line; "your checkout is never touched" (landing moves the checked-out branch); terms
  before their definitions (the check, lands, sidenav, merge base); the workflow file's path and
  `merge.push`'s remote left to guessing. Fixed.
- Round 2, new agents: 10 of 10 and 9 of 9 right, quoted. Smaller notes fixed (Scout may message
  an agent without Confirm; a spike's report is in Thread; why `fetch-depth: 0`). No third round.

**Screenshots**: six at 1440 × 900, dark, from this branch's build, on a three-file TypeScript
repository made for them in the job's temporary folder: `workspace.png`, `start.png`,
`review.png`, `review-detail.png`, `merge.png`, `history.png`. `logs-dashboard.png` moved to the
configuration page; the four other old images are deleted. Real Claude Code sessions were the
plan, but Claude Code refused the repository ("Workspace not trusted") after the person ran
`claude` there twice to accept its trust prompt: `~/.claude.json` held no entry for it, and
shrank between two reads (138,520 to 135,890 bytes), so another running Claude Code may have
written its older copy over it (not verified). The agent is the e2e suite's fake Claude Code,
generated from `packages/viewer/e2e/symbiote.ts`, its hooks driven as the suite's `report` and
`hook` do. The
plan in `workspace.png` is a real one from Claude Haiku (`claude -p`, read-only tools) for the
workspace's real start prompt, minus two lines about print mode refusing `npm test`. The
commits are written by hand. Both merges ran Symbiote's real merge and check (`npm install`,
`npm run test`). In `merge.png` the log's checkout path, which held a user name, reads `…/cart`.

**Learned**:
- **Reader tests catch what fact checks miss**: every flag and key was checked against the code,
  yet both rounds found claims that were true word by word and wrong for the reader.
- **Trust for screenshots**: a repository made by an agent cannot be trusted by that agent (the
  safety check refuses it, rightly), and the person's trust did not hold here. For real-agent
  screenshots, make the repository first and have the person trust it before anything else runs.
- **The fake agent is reusable outside Playwright**: its source is a template in `symbiote.ts`;
  evaluating it with `dir` and the models answer writes a working fake for any repository.

**Verification**:
- Facts: every command and option against `symbiote <command> --help`; each `config.json` key
  against `readWorkspaceConfig` and `readMergeConfig`; each environment variable by grep; the
  Action's inputs against `action.yml`, the GitLab variables against `ci/gitlab/symbiote.yml`;
  keys against the viewer's handlers; labels (groups, tabs, buttons) against the components;
  the check guess order against `check.ts`; network calls by grep (`fetch`, `git push`,
  `git fetch`). The `symbiote diff` sample is a real run on the `callers` fixture.
- Links: a script with GitHub's heading rules, 37 relative links and anchors, none broken. The
  CLI's AppArmor message still finds "Symbiote's window".
- Install: a clean clone of the branch, `pnpm install` (with this machine's pnpm store) and
  `pnpm build`, `node-pty` built; the alias line appended to a throwaway `HOME`'s `.bashrc`
  runs `symbiote --help` from another folder; `symbiote view` serves.
- A branch changing only non-TypeScript files: its review shows no symbols and keeps Approve.
- `pnpm build` passes. `pnpm check`: format, lint and typecheck pass; 1,761 of 1,762 unit tests
  pass. The failing one, `packages/viewer/test/tooltips.test.ts` (a `title` at
  `skills/SkillsPage.tsx:583`), fails on `main` too: this branch changes only docs.

Not verified: an install with an empty pnpm store; macOS; Symbiote's window (Electron); Codex;
`symbiote pr`, the GitHub Action and the GitLab template; the logs app (Docker); a workspace
with a real Claude Code session.
