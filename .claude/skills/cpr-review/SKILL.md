---
name: cpr-review
description: Reads and addresses a CPR branch review — the verdict a person left on your commits in cpr/reviews/<branch>/<reviewer>.json (Request changes, Comment or Approve, with comments on lines). Use before continuing work on a branch someone reviews with CPR, when asked to address, read or check a review or its feedback, or when cpr/reviews/ exists.
---

# Addressing a CPR review

A person reviews your branch in `cpr view` and finishes with a verdict. CPR keeps it in a JSON
file in the working copy and never sends it anywhere: you read it there.

## Where

`cpr/reviews/<branch>/<reviewer email>.json` at the root of the checkout where `cpr view` ran
(the branch's slashes are folders: `cpr/reviews/milestone/v16-x/a@b.com.json`). One file per
reviewer. Working in a worktree of your own: look in the main checkout (`git worktree list`, the
first line). No `cpr/reviews/`: CPR may have kept it in its cache (`~/.cache/cpr/state/*/reviews/`).

## Read only the last verdict

The file holds the reviewer's work too. Act on `verdicts.at(-1)` and nothing else:

- `drafts`, `marks` and `summary` (top level) are a review in progress: not feedback yet.
- No `verdicts`, or an empty list: there is no review to address. Say so.
- `event`: `request-changes` (fix them), `comment` (answer them; change code only where a comment
  asks), `approve` (nothing to do: CPR pushed the commit; `push` says what happened).
- `summary`: the reviewer's overall note. `comments`: one per remark.

Each comment: `body` (what to do), `symbol` (`<path>#<name>`, e.g.
`packages/viewer/src/ReviewTab.tsx#ReviewProps`), and when it is on a line, `path`, `line`, `side`
and `code` (that line's text). Without `line` it is about the whole symbol.

- `side: "head"`: `line` is in the reviewed commit, the verdict's `head` — not your working copy.
  If the branch moved since (`git log <head>..HEAD`), find the place by `code` and `symbol`; the
  number may be off. Commits after `head` may already address a comment: check before redoing it.
- `side: "base"`: a line the branch removed; `code` is that line as it was before, and `line` is
  in the file's top-level `base`, where the review starts (`git show <base>:<path>`). The question
  is usually whether removing it was right.

## Rules

- Fix things in **new commits** on the branch. Do not amend, rebase or squash commits the reviewer
  saw: an approved commit is already on the remote, CPR never force-pushes, and the next Approve's
  push is refused.
- Do not push. Approving pushes the commit the person reviewed.
- Do not edit, move or commit anything in `cpr/`: the file is the reviewer's.
- Reply in the chat, one line per comment: its `path:line` (or symbol), and what you changed (with
  the commit) or why you did not. The reviewer then reviews the branch again in `cpr view`; the
  symbols you did not touch stay marked reviewed.
