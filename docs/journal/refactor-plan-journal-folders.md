# Journal: Refactor — the plan and the journal in folders, read through an index

[Index](../JOURNAL.md) · [Plan](../plan/refactor-plan-journal-folders.md)

## Refactor spike — what the plan and the journal cost to read (2026-10-24, branch `refactor/journal-and-plan`)

Measured at `86d9530` before moving anything, tokens taken as bytes / 4.

**Learned**:
- **The two files are 1.29 MB, about 320K tokens**: `PLAN.md` 882,633 bytes in 11,087 lines,
  `JOURNAL.md` 406,960 in 5,653. 92 % of the plan is its 49 milestone sections; the North Star
  and §1–§11 are 21 KB, "Proposed next" 33 KB.
- **"Proposed next" is no longer a list of next things**: 50 rows, 40 marked ✅, each the
  milestone's problem in a paragraph (up to 1.3 KB). The sections tell the same.
- **The sections are in merge order, not by ID**: V10c before V10b, V44 before V43, V20 after
  V18 and before V21.
- **Status lines lag the merges**: V39–V44 and the viewer refactor say "ready for review" while
  `main` has their merge commits; Symbiote's merger merges without the "Docs: <ID> merged"
  commit. Left as written here; the index's status column is git's.
- **Decision numbers are not unique**: 242 and 243 are each a V26 fix's and V36's, from two
  branches built side by side. `merges.ts` cites V26's 242, so neither is renumbered.
- Across `main` and every branch, the highest decision is 289: this refactor takes 290–293.

## Refactor — the plan and the journal in folders, read through an index (2026-10-24, branch `refactor/journal-and-plan`)

`docs/PLAN.md` is the North Star and an index of 88 rows by area (13.7 KB); `docs/JOURNAL.md`
lists 172 entries by date (15.7 KB). Each milestone has its plan in `docs/plan/` and its journal
in `docs/journal/` under one name; a fix on its own branch has a journal file only. Text moved
word for word. Decisions 290–293.

**Learned**:
- **A plain read of the old files never reached recent work**: it stops at 2,000 lines, 174 KB of
  PLAN.md (up to V7) and 135 KB of JOURNAL.md (up to 2026-10-14). The indexes come back whole.
- **Two sections had no blank line before the next heading** and 5 journal entries a double one:
  a rebuild that wants byte equality has to allow for them, or it reports whitespace as loss.
- **Heading levels inside code fences** (V24's brief format, `# <Kind>: <title>`) must not move
  with the plan's headings: the split tracks fences, indented ones included.
- **The merger's own test case is a conflict in `docs/JOURNAL.md`**, two entries appended at the
  end: after the split, two branches still both add an index line there, but no longer a section.

**Verification**: both files rebuilt from the new ones equal the originals but for the 2
rewritten intro passages and 7 blank lines; 295 decision rows and 172 entries, each once; 638
relative links in 160 Markdown files, 0 broken; `git diff main` is Markdown only; `pnpm check`
1,387 tests, `pnpm build` passes. The skill's greps for the next decision (293) and a taken ID
run on every branch, old layout and new.

Not verified: the anchors on github.com (GitHub's slug rules, by a script); the savings in an
agent's real session; the merge of `milestone/v20-other-agents`, which still appends to the old
files.
