# Journal: V30 — Start a workspace on a page, with the agent's effort

[Index](../JOURNAL.md) · [Plan](../plan/v30-start-page.md)

## V30 spike — the start dialog, and how agents keep an effort level (2026-10-21, branch `milestone/v30-start-page`)

Asked: "the create a workspace should not be in dialog. it should be itself a page, rendered fully
on the right of sidenav, and with an option for initial effort, for that session".

**Learned**:
- **The dialog is the same 640×626 px at every window size**: 38 % of the main area at
  1440×900, 23 % at 1920×1080. With More open its content is 883 px and scrolls inside the dialog
  at 1280×720, 1440×900 and 390×844; only 1920×1080 holds it. Its text areas are 598 px wide
  whatever the window. Measured with a throwaway spec on `serveWorkspaces`, deleted after.
- **Claude Code keeps `--effort` for the session, through Symbiote's reply.** Each assistant line of
  its transcript records `effort`. `--bg --effort low` ran `low`; after `claude stop`, a
  `--bg --resume <id> "<text>"` without flags said "woke session … with its saved options (--name,
  --effort, --model)" and ran `low`. A resume of a session still running started a copy, which
  ran `medium` — neither the start's level nor the person's `xhigh`. Symbiote stops first (V18c), so
  it never makes that copy.
- **Claude Code ignores a level it does not know, without failing**: "Unknown --effort value
  'bogus' — ignoring it and using the default effort", exit 0. A fixed list in Symbiote could offer a
  level that silently does nothing; its `--help` line lists the levels (low, medium, high, xhigh,
  max) and takes 70–90 ms. All five ran on Haiku, Sonnet and Opus 5.5.
- **Codex's app server keeps a thread's effort**: `effort` on the first `turn/start` gave `low`
  to that turn and to the next one sent without it, and `thread/resume` on a new connection
  reported `low` (each turn's level from its rollout's `turn_context`). `model/list` (1.1 ms)
  gives each model's levels and default; `gpt-5.6-terra` has one more level (`ultra`) than
  `gpt-6-luna`. `config/read` (3 ms) gives the configured model and level (`medium` here).
- **`codex exec resume` drops the level**: started with `-c model_reasoning_effort="low"`, the
  resumed run was `medium`. Like the sandbox (V20a), it must be given on every run.

**Verification**: real runs only, one-word prompts, in a detached worktree of this repository
(trusted through the main checkout): 3 Claude Code turns in the background, 5 `claude -p` runs,
2 Codex turns on the person's daemon and 2 `codex exec` runs. The sessions were removed (`claude
rm`), the threads archived, the worktree deleted.

## V30a — Start a workspace on a page (2026-10-21, branch `milestone/v30-start-page`)

"Start a workspace" is `/start` in the main area, right of the sidenav: a head strip with where it
starts and Cancel, Clear and Start; the brief in a column up to 760 px, the branch and the agent
in a 300 px column beside it, under it below 1,000 px of page. The dialog is gone.

**Learned**:
- **A page that saves on leaving races its own next visit**: Escape posted the draft as the page
  unmounted, and `n` right after read it in the same moment. The page keeps its last save as a
  promise and reads the draft after it.
- **"Back to where it came from" needs to know there is a Symbiote page behind it.** `history.back()`
  from a tab opened at `/start` would leave Symbiote (or do nothing); the Navigation API's entry before
  this one, same origin or not, decides. A diff before `/start` is Symbiote's too: Back loads it.
- **A link was the simpler ⊕**: the shell already opens its own addresses in place from any link,
  and on a diff a link loads the page; a button needed both paths written out.
- **A flex head squeezed "From main at …" into a 60 px column at 390 px**; a grid with its own
  narrow areas puts it on a row of its own.
- **Margins that line the two columns up separate nothing in one column**: the Branch field sat
  against "More" at 390 px until its zero margin was kept to the two-column layout.

**Verification**: unit tests first (route, title, the server's `/start`: red), then 1,055 unit
tests, format, lint, typecheck, build. e2e: `start.spec.ts`'s 6 tests red on the plan's build,
then green; 52 tests in 8 specs moved from the dialog to the page; 165 of 165. The page's
measurements and `n`'s time against `main`'s dialog (median 37 against 41 ms) are in PLAN.md's
V30a results. Screenshots at 1280 × 720, 1440 × 900 and 390 × 844, dark and light. Not verified:
Firefox and Safari; the Electron window by eye.

## V30b — the agent's effort, for the session it starts (2026-10-21, branch `milestone/v30-start-page`)

Start a workspace offers an Effort choice beside the agent: its own default, or a level the
installed agent lists (Claude Code's `--help`; Codex's configured model, from its app server).
The level goes to `--effort`, to Codex's first `turn/start`, or to `model_reasoning_effort` on
every `exec` run; it is recorded with the workspace, used again by Start again, and said on the
Brief tab as how the agent was started.

**Learned**:
- **A level belongs to its agent, so the draft keeps the agent with it.** Keeping only the level
  made a draft whose agent was not picked lose it: the level was read against no agent. With no
  agent picked, it is the first agent's, the one the page shows.
- **Without Codex's daemon there is no list, but there can be a level**: a workspace started on
  the app server and started again after the daemon stopped falls back to `exec`, which keeps
  nothing between runs. The recorded level is given to each run.
- **A test harness written as a template literal needs its escapes doubled**: the fake Claude
  Code's `--help` broke the whole fake (a newline inside a JS string) and failed unrelated tests
  first ("each kind starts a workspace").
- **A muted line under a select reads as that select's note**: Codex's sandbox line under Effort
  looked like it explained Effort, so it became a field of its own.

**Verification**: tests first (14 CLI tests and 3 viewer tests red, then green; the draft's
reader written with its test), 1,070 unit tests, format, lint, typecheck, build, 167 of 167 e2e.
A real Claude Code workspace started through Symbiote's endpoint at `low`: its transcript's turns
`low`, before and after Symbiote's reply, in one session. The options endpoint 5 ms slower warm
(Codex's two calls). Not verified: a real Codex workspace through Symbiote (a trust entry would be
left in the person's Codex configuration), Codex `exec` with a level beyond unit tests. Numbers in
PLAN.md's V30b results.

Merged into main (2026-10-21) with V30a, no conflicts (`main` had not moved). `main` verified
after the merge: frozen install, 1,070 unit tests, format, lint, typecheck, build, 167 of 167 e2e.
