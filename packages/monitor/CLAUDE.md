# @symbiote/monitor

Repository monitoring (RM1, `docs/plan/rm1-code-concentration.md`): what a commit's files are and
how many lines of code each holds, for the viewer's Monitor page. Node only; depends on
`@symbiote/core` for its git runner (`git`, `gitInput`: no optional lock) and `.symbioteignore`'s
matcher, and on nothing else. The viewer imports only its **types** (`CodeMap`, `CodeFile`).

## How a map is made (`src/scan.ts`)

1. `git ls-tree -r -z -l` of the commit: blobs only (symlinks, mode `120000`, and submodules,
   type `commit`, left out), sorted by path.
2. Every blob through `git cat-file --batch`, in batches of about 16 MB (one batch in memory at a
   time), each object asked once however many files share it; counted as it arrives.
3. `git check-attr -z --stdin linguist-generated linguist-vendored` once for all paths, and
   `loadIgnores` (the working folder's `.symbioteignore` and its defaults).
4. `kindOf` (`src/kinds.ts`) and `countLines` (`src/count.ts`) per file. `codeMaps` caches the
   maps by commit (the last four); a commit's files never change.

## Rules

- **Counting** is cloc's rule: blank, comment (only a comment), else code; a shebang is code.
  `src/languages.ts` holds each language's comments and strings. Only block comments and strings
  that may span lines carry over to the next line: a one-line string ends at its delimiter or the
  line's end, so a misread one cannot spill. Regex literals are skipped in JavaScript's family
  (where a value may start). A language not in the table: every non-blank line is code.
- **Kinds** come only from what a person can read and change: the path, `.gitattributes`,
  `.symbioteignore`; nothing is guessed from content but binary (a NUL in the first 8,000 bytes,
  git's own test). First match wins: set aside, test, the language's kind, other.
- Paths are repo-relative POSIX. A new field in `CodeMap` is optional: the page may be newer or
  older than the server.

## Tests

- `test/count.test.ts`: a case per trap (comment openers in strings and globs, template literals
  over lines, regexes, docstrings, Go's raw strings, CRLF). Add the case before changing the
  counter; check a change against cloc on real repositories (the RM1 journal says how).
- `test/scan.test.ts` makes real repositories with `../../core/test/helpers/git-repo.js`.
