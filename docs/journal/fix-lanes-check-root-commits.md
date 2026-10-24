# Journal: Fix — lanes-check and root commits

[Index](../JOURNAL.md)

## Fix — lanes-check and root commits (2026-10-14, branch `fix/lanes-check-root-commits`)

Found while checking V10c's comparisons: `git log --format='%H %P'` ends a root commit's line
with a space, and `scripts/viewer/lanes-check.mjs` split it into one parent named `''`, a parent
outside the history (`-1`). `layoutLanes` then gave the root a down-arrow "Its parent is below
the commits listed" whenever more than 100 rows followed, and the script's partner check skipped
it (no row to find). The page never had it: the server reads `%H%x1f%P` and an empty field as
no parents. The script now reads git's output the same way.

**Verification**: on the six regression clones and this repository, before and after: lane
widths identical (max, p95, mean); arrows zod 15 → 14, Qwik 241 → 240, Bitwarden 1,943 → 1,939
(one per extra root), others unchanged; 0 errors after. V10a's published arrow counts are
corrected in PLAN.md (a note under its table) and its journal entry. No product code changed.

Merged into main (2026-10-14). `main` verified after the merge: 619 unit tests, build, 82 e2e; `lanes-check.mjs` on this repository: 0 errors.
