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
