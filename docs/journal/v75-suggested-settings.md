# Journal: V75 — Suggested settings: a small model sizes the work before the start

[Index](../JOURNAL.md) · [Plan](../plan/v75-suggested-settings.md)

## V75 spike — how the workspaces were started, and a small model sizing two briefs (2026-10-28, branch `milestone/v75-suggested-settings`)

Asked: "a feature in create a workspace, where i can press a button, a Haiku, or OpenAi analog
model spawns, and choose which settings to be set on, model, effort ...etc". Measured on this
repository's 95 workspace records (`symbiote/workspaces/`, 2026-10-15 to 2026-10-28) and with
the installed agents, Claude Code 2.1.312 and Codex 0.163. The advisor ran in a scratch folder on
two briefs: a chore (bump prettier and reformat) and a refactor (move the workspace records to
SQLite, with a migration). The prompt was the plan's default text with the values written in.

**Learned**:
- **The person starts almost every workspace the same way.** A model was picked on the page for 5
  of 95 workspaces, all `opus`. The effort level was `xhigh` for 72 of 95, including 14 of 17
  fixes. Plan first was on for 87 of 95.
- **Claude Code returns the schema's answer in its own field.** With `--json-schema` and
  `--output-format json`, the result holds `structured_output` beside `result`. Both runs gave
  valid JSON. They took 3.4 s and 4.1 s from start to exit (2.2 s and 3.1 s inside, its
  `duration_ms`), and `num_turns` was 2. With `--system-prompt` replacing Claude Code's own
  prompt, a call read about 2,700 tokens, of which 105 and 222 were thinking at `low` effort.
- **`codex exec` waits for stdin when stdin is not a terminal.** The first run printed "Reading
  additional input from stdin..." and wrote nothing for 240 s. With stdin closed (`< /dev/null`),
  it answered in 3.1 s and 5.0 s. The build must close stdin.
- **Codex reads more tokens, even with its instructions replaced.** With the prompt as its
  message, each Codex call reported about 15,900 tokens used, against about 2,700 for Claude
  Code. `codex exec` has no flag for its instructions, but `-c model_instructions_file=<file>`
  replaces them. With the advisor prompt in that file and the task as the message, the chore took
  3.3 s and 12,441 tokens, with the same suggestion. The rest is Codex's tool definitions and
  environment context; the split was not measured. `--output-schema` and `-o` gave valid JSON on
  all three runs.
- **The agents' descriptions do not size a task, so the guide must come from Symbiote.** Claude
  Code's cached list calls Sonnet 5.5 "Most efficient for simpler tasks" and Haiku 5.5 "Fastest
  for quick answers". It also lists eight older models. Every current model was released after
  Haiku 5.5's knowledge cutoff (June 2026) and Luna's (May 2026).
- **Both advisors sized both briefs the same way.** The chore got the small model at `low` with no
  plan, on both agents. The refactor got the large model (`opus`, `gpt-6-astra`) at `high`, with a
  plan first. Each `why` named a signal from the brief.

Sources for the prompt's rules: Anthropic's "Prompting Claude Haiku 5.5" and "Structured outputs"
pages (platform.claude.com), OpenAI's "Using GPT-6", "GPT-6 Luna" model page, prompt guidance for
GPT-5.6, and "Structured Outputs" (developers.openai.com).

Not verified:
- Codex's own `model/list` on this machine. The spike's Codex list was written from OpenAI's
  Codex models page.
- What Claude Code's JSON holds when Haiku 5.5 declines a request.
- The advisor on more than two briefs. That is the plan's eval.
- Times while an agent is already busy.

## V75a — the advisor and its prompt, built (2026-10-28, branch `milestone/v75-suggested-settings`)

Built `packages/cli/src/workspace-advice.ts`, the `advisor` prompt key, the schema, the checks and
`POST /api/workspaces/suggest`, with `advisor.model` and `advisor.effort` read from the config;
decisions 544, 546, 547 and 550. The eval script writes a labels sheet and runs the advisor on it.

**Learned**:
- **A successful Claude Code answer ends on `stop_reason: "tool_use"`.** Its schema's answer is a
  tool call, so only `structured_output` says it answered. A refusal is read from
  `stop_reason: "refusal"`, which was not seen for real.
- **`runProgram` already closes stdin.** It starts every program with stdin ignored, so the spike's
  240 s wait cannot happen through it. Only a hand-run `codex exec` needs `< /dev/null`.
- **Codex names its models its own way.** `model/list` calls Luna "GPT-6-Luna", where OpenAI's
  docs say "GPT-6 Luna". The proposal uses the list's name.
- **Two tests pin Scout's and Scribe's prompts to the end of Settings' list.** The advisor's prompt
  went with the workspace prompts instead, where a start's prompts already are.

**Verification**: tests first, red because `workspace-advice.js` did not exist: 17 unit tests (the
commit message says 15) and a server test. `pnpm check`: 2,183 tests pass. `pnpm build`, then the
route asked through a real `symbiote view`: Claude Code (Haiku 5.5) answered in 2.9 s, Codex
(GPT-6-Luna) in 3.3 s, each with a size that fits the brief; no run folder left in the cache.

Not verified:
- What Claude Code writes when Haiku 5.5 declines. The test uses a hand-made result.
- `model_instructions_file` with a Windows path.
- Two presses at once.
- The eval: it waits for the person's labels.

## V75b — the button and the proposal on the Start page (2026-10-28, branch `milestone/v75-suggested-settings`)

Built **Suggest settings** in the Start page's head and the proposal's card in the run's column,
shown only while it is open (`StartSuggest.tsx`, the pure `suggest.ts`); decisions 548 and 549.

**Learned**:
- **The run's column had 9 px to spare at 1440 × 1000.** Measured with a throwaway spec: the seven
  cards and their gaps took 891 of the body's 900 px. A 129 px card for the button made the page
  scroll, so the button moved to the head and the proposal shows only while it is open.
- **`git checkout <file>` to drop a measuring line takes every edit in the file with it.** It
  reverted this part's new e2e test, which was rewritten from the session. Measure in a spec file
  of its own, deleted after, as the `symbiote-style` skill's traps advise for screenshots.
- **The theme is Symbiote's, not the browser's.** A screenshot with Playwright's light
  `colorScheme` was dark: the page keeps its own theme setting.

**Verification**: tests first, red because `suggest.js` did not exist: 5 viewer unit tests and an
e2e test of the whole flow against the fake Claude Code, which now answers `--json-schema`.
`pnpm check`: 2,188 tests pass. `pnpm build`; the e2e suite: 336 of 337 viewer tests passed, the
one failure Settings' count of entries (19 with the new prompt), which passed after the change; the
nexus' 14 passed. In the built app, the real Claude Code (Haiku 5.5) proposed Opus 5.5 at high
effort, plan first, for a storage migration, in 3.9 s.

Not verified:
- The whole viewer suite again after the Settings change: only `settings.spec.ts` ran again.
- A proposal on a phone's width.
- The light theme on screen.

