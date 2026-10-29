# V79 — Workspace cards one can read: whole names, the state on its own lines, the facts as icons

[Index](../PLAN.md) · [Journal](../journal/v79-workspace-cards.md)

**Status:** ready for review (2026-10-29), on branch `feature/workspaces-card-revamp` (a workspace
started in Symbiote, from `main` at `b3e8c03`). The person OK'd the plan with their answers to its
three choices: "1. Always show it 2. Recommended 3. 300px by default. Go" — the branch on every
card, a faint wash behind each card, a 300 px sidenav at first. Built as planned, with what the
300 px sidenav moved elsewhere: "As built" and results at the end.

**Problem** (asked: "The curent cards are displayed too condensed, it is hard to read. Make some
research about how it should look, and then plan"). The sidenav's cards (`shell/Sidenav.tsx`,
`Sidenav.css`), measured on a list of nine workspaces, one in each state with the person's real
titles and branches, and a merge, at 1440 × 900 and the default 264 px sidenav:

| What | Measured |
|---|---|
| A card | three rows in **72 px**: the name 15 px on 22 px lines; the state and the branch 14 px on **18 px** lines (1.29); 5 px in, **1 px** between cards and between rows |
| Cut to one line | **5 of 9** names, **6 of 9** state lines, **4 of 9** branches end in "…" |
| The name's room | a feature's kind chip takes **57 px** of the name's 229 px row: about 150 px left for the name |
| The facts | commits, files not committed and the merge check follow the agent's action on the state's line: none showed on a card with a long action; the conflict of "Remove scout in-page settings" never showed |
| The branch | in **95 of 103** of the person's workspace records it is what the Start page makes of the kind and the title (`proposeBranch`); the kind chip repeats its prefix in 99 |

**Research** (what lists of this kind do; sources in the journal): mail-style lists (Apple Mail,
GitHub's pull requests) put the name and the time on the first line, wrap a title rather than cut
it, and keep metadata short — an icon and a number, not a sentence. Cursor's Agents window groups
agents by status with a "Needs attention" section and shows each one's step and elapsed time.
Material's density guidance: "readability and prominence of a message are compromised when density
increases"; its three-line list item is 88 dp with 14/20 supporting text. Items read as separate
when the space between them is clearly larger than the space within: today 1 px within, 11 px
between.

**Goal**: a card's name and its state read whole (two lines each, then "…"), its facts in a row of
their own as icons and numbers, the cards apart from each other; the sidenav 300 px at first.
**Unchanged**: what a card says (every word stays, in a tip where it is shorter on the card), the
groups and their order, the dots and spinners, the type scale, the folded rail, the workspace's
own head, the keys (`w`, the arrows, Enter).

## The card (`shell/Sidenav.tsx`, `workspaces/WorkspaceFacts.tsx`)

```
● Remove scout in-page settings      25m    ← dot, name (15 px, 600, two lines), the time (13 px)
  Ready for review                           ← the agent's mark, what it does or what is next (14/20, two lines)
  [feature]  ⊸ 2   ⑂ 1 conflict              ← the kind chip, then the facts: commits, files not committed, the merge check
  feature/remove-scout-in-page-settings  ✗   ← the branch (a link to Git) and its review mark, as today
```

- **Rows**: the name's row (dot, name, time); the state's row; the meta row (the kind chip, then
  the facts); the branch's row, last as today, with its review mark. Every card has all four, the
  branch included (the person's choice 1).
- **The facts** (`cardFacts`, pure, in `workspaces.ts`): commits (lucide's git-commit and the
  count, 0 included), files not committed (lucide's pencil-line and the count, when any), the merge
  check (lucide's git-merge: "clean" in `--added`, "1 conflict" in `--removed`), a worktree gone
  ("worktree gone" in `--warning`). Each has its words in its tip ("Conflicts with main in 1
  file") and for screen readers. The workspace's head keeps them as words, from the same function.
- **A waiting card**: the name's row, what it asks (two lines, as today), Respond then the kind
  chip, the branch. **A merge**: its name "branch → target" over two lines, its state. **Starting**
  and **cleaning up**: the same rows, their words as today.
- **The bin** of a done card (V55): over the time, at the name's row's end; only the time gives
  way on hover.
- **Rhythm**: 10 × 12 px in; rows 4 px apart (the meta row 6, its chip 22 px); 20 px lines for
  14 px text; cards 6 px apart; a group's heading 20 px under the last card (14 today). Each card
  on a 3.5 % wash of the text (the waiting band's cards keep their 4 %), 7 % on hover, the open one
  `--selected` (the person's choice 2). The dot 17 px from the words (7 + 10).
- **The sidenav** 300 px at first (264 since V61; the person's choice 3); a width the person
  dragged stays theirs. At 1440 the main area keeps 1,140 px, over the changes panel's 1,100.
- **The rail** (folded): the dots alone, as today; the new rows hidden with the others.

## Verification

1. **Tests first** (red before): `test/workspaces.test.ts` — `cardFacts` on every fact, the words
   the head says; `e2e/look.spec.ts` — a card's rhythm (10/12 px in, 6 px apart, 22/20 px lines)
   and a two-line name and state shown whole at 300 px, in place of "at most 72 px";
   `e2e/workspaces.spec.ts` — the kinds a column at the meta row's start, the time at the name's
   row's end, a waiting card's kind after Respond, the bin over the time, the facts' icons and
   tips, the starting and cleaning-up cards; `e2e/panels.spec.ts` — 300 px at first.
2. **Nothing else changes**: the full `pnpm test:e2e` (run with `env -u WAYLAND_DISPLAY`),
   `pnpm check` (`tokens.test.ts`: sizes, radii, colours, the state colours' allowlists), `pnpm build`.
3. **viewer-check**: first paint of `/git` against `main`'s build (the sidenav is on every page),
   alternated, three rounds each.
4. **Screenshots** at 1440 × 900, 1×, dark and light: every page with the sidenav, the mock list
   of every state (as planned), the folded rail, the 390 px drawer; text at 3× for uneven gaps.

**Risks**

| Risk | Mitigation |
|---|---|
| Fewer cards in view: 3 instead of 4 at 1440 × 900 on the mock list, 1,204 px of cards for 807 at 264 px | The person's choice of 300 px: names mostly on one line; a 2-line clamp keeps a long state from growing a card further |
| Specs that pin today's places (V53's chip over the time, V55's bin, V57's cleaning card, two at most 72 px) | Rewritten first with the new places, knowingly |
| `-webkit-line-clamp` in a flex row | The name and the state are blocks of their own; measured in e2e by `scrollHeight` |
| A narrower main area (36 px) on every page | Measured by `page-frame.spec.ts` and `changes.spec.ts`; the changes panel still shows at 1440 |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V79a | The tests, red | `workspaces.test.ts`, `look.spec.ts`, `workspaces.spec.ts`, `panels.spec.ts` |
| V79b | The cards, the facts, 300 px | `workspaces.ts`, `WorkspaceFacts.tsx`, `Sidenav.tsx/.css`, `icons.tsx`, `Shell.css` |

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 576 | What is on a card, and in what order? | **Four rows: the name and its time; what it does or what is next; the kind chip and the facts; the branch and its review mark** | The name had 150 px of a 229 px row beside the chip, and the facts never showed behind the action |
| 577 | A long name or state? | **Two lines, then "…"; the tip says it whole** | 5 of 9 names and 6 of 9 states were cut to one line; two lines left 0 names and 3 states cut (two long commands and a question) |
| 578 | How do the facts show on a card? | **An icon and a number each (commits, files not committed), the merge check as "clean" or "n conflicts" in its state's colour; their words in tips and for screen readers; the head keeps the words** | "2 commits · 23 files not committed yet · Conflicts with main in 1 file" is 330 px in a 214 px row |
| 579 | The branch? | **On every card, its last row as today** | The person's choice; it repeats the kind and the title in 95 of 103 records, and is the link to Git |
| 580 | How are the cards apart? | **10 × 12 px in, 6 px between, 20 px lines; each on a 3.5 % wash of the text; the 72 px limit dropped** | Rows 1 px apart and cards 11 px read as one block; the waiting band's cards are washes already |
| 581 | The sidenav's width at first? | **300 px (264)** | The person's choice: most names fit on one line; the main area keeps 1,140 px at 1440 |
| 585 | Start a workspace beside a 300 px sidenav? | **Its run column at least 412 px (380): its width at 1440 beside 264 px; the brief column gives the 13 px** | At 398 px Plan first's line wrapped and More closed ran 12 px past 1440 × 1000, V63's promise |

## As built (V79)

- **The rows as planned**, the branch on every card (the person's choice) and its review mark
  beside it as before; the time at the end of the name's row. A starting card has its kind too
  (`StartUnderWay.kind`, from the Start page), so its rows are the card's it becomes.
- **The facts** are `workspaceFacts` (pure, `workspaces.ts`): the head's words and the card's
  numbers from one function, the head's words unchanged. On the card each is a `role="img"` span
  named by its words (a capital first), its tip the same words; `CardFacts` reads the merge check
  as the head does, the state's line on a card no longer does.
- **The wash** is a 3.5 % mix of `--text` written in `Sidenav.css`, as Waiting for you's cards'
  4 % is, not a new theme token. Its hover 7 %. A card being cleaned up keeps it under the pointer
  (it was transparent there). Folded, the rail draws the dots alone, without it.
- **The cards' 1 px transparent border is gone**: it made every card 2 px taller than its rows,
  and nothing drew it since V37.
- **The branch's link set its own 18 px line**: the branch's row was 18 px in a 20 px rhythm until
  it took 20.
- **Groups' headings re-aligned**: their icon over the cards' dots (within 0.5 px) and their name
  over the cards' names (37 px; 44 in the waiting band), 20 px under the last card.
- **What 300 px moved elsewhere**, found by the full e2e run (`pnpm test:e2e`, 7 of 340 failed):
  - Start a workspace at 1440 × 1000 scrolled 12 px with More closed: decision 585 (582 in
    `46ff79b`, before `main` gave 582 to MC2).
  - A workspace's terminal: 119 columns alone (124), 89 beside the changes panel (94), 59.7 % and
    44.6 % of the window (62 %, 47 %); `shell.spec.ts` and `changes.spec.ts` say the new numbers.
    The changes panel still shows at 1440 (1,140 px of main area, over its 1,100).
  - Git's HEAD row at 1440 with two badges ("HEAD → main", "origin/main") beside the details:
    its subject had 23 px on `main` ("h…") and has none now. V10b lets the subject give way before
    the badges; unchanged here. `tooltips.spec.ts` waits for the row, not its subject.
  - V44's spec ("no icon in a card") leaves out the facts' icons; V24c's finds the kind in the
    facts' row.

**Results.** The mock list of the spike (nine workspaces, one in each state, and a merge), 1440 ×
900, 1×: `main` at `b3e8c03` (264 px) against the branch (300 px).

| What | `main` | V79 |
|---|---|---|
| Names cut | 5 of 9 | **0** |
| State lines cut | 6 of 9 (one line) | **2** (after two lines: a long command, a question) |
| Branches cut | 4 of 9 | **1** (`feature/remove-scout-in-page-settings`) |
| A card | 72 px (the merge 54), 1 px apart | 118–146 px (the merge 66), 6 px apart |
| The cards in all | 807 px | 1,266 px |
| Cards wholly in view, top of the list | 4 | 3 |

At 264 px (a width the person dragged) V79 still cuts no name; 3 states and 4 branches.

Timings, `main`'s build (`git archive main`, built in the job's folder) and the branch's alternated
on an idle machine: Git's first paint in a scratch repository with the mock list, cards and rows
drawn, median of 7, **213 → 211 ms** (first contentful paint 76 ms both). Bitwarden `737ee3f`
(`measure.mjs`, 8 rounds): first paint median **309 → 316 ms**, select **106 → 105 ms**, pan
63 fps both, the same 3,160 elements, no page errors. Mark reviewed lands at 50 or 67 ms on both
builds (3 or 4 frames of 16.7 ms; main 34–68, the branch 49–68): no graph or diff code differs.
`pnpm test:e2e`: the viewer's 340 and the nexus's 15 pass; after `main` was merged in (V77, V78,
MC2) 342 and 15, `pnpm check` 2,271 unit tests.
