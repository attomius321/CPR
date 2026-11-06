# Chore — The Action and the GitLab template take Symbiote's pnpm and Node versions, and a pinned ref

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding I2)

**Status:** planned (2026-11-06), to be built on branch `chore/ci-versions` in its own workspace;
written by the improvement audit (`chore/improvement-audit`). Not started.

**Kind** chore · **Branch** `chore/ci-versions` · **Size** S · **Depends on** P02 (the
repository's address) · **Plan** P43 of 51 (the audit's order)

## The brief

**What to change**: three versions are written twice and can drift from the repository's own.
1. `action/install.sh:4` runs `npx --yes pnpm@12.8.1`; `package.json:5` says
   `"packageManager": "pnpm@12.8.1"`. Read the version from `packageManager`.
2. `action.yml:49-52` sets up Node 22 (`actions/setup-node@v5`, `node-version: 22`) and
   `ci/gitlab/symbiote.yml:12` uses `image: node:22`; `.nvmrc` says 24 and `engines` says
   `>=22.12`. Use `node-version-file: .nvmrc` in the Action; Node 24 in the template (or say in a
   comment why 22).
3. `ci/gitlab/symbiote.yml:15` clones `SYMBIOTE_VERSION: main`, a moving branch, on every job.
   Default to a tag once one exists; until then say in the template's head that `main` moves.
   `docs/guide/review-and-ci.md:207` uses `uses: …@main` the same way.

**Where to look**: `action/install.sh`, `action.yml`, `ci/gitlab/symbiote.yml`,
`docs/guide/review-and-ci.md` (the Action and GitLab sections), `package.json`, `.nvmrc`.

**Out of scope**: the repository's address in those files (P02); running the Action in CI (P03);
installing only the CLI's packages in the Action (a speed-up the ops review suggested: a plan of
its own if wanted); pinning `actions/setup-node` by SHA (worth a line in the plan's notes).

**Done when**:
- `action/install.sh` has no pnpm version of its own; a test or a CI step shows it runs the
  `packageManager` version.
- The Action's Node comes from `.nvmrc`; the template's image matches it, or says why not.
- The template and the guide say which ref they run and that `main` moves.

## Evidence

**Code**: the audit read all three files (`action/install.sh:4`, `action.yml:52`,
`ci/gitlab/symbiote.yml:12,15`); the versions match today (pnpm 12.8.1), Node does not (22 vs
24). Neither has ever run in CI (finding R5), so a drift would show only on a user's runner.

## Approach

- `install.sh`: `version=$(node -p "require('./package.json').packageManager")` (it runs in the
  checkout) and `npx --yes "$version"`; fail with a clear message when the field is missing.
- `action.yml`: `node-version-file: ${{ github.action_path }}/.nvmrc`.
- The template: `image: node:24`; a comment line on `SYMBIOTE_VERSION`.
- The guide: the same words.

## Tests first

None that runs today: the Action has no CI job until P03. If P03 has landed, add to its job an
assertion that `pnpm --version` inside `action/install.sh` equals `packageManager`'s; it fails
only if the read is wrong. Otherwise a shell check by hand (below).

## Verification

- `bash -n action/install.sh`; run it in a scratch copy of the repository and check the pnpm it
  printed.
- `pnpm check`.
- After P03: its CI job green with the new versions.
