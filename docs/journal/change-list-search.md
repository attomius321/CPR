# Journal: Change-list search

[Index](../JOURNAL.md)

## Change-list search (2026-10-03, branch `claude/change-search`)

With hundreds of changed symbols, finding one meant scrolling the Changes tab. A search box at
its top now keeps the symbols whose file path and name hold every word typed (ignoring case; a
word matching the file keeps all its symbols). `/` focuses it, Enter opens the first match, and
j/k walk only the matches — so the tab and the query moved from `Sidebar` up into `App`.

**Learned**: the commit was made by an automated step in this session (branch switch and commit
in the same second) and left the shared checkout on its branch; check `git branch --show-current`
before assuming the checkout is on `main`.

**Verification**: `pnpm check` (295 tests), build, 28 e2e tests including the new search test in
`large-graph.spec.ts`. Fast-forwarded into main (2026-10-03).
