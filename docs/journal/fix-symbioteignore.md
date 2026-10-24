# Journal: Fix — `.symbioteignore` from the working folder, with gitignore's rules

[Index](../JOURNAL.md)

## Fix — `.symbioteignore` from the working folder, with gitignore's rules (2026-10-02, branch `fix/symbioteignore`)

Both found in the Angular 11 trial, where `interfaces/` in a `.symbioteignore` did not ignore the
nested `interfaces` folders of a monorepo:

- **Where it is read**: `analyzeGit` read `.symbioteignore` from the checkout of the analyzed head
  commit, so an uncommitted file — or a diff of two older commits — went by another file or none.
  It is now read from the working folder's repository root (like `symbiote.config.json`) and passed
  to the analysis as an `ignore` matcher (`LoadOptions.ignore`, used for both the changed-file
  filter and the program's file list). Comparing two folders still reads the head folder's.
- **How it matches**: a pattern ending in `/` was anchored at the root (`interfaces/` became
  `interfaces/**`, then "contains a slash"), and a leading `/` was stripped and then matched at
  any depth — both the opposite of git. Now, as in git: only a `/` at the start or in the middle
  anchors; `dir/` matches folders only; a pattern matches a path or any folder above it, so
  `secrets` also ignores `secrets/key.ts`.

Tests: 11 gitignore cases, and an `analyzeGit` test where the committed `.symbioteignore` says one
thing and the uncommitted one another (4 of them failed on the old code). The CLI on a nested
monorepo, with an uncommitted `.symbioteignore` and a diff of older commits, lists both `interfaces`
files as `(ignored)`. The 29 R1 comparisons (no `.symbioteignore` in those repos) are unchanged.
