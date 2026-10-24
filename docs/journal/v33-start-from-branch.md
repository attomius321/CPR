# Journal: V33 — Start a workspace from a branch

[Index](../JOURNAL.md) · [Plan](../plan/v33-start-from-branch.md)

## V33 — start a workspace from a branch (2026-10-22, branch `feature/start-a-workspace-from-branch`)

Asked: "There should be an option on start a workspace page where i can select the branch from
which i start." A Start from select: the default branch, the local branches, then those only on
a remote; a History row's commit first when the page came from one (decisions 230–232).

**Learned**:
- **Stacking was possible but lost the branch.** Starting from a branch's tip row in History
  gave the right commit, but the record had no `from`, so the agent's prompt said "the commit
  abc1234". Now the record and prompt name the branch.
- **One rule for every branch's tip.** `workspaceBase` already chose between the local and the
  remotes' tips of the default branch; `newestTip` is that rule by name, and asks git only where
  tips differ (0 of 102 names here), so listing stays cheap: 2–3 ms for 102, 17–20 ms for 1,641.
- **The pick is resolved at the start, not at page load**, as the default branch was: a branch
  that moved while the form was open starts at its new tip.
- **Without a default branch the page used to refuse**; now it starts from the first branch.

**Verification**: tests first, each red for the right reason (unit: `startBranches`, options,
`start({ from })`, refusals of an unknown name and of `from` with `base`, `readRun`; e2e: the
list, a pick reaching git and the prompt, kept on leaving, reset after a start, a remote-only
branch, a History row's commit). `pnpm check` 1,113 tests, `pnpm build`, e2e 175 of 175 (the
keyboard test's Tab order now includes Start from). Screenshots at 1440×900 dark and light and
390×844. Not verified: a real agent from a non-default branch; a 1,591-branch select in a
browser.

Merged into main (2026-10-22) by Symbiote's merger, from the approved `5c82f01`; `main` had moved
since the branch: a conflict in `docs/JOURNAL.md`, resolved in the merge.
