# Journal: Fix — `symbiote/merge.md` can be committed

[Index](../JOURNAL.md)

## Fix — `symbiote/merge.md` can be committed (2026-10-20, branch `fix/merge-md-shared`)

Found while planning V28. `symbiote/merge.md` holds a project's merge rules for the merger (V26c), but
the `symbiote/.gitignore` Symbiote writes (`*`, `!config.json`) hid it, so the rules stayed on one machine.
Forcing it into git would have been worse: `reviewPlace` treats any tracked file in `symbiote/` that is
not Symbiote's (`config.json`, `.gitignore`, `AGENTS.md`) as the project's own folder, and moves the
reviews to Symbiote's cache.

Now `GITIGNORE` also un-ignores `merge.md`, `merge.md` is one of Symbiote's files, and a
`symbiote/.gitignore` whose text is exactly what Symbiote wrote from V15 on is replaced by the new text. A
`.gitignore` with any other text is still the project's and left alone.

**Verification**: 2 tests red first (a committed `merge.md` sent the reviews to the cache;
`git status` did not show `merge.md`), green after; 900 unit tests, lint, typecheck, build.
README not changed: its Merging section does not describe `symbiote/merge.md` yet (left for later).

Merged into main (2026-10-20), before V28.
