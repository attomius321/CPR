# Journal: V15 — Branch reviews in the repository

[Index](../JOURNAL.md) · [Plan](../plan/v15-branch-reviews.md)

## V15 spike — what a new commit costs a review (2026-10-14, branch `milestone/v15-branch-reviews`)

Measured before planning branch reviews. Outside `symbiote pr`, marks and drafts are kept per pair of
revisions (`stateDir`: a hash of `base..head` in the cache), so a commit added to a reviewed
branch starts the review over. On a clone of this repository, whose commits an agent wrote (189
of 206 carry its co-author line), each commit of four milestone branches (V9, V11, V12, V14) was
compared with its branch's fork point (`symbiote diff`, 1.0–1.4 s each), and the changed symbols of
the commit before were checked against it by fingerprint, I1's rule. Over the 15 times a commit
was added to a branch already reviewed, 1,027 of 1,051 marks (97.7 %) would still be valid: 11
symbols changed again, and 13 moved with a renamed file (`e75c1cf`; IDs hold paths). Looking at
each new pair from scratch means 1,197 symbols; keeping marks per branch leaves 170 (14 %).
The graphs' `files` list non-code files too (docs, Markdown), so review files committed in
`symbiote/` would show there, with no symbols. So the plan keys reviews by branch and, as asked, keeps
them in `symbiote/reviews/` at the repository's root, one file per reviewer: out of git by default (a
`symbiote/.gitignore` with `*` and `!config.json`, as pytest and ruff do), shared by deleting it.

## V15 — Branch reviews in the repository (2026-10-14, branch `milestone/v15-branch-reviews`)

"Review ▸" in a commit row's menu (or `r`) compares a branch's fork point with its tip; marks and
drafts are kept per branch, so after an agent's new commits only new and changed symbols are
left. Reviews are files in `symbiote/reviews/<branch>/<user.email>.json`, out of git by default (a
`symbiote/.gitignore` Symbiote writes once), shared by deleting it. The commits page shows "✓" or "+n" on
reviewed branches and a dot on commits added since. Plugins are read from `symbiote/config.json`,
else `symbiote.config.json`.

**Learned**:
- The fork point needs both default-branch refs: with a stale local `main` and an agent branch
  taken from `origin/main`, `merge-base <tip> main` starts the review commits too early. The
  latest merge-base of the local and remote refs is right in both cases.
- A `.gitignore` with `*` and `!config.json` hides itself and the reviews but keeps
  `config.json` trackable (checked in a temporary repository before planning on it). Writing it
  with the `wx` flag leaves a project's own file alone.
- Marks and drafts in one file means two writers (the viewer saves them separately): writes go
  one at a time per file, read, changed and written back atomically.
- The viewer saves state only on a reviewer's action, so opening a review never counts as
  reviewing it: a branch's "head" moves only when something was marked or written there.
- Tests that read `git config` must stub `GIT_CONFIG_GLOBAL`: the developer's own `user.email`
  otherwise leaks in.
- Planned with SHAs in the review header; the first screenshot showed them twice, next to the
  summary's.

**Verification**: tests first (core, CLI, server and the e2e spec all failed before the code).
587 unit tests, 67 e2e. On a clone of this repository through `symbiote view`'s API: `v12` reviewed
at `d175ee5` (83 symbols marked), tip moved to `86dcb60`: "+1", then 83 still reviewed and 2
left, as the spike measured; 1.6–1.7 s from "Review" to the graph; `git status` clean.
`/api/reviews` 10–24 ms on Qwik and Bitwarden. No analysis code changed (goldens unchanged), so
no regression comparison. Not verified: Windows, macOS, a review merged from two machines,
worktrees, Firefox and Safari.

Merged into main (2026-10-14). `main` verified after the merge: 587 unit tests, build, 67 e2e.
