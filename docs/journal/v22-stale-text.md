# Journal: V22 — Stale text outside the README

[Index](../JOURNAL.md) · [Plan](../plan/roadmap.md)

## V22 — Stale text outside the README (2026-10-19, branch `fix/v22-stale-text`)

Found while rewriting the README (2026-10-15). Fixed:
- `symbiote --help` and `symbiote view --help` said the first page lists the current branch's commits; it
  has listed every branch since V10a, and picks happen in Compare mode since V13. Both now say so.
- `symbiote --help` showed `pr <number>`; the number is optional since C1 (a CI job's own).
- `@symbiote/cli`'s description named `symbiote diff` and `symbiote view`, not `symbiote pr`.
- The action's `plugins` input pointed to `symbiote.config.json`, the older place; now
  `symbiote/config.json`, as the README and the GitLab template say.
- The sidebar's "No findings." ended with an emoji.

**Verification**: a unit test first (`symbiote` and `symbiote view --help` say "every branch", never
"current branch"), red on the old help, green after. 729 of 731 unit tests: the two that load
node-pty fail here and on `main` alike (node-gyp is not in this container, so node-pty is not
built). Build. E2e: 99 of 103; the two terminal tests need node-pty (as above), and
`commits.spec.ts:161` (compare mode's toggle position) fails on `main`'s build too. A fourth,
`reviews.spec.ts:353`, failed once removing its temp directory (`ENOTEMPTY`) and passed 3 of 3
alone. No analysis code changed: no regression sets. Not verified: the terminal e2e tests.

Merged into main (2026-10-19): no conflicts, `main`'s tree the branch's. `main` verified after the
merge: 729 of 731 unit tests (the two node-pty ones, as above), build, 97 of 103 e2e — the same
three as on the branch, and `interdiff.spec.ts` (2) and `reviews.spec.ts:75`, which passed on the
branch with the same tree and passed 8 of 9 when run alone afterwards (flaky, not this change).
