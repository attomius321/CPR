# Reviews

[Index](../PLAN.md) · [Its decisions](../decisions.md#reviews) · Checked against the code on
2026-11-11

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
  `file:<path>` with its blob (V90). The file keeps the person's own marks only: what they imply
  (a file viewed reviews its symbols, V108) is read, never written.

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
| Approve, with `into` | Nothing: the person merges with **Merge into ▾**, and the merger does the merge. Through Symbiote's MCP, the approval queues the merge in the same Confirm (MC3) |
| Approve, without `into` | Pushes the approved commits if the project's rules say to push. Only a review of the default branch's own unpushed commits has no `into` |

On the page, Approve and **Merge into** are two presses, and neither waits for a Confirm. Through
Symbiote's MCP (MC3, decision 991), `finish_review`'s approve asks once, "Approve fix/a at abc1234
and merge it into main", and its yes takes the same two steps in the same order: the verdict
recorded, then the merge queued (`approveAndQueue`, `packages/cli/src/approve-merge.ts`). With
`merge: false` it records the verdict alone. A queue that refuses after the approval is said, and
the approval stands. `queue_merge` on a branch nobody approved, a workspace's or not, approves its
tip in its one Confirm too (decision 992); that verdict's summary says it was not reviewed in
Symbiote.

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

A review opens on its **Files** page. One card at the left lists every changed file, in order
of risk (V102, below), and the review under them: its comments, the summary, the verdict and the
merge check. A file shows git's diff of the whole file, folded to 3 lines of context. **Graph** is one switch away (key
`g`), and `?view=graph` keeps it on reload. On a branch review, every line shown takes a comment.
Under `symbiote pr`, only added and removed lines take one, because forges accept comments only in
their own hunks. A diff over 5 MB is not sent, and a file's diff draws 2,000 rows before **Show
all**.

A file is marked **Viewed** with its button or `v`. The mark is kept in the review's `marks` as
`file:<path>`, valued with the file's blob (`git diff --raw`, its base blob for a deleted file),
so a file changed since shows unviewed again. A comment under its line can be written again with
**Edit**, and Ctrl+Enter in the summary finishes the review.

Since V108 the two kinds of marks meet (983). A file viewed at the blob it has now reviews its
changed symbols on Graph, and a file whose changed symbols all carry their own current marks reads
viewed on Files. Both are derived when read (`derivedMarks` in `diff/review.ts`), never stored:
`useReview` keeps the person's own marks, saves only those, and gives both pages the derived ones,
so an older review loads as it was and reads with what it implies. A symbol is in its file as
`fileFindings` places a finding (the head's file, the base's for a removed symbol, a renamed
file's old path held under its new one: `fileSymbols`). The blobs come from the server that keeps
the review: `useReview` reads `./api/files` through the read the Files page's list makes, once
per graph (`readChangeFiles`). Without blobs (a graph opened from a file, or before the read
arrives) a file reads viewed through its symbols only. The toggles keep the two meeting: `r` on a
symbol reviewed through its file's mark drops that mark and gives the file's other symbols marks
of their own; `v` on a file viewed through its symbols unmarks them; `R` (Shift+R, 985) marks
every changed symbol of the picked symbol's file in one write, and again unmarks them.

Since V108 both pages show one progress line (984, `ReviewProgress.tsx`): on Graph under the
tabs, on Files above the list. "10 of 18 files viewed · 19 of 19 symbols reviewed", then a bar,
the findings left and **Next**. A finding is left while its symbol is not reviewed (the Findings
tab's listed ones, on changed symbols). The bar counts each item (a symbol, a stylesheet once)
and each file with no symbol once, so it fills only when nothing is left; then the line says
"Done: 18 files viewed, 19 symbols reviewed". Next goes to the next thing left after the current
one, wrapping: the next symbol in the change list's order on Graph, the next file in the order of
risk on Files. On Graph, when only files without symbols are left, "Files g" stands in its place.
Both pages count the whole change (`progressLine`): the Graph list's `--since` filter does not
apply to the line.

Since V93 a diff of TypeScript, JavaScript or HTML is in colour, the Files page's and a symbol's in
the detail panel (decision 889, replacing 845's "none"): `ui/syntax.ts`, a tokenizer of our own,
line by line with a block comment or a template string carried over; 2,000 rows in 2.8 ms
median. On the Graph page the detail panel is 336 px (887) and each use has **Open ↗** (888). A
finding's title is its message (890).

Since V99 a pick lands readable. The reading zoom puts the graph's 12 px names at the person's
body size: 1.25 for 15 px, 1.17 and 1.33 for Settings' Compact and Large (967, `readingZoom` in
`graph/mapzoom.ts`). A pick whose name would be drawn under 11 px comes to it; a readable pick
in view moves nothing, and one out of view is panned to at the person's zoom (966, amending 886;
`pickView`). The first layout is fitted whole once drawn (886), and no fit comes closer than the
reading zoom: the first, Focus, a group's reveal, a file or a frame clicked on the map.

Since V109 the Graph page opens on the riskiest finding (986, amending 886's first fit and 966).
A change with an error or a warning opens on its first error in the Findings tab, else its first
warning: the symbol picked, Focus on (its links and type references, V101), its panel open. The
first time the page shows a graph, nothing picked yet, `useFirstView` sets the pick and Focus
while App renders, so the worker lays out the focused view first. A pick carried from Files
(V104's `g` on a line) is kept instead. The first fit and Focus's fit come to the reading zoom
around the pick when the whole fit would draw its name under 11 px (`unreadablePick` in
`Canvas.tsx`). `F` (Shift+f) goes to the whole change from any pick, fitted as the first layout is
(`framing`), and from the whole change back to the riskiest finding; the choice is kept in the
browser (`first-view` in `stored.ts`), and the page opens on it next time. A change with only
infos, or none, opens as before, and `F` does nothing there.

Since V100 the head counts what the Findings tab lists: a pill per severity, infos as "notes"
(968, amending 839). A pill is a button: on either page it opens the Graph page's Findings tab
and focuses the first finding of its severity. A `signature-changed` info whose change is
compatible, or that leaves no user untouched, is *settled* (`settled` in `graph/flow.ts`). The
tab folds the settled ones into one row per project, below the rest, opened on a click (969,
`foldFindings` in `diff/review.ts`). Neither the head nor the tab's count counts them, and the tab
opens first only when a finding is listed. On the map, a file's name takes the colour of its
worst listed finding, and its box draws its symbols' counts at their cards' top-right corners
(`.map-count`), scaled like the names (970). The box draws them because the map draws a box and
its name above its cards. In a project's frame, the frame draws them instead, above its name
(998, V96, amending 970): the map draws a frame above its files.

Since V102 the list is in order of risk (973, amending 431's first file), and the page opens on
its first file. Files with listed findings come first: the worst severity first, then the most
of each severity in turn. Then other code, then tests (a `.test.` or `.spec.` name, or a file in a
`test/`, `tests/`, `__tests__/` or `e2e/` folder), then every other file. Each group keeps git's
order. A finding counts in its symbol's file (the head's, the base's for a removed symbol), and
a settled change does not count (`fileFindings`, `riskOrder` in `diff/file-order.ts`). The order
comes from `useReviewFiles`, so `j`/`k` and the arrows walk it. Each row counts its listed
findings as a graph card does (974): `.symbol-count`, in the worst severity's colour, after the
comments count. Its tooltip and the row's accessible name give the severities. A workspace's
Changes panel keeps git's order.

Since V105 a stylesheet is one thing to look at and to mark (979–980). A file whose changed
symbols are all stylesheet symbols, two or more (`stylesheetFiles` in `graph/flow.ts`), is one
card on the canvas, `rules:<file>`: its name, its counts by kind of change, its rules' findings.
Its symbols leave the layout and their links become the card's (`foldStylesheets`). A click opens
it as a group opens (`expanded`, `toggleSummary`). A pick inside a closed card rings the card and
leaves it closed; Focus on it opens it. In the change list it is one row: a box marking all its
rules, a caret showing them (with no box of their own). The progress, the Changes tab and `j`/`k`
count it once (`reviewItems` in `diff/review.ts`), `j` landing on its first rule, and marking any
of its rules marks them all (`toggleMark`): the marks stay one per rule, by fingerprint.

Since V103 the detail panel's code wraps at its width (975, keeping 887's 336 px): a wrapped line
goes on under its own code, at its indent (`hangOf`, at most 8 columns), in its row's colour, its
line number beside its first line. Its rules are the panel's own, `.symbol-code`. A changed
signature is one (976): `signatureDiff` strikes the removed words and marks the added ones, and
draws the two whole when more than half differs. Past 400 characters `foldSignature` keeps 60
around each change (an unchanged one its first 300), with **Show the whole signature**. Core cuts
a signature at 2,000 characters (`MAX_DISPLAY`), not 300.

Since V104 `g` follows the pick (977). With a symbol picked, `g` opens its file on Files with
its first changed row centred and boxed: its first added row, else its first removed one, else
its first row. A removed symbol, and one whose old lines are in another listed file (moved),
shows its removed rows in the file it left (`symbolFocus`, `firstChangedRow` in
`diff/file-diff.ts`). A symbol in no listed file leaves Files as it was. On Files, every row
takes a click once the graph is there, and the row clicked is boxed. `g` then picks the
innermost symbol holding that line (`symbolAt`), while its file is shown. The page switch does
what `g` does. The panel's **Show its lines** (978, beside **Open in VS Code**) does it too,
where the file's diff is served. A row asked for past the 2,000 rows drawn draws every row.

## Opening a review

While a review's change is analyzed, its page shows the six steps of the analysis as a timeline
(`DiffProgress.tsx`, V90). Each step's time is what the page saw: it asks every 500 ms, so a step
that started and ended between two asks has no time, and the step before holds it. Beside the
steps, what needs no graph: the change's files, which the server reads from git for the pair
before the graph exists, and for a workspace's branch the agent's newest report, its commits and
its brief. The commits show only when the workspace's changes start at the review's own base. The
Files page opens meanwhile, read only: comments wait for the graph, because a comment names the
symbol holding its line. Its list is in git's order until the graph arrives. Then it takes the
order of risk, and the file open stays open: App holds the first file by path while Files is
shown, and the first graph does not reset it (V104, in place of V102's `useKeptOpen`).

## Where things are

| What | Where |
|---|---|
| Where reviews are kept, the review files, finishing a review, the merge check | `packages/cli/src/reviews.ts` |
| Where a review starts | `packages/cli/src/review-base.ts` |
| The text of `AGENTS.md` | the `reviews` prompt, `DEFAULT_PROMPTS.reviews` in the CLI's `prompt-text.ts` |
| The Review tab | `packages/viewer/src/diff/ReviewTab.tsx` |
| The marks, the drafts and the verdict picked, for both pages | `packages/viewer/src/diff/useReview.ts` |
| The Files page and its diff | `packages/viewer/src/diff/FilesPage.tsx`, `packages/viewer/src/diff/file-diff.ts` |
| The Graph page's first view: the riskiest finding, `F`, the kept choice | `riskiest`, `viewAfterF` in `packages/viewer/src/diff/first-view.ts`; `useFirstView.ts`; `framing` and `unreadablePick` in `Canvas.tsx` |
| Graph and Files following the pick: `g`, the page switch, **Show its lines** | `follow` and `pickedLines` in `packages/viewer/src/diff/App.tsx`; `symbolFocus`, `firstChangedRow`, `anchorKey`, `foldsDrawn` in `diff/file-diff.ts`; the button in `DetailPanel.tsx` |
| The Files page's order and each file's findings | `riskOrder`, `fileFindings`, `fileKind` in `packages/viewer/src/diff/file-order.ts`; applied in `useReviewFiles` (`FilesPage.tsx`) |
| The head's findings pills; the Findings tab's fold | `FindingPills` in `packages/viewer/src/diff/DiffHead.tsx`; `foldFindings`, `findingPills` in `diff/review.ts`; `Sidebar.tsx` |
| Findings on the map: a file name's colour, the counts | `layoutFlow` in `packages/viewer/src/graph/flow.ts` (`FileData.severity`, `counts`), `FileNode.tsx`, `map.css`; in a frame, `mapLabels` in `graph/map-labels.ts` and `ProjectNode.tsx` |
| The marks both pages read (a file viewed and its symbols), `R`, the progress line | `derivedMarks`, `fileSymbols`, `viewedIn`, `toggleMark`, `toggleFileViewed`, `toggleFileSymbols`, `progressLine`, `leftAfter` in `packages/viewer/src/diff/review.ts`; `useReview.ts`; `readChangeFiles` in `diff/change-files.ts`; `ReviewProgress.tsx` (in `Sidebar.tsx` and `FilesPage.tsx`) |
| A stylesheet as one card, one row and one item | `stylesheetFiles`, `foldStylesheets` in `packages/viewer/src/graph/flow.ts`, `StylesheetNode.tsx`; `reviewItems`, `reviewProgress`, `toggleMark` in `diff/review.ts`; `Sidebar.tsx` |
| Opening a review: the steps, their times, what needs no graph | `packages/viewer/src/diff/DiffProgress.tsx`, `analysis-steps.ts` |
| The files before the graph exists | `pairFiles` in `packages/cli/src/server-sites.ts` |
| Comments and sending a verdict | `packages/viewer/src/diff/comments.ts` (`POST /api/review`) |
| The reviews list | `GET /api/reviews` in `packages/cli/src/server-sites.ts`; `branchReviews().list` caches each review's git (V94); pushed to pages as the `reviews` part of `/api/events` (`packages/cli/src/events.ts`) |

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
| 900 | The reviews list keeps what git said of each review under a key of its file's commits, its refs' tips, the tips it is counted against and its verdict's target's tips: git runs only for a review whose key changed | [V94](../plan/v94-push-not-polling.md) |
| 886–890 | A review as proof 03: the first fit whole (≤ 1×), no zoom to a pick but from the map; the detail 336 px; Open ↗ per use; syntax colours from our own tokenizer (supersedes 845); a finding's message as its title | [V93](../plan/v93-redesign-finish.md) |
| 968–970 | The head's pills: each severity the Findings tab lists, infos as notes, a click opening the tab at it (amends 839); settled signature changes folded per project, counted in their fold only; on the map a file's name in its worst listed finding's colour, its box drawing its symbols' counts | [V100](../plan/v100-findings-where-you-look.md) |
| 998 | On the map, a project's frame draws its files' findings counts, above its name (amends 970's "its box draws its symbols' counts") | [V96](../plan/v96-map-labels.md) |
| 979–980 | A stylesheet with two or more changed symbols, all stylesheet symbols, is one card (its counts, its rules' findings, links merged onto it) opened like a group; a pick inside it rings it, Focus opens it. It is one row, one item of the progress, one `j`/`k` stop, and one mark for all its rules | [V105](../plan/v105-stylesheet-cards.md) |
| 966–967 | A pick lands readable: a name under 11 px on screen comes to the reading zoom, a readable pick in view moves nothing (amends 886); the reading zoom is the body size over the graph's 12 px names, and no fit comes closer | [V99](../plan/v99-picks-land-readable.md) |
| 973–974 | The Files page in order of risk: files with listed findings (worst severity, then the most of each), other code, tests, then every other file, git's order inside each and until the graph arrives (amends 431's first file); a file's listed findings counted on its row in the worst severity's colour | [V102](../plan/v102-files-by-risk.md) |
| 975–976 | The panel's code wraps under its own code, at its indent (keeps 887); a changed signature is one, removed words struck and added words marked, folded past 400 characters; core cuts a signature at 2,000 | [V103](../plan/v103-panel-code-whole.md) |
| 983–985 | A file viewed at its current blob reviews its changed symbols, and a file whose changed symbols are all reviewed reads viewed: derived when read, the store keeping the person's own marks (amends 843). One progress line on both pages: files viewed, symbols reviewed, findings left on symbols not reviewed, a bar, Next (amends 840's row). `R` marks every changed symbol of the picked symbol's file | [V108](../plan/v108-one-review-progress.md) |
| 986 | The Graph page's first view: with an error or a warning, the first such finding's symbol, focused, its panel open, readable (the first fit and Focus's come to the reading zoom around the pick when the whole fit would draw it under 11 px); otherwise, or once the person chose it with `F`, the whole change fitted; `F` between the two, kept in the browser (amends 886's first fit and 966) | [V109](../plan/v109-open-on-the-risk.md) |
| 991 | An approval through Symbiote's MCP queues its merge in the same Confirm: the verdict, then the entry, as the page's Approve and **Merge into**; `merge: false`, the verdict alone | [MC3](../plan/mc3-mcp-batch-confirm.md) |
| 992 | `queue_merge` on a branch nobody approved, a workspace's or not, approves its tip in the same Confirm | MC3 |
| 977–978 | `g` follows the pick: from Graph, the symbol's first changed row on Files (its removed rows, in the file it left, for a removed or moved symbol); from Files, the symbol holding the line last clicked or commented, picked; the panel's **Show its lines** does the same | [V104](../plan/v104-graph-files-follow.md) |

These no longer hold:

- **Two progresses**: V90's line counted symbols reviewed on Graph only, and Files counted
  nothing; marks on one page never showed on the other. Since V108 (983–984) one line on both,
  and each kind of mark reads on the other page.

- **431's first file, git's first**: since V102 (973) the page opens on the first file in order
  of risk. On the spike's 30 merges, git's first was never code.
- **839's pills for errors and warnings only**: since V100 (968) a pill per severity the Findings
  tab lists, and the tab counts what it lists, not every finding.

- **435's "tabs Files and Review"**: one card since V90 (842), the review under the files.
- **845's "no syntax colours"**: since V93 (889) our own tokenizer colours TS, JS and HTML.
- **V90's zoom to a picked symbol**: since V93 (886) a pick only brings it into view.
- **886's "no zoom to the symbol" and its 1×**: since V99 (966–967) a pick whose name is under
  11 px comes to the reading zoom (1.25 by default), and the first fit stops there, not at 1×.
- **886's first fit whole, for every change**: since V109 (986) a change with an error or a
  warning opens on that finding, focused. On the spike's 26 merges with code, the whole fit drew
  names under 11 px on 24.
- **966's Focus fitting its neighbourhood whatever the zoom**: since V109 (986) a pick that
  Focus's fit would draw under 11 px comes to the reading zoom, its neighbours around it.
- **80, Approve pushes the reviewed commit**: replaced by 82 a day later. In 4 approvals out of
  4, the agent had already pushed the commit, so the push did nothing.
- **82's "the agent merges the approved commit when asked"**: [the merger](merger.md) merges it
  (142).
- **82's `into`, "the default branch"**: the branch reviewed against (473).

## Traps

- **`reviewStatus` reads derived marks.** Its `reviewed` set holds `file:<path>` for each file
  viewed, because the Graph page's sidebar gets only `reviewed` and `stale` from `App.tsx`. Given
  the stored marks instead, a file viewed at an old blob would count as viewed: pass it what
  `derivedMarks` gives (V108).
- **A button named with "viewed" or "reviewed" is found by older tests.** `files.spec.ts` looks up
  `getByRole('button', { name: 'Viewed' })` without `exact`, which matched a "Next file not
  viewed": the line's buttons are "Next file left" and "Next symbol left" (V108).

- **A new graph reset the Files page's open file to none**, which means the first file. A file
  read while the change was analyzed jumped to the riskiest once the graph reordered the list
  (V102). Since V104 only a graph that replaces another resets it, and App holds the first file
  by path while the change is analyzed.
- **Git pairs lines by text, not by symbol.** A modified symbol's removed lines can sit far from
  its added ones: under 84 added lines, `area`'s old lines were the file's first rows. A
  symbol's row on Files is its first added one, its removed ones only when it has none (V104).
- **A state cleared in an effect can still be read by the next key.** `g` ran before React had
  run the effect that forgot the line clicked when the file changed, and picked a symbol of the
  file left. Check such state where the key reads it, or clear it in the handler (V104's e2e).
- **`?view=files` is not an address.** `diffView` reads only `?view=graph`. While a change is
  analyzed, the Files page is reached by **Read the files** or the Files tab (V102's e2e).
- **`fileOf` in `graph/flow.ts` is a node's signature line, not its file.** A symbol's file is
  `(node.head ?? node.base).file` (V102).
- **A stylesheet card's symbols are not in the layout's `hidden`**, unlike a group's members:
  `App.tsx` opens whatever holds a pick there, and the first `j` into a stylesheet would have put
  its block back for good. `drawnAs` gives the canvas the card to bring into view (V105).
- **On the map, a file's box and its name are drawn above its cards** (z-index 2000, so that a
  click zooms into the file). A card's count shown there was under the name on 26 of 43 at the
  five walked first views, so the box draws the counts (`FileData.counts`, V100). A frame's node
  is drawn above its files' (2001), so in a frame its name hid a count; there the frame draws
  them (`ProjectData.counts`, V96).

- **React Flow's first fit lands after a move made in the first frame.** Its `fitView` prop is
  queued until the nodes are measured, and it read the options it was given at mount: a
  `setCenter` to the risk at 1.25 was undone at once, back to 0.838. A `fitView` call replaces the
  queued options, so a pick's first move is a fit of its node, clamped to the reading zoom (V109).
- **A first view set in an effect is laid out twice.** The worker would lay out the whole change,
  and the canvas fit and draw it, before the focused view. `useFirstView` sets the pick and Focus
  while App renders, once per graph (React's "state from the previous render" pattern) (V109).
- **Esc then `f` pressed before the whole change is laid out fits nothing.** Focus is off and
  nothing is picked when the layout arrives, so no branch of the canvas's effect fits it. A
  person is slower than the worker; `F` fits whatever the timing (V109, as on `main`).

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
- **`.code`, `.row`, `.ln` and `.mark` are four pages' classes**: the detail panel's, the Files
  page's, Git's diff and its blame. A rule for one page goes under its own class (`.symbol-code`,
  `.file-code`, `.git-diff`, `.git-blame`) ([V103](../journal/v103-panel-code-whole.md)).
- **A signature in the graph is cut**, at 2,000 characters since V103 (300 before). At 300,
  Bitwarden's constructor lost the one parameter its change removed, and two versions of a
  changed type cut to the same text drew as unchanged (V103).
- **A button centres its content.** In a row that wraps, a line number that is a button sat in
  the middle of the row; the panel's is a flex box at the top (V103). The Files page's is not.
- **Each page draws its own Review tab.** What the tab keeps is lost on `g`: the verdict was, so
  **Finish review** on the other page sent a comment. The review's state lives in `useReview`
  ([the fix](../journal/fix-hive-turn-end-flaky-tests-verdict.md)).
