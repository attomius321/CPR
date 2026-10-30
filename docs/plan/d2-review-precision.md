# D2 — Findings precision on real pull requests (spike)

[Index](../PLAN.md) · [Journal](../journal/d2-review-precision.md)

**Status:** measured, waiting for the person's blind sample (2026-10-31), on branch
`spike/review-precision`. Plan agreed with the person (projects: the agent's choice; a GitHub token
from the person; the sample as a page and as a file; the bar for a number to sell, below). The 51
runs, the GitHub data and the agent's scores of 97 findings and 119 AI comments are done; the
scores stay out of the branch until the person has scored the sample (`spikes/d2-review-precision/
sample.md`). A spike: the detectors do not change here.

**Question** (asked: "On real merged pull requests of open-source TypeScript projects, how many of
Symbiote's findings would a maintainer call right and worth reading?"). The North Star says
"precise beats complete", but no number shows it on other people's pull requests. Earlier precision
work did not score findings as a maintainer reads them: E1 audited 40 verified symbols (all
mechanical), Phase 1 saw no `removed-still-referenced` or `orphan-added` false positives on 37
commits of ky, zod and vite, D1 judged 5 warnings by hand. Single commits, chosen for analysis
changes, not pull requests.

**Answer wanted**, with numbers: per finding kind and overall, the share right and worth reading,
right but noise, wrong; findings per pull request (mean, most, share with none, how many a reviewer
reads to meet one worth reading); whether a finding pointed at something a later commit had to
fix; an AI reviewer's comments on the same pull requests, scored the same way; what to fix or
silence first; one number to sell with, or "not yet".

## The pull requests

- **Projects**: zod (library, 167 pull requests merged in the window), vite (library, toolchain)
  and Bitwarden clients (Angular app monorepo, 630 merged, 87 by bots; with `--plugin angular`).
  17 each, 51 in all. ky was left out: it merged 4 pull requests in Aug–Sep 2026 and 12 since
  April; most of its work lands as direct commits.
- **Population**: every pull request merged into `main` from 2026-08-01 to 2026-09-30, read from
  git (first-parent subjects `… (#N)` and `Merge pull request #N`), no API. The window ends a month
  before the spike so follow-up fixes had a month to land. Rebase merges carry no number and are
  not seen.
- **Left out before drawing** (counted and reported): automation authors (renovate, dependabot,
  `github-actions`, `bw-ghapp`); pull requests whose diff changes no file Symbiote reads
  (`.ts .tsx .mts .cts .js .jsx .mjs .cjs .css .scss`). Pull requests written by AI agents stay.
- **Draw**: a seeded shuffle per project (seed in the script); the first 17. A pull request that
  fails to analyze is recorded as an error and the next one is taken.
- **Stopping rule, fixed before any run**: if the 51 give fewer than 50 findings, more are drawn
  from the same shuffled lists, in turn per project, until 50 findings or 90 pull requests.

## Analysis

- `symbiote diff <merge>^ <refs/pull/N/head> --json` (Symbiote at `9330f9a`): the merge-base of
  `main` before the merge and the pull request's final head, against that head — the diff GitHub
  showed when it was merged, and what `symbiote pr` analyzes.
- Dependencies installed once per repository with `--ignore-scripts` (no install script from these
  repositories runs), as the guide asks of CI (`docs/guide/review-and-ci.md:278`); Symbiote links
  them into both sides.
- Clones and Symbiote's cache (`SYMBIOTE_CACHE_DIR`) in the job's tmp; nothing in
  `~/.cache/symbiote-regression` or the person's checkout.

## Scoring

The agent scores every finding, with its evidence (the lines at head and base, the users it names,
why it is right or wrong, why it is or isn't worth a reviewer's time):

| Score | Meaning |
|---|---|
| **Wrong** | A claim in the finding is false at head: the symbol, its users, "no references", "may break users". |
| **Right and worth reading** | True, and it names something the diff does not make obvious: a user left behind, new code nothing calls, a public API break with no changelog or major bump. A reviewer would check or ask about it. |
| **Right but noise** | True, but nothing to act on: a new public export flagged unused, every user updated in the same pull request, an API change the title already announces. |

Two views: everything the viewer lists, and what the GitHub Action posts by default (`warning` and
`error`, `action.yml:17`). Shares with 95 % Wilson intervals; a kind with fewer than 10 findings is
given as counts.

**The person's sample**, blind to the agent's scores: about 20 % of the findings drawn at random
within each kind (at least 5 per kind when it has 5), plus about 20 % of the AI reviewers'
comments, 35 items at most (25–35 minutes). Each item: the pull request, the claim, the code, three
choices and a note. As a private page that saves the answers, and as a Markdown file in the branch.
Agreement: exact on the three scores, Cohen's κ, and on wrong against the rest. Where the person
scored, their score is the one counted; the agent's scores on the rest are reported with the
agreement beside them.

**The bar for a number to sell**, agreed before the runs: at least 30 posted findings, at most
10 % wrong, and the person agreeing with the agent on at least 80 % of the sample. Otherwise the
answer is "not yet".

## Would it have caught a real bug

For each pull request, later commits on `main` up to the clone: reverts, commits that mention
`#N`, and fix commits (subject `fix|bug|regress|revert|hotfix`) that change a symbol the pull
request changed — found by running Symbiote on the candidates that touch its files. GitHub's
timeline gives later issues and pull requests that cite it. Each hit read by hand: did a finding,
or the AI reviewer, point at it? Also the other way: of the follow-up fixes found, how many a
finding pointed at. Bitwarden's tickets are in a private Jira: there only what git shows counts.

## AI reviewers

Seen while planning: Bitwarden posts a "Bitwarden Claude Code Review" summary on every pull
request (2 of 2 checked; edited on each push, so only its last version is visible) and
`aikido-pr-checks[bot]` leaves inline comments (1 of 3 checked); zod has
`copilot-pull-request-reviewer[bot]` reviews (1 of 1 checked; zod's own Claude workflow posted
nothing on the 2 checked); vite has no review workflow (checked per pull request). Their findings
(each inline comment, each issue a summary raises) get the same three scores, judged at the commit
they commented on, beside Symbiote's on the same pull requests. GitHub's API: about 220 calls
(reviews, review comments, comments, timeline per pull request), with the person's token.

## Verification

1. **Reproducible**: the scripts in `spikes/d2-review-precision/` rebuild the selection, the runs
   and the tables from the clones; `results.json` keeps every pull request, finding, score and its
   evidence; `results.md` is the readable table.
2. **The scores**: the person's blind sample and the agreement above.
3. **Cost**: setup about 30 minutes (clones, installs), runs about 20 minutes (zod 3–6 s and vite
   5–7 s a commit in Phase 1; Bitwarden 42–46 s), follow-up candidates 30–60 minutes, all in the
   background.

**Risks**

| Risk | Mitigation |
|---|---|
| Merged final heads compile: `removed-still-referenced` seldom fires | Said with the numbers; heads under review are a later spike. |
| Few findings per kind | Stopping rule above; counts, not shares, under 10. |
| The agent scores a tool it builds, and an AI reviewer of its own family | The person's blind sample, AI comments included. |
| A dependency install fails | That repository runs without dependencies, said in the results. |

**Not in D2**: changing a detector (what to change is listed); heads before the last push; recall
beyond the follow-up fixes found.
