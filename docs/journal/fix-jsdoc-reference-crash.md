# Journal: Fix — a doc-comment reference crashed the analysis

[Index](../JOURNAL.md)

## Fix — a doc-comment reference crashed the analysis (2026-10-03, branch `fix/jsdoc-reference-crash`)

Found while measuring Bitwarden for V7: 5 of 8 runs crashed. Q1's per-site props check reads the
parent of a reference's node, and `findReferences` returns `{@link Class.member}` in a JSDoc
comment at a node without a parent. Such a reference is no JSX use: what it passes is unknown,
as for any non-JSX reference.

**Verification**: a test with a resolving `{@link Badge}` (red before: the same `TypeError`); the
29 R1 comparisons identical to W1's baseline (932 edges, no finding changed); the 8 Bitwarden
changes complete; full suite 378 tests, 29 browser tests.

**Learned**: Q1 changed core's references but its checks were the fixtures and Qwik's docs site.
Every core change re-runs the 29 comparisons and Bitwarden from now on.

Merged into main (2026-10-03).
