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

## HV3 — the running reviewer, built (2026-10-31, branch `feature/hv3-running-reviewer`)

After a passing check, Hive clones the repository at that commit into its cache, installs it, and
runs a clean-context `claude -p` there, its commands in Claude Code's sandbox. Each defect it
reports with a test is rerun by Symbiote on a fresh clone under bubblewrap, and kept only when its
test fails there. Kept findings go to the writer with their tests, round by round; none kept asks
landing, which in Hive mode is Land in the workspace's head, the Review tab showing what Hive did.
Decisions 674–681.

**Learned**:
- **The branch's own settings would run outside the sandbox.** With `--setting-sources
  project,local`, a project hook ran (a scratch repository's `UserPromptSubmit` hook); with `""`,
  nothing of the project's runs, and CLAUDE.md is not loaded either. The reviewer reads the
  project's instructions as a file instead.
- **Claude Code has no way to sandbox another program's command**, so Symbiote calls bubblewrap
  for its rerun: `--ro-bind / /`, the copy writable, `--tmpfs /tmp` (a copy under `/tmp` is bound
  after it and works), `--unshare-net`. Do not add `--new-session`: it leaves the process group,
  and Hive off kills by group.
- **`failIfUnavailable` makes the missing sandbox a clean answer**: Claude Code 2.1.316 exits at
  once with "sandbox required but unavailable: … socat not installed", before any token is spent.
- **A pid in the record before the fake has recorded it** read 0, and `process.kill(0, 0)` is the
  test's own group: always alive. Wait for both before comparing.
- **A killed runner's review still finishes in the test's process** and removed the copy folder the
  next runner's review was using; each review now has a folder of its own.
- **A test name of one letter is found in any output.** The guard is a substring; real names are
  sentences.
- **Two Lands on one page** (the head's and the tab's) read as two actions: the head keeps the
  primary.
- **HV2's e2e had a race that HV3's longer step showed**: the suite's fake logs a resume before
  its `UserPromptSubmit` hook runs, so a test that reports right after seeing the resume can record
  its report before Hive's prompt; the turn then reads as not ended ("Waiting: for you"). It failed
  once in the full suite under load, never alone. Both Hive specs now wait for Hive's record to say
  its message was sent (written only once the resume, hooks and all, returned).

**Verification**: tests first, red for the right reason (12 of 23 runner tests: no review step;
then 6 for the leftover branch folder and a test that read a pid too early). `pnpm check` 2,625
tests. e2e: the viewer's 369, 368 passed and `hive-loop.spec.ts` failed on the race above; with the
fix, the two Hive specs 12 of 12 (each 3 times); nexus 20 passed. Screenshots of the Review tab,
Settings' Reviewer and Hive mode, dark and light, 1440 and 820 px wide.

Not verified yet: a real reviewer (Claude Code's sandbox needs `socat`, missing here) and the real
Hive run; macOS and Windows, where nothing is reviewed.
