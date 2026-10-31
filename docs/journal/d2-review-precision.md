# Journal: D2 — Findings precision on real pull requests (spike)

[Index](../JOURNAL.md) · [Plan](../plan/d2-review-precision.md)

## D2 spike — findings precision on 51 merged pull requests (2026-10-31, branch `spike/review-precision`)

51 pull requests merged into `main` in Aug–Sep 2026, 17 each of zod, vite and Bitwarden (Angular
plugin), drawn with a seed; each analyzed as `symbiote diff <merge>^ refs/pull/N/head` with
dependencies installed. The agent scored all 97 findings and the AI reviewers' 119 top-level
comments on the same pull requests, with evidence; the person scored a blind sample of 35. Answer:
not yet (the plan's Results).

**Learned**:
- **Merged heads compile**: not one `removed-still-referenced`. 75 of 97 findings are
  `signature-changed`, 59 of them `info` notes a reviewer acts on never (all users updated,
  parameter names only).
- **Most wrong warnings fail on what a user uses**: a type named but its changed member not read,
  a return value ignored, a map key or enum member others don't name. Counting "users not updated"
  by reference is what makes the warning false.
- **Framework conventions make the wrong orphans**: Storybook stories (6), Angular `effect()`
  fields (3), members read by an inline `template:` (2) — 11 of the 12 `orphan-added` warnings.
- **"Published" misfires in monorepos**: `@bitwarden/vault` (version 0.0.0, no `"private": true`)
  made 4 `exported-api-changed` warnings about code outside the repo that cannot exist.
- **AI reviewers on the same pull requests**: pullfrog (zod) and claude[bot] (Bitwarden) were acted
  on most of the time, and pointed at 3 of the 4 later fixes or reverts; Symbiote at none. They
  comment during review, on earlier heads; Symbiote ran on the final ones only.
- **A blind sample needs friction to be a check**: the 35 answers came within 65 seconds, 33 "worth",
  0 "wrong", agreement 20 % (κ 0.02). Next time: a note required on each item, or 10 items with a
  reason each, and look at the timings before computing agreement.
- **Traps**: zod's `packageManager: nub@0.8.3` stops pnpm (temporary `pnpm-workspace.yaml`); this
  `gh` has no `--slurp` (page by hand); pullfrog both reviews and applies its own suggestions in
  zod, so "Addressed in …" replies are its own.

**Verification**: the scripts in `spikes/d2-review-precision/` rebuild the selection, runs, GitHub
data, follow-ups and tables; `results.md` lists every finding and comment with its score and
evidence; the agent's scores stayed out of the branch until the sample was in. 51 runs, no errors;
zod 5.9–10.6 s, vite 1.3–5.6 s, Bitwarden 17.7–31.8 s each.

Not verified: the agent's scores beyond the sample (it did not confirm them); three unanswered AI
comments judged by reading; Symbiote on the heads the AI reviewers commented on; recall beyond the
4 follow-ups.
