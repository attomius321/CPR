# Journal: HV8 — Hive lands through a pull or merge request

[Index](../JOURNAL.md) · [Plan](../plan/hv8-hive-pull-requests.md)

## HV8 plan — a pull or merge request at a workspace's end (2026-11-02, branch `feature/hive-pull-requests`)

Read HV4's plan, journal and the merger's page, the runner's landing (`hive-runner.ts`: `land`,
`follow`, `landingFailed`), the queue's sync of a Hive target (`merges.ts`, `syncTarget`) and the
forge package. The forge reads a request and posts a review, as `symbiote pr` needs; it cannot open,
find or update one, nor say whether it can be merged. The view server already analyzes a pair in a
child process (`RunDiff`), which the graph review can use.

**Learned**:
- **HV5–HV7 are planned rows**, so this takes its own ID, HV8, linked from HV4's "later" line.
- **Decision numbers**: the highest on `main` and every branch was 787 (NU8); HV8 takes 788–793.
- **GitHub computes `mergeable` lazily**: `null` on the first read after a push. A conflict is
  acted on only when the forge says so for Hive's tip.

Not verified: everything; nothing is built.

## HV8 — Hive lands through a pull or merge request, built (2026-11-02, branch `feature/hive-pull-requests`)

With `hive.lands: "request"`, at landing Hive pushes the branch, approves it as its own and opens a
ready pull or merge request into the start branch on `origin`'s forge, with the brief, what ran and
its approval; Symbiote's graph review goes on it as a comment. Hive reads it every 60 s: merged,
the start branch is fetched and fast-forwarded and the workspace is Done; closed, stopped; cannot
merge, `hive.land` to the writer. No forge or no token stops it, with why. Settings' Hive page
sets it and says what `origin` is and whether a token is found. Decisions 788–793.

**Learned**:
- **`git remote get-url` expands `insteadOf`.** The e2e names GitHub as `origin` and has git reach
  a bare folder in its place; `get-url` gave the folder, which is no forge. The raw
  `remote.origin.url` is read when the expanded one is not a forge's.
- **`gh auth token` answers in tests.** `GitHubForge` falls back to `gh`'s token when the
  environment has none, so a "no token" test on this machine would have read the developer's real
  one. The token reader is now a constructor parameter, and the tests pass one that finds none.
- **A closed request trapped the workspace.** Closed stops it, and the person's message started
  the rounds again, but the next landing found the same closed request and stopped again. A
  closed request is dropped when the rounds start again; found by the test of that path.
- **The output of `git` keeps its newline.** A local tip read with `git rev-parse` and passed on
  untrimmed made `merge-base --is-ancestor` fail "Not a valid object name", and the merged
  request was never seen; the runner's warning log said so in the first run.
- **The accent is for what a person acts with** (the tokens' test): the request's link is a
  `.link`, the accent under the pointer, and the waiting badge takes the warning's colour.

**Verification**: forge 38 tests (10 new); `hive-runner.test.ts` 77 (60 HV4 tests unchanged, 17
new, red first: they landed through the queue); `hive-request.test.ts` 3; the viewer's words 4
new. e2e `hive-request.spec.ts` 2 of 2 on a fake GitHub with a real `symbiote view`; with the
Hive, Settings, targets and page-frame specs, 34 of 34. Screenshots dark and light.

Not verified: a real GitHub or GitLab (on purpose: nothing was sent to a forge); GitHub's lazy
`mergeable` on a real request (the fake answers at once); GitLab's draft notes on a merge request
opened seconds before; a self-hosted forge.
