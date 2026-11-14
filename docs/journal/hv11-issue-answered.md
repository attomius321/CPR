# Journal: HV11 — The issue answered on the forge

[Index](../JOURNAL.md) · [Plan](../plan/hv11-issue-answered.md)

## HV11a, HV11b — the forge writes to issues, Hive answers them (2026-11-14, branch `feature/hv11-issue-answered`)

Built in one branch from `main` at `d8193b4`, after the person agreed the details (decisions
1071–1077) on the plan read against that `main`.

**Learned**

- **13 places stop a workspace, each in its own words.** Some notes carry Claude Code's error text
  (`its agent failed twice: <error>`) or a git error. Posting a stop's note would have posted
  them; each `stuck` event now carries a kind, and the issue is told the kind only.
- **The queue's own `Closes #n` races Symbiote's comment.** HV10c puts it in the queue's merge
  commit; pushed to the default branch, the forge can close the issue before the runner's next
  look. Under 1022 as written, "Landed in…" would be skipped as a write to a closed issue: 1073
  lets the landing's comment through.
- **A forge's error said what, not which.** `http.ts` threw the same `SymbioteError` for a 404 on
  a label (make it) and a 403 on a comment (record it): `ForgeError` keeps the status and the
  forge's answer; the messages are unchanged, and IS1's and HV8's tests pass as they were.
- **Ticks are 2 s apart.** "Tried at the next tick" would spend the 3 tries in 6 s of one outage:
  a try waits a minute after the last (1075), the e2e half a second (`SYMBIOTE_HIVE_REQUEST_MS`).
- **The fake forge's bare repository names `master` as its HEAD** while the harness pushes `main`:
  a merge closed nothing until the fake got an explicit default branch.
- **Vitest cuts a long string in its failure message with "…"**: a cleaned question looked cut at
  500 when it was not. The real fault was `~~two~~` taken for a GitLab label reference.

**Verification**

- Forge: 76 tests pass (19 new). CLI: the text 20, the writer 21, the start and the classifier 2
  new; the Hive and issue suites, 21 files and 268 tests, pass with the stop kinds added. Four
  mutations of the writer each failed a test.
- e2e: `issues-answered.spec.ts`, 3 passed (24 s): the queue on GitHub, a merge request on GitLab,
  Settings' rows. Settings' rows looked at in both themes at 1440 × 1000.
- `pnpm check`, `pnpm build`, `pnpm test:e2e`: see the branch's last commit.
- Not verified: a real forge (HV12).
