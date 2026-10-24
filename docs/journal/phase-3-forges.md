# Journal: Phase 3, GitHub and GitLab (G1–G3)

[Index](../JOURNAL.md) · [Plan](../plan/roadmap.md#phase-3-milestones-github-and-gitlab)

## Phase 3 kickoff — GitHub **and** GitLab (2026-10-01)

Request: "It should also work with GitLab." Phase 3 now targets both forges through a forge
adapter (PLAN §12, Phase 3 milestones). This session can only reach the GitHub API for
`attomius321/Symbiote` (no PRs there), and no GitLab instance, so both adapters are tested against
local mock servers; `GITHUB_API_URL` / `GITLAB_API_URL` point the CLI at them.

## G1 — `symbiote pr` for GitHub and GitLab (2026-10-01)

**What landed**
- New package `@symbiote/forge` (network code stays out of the engine): `parseRemote` (https, ssh,
  scp-like, credentials in URLs), `detectForge` (host name → `--forge` → `SYMBIOTE_FORGE`),
  `GitHubForge` (incl. Enterprise `https://<host>/api/v3`; token from `GITHUB_TOKEN`,
  `GH_TOKEN`, or `gh auth token`) and `GitLabForge` (nested groups, URL-encoded project path,
  `PRIVATE-TOKEN` or CI `JOB-TOKEN`). Errors say which token to set, or that access is missing.
- Core: `remoteUrl` (reads `remote.<name>.url` from config, before `insteadOf`), `fetchRefs`.
- `symbiote pr <n>` / `symbiote mr !<n>`: API → fetch head + target branch into `refs/symbiote/<forge>/<n>/…`
  → analyze → viewer (or `--summary` / `--json` / `--fail-on`). Graph gains optional
  `changeRequest` (schema + viewer header link).
- `CliContext.env` carries tokens and settings; the worktree cache also resolves from it.

**Decisions**
- Diff base matches what each forge shows: GitHub → merge-base(base, head); GitLab →
  `diff_refs.base_sha` as is (no extra merge-base).
- If the API's commit is no longer fetchable (force-push), fall back to the fetched ref.
- `remote.<name>.url` is read raw so `url.<x>.insteadOf` can redirect fetches (used by the
  tests: a bare repo stands in for github.com / gitlab).

**Testing**: local mock APIs for both forges (headers, mapping, 401/404 messages) and full
`symbiote pr`/`symbiote mr` runs against a bare "forge" repo whose `refs/pull/7/head` and
`refs/merge-requests/7/head` point at the feature branch.

**Open**: self-hosted forges on non-standard ports need `GITHUB_API_URL` / `GITLAB_API_URL`
(the remote's SSH port says nothing about the API's).

## G2 — Review from the viewer (2026-10-01)

**What landed**
- Forge adapters gained `submitReview(request, {event, body, comments[]})`. GitHub: one
  `POST …/reviews` (`commit_id` = the analyzed head, `side` RIGHT/LEFT). GitLab: a draft note
  per comment (text position with base/start/head SHAs and old/new path + line), the summary as
  a draft note, `bulk_publish`, then `approve` (with the head `sha`) or, for request changes, a
  "**Changes requested.**" marker and `unapprove`. If GitLab rejects a draft midway, the drafts
  already created are deleted, so no half review lingers.
- Server: `GET /api/capabilities` (`{sources, review: {forge} | null}`) and `POST /api/review`
  (`symbiote pr` only), with a JSON body limit and validation (event, sides, files of the change,
  positive lines, non-empty bodies). All endpoints now check `Host` (DNS rebinding).
- Viewer: a Comments section in the detail panel (drafts, a box, `Ctrl/⌘+Enter`, `c` to focus),
  clickable +/− lines that move the anchor, a Review tab (drafts, summary, verdict, submit, the
  forge's link or error), 💬 counts in the Changes list. Drafts live in localStorage per
  revision pair, like reviewed marks. Esc in a text field now leaves the field instead of
  closing the panel; checkboxes no longer swallow `j`/`k`.
- E2E: `symbiote pr 7` against a mock GitHub API; two comments (an added line, a removed line), a
  reload, request changes, and the exact review GitHub receives.

**Decisions**: anchors (PLAN decision 13), GitLab request changes (decision 14). Comments go on
the commit that was analyzed, not the PR's newest head, so lines match what the reviewer saw.

**Learned**
- Forges only take inline comments inside diff hunks. The symbol diff comes from jsdiff on the
  symbol's excerpts while forges diff whole files; their changed lines nearly always coincide, and
  when they don't, the forge's 422 is shown instead of losing the review.
- GitHub needs no ordering of comments; GitLab's `bulk_publish` publishes *all* the user's
  pending drafts on the MR — the same as its own "Submit review" button.

**Open**: GitHub rejects approving or requesting changes on one's own PR (the error is shown);
multi-line comments (`start_line`) and suggestions are not offered yet.

## G3 — Findings as comments (2026-10-01)

**What landed**
- `symbiote pr <n> --post-findings <level>` (GitHub and GitLab): reads the existing comments, works
  out which findings at the level are new, posts them as one `comment` review, prints the
  summary, applies `--fail-on`. No viewer, so it is the CI building block for phase 5.
- Core: `listChangedLines` (`git diff -U0 -M`, explicit `a/`/`b/` prefixes so user config
  can't change them, C-quoted path names, `---` content lines after the first hunk are not
  mistaken for headers).
- Forges: `commentBodies` — GitHub inline comments, review summaries and conversation comments;
  GitLab notes; `per_page=100` pages until a short page (50-page cap).
- A finding goes on the first changed line of its symbol (head first, base for removed
  symbols); without one it is listed in the summary. Each carries
  `<!-- symbiote:finding <rule:symbol, URI-encoded, dashes too> -->`.
- If the forge refuses the inline comments, the same findings are posted in the summary, with a
  warning, so a CI job still reports them.

**Decisions**: 15 (what "already posted" means), 16 (where a finding goes).

**Learned**
- The viewer anchors comments on its jsdiff of symbol excerpts; the CLI has no browser and the
  repo at hand, so it asks git — the same diff the forges render. Exact, and no new dependency.
- GitLab's `CI_JOB_TOKEN` can read an MR but not post notes; CI needs `GITLAB_TOKEN`.

**Testing**: planning/anchoring/marker units on the detectors golden graph; full CLI runs
against mock GitHub and GitLab APIs that list back what was posted: posts once, the second run
posts nothing, the GitHub 422 fallback, and `--fail-on` still failing after posting.

**Phase 3 is done.** Next: phase 4 (interdiff, I1–I2), then phase 5 (CI on both forges, C1–C2).
