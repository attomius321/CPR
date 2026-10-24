# Journal: V46 — Merger logs: what a merge is doing, and its files

[Index](../JOURNAL.md) · [Plan](../plan/v46-merger-logs.md)

## V46 spike — what a merge could show while it runs (2026-10-24, branch `feature/merger-logs`)

Read the merger on `main` (`561826d`): `merges.ts`, `merge-agent.ts`, `Merge.tsx`. Measured this
repository's `merge.checks` run as `runShell` runs them (a shell, stdout and stderr piped), six
small `claude -p` runs on a hand-made conflict (Claude Code 2.1.310, `sonnet`), one `codex exec`
(0.163.0), and every merge on every branch replayed with `git merge-tree --write-tree`.

**Learned**:
- **The wait is the check.** Install 0.2 s, `pnpm check` 47.5 s, build 3.4 s, `pnpm test:e2e`
  167 s: 218 s with one line on the page. The check wrote 365 lines, 30 KB, in bursts, with up
  to 18 s between two (the unit tests run, then print). A live log alone would still look stuck
  for 18 s: a running step's time has to count up.
- **Piped, nothing here writes colour or `\r`.** pnpm, Vitest, Vite and Playwright all checked
  for a terminal and wrote plain lines. Another project's tools may not.
- **A passed check's output is already kept and never shown**: `Merge.tsx` shows "Its output"
  only when `check.ok === false`.
- **Claude Code streams everything but its thinking by default.** `stream-json` with `--verbose`
  and `--include-partial-messages` gave the tool call (`Read notes.txt`), its result, the text
  in 19–45 deltas, and the same `result` object `--output-format json` gives. Where the sides
  disagreed the model thought (161–250 thinking tokens), but every thinking block and delta was
  empty: `thinking_display: "updates"` sends only token estimates. `--thinking-display
  summarized`, a flag missing from `claude --help` but listed in the binary with
  `summarized` and `omitted` accepted, streamed a summary (198–333 characters). The documented
  `showThinkingSummaries` setting, given with `--settings`, did not. On a trivial region the
  model did not think at all (0 thinking tokens, with or without `alwaysThinkingEnabled`).
- **Codex already streams** (`exec --json`), but the merger reads its stdout only after it exits.
  At its default configuration it gave no `reasoning` item. It refuses to run outside a git
  folder ("Not inside a trusted directory"); the merge worktree is one.
- **The person's Claude Code hooks run in the merger's `claude -p`**: two `SessionStart` hooks in
  each run. Not V46's to change; noted in the plan.
- **Half the conflicting merges here touch more than one file.** 22 of 125 merges conflict when
  replayed: 12 in one file, 10 in 2–4 (up to 7 regions, `e380fef`: README, JOURNAL, PLAN and an
  e2e spec). Today all regions are one list.

Planned as V46 (decisions 313–318): a log file per queue entry streamed to the page in a
read-only terminal beside the merge's steps (V46a), the merger agent's thinking summaries and
tool calls in it (V46b), and a resolution's files as a list (V46c). Three questions are left to
the person: the merger's effort, terminal or page text, and a file's whole merge in VS Code.

## V46 — a merge's log, the merger agent at work, a resolution's files, the merger's effort (2026-10-24, branch `feature/merger-logs`)

The plan OK'd with its questions answered ("1. Add a merger effort in settings. 2. Yes 3. Yes,
recommendation. Ok"). Each queue entry writes its steps and their output to a log of its own,
streamed to its page: the steps beside a read-only terminal (V46a). The merger's `claude -p`
streams its thinking's summary, tool calls and text into it; Codex's items too (V46b). A
conflicted merge lists its files, each with what its resolution did; a click shows its regions
(V46c). `merge.effort`, set in Settings, is passed to the merger's runs (V46d). Decisions 313–319.

**Learned**:
- **The log found the fake's bug.** With the fake Claude Code moved to `stream-json`, every
  conflict e2e stopped at "Conflicts with main in 1 file". The page's own log said why: "The
  merger agent did not answer: … at node:internal/main/run_main_module". A `'\n'` in the
  fake's template had become a real newline in the generated script. Before V46 the page said
  only the state.
- **A newline in a template that writes a script needs `\\n` in the source**: Python's `\\n`
  wrote `\n` into TypeScript, which the template turned into a line break inside a string.
- **The command heads its own step**: an e2e that checked "second half" was not printed yet found
  it in the heading `── echo first half; …; echo second half`. Its output is now computed
  (`$((40 + 3))` prints 43), so the text appears only when the command prints it.
- **A step that throws stayed open.** The queue's drain catches a merge that throws, but its step
  had no end and was drawn "stopped". Found reading the diff: the drain now writes what it said
  and ends the step. Each process keeps its own steps' starts, so an `end` with no step open in
  it writes nothing.
- **The init event lists the person's skills, plugins and memory path**: the recorded stream kept
  as a test fixture is trimmed to the fields Symbiote reads; no account data.
- **Files first only once resolved**: the default tab follows the entry (Files when a
  resolution is there to read and nothing runs), the person's pick wins after, and both views
  stay mounted so the log keeps streaming in the background.
- **The real answer buried the thinking.** On `e380fef` the agent's answer was 18.8K tokens of
  escaped JSON, streamed after 703 characters of thinking summary: a terminal of `\n`-escaped
  journal entries, the part asked for ("its thinking process") a few lines at the top. Its
  content is on Files region by region, so the answer is now one line counted in place ("Writing
  its answer: 46,788 characters"); prose that is not the answer is written as it comes.
- **The agent read no file** on that merge: 5 regions in a 51K-character prompt were enough. Its
  visible process was its thinking summary, first shown 4.0 s after it started, and the count.
- **A step's name is a button's name too.** Playwright matches `{ name: 'Land' }` by substring,
  so the landing's step ("Land: passed, 0.0 s") met it. The V16/V17 review spec failed once in
  the full run and passed alone: it depended on whether the log's landing line had arrived. The
  merge page's Land locators are exact now.
- **"Kept twice" flags correct resolutions** (the merge page remake's review, not V46): on that
  merge, which the agent resolved exactly as committed, `JOURNAL.md` read "2 lines kept twice" and
  `PLAN.md` "10", because both sides added entries with their own `**Learned**:` and table lines.
  Files puts each file's flags together, so it shows them. Left for a fix of its own.

**Verification**: tests first, red for the reason given: the log's lines (13 in the merger's
tests, 7 of the log file), the agent's stream (3, on a recorded Claude Code 2.1.310 stream trimmed
to the fields read), the routes, the effort (6), the viewer's steps, terminal text and files (17).
`pnpm check`: 1,449 tests. e2e: 225 of 225 on the last full run (the two earlier ones: 224, the
V17 spec reading the old list, then the Land locator above); new specs
(a check's output while it runs; the agent's thought and file read while it works; two files) and
the Merger's Effort in Settings. Screenshots at 1440×900 and 390×844, dark and light: running, the
agent at work, a resolution's files, the log, Settings. No page error.

Real use: `e380fef` replayed through `symbiote merge` in a throwaway clone with the real Claude
Code (`sonnet`) and a conflict-marker check: resolved equal to the committed merge, 85 s, 27.0K
tokens in and 18.8K out; then its page in `symbiote view` on that clone, Files and Log.

Not verified: a real Codex merger (its events are tested on recorded shapes; at its default it
gave no reasoning item in the spike); a Claude Code without `--thinking-display` (the fallback is
tested on its error text); a check writing past 512 KB in a real merge (the cap is tested on the
log file); the summaries' cost on a real merge (one run); macOS and Windows; `regression-check`
(no analysis code: core gained types and one optional queue field).
