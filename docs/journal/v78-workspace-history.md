# Journal: V78 — History: finished workspaces, their activity and brief

[Index](../JOURNAL.md) · [Plan](../plan/v78-workspace-history.md)

## V78 spike — what a cleaned-up workspace leaves (2026-10-29, branch `feature/workspaces-history`)

The person's `symbiote/` folder read (not changed): 99 workspace records, 97 of them `finished`;
their threads, recorded tools and reviews; `git merge-base --is-ancestor` of each approved commit
against `main`, and whether each branch is still there.

**Learned**:
- **The history is on disk, unread**: all 97 briefs, 94 threads, 40 activity files (5.4 MB, the
  largest 485 KB). Only the list's `!f.finished` filter and the page's "No workspace" hide them.
- **The commits outlive the branch**: Clean up deletes a merged branch, but 83 approved commits
  are on `main` (Symbiote merges with `--no-ff`, the approved commit the merge's second parent)
  and 13 workspaces kept their branch: 96 of 97 can show their commits. The record itself says
  nothing of the branch's end, so V78 has Clean up write `tip` and `merged`.
- **Two approved commits are not on `main`**: an Approve is not proof of a merge; the outcome is
  read from git, not from the verdict.
- **A finished Codex or Hermes workspace keeps its conversation in the agent** (3 of 97): reading
  it means asking Codex's app server or starting Hermes for a workspace whose sessions were
  archived. V78 reads Symbiote's own files only and says so.
- **`/history` is taken**: Git's address until V66, still moved to `/git`, and Git's API is
  `/api/history`. The page is `/workspace-history`.

## V78 — History under Monitor: finished workspaces, their activity and brief (2026-10-29, branch `feature/workspaces-history`)

A History page in the sidenav under Monitor (`h`, `/workspace-history`): the finished workspaces
by the day they were cleaned up, searched by title, branch or brief and by kind; the picked one
beside them, read only, in the workspace page's own tabs: Activity, Thread, Brief, Changes; Open
the change. Its API (`/api/workspaces/history`) reads records, reviews and git, never an agent;
Clean up records `tip` and `merged`. Decisions 569–575 (planned as V77, 561–567).

**Learned**:
- **A git run from Node costs ~3 ms to start, and starts do not overlap**: 85 `merge-base
  --is-ancestor` took 280 ms at 8 at once and 263 ms at 16 (36 ms from a shell with `xargs -P 8`).
  The list's two runs per workspace made a cold read 299 ms (173 runs); one `rev-list --since`
  of the default branch makes it 47–53 ms (9 runs). Count the runs, not the concurrency.
- **`pnpm --filter @symbiote/cli build` builds nothing**: the CLI has no build script; `tsc -b
  tsconfig.build.json` (or `pnpm build`) does. Two timings were taken on a stale `dist/`, and
  their "drop" from 299 to 250 ms was noise. Check `dist/` for the change before measuring.
- **10 of the 13 kept branches have no commit of their own**: their tip is their base, which
  `main` holds. "Merged" needs a commit beyond the base (the live list's `isMerged` asks the same
  with `commitsBetween`); History compares the end with the base, no git run.
- **A container query cannot style its own container**: `@container history` on `.history-body`
  never stacked it at 760 px; the page (`.history`) is the container now.
- **On real records the row's outcome cut every name**: 83 of 97 said "Merged into main"; rows
  say "Merged", the card the branch.
- **Milestone IDs collide again**: `feature/remove-scout-in-page-settings` planned V77 (561–564)
  five minutes after this plan; `main` took 568 meanwhile. Renumbered at the end, by a script on
  this branch's own lines only (an SVG path holds "11.562").

**Verification**: tests first, red for the right reason (the module, the route, the record's
fields missing; then a fixture's wrong base). CLI 1,006 unit tests, viewer 626; e2e
`workspace-history.spec.ts` (2), `page-frame.spec.ts` with History, `shell.spec.ts`,
`title-bar.spec.ts` and `tooltips.spec.ts` with History among the pages; full suite: E2E_RESULT.
The person's 97 finished workspaces on a clone: 83 merged, 13 kept, 1 not merged, 96 with
commits; the list 47–53 ms cold, 32–38 ms warm; screenshots at 1440 and 760 px, dark and light.

Not verified: the desktop window itself (its title-bar spec covers the page); a finished Hermes or
Codex-on-app-server workspace's conversation, which History does not read by design.
