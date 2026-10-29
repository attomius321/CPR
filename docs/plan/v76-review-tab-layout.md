# V76 — The Review tab's layout: sections, labels, a Merge into that fits

[Index](../PLAN.md) · [Journal](../journal/v76-review-tab-layout.md)

**Status:** planned (2026-10-29), on branch `feature/review-merge-layout`; the person's OK given.

**Problem** (asked: "The review tab from reviewer page is ugly, the inputs are all around there,
make some structure on them, also the dropdown is not responsive"). The Review tab is the diff
sidebar's third tab on a branch review (`diff/ReviewTab.tsx`, Merge into from
`workspaces/MergeControl.tsx`). Measured on a scratch repository (2026-10-29: a branch that merges
cleanly, one that conflicts, two branches of 46 and 50 characters), at the sidebar's default 300 px,
1440 × 900:

| What | Measured |
|---|---|
| The branch dropdown of Merge into | **423 px** wide in a 298 px panel: a select is as wide as its longest option |
| The Review tab's content, after an approval | **435 px** in 298: the tab scrolls sideways, `main` runs off the card's edge |
| The Graph page's three tabs (Changes 0/3, Findings 2, Review 1) | 325 px in 298: picking Review scrolls the whole sidebar (`overflow: hidden`) **26 px** left, every row under the tabs cut at its left edge |
| Headings, visible labels | none: the summary has a placeholder, the two dropdowns only an `aria-label` |

The tab is one column at one spacing: the comments, the summary, three radios, the merge check,
Finish review, the result, Copy for the agent, then Merge into, its branch dropdown and its strategy
dropdown each on a line of its own (the flex row of the workspace head wrapped).

**Goal**: the tab in three sections, each with a heading — the comments, your review, the merge —
the controls labelled and aligned 16 px in; Merge into read as a sentence with its dropdowns never
wider than the panel at any sidebar width; the panel never moved sideways by the tabs above it.
**Unchanged**: every word on the tab today, every control's accessible name (`Review summary`,
`Approve`, `Branch to merge into`, `How it lands`, `Merge into`, `Finish review`), what the
controls do, the sidebar's default width, and the workspace head's Merge into (one row).

## The tab (`diff/ReviewTab.tsx`, `ReviewTab.css`)

```
Comments 1                         ← a section head: 15 px, 600, a round count
┌──────────────────────────────┐
│ cube                  Delete │   the comment cards, 16 px in (12 today)
└──────────────────────────────┘
──────────────────────────────────
Your review
Summary                            ← a visible label (aria-label kept)
[ textarea                     ]
Verdict                            ← the fieldset's legend
◉ Comment
○ Approve
○ Request changes
[        Finish review       ] ?
┌ Approved 45e5212: … ─────────┐   ← the result: a status box in its state's tint
│ [Copy for the agent] [Send…] │
└──────────────────────────────┘
──────────────────────────────────
Merge                              ← branch reviews with a target only
✓ Merges cleanly into main         ← the check, an icon in its state's colour
[Merge into] [main            ▾]
             [with a merge commit▾] ⚠
```

- Sections are `<section aria-labelledby>` with an `<h3>` head (15 px, 600, `--text`, the
  count a `.count` chip as the sidebar's tabs), `--card-pad` in, a hairline between them, the
  form rhythm of V72 (`--field-label-gap` between a label and its control, `--field-gap` between
  fields).
- **Your review**: the summary's label is a `<label htmlFor>` reading "Summary"; its `aria-label`
  stays ("Review summary"). The radios keep their `<fieldset>`, with a `<legend>`. The GitLab
  note stays under them. A pull request (`symbiote pr`) has the same section, Submit review to
  GitHub its button, and no Merge section.
- **The result** (`Finished`, the posted and failed lines): a box tinted in its state as the
  merge state's (`p.merge-control`): `--added` for an approval or a posted review, `--muted` for
  comments recorded or changes requested, `--error` for a failure; its buttons on one row.
- **Merge** (a branch review with `into`): `MergeCheck` and `MergeControl` move into it. The
  check's line takes an icon: a check in `--added` when clean, the alert in `--warning` over the
  conflicting files, as today's list. "Merge it into main or another branch below" stays true.

## Merge into (`workspaces/MergeControl.tsx`, `MergeControl.css`)

- In the review's Merge section (`.review-merge .merge-control`): a grid of `auto minmax(0, 1fr)
  auto`: the button in the first column, the two dropdowns stacked in the second, the
  fast-forward warning beside the strategy's. It reads as V26a's sentence ("Merge into ▾ with a
  merge commit ▾", fix/merge-into-main-button: the button names no branch, the dropdown does).
- **The dropdowns never outgrow their place**: `min-width: 0`, `max-width: 100%`, the value cut
  with an ellipsis; in the grid they fill their column. The browser's list of options stays as
  wide as its longest name.
- The two selects get class names (`merge-target`, `merge-how`) for the grid; the workspace head
  (`.workspace-top .merge-control`) keeps its one row, and its branch dropdown the same shrink rule.

## The sidebar's tabs (`diff/Sidebar.css`)

- The tab strip scrolls on its own (`overflow-x: auto`, its scrollbar hidden) when its tabs are
  wider than the sidebar: focusing a tab scrolls the strip, not the sidebar, so the panel under
  it stays where it is. The default width stays 300 px: the Files page (the review's default) has
  two tabs and fits; a wider default would narrow every diff's canvas and still not hold a count
  like Bitwarden's "0/1288".

## Verification

1. **E2e first** (`e2e/reviews.spec.ts`, red before): at the default sidebar width, with a
   50-character branch, after an approval: the Review tab has no sideways overflow; both
   dropdowns end inside the panel; on the Graph page the sidebar's `scrollLeft` stays 0 after
   Review is picked; the three section heads and the "Summary" label are there; the comments, the
   summary and Merge into start `--card-pad` in from the panel.
2. **Nothing else changes**: `reviews.spec.ts`, `merges.spec.ts`, `pr.spec.ts`, `files.spec.ts`,
   `workspaces.spec.ts`, `page-frame.spec.ts`, `tooltips.spec.ts` unchanged and green; the full
   `pnpm test:e2e`; `pnpm check` (`tokens.test.ts`: sizes, radii, colours; `styles.test.ts`).
3. **Screenshots** before and after, 1440 × 900 at 1×, dark and light: the Files and Graph
   pages at 300 and 480 px of sidebar; the clean branch before and after Approve, the
   conflicting branch; a GitHub pull request's review; the workspace head's Merge into. Text at
   3× for uneven letter gaps.

**Risks**

| Risk | Mitigation |
|---|---|
| A spec reads the tab by its old structure (`.posted`, `.finished`, `.merge-check`, `p.merge-control`) | Keep those classes on the same elements; the e2e run says |
| The workspace head's Merge into changes with the shared CSS | The grid only under `.review-merge`; a screenshot of the head |
| A hidden scrollbar hides that the strip scrolls | Only when the tabs do not fit; the picked tab is scrolled into view by the browser on focus |

## Milestones

| # | Milestone | Output |
|---|---|---|
| V76a | The e2e of the tab's layout, red | `reviews.spec.ts` |
| V76b | Sections, labels, the result's box, Merge into's grid, the tab strip | `ReviewTab.tsx/.css`, `MergeControl.tsx/.css`, `Sidebar.css` |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 557 | How is the Review tab organised? | **Three sections with heads — Comments, Your review, Merge — 16 px in, a hairline between, V72's form rhythm; no word of today's changed** | The person: "the inputs are all around there"; one column at one spacing |
| 558 | Merge into in a narrow panel? | **A grid: the button, then the two dropdowns stacked in one column that they fill, cut with an ellipsis; never wider than the panel** | A select is as wide as its longest branch: 423 px in a 298 px panel |
| 559 | The sidebar's tabs wider than the sidebar? | **The strip scrolls on its own; the panel never moves; the default width stays 300 px** | Picking Review on the Graph page slid the panel 26 px left; a wider default narrows every canvas |
| 560 | How does the result of a finished review show? | **A box tinted in its state (added, muted, error), its buttons on one row** | Green words among the fields read as one more field; the merge's state is a tinted box already |

**Not in V76 (later)**: a segmented control for the verdict ("Request changes" does not fit
three to a row in 268 px); a wider default sidebar.
