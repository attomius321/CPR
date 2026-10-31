# HV3 — Hive's running reviewer

[Index](../PLAN.md) · [Journal](../journal/hv3-running-reviewer.md)

**Status:** built, real runs waiting for the person (2026-10-31), on branch
`feature/hv3-running-reviewer` (the workspace's, from `main` at `c84fa98`). The person's answers to
the plan's five questions: 1–4 as recommended; 5, a Review tab of the workspace's own, "In hive
mode, there will be no more human review process". Not yet run: the real reviewer and the real
Hive run, which need `socat` (Claude Code's sandbox) and the scratch repository trusted in Claude
Code (see Results).

**Problem** (the brief: "Build HV3, the next Hive milestone … the running reviewer (decisions 648,
650)"). HV2's loop asks the person to land a workspace once the project's check passes. Nothing
shows that the change does what its brief asks beyond the project's own tests, and the person still
reviews every branch by hand. HV1 measured the verifier HV3 builds:

| Fact | Measured |
|---|---|
| A read-only reviewer (HV1) | 0 of 4 real defects, 12 approvals of 12 |
| A reviewer that runs code and proves each defect with a failing test (HV1) | 4 of 4 defects; none of its 9 failing tests wrong; fixed in one round |
| A running review's cost and time (HV1, Opus, small goals) | $0.44–1.37, 1.5–6 min |
| Decisions in use (`main`, every branch, every worktree) | up to 673; HV3 unused |
| Claude Code 2.1.316 | has `-p`, `--json-schema`, `--max-budget-usd`, `--no-session-persistence`, `--setting-sources`, `--strict-mcp-config` |
| Claude Code's sandbox here (Linux: bubblewrap and socat) | `bwrap` installed, **`socat` missing** |
| The person's user settings (`~/.claude/settings.json`) | an MCP server (Kubernetes, apply and delete allowed), hooks, plugins: none may reach the reviewer |
| `reply`'s longest message | 20,000 characters |
| A `--bg` session in a new folder | "Workspace not trusted" (seen twice); `-p` runs without the prompt |

**Goal**: for a workspace Hive drives, a passing check is followed by a running review of the same
commit. Defects it proves go back to the writer as failing tests; landing is asked only when the
check passed and the review approved, on one commit. In Hive mode the person no longer reviews a
Hive workspace's branch: its own **Review tab** shows Hive's checks, the reviewer's rounds, their
findings and tests, and holds **Land**. Landing, pushing and deleting work stay the person's
(decision 651).
**Unchanged with Hive off**: no reviewer, no copy, no new file; a workspace started while Hive was
off is never reviewed; its page and its review are as on `main`.

## The loop (decision 674)

`writing` → `checking` → **`reviewing`** → `landing`.

| Step | What Hive does |
|---|---|
| `checking` fails | As in HV2: its failures to the writer. No review: the writer changes the code anyway |
| `checking` passes, or no check is found | → `reviewing` on the same commit (HV2: → `landing`) |
| `reviewing`, a defect proven | `hive.review` with the failing tests to the writer, round + 1, `writing`; after round 3 → `stuck` |
| `reviewing`, nothing proven | → `landing` (approved, or every test it reported passed on Symbiote's rerun) |
| `reviewing`, the reviewer failed (crash, limit, no answer) | Run once more; a second failure → `landing` with a note, as HV2's "no check found" |
| The person's message reaches the writer during a review | The review stopped, its copy deleted, the rounds counted again (as for a check) |

One counter for check failures and proven defects, 3 rounds (HV2). New commits after landing is
asked: the check, then the review, again. A record already at `landing` gets no review.

## The throwaway copy (decision 675)

- **A clone, not a `git worktree`**: `git clone --shared` at the branch's tip, detached, its remote
  removed, in Symbiote's cache (`<cache>/hive-reviews/…`). A worktree shares the repository's
  branches and config: `git branch -f main` or `git push` from it would reach the real repository.
  `--shared` copies no object.
- **Dependencies**: Symbiote runs the check's install command (a package manager's `install` or
  `ci`: `pnpm install --frozen-lockfile` here) in the copy before the reviewer starts; the install
  needs the package store, outside the copy.
- **Deleted** after every outcome, on Hive off, and swept when a runner starts.

## The reviewer's session (decision 676)

- **`claude -p`**, as the merger (V26c) and HV1's prototype, in a process group of its own: Hive
  off kills it whole; a killed `symbiote view` leaves an orphan the next runner kills by its pid,
  as HV2's check.
- **Flags**: `--output-format stream-json --verbose`, `--json-schema` (Symbiote's answer),
  `--model`/`--effort` from Settings, `--no-session-persistence`, `--strict-mcp-config`,
  `--setting-sources project,local` (none of the person's user settings), `--append-system-prompt`
  (`hive.reviewer`); the prompt on stdin.
- **Its prompt**: the brief; the branch's change as its review shows it (cut at 80,000 characters,
  with a note); the check's result; from round 2, the last round's proven findings and the writer's
  report of its turn, as claims to check: a test the writer rejected comes back only with an answer
  to its reason.
- **Limits**: 30 minutes; `--max-budget-usd 5` (HV1's costliest: $1.37).
- **Kept**: its stream in the cache, for the journal's numbers; its time, cost and summary in the
  record.
- **Why not `--bg`**: a fresh folder hits the trust prompt, and the answer would be read from its
  transcript.
- **Claude Code only** (decision 658; the person's answer to question 2). Codex's built-in write
  sandbox makes it a small step later.

## Access only inside the copy (decision 677)

- The reviewer's commands run in **Claude Code's sandbox**: writes only in the copy and the temp
  folder, no network but localhost, unsandboxed commands off.
- Its file tools: `dontAsk`, with allow rules for the copy only.
- No sandbox (here: `socat` missing; Windows): no reviewer is started; landing is asked with "not
  reviewed: Claude Code's sandbox is not available".

## Symbiote's rerun (decision 678)

Each finding gives its defect, its test files, a command that runs the test from the copy's root,
and the failing test's name. Symbiote reads those files, deletes the reviewer's copy, makes a fresh
copy at the tip with the install and only the findings' files added, and runs each command in the
same confinement, 10 minutes each. A finding is **kept** only when its command exits non-zero (not
126 or 127, not timed out) **and** its output names its test; any other is dropped, with why
("passed on Symbiote's rerun"). The name guards against a broken test file (vitest's "No test files
found") read as a defect.

## What reaches the writer (decision 679)

`hive.review`: each kept finding's defect, the test's name and command, its files' text, and the
last lines of Symbiote's rerun; add each test and make it pass, or say in one line why a test is
wrong; then run the check, commit, end the turn. The tests are kept beside the record
(`symbiote/hive/<branch>/r<round>/`), which the writer can read; past 20,000 characters the files'
text is cut and the message names that folder.

## Settings and prompts (decision 680)

- A **Reviewer** entry in Settings, listed only in Hive mode, as the Merger's: model (default
  Opus), effort (default high), prompt. Kept as `hive.reviewer.model` and `hive.reviewer.effort` in
  `symbiote/config.json`.
- New keys in the Prompts' Hive group: `hive.reviewer` (its instructions) and `hive.review` (the
  message with the proven tests). The answer's format is Symbiote's, which a project cannot change
  (decision 169's rule for the merger).
- `hive.start` and the Hive mode page say what the reviewer does (Hive workspaces only).

## The workspace's Review tab and landing (decision 681)

- **A Review tab** on a Hive workspace's page, beside Terminal, Thread, Activity and Brief: each
  round's check (commit, passed or failed, its time, the command that failed and its last lines)
  and review (commit, verdict, time, cost, the reviewer's summary); each finding's defect, test,
  command, files (opened on demand), Symbiote's rerun output, kept or dropped and why. Read from a
  new endpoint; the card's summary stays small.
- **Land**, in that tab while Hive is on and the step is `landing`: the person's press records an
  approval of the checked and reviewed commit (theirs, by way of Hive) and queues it into the
  default branch through the merge queue, as Merge into does (V26). No message reaches the writer.
  Merged → `landed`.
- **No human review in Hive mode**: a Hive workspace's head offers its Review tab in place of the
  branch review's Review button; the card says "Reviewed: land it". With Hive off, a Hive
  workspace's head and review are as on `main`.

## Hive off, Hive on, a restart

As decision 655. Off: the reviewer or the rerun killed, the copies deleted, `reviewing` kept and
marked `interrupted`. On, or a new runner: an orphan killed by its pid, its copy removed, a fresh
review. A review is not resumed mid-session: its context is clean either way, and a copy kept
while Hive stays off would linger.

## Verification

0. **Measured first**: a `--shared` clone plus an offline `pnpm install` here; Claude Code's
   sandbox with and without `socat` (refused, or run unsandboxed?), a Haiku `-p` run writing
   outside its folder; vitest, `pnpm build` and Chromium inside it; `--json-schema`'s answer in
   stream-json; `--max-budget-usd` on the subscription.
1. **Unit tests, red first** (a fake `claude` script as the reviewer, a real child; real temp
   repositories and rerun commands): a proven defect reaches the writer with its test, the fix,
   the next review approves → landing; a test passing on the rerun dropped, one exiting 127 or
   not naming its test dropped; approval plus a passing check → landing; a failing check → no
   review; the cap → stuck; Hive off mid-review (group killed, copies gone, step kept), on → a new
   review; a killed runner's orphaned reviewer; the person's message mid-review; two failures →
   landing with a note; no sandbox → no reviewer; the copy deleted after every outcome; the
   reviewer's arguments (Opus, high by default); Land; **Hive off = `main`** (no reviewer, no
   copy, records and start prompts byte for byte).
2. **Prompts**: the two keys and their placeholders; Settings' list in Hive mode only.
3. **Viewer**: the card's words (unit); `hive-review.spec.ts` with a fake writer and reviewer: a
   defect, the fix, approval, the Review tab, Land, Settings' Reviewer.
4. `pnpm check`, `pnpm build`, `pnpm test:e2e`; the `viewer-check` skill on the card, the
   workspace's head and Review tab, Settings (Reviewer, the Prompts' Hive group, Hive mode), both
   themes, Hive on and off.
5. **A real reviewer** (a script, not in `pnpm check`), Opus at high, on a clone of this
   repository: a branch with a planted defect caught with a test the rerun keeps; a correct branch
   approved. About $2–4.
6. **The real Hive run** (the person's answer to question 4): a scratch repository from HV1's
   `loc` seed with its own `symbiote/` and a check of about 1 s, this branch's view with its own
   cache, a Sonnet writer at low effort on HV1's G3 goal (2 of 3 Sonnet runs left a defect), the
   reviewer on Opus at high. The person trusts the folder in Claude Code once (`claude` there,
   accept); `~/.claude.json` checked at once. Fallback: this repository with the person's view
   closed.

**Risks**

| Risk | Mitigation |
|---|---|
| The sandbox does not work under WSL (no `socat`; Chromium inside bubblewrap) | Measured first (step 0); without e2e in it, the reviewer proves defects with unit tests |
| A test that fails for another reason | The name guard; the writer's one-line rejection; dropped findings shown |
| Cost: an Opus review per passing round, up to 3 a workspace | The model in Settings; HV5 paces usage; the real run measures it |
| The writer and the reviewer go round on a rejected test | The next review gets the writer's reason; the cap |
| A second `symbiote view` on `main`'s build reads a record at `reviewing` | Its parser skips it: the workspace waits |

## Milestones

| # | Milestone | Output |
|---|---|---|
| HV3a | The review step | the copy, the reviewer's run, the rerun, the record, `reviewing` in the loop; unit tests |
| HV3b | Prompts and settings | `hive.reviewer`, `hive.review`, the config keys, Settings' Reviewer |
| HV3c | The viewer | the card, the workspace's Review tab and Land; `hive-review.spec.ts` |
| HV3d | Docs and the real runs | step 0's numbers, the real reviewer, the real Hive run; As built, the journal, `configuration.md` |

**HV1's and HV2's decisions as HV3 applies them** (the person's OK): 648, the running reviewer as
the verifier with the check the last word, and 650, the writer and the reviewer and no researcher,
are built; 651's gates hold (Land is the person's press); 658 holds for the reviewer (Claude Code
only).

**Decisions**:

| # | Question | Decision | Why |
|---|---|---|---|
| 674 | Where the review comes in the loop | **After a passing check (or none found), on the same commit; a failing check goes back without a review; landing only when both hold on one commit; one round counter, 3 rounds** | The check stays the last word (648); a review of code the writer must change anyway is wasted |
| 675 | The reviewer's copy | **A `git clone --shared` at the tip, detached, no remote, in Symbiote's cache; the install run by Symbiote; deleted after every outcome, on Hive off, swept at a runner's start** | A worktree shares the repository's refs and config; the install needs the store outside the copy |
| 676 | The reviewer's session | **`claude -p` in a process group of its own, stream-json, `--json-schema`, no session kept, no MCP server, no user settings; 30 min, $5; Claude Code only** | One run whose answer Symbiote reads (the merger's way, HV1's); `--bg` hits the trust prompt in a new folder; the person's user settings hold a Kubernetes server |
| 677 | Access only inside the copy | **Claude Code's sandbox for its commands (writes in the copy and temp only, no network but localhost), file tools allowed in the copy only (`dontAsk`); no sandbox → no review, landing asked with a note** | Decision 651; the person's answer to question 3 |
| 678 | What a finding needs | **Symbiote reruns each test in a fresh copy of the tip with only its files added, confined as the reviewer; kept only when it exits non-zero (not 126/127, not timed out) and its output names the test; dropped findings kept with why** | HV1: the rerun is what makes the reviewer precise; a broken test file must not read as a defect |
| 679 | What the writer gets | **`hive.review`: each kept finding's defect, test, command, files and output; the tests kept beside the record; add them or reject one in a line; the next review sees the last findings and the writer's report** | HV1's round trip fixed every proven defect in one round; a rejection needs an answer, not the same test again |
| 680 | The reviewer's settings | **`hive.reviewer.model` / `hive.reviewer.effort`, default Opus at high, in a Reviewer entry listed only in Hive mode; prompts `hive.reviewer` and `hive.review` in the Hive group; the answer's format Symbiote's** | The person's answers (HV2's planning): Opus high, configurable, Hive's settings only in Hive mode |
| 681 | Where the person sees it and lands | **A Review tab on a Hive workspace's page (checks, reviews, findings, tests) with Land: an approval of the checked and reviewed commit recorded for the person and queued through the merge queue; no branch review asked in Hive mode** | The person's answer to question 5: "In hive mode, there will be no more human review process" |

**Not in HV3 (later)**: Codex as the reviewer; a live view of the reviewer's session (its stream is
kept); resuming an interrupted review; the graph (HV4); usage pacing (HV5).

## As built (HV3)

- **No settings file but Symbiote's** (decision 676): `--setting-sources ""`, not
  `project,local`. Measured with a scratch repository: with the project's settings, its
  `.claude/settings.json` hooks run, outside the sandbox, from the branch the writer wrote; with
  none, they do not, and CLAUDE.md is not loaded either ("NONE" for its code word). The reviewer's
  prompt tells it to read the project's instructions itself. Its settings also turn every hook off
  (`disableAllHooks`).
- **Each review in a folder of its own**, under the branch's in the cache: a killed runner's review,
  still finishing in its process, would otherwise delete the copy of the review that replaced it
  (the killed-runner test). A new runner removes the branch's whole folder before it reviews.
- **Symbiote's rerun is confined by bubblewrap, which it calls itself** (`--ro-bind / /`, the copy
  bound writable, a private `/tmp`, `--unshare-net`, `--die-with-parent`). Claude Code's sandbox has
  no command of its own for another program's commands. So reviews run on Linux only; macOS's
  `sandbox-exec` is not built (it could not be checked here). Without bubblewrap, no reviewer starts
  and landing is asked with a note.
- **Claude Code refuses to start without its sandbox**: with `failIfUnavailable`, 2.1.316 here
  says "sandbox required but unavailable: … socat not installed". Symbiote reads that line: the
  review is `unavailable`, landing is asked with the note "not reviewed: Claude Code's sandbox is
  not available: …".
- **Land is the head's primary only.** It was planned in the Review tab too; with both, the page had
  two primaries for one action. The tab says what Land approves. The head's branch-review button is
  gone for a Hive workspace while Hive is on (the summary's new `off` says when it is off).
- **The test's name is a substring of the rerun's output.** A one-letter name matched "No test files
  found" by chance (a unit test caught it); the reviewer is asked for the name as its runner prints
  it. A short name stays a weak guard: the writer's one-line rejection is the next.
- **A failed review runs again at the next look**, on the same round and commit; the second failure
  asks landing with "the running review failed twice: …; review it yourself".
- **The reviewer's settings in Settings** say Symbiote's defaults: the model "Symbiote's default
  (Opus 5.5)", the level "Symbiote's default (high)".

**Results** (so far).

- **Measured first**: a `--shared` clone of this repository at a commit plus an offline
  `pnpm install --frozen-lockfile`, 0.3 s together (pnpm's store hard-links); `--json-schema`'s
  answer is the stream-json result's `structured_output`; `--max-budget-usd` is accepted; a vitest
  rerun under bubblewrap 0.5 s, a write to `$HOME` refused, no network (`curl` exit 6).
- **Tests**: `hive-runner.test.ts` 24 (11 HV3: a proven defect to the writer and its fix approved;
  dropped findings — passed on the rerun, output not naming the test, exit 127, a file not in the
  copy, a path with `..`; a failing check with no review and the cap after proven defects; Hive off
  mid-review and on; a killed runner's orphaned reviewer; the person's message mid-review; two
  failures; no sandbox; no confinement; the project's model; the Review tab and Land), and HV2's
  13 with the review step; `hive-review.test.ts` 14 (the rerun's verdict, files, arguments,
  settings, prompt, the message's room, bubblewrap for real, the Reviewer's settings); prompts 30;
  the viewer's settings 11, card words and the rounds' words. `pnpm check`: 2,625 tests.
- **e2e**: `hive-review.spec.ts` (the suite's fake Claude Code as writer and reviewer, the rerun
  under bubblewrap): a defect proven reaches the writer, the tab shows it, the fix is approved,
  Land merges it into `main` and Hive records `landed`; Settings' Reviewer. The viewer's whole
  suite: 368 of 369 passed, `hive-loop.spec.ts` failing once on a race of the fake's (a resume
  logged before its hook ran; see the journal), fixed in both Hive specs: 12 of 12, each 3 times.
  Nexus: 20 passed.
- **Screenshots** (1440×900 and 820×900, dark and light, Hive on): the Review tab with a proven and
  a dropped finding, the landing asked, Settings' Reviewer and Hive mode.
- **Not verified yet**: Claude Code's sandbox running a reviewer (here `socat` is missing); a real
  reviewer on a planted defect; the real Hive run (Verification 6's scratch repository is ready,
  waiting to be trusted in Claude Code); macOS and Windows (no review there).
