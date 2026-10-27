# Journal: V68 — Search the branches to start from

[Index](../JOURNAL.md) · [Plan](../plan/v68-start-from-search.md)

## V68 spike — how many branches Start from lists (2026-10-27, branch `feature/start-workspace-source-start-from`)

Counted the names Start from offers on this repository (`startBranches`: local branches, then
the remotes' names with no local branch): 54 local and 123 only on `origin`, 177 entries in one
native select. At V33 (2026-10-22) there were 102. The person also saw the select's "Only on a
remote" optgroup label unseen in the dark theme.

**Learned**:
- **The select's list is the browser's**: neither a filter nor the group's colour can be set on
  it from the page (`select` has the light `--text` and a 4 % `--input-bg`; the optgroup label
  takes the text's colour over the list's own ground). A list drawn by the page fixes both.
- **The page leaves on Escape** (`StartPage`'s `onKeyDown`): a list open on it must stop its own
  Escape.

## V68 — Start from with a search (2026-10-27, branch `feature/start-workspace-source-start-from`)

Start from is a field drawn as the selects are that opens a popover: a Search branches field over
the list, grouped Local and Only on a remote by the page. Every word typed must be in a name, any
case; the words found are marked; the order is the server's. A letter on the field opens it with
that letter, ↑ ↓ move, Enter picks, Escape closes only the list. Decisions 490–493 (planned as
V66, 475–478; renumbered when two other workspaces took V66 and V67).

**Learned**:
- **A button is not a select to the shell**: `keyIsTaken` leaves a `<select>`'s letters alone, not
  a button's, so `m` typed on the field opened Monitor. React's `stopPropagation` in the field's
  handler stops the native event at the root, before the shell's window listener.
- **A popover that ends on the row's edge shows what is under that edge**: the Effort card's
  handle sits on the same line, its 1 px ring a sliver beside the popover. Out by its own padding
  and border, the popover covers it, and its search lines up with the row.
- **Playwright from a scratch folder** needs `"type": "module"` there (the e2e helpers are ESM)
  and `node_modules` linked to the repository root's, not the viewer's: `@playwright/test` is
  hoisted.
- **IDs collide again**: V66 was free on every branch at plan time; within two hours
  `feature/history-feature` took V66 (475–479) and `feature/review-merging-strategies` V67, up to
  decision 489.

**Verification**: `test/start-from.test.ts` red first (7 tests); `pnpm check` (1,911 tests);
`pnpm test:e2e` 308 of 308, then `start.spec.ts` and `workspaces.spec.ts` (68) after the last CSS
change; screenshots in both themes at 1440 × 900 and 390 px with this repository's 178 names; a
keystroke 21–33 ms over 186 entries.

After merging `main` (N2, `docs/JOURNAL.md` conflicting where both appended): `pnpm check`
1,925 tests; `pnpm test:e2e` 309 of 310, `intro.spec.ts`'s timing over its limit under load
(9.1 s against 8 s), 9 of 9 alone.

Not verified: the other selects' native lists in the dark theme (no group heading in any).

