# Chore — The `v` key in commands.md's keys table

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (docs that disagree
with the code: the `v` key)

**Status:** planned (2026-11-06), to be built on branch `chore/keys-v` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/keys-v` · **Size** S · **Depends on** none · **Plan** P25 of
51 (the audit's order)

## The brief

**What to change**: on a review's Files page, `v` marks the file shown as viewed, or not (V90,
decision 843). `docs/reference/commands.md`'s keys table has no row for it.

**Where to look**:
- `packages/viewer/src/diff/App.tsx:239-243`: `event.key === 'v' && state.status === 'ready' &&
  forge`, then `toggleViewed(shown)`.
- `forge` (`App.tsx:98`) is set on any review: a pull or merge request (`github`, `gitlab`) and a
  workspace's or branch's review (`local`, `server.ts:1208`). It is not set on a plain
  `symbiote view <base>` diff.
- `docs/reference/commands.md:143-154`: the table's columns are On Git | A change's Files page |
  A change's Graph page.
- `docs/guide/review-and-ci.md:120-130`: the review steps; the **Viewed** button is not named.

**Out of scope**: other keys, the viewer's own key lists (Git's **?**), the Viewed button's
behaviour.

**Done when**:
- The table has a `v` row: Files page, "Mark the file shown viewed, or not (a review: a pull
  request or a workspace's)".
- The review guide names Viewed and `v` in one sentence where it lists the Files page's work.
- Every key the Files page handles in `App.tsx` has its row.

## Evidence

- **Code**: `grep -n "| v\b\|viewed" docs/reference/commands.md` finds no row. The key is handled
  at `App.tsx:239`.
- The audit's review screenshots show the **Viewed** button in the Files page's toolbar.

## Approach

- Add the row in the table's order (by key), with the wording of the rows around it.
- While there, list every `event.key` that `App.tsx` handles on the Files and Graph pages
  (`grep -n "event.key ===" packages/viewer/src/diff/App.tsx`) and check each has its row. Add any
  other missing one in the same commit and name it in the commit body.
- The `writing-docs` skill's checks of keys against the code.

## Verification

- `pnpm check` (docs are not linted; the check stays green).
- By hand: on `servePullRequest`'s Files page, `v` toggles Viewed; on a plain diff
  (`serveFixture`) it does nothing. That matches the row's wording.
