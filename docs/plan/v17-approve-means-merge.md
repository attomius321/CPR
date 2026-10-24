# V17 — Approve means "merge it": a verdict for the agent, not a push

[Index](../PLAN.md) · [Journal](../journal/v17-approve-means-merge.md)

**Status:** merged into main (2026-10-14, from branch `milestone/v17-approve-means-merge`). As
built and results: "As built — V17" below.

**Problem** (asked, after approving four branches in Symbiote and asking for each merge in chat: "How
can we automate this…"; then "approve should mean merge into main...and
not automatically"; "This tool should be used on any other project"; "Aprove is just a
metadata...that will tell the agent to merge into whichever is the default branch of that git
repository"). V16's Approve pushes the reviewed commit; what the reviewer wants from it is the
merge, done by the agent when told to act on the review. Measured today on this repository:

| What | Measured |
|---|---|
| Approvals whose push did anything | **0 of 4** (V16, the `symbiote-review` skill, two fixes): the agent had pushed each commit 2–4 minutes before; `origin`'s reflog has one entry per branch, the agent's |
| Approvals followed by the reviewer asking for the merge in chat | **4 of 4** (3 typed "merge into main", 1 answered "Yes"); the merge, its checks and push were then done by the agent |
| A branch approved at its tip, then 5 commits on `main` merged into it (no conflict) | Symbiote shows **"+6"** and the "new since your review" dot on all 5 of `main`'s commits; the branch's own new commits: **1** (the merge) |
| `git merge-tree --write-tree` (no checkout, index or ref touched), 40 recent unmerged branches against the default branch | Bitwarden: 2 conflict, median 3 ms, max 871 ms. Qwik: 19 conflict (old lines such as `v1`, `v3`: 57–59 files), median 599 ms, max 5.2 s. This repository: all 70 branches merged |
| Instructions an agent in another repository gets | **None**: what a verdict means is in this repository's `symbiote-review` skill and README only |

Causes: Approve is wired to a push (decision 80), which an agent that pushes as it goes makes a
no-op, while the step the reviewer wants is not recorded anywhere for the agent. "Since" counts
`rev-list <reviewed>..<tip>`, which includes the default branch's commits once it is merged into
the branch — the usual way to resolve a conflict. Nothing tells the reviewer, before approving,
that the merge will conflict.

**Goal**: Approve is metadata. The verdict records the approved commit and the branch to merge it
into — the repository's default branch, whatever its name — and Symbiote does nothing else: **no push,
no merge**. The agent, when the person asks it to act on the review, merges exactly that commit;
on a conflict it resolves on its own branch and the person reviews that. Symbiote writes the
instructions for agents into `symbiote/` so this works in any repository, not only this one. Request
changes and Comment, the review files' place, `symbiote pr` and compare mode do not change.

## The verdict

- An approve verdict gains `"into": "<default branch>"` (V15's `defaultBranch`: `origin/HEAD`,
  else `main`, else `master`), next to `head`, the approved commit. Symbiote no longer pushes: no
  `push` on new verdicts, no `POST ./api/review/push`, no `push` in `/api/capabilities`. Old
  verdicts' `push` fields are read and ignored.
- Approve's button says "Approve" again; after finishing, the tab says "Approved abc1234: the
  agent merges it into main when you ask it to act on this review", with "Copy for the agent"
  (as for the other verdicts). The text: "Approved the branch agent at abc1234: merge it into
  main." plus where the review is and where the instructions are.
- Titles and notes drop "pushed": "Approved". A branch whose approved tip is already in the
  default branch says so: "Approved · merged into main" (badge title, Review submenu note).
- The default branch's own review (decision 81, its unpushed commits): there is nothing to merge
  into, so its Approve has no `into` and tells the agent those commits may be pushed — the agent
  pushes only if the project does.

## Commits since a review

- "Since" counts only the branch's own commits: `rev-list <reviewed>..<tip> --not <default
  branch, local and remote>`; the dots on the commits page follow. The measured case becomes
  "+1" (the merge commit), and reviewing again shows the branch against today's default branch
  (V15's fork point moves to its tip), with marks kept on everything the resolution left alone.
- The default branch's own review keeps today's count (nothing to exclude).

## Will it merge?

- A branch review checks the merge in the background: `git merge-tree --write-tree --name-only
  --no-messages <default branch> <tip>` (git 2.38+), cached per pair of commits. Exit 0: clean;
  1: the conflicting paths; anything else: "could not check".
- `GET ./api/merge` answers `{ into, clean }`, `{ into, conflicts: [paths] }` or `{ into, error }`;
  the Review tab shows "Merges cleanly into main", "Conflicts with main in 2 files: src/a.ts,
  src/b.ts — the agent merges main into the branch first", or nothing while it runs. Not on the
  commits page (Qwik's slowest check took 5.2 s).
- Not stored in the verdict: the default branch moves; the agent finds out when it merges.

## Instructions for agents, from Symbiote

- When Symbiote creates `symbiote/` (with V15's `.gitignore`) it also writes `symbiote/AGENTS.md`, and
  `symbiote/CLAUDE.md` importing it (`@AGENTS.md`), so Claude Code loads it when it reads anything in
  `symbiote/`. Symbiote rewrites `AGENTS.md` when its text changes (a first line says Symbiote writes it); when
  `symbiote/` holds the project's own files (V15's cache case), nothing is written.
- Each review file gains a first key (keys are sorted), `"about": "A Symbiote review. Agents: read
  symbiote/AGENTS.md before acting on it."`, so any agent that opens a review finds the instructions.
- What `AGENTS.md` says (the `symbiote-review` skill's rules, extended): act on the last verdict when
  the person asks; `request-changes`: fix in new commits; `comment`: answer; **`approve`: merge
  `head` — not the tip, newer commits are not approved — into `into`** (`git merge --no-ff`,
  unless the project merges otherwise), then push only if the project does. **On a conflict**:
  abort, so the default branch is untouched; merge the default branch into the feature branch,
  resolve there, commit; never rebase approved commits; do not merge until approved again. Never
  edit `symbiote/`.
- This repository's `symbiote-review` skill becomes a pointer to `symbiote/AGENTS.md` (one text, Symbiote's);
  its CLAUDE.md says an Approve, when the user asks to act on the review, is the "yes" to merge.

## Verification

1. **Unit** (red first): an approve verdict has `into` and pushes nothing (a bare remote is
   unchanged); the default branch's approve has no `into`; "since" after merging the default
   branch into a reviewed branch is 1, not 6, and only the merge commit gets a dot; the merge
   check on temporary repositories: clean, two conflicting files, git's error; `AGENTS.md` and
   `CLAUDE.md` written with `.gitignore`, rewritten when stale, not written when `symbiote/` is the
   project's; `about` first in the file; the clipboard text.
2. **Server**: `/api/merge` on a branch review; no push endpoint; `symbiote pr`'s review tests
   unchanged.
3. **E2E** (red first), V16's agent fixture: Approve → "Approved …", `origin` unchanged, "Copy
   for the agent"; a conflict made on `main` → the Review tab names the file; the agent merges
   `main` into its branch → "+1"; the approved tip merged into `main` → "merged into main".
4. **Real repositories**: a Qwik branch that conflicts (the Review tab lists its files, the check
   in the background); on a clone of this repository, an approved branch merged by following
   `symbiote/AGENTS.md` step by step.
5. **An agent reads it**: does Claude Code load `symbiote/CLAUDE.md` in a git-ignored folder when it
   reads a review there? Checked once; the `about` key and the copied text carry the pointer
   either way.
6. **Cost**: the merge check never blocks the page; the commits page's `/api/reviews` adds one
   `rev-list` per reviewed ref.

**Risks**

| Risk | Mitigation |
|---|---|
| An agent merges because it noticed an approval, unasked | `AGENTS.md`: act on a verdict when the person asks; an approval is the "yes" to merge only then. |
| The agent merges commits made after the approval | The verdict names `head`; `AGENTS.md` says merge that commit; "+n" shows the rest. |
| Conflicts resolved on the default branch, unreviewed | `AGENTS.md`: abort, resolve on the branch, ask for a review again; the Review tab warns before approving. |
| A slow merge check (5.2 s on Qwik) | In the background, cached per pair; the tab shows nothing until it is done. |
| `merge-tree` writes objects | Only loose objects in `.git/objects` (git's own garbage collection removes them); no ref, index or working-copy change. |
| git older than 2.38 | "Could not check the merge"; everything else works. |
| A person edits `symbiote/AGENTS.md` | Its first line says Symbiote rewrites it; a project's own rules belong in its own CLAUDE.md or AGENTS.md. |
| Reviews written by V16 (with `push`) | Read as before; the field is ignored. |

**Order**: V17a (CLI and core: `into`, no push, "since", the merge check, `AGENTS.md`, `about`),
then V17b (the viewer), then V17c (README, this repository's skill and CLAUDE.md).

## Milestones

| # | Milestone | Output |
|---|---|---|
| V17a ✅ | The verdict as metadata | `into` on approve; push removed (`pushCommit`, `setUpstream`, `listRemotes`, the push endpoint); "since" without the default branch's commits; `GET ./api/merge`; `symbiote/AGENTS.md`, `symbiote/CLAUDE.md`, `about`. |
| V17b ✅ | The viewer | "Approve"; the note and "Copy for the agent" after approving; the merge check in the Review tab; "Approved", "merged into main" in titles and notes. |
| V17c ✅ | Docs | README (what Approve means, for agents); the skill as a pointer; CLAUDE.md's merge rule. |

**Proposed decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 82 | What Approve does (supersedes 80) | **Records the approved commit and `into`, the default branch; Symbiote pushes and merges nothing; the agent merges that commit when asked to act on the review** | Asked ("Aprove is just a metadata...that will tell the agent to merge"; "not automatically"); 0 of 4 approvals' pushes did anything; 4 of 4 were followed by asking for the merge in chat. |
| 83 | Commits since a review | **Only the branch's own: not those reachable from the default branch** | Merging the default branch into a branch showed "+6" for one commit. |
| 84 | Checking the merge | **`git merge-tree` in the background on a branch review, shown in the Review tab, not stored** | Touches no checkout, index or ref; 3 ms median on Bitwarden but up to 5.2 s on Qwik, so never on the commits page or in the way. |
| 85 | Where agents learn what a verdict means | **`symbiote/AGENTS.md`, written by Symbiote beside the reviews; `about` in every review file** (no `symbiote/CLAUDE.md`: Claude Code loads a folder's AGENTS.md itself, checked) | "This tool should be used on any other project": the rules lived in this repository's skill only. |
| 86 | Conflicts | **Resolved on the feature branch (the default branch merged into it), reviewed again; never on the default branch, never by rebasing** | The resolution is code nobody reviewed; rewriting approved commits breaks marks and pushes. |
| 87 | Approve on the default branch's own review | **No `into`: those unpushed commits may be pushed, if the project pushes** | Nothing to merge into; V16 pushed here. |

**Not in V17 (later)**: a signal that wakes the agent when a verdict is recorded (a watcher, or a
command run after each verdict from `symbiote/config.json`); Symbiote merging by itself; conflicts on the
commits page's badges; a verdict on compare-mode pairs.

## As built — V17

- **No `symbiote/CLAUDE.md`.** Checked with Claude Code 2.1.296 in a temporary repository whose `symbiote/`
  is git-ignored: asked to read only a review file there, it answered with a marker word that only
  `symbiote/AGENTS.md` held, one `Read` in its log — with `symbiote/CLAUDE.md` and without it; reading the
  same file from another folder, it had no marker. Claude Code loads a folder's AGENTS.md itself,
  so Symbiote writes that one file (and, in Symbiote's cache, an AGENTS.md beside the cached reviews).
  `symbiote/AGENTS.md` counts as Symbiote's own when a project commits `symbiote/`.
- **One button, "Finish review"**, for every verdict; the line above it says what Approve asks
  ("Approve asks it to merge 561a0b4 into main. Symbiote pushes nothing.").
- **Conflicting files, one per line** (asked: "put each file on it's line..with a icon that
  opens the file in vscode"): a button with V12's open icon, the file's name, its folder dimmed
  and cut short (the full path in the title). On Qwik the two paths as one sentence took six
  lines of the 300 px sidebar. The button opens the file at line 1 in the working copy through
  `POST ./api/open`, which accepts a branch review's conflicting files though they need not be
  part of the change (Qwik's: an `.api.md` file); nothing else outside the change opens.
- **`GitError` keeps git's stdout**: `merge-tree` answers on stdout with exit 1 when it conflicts.
- **The merge check needs the analyzed review** (it is served beside the graph), which the Review
  tab needs anyway.
- The old push endpoint now answers 405, as for any POST the server does not take. Verdicts
  written by V16 keep their `push` field; nothing reads it.
- This repository's `symbiote-review` skill points at `symbiote/AGENTS.md` (the text: `AGENTS` in
  `packages/cli/src/reviews.ts`); CLAUDE.md says an Approve, when the user asks to act on the
  review, is the yes to merge.

**Results (V17)**. Tests first: core 3, CLI 11 and server 2, viewer 2 failed before the code; e2e
3 of 4 review specs failed on the old viewer. Now 602 unit tests and 71 e2e (one new: a branch
that conflicts with `main` — the Review tab names `math.ts`; the agent merges `main` into its
branch: "+1", the dot on its merge commit only; reviewed again: "Merges cleanly into main").

An agent following `symbiote/AGENTS.md`: Claude Code, headless, in two temporary repositories with a
real Symbiote approval and a bare `origin`, told only "Check my Symbiote review of the branch agent and act
on it." Clean: it found `symbiote/`, read `AGENTS.md` and the review, merged exactly the approved
commit into `main` with `--no-ff` (`main`'s parents: the old `main` and `5f3fe66`), left the
commit made after the approval out and said it needs a review, pushed nothing, changed nothing in
`symbiote/`; Symbiote then showed "+1" (that commit) and "merged". Conflict (`main` had added a function
where the agent had): it tried the merge, aborted it (`main` unchanged), merged `main` into
`agent`, resolved, committed, pushed nothing, and asked for another review; Symbiote then showed "+1"
(the merge only) and "Merges cleanly into main" (10 ms).

Qwik, the agent-written branch `origin/claude/http-error` (3 commits, 2 files conflicting with
`main`): the review's graph in 6.7–10.3 s, then the Review tab's conflict line 0.5 s after the tab
opened ("Conflicts with main in loader-handler.unit.ts, qwik-router.runtime.api.md"); no page
errors; nothing written into the clone (the review in Symbiote's cache, without a git user).

Not verified: agents other than Claude Code reading `symbiote/AGENTS.md` (the `about` key and the
copied text name it); git older than 2.38 ("Could not check the merge"); Windows and macOS.
