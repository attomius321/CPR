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
new; `pnpm check` 2,835 tests. e2e `hive-request.spec.ts` 2 of 2 on a fake GitHub with a real `symbiote view`; with the
Hive, Settings, targets and page-frame specs, 34 of 34. Screenshots dark and light.

Not verified: a real GitHub or GitLab (on purpose: nothing was sent to a forge); GitHub's lazy
`mergeable` on a real request (the fake answers at once); GitLab's draft notes on a merge request
opened seconds before; a self-hosted forge.

## HV8 — the running reviewer's round 1: two defects proven (2026-11-02, branch `feature/hive-pull-requests`)

**Learned**:
- **A merge of the person's is theirs, by request too** (717). With Hive off the Review tab says
  "review and land it as any workspace"; the person did, and on again the workspace stayed at
  "Waiting for your merge": the request path read only the forge, never `summary.merged`. Now a
  branch merged outside its request is landed, the attempt says so ("merged into main outside its
  pull request #12, which stays open on GitHub"), and the request is no longer awaited; the same in
  the other steps (`leaveTo`).
- **The off question named the request in place of the step.** The server names an open request
  for every step in flight, and the words then said only that it stays open, not that the writer
  or the check is stopped. Now the step's words come first and the request after them.

**Verification**: the reviewer's two tests, added as they were (`hive-request-runner.test.ts`, for
GitHub and GitLab; `hive-off-request.test.ts`), red before the fix, green after; with the runner's
and the switch's suites, 86 tests.

## HV8 — the running reviewer's round 2: a forge's merge taken for one outside it (2026-11-02, branch `feature/hive-pull-requests`)

**Learned**:
- **The start branch can have the forge's merge before Hive reads the forge.** `summary.merged`
  counts `origin/main` too, so a `git pull` after merging on the forge, or Hive's own fetch for
  another request merged at the same time, made round 1's fix record a forge merge as "merged
  outside its request, which stays open". Now, once the branch is in the start branch, the forge is
  asked first: merged there, the workspace lands by its request (its link and "on GitHub" kept);
  open, it was merged outside it; a failed read says why rather than "stays open".

**Verification**: the reviewer's test added as it was (`hive-request-merged-forge.test.ts`, for
GitHub and GitLab: a pull after the forge's merge, two requests merged together), red before the
fix, green after; with both runner suites, 83 tests.

## HV8 — round 3: one gate to the forge (2026-11-02, branch `feature/hive-pull-requests`)

The running reviewer's round 3 proved that, while the person's checkout refused the fast-forward
after a merge on the forge, every look of the runner (about every 2 s) read the forge and fetched
`origin`: about 1,800 reads an hour a request, not the 60 promised (791). The person asked for one
place, not a fourth patch: each of rounds 1–3 had fixed one path to "is this request merged" and
broken a neighbour.

**Learned**:
- **Each path asked the forge its own way.** The landing step, the watch in other steps, a merge
  found in the start branch (`leaveTo`) and the checkout's retry each read or fetched with their
  own rules, and only one of them looked at the interval. Now `watchRequest` is the one gate: it
  stamps the request's `read` before it acts, and decides merged on the forge, merged outside it,
  closed, cannot merge or still open. The others only call it. Opening or updating a request at a
  landing is the one forge call outside it, once a landing round.
- **A merge seen in the start branch now waits for the gate's turn**, at most a minute, before the
  workspace lands: the forge is what tells a merge there from one outside the request.

**Verification**: the reviewer's test added as it was (`hive-request-checkout.test.ts`, GitHub and
GitLab: no forge read in ten looks within a minute, landed a minute on), red before (12 reads where
2 were due), green after; with rounds 1 and 2's tests and the runner's suites, 88 tests.

## HV8 — the running reviewer's round 1 at 41aff6f: the card while main waits, the warning's space (2026-11-02, branch `feature/hive-pull-requests`)

**Learned**:
- **Hive's own fetch makes the workspace "merged" before it lands.** After a merge on the forge,
  Hive fetches `origin/main`, and `summary.merged` counts it; with the person's checkout refusing
  the fast-forward, the card took its merged branch and showed "Merged" in Done while Hive still
  waited. The card now stays in the Hive group, "Merged on GitHub: main waits for your checkout",
  while the request is merged and its start branch not brought up.
- **JSX drops the space before a line that follows an expression.** The warning's landing sentence
  became an expression, and "agent.Turning Hive off" lost its space: the default's words were no
  longer `main`'s. A `{' '}` puts it back.

**Verification**: the reviewer's two tests added as they were (`hive-request-card.test.ts`, GitHub
and GitLab; `hive-page-words.test.ts`), red before, green after; with the card's, rounds', switch's
and the request runner suites, all pass.

## HV8 — the check's round 2: a merge log e2e failure that is not this branch's (2026-11-02, branch `feature/hive-pull-requests`)

`pnpm test:e2e` at `2c7dedf` failed 1 of 391: `merges.spec.ts:202`, the merge log's steps while
a merge runs (V46a). This branch changes nothing of the merger, its queue, its log or that spec
(`git diff 0e4e4b2..HEAD` of `merges.ts`, `merge-queue.ts`, `merge-log.ts`, `MergeLog.tsx`,
`merges.spec.ts` is empty). Rerun after `pnpm build`: alone 3 of 3 (`--repeat-each=3`), the whole
spec 13 of 13. A timing-sensitive e2e test under the check's load, as AR1 and AR2 measured for this
suite; left as it is, not patched here.
