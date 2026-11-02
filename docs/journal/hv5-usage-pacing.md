# Journal: HV5 — Hive paces itself by usage: a pause until the window resets, a budget cap

[Index](../JOURNAL.md) · [Plan](../plan/hv5-usage-pacing.md)

## HV5 plan — where Hive starts agents, what usage and spend Symbiote can read (2026-11-02, branch `feature/hv5-usage-pacing`)

Read HV1's sketch (decision 690), HV3's review cost, HV4's and HV8's runner, `usage.ts` and the
workspaces' start. Hive starts an agent in four places — the writer's first start
(`workspaces.start`), every message (`deliver` → `reply`, a stop and a resume), a failed writer's
restart (`startAgent`) and each running review (`startReview`) — and reads usage at none of them.
Measured HV8's spend on this repository's records (read only): the writer $29.18, 8 reviews at
xhigh $18.02, $47.20 in all.

**Learned**:
- **Claude Code writes its own cost count into the transcript**: a `{"type":"cost-state",
  "totalCostUSD": …}` line at each turn's end, cumulative through resumes of the session (HV8's 24
  lines grew $1.78 → $29.18, `startTime` the same). It is the last line of a transcript at rest, so
  the end of the file is enough. `~/.claude.json`'s `lastCost` is per project folder, not per
  worktree: the Symbiote worktrees are not in it.
- **`WorkspaceHive.paused` is taken**: it means Hive is off. The usage pause is `pause` in the
  card's and the Review tab's types, `paused` in Hive's record (the brief's word).
- **The viewer's e2e runs with `SYMBIOTE_USAGE=off`**, and `serveWorkspaces` already serves a fake
  usage endpoint: with usage off the gate is off, so every Hive e2e stays as it is, and the pause's
  e2e uses the fake.
- **Decision numbers**: the highest on `main` and every branch was 795; HV5 takes 796–802.

Not verified: everything; nothing is built.

## HV5 — Hive paces itself: one gate, a pause until the window resets, a budget cap (2026-11-02, branch `feature/hv5-usage-pacing`)

Every agent Hive starts — the writer's first start, each message (a resume starts a turn), a
restart, each running review — now goes through one gate, `paced` (`hive-pacing.ts`). Any window
of Claude's subscription at or over `hive.usage.pauseAt` (90 %) holds every start of every Hive
workspace until the window that resets last resets; the pause is in each held workspace's record
and survives Hive off/on and a restart. Usage unread for 15 min pauses as unknown. `hive.budget`
stops a workspace whose writer's sessions (Claude Code's `cost-state`) and running reviews reached
it. The card, the head and the Review tab say the pause; the Review tab the spend; Settings' Hive
page sets both. Decisions 796–803 (803 added while building).

**Learned**:
- **A pause of hours makes the person's own moves likely.** Two paths HV4 never met: the person's
  message reaching the writer while Hive's waits (Hive's would have gone on top of their turn at
  the reset), and the page's **Start the agent** on a held writer (the runner would have started
  a second session). Both are theirs now (decision 803). The second was found by the screenshots:
  the held writer's head offered the button.
- **A pause must leave the record when its step does.** A held review's workspace merged by the
  person would have kept `paused` into `landed`; `moveTo` drops it at any change of step, and the
  card shows it only in `writing` and `reviewing`.
- **The unseen-turn rule (719) counts from the step's `since`.** A writer held for hours and then
  started would have been "a turn Hive cannot see" at once, its `since` the workspace's creation;
  the held start sets `since` to the start.
- **The workspaces list is not polled with no workspace open**: an e2e that starts one through
  the API must reload the page.
- **Every HV4 and HV8 runner test passes unchanged**: without `pacing` the runner is `main`'s, and
  a test runs one workspace's whole path with and without a gate under the threshold and compares
  steps, events and messages (equal but for commit SHAs, which differ by time).

**Verification**: the runner's tests red first (10 of 11 failed for the reason each names: sent
while paused, a review started, a writer started, no stop at the budget), then green; the gate's
17, the runner's 12, `usage.test.ts` 3 new, the viewer's 10; `hive-runner.test.ts` and the
`hive-request-*` suites unchanged; `packages/cli` 1,426 tests before the wiring; the viewer's 775
unit tests; `tsc -p packages/cli`; `pnpm check` 2,900 tests, and `pnpm build`. e2e `hive-pacing.spec.ts` 3 of 3, and with the Hive, Settings,
targets, page-frame and usage specs 46 of 46. Screenshots dark and light of the paused workspace,
Settings' Pacing and a workspace stopped at its budget (`packages/viewer/coverage/hv5-shots/`, not
committed).

Not verified: a real Hive run paused by real usage (the brief: tests never read the real endpoint;
no real run was made); a real 5-hour window resetting; the `cost-state` line in Claude Code
versions other than 2.1.316; a writer whose session was forked into a copy (its transcript is
counted on its own); the time words in a time zone other than this machine's.

Merged into main (2026-11-02).
