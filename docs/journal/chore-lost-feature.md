# Journal: Chore — the merge page remake, built

[Index](../JOURNAL.md)

## Chore — the merge page remake, built (2026-10-22, branch `chore/lost-feature`)

The person: "There was a remake of the merger page… that seems to be lost." It was never built.
On 2026-10-20 the resolution to review was called "mega ugly"; a static mockup followed (a card
per merge, the resolution first with each line's side marked, a verdict in words, the raw
conflict folded), then the session turned to V26b and dropped it. No commit, branch, stash or
dangling commit had it; only the mockup in a session's scratchpad was left. Built now from it,
in the symbiote-style tokens.

**Learned**:
- **The reviewer's question is "what was lost?"**, not "what are the three sides?". The page now
  says it: "Drops all 6 lines from agent", "1 line kept twice", "1 line written by the agent", or
  "Keeps every line of both sides, nothing new", with counts (`main 1/1 · agent 0/6 · new 0`).
- **A side's own lines are those the ancestor lacks.** A line one side kept from the ancestor and
  the other deleted is no loss when the resolution drops it; a line both sides added alike, kept
  once, counts for both. Lines compare without indentation; blank lines are not counted.
- **The style forbids the mockup's coloured side bars** (tokens test): a line's side is a tinted
  row and its name in the gutter; the target is `--info` blue, the branch `--lane-1` purple (only
  on this page), written lines `--modified`, dropped and doubled `--removed`.
- Retry and Remove moved to the "⋯" menu; `MoreActions` left `Workspace.tsx` for both pages.

**Verification**: tests first, red for the right reason: 6 unit (`reviewRegion`, `regionFlags`,
`mergeLabel`), the merger e2e (lines and their sides, the verdict before and after Ask again, the
dropped lines, the conflict folded, the menu). `pnpm check` 1,119 tests; build; e2e 176 of 176.
Screenshots at 1440×900 dark and light and 390 px wide. Not verified: a real merger agent's
resolution (the e2e's fake answers only); a region of hundreds of lines.

Merged into main (2026-10-22) by Symbiote's merger, from the approved `e6588ca`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md`, resolved in the merge.
