# A milestone's journal — template

`docs/journal/<id>-<slug>.md`, the plan's name; a fix or chore on a branch of its own has
`fix-<slug>.md` or `chore-<slug>.md` and no plan. One entry per spike, part, replan or fix, newest
last, in the style of the entries already there: short sentences, numbers, what was not verified.
An entry made on a milestone's branch goes in that milestone's file.

```markdown
# Journal: <ID> — <the plan's title>

[Index](../JOURNAL.md) · [Plan](../plan/<id>-<slug>.md)

## <ID> spike — <what was measured> (<date>, branch `<branch>`)

What was measured and on what (repositories, commits), in a paragraph.

**Learned**:
- **<The surprise or the trap>**: the numbers that show it; what it changes in the plan.

## <ID> — <what was built> (<date>, branch `<branch>`)

What was built, in a paragraph; decisions <n>–<m>.

**Learned**:
- **<The trap>**: how it was found, what it took.

**Verification**: tests first (red for the right reason), `pnpm check` (<n> tests), e2e,
comparisons ("29 comparisons identical"), real repositories before and after, cost in time.

Not verified: what was not, and why.

Merged into main (<date>).
```

Each entry also gets a line at the end of `docs/JOURNAL.md` (the heading without its
parenthesis):

```markdown
- <date> [<ID> — <what was built>](journal/<id>-<slug>.md)
```
