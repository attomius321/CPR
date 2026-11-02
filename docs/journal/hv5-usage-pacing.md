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
