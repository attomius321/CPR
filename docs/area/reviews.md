# Reviews

[Index](../PLAN.md) · [Its decisions](../decisions.md#reviews) · Checked against the code on
2026-11-03

This page says how branch reviews work today. Read it before you change them. The plans listed
in the index under "Reviews" say why each part was built, as it was decided then. If a plan and
this page disagree, trust this page: it was checked against the code. Change this page in the
commit that changes what it says.

## What a branch review is

A *branch review* is a person's review of a branch's own commits, kept on their machine. It
holds the symbols they marked reviewed, their draft comments, and the *verdicts* that end each
round: Approve, Request changes or Comment. An agent reads the last verdict and acts on it when
the person asks. An approval also names the branch to merge into. The person then starts the
merge, and [the merger](merger.md) does it. Reviews of pull requests (`symbiote pr`) are not
branch reviews: their comments go to the forge, GitHub or GitLab.

Terms used below:

- A *workspace* is a branch and a worktree that Symbiote made for one agent's task. Its record
  names the branch it started `from`.
- The *main checkout* is the repository's first worktree. The *cache* is Symbiote's own folder,
  `SYMBIOTE_CACHE_DIR`, else `~/.cache/symbiote` on Linux.
- A *fork point* is the commit where a branch left another one (`git merge-base`).
- A *symbol* is a function, class, method, type or template that the change touched. Marking it
  reviewed records its fingerprint, a hash of its code.

## Where a review is kept

Symbiote writes each review to `symbiote/reviews/<branch>/<reviewer>.json` in the main checkout.
The branch's slashes are folders, and the reviewer is `git config user.email`. Every worktree of
the repository reads the same folder.

- **Out of git**: before the first review, Symbiote writes `symbiote/.gitignore` with `*`,
  `!config.json` and `!merge.md`. After that the file is the project's, and Symbiote leaves it
  alone. The one exception: Symbiote replaces it if it still holds, word for word, the text an
  older Symbiote wrote. To commit reviews, delete the file.
- **In the cache instead**: if `user.email` is not set, or if `symbiote/` holds files of the
  project itself. The tooltip on "Review of <branch>" says why.
- **The fields**: `about` first (what an agent should read), then `base`, `branch`, `drafts`,
  `head`, `marks`, `reviewer`, `summary`, `updated` and `verdicts`. A mark is a symbol's ID with
  its fingerprint, so a symbol that changed since is no longer marked; a file viewed is
  `file:<path>` with its blob (V90).

## Where a review starts

- **A workspace's branch**: at the commit the workspace started from. Once the branch has merged
  its `from` branch in, the start moves to the fork point with `from`, so `from`'s commits do not
  count as the workspace's.
- **A branch picked to review against**: a person can pick another branch in the changes panel's
  **since**. The review then starts at the fork point with that branch, and the workspace's record
  keeps the pick as `against`.
- **Any other branch**: at its fork point with the default branch, computed again each time.
- **The default branch**: only if it has an upstream, from where it was last pushed to its tip.
- **"+n" on a branch's badge** counts the branch's own commits after the review's `head`.
  Symbiote sets `head` to the branch's tip each time it saves the review: a mark, a draft or a
  verdict. Commits the branch took in from its target (the default branch, or the branch it is
  reviewed against) are not counted.

## How a review ends, and what each verdict asks

The person finishes a round in the Review tab, whose sections are **Comments**, **Your review**
and **Merge**. Symbiote appends the verdict to `verdicts`, at the reviewed commit (`head`), with
its comments, and clears the drafts. **Copy for the agent** puts the same verdict on the
clipboard as text. On a workspace's branch, **Send to the agent** puts that text in the
workspace agent's input box instead.

| Verdict | What the agent does when asked |
|---|---|
| Request changes | Fixes each comment in new commits, then says per comment what it changed |
| Comment | Answers each comment; changes code only where a comment asks |
| Approve, with `into` | Nothing: the person merges with **Merge into ▾**, and the merger does the merge |
| Approve, without `into` | Pushes the approved commits if the project's rules say to push. Only a review of the default branch's own unpushed commits has no `into` |

Symbiote pushes nothing on Approve. The `into` an approval names is the branch the review was
made against: the workspace's `against`, else its `from`, else the default branch.

A verdict can carry `via`: `nucleus` or `mcp` when an agent of the person's wrote it on their
Confirm, `hive` when Hive approved a workspace it drives, to land it (HV4, decision 767). Hive's
approval is written in the person's review file, the one the merger reads; its summary says what
was checked and reviewed, and Git's page says **Approved by Hive**.

A comment carries its file, side (`head` or `base`) and line at the reviewed commit, the line's
code, the innermost symbol holding the line, the text and an ID. A comment without a line is
about its whole symbol.

## How agents learn the rules

Symbiote writes `symbiote/AGENTS.md` beside the reviews. It says what each verdict asks, how to
resolve a conflict (on the branch, never on the target), and what an agent must never do, such as
rewrite reviewed commits. Claude Code loads that file by itself when it reads a review there.
Other agents follow `about`, the first key of every review file. A project can replace the text
with its own `reviews` prompt ([configuration](../reference/configuration.md)).

## Conflicts before the merge

While a branch review is open, Symbiote checks in the background whether the branch merges
cleanly into its target, with `git merge-tree`. The check touches no checkout, index or ref. The
Review tab and the workspace's head show the result, and each conflicting file has a button that
opens it in VS Code. The result is not stored.

## The Files page

A review opens on its **Files** page. One card at the left lists every changed file in git's
order, and the review under them: its comments, the summary, the verdict and the merge check. A
file shows git's diff of the whole file, folded to 3 lines of context. **Graph** is one switch away (key
`g`), and `?view=graph` keeps it on reload. On a branch review, every line shown takes a comment.
Under `symbiote pr`, only added and removed lines take one, because forges accept comments only in
their own hunks. A diff over 5 MB is not sent, and a file's diff draws 2,000 rows before **Show
all**.

A file is marked **Viewed** with its button or `v`. The mark is kept in the review's `marks` as
`file:<path>`, valued with the file's blob (`git diff --raw`, its base blob for a deleted file),
so a file changed since shows unviewed again. Marking a symbol keeps the files' marks. A comment
under its line can be written again with **Edit**, and Ctrl+Enter in the summary finishes the
review.

Since V93 a diff of TypeScript, JavaScript or HTML is in colour, the Files page's and a symbol's in
the detail panel (decision 889, replacing 845's "none"): `ui/syntax.ts`, a tokenizer of our own,
line by line with a block comment or a template string carried over; 2,000 rows in 2.8 ms
median. On the Graph page the first layout is fitted whole at most at 1×, and a pick moves the
canvas only when the symbol is out of view, or comes to 1× from the map (886); the detail panel
is 336 px (887) and each use has **Open ↗** (888). A finding's title is its message (890).

## Opening a review

While a review's change is analyzed, its page shows the six steps of the analysis as a timeline
(`DiffProgress.tsx`, V90). Each step's time is what the page saw: it asks every 500 ms, so a step
that started and ended between two asks has no time, and the step before holds it. Beside the
steps, what needs no graph: the change's files, which the server reads from git for the pair
before the graph exists, and for a workspace's branch the agent's newest report, its commits and
its brief. The commits show only when the workspace's changes start at the review's own base. The
Files page opens meanwhile, read only: comments wait for the graph, because a comment names the
symbol holding its line.

## Where things are

| What | Where |
|---|---|
| Where reviews are kept, the review files, finishing a review, the merge check | `packages/cli/src/reviews.ts` |
| Where a review starts | `packages/cli/src/review-base.ts` |
| The text of `AGENTS.md` | the `reviews` prompt, `DEFAULT_PROMPTS.reviews` in the CLI's `prompts.ts` |
| The Review tab | `packages/viewer/src/diff/ReviewTab.tsx` |
| The marks, the drafts and the verdict picked, for both pages | `packages/viewer/src/diff/useReview.ts` |
| The Files page and its diff | `packages/viewer/src/diff/FilesPage.tsx`, `packages/viewer/src/diff/file-diff.ts` |
| Opening a review: the steps, their times, what needs no graph | `packages/viewer/src/diff/DiffProgress.tsx`, `analysis-steps.ts` |
| The files before the graph exists | `pairFiles` in `packages/cli/src/server.ts` |
| Comments and sending a verdict | `packages/viewer/src/diff/comments.ts` (`POST /api/review`) |
| The reviews list | `GET /api/reviews` in `packages/cli/src/server.ts` |

## Decisions in force

The table gives each decision as it holds today. A decision's row in its plan can say otherwise,
when a later decision or a fix changed it.

| # | The rule now | Made in |
|---|---|---|
| 71 | Reviews live in `symbiote/reviews/`, out of git through a `.gitignore` Symbiote writes once (now also un-ignoring `merge.md`) | [V15](../plan/v15-branch-reviews.md), changed by [a fix](../journal/fix-merge-md-shared.md) |
| 72 | A review is keyed by the branch name without its remote; marks are checked by fingerprint | V15 |
| 73 | One file per reviewer, named by `user.email` | V15 |
| 74 | A branch that is not a workspace's starts at its fork point with the default branch | V15; the default branch by 81, a workspace by 471–474 |
| 75 | The cache keeps compare-mode pairs and `symbiote pr` reviews | V15 |
| 76 | A round ends with a verdict at the tip; the drafts are cleared | [V16](../plan/v16-finish-review.md) |
| 77 | The agent reads the last entry of `verdicts`; **Copy for the agent** gives it as text | V16 |
| 78 | A comment carries file, side, line, symbol, code line, text and ID | V16 |
| 79 | A branch badge shows "+n" commits since, else ✓, ✗ or …, as a filled chip in its tone | V16, changed by [a fix](../journal/fix-review-mark-visible.md) |
| 81 | The default branch is reviewable from where it was last pushed, if it has an upstream | V16 |
| 82 | Approve records the approved commit and `into`; Symbiote pushes nothing then | [V17](../plan/v17-approve-means-merge.md); the merge by 142, `into` by 473 |
| 83 | "Since a review" counts only the branch's own commits | V17 |
| 84 | The merge check is `git merge-tree`, in the background, not stored | V17 |
| 85 | `symbiote/AGENTS.md` tells agents what a verdict means; `about` heads every review file | V17 |
| 86 | An agent resolves a conflict on the branch, never on the target, never by rebasing | V17 |
| 87 | Approving the default branch's own review names no `into` | V17 |
| 431–436 | The Files page: the default view, git's whole-file diff, which lines take comments, the symbol a comment names, the limits | [V60](../plan/v60-files-page.md) |
| 471–474 | A workspace's review starts where it started, or at the fork point with a picked branch; an approval merges into that branch | [V65](../plan/v65-review-against.md) |
| 557–560, 568 | The Review tab in three sections; **Merge into** fits the panel; the result of a finished review in a tinted box | [V76](../plan/v76-review-tab-layout.md) |
| 842–844 | The Files page in one card, the review under the files (replaces 435's tabs); a file viewed as a `file:<path>` mark by its blob; comments under their lines with Edit; Ctrl+Enter finishes | [V90](../plan/v90-redesign-reviews.md) |
| 846–847 | Opening a review: the steps as a timeline with their times as the page saw them; the files (served from the pair), a workspace's report, commits and brief at once; the Files page read only meanwhile | [V90](../plan/v90-redesign-reviews.md) |
| 886–890 | A review as proof 03: the first fit whole (≤ 1×), no zoom to a pick but from the map; the detail 336 px; Open ↗ per use; syntax colours from our own tokenizer (supersedes 845); a finding's message as its title | [V93](../plan/v93-redesign-finish.md) |

These no longer hold:

- **435's "tabs Files and Review"**: one card since V90 (842), the review under the files.
- **845's "no syntax colours"**: since V93 (889) our own tokenizer colours TS, JS and HTML.
- **V90's zoom to a picked symbol**: since V93 (886) a pick only brings it into view.
- **80, Approve pushes the reviewed commit**: replaced by 82 a day later. In 4 approvals out of
  4, the agent had already pushed the commit, so the push did nothing.
- **82's "the agent merges the approved commit when asked"**: [the merger](merger.md) merges it
  (142).
- **82's `into`, "the default branch"**: the branch reviewed against (473).

## Traps

- **Claude Code loads a folder's `AGENTS.md` by itself**, git-ignored folders included. A
  `symbiote/CLAUDE.md` would load the rules twice ([V17](../journal/v17-approve-means-merge.md)).
- **A tracked file in `symbiote/` that is not Symbiote's sends the reviews to the cache.** That is
  why `merge.md` is one of Symbiote's files ([the merge.md fix](../journal/fix-merge-md-shared.md)).
- **"Since" must leave out the default branch's commits.** Otherwise merging it in, the usual way
  to resolve a conflict, floods the review (V17).
- **A workspace's start commit alone is the wrong base** once the branch has merged its parent:
  the parent's commits count as the workspace's ([V65](../journal/v65-review-against.md)).
- **The server keeps an opened review by branch.** A new pick must drop it, or a reload keeps the
  old base (V65).
- **jsdiff's counts are not git's.** On one README rewrite they differed by 34 lines each way, so
  the Files page draws git's diff ([V60](../journal/v60-files-page.md)).
- **A select is as wide as its longest option.** **Merge into**'s branch list overflowed the
  panel until the select got `min-width: 0` ([V76](../journal/v76-review-tab-layout.md)).
- **Each page draws its own Review tab.** What the tab keeps is lost on `g`: the verdict was, so
  **Finish review** on the other page sent a comment. The review's state lives in `useReview`
  ([the fix](../journal/fix-hive-turn-end-flaky-tests-verdict.md)).
