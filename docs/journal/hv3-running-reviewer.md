# Journal: HV3 — Hive's running reviewer

[Index](../JOURNAL.md) · [Plan](../plan/hv3-running-reviewer.md)

## HV3 plan — the running reviewer on Symbiote's own pieces (2026-10-31, branch `feature/hv3-running-reviewer`)

Read HV1's answer and its prototype's running reviewer (`probe-review.mjs`, `hive.mjs`'s
`probeReview`), HV2's runner and record, the merger's `claude -p` run (V26c, V46b), the page agents'
gates (Nucleus, Scribe), the merge queue's approval rule, and Settings' prebuilt agents. The person
answered the plan's five questions: 1–4 as recommended; 5, a Review tab of the workspace's own,
"In hive mode, there will be no more human review process".

**Learned**:
- **A worktree is not a throwaway copy.** HV1's runner made the reviewer's copy with
  `git worktree add`, which shares the repository's branches and config: a `git push` or
  `git branch -f` from it reaches the real repository. A `git clone --shared` with no remote has
  refs of its own and copies no object.
- **The person's user settings must not reach the reviewer.** They hold an MCP server (Kubernetes,
  apply and delete allowed), hooks and plugins: `--setting-sources project,local` and
  `--strict-mcp-config`.
- **Claude Code's sandbox needs `socat` on Linux**, and this machine has only `bwrap`.
- **Merging needs an approval** (the branch's last verdict `approve` at its tip, V26): Land in
  the workspace's Review tab records one for the person, and sends the writer nothing, which Hive
  would read as the person taking over.
- **Decisions up to 673 are taken**, on `main`, every branch and every worktree; HV3 and 674–681
  were free.
