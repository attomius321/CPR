# Chore — The repository's address in the README, the Action and the GitLab template

[Index](../PLAN.md) · [The audit](../journal/chore-improvement-audit.md) (finding R2)

**Status:** resolved by the rename on 2026-11-08, nothing to build: the person chose A and
renamed the GitHub repository to `attomius321/Symbiote`. The `curl` checks answer 200 (below).
Written by the improvement audit (`chore/improvement-audit`) on 2026-11-06 as planned; the
branch `chore/repository-address` was never made. The regression set and the `gh -R` test case
name the new address since [chore/remove-cpr](chore-remove-cpr.md).

**Kind** chore · **Branch** `chore/repository-address` · **Size** S · **Depends on** none (a choice
of the person's first) · **Plan** P02 of 51 (the audit's order)

## The brief

**What to change**: every address a user copies names `attomius321/Symbiote`, which does not exist.
The repository is `attomius321/CPR`, public since at least 2026-11-06. The install command, the
Action's `uses:` and the GitLab `include:` all fail for anyone but the person.

**Open choice (the person's, before the workspace starts)**:
- **A. Rename the GitHub repository** from `CPR` to `Symbiote` (Settings → Rename). GitHub then
  redirects `CPR`'s web, git and raw URLs, and the four places stay as they are. Only `origin` in
  local clones, `scripts/regression/sets.json:16` and the `gh -R attomius321/CPR` test case would
  change, by choice.
- **B. Keep `CPR`** and change the five lines below to name it.

**Where to look**:
- `README.md:44`: `git clone https://github.com/attomius321/Symbiote.git && cd Symbiote && ./install.sh`
- `docs/guide/review-and-ci.md:207` (`uses: attomius321/Symbiote@main`) and `:243` (the
  template's raw URL)
- `ci/gitlab/symbiote.yml:4` (the `include: remote:` example) and `:21` (`git clone … Symbiote.git`)
- `packages/core/schema/graph.schema.json:3`: the `$id`. It is an identifier, not fetched; change it
  only with A or a deliberate schema decision (a `$id` change is part of the graph contract,
  `docs/graph-schema.md`).

**Out of scope**: running the Action and the template in CI (P03); their versions (P43); journals
and plans, which are records of their day.

**Done when**:
- Every address in the README, the guide and the template answers 200
  (`curl -s -o /dev/null -w '%{http_code}'`).
- `git clone` of the README's URL works without credentials.

## Evidence

Reproduced (2026-11-06):

```
curl -sI https://github.com/attomius321/Symbiote                                   → HTTP/2 404
curl … raw.githubusercontent.com/attomius321/Symbiote/main/ci/gitlab/symbiote.yml  → 404
curl … raw.githubusercontent.com/attomius321/CPR/main/ci/gitlab/symbiote.yml       → 200
gh repo view attomius321/CPR --json visibility                                     → {"visibility":"PUBLIC"}
```

`docs/journal/remake-readme.md:111` and `chore-readme-remake.md:116` found the same and left it
for the person.

After the rename (2026-11-08, `curl -s -o /dev/null -w '%{http_code}'`; on branch
`chore/remove-cpr`):

```
https://github.com/attomius321/Symbiote                                             → 200
https://github.com/attomius321/Symbiote.git (README.md:44, ci/gitlab/symbiote.yml:21) → 301 (to the web page; git clones it)
https://raw.githubusercontent.com/attomius321/Symbiote/main/ci/gitlab/symbiote.yml  → 200 (review-and-ci.md:247, symbiote.yml:4)
https://raw.githubusercontent.com/attomius321/CPR/main/ci/gitlab/symbiote.yml       → 200
https://github.com/attomius321/CPR                                                  → 301, location: https://github.com/attomius321/Symbiote
git clone --depth 1 https://github.com/attomius321/Symbiote.git (no credentials)     → cloned, a12c1d9
```

`uses: attomius321/Symbiote@main` (`review-and-ci.md:211`) names the same repository, which now
exists.

## Approach

- **A**: nothing in the repository has to change. Rename on GitHub, then rerun the `curl` checks.
  Update the person's local `origin` (`git remote set-url`) if they want the new name.
- **B**: replace `attomius321/Symbiote` with `attomius321/CPR` in the five lines. Keep the clone
  folder `cd CPR` in line with what `git clone` creates.
- Either way, add a short check, e.g. `scripts/check-links.mjs` or a step in P03's CI job, that
  fetches these URLs. Then a rename cannot break them unseen again. That is optional here.

## Tests first

None in code: this is docs and configuration. The check is the `curl` list above, run before
(404) and after (200).

## Verification

- The `curl` list: every URL answers 200.
- `git clone <README URL> /tmp/x` without credentials succeeds.
- `pnpm check` (Markdown is not formatted; YAML is).
- P03, once built, runs the template's clone line for real.
