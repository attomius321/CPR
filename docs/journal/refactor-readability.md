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

## Refactor — the CLI's services and the viewer's pages in modules (2026-10-25, branch `refactor/codebase-refactoring-readability`)

`workspaces.ts` (3,003 lines) is a 1,263-line service beside nine modules: Claude Code's driver,
the level checks, the program runners, the record, the brief, a start, documents, changes and
Codex's side. `server.ts`'s parsers are `server-requests.ts`, its 300-line route chain named
groups; the merger's queue file and lock are `merge-queue.ts`. In the viewer, History's API,
rows and compare bar, the workspace panel's heading parts, tabs and reply box, the start page's
kinds and agent, and the diff page's canvas, loading and review state are files and hooks of
their own. Decisions 344–348.

**Learned**:
- **Moves are cheapest done by the syntax tree, not by hand**: a script that cuts top-level
  declarations (and a closure's statements) with their leading comments and appends them
  elsewhere moved 156 symbols whose body hashes Symbiote then found unchanged. Its first version
  put a blank line between declarations that shared one comment (`MAX_DOCUMENTS`'s three,
  `MODEL_ARGS` and `INITIALIZE`); it now keeps the separation they had.
- **A two-way split can make a new cycle**: the record reads the brief's parts and the brief's
  checks throw the record's refusal. Three modules, one direction, instead.
- **A sync route group cannot tell "not mine" from "answered"**: `send()` and `redirect()` return
  nothing, so a group returning `undefined` for an address it does not take would have dropped
  the redirect of `/diff/<pair>` (without its slash) into the fallback. Each group is async and
  ends in the same fallback `handle()` had instead.
- **An unquoted heredoc eats template literals**: one edit script lost its
  `${MAX_DOCUMENT_BYTES / 2 ** 20}` to bash; its assertion caught it before anything was written
  to the service. Every later script ran under `<<'EOF'`.
- **Renaming a closure's helper as it leaves can collide with a local**: `serverOf` → `server`
  shadowed `const server` in the same function; the name stayed.

**Verification**: `pnpm check` (1,572 tests, 113 files) and `pnpm build` at each of the 13
code commits; test files differ only in imports and `naming.test.ts`'s path (a script comparing each
file with its imports removed); e2e 240 of 240 five times, the last on the branch's head;
`symbiote diff main HEAD`: 156 moved symbols, all with the same body hash; no import cycle left
in the CLI.

Not verified: screenshots against `main`'s (no class name, CSS rule or DOM order changed); the
desktop window beyond its e2e specs; real Codex and Claude Code runs (fakes in the tests, as on
`main`). The merger's commit message says its e2e ran after the split; that run was at the
routes' commit, and the History split's run (its build had the merger's split) is the first
that covered it.

