# Journal: Chore — One copy of each small helper

[Index](../JOURNAL.md)

## Core's hash, the viewer's stored choices and its plural, one copy each (2026-11-09, branch `chore/dedupe-helpers`)

Asked to refactor, with no target. A walk of every source file's functions (TypeScript's parser)
ranked the smells; the person chose the duplicated helpers over the long functions. Three
behaviour-preserving steps, one commit each.

**Learned**:
- **The long code is in closures and components.** `hiveRunner` is 2,070 lines, `startViewServer`
  2,054 and `workspaces` 1,620 (the planned refactor-cli-services). In the viewer, the branchiest
  code is `WorkspacePanel` (969 lines, 147 branches) and the longest is `History` (1,477 lines).
  The pure layout `layoutFlow` (378 lines, 64 branches) is the safest of the big ones to split:
  `flow.test.ts` covers it.
- **Names undercount copies.** Functions declared as `plural` showed 2 copies in the viewer.
  Counting `const plural =` too found 23, 18 of them giving the same strings.
- **`hash` in core** was the same 16-hex SHA-256 in `lang/typescript/extract.ts` and
  `lang/css/tokens.ts`. It is now `lang/hash.ts`. The plugins keep their copies: they import
  only types from core.
- **Nine `localStorage` try/catch blocks** are now `ui/stored.ts`'s `readStored` and
  `writeStored`. `readStored` gives null when storage is blocked, empty or missing, which is
  what each catch returned: `null === 'rail'` is false and `null !== 'open'` is true. `store.ts`,
  `SettingsPage.tsx` and `widths.ts` keep their own try, as it also catches their JSON parsing.
- **Four `plural`s stay**: `commits.ts`'s names its word, and three format the number
  (`toLocaleString`, `count`).

**Verification**:
- `stored.test.ts` and `plural.test.ts` were written first and failed for the missing module.
  After each file or batch: the viewer's typecheck and its unit tests (980, then 982).
- `r1` against `main` is identical: 29 comparisons, 859 edges, no finding changed, time 0.95×.
- `pnpm check`: 245 test files and 3,428 tests (`main` had 243 and 3,423; the difference is the two
  new files). `pnpm build` passes. E2E: the viewer's 436 and the nexus's 32 pass, with no retries.
- Not run: the `viewer-check` skill. Nothing drawn, laid out or timed changed.
