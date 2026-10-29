# Journal: Fix — `scout.spec.ts` read Scout's record before it was written

[Index](../JOURNAL.md)

## Fix — the spec waits for Scout's record (2026-10-28, branch `feature/nexus-improvements-v2`)

The merge check of NX3 failed once in `packages/viewer/e2e/scout.spec.ts` ("another agent picked
in its head starts nothing: New conversation starts it"): `ENOENT … symbiote/scout.json`, 335 of
336 specs passing, with no viewer or CLI change on the branch (the same tree had passed the whole
suite here an hour before). Made on the NX3 workspace's branch, the one the person reviews.

**Learned**:
- **The product is right; the spec read too early.** With Codex, Scout starts the thread on the
  app server, then writes `symbiote/scout.json` (`packages/cli/src/scout.ts`, `start`). The spec
  waited for the fake app server's `thread/start` call, then read the record at once. Under the
  merge check's load (16 workers) the read can come between the two.
- **New conversation's removal is not raced**: `renew` removes the old session and the record
  before the page starts the next one, so the spec's `removed()` check after the thread holds.

**Verification**: the built CLI with the record's write delayed 300 ms (a throwaway edit of
`dist/scout.js`, restored) failed the spec 3 of 3 with the merge check's `ENOENT`; with the spec
polling for the record it passed 3 of 3 on that build. On the real build the fixed spec passes
30 of 30.
The whole suite after it (`pnpm build && pnpm test:e2e`): the viewer's 336 specs in 5.1 min, then
the nexus's 15 in 17.3 s.
