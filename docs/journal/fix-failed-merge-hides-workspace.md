# Journal: Fix — a failed merge hides its workspace

[Index](../JOURNAL.md)

## Fix — a failed merge hides its workspace (2026-11-03, branch `fix/failed-merge-hides-workspace`)

The person, on `fix/fix-nexus-top-left` (merge 86ad722d, failed on `pnpm test:e2e`): after the
merge's check failed, the workspace's card was gone from the sidenav, shown only as its row under
Merging. **Send to the agent** did send, and the agent answered, but the page stayed on the merge
with a status-bar notice and nothing that led to the workspace: to the person, sending did nothing.

**Learned**:
- **V93's Merging alone counted every entry not landed**, failed ones included
  (`Sidenav.tsx`'s inline filter). A failed merge waits in the queue until Retry or Remove, so its
  workspace stayed hidden for as long as the fix took: exactly while its agent had work to do.
- **Sending records nothing on the entry**: `failure()` in `packages/cli/src/merges.ts` only builds
  `merge.failed`'s text. "Sent back" cannot be read from the queue, so the rule goes by the entry's
  state: the card is back once git or the check failed (`failed`, or `needs-you` after a
  resolution's check failed), the states where Send to the agent is offered, plus a git failure.
  It stays hidden while the entry is queued, runs, is `ready`, or is `needs-you` with nothing
  failed: there the next step is on the merge page. The person agreed (needs-you with a failed
  check too). A later merge of the branch, queued, hides it again; the failed entry stays listed
  under Merging beside the card until it is removed.
- **The rule is one pure function**, `mergingAlone` (`workspaces/merges.ts`), moved there
  unchanged first so the unit test failed on behaviour rather than on an import.
- **Send to the agent opens the workspace** (`shell.navigate`), the notice kept; the merge page's
  branch is a link to its workspace while the list has it (a cleaned-up workspace has no page). It
  takes the `.link` recipe, which does not undo an anchor's underline: the first screenshot showed
  it underlined at rest, fixed in `Merge.css`. The shell's capture listener makes a plain `href`
  open in place, so no click handler was needed.
- **No decision number**: fixes record none, and the register (`consolidate.mjs`) reads numbers
  from plans only. The rule is in the merger's area page, with a trap.

**Verification**: the unit test (`test/merges.test.ts`, `mergingAlone`, 3 cases) failed first on
the failed cases ("expected true to be false"); the AR2 e2e (`merge-send.spec.ts`), extended to
expect the card beside the merge's row after the failed check, the branch's link, and the
workspace opened and picked after the send, failed first at the card (element not found). Both
pass with the fix. `pnpm check`: 225 files, 3,063 tests. `pnpm build`.

`pnpm test:e2e`, first run at a load average of 17 to 399 (another session's `node -e for(;;){}`
loops and other worktrees' checks): 420 of 424 in the viewer. The 4 failures were
`terminal-view.spec.ts:165` (an agent's attach count, a known flake under load),
`workspaces.spec.ts:1355` and `:1408` (a line and images typed into a terminal), and `:2276`, in
`approvedWorkspace` before any merge. Rerun alone, the last three passed; `:165` failed again at
that load and passed 5 of 5 after the machine restarted (load 0.3). The nexus suite: 20 of 20.
Rerun in full at low load: 424 of 424 in the viewer, 20 of 20 in the nexus. After the link's
underline fix: `merge-send`, `merges`, `page-frame` and `targets` specs, 24 of 24.

Screenshots at 1×, dark and light (a spec in the ignored `coverage/failed-merge/`): the merge
page's head with the branch as a link, its tip "Open its workspace", the workspace's card under
To review and the merge's row under Merging; after Send, the workspace's page with its card picked
under Working and the notice in the status bar. Not verified: Hive mode, whose sidenav
(`HiveSidenav`) never used Merging alone and is unchanged.
