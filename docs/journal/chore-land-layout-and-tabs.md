# Journal: Chore — refactor/layout-flow and refactor/workspace-tabs landed on main

[Index](../JOURNAL.md)

## Two finished refactors merged with their history (2026-11-10, branch `chore/land-layout-and-tabs`)

Asked to land `refactor/layout-flow` (f09eb55b) and `refactor/workspace-tabs` (3a98f188), both
from `main` at 371be1d6, which has 50 commits since. Each merged with `--no-ff`, then this branch
into `main`. No code changed beyond the two branches'.

**Learned**:
- **`main`'s `docs/JOURNAL.md` was 2 lines.** The fix/e2e-flakes docs commit (0c873094)
  replaced its 447 lines with a blank line and its own entry. Git's merge then kept the branches'
  old copy of the index under `main`'s two lines, 444 lines in the wrong order. Each merge was
  resolved to `main`'s file plus the branch's one entry. Asked afterwards, the index was put
  back: 0c873094's parent's 447 lines and the four entries since, by date. Every file in
  `journal/` is listed in it.
- **flow.ts merged without a conflict**, as expected: `main` had not touched it since 371be1d6.
- **Workspace.tsx conflicted only in its imports.** The viewer refactor (decision 960) kept the
  tab block word for word, so git applied the branch's replacement with `shownTab` by itself. The
  import is `import { shellOfUrl, shownTab } from './shells.js'`: `shellAfter` has no other use
  there.

**Verification**:
- `pnpm check`: 253 test files, 3,462 tests. `flow.test.ts` and `shells.test.ts` alone: 46.
  `pnpm build` passes. E2E: the viewer's 438 and the nexus's 32 pass, with no retries.
- The same on a `git archive` export of the merge commit on `main`.

Merged into main (2026-11-10).
