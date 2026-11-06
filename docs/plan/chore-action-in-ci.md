# Chore — The Action's script and the GitLab template run in CI

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding R5)

**Status:** planned (2026-11-06), to be built on branch `chore/action-in-ci` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/action-in-ci` · **Size** M · **Depends on** P01 (CI green
first), P02 (the addresses) · **Plan** P03 of 51 (the audit's order)

## The brief

**What to change**: nothing runs the path a user of the Action or the GitLab template takes.
- `.github/workflows/symbiote.yml` runs only on `pull_request`, and this repository opens none: it
  has never run.
- `ci.yml` never calls `action/run.sh`.

So a broken address (R2), a renamed flag or a changed exit code would ship unseen. Add a CI job
that runs `action/install.sh` and `action/run.sh` as the Action and the template do, against a
fake forge, and checks what they write.

**Where to look**:
- `action.yml:46-60` (the composite steps)
- `action/install.sh` (6 lines) and `action/run.sh` (50 lines: the flags it builds, `tee`,
  `PIPESTATUS`, `GITHUB_STEP_SUMMARY`, `GITHUB_OUTPUT`)
- `ci/gitlab/symbiote.yml:11-38` (the clone, `SYMBIOTE_CLI`, `SYMBIOTE_CODEQUALITY`, artifacts)
- `packages/forge/test/mock-api.ts` and `fake-forge.ts` (the fake GitHub and GitLab the e2e's
  `servePullRequest` uses: `packages/viewer/e2e/symbiote.ts:419`)
- `.github/workflows/ci.yml`

**Out of scope**:
- Posting to a real forge.
- The addresses (P02) and versions (P43).
- Making the action faster (install only the CLI): a later chore. Note it in the journal if
  measured.

**Done when**:
- A CI job (ubuntu · node 24) runs a script that, for a fixture pull request on a fake GitHub, runs
  `bash action/run.sh` with `SYMBIOTE_CLI="node packages/cli/dist/bin.js"` and checks:
  - the exit code for `SYMBIOTE_FAIL_ON=error` with and without an error finding;
  - `summary.txt` and `graph.json` written, and `graph=` in `$GITHUB_OUTPUT`;
  - the Markdown in `$GITHUB_STEP_SUMMARY`;
  - the review comments the fake forge received for `SYMBIOTE_POST_FINDINGS=warning`.
- The same script runs the GitLab path, with `CI_MERGE_REQUEST_IID`, `CI_API_V4_URL` and
  `SYMBIOTE_CODEQUALITY`, and checks the Code Quality file.
- It also runs locally: `node scripts/ci/action-check.mjs`.

## Evidence

Reproduced: `gh run list -w "Symbiote review"` returns `[]`. `grep -n run.sh .github/workflows/ci.yml`
finds nothing. The audit's `curl` checks showed the template's clone address answering 404 (R2):
nothing in CI would have said so.

## Approach

- **A script, not a new framework**: `scripts/ci/action-check.mjs`. It builds the fixture
  repository and the bare origin as `servePullRequest` does, starts `mockApi` on a free port, sets
  `GITHUB_API_URL`, `GITHUB_TOKEN`, `GITHUB_EVENT_PATH` (a `pull_request` event JSON) and
  `GITHUB_REPOSITORY`, then runs `action/run.sh`. Reuse the e2e's helpers by importing them; do not
  copy them.
- **One job step** in `ci.yml` after `pnpm run build`, ubuntu · 24 only (as the e2e).
- Keep `symbiote.yml` (it reviews real pull requests when there are some); the new step is what
  proves the path.
- `action/run.sh:114` splits `SYMBIOTE_CLI` on spaces. Run one case with a path holding a space and
  record what happens. If it breaks, it is its own fix: list it, do not fix it here.

## Tests first

The script is the test. Write its first assertion against today's `run.sh` with the error fixture
(`removed-still-referenced`, the `callers` fixture): exit 1 with `SYMBIOTE_FAIL_ON=error`. It should
pass today. Then add the GitLab case, which needs a GitLab fake in `mock-api.ts`, if the fake
covers less than the template uses.

## Verification

- `node scripts/ci/action-check.mjs` locally, then in the branch's CI run (green, with its time).
- `pnpm check`, `pnpm build`.
- Break `run.sh` on purpose (a wrong flag name) and see the job fail; revert.
