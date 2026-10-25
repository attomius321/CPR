# V55 — A done workspace or a landed merge, removed from its card and its head

[Index](../PLAN.md) · [Journal](../journal/v55-done-workspace-cleanup.md)

**Status:** in progress (2026-10-25), on branch `feature/done-workspace` (a workspace started in
Symbiote, from `main` at `da991b5`). The person OK'd the plan with "1. Yes, as you planned 2. Yes,
if it is still merging, it should not be displayed. This should be forced from its view page 3.
Yes. OK": the icon on hover and focus, the merge's action kept as Remove and offered on a card only
once it landed (a merge not landed is removed from its own page, under ⋯), a trash icon. Planned
as V54 with decisions from 397; `feature/tooltips-revamp` took both meanwhile.

**Problem** (asked: "A done workspace or landed merge should be easier to be removed. Add icons on
their cards so i can remove it from the Workspaces list. Also, in Merge view, and Workspace view,
if it is done/landed, the Clean button should not be hidden in the dropdown, should be in the
header as a primary button."). Today, on `main` at `da991b5` (a fake repository: one workspace
approved, merged and landed, one merged by hand; screenshots at 1×, both themes):

- **Clean up** of a merged workspace is three clicks: its card, **⋯**, Clean up. **Remove** of a
  landed merge is three too: its card, **⋯**, Remove.
- Once a merge lands, its card stays in Merging ("Landed: main is at 79fd094") and its workspace's
  in Done: two cards for one finished piece of work, each kept until removed that way.
- A merged workspace's head has one primary button, **Review**, for a branch already in `main`.
- A landed merge's **⋯** holds Remove alone. After Remove the page stays, saying "No merge of
  feature/… in Symbiote's queue".

**Goal**: a done workspace (merged: the Done group) and a landed merge are removed from their card
in one click, and from their page by its primary button. **Unchanged**: what Clean up and Remove
do on the server (no API change), an unmerged workspace's Clean up… (under ⋯, asked first), a
merge not landed (Retry and Remove under ⋯, none while it runs), the cards' height (64 px at most)
and their keyboard order.

## The cards' icon (`shell/Sidenav.tsx`, `shell/Sidenav.css`, `ui/icons.tsx`)

- **Which cards**: a workspace in the Done group (`workspace.merged`), and a merge in Merging whose
  state is `landed`. No other card has it: a merge not landed is removed from its page, where its
  log and state are in view (the person: "if it is still merging, it should not be displayed").
  Decided by two pure functions, unit-tested.
- **The icon**: `TrashIcon`, lucide's `trash-2` drawn as Symbiote's other icons (16 px line, the
  text's colour): Clean up deletes the worktree and the branch, and an × would read as "hide".
- **The button**: 24 px, ghost (`--muted`, the hover wash and `--text` on hover), at the card's
  right end over its kind chip and its time, which give way to it while it shows: nothing else
  moves, the name keeps its width.
- **When it shows**: on the card's hover and when the focus is within it (Tab reaches it after the
  card's name); on a screen without hover, always (the style: the hiding is gated by
  `@media (hover: hover)`). Never in the folded rail.
- **Names**: "Clean up ‹name›" (its tooltip: "Clean up: remove its sessions, its worktree and its
  merged branch"); "Remove the merge of ‹branch›" ("Remove it from the queue, with its log: main
  keeps the merge").
- **A click** runs it at once, with no question, as Clean up of a merged workspace and Remove of a
  merge do today (the branch is in `main`; the server still refuses a worktree with files not
  committed). It does not open the card. While it runs the button is disabled; then the list is
  read again and the card goes, the status bar saying so ("Cleaned up ‹branch›: its worktree is
  removed.", "Removed the merge of ‹branch› from the queue."). A refusal is said in the status bar
  as an error, and the card stays.
- **The card shown**: when the card removed is the one in the main area, the main area shows
  History, as Clean up does from the workspace's page today.
- The arrows still move between the cards' names only (`.workspace-about`): the icon is not one.

## The heads (`workspaces/Workspace.tsx`, `workspaces/Merge.tsx`)

- **A merged workspace**: Clean up leaves **⋯** and is the head's primary button, at its end.
  Review stays, a plain button: one primary in a view. An unmerged workspace is as today.
- **A landed merge**: Remove is the head's primary button; **⋯**, then empty, is not drawn. After
  Remove the main area shows History and the status bar says so. A merge not landed is as today
  (Retry and Remove under **⋯**).
- The calls (`/api/workspaces/clean`, `/api/merges/remove`) and their notices move to one module
  (`workspaces/cleanup.ts`), used by the heads and the cards.

## Verification

1. **Tests first** (red for the right reason):
   - Unit: `test/workspaces.test.ts` (which rows have the icon: Done only), `test/merges.test.ts`
     (a merge's actions split into the head's buttons and **⋯**: landed, Remove a primary button
     and nothing under **⋯**; failed, Retry and Remove under **⋯**; running, none).
   - `e2e/workspaces.spec.ts`: Clean up of a merged workspace from its head (primary, not under
     **⋯**; Review not primary); the Done card's icon — hidden at rest, shown on hover and on Tab,
     a click cleans up without opening it (the page shown stays; History when it was the one
     shown), a file not committed refuses it (the error in the status bar, the card kept), none in
     the rail, none on a card not done; after Land, the merge's head has a primary Remove and no
     **⋯**, and the landed card's icon removes it from Merging.
   - `e2e/merges.spec.ts`: a merge not landed keeps Retry and Remove under **⋯**, and its card
     has no icon.
2. `pnpm check`, `pnpm build`, the whole `pnpm test:e2e`; `look.spec.ts`' 64 px card, the
   stylesheet's tests (`tokens.test.ts`, `styles.test.ts`).
3. **The look** (`viewer-check`, `symbiote-style`): screenshots at 1440×900, 1×, both themes — the
   sidenav at rest, a done card hovered, focused, picked and hovered, a landed merge's card
   hovered, the rail; a merged and an unmerged workspace's head; a landed and a failed merge's
   head; spacing checked on the pages around them.
4. No analysis or graph change: no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| A click on the icon meant for the card | Only on hover or focus; its own name and tooltip; the server refuses work not committed |
| The icon covers a long name on a merge card (no chip there) | It sits over the line's end, on the card's own background; checked in screenshots |
| `feature/tooltips-revamp` (V54) replaces every `title` with Symbiote's tips | The new buttons use `title` as `main` does; whichever branch merges second moves them over |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V55 | The cards' icon, the heads' primary Clean up and Remove | unit and e2e tests, two components, CSS, an icon, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 403 | Removing a done workspace or a landed merge from the sidenav | **A trash icon button on its card, shown on hover and focus (always without hover), over the chip and the time; one click, no question; Done and landed cards only** | The person asked for icons on their cards; the style shows a row's actions on hover; the menus ask nothing for these today |
| 404 | A merged workspace's and a landed merge's head | **Clean up, Remove: the head's primary button; Review plain; ⋯ not drawn when empty** | The person asked for the action in the head, as a primary; one primary in a view |
| 405 | A merge not landed | **Removed from its own page only, under ⋯, as today; no icon on its card** | The person: "if it is still merging, it should not be displayed. This should be forced from its view page" |
| 406 | What the main area shows after its workspace or merge is removed | **History, the status bar saying what was removed** | As Clean up from a workspace's page does; a page saying "No merge of …" helps no one |

**Not in V55 (later)**: one action that removes a landed merge and cleans up its workspace; "Clean
up all done"; an undo.
