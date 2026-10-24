# Journal: V16 — Finish a review: verdict, feedback for the agent, push on approval

[Index](../JOURNAL.md) · [Plan](../plan/v16-finish-review.md)

## V16 spike — how a review ends (2026-10-14, branch `milestone/v16-finish-review`)

Asked after reviewing V15 with the viewer: "how to end review?". The reviewer's state for that
review (`4061f2b..60d94e1`, compare mode, in Symbiote's cache): 86 of the 87 changed symbols marked,
no comments. None were possible: comments, the summary and a verdict exist only under `symbiote pr`,
where the forge receives them, so `symbiote view` hides them, branch reviews included. Feedback to
the agent went through chat instead, without a place: "bad styling on checkout option in
dropdown" took two close-up screenshots to locate. Checked for the plan: the server's address
(`http://127.0.0.1:<port>`) is a secure context in Chromium, so the page may copy to the
clipboard; graph nodes carry line ranges per side, so a comment's line names its symbol. So the
plan gives branch reviews a local review target behind the same `/api/review`: a verdict
recorded at the tip with its comments in the review's JSON (the user preferred JSON to a
Markdown file: one file, structured fields), text only for "Copy for the agent". Asked too:
Approve pushes to the remote, only then, and `symbiote pr` stays as it is. Checked in a temporary
repository with a bare remote: `git push origin <sha>:refs/heads/<branch>` pushes that commit
and no later one, updates `origin/<branch>`, creates a missing branch (then the upstream can be
set), and a push that is not a fast-forward is refused with git's message. So Approve pushes the
reviewed SHA, never the branch name, never forced.

## V16 — Finish a review (2026-10-14, branch `milestone/v16-finish-review`)

A branch review ends with a verdict in the Review tab — Approve, Request changes or Comment —
recorded with its comments in the review's JSON (`verdicts`), where the agent reads them; "Copy
for the agent" puts them on the clipboard as text. Approve pushes the reviewed commit by SHA,
never forced; newer commits stay local. The default branch is reviewable from where it was last
pushed. `symbiote pr` is unchanged.

**Learned**:
- The user preferred JSON to a Markdown feedback file: one file holds the review and its
  outcome, with fields a script can read; the text for a chat is rendered from it.
- `git push <remote> <sha>:refs/heads/<branch>` is the safe push for a review: it sends the
  commit reviewed and no later one, updates the remote-tracking ref, creates a missing branch,
  and git refuses what is not a fast-forward — checked against a bare remote before planning.
- A draft already knows its symbol: sending it is exact, where mapping a line back to a symbol
  on the server would guess at nested ranges.
- `toReview` folds line-less drafts into the summary for a forge; a local verdict keeps them as
  comments, so the agent gets each with its symbol.
- A test that ends right after a verdict races the viewer's save of the cleared drafts with the
  fixture's cleanup (`ENOTEMPTY`): the cleanup retries.
- A screenshot script that pressed `c` before the code loaded lost nothing but added nothing:
  the panel waits for the code to know the line (`symbiote pr`'s rule).

**Verification**: tests first (core, CLI, server, viewer failed before the code). 599 unit
tests, 69 e2e. On a clone of this repository with a local bare `origin`: `v12` reviewed with
three comments, Request changes in 12 ms (three code lines in the verdict), Approve with the push
in 73 ms (`origin` at the reviewed commit, upstream set, `git status` clean). Screenshots light
and dark. No analysis code changed. Not verified: remotes that need credentials, slow
`pre-push` hooks, Windows, macOS, Firefox and Safari.

Merged into main (2026-10-14). `main` verified after the merge: 599 unit tests, build, 69 e2e.
The reviewer approved V16 in Symbiote itself (one comment, on `ReviewProps`); its push was a no-op,
`origin` already at the reviewed commit.
