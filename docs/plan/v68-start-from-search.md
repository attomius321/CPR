# V68 — Search the branches to start from

[Index](../PLAN.md) · [Journal](../journal/v68-start-from-search.md)

**Status:** ready for review (2026-10-27), on branch `feature/start-workspace-source-start-from`
(a workspace started in Symbiote, plan first; the person's OK given). Planned as V66 (decisions
475–478), renumbered: `feature/history-feature` took V66 and `feature/review-merging-strategies`
V67 meanwhile. Its "As built" and results below.

**Problem** (asked: "Need to be able to search for branches." — then: "the category of origin
have a white color on black theme, and is not visible, the line that splits origin from local -
Only on remote -"). Start a workspace's **Start from** (V33, the Source card since V63) is a
native `<select>`: the default branch, every local branch by name, then an optgroup "Only on a
remote". Nothing finds a branch but scrolling:

| Repository | Local | Only on a remote | Entries in Start from |
|---|---|---|---|
| Symbiote (this one, 2026-10-27) | 54 | 123 | 177 |
| Symbiote at V33 (2026-10-22) | 40 | 62 | 102 |

The list grew by 75 in five days. The browser draws the select's list itself: the page can neither
filter it nor style its parts, and in the dark theme the optgroup's label is drawn in the
select's light text on a light ground, unseen.

**Goal**: Start from opens a list with a search field: typing narrows the branches to those whose
name holds every word typed; the keys pick one without the mouse. Its groups' headings are drawn by
the page, in both themes' colours. **Unchanged**: what the page starts from and sends (`from`, or
`base` for a History row's commit), the order (the default branch first, then local, then those
only on a remote), the draft keeping the pick, the server and its API.

## The control (`workspaces/StartFrom.tsx`)

- **Closed**: as today's field — the branch icon, the picked name (or "The commit abc1234"), the
  chevron, 32 px — a button labelled "Start from" (`aria-haspopup="listbox"`, `aria-expanded`), in
  the Tab order where the select was.
- **Open**: a popover under the field, as wide as it: a **Search branches** field, focused, then
  the list (`role="listbox"`, at most 320 px high, scrolling): "The commit abc1234" first when
  the page came from a History row, then **Local** and **Only on a remote**, each heading with its
  count of matches. The picked entry is marked (✓, `aria-selected`); the active one (keys or
  pointer) has the hover's wash and is scrolled into view. Nothing matches: "No branch matches".
- **Keys**: on the closed field Enter, Space, ↓ or ↑ open it; a letter opens it with that letter
  in the search. In the search ↓/↑ move the active entry (`aria-activedescendant`; focus stays in
  the field), Home/End stay the field's, Enter picks the active one and closes, Escape closes and
  gives the focus back to the field — the page does not get that Escape (it would leave the
  page) —, Tab and a click outside close it without a pick. Ctrl+Enter still starts.
- The page keeps the rest: a pick is `choose({ ...run, from })` or the row's commit, as the
  select's change was.

## The search (`workspaces/start-from.ts`, pure)

- `startChoices(branches, at, query)`: the entries in the server's order, grouped (commit, Local,
  Only on a remote), each with its name's matched ranges. A query's words (split on white space)
  must each be in the name, any case; the commit's entry matches its words "commit" and its SHA.
  An empty query lists everything.
- The matched letters are drawn in `--text` and 600, the rest of a name in `--muted`: why it is
  listed shows. No ranking: the order stays the one the person knows, the default branch first.

## Verification

1. **Tests first** (red before): `test/start-from.test.ts` — words in any order and case, ranges
   merged when they overlap, groups and counts, the commit's entry, no match. E2E
   (`e2e/start.spec.ts`): V33's two Start from tests on the new control (its entries, a pick, the
   draft keeping it, a remote's branch, a History row's commit), and a new one: typing narrows
   the list, ↓ and Enter pick, a letter on the closed field opens it with the letter, Escape
   closes the list and the page stays, a click outside closes it, "No branch matches".
   `workspaces.spec.ts`'s Tab order passes with the button in the select's place.
2. **Nothing else changes**: every other spec; the request a start sends (`from`/`base`).
3. **Look**: screenshots at 1440 × 900, scale 1, dark and light — closed, open with this
   repository's 177 names, filtered, no match, from a History row — the text at 3× for even
   letter gaps; 480 px wide.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`. No analysis change: no regression check.

**Risks**

| Risk | Mitigation |
|---|---|
| The page's Escape leaves the page with the list open | the list stops it; an e2e test |
| The popover cut by the scrolling body or under the next card | absolute in the field's box, above the cards; checked at 900 and 600 px high |
| 177 rows re-rendered on every key | plain rows, no layout work; measure a keystroke |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V68 | Start from with a search | `start-from.ts`, `StartFrom.tsx`, its CSS, tests, docs |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 490 | Which control | **A button that opens a popover: a search field over a listbox** | the field keeps showing the pick as the mockup's; a native select can be neither filtered nor styled; an editable field would lose the picked name while typing |
| 491 | What a search matches | **Every word typed in the name, any case; the server's order; the matched letters marked** | History's filter is one substring; words find `milestone/v65-review-against` by "v65 against"; no ranking keeps the default branch first |
| 492 | The keys | **Enter/Space/↑/↓ or a letter open it; ↑/↓ move, Enter picks, Escape closes it only, Tab or a click outside close** | the select's keys, plus typing; the page's Escape must not leave while the list is open |
| 493 | The groups' headings | **Drawn by the page: Local and Only on a remote, in `--muted` with a count** | the native optgroup's label was unseen in the dark theme |

**Not in V68 (later)**: the same picker for a workspace's "Review against" (V65) and Merge into
▾; History's branch filter by words.

## As built (V68)

- **The shell's letter keys**: on a focused `<select>` the shell leaves letters alone
  (`keyIsTaken`); on a button it does not, so `m` on the closed field went to Monitor. The field
  stops the letters it takes (and ↑ ↓) before the shell's window listener; the e2e test types `m`.
- **The popover is 9 px wider than the row on each side** (its padding and border): its search
  then spans the row exactly, from the name to the field's end, and it covers the Effort card's
  handle, whose 1 px ring showed beside the popover's edge in the first screenshots.
- **The commit's entry** matches on its label ("The commit abc1234"): its words and the short
  SHA, not the full one.
- **The field shares the selects' rules** (`ui/controls.css`: edge, hover, focus ring, chevron)
  rather than copying them; `StartFrom.css` has the layout, the popover and the rows.
- **The picked entry's check** is in `--accent` under `[aria-selected='true']`: `tokens.test.ts`
  allows the accent only in a selector that names its role.

**Results.** `test/start-from.test.ts` (7, red before the module: it did not exist); the three
Start from e2e tests in `start.spec.ts` (V33's two on the new control, one for the search and
keys) were written before the control but first run after it (they need a build). `pnpm check`:
1,911 tests. `pnpm test:e2e`: 308 of 308; after the popover's last CSS change, `start.spec.ts`
and `workspaces.spec.ts` again (68 of 68). Screenshots at 1440 × 900, scale 1, dark and light,
with this repository's names (55 local, 123 only on `origin`; 186 entries with the fixture's):
closed, open, the remote group, filtered, keys, no match, a long name picked, a History row's
commit, and 390 px wide; the text at 3× has even letter gaps. A keystroke: 21 ms to narrow the
186 entries and 33 ms to list them all again, each to the second animation frame.

After merging `main` (N2): `pnpm check` 1,925 tests; `pnpm test:e2e` 309 of 310, the one
failure `intro.spec.ts`'s first test over its 8 s limit (9.1 s) under the suite's load, 9 of 9
alone.

Not verified: the other selects' native lists (Agent, Model, Permissions, Review against, Merge
into ▾) in the dark theme — none has a group heading, the part the person saw unseen; a headless
browser does not draw a select's open list in a screenshot.
