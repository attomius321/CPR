# Journal: Rename to Symbiote

[Index](../JOURNAL.md)

## Rename to Symbiote (2026-10-21, the rename's feature branch)

Asked: replace the former name everywhere, the commands too, and keep the person's workspaces
and reviews (decisions 223–225).

**Learned**:
- **It was 4,782 occurrences in 311 of 867 tracked files**, and 12 paths. One script over
  `git grep`, by case: before `_` or after it `SYMBIOTE` (env vars, constants), the upper and
  title cases `Symbiote`, the lower case `symbiote`. A case-blind search also matched words such
  as `PublicProps`; the case-exact one matched only the name, `\n` before it included.
- **A plain replace would have lost the person's data**: the repository's folder (reviews,
  workspaces, threads), the cache's state, and the app's settings and choices are all found by
  the name. They move once, on first use (`former-name.ts`). The cache's worktrees do not: git
  records their paths in each repository, and Symbiote makes new ones.
- **After the merge, both folders exist in this repository**: the merge brings the tracked
  `symbiote/config.json`, the untracked reviews stay in the former folder. So the move merges
  entry by entry and drops a file the new folder has the same, rather than renaming the folder.
- **Development runs must not move the live data**: the CLI moves the cache only without
  `SYMBIOTE_CACHE_DIR` (every e2e sets it), the app moves its settings itself (its e2e sets
  `XDG_CONFIG_HOME`), and the repository's folder moves in `reviewPlace` (tests use temp repos).
- Prettier does not wrap comments: the longer name pushed 124 comment lines past 100 columns,
  rewrapped by a script.

**Verification**: `pnpm check` (1,107 unit tests; 9 new for the move, 1 for the desktop entry,
2 for the app's settings and choices, each red first). The graph of this repository's last 20
commits is identical to `main`'s but for `generator.name` (1,404 nodes, 3,266 edges): the
analysis did not change. A copy of the person's live folder (32 files) moved into `symbiote/` in
a temp repository, all but the three files Symbiote writes again. E2E 169 of 171: the shell's
two focus specs (`shell.spec.ts:119`, `:162`), a key press lost under load. Alternated with
`main` in batches of 5 under the same load (other servers and the app running): the keys spec
failed 8 of 30 on `main`, 7 of 30 here. The move's first version asked git on every refresh of
the workspaces; it now asks only when the former folder is there.

Merged into main (2026-10-21) by Symbiote's merger, from the approved `6d0275d`, no conflicts
(`main` had not moved since the branch).
