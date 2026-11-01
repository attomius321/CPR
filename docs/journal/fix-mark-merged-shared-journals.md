# Journal: mark-merged and journals several branches wrote in

[Index](../JOURNAL.md)

## Fix — mark-merged and journals several branches wrote in (2026-11-01, branch `fix/mark-merged-shared-journals`)

The first `--write` of `scripts/plan/mark-merged.mjs` on `main` (after `72fe24d`) put
"Merged into main (2026-10-30)." at the end of `docs/journal/v82-hive-mode.md`. That journal holds
the entries of six branches; its last is Alpha Ceph's (`feature/alpha-ceph-hive-name`, merged
2026-10-31), and the date was V82's. The line was taken out by hand before the "Docs: merged"
commit (`3f7ffa3`). That commit's body says 11 plan Status lines; it changed 12.

The cause: a row with no plan of its own took its branch from the first one its journal names.
Five rows link `v82-hive-mode.md` as a whole, and all five got `feature/hive-mode-setting`. Their
real branches were merged too, so their ✅ were right, by luck.

Now:

- A row with no plan of its own is merged only when every branch its journal's entries name is
  (`## … (date, branch \`x\`)`); one merged and one not is a note for a person.
- The journal's last line is its last entry's: the date that entry's branch was merged, and none
  while that branch is not merged.

**Verification**: the test's new cases red first (a row marked through its journal's first branch
alone; the journal's line with the first branch's date), then 3 of 3. On `main` before the manual
index chore (`c88b237`): the same rows as before the fix and as that chore. On `main` before
"Docs: merged" (`72fe24d`): the same files as that commit, plus "Merged into main (2026-10-31)."
after Alpha Ceph's entry in `v82-hive-mode.md`. On today's `main`: nothing to mark, 9 notes.
`pnpm check` green.
