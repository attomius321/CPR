# Fix — Changed lines of a path with a space

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding C1)

**Status:** planned (2026-11-06), to be built on branch `fix/path-with-space` in its own
workspace; written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** fix · **Branch** `fix/path-with-space` · **Size** S · **Depends on** none ·
**Plan** P15 of 51 (the audit's order)

## The brief

**What happens**: for a file whose path holds a space, `listChangedLines` keys its lines under
the path plus a TAB (`my file.ts\t`). No finding on that file matches a changed line. Three
outputs lose all of that file's findings:
- `symbiote pr --post-findings` (`main.ts:1565`);
- `--codequality` (`main.ts:592`);
- Hive's review of a request (`hive-request.ts:175`).

**How to reproduce**: in a scratch repository, commit `my file.ts`, change it, and run
`git -c core.quotePath=false diff -U0 --src-prefix=a/ --dst-prefix=b/ | cat -A`. The headers
read `--- a/my file.ts^I` and `+++ b/my file.ts^I`. Feed that patch to `parseChangedLines`: the
key ends in `\t`.

**Where to look**:
- `packages/core/src/git/changed-lines.ts:73-77` (`headerPath`): it strips the `a/` and `b/`
  prefixes, not git's trailing TAB.
- `:13-34` (`listChangedLines`) runs with `core.quotePath=false`. A name with a space is then not
  C-quoted, and git appends a TAB to the header.
- The test, `packages/core/test/git.test.ts:132-163`, writes its patch by hand, without the TAB.

**Out of scope**: rename detection, binary files, the graph's own paths (`analyzeGit` does not
use this parser).

**Done when**: the changed lines of `my file.ts` are keyed `my file.ts` from real git output.
The new test passes, and the existing quoted-name case (`"b/caf\303\251 \"q\".ts"`) still does.

## Evidence

- **Reproduced (git's side)**: `git diff | cat -A` in a scratch repository printed
  `+++ b/my file.ts^I$`.
- **Code**: `headerPath` returns `name.slice(prefix.length)`, the TAB kept.

## Approach

- In `headerPath`, drop one trailing `\t` from an unquoted name before removing the prefix:
  `raw.endsWith('\t') ? raw.slice(0, -1) : raw`. Git writes the TAB only after an unquoted name
  that holds a space (`diff.c`, "name needs a terminator"). A quoted name has none.
- Do not `trimEnd()`: a name can end in spaces, and git keeps them before the TAB.

## Tests first

1. `packages/core/test/git.test.ts`, in `describe('parseChangedLines')`: a patch with
   `'--- a/my file.ts\t'` and `'+++ b/my file.ts\t'` expects the key `my file.ts`. It fails today
   (the key is `my file.ts\t`).
2. The same file, a real-git case with `createRepo()` from `test/helpers/git-repo.ts`:
   `listChangedLines` on a commit that changes line 2 of `src/my file.ts` gives
   `head: { 'src/my file.ts': [2] }`. It fails today.
3. A name ending in a space (`'b/odd .ts\t'`) keeps the space: `odd .ts`.

## Verification

- `pnpm check`, `pnpm build`.
- `regression-check`, the `r1` set against `main`. `parseChangedLines` is not on the graph's
  path, so the 29 comparisons must stay identical, and goldens in
  `packages/core/test/__snapshots__/` must not change. No graph JSON change: no schema bump
  (`packages/core/CLAUDE.md`, "Graph JSON changes").
- By hand: `symbiote diff HEAD~1 --codequality cq.json` in the scratch repository with an orphan
  function added in `src/my file.ts`. The Code Quality report must hold the finding with its
  line.
