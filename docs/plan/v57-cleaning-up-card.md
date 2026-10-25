# V57 — A card being cleaned up: disabled until it goes

[Index](../PLAN.md) · [Journal](../journal/v57-cleaning-up-card.md)

**Status:** planned (2026-10-25), on branch `feature/deleted-workspace-in-progress` (a workspace
started in Symbiote, from `main` at `d3dd6e1`). The person OK'd the plan with "1. Yes 2. Yes both
as you recommended. 3. Yes, leave it out. OK": a landed merge's card too; the words dimmed, a grey
spinner and the "Cleaning up · …" line; a Clean up Scout runs left out.

**Problem** (asked: "A workspace that has initiliazed deletion should have some styling on the
card, like a disabled state until deletion."). Today, on `main` at `d3dd6e1`, from Symbiote's own
log of the day (`<cache>/logs/2026-10-25.jsonl`, the person's real runs):

- 15 Clean ups: `POST /api/workspaces/clean` took 1.3–2.4 s (median 1.7 s). The card goes with
  the list's next read, ~1.0 s more (20 reads of `/api/workspaces`: median 1.0 s, at most 1.6 s).
  For ~2.7 s the card is as before, only its bin greyed (V55), and a click on it opens a workspace
  whose agent and worktree are being removed.
- The person cleans up several in a row (three 4 s apart at 19:48, two at 21:16): nothing says
  which cards are already going.
- Clean up from a workspace's head is the same: the sidenav's card stays as it was until the read
  after it.
- A landed merge's Remove is the same bin: 2–6 ms (16 removals), then the same ~1 s read.

**Goal**: from the moment a Clean up (or a merge's Remove) is sent until its card leaves the list,
the card is plainly disabled and says what is happening. A refusal gives the card back as it was,
the error in the status bar as today. **Unchanged**: the server and its API, what Clean up and
Remove do, when the status bar speaks and when the main area moves to History (V55, decision
406), the cards' height (64 px at most) and their order.

## The card (`shell/Sidenav.tsx`, `shell/Sidenav.css`)

- **Its words** dimmed as a disabled control is (`opacity`), the name kept ≥ 3:1 against the
  sidenav in both themes (`--faint`'s floor), measured. Its dot not: the dot is a spinner, the
  comet Starting has (V53), in a neutral grey (`--faint`) — Symbiote at work, on a card that is
  going. Without motion it holds still, as every spinner does.
- **Its line** says what is happening, in place of its state and its time, as the Starting card's
  "Starting · its worktree, then Claude Code" (V48):
  - a merged workspace: "**Cleaning up** · its worktree and its branch";
  - one not merged (Clean up anyway): "**Cleaning up** · its worktree; the branch stays";
  - a merge: "**Removing** it from the queue".
- **Not usable**: no hover wash, the default cursor, `aria-busy` and `aria-disabled` on the card,
  its name's button disabled (a merge card's link without its `href`); a click anywhere on it opens
  nothing. No bin; the kind chip stays where it is, dimmed. The arrows and `w` skip it (a disabled
  button takes no focus: the arrows would stop at it).
- **Nothing moves**: it stays in its group, at its place, a card's height.
- **Folded**: the rail shows the grey comet; its tip "‹name›\nCleaning up".

## Where the state is (`workspaces/removing.ts`, `workspaces/cleanup.ts`)

- In the page: a store of the removals under way, keyed by branch (a workspace) or by id (a
  merge), as `workspaces/starting.ts` holds the starts (V48). Unit-tested.
- `cleanUp` and `removeMerge` (`workspaces/cleanup.ts`) mark it: every way the page cleans up or
  removes goes through them — the card's bin, the head's Clean up, Clean up anyway, the merge
  page's Remove.
- **Until when**: on a refusal, at once; on success, once the list is read again
  (`reloadWorkspaces`), so the card never shows as before for a moment and then goes. Neither the
  notice nor the move to History waits for that read.

## The workspace's head (`workspaces/Workspace.tsx`)

- While its workspace is cleaned up (from its head, or from its card while it is shown): Clean up
  says "Cleaning up…" and the head's actions are disabled, as Stop the agent says "Stopping…"
  (V48).

## Verification

1. **Tests first** (red for the right reason):
   - Unit: `test/removing.test.ts` — the store (several at once, by key; ended once only);
     `cleanUp` and `removeMerge` keep the mark through a success until the list is read again,
     and drop it at once on a refusal.
   - `e2e/workspaces.spec.ts`, the clean-up held by `page.route`: a card cleaned up from its bin is
     busy and disabled, says "Cleaning up · its worktree and its branch", its dot the comet in
     grey; a click opens nothing, no hover wash, no bin, the arrows and `w` skip it, ≤ 64 px;
     released, it goes and the status bar says so; refused (a file not committed), it is back as
     it was. From a merged workspace's head: "Cleaning up…" disabled, the card marked. Clean up
     anyway: its own words. Folded: the comet and its tip.
   - `e2e/merges.spec.ts`: a landed merge's card while its Remove is held.
2. `pnpm check`, `pnpm build`, the whole `pnpm test:e2e`; `look.spec.ts`' 64 px card, the
   stylesheet's tests (`tokens.test.ts`, `styles.test.ts`).
3. **The look** (`viewer-check`, `symbiote-style`): screenshots at 1440×900, 1×, both themes — a
   card cleaning up at rest, hovered and picked, among others; the rail; a merge card removing;
   the head's "Cleaning up…"; the sidenav's other states for spacing.
4. No analysis or graph change: no `regression-check`.

**Risks**

| Risk | Mitigation |
|---|---|
| The arrows stop at a disabled card | They and `w` move between enabled cards' names only; an e2e |
| The mark kept after the request ended (a throw before its end) | Ended in `finally`; a unit test for each way out |
| Dimmed words too faint to read | The name measured ≥ 3:1 in both themes |
| The card's own click (the `li`'s) opens it while disabled | It does nothing while the card is cleaning up; an e2e |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V57 | A card disabled while its workspace is cleaned up or its merge removed | a store, the cards and the head, CSS, unit and e2e tests, docs |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 411 | What a card shows while its workspace is cleaned up or its merge removed | **Its words dimmed, its dot a grey comet, its line "Cleaning up · …" ("Removing it from the queue"); no hover, no bin, no click; the arrows and `w` skip it** | The person asked for a disabled state until it goes; the Starting card says what happens the same way |
| 412 | Where that state is | **In the page: a store set by `cleanUp` and `removeMerge`, from the request until the list is read again; at once on a refusal. No server change** | Every way the page starts one goes through them; the card goes with that read |
| 413 | Which cards | **A workspace's (from its bin, its head, Clean up anyway) and a merge's (its Remove)** | The person: "1. Yes"; the same bin and the same ~1 s wait |
| 414 | The workspace's head meanwhile | **Clean up says "Cleaning up…", its actions disabled** | As Stop the agent's "Stopping…" (V48) |

**Not in V57**: a Clean up Scout runs (MCP's `clean_workspace`), one from another window, or a
reload during one — the page does not know they run; it would take the server saying so in
`/api/workspaces`, which is not read while nothing works (the person: "3. Yes, leave it out").
