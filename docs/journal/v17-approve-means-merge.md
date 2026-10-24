# Journal: V17 — Approve means "merge it": a verdict for the agent, not a push

[Index](../JOURNAL.md) · [Plan](../plan/v17-approve-means-merge.md)

## V17 spike — what an approval should do (2026-10-14, branch `milestone/v17-approve-means-merge`)

Asked after approving four branches in Symbiote and asking for each merge in chat: "How can we automate
this…", then "Aprove is just a metadata...that will tell the agent to merge into whichever is the
default branch of that git repository", for any repository, and "not automatically" (the person
tells the agent to act on the review). Measured on this repository: V16's push on Approve did
nothing on 0 of 4 approvals — the agent had pushed each commit 2–4 minutes before, and `origin`'s
reflog holds only the agent's push — while all 4 were followed by asking for the merge in chat.
Reproduced through `symbiote view`'s `/api/reviews` on a temporary repository: a branch approved at its
tip, then 5 commits on `main` merged into it, shows "+6" and the "new since your review" dot on
all 5 of `main`'s commits; the branch's own new commits: 1, the merge. So "since" must leave out
the default branch's commits, or resolving a conflict the usual way (merging the default branch
in) floods the review. Checked `git merge-tree --write-tree --name-only` (git 2.43 here; 2.38+)
against the default branch on 40 recent unmerged branches each: Bitwarden 2 conflicting, median
3 ms, max 871 ms; Qwik 19 conflicting (long-lived lines such as `v1`, `v3`, 57–59 files), median
599 ms, max 5.2 s; this repository's 70 branches are all merged. It touches no checkout, index or
ref (it writes loose objects), so the Review tab can say "conflicts with main in …" before an
approval, in the background. The rules an agent follows lived only in this repository's
`symbiote-review` skill; for any repository Symbiote must write them itself, next to the reviews.

## V17 — Approve means "merge it" (2026-10-14, branch `milestone/v17-approve-means-merge`)

**Learned**:

- Claude Code loads a folder's `AGENTS.md` itself when it reads a file there, a git-ignored
  folder included: with only a review file read (one `Read` in the log) it knew a marker word
  that only `symbiote/AGENTS.md` held, with or without a `symbiote/CLAUDE.md`; reading the same JSON from
  another folder, it did not. The planned `symbiote/CLAUDE.md` would only have loaded it twice.
- An agent told nothing but "Check my Symbiote review of the branch agent and act on it" found
  `symbiote/` by listing the repository, and followed `AGENTS.md` to the letter in both cases tried:
  the approved commit merged with `--no-ff` and the later one left for review; on a conflict, the
  merge aborted, `main` untouched, the conflict resolved on the branch, another review asked for.
  Neither pushed: the rules say to follow the project's, and the repositories had none.
- `git merge-tree` reports conflicts with exit 1 and its answer on stdout; `GitError` now keeps
  stdout. It writes loose objects only: no ref, index or file moved (a test checks it).
- On Qwik the conflicting paths took six lines of the sidebar. Asked then for "each file on
  it's line..with a icon that opens the file in vscode": a list, V12's icon on each, which opens
  the file through `/api/open` — extended to a branch review's conflicting files, since those
  need not be in the change (Qwik's `.api.md`). Tests first (the server refused `docs/api.md`;
  the e2e found no list on the old viewer).
- The V17a–b commit says "CLI 8" tests failed first; it was 11 (and 2 in the server).

**Verification**: tests first (core 3, CLI 11, server 2, viewer 2; e2e 3 of 4 review specs on
the old viewer). 602 unit tests, 71 e2e. The two agent runs above, checked in git afterwards
(`main`'s parents, the later commit not in `main`, `origin` unchanged, clean status) and in Symbiote
("+1" each; "merged" after the clean one; clean merge after the resolution). Qwik's
`origin/claude/http-error`: the conflict line 0.5 s after opening the Review tab, the graph in
6.7–10.3 s; screenshots light and dark, no page errors. Not verified: other agents than Claude
Code, git before 2.38, Windows and macOS.

Merged into main (2026-10-14). `main` verified after the merge: 602 unit tests, build, 71 e2e.
The first use of the flow: the reviewer approved `92c5276` in Symbiote ("Merge into main") and pasted
"Copy for the agent"; the agent read the verdict and `symbiote/AGENTS.md` (Symbiote had written it with
the verdict) and merged that commit, its parents the old `main` and `92c5276`.
