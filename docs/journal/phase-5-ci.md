# Journal: Phase 5, CI on both forges (C1–C2)

[Index](../JOURNAL.md) · [Plan](../plan/roadmap.md#phase-5-milestones-ci-both-forges)

## C1 — GitHub Action (2026-10-01)

**What landed**
- `symbiote pr` with no number in CI: GitHub Actions' event file (`pull_request`,
  `pull_request_target`, `issue_comment` on a PR) or GitLab's `CI_MERGE_REQUEST_IID`.
- `action.yml` (composite): inputs `token`, `pull-request`, `post-findings` (default
  `warning`, empty = don't post), `fail-on` (default `error`), `project`, `depth`,
  `working-directory`, `setup-node`; output `graph`. Inputs reach the scripts through `env`,
  never interpolated into shell code.
- `action/install.sh` builds Symbiote from the action's own checkout with pnpm 12 via `npx` (the
  packages are not published): 8 s from a fresh clone here with a warm pnpm store.
- `action/run.sh` is shared with the coming GitLab template: deepens shallow clones (the
  merge-base needs history), builds the arguments, tees the summary, writes the step summary
  and the `graph` output, keeps symbiote's exit status.
- `.github/workflows/symbiote.yml`: this repo reviews its pull requests with `uses: ./`; fork PRs
  (read-only token) are reviewed without posting.

**Testing**: `run.sh` runs against a stub CLI that echoes its arguments (arguments, exit status,
step summary, output); the CI-number detection has unit tests and a `symbiote pr` run with a GitHub
event file. The action itself only runs on a real pull request, and none exist in this repo yet:
the first PR will be its first live run.

## C2 — GitLab CI template (2026-10-01)

**What landed**
- `ci/gitlab/symbiote.yml`: a hidden `.symbiote` job (node:22, `GIT_DEPTH: 0`, clones Symbiote at
  `SYMBIOTE_VERSION`, builds it with `action/install.sh`, runs the shared `action/run.sh`) and a `symbiote`
  job on `merge_request_event`. Code Quality report as an artifact report; `.symbiote/` (graph,
  summary) as a plain artifact.
- GitLab forge in CI: the API URL from `CI_API_V4_URL` when the remote is the job's own instance
  (custom ports and relative URLs); without `GITLAB_TOKEN`, the MR comes from the pipeline's
  `CI_MERGE_REQUEST_*` variables (merged-results pipelines name the source commit, others build
  it); commenting and reading comments say plainly that they need `GITLAB_TOKEN` and that the
  job token cannot comment.
- `--codequality <file>` on `symbiote diff` and `symbiote pr`: findings as Code Climate issues — severity
  error → critical, warning → major, info → info; location: where a removed symbol is still
  used, else the first changed line of the symbol; fingerprint from rule + symbol, so GitLab
  recognises the same issue across pipelines.

**Decision**: 18 (GitLab CI works without a token).

**Testing**: a full `symbiote mr` run in a simulated pipeline — the job token in the remote URL, no
`GITLAB_TOKEN`, an unreachable API — produces the summary and the Code Quality report with no
API request, and `--post-findings` fails with the token message. The template itself needs a
GitLab runner; its YAML is checked and its script is `run.sh`, which has its own tests.

**Phase 5 is done — the roadmap's five phases are complete.** PLAN lists proposed next steps
(P1 one program for both sides, C3 GitHub annotations for fork PRs, D1 detectors from dogfood).
