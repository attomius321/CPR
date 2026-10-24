# V33 — Start a workspace from a branch

[Index](../PLAN.md) · [Journal](../journal/v33-start-from-branch.md)

**Status:** merged into main (2026-10-22, from branch `feature/start-a-workspace-from-branch`, a
workspace started in Symbiote, plan not asked for first; approved in Symbiote at `5c82f01`). Its "As
built" and results below.

**Problem** (asked: "There should be an option on start a workspace page where i can select the
branch from which i start."). The start page starts from the default branch's newest tip (V18,
`workspaceBase`), or from a commit picked in History ("Start a workspace here").
Nothing else: to stack a workspace on another branch, the person has to find that branch's tip
row in History and start from the commit, and the workspace's record then has no `from`, so its
prompt says "the commit abc1234" instead of the branch. On this repository there are 102 branches
one could start from (40 local, 62 only on `origin`); the page offers 1.

**Goal**: a **Start from** choice on the start page: the default branch first, then every local
branch, then those only on a remote, each by name. The branch's tip is where the workspace
starts, its name the record's `from` (so the prompt says "`<branch>` at `<sha>`"). A commit
picked in History stays the first choice ("the commit abc1234") and can be changed to a branch.
**Unchanged**: with nothing picked, the default branch's tip, found by the server at the start;
`base` in a request; the records and prompts of workspaces started as before.

## Design

- **Server**: `WorkspaceOptions.branches` lists `{ name, sha, remote? }` — every branch name of
  the local branches and the remotes', at its newest tip by `workspaceBase`'s rule (the local or a
  remote's tip that holds the others; the local one when they diverged), the default branch
  first. `isAncestor` runs only where a name's tips differ (0 of 102 names here). `workspaceBase`
  becomes that rule for the default branch.
- `WorkspaceRequest.from`: a branch name from that list; the server resolves its tip at the
  start (the branch may have moved since the page loaded) and records `from`. Refused with 400
  when no branch has that name, or with `base` given too.
- **Page**: a Start from select at the top of the run column, above Branch; the header's "From
  … at …" follows it, and the Done when guess is read again at the new commit (V24b, by SHA). The
  pick is kept in the draft with the run's choices until a start; the next workspace starts from
  the default branch again, as the effort does (V30b). Without a default branch
  the page now starts from the first branch listed instead of refusing.

## Verification

1. **Tests first**: `workspaces.test.ts` — options list the branches in order with their newest
   tips; `start({ from })` makes the branch at that tip, records `from`, says it in the prompt;
   refusals (unknown name, `from` with `base`). `start.spec.ts` — the choice lists branches,
   picking one changes the header and starts there; a History row's commit is the first choice;
   the pick survives leaving the page and is reset after a start.
2. `pnpm check`, `pnpm build`, `pnpm test:e2e`; a screenshot of the page at 1440×900, both themes.

**Risks**

| Risk | Mitigation |
|---|---|
| A repository with thousands of remote branches (Bitwarden: 1,591) makes a long select | A native select scrolls and type-ahead finds a name; the list is read once per page, `for-each-ref` already gives it |
| The branch moves between loading the page and starting | The server resolves the name at the start, as it does for the default branch |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V33 | Start from a branch | `branches` in the options, `from` in a start request, the Start from choice on the page |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 230 | Which branches | **Every branch name, local or only on a remote**, the default first, then local, then remote-only, each by name | A name is what the person knows; `origin/x` and `x` are one branch to start from |
| 231 | Which tip of a name | **The newest, by `workspaceBase`'s rule**, resolved by the server at the start | The default branch already starts so; one rule for every branch |
| 232 | Is the pick kept | **In the draft until a start**, then the default branch again | Leaving the page loses nothing (V24c); a stacked workspace is the exception, not the next one's default |

## As built (V33)

- **A branch is always sent by name**, the default one too (`from: "main"`); `base` only for a
  History row's commit. The server's `newestTip` is `workspaceBase`'s rule, so a start from the
  default branch lands where it did on `main`.
- **`options.base` stays**: it names the default branch, picked when the draft has none.
- **The row's commit is an option of the same select** ("The commit abc1234", value `''`, a
  name no branch can have), so going back to it after picking a branch is one choice.
- **Tab order**: Start from sits between More and Branch; `workspaces.spec`'s keyboard test
  says so.

**Results.** Tests first, red for the right reason: `workspaces.test.ts` (`startBranches` missing,
no `branches` in the options, a start with `from` at the default tip, no refusals),
`workspaces.test.ts` in the viewer (`readRun` dropping `from`), `start.spec.ts` (no Start from).
`pnpm check` 1,113 tests; e2e 175 of 175. `startBranches` on this repository's main checkout:
102 names (62 remote-only) in 2–3 ms after `listRefs`' 6 ms; on a synthetic repository of 40
local and 1,600 remote branches 17–20 ms. Screenshots at 1440×900, dark and light, and 390×844.
Not verified: a real agent started from a non-default branch (the fake Claude Code's prompt
says `topic at <sha>`); Bitwarden's 1,591-branch select in a browser.
