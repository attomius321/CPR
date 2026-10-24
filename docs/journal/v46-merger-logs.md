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
