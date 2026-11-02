# HV8 — Hive lands through a pull or merge request

[Index](../PLAN.md) · [Journal](../journal/hv8-hive-pull-requests.md)

**Status:** planned (2026-11-02), on branch `feature/hive-pull-requests` (the workspace's, a Hive
workspace, from `main` at `0e4e4b2`); Hive OK'd the plan.

**Problem** (the brief: HV4's first "later" item, "pull or merge requests at a workspace's end";
the person's answers of 2026-11-02). Since HV4 a Hive workspace lands in its start branch through
the local merge queue and pushes it: `main` moves with no person reading the change. Some
repositories want the person to read and accept each change on GitHub or GitLab, where their
team, their branch protection and their history of reviews are. Today Hive cannot do that: the
forge package reads a request and posts a review (`symbiote pr`), but cannot open or watch one.

**Goal**: a per-repository setting, **Hive lands by**: the merge queue (HV4, the default,
unchanged) or a pull or merge request. With a request, at `landing` Hive pushes the branch and
opens a pull request (GitHub) or merge request (GitLab) from the workspace's branch into its start
branch, ready (not a draft), its description the brief and what ran, Symbiote's graph review
posted on it. The person reviews and merges it on the forge: the merge is the accept. Hive watches
it: merged, the workspace is landed and the local start branch fast-forwarded; closed, stopped;
cannot merge, the writer merges the start branch in (decision 769). **Unchanged with the default**:
every gate, word and test as on `main`; normal mode untouched.

## The setting (decisions 788, 793)

- `hive.lands` in `symbiote/config.json`: `"queue"` (default) or `"request"`, read at each
  landing from the main checkout, as `merge.push` and `hive.reviewer.*` are. Written by Settings
  with `writeConfig`. It only matters while Hive is on, and Hive mode itself is never committed.
- Settings' Hive page: a **Hive lands by** card, *The merge queue* or *A pull or merge request*, and
  a line saying the forge and project found from `origin`'s URL, and whether a token is found
  (`GITHUB_TOKEN`/`GH_TOKEN`, else `gh auth token`; `GITLAB_TOKEN`). No network call.
- `GET`/`PUT /api/hive/landing`: `{ by, forge?: { kind, project, host }, token, why? }`.
- This deliberately adds one step that waits for the person; it amends 767's and 773's "no step
  waits for the person" for repositories that choose it.

## The forge (`packages/forge`)

- `Forge.openChangeRequest({ head, base, title, body })`: GitHub `POST /pulls` with
  `draft: false`; GitLab `POST /merge_requests` (`source_branch`, `target_branch`, `description`).
- `Forge.findOpenRequest(head, base)`: the open request of the branch, so a restart between the
  open and the record's write never opens a second one (GitHub `GET /pulls?state=open&head=owner:branch&base=`;
  GitLab `GET /merge_requests?state=opened&source_branch=&target_branch=`).
- `Forge.updateDescription(request, body)`: GitHub `PATCH /pulls/n`, GitLab `PUT /merge_requests/iid`.
- `Forge.token: boolean`.
- `ChangeRequest` gains `conflict?: boolean` (GitHub `mergeable === false` with
  `mergeable_state: 'dirty'`; GitLab `has_conflicts` or `detailed_merge_status: 'conflict'`) and
  `mergeCommit?: string`.

## Landing by request (`hive-runner.ts`, decisions 788–792)

At `landing` with `hive.lands: "request"`, in place of the queue:

1. The branch is pushed (if its last push was not of this commit). A refused push stops: a request
   needs the branch on the forge.
2. Hive's approval, `via: 'hive'`, as with the queue (the Git page and the record keep it).
3. The forge of `origin` with a token, else stopped with why (no `origin`, no forge, no token);
   never the queue instead.
4. The open request of the branch into the start branch, else a new one: title the workspace's,
   description the brief and what ran (each check and review by round, Hive's approval:
   "Approved by Hive at …"), ready. Found open: its description updated.
5. Symbiote's graph review of `merge-base(into, tip)..tip`, analyzed by the view server's
   `RunDiff` (a child process): the findings at `warning` and above not posted before, as
   `symbiote pr --post-findings warning` posts them (`planFindings`, `findingsReview`), as a
   **comment** review: GitHub refuses an approval from a request's own author, the token's user.
   A failed post is recorded and stops nothing.
6. No merge-queue entry; the start branch is not pushed.

The record: `request` (forge, number, url, into, state, opened, read, the review posted) and a
landing attempt per wait in `landings` (`entry: '#12'`, outcome `landed | conflict | closed`).

**The watch** (791): each open request is read every 60 s, whatever the step. One read is one call
(`GET` of the request), so 60 calls an hour a request: 1.2 % of GitHub's 5,000 an hour with a
token; ten open requests, 12 %. GitLab.com allows 2,000 a minute. A failed read is recorded and
tried again a minute later.

- **Merged**: the start branch fetched from `origin` and fast-forwarded to it (`--ff-only` where it
  is checked out, as 770); the person's checkout refusing is retried each minute ("waiting for your
  checkout"); diverged: landed anyway, the record says it was not fast-forwarded. A check or review
  still running is stopped (as 717). The step is `landed`: the Done group.
- **Closed without a merge**: stopped, "its pull request #12 was closed without a merge".
- **Cannot merge** (the forge's head is Hive's tip and it says conflict): the start branch fetched
  and fast-forwarded, the conflicting files found locally (`git merge-tree`), `hive.land` to the
  writer (769); the rounds again; the next landing finds the same request, pushes and updates it.
  2 merges of the start branch, the third stops.
- **Approved** on the forge: nothing; the merge is the accept.
- **The person's message to the writer** while it waits: the rounds start again (as at a stop);
  the request stays open and watched.
- **Hive off**: the request stays open on the forge; nothing is read while off. **On again, or a
  new runner**: the record's request read again; merged meanwhile, landed.

## The viewer

- The card: `Waiting for your merge: #12 on GitHub` with the link; done, `Landed in main on GitHub
  · #12`.
- The Review tab: a request part beside the landings: its link, state (open, merged, closed,
  cannot merge), the review posted.
- Settings' Hive page: the setting (above).

## Verification

1. **Forge** (`forges.test.ts`, red first): open (body fields, not a draft), find open, update,
   each state read (open, merged with its commit, closed, conflict, not known yet), the token, for
   GitHub and GitLab.
2. **Runner** (`hive-runner.test.ts`): the real `GitHubForge`/`GitLabForge` against a stateful fake
   forge (`mock-api.ts`) and a bare local `origin`: opened with the right base, head, title and
   body; the graph review posted; merged → landed and the start branch fast-forwarded; closed →
   stopped; cannot merge → `hive.land`, the third stops; no forge, no token → stopped with why; a
   restart resumes the watch and opens no second request; Hive off pauses it. Every HV4 test
   unchanged.
3. **Viewer**: the words unit-tested; e2e for the setting, the card and its link, the Review tab;
   screenshots dark and light.
4. **Never real**: no real pull or merge request opened, commented on or merged.
5. `pnpm check`, `pnpm build`, `pnpm test:e2e`.

**Risks**

| Risk | Mitigation |
|---|---|
| A request published by mistake to the person's private repository | Tests only against the fake forge and a bare local origin; the setting is off by default |
| A request merged with the branch at an older commit than Hive checked | Only the tip Hive approved is pushed before the request opens; new commits go through the rounds first |
| Rate limits | One call a minute a request |
| A stale "cannot merge" right after a push | Acted on only when the forge's head is Hive's tip |

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV8a | The forge | open, find, update, conflict and merge commit, token; tests |
| HV8b | The runner | landing by request, the watch, the stops; tests |
| HV8c | The server and the viewer | `/api/hive/landing`, Settings, the card, the Review tab; e2e |
| HV8d | Docs | configuration.md, README, HV4's later line, the journal, PLAN.md |

**Decisions** (the person's answers, 2026-11-02):

| # | Question | Decision | Why |
|---|---|---|---|
| 788 | How Hive lands | **A per-repository setting, `hive.lands`: `queue` (HV4, the default) or `request`: at `landing` Hive pushes the branch and opens a pull or merge request into the start branch; no queue entry, no push of the start branch. One step waits for the person; amends 767's and 773's "no step waits" for repositories that choose it** | The person's answer 1: they review and accept the change on their forge |
| 789 | What lands it | **The merge on the forge: merged → landed, the start branch fetched and fast-forwarded (770); closed → stopped, with why; cannot merge → `hive.land` (769), 2 merges of the start branch, the third stops; an approval alone does nothing** | The person's answer 2: "the merge is the accept" |
| 790 | The request's text and review | **Opened ready, not a draft; its description the brief and what ran, "Approved by Hive at …"; Symbiote's graph review posted as a comment review, the findings as `--post-findings warning`; the forge's CI not waited on** | The person's answers 3 and 4; GitHub refuses an approval from the request's author |
| 791 | Watching | **Each open request read every 60 s, whatever the step; Hive off pauses the watch and leaves the request open; on again or a new runner resumes it from the record; an open request of the branch is found before one is opened** | 1.2 % of GitHub's 5,000 calls an hour a request; the brief: "the watch must resume" |
| 792 | When it cannot | **No `origin`, no forge, no token, a refused push or a refused open: stopped, with why; never the queue instead** | Stopping beats guessing |
| 793 | Where the setting is | **`hive.lands` in `symbiote/config.json`, set in Settings' Hive page, which says the forge, the project and whether a token is found** | As `merge.push` and `hive.reviewer.*`; the brief: "Settings can say whether a forge and a token are found" |

**Not in HV8 (later)**: waiting on or showing the forge's CI; auto-merge; Hive merging the request
itself; cleaning up a landed workspace; requests from normal mode.
