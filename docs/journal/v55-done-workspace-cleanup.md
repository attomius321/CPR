# Journal: V55 — A done workspace or a landed merge, removed from its card and its head

[Index](../JOURNAL.md) · [Plan](../plan/v55-done-workspace-cleanup.md)

## V55 — the cards' bin, the heads' Clean up and Remove (2026-10-25, branch `feature/done-workspace`)

A done workspace's card (merged: the Done group) and a landed merge's card have a bin at their
right end, shown on hover or keyboard focus (always without hover), over the card's kind and time:
one click cleans the workspace up or removes the merge from the queue, without opening the card.
A merged workspace's head has Clean up as its primary button (Review plain beside it); a landed
merge's head has Remove, and no **⋯**. A merge not landed is removed from its page only, under
**⋯**. After either from the page shown, History. Decisions 403–406. Planned as V54 (397…);
renumbered before the plan's commit (below).

**Learned**:
- **IDs go while a plan waits for its OK**: V54 and decisions 397–402 were free on every branch
  when the plan was written; by the person's OK `feature/tooltips-revamp` had both. Renumbered to
  V55 and 403–406 before the plan's first commit. After it, `feature/skills-page-styling` took V56
  and 407–410: a pushed plan holds its numbers.
- **`visibility: hidden` takes a button out of the accessibility tree and the Tab order**: the
  bin hidden that way was not found by `getByRole` until hovered, and Tab could not reach it.
  `opacity: 0` keeps both; the pointer reaches it only by hovering the card, which shows it.
- **`:focus-within` is also a click's**: a click on a card focuses its name (a button), and the
  bin would stay shown after the pointer left. `:has(:focus-visible)` shows it for the keyboard
  only, as the card's own focus ring does (V48).
- **The DOM order is the Tab order**: last in the card, the bin came after the branch's link.
  Placed after the head, Tab goes name, bin, branch.
- **The hover wash is translucent** (`--hover`, 5 % of the text): a bin cannot cover text by a
  background. A workspace card's chip and time give way (`visibility`, which keeps their place); a
  merge card, which has neither, keeps the bin's 32 px at its right.
- **A new name can widen an old locator**: `getByRole('button', { name: 'Add a half function' })`
  is a substring match and found the bin ("Clean up Add a half function") too, once the bin was
  in the accessibility tree; and V44's "no `.icon` in a card" counted the bin. The first made
  `exact`, the second leaves out the bin (an action, not a state).

**Verification**: tests first, red for the right reason (unit: `mergeButtons`, `removableOnCard`,
`cleanableOnCard` not functions; e2e: no Clean up in the head, **⋯** still on a landed merge, no
bin on the card, no Remove in a landed merge's head), then green. `pnpm check` (1,742 unit tests;
a first run timed out two analysis tests under load, which passed alone and in the next whole run),
`pnpm build`, `pnpm test:e2e`: 262 of 263, V44's "no icon in a card" counting the bin, then green
with the bin left out; `look.spec.ts`' 64 px card failed once in a run of six and passed four
times after (a working card, unchanged here). Screenshots at 1×, both themes, of every card state
with the bin, the rail, both heads merged and not, a landed and a failed merge. Not verified: a
touch screen, the desktop app.
