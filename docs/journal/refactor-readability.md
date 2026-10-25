# Journal: Refactor — the CLI's services and the viewer's pages in modules one can read

[Index](../JOURNAL.md) · [Plan](../plan/refactor-readability.md)

## Refactor plan — where the length is (2026-10-25, branch `refactor/codebase-refactoring-readability`)

Measured at `c137455` before moving anything: every source file's top-level declarations and
their spans (a TypeScript walk), the import graph of each package, and which tests read source
paths.

**Learned**:
- **The length is in closures, not in files of many small functions**: `workspaces()` is 1,502
  of `workspaces.ts`'s 3,003 lines, `startViewServer` 1,161 of `server.ts`'s 1,844, `merger()`
  857 of `merges.ts`'s 1,133; the viewer's pages are components of 476–742 lines with JSX returns
  of up to 404.
- **Three import cycles in the CLI, all from one file holding what others need**: `codex.ts` and
  `terminal.ts` import from `workspaces.ts` (`runProgram`, `WorkspaceFile`, `OpenFolder`), which
  imports them; `reviews.ts` takes `StateStore` from `server.ts`.
- **One test pins a file path**: `packages/cli/test/naming.test.ts` lists the files where
  `feature` may be an identifier; moving the kinds of work changes one of its strings, not its
  rule (decision 348, asked first).
- **Runtime paths the CLI's layout must keep**: the hooks and the Codex runner are found beside
  their importers (`new URL('./agent-hook.js', import.meta.url)`) and written into settings files;
  the e2e harness imports `packages/cli/dist/app-server.js` (decision 344).

**Verification**: baseline `pnpm check` 1,572 tests in 113 files, passing.
