# Journal: V11 — Checkout from the commits page

[Index](../JOURNAL.md) · [Plan](../plan/v11-checkout.md)

## V11 spike — checking out from the page (2026-10-13, branch `milestone/v11-checkout`)

Measured on a clone of this repository before planning checkout from the commits page (never on
a working tree in use). `git switch` takes 6–54 ms for 104–713 differing files. It carries a
local change to a file the target leaves alone, and refuses one the target would overwrite,
naming the files and changing nothing; it refuses a branch checked out in another worktree;
`git switch <name>` for a remote-only branch creates its tracking branch. Counting local changes
(`git status --porcelain=v2 --untracked-files=no`) takes 3–10 ms on 115–742 files. So the plan
lets git decide what is safe and shows its message, with no forced mode. Found on the way: the
open commits page does not notice a checkout made in a terminal (it showed the old HEAD after
scrolling to the end; its rows were all in one block, so nothing returned 409); a reload did.
The plan lists anew on focus.

## V11 — Checkout from the commits page (2026-10-13, branch `milestone/v11-checkout`)

A row's menu checks out its branches, a remote branch as its tracking branch, a tag or the
commit, after a confirmation; the page lists anew after it, and on focus when HEAD or a branch
moved elsewhere. V11a (a checkbox for the current branch) was dropped: V10a's switch does it.

**Learned**:
- Letting git decide what is safe needs no rules of Symbiote's own beyond operations in progress:
  `git switch` without force carries changes the target leaves alone and refuses the rest,
  naming the files, with HEAD unchanged. The confirmation says that much, and the refusal is
  shown as git wrote it.
- `git switch --create x --track refs/remotes/origin/x` sets up tracking only when `origin` is a
  configured remote whose refspec maps to that ref; the e2e fixture's `origin/topic`, made with
  `update-ref` alone, needed `git remote add`. A real repository whose remote was removed but
  whose remote refs remain gets git's own refusal.
- A post-checkout hook's exit status becomes `git switch`'s, after HEAD moved: checking HEAD
  again tells a refusal from a checkout with a failing hook.
- Listing anew is simplest as a new generation of the page component (a new React key): rows,
  lanes, picks and the cursor start over, and the cursor lands on the new HEAD by V10a's rule.
- A test that conflicts on purpose printed git's stderr into every `pnpm check`; the repository
  helper now keeps stderr in the thrown error.
- The first checkout from the page outside the tests was the user's own, on this repository:
  it moved the working tree to another branch under uncommitted work of the session (two files,
  the same on both branches, moved back with `git stash` and a switch). That is what a checkout
  does, and the confirmation says so; but whoever develops Symbiote with `symbiote view` open on it should
  expect the branch to change under them. Right after, the user found HEAD hard to see: HEAD's
  row, badge, dot and a title chip now show it.

**Verification**: tests first — core (`listRefs`: upstreams with ahead/behind and `gone`, remotes
by remote without `HEAD`, annotated tags peeled; `workingState`: counts, merge, cherry-pick,
bisect; `checkout`: each kind, a change carried, one refused, a branch in another worktree, a
merge in progress, a remote whose local name tracks nothing, unknown names, short SHAs, a name
starting with `-`, a failing hook), server (status, refs, checkout's refusals, one at a time,
other sites), viewer (`checkoutChoices`, `changesNote`, `checkedOut`). E2E (a fresh repository
per test): the menu per row, a branch, a remote branch from the keyboard, a tag, git's refusal,
a terminal checkout on focus. 519 unit tests, 53 e2e. On a clone of this repository: 109–115 ms
from "Check out" to the page drawn again. Not verified: a large working tree, Windows and macOS,
slow hooks.

Merged into main (2026-10-13), with V11a dropped and HEAD's styling added at the user's request.
`main` verified after the merge: 522 unit tests, build, 53 e2e.
