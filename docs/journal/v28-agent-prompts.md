# Journal: V28 — Every agent's prompts in the project's settings

[Index](../JOURNAL.md) · [Plan](../plan/v28-agent-prompts.md)

## V28 spike — what Symbiote tells its agents, and how a project would change it (2026-10-20, branch `milestone/v28-agent-prompts`)

Asked: a settings page to extend the predefined agents; then "every meta prompt of every agent
should be configurable, with the defaults set as current", saved in `config.json` and shared
with everyone, only the agents' prompts at first.

Measured on `main` (`eadc0ce`): Symbiote writes 13 texts its agents are told: a start prompt per kind
(654–840 characters besides the brief), the two plan sentences (132 and 69), the 4 sentences of a
verdict for a branch's agent (`verdictText`), `symbiote/AGENTS.md` (2,935 characters, 62 lines) and
the merger's instructions (1,410). A project can change none of them. `agent.*` chooses the agent,
not its words; `symbiote/merge.md` only adds to the merger's prompt.

**Learned**:
- **`symbiote/merge.md` could not be shared.** Symbiote's `symbiote/.gitignore` hid it, and forcing it into git
  would have moved the reviews to Symbiote's cache (any tracked file in `symbiote/` that is not Symbiote's makes
  the folder the project's). Fixed on its own branch, `fix/merge-md-shared`.
- **Additions would not be enough.** This repository's CLAUDE.md keeps experiments in `spikes/`
  and ends every session pushed; the Spike prompt says "Commit nothing unless the brief asks for
  it". Only a changed prompt can drop Symbiote's sentence, so V28 makes each prompt whole and
  changeable, with today's text as the default.
- **What people change is not measured.** The 5 workspace sessions on this machine hold 16
  messages from the person: one corrected how the agent worked ("ask for my permission to do
  something, but don't do it"), before Plan first existed; the rest were answers, "continue", and
  merges V26 now makes.
- **Rewriting `config.json` breaks the project's own check.** Prettier checks `symbiote/config.json`
  here; `JSON.stringify(…, null, 2)` turns its one-line `merge.checks` into 6 lines, and
  `pnpm check` would fail. `jsonc-parser` 3.3.1's `modify` changed only the member it set (an
  array of long lines, as Prettier writes them), and removing it gave back the file byte for byte.
- **The merger's last paragraph is a contract, not a prompt**: Symbiote parses the JSON it asks for.
  It stays Symbiote's and is appended after the project's instructions.
- **One case cannot stay byte for byte with placeholders**: with no default branch, today's start
  prompt stops at "the person reviews the branch in Symbiote." V28 says "the branch the person picks",
  which is what Merge into ▾ asks since V26.

## V28a — Prompts from config.json (2026-10-20, branch `milestone/v28-agent-prompts`)

The 13 texts Symbiote's agents are told are now defaults with placeholders
(`packages/cli/src/prompts.ts`), replaced by `prompts.<key>` in `symbiote/config.json` when a project
has its own. Every use reads them: Claude Code's and Codex's start prompt, Copy the prompt, the
merger's system prompt (Claude Code's `--system-prompt`, Codex's stdin), `symbiote/AGENTS.md`, and a
verdict's text. `GET` and `POST /api/settings/prompts` serve the Settings page to come (V28b).

**Learned**:
- **Recording `main`'s prompts before changing the code made "nothing changes" checkable.**
  `test/fixtures/prompts-before-v28.json` holds 48 start prompts, the merger's instructions,
  `symbiote/AGENTS.md` and 8 verdict texts from `main`'s build; the defaults give each byte for byte,
  except decision 171's 20.
- **`symbiote/AGENTS.md` was written once a run.** A Settings change would have waited for a restart;
  it is now written again when the text in use differs from what was written.
- **Moving the texts was needed to avoid an import cycle**: `reviews.ts` reads the prompts, and
  the prompts' defaults held `reviews.ts`'s `AGENTS`.
- **A placeholder filled in one pass** keeps a brief's own `{plan}` or `{branch}` as text. The
  recorded brief holds `{plan}`, `{brief}` and `{"json": 1}` to check it.
- **`jsonc-parser` works from ESM by named import** through its UMD build (Node 24); the Action's
  `pnpm install` brings it.
- The 13 tests of `prompts.test.ts` were red first (no module). The 5 tests of each use (a
  kind's start, the merger's instructions, `AGENTS.md` after a change, a verdict's sentences, the
  server's route) were written with the code, not seen red.

**Verification**: 917 unit tests, lint, typecheck, build. The built CLI in a throwaway repository
with a fake `claude`: the settings listed, a save written as lines, the next Spike's prompt the
project's, a stale save 409. The real Claude Code (2.1.303, `sonnet`, read-only, Plan first):
Symbiote's Spike prompt gave a plan with "no commits"; a Spike prompt that keeps experiments gave
`spikes/…`, a commit and a push. Not verified: Codex with a changed prompt; the merger with
changed instructions on a real conflict; Windows' command-line limit.

## V28b — The Settings page (2026-10-20, branch `milestone/v28-agent-prompts`)

A third tab in `symbiote view`, Settings (`s`, `/settings`): the 13 prompts by agent, each in a text
area with its placeholders, Save and Reset to Symbiote's, and what saving means in git. Written
through V28a's `POST /api/settings/prompts`.

**Learned**:
- **A line count is not a height.** The merger's instructions are 16 lines but wrap to about 30
  at 1440 px: sized by lines, the text area scrolled inside itself in the first screenshot. It
  now grows with its content (`scrollHeight`), up to 70 % of the window.
- **`s` pressed before the tabs are drawn is lost**: the page's keys listen once `symbiote view`
  answered what the page is. The spec waits for the tab first, as a person would see it.
- **The Workspaces page's title is squeezed at 390 px** (its help text in a one-word column
  beside "Start a workspace"). It is so on `main`: V28b adds only CSS rules and does not touch
  that page. Not fixed here.
- The 7 unit tests of `settings.ts` were red first (no module); the 4 e2e tests were written
  with the page.

**Verification**: 924 unit tests, lint, typecheck, build; 124 of 124 e2e. Screenshots at 1440 and
390 px, light and dark, no page errors (sent to the user). The real merger (Claude Code,
`sonnet`) on one conflict, a version constant changed on both sides: with Symbiote's instructions it
kept `2.1.0`; with "a version constant changed on both sides is never yours to answer" it said
"needs you", naming both values; 4.2K input tokens a run. Not verified: Codex with a changed
prompt; Windows.

Merged into main (2026-10-20): V28a and V28b, after `fix/merge-md-shared`. Two conflicts, both
from that fix: `prepareSymbioteFolder`'s doc comment (both kept) and the journal's end (both entries
kept). `main` verified after the merges: frozen install, 925 unit tests, lint, typecheck, build,
124 of 124 e2e.
