# D2 — Findings precision on real pull requests (spike)

[Index](../PLAN.md) · [Journal](../journal/d2-review-precision.md)

**Status:** measured (2026-10-31), on branch `spike/review-precision`; the person's blind sample
is in and does not confirm the agent's scores (agreement 20 %). A spike: the detectors do not
change here. Data, scripts and every score: `spikes/d2-review-precision/` (`results.md`).

**Answer: not yet.** On 51 merged pull requests Symbiote made 97 findings (36 warnings, which the
GitHub Action posts). By the agent's scores, 3 of the 36 warnings (8 %) are right and worth reading
and 29 (81 %) are wrong; even read literally, 7 (19 %) say something false. No finding pointed at
any of the 4 later fixes or reverts; the AI reviewers on the same pull requests pointed at 3, and
by the agent's scores 85 of their 119 comments (71 %) are right and worth reading. The person's
blind sample agreed with the agent on 7 of 35 items (κ 0.02) and called all 22 sampled findings
worth reading, so neither set of scores is validated. The agreed bar (≥ 30 posted findings, ≤ 10 %
wrong, ≥ 80 % agreement) is not met. Fix first: `orphan-added` on framework conventions and
`exported-api-changed` on unpublished packages (Results).

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

## As built (D2)

- **Population** (from fresh clones on 2026-10-31): zod 217 merged, 27 changing no file Symbiote
  reads, 190 drawn from (the plan's 167 came from an older clone); vite 197 merged, 24 by
  automation, 51 with no file Symbiote reads, 122 drawn from; Bitwarden 633 merged, 87 by
  automation, 63 with no file Symbiote reads, 483 drawn from. zod's 95 first-parent commits without
  a number are direct pushes. The stopping rule was not needed: 97 findings.
- **Dependencies**: zod declares `packageManager: nub@0.8.3`, which pnpm refuses, and a `workspaces`
  field: installed through a temporary `pnpm-workspace.yaml`, the clone restored after.
- **AI comments scored**: the 119 top-level inline comments. Review summaries were not scored
  (pullfrog's review bodies, Copilot's overviews, of which 4 of 11 say it was "unable to review"
  for quota, Bitwarden's Claude summary comment, edited on each push). The thread (author replies,
  later commits of the pull request) was part of each comment's evidence.
- **"Wrong" as applied**: a finding is wrong when what it tells the reviewer is false, including
  the risk a warning implies ("3 of 4 users not updated" where none needs an update). Read literally
  instead, 9 of the 31 wrong findings stay wrong (Results, sensitivity).
- **Sample**: 35 items (22 findings by kind and severity, 13 AI comments by reviewer), on a scoring
  page and in `sample.md`; the agent's scores stayed out of the branch until it was scored.

## Results

**1. Per kind.** Agent's scores; the second column counts the person's score where they gave one
(the plan's rule: 22 findings, all "worth"). Shares only from 10 items up; 95 % intervals in
`results.md`.

| Kind | Findings (warnings) | Agent: worth / noise / wrong | Person counted: worth / noise / wrong |
|---|---|---|---|
| `removed-still-referenced` | 0 | – | – |
| `orphan-added` | 16 (12) | 1 / 3 / 12 | 6 / 2 / 8 |
| `signature-changed` | 75 (18) | 2 / 59 / 14 | 14 / 52 / 9 |
| `exported-api-changed` | 6 (6) | 0 / 1 / 5 | 5 / 0 / 1 |
| **All findings** | 97 | 3 (3 %) / 63 (65 %) / 31 (32 %) | 25 (26 %) / 54 (56 %) / 18 (19 %) |
| **Warnings** (the Action posts) | 36 | 3 (8 %) / 4 (11 %) / 29 (81 %) | 18 (50 %) / 2 (6 %) / 16 (44 %) |

By project (agent): zod 43 findings, 0 worth reading; vite 2, both noise; Bitwarden 52, 3 worth
reading. The 3: `ImportSourceSelectOrgComponent` added with no route (Bitwarden #23031, wired two
days later by #23198), and the two shared-unlock listeners left ignoring the new lock and unlock
`source` (#22539; the author's stacked #22540 made them read it).

Why the agent scored findings wrong (31) or noise (63):

| Cause | Wrong | Noise |
|---|---|---|
| `signature-changed` info: every user was updated in the pull request | | 24 |
| `signature-changed` info: only parameter names changed (`_json` → `json`) | | 23 |
| `orphan-added`: a Storybook story (named export of `*.stories.ts`) | 6 | |
| `signature-changed`: the users only name the type, not the member that changed | 5 | |
| `exported-api-changed`: `@bitwarden/vault` at version 0.0.0 treated as published | 4 | |
| `orphan-added`: an Angular `effect()` field | 3 | |
| `signature-changed`: a key or enum member added or removed; users name others | 4 | |
| `signature-changed`: a compatible change, or users that need nothing | | 7 |
| `signature-changed`: the same call sites repeated on each override | | 3 |
| `orphan-added`: a member used by its component's inline `template` | 2 | |
| `signature-changed`: void → Promise, the template binding ignores the result | 2 | |
| `signature-changed`: a parameter widened (string → PropertyKey) called breaking | 2 | |
| `exported-api-changed`: a return narrowed to a subtype called breaking | 1 | |
| `signature-changed`: only `export` added | 1 | |
| `orphan-added`: re-exported as `export { default as nn } from` | 1 | |
| other noise (tests only, a default export loaded by convention, an announced API change) | | 6 |

**Sensitivity.** Read literally (a finding is wrong only when its sentence is false), 9 findings
stay wrong, 7 of them warnings (19 %): the 4 `@bitwarden/vault` and the `z.instanceof` "may break
code outside the repo", and the 2 inline-template members "nothing references it". The bar is
≤ 10 %.

**2. Per pull request.** 1.9 findings on average, 22 at most (Bitwarden #22539, moving
`LockService`), none on 32 of 51 (63 %). Warnings: 0.7 on average, 10 at most (#22260), none on 40
of 51 (78 %). A reviewer reads 12 warnings (32 findings) to meet one worth reading by the agent's
scores, 2.0 (3.9) with the person's counted. Analysis: zod 5.9–10.6 s, vite 1.3–5.6 s, Bitwarden
17.7–31.8 s a pull request, no errors.

**3. A real bug.** Of 202 later commits checked (reverts, citations, fix commits touching the
pull request's files), 61 change a pull request's symbols or cite it; read by hand, 4 fix or undo
what a sampled pull request did (`data/q3.json`). No Symbiote finding pointed at any of them:

| Pull request | Later commit | AI reviewer | Symbiote |
|---|---|---|---|
| Bitwarden #22260 | #23227, 3 days later: "uncheck select-all after clearing a capped selection" | claude[bot] described this bug on the final head, unanswered | none of 13 findings |
| zod #6391 | reverted the next day inside #6380 | pullfrog named the design's flaw (a denylist lets any key waive the error) | 12 findings: renames, a compatible member |
| zod #6536 | #6594, 12 days later: "make z.properties() a check again … a trap with transforms" | pullfrog named the trap (output typed from children whose output is discarded) | flagged that `z.properties` changed, not why |
| zod #6092 | #6430: a wrong noun in the new `nn` locale | none | none |

**4. AI reviewers, on the same pull requests** (top-level inline comments; agent's scores):

| Reviewer | Comments | Worth / noise / wrong |
|---|---|---|
| claude[bot] (Bitwarden, 9 pull requests) | 51 | 40 (78 %) / 10 / 1 |
| pullfrog[bot] (zod, 11 pull requests) | 54 | 43 (80 %) / 11 / 0 |
| github-code-quality[bot] (Bitwarden) | 12 | 1 / 11 / 0 |
| Graphite (vite), Copilot (zod) | 1 + 1 | 1 / 1 / 0 |
| **All** | 119 | 85 (71 %) / 33 (28 %) / 1 (1 %) |

Their noise is mostly repeats (15) and comment or style tidying (13); the one wrong comment
suggested a copy change that caused a regression its next comment caught. Authors acted on most:
the commented lines changed before merge for 82 of 119, often with "Confirmed and fixed". Not
like for like: AI comments are made during review on earlier heads; Symbiote ran only on the final
heads, where review fixes have already landed.

**Agreement with the person's blind sample.** 7 of 35 the same (20 %), Cohen's κ 0.02; on the 22
findings 0 of 22, on the 13 AI comments 7 of 13. The person scored 33 "worth", 2 "noise", 0
"wrong"; the page saved the 35 answers within 65 seconds (1.5 s apart), last item first, with no
notes. Where the agent scored a sampled finding wrong (13), the evidence is in `results.md`, for
example a Storybook story reported as unused and `hide(key: string → PropertyKey)` reported as a
breaking change.

**5. What to fix or silence first**, by how many posted warnings each removes in this sample:

1. `orphan-added` (11 of 12 posted warnings wrong): treat named exports of `*.stories.*` as used
   (Storybook's Component Story Format); in the Angular plugin, fields initialized with `effect()`
   and members read by an inline `template:`. These three leave the one warning worth reading.
2. `signature-changed` warnings (13 of 18 wrong): count a user as not updated only when it uses
   the changed part — reads the changed member, uses the return value, names the removed key or
   enum member; widening a parameter type and adding `export` are compatible; report a call site
   once, on the declaration it resolves to.
3. `exported-api-changed` (5 of 6 wrong): a workspace package at version 0.0.0 is not published;
   a return type narrowed to a subtype is compatible.
4. Silence, or fold into one line per pull request, the `info` notes that every user was updated
   (24) and changes of parameter names only (23).

Projection, not measured: with 1–3 the 36 warnings of this sample would be 4 (3 worth reading,
1 noise), or 2 if the stricter user rule also drops the two shared-unlock listeners, which ignore
the new argument — precise, and silent on 48 or more of 51 pull requests.

**One number to sell with: not yet.** By the agent's scores 8 % of posted warnings are worth
reading; read literally, 19 % are still false; and the person's sample did not confirm the agent's
scores. The precise, sellable finding on this data is not Symbiote's yet; the AI reviewers' comments
on the same pull requests were mostly right and acted on.

**Next** (proposed, not started): [D3 — True warnings](d3-true-warnings.md) fixes the causes above
and checks them on D2's 51 pull requests and a fresh, blind holdout;
[D2b — Findings at review time](d2b-review-time-findings.md) runs Symbiote on the 68 heads the AI
reviewers commented on, to decide whether findings help during review at all or should become
evidence for an AI reviewer instead.

**Not verified**

- The agent's scores beyond the sample: the sample neither confirmed nor refuted them (65 seconds
  for 35 items). A re-score of the 22 findings with a note each, or by a maintainer of one of these
  projects, would.
- Three AI comments posted on final heads with no answer were judged by reading, not running
  (Bitwarden #22260 `4007570178`, later confirmed by #23227; #22789 `3894064507`; zod #6411
  `3780549741`).
- Symbiote on the earlier heads the AI reviewers commented on, where `removed-still-referenced`
  could fire; recall beyond the 4 follow-ups; the AI reviewers' summary comments.

