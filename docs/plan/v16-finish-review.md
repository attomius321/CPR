# V16 — Finish a review: verdict, feedback for the agent, push on approval

[Index](../PLAN.md) · [Journal](../journal/v16-finish-review.md)

**Status:** merged into main (2026-10-14, from branch `milestone/v16-finish-review`). As built
and results: "As built — V16" below.

**Problem** (asked, after reviewing V15 in the viewer: "how to end review?"; then "Yes, plan
it"; then: "Wouldn't it be better to save it as a JSON instead of md? … This would work locally,
comparing local commit made by an agent, with a past commit...after approve, it should be pushed
to the origin, only in this case..we should not touch the symbiote pr feature"). An agent commits
locally; the reviewer reviews those commits in `symbiote view`. Today the review has no end, no way
to tell the agent what to fix, and nothing happens on approval:

- Outside `symbiote pr` the reviewer can only mark symbols. Comments on lines, the summary and a
  verdict (Comment, Approve, Request changes) exist only under `symbiote pr`, where they go to the
  forge (G2); `symbiote view` hides them, branch reviews included. The reviewer's own review of V15
  (`4061f2b..60d94e1`, compare mode): 86 of 87 symbols marked, 0 comments (none possible), and
  no way to say "done" or "fix this".
- Feedback to the agent goes through chat, without a place. In this session "bad styling on
  checkout option in dropdown" took two close-up screenshots to locate (the button 121 of the
  menu's 150 px wide).
- The commits page shows no outcome: V15's "✓" means only that something was marked at the tip.
- Approved work is pushed by hand, and nothing stops pushing more than was reviewed: the agent
  may have committed again since.
- An agent working on the default branch itself cannot be reviewed: V15 offers no review there
  (no fork point), though its unpushed commits are exactly what needs one.

Checked: `git push <remote> <sha>:refs/heads/<branch>` pushes that commit and no later one,
updates `<remote>/<branch>`, and creates the branch when the remote lacks it (then
`--set-upstream-to` works); git refuses a push that is not a fast-forward, with its message (a
temporary repository with a bare remote). The server's address (`http://127.0.0.1:<port>`) is
a secure context in Chromium, so the page may copy to the clipboard. Graph nodes carry line
ranges per side, so a comment's line names its symbol.

**Goal**: On a branch review the reviewer comments on lines, as under `symbiote pr`, and finishes
the review in the Review tab: Approve, Request changes or Comment. The verdict and its comments
are recorded in the review's JSON file (V15's `symbiote/reviews/<branch>/<reviewer>.json`), which the
agent reads; "Copy for the agent" puts them on the clipboard as text. **Approve pushes the
reviewed commit** to the branch on its remote — that commit, not a newer one; Request changes
and Comment never push. The commits page shows the outcome on the branch's badge. The default
branch becomes reviewable: its unpushed commits, from where it was last pushed. Everything stays
local; **`symbiote pr` does not change** (its Review tab still posts to the forge), nor do
compare-mode pairs.

## Comments and the Review tab on a branch review

- A branch review's page names a local review target: `/api/capabilities` answers `review: {
  forge: 'local' }`. The viewer then shows comments in the detail panel (`c`, a line picked) and
  the Review tab, as for `symbiote pr` (`ReviewTab`, `comments.ts`); its button says "Finish review"
  or, with Approve chosen, "Approve and push" (below).
- Drafts and the summary are kept in the review file, as V15 does; I1's rules carry them to a
  new tip (a comment on a symbol that changed becomes outdated and goes into the summary).
- Finishing posts `./api/review` with the drafts as `toReview` makes them (the same request as
  for a forge, checked by `parseReview`). The drafts and summary are then cleared: the verdict
  holds them, and the next round starts empty.

## The verdict, in the review's JSON

- The review file gains `verdicts`, appended on each finish (sorted keys, as the rest of the
  file):

  ```json
  "verdicts": [
    {
      "at": "2026-10-14T10:12:00Z",
      "comments": [
        {
          "body": "Keep `a * a`: it reads better here.",
          "code": "  return a ** 2;",
          "id": "c1",
          "line": 12,
          "path": "src/math.ts",
          "side": "head",
          "symbol": "src/math.ts#square"
        }
      ],
      "event": "request-changes",
      "head": "<the tip reviewed>",
      "summary": "The summary, as written."
    }
  ]
  ```

  `side: "base"` is a removed line, at the review's `base` (its fork point). Comments without a
  line (outdated, or on a symbol with no changed line) have no `line` and `code`. Each carries
  its symbol and code line, so the agent finds the place after it commits again (V12 measured
  1–62 % of added lines moving within a few commits); `id`s let a later step mark comments
  answered.
- JSON, not Markdown: one file holds the review and its outcome (nothing to keep in step),
  fields a script or hook can read without parsing prose, and stable lines for git as the rest
  of the file. Agents read JSON as well as Markdown; for a chat, "Copy for the agent" renders the
  last verdict as text (first line "Address this review of the branch agent:", then the summary
  and each comment with its file:line, symbol and code line).
- `GET /api/reviews` adds the last verdict (event, tip, time, comment count).
- Badge marks replace V15's: "+2" when the branch has commits since the review; else "✓"
  approved at the tip, "✗" changes requested at the tip, "…" marks at the tip and no verdict
  yet. The Review submenu's notes say the same in words ("approved and pushed", "changes
  requested · 2 commits since", "40 reviewed · in progress").
- README: a "For agents" note — read the last entry of `verdicts` in `symbiote/reviews/<your
  branch>/*.json` before continuing.

## Approve pushes the reviewed commit

- On Approve the server runs `git push <remote> <reviewed sha>:refs/heads/<branch>`: the
  branch's upstream (remote and branch name) when it has one, else `origin` and the same name,
  then `git branch --set-upstream-to=<remote>/<branch>`. Never `--force`: a push that is not a
  fast-forward is refused by git, and its message is shown. No remote: the approval is recorded
  and the page says there was nothing to push to.
- Exactly the reviewed commit: commits the agent made after the review stay local, and the page
  says so ("pushed e4f5a6b to origin/agent; 2 newer commits not pushed: not reviewed").
- The button says what will happen before it does: "Approve and push 3 commits to origin/agent"
  (the commits between the remote branch and the reviewed tip). Hooks run as git runs them
  (`pre-push`); prompts are off (`GIT_TERMINAL_PROMPT=0`), so a remote that needs a password
  fails with git's message rather than waiting.
- The verdict records the push: `push: { remote, branch, sha }` or `push: { error }`. A refused
  push leaves the approval standing; the Review tab offers "Push again".
- Request changes and Comment never push.

## The default branch: its unpushed commits

- V15 offered no review of the default branch. Now it is reviewable when it has an upstream:
  from where it was last pushed (`merge-base <tip> <upstream>`, e.g. `origin/main`) to its tip
  — the agent's local commits. Nothing unpushed: "main has no unpushed commits". No upstream:
  not offered, as before.
- Other branches keep V15's start (their fork point): a review covers everything a push sends.

## Server

- Branch review sites get a local `ReviewTarget` (`forge: 'local'`). Its `submit` maps each
  comment to its symbol (the node whose range on that side holds the line), reads the code line
  at that side's commit, appends the verdict to the review file, pushes on Approve, and answers
  `{ verdict, push?, text }` (the text for the clipboard) instead of a forge URL.
- `ReviewTarget.forge` becomes `'github' | 'gitlab' | 'local'`; `symbiote pr`'s targets are untouched.
- Core: `pushCommit(repo, sha, remote, branch)` and the branch's upstream, in `src/git/` (no
  analysis change).

## Verification

1. **Unit** (red first): verdicts appended with comments (head and base sides, a renamed file,
   outdated and unanchored drafts), comment → symbol by range, the clipboard text; on temporary
   repositories with a bare remote: Approve pushes the reviewed commit only (a later commit stays
   local), creates the remote branch and sets the upstream, a diverged remote is refused with
   git's message and nothing changes, no remote; the default branch's start from its upstream,
   and "no unpushed commits".
2. **Server**: `/api/capabilities` on a branch review says `review: { forge: 'local' }`; `POST
   ./api/review` records the verdict, refuses comments outside the change and requests other
   sites could send; compare-mode pairs still have no review target; `symbiote pr`'s review tests
   unchanged.
3. **E2E** (red first), on V15's agent fixture with a bare `origin`: comment on `square`,
   Request changes: the verdict in the JSON, drafts cleared, "✗", the clipboard's text, nothing
   pushed; the agent commits a fix: "+1"; review again, Approve: "✓", `origin/agent` at the
   reviewed commit; an agent commit after that review stays unpushed. The agent on `main`:
   reviewable from `origin/main`, approved and pushed.
4. **Real repository**: on a clone of this repository with a local bare remote: review `v12`,
   comment on three symbols (one on a removed line), Request changes, read the JSON; Approve and
   push.
5. **Cost**: finishing reads one file per comment at its commit; under 100 ms for ten comments
   here. The push is git's.

**Risks**

| Risk | Mitigation |
|---|---|
| Approve pushes more than was reviewed | The reviewed SHA is pushed, never the branch name; newer commits stay local and the page says so. |
| A push is hard to undo | Only on Approve; the button names the remote branch and how many commits; never forced, so a remote that moved refuses. |
| A push needs credentials or a slow hook | Prompts off: git's message shown; "Pushing…" meanwhile; the approval stands, "Push again" retries. |
| Line numbers move once the agent commits again | Each comment carries its symbol and code line; the verdict names the reviewed tip. |
| An agent acts on an older request after an approval | The last verdict is the one to read; it names its tip. |
| Comments on a branch review mistaken for a pull request review | "Finish review" / "Approve and push"; the tab says the feedback stays in the repository. |
| Clipboard refused (permissions, another browser) | The verdict is in the file anyway; the button says the copy failed. |

**Order**: V16a (verdicts in the review file, the local target, push on approval, the default
branch's start; CLI, server and core git helpers), V16b (the viewer: comments and the Review tab
on branch reviews, badges, copy, push results), on one branch.

## Milestones

| # | Milestone | Output |
|---|---|---|
| V16a ✅ | Verdict, push, the default branch | Local review target; `verdicts` with comments in the review JSON; Approve pushes the reviewed commit; the default branch reviewable from its upstream; verdicts in `/api/reviews`. |
| V16b ✅ | Finish from the viewer | Comments and the Review tab on branch reviews ("Finish review", "Approve and push N commits to origin/x"); "✓", "✗", "…", "+n" on badges; "Copy for the agent"; push results and "Push again"; README note for agents. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 76 | How a branch review ends | **A verdict in the Review tab — Approve, Request changes or Comment — recorded at the tip; drafts cleared after** | Asked ("how to end review?"); the same three verdicts as `symbiote pr`, so one flow to learn. |
| 77 | Where the agent finds feedback | **In the review's JSON (`verdicts`, last entry), plus "Copy for the agent" as text** | Asked ("Wouldn't it be better to save it as a JSON"): one file, structured fields, stable for git; text only for a chat. |
| 78 | What a comment carries | **File, side and line at the reviewed tip, the symbol, the code line, the comment, an id** | Lines move when the agent commits again; the symbol and the line's text still find it. |
| 79 | Badge marks | **"+n" commits since; else "✓" approved, "✗" changes requested, "…" in progress** | The badge should say the outcome, not only that something was marked. |
| 80 | What Approve does | **Pushes the reviewed commit (by SHA) to the branch's upstream, else `origin/<branch>` with the upstream set; never forced; nothing on the other verdicts** | Asked ("after approve, it should be pushed to the origin, only in this case"); by SHA so nothing unreviewed goes out. |
| 81 | The default branch (supersedes 74 there) | **Reviewable when it has an upstream: from where it was last pushed to its tip** | Asked: the agent's local commits against a past commit; on the default branch that past commit is the last one pushed. |

**Not in V16 (later)**: comments and verdicts on compare-mode pairs and `symbiote view <base>
<head>` (no branch to push); copying the verdict into the agent's own worktree; an agent marking
comments answered by `id`; posting a branch review to a forge once a pull request exists.

## As built — V16

- **Comments know their symbol from the draft**, not from a line range on the server as
  planned: a draft is written on a symbol, so `toLocalReview` sends its `symbol` and `id`, and
  the server checks the symbol against the graph and the line as for a forge (`parseReview`,
  reused, its errors renamed per comment). Drafts without a line stay structured comments, where
  `toReview` (for a forge) folds them into the summary.
- **Core** (`src/git/branches.ts`): `upstreamOf` (`%(upstream:remotename)` and
  `%(upstream:remoteref)`), `listRemotes`, `pushCommit` (a SHA to `refs/heads/<branch>`, names
  checked, git's refusal as `PushRefused`), `setUpstream`, `mergeBase`; no analysis change.
- **The push target**: the local branch's upstream, else the remote branch reviewed (a review
  of `origin/topic`: already there, so nothing is pushed), else `origin/<branch>`. The count on
  the button ("Approve and push 3 commits") is computed when the review is opened; the push
  itself looks again.
- **"Copy for the agent"** is in the note after finishing only; the plan also put it in the
  review page's header while changes are requested (later: the verdict is in the file).
- **Marks**: V15's "✓" (something marked at the tip) is now "…"; "✓" means approved.
- A comment typed while the symbol's code is still loading is not added on Ctrl+Enter (the text
  stays in the box): `symbiote pr`'s behaviour, unchanged, seen while taking screenshots.
- The e2e agent fixture has a bare `origin` with `main` pushed and tracked; its cleanup retries,
  since the server may still be saving the cleared drafts when the test ends.

**Results (V16)**. Tests first: core 3 of 3, CLI 6 of 6 (5 new and V15's resolve test), server
2, viewer 6 failed before the code. Now 599 unit tests (12 new) and 69 e2e (2 new: a comment on
`square` and Request changes — the verdict in the JSON, drafts cleared, "✗", the clipboard's
text, nothing pushed —, the agent's fix ("+1"), Approve and push (`origin/agent` at the fix,
"✓"); the agent's commit on `main` reviewed from `origin/main` and pushed). `symbiote pr`'s review
tests unchanged.

On a clone of this repository with a local bare `origin` (`main` at `d67a5d6`), through `symbiote
view`'s API: reviewing `v12` (`86dcb60`, 6 commits to push) with three comments, one on the base
side, Request changes took 12 ms and recorded the verdict with its three code lines; Approve took
73 ms with the push: the bare `origin` had `v12` at `86dcb60`, the upstream was set, `git
status` stayed clean, and `/api/reviews` reported the approval as pushed. Screenshots light and
dark: the Review tab with a comment and Request changes chosen, the note after finishing, the
commits page with "✓" on `v12` and `origin/v12` and "✗" on branches with changes requested; no
page errors.

Not verified: remotes that need credentials (prompts are off, so git's message is shown) and
slow `pre-push` hooks; Windows and macOS; the clipboard in Firefox and Safari.
