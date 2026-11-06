# Chore — The style skill's frame numbers match the tokens

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (docs that disagree
with the code: the style skill's numbers)

**Status:** planned (2026-11-06), to be built on branch `chore/style-skill-numbers` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/style-skill-numbers` · **Size** S · **Depends on** none ·
**Plan** P26 of 51 (the audit's order)

## The brief

**What to change**: the `symbiote-style` skill, which every restyle reads first, gives the page
frame's numbers from before V85 and V93. Agents following it draw the old frame.

**Where to look**, the skill's figures against today's:

| Where | The skill says | The code has |
|---|---|---|
| `.claude/skills/symbiote-style/SKILL.md:40-41` | title at x 52 | `TITLE_AT = 56` (`packages/viewer/e2e/page-frame.spec.ts:33`) |
| `SKILL.md:41` | cards from y 64 | `CARDS_FROM = 72` (`page-frame.spec.ts:31`) |
| `SKILL.md:43` | a card's head is 37 px | `--card-head: 40px` (`packages/viewer/src/ui/base.css:32`, V93) |
| `SKILL.md:113` (dated patterns, "the style's answer") | 16 px margins and gutters, 16 px insets, 48 px card heads | 12, 8, 12 and 40 (`base.css:28-32`; V85, decision 713; V93) |
| `.claude/skills/symbiote-style/tokens.md:246` | `--card-head` 37 px | 40 px |
| `tokens.md:276` | line tabs 32 px in a 37 px card head | in a 40 px head |

`SKILL.md:41-42`'s "12 px from the area's edges and 8 px apart" and "12 px in" are right.

**Out of scope**: the tokens and the viewer's CSS (the code is right; the skill is behind),
`components.md` beyond these numbers (read it for the same figures and fix any found).

**Done when**: every frame figure in `SKILL.md`, `tokens.md` and `components.md` equals
`base.css`'s tokens and `page-frame.spec.ts`'s constants. The table row says which milestone set
each value.

## Evidence

- **Code**: the table above, read in both files. The audit's viewer review found the
  37-against-40 and 16-against-12 gaps; the x 52 and y 64 gaps were found while writing this
  plan.

## Approach

- Edit the figures in place (CLAUDE.md: edit the page a fact belongs to, never append). Cite
  V85 (decision 713) and V93 where the skill cites V72.
- Then `grep -n "[0-9]\+ px" .claude/skills/symbiote-style/*.md` and check each frame figure
  (margins, gaps, insets, heads, the title's x, the cards' y) against `base.css` and
  `page-frame.spec.ts`. Leave colours and contrast figures, which `tokens.test.ts` guards.

## Verification

- `pnpm check`.
- A reader check: a fresh agent given only `SKILL.md` answers "how far from the main area's top
  do cards start, and how tall is a card's head?" with 72 and 40.
