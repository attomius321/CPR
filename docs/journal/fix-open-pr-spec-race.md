# Journal: Fix — `open-pr.spec.ts` raced two opens to VS Code's log

[Index](../JOURNAL.md)

## Fix — the spec waits for each open before the next (2026-10-28, branch `feature/symbiote-nexus-upgrades`)

The person's `pnpm test:e2e` failed once in `packages/viewer/e2e/open-pr.spec.ts` ("a click
picks the comment line, Ctrl/⌘+click opens it, o opens the picked one"), with no viewer change on
the branch. Before the fix it failed here 1 time in 155 runs (15 alone, then 80 alone and 60 on
6 workers, all passing). Made on the NX2 workspace's branch, which the person asked to be the only
one.

**Learned**:
- **The product is right; the spec raced itself.** The spec clicks line 11's number (an open)
  and presses `o` (an open of the picked line 12) within milliseconds. Each open is a request of
  its own: the server finds the line in the working copy (`git`), then runs `code`, here a fake
  that appends to a log. Two requests at once finish in either order, so the log read
  [12, 12, 11] where the spec expected [12, 11, 12], the order of the actions.
- **The line number does not move the pick**: its click stops at the button
  (`stopPropagation`), and `o` opened line 12 every time. Only the log's order varied.

**Verification**: a throwaway copy of the spec whose fake `code` waits 400 ms for line 11 failed
3 of 3, with the log [12, 12, 11]; the same copy waiting for the second open to be logged before
`o` passed 3 of 3 (both copies removed). The fixed spec passes 30 of 30.

Not verified: the person's own run of the whole suite after the fix.
