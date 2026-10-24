# Journal: Fix — Scribe starts at the project's effort level

[Index](../JOURNAL.md)

## Fix — Scribe starts at the project's effort level, `scribe.effort`, set in Settings (2026-10-24, branch `fix/scribe-effort-level`)

The person: "Scribe have no effort level atm. Implement it"; the plan OK'd as written: Scribe's
level in the project's config, set on its Settings page, as Scout's.

**Learned**:
- **Not a regression: V41 left it out** ("Scribe's box has the effort stepper at the agent's own
  level: no `scribe.effort` in the project's config"). The box's stepper set one conversation's
  level; nothing set the level each one starts at. `SCRIBE` had no `effort` in its
  `PageAgentSpec`, so `setEffort` refused ("Scribe has no level in the project's config"), and
  Settings' Scribe page had no Effort (`AGENTS.Scribe` had none).
- **The shared page agent did the rest.** With `effort` in its spec, `efforts()` answers
  `scribe.effort`, a new conversation starts at it when the agent lists it, `setEffort` writes
  it, and Scribe's box already started at what `/api/scribe/efforts` answers. New:
  `scribeEffort` in `readWorkspaceConfig`, `POST /api/scribe/effort`, Effort on Scribe's page.
  Every page agent and every prebuilt agent now has a level, so `effort` is required in
  `PageAgentSpec` and in Settings' `AgentSettings`: the refusal and the `settings.effort &&`
  branches are gone.
- **A page agent's record from a worktree is the main checkout's.** Scout's and Scribe's records
  and settings files go beside the reviews, in the main checkout's `symbiote/`. A real run in a
  worktree of this repository wrote `scribe.json` and `scribe-settings.json` in the person's
  `symbiote/`. New conversation removes the record; the settings file stays.
- **Claude Code's `--bg` refuses a folder it has not trusted** ("Workspace not trusted. Run
  `claude` in … once and accept the trust prompt"), even under a trusted parent
  (`/home/anton/projects`). A worktree of a trusted repository runs. So a real page-agent run
  needs either a worktree (and then writes in the person's `symbiote/`, above) or a folder the
  person trusts: ask first.

**Verification**: tests first, red for the right reason on `main`'s code: `scout.test.ts` 1
(`setEffort` refused: "Scribe has no level in the project's config"), e2e 2 (`settings.spec.ts`:
no Effort on Scribe's page; `skills.spec.ts`: with `scribe.effort: medium` the box at Claude
Code's default). Then green: `pnpm check` (113 files, 1,572 unit tests), build, e2e 240 of 240.
Screenshots of Scribe's Settings page (Effort at high, its help) and its box at 1440×1150 and
390×844, dark and light: no page error, nothing wider than the screen; the help reads as Scout's.
Real run, Claude Code 2.1.310, through `symbiote view`'s API in a detached worktree:
`POST /api/scribe/effort` with low wrote `scribe.effort`, ultra was refused (400, "Claude Code
takes low, medium, high, xhigh or max: ultra"); a request with no level started the
conversation at low (its record and state said so), both assistant lines of its transcript read
`effort: low`, and it answered without writing. Cleaned up: New conversation stopped and removed
the session and deleted its record; the transcript deleted, the worktree removed. Left in the
main checkout: `symbiote/scribe-settings.json` as that run wrote it (Symbiote writes it again at
Scribe's next start, its text being different there). Not verified: Codex at `scribe.effort`
(its first turn's level is the shared code Scout's unit test runs on the fake app server);
`regression-check` (no analysis code).
