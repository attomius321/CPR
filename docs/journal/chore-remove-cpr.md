# Journal: Chore — Remove CPR

[Index](../JOURNAL.md) · [Plan](../plan/chore-remove-cpr.md)

## Remove CPR: the old address and the former name's move (2026-11-08, branch `chore/remove-cpr`)

The repository was renamed from `attomius321/CPR` to `attomius321/Symbiote` today, and the person
asked to remove everything still tied to CPR. The regression set, a test case and a spike name
the new address. The move from the former name (decision 224) is gone: decision 953, nothing
under "cpr" is moved, read or removed now. The audit's P02 was resolved by the rename.

**Learned**:
- **`moveInto` was the move's alone**, and `reviews.ts`'s former-folder branch was the only code
  outside `former-name.ts` that used it. `holdsProjectFiles`, which that branch also called,
  stays: `reviewPlace` asks it whether `symbiote/` holds the project's own files.
- **No test outside the move's own covered it**: `reviews.test.ts` and the desktop's `state`
  tests never wrote a `cpr` folder or a `cpr.*` choice. Removing the code took 13 tests (the two
  `former-name.test.ts` files and one `app.test.ts` case); the 3,444 others pass.
- **`docs/decisions.md` cannot be regenerated on a branch alone**: `consolidate.mjs --write` here
  would also mark decisions merged earlier in ten plans. Only this decision's lines were changed,
  as the script writes them.
- **The old addresses still answer**: `github.com/attomius321/CPR` redirects (301) to the new name,
  and the raw URL under `CPR` answers 200, so a copy of an old address keeps working.

**Verification**: `pnpm check` (244 test files, 3,444 tests, the desktop's 64 among them) and
`pnpm build` pass. `git grep -n -i -w cpr` and `git grep -n -i former-name` find only the plans
and journals kept as written, this chore's plan and journal, and two binary screenshots under
`spikes/`. P02's `curl` checks and a `git clone` of the README's URL without credentials: in its
plan.
