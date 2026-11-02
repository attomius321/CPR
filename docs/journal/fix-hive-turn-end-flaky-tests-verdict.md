# Journal: Fix — a reported turn read as interrupted; HV8's timing tests; the verdict lost on `g`; three UI slips

[Index](../JOURNAL.md)

## Fix — a report ends the turn, whatever Claude Code lists (2026-11-02, branch `fix/hive-turn-end-flaky-tests-verdict`)

On `chore/readme-remake`, Hive waited 819 s after its writer's report before it checked the
commit, and only because the person typed "Wyd? end your turn" at 19:12:00. Plan, decision 810 and
the cause in
[HV4's plan](../plan/hv4-autonomous-landing.md#fix-a-report-ends-the-turn-whatever-claude-code-lists-fixhive-turn-end-flaky-tests-verdict).

**Learned**:

- **The writer's transcript shows no background task.** The brief suspected a Monitor or a
  background shell kept the session `working`. The session had been stopped and resumed with
  Hive's message at 18:54:55–57, so earlier tasks belonged to the old process. The turn from
  18:54:58 to 18:58:33 ran only foreground Bash, Read and Edit calls. Claude Code's own job
  timeline (`~/.claude/jobs/bcb2aa2e/timeline.jsonl`) wrote `working` at 18:58:33.108 for that
  turn's end, with the report's last sentence ("Starting that branch is your call.") as its
  detail, and `done` at the turns before (18:52:16) and after (19:12:10). The state Claude Code
  lists at a turn's end is its own reading of the turn, not a count of tasks in flight.
- **The code to read it right was already there, unreachable.** 2cf0ccb (2026-10-18) taught
  `agentState` that `working` with an idle process and a report after the last prompt is a
  finished turn, with a unit test that passes `ended` directly. Its one caller, `summaryOf`,
  worked out `ended` only for a `blocked` session, so no summary ever took that branch. A test
  through `summaryOf` would have caught it.
- **Measured across Hive's records**: from a writer's report after Hive's message to Hive's next
  event, 0–2 s in the 9 other such turns (`chore/check-timeout-comment`,
  `feature/hive-live-progress`, `feature/hive-pull-requests`); 819 s here. Two longer gaps are
  something else: Hive was off, or the workspace had been stopped.

**Decided** (Hive mode, no person to ask): the report over the listed state for an idle process,
also on normal mode's card (it read "Interrupted: waiting for you" for 13 minutes after a report).
A busy process with a report after the prompt stays `working`: Claude Code can start a turn with
no prompt (a background task's notification), and checking a branch while its writer works would
guess. That case ends at the next report, as any turn does.

**Verification**: tests first, each red for the right reason:

- `hive-runner.test.ts`: Hive's check failure delivered, then the writer commits and reports
  while Claude Code lists `working` and idle; Hive records `turn-ended` and runs round 2's check
  (red: the record stayed at round 2; the summary read `needs-you`, `interrupted`). The same test
  first shows the turn with no report reading interrupted and waiting, as 794 has it.
- `workspaces.test.ts`: the summary of a session listed `working` and idle reads interrupted with
  no report, `done` after one, `working` once busy, `needs-you` with `waitingFor` (red: `needs-you`
  after the report).
- 794–795's three tests and HV4's `hive.plan` and `hive.decide` tests pass unchanged; the two
  files' 218 tests pass.
- Not verified: a real Hive round with Claude Code listing a reported turn `working`.

## Fix — `symbiote --help` says Git (2026-11-02)

`symbiote --help` and `symbiote view --help` still said the view opens on "History (h)". The page
has been Git (`g`) since V66, and since V77 `h` opens History, the finished workspaces' page. Both
texts now say Git, and `view --help` says "opens on Git (g)". The help test (`main.test.ts`) now
asks for Git and refuses "History" in both (red before the fix: no "Git … every branch").

## Fix — HV8's timing tests get their own timeout (2026-11-02)

`hive-request-checkout.test.ts` and `hive-request-merged-mid-rounds.test.ts` failed Hive's check
on `chore/readme-remake` (round 1) and its writer's own runs 3 of 3: vitest's 5 s default.

**Learned**:

- **Measured here, the full unit suite with per-test times**: at load 8–25 both failed, at
  5,257 ms and 5,152 ms (and passed at 4,812 ms and 4,277 ms in their GitLab runs). The tests
  sharing their harness were close behind: `hive-request-unchecked-push` 4.4 s,
  `hive-request-merged-forge` 4.1 s, three of `hive-runner.test.ts`'s at 3.5–3.8 s,
  `hive-request-card-rounds` 3.1 s. Alone, the five HV8 files and `hive-runner.test.ts` (97 tests)
  take at most 1.7 s a test.
- **At load 33–44** (another session's HV6 runs, 32 cores), the same suite failed 34 tests, most
  with no Hive harness (`install.test.ts` 12.9 s, `plan-consolidate.test.ts` 15.3 s): no timeout
  in these files makes a check pass at that load. The two tests took 21.0 s and 21.3 s there.
- Each test drives the runner, the merge queue, git and a fake forge. Making them faster would
  mean a different harness, not a fix of these tests.

**Decided**: every test of the six files measured over 3 s in the loaded run gets its own 30 s:
the two named, the four sibling HV8 tests (both of `hive-request-merged-forge`'s), and
`hive-runner.test.ts`'s three. That is 9 test definitions, 14 runs with GitHub and GitLab. 30 s,
not `hive-runner.test.ts:1510`'s 20 s, because the two took 21 s at load 44; that 20 s is
unchanged. A real hang is reported after 30 s instead of 5 s.

**Verification**: before, the full suite at load 8–25 failed both (5,257 and 5,152 ms against
5,000). After, the 97 tests of the six files pass at load 14–23, the slowest 1.7 s; the full
suite's results after the change are in the last entry.

## Fix — the verdict kept across `g` (2026-11-02)

A verdict picked in the Graph page's Review tab was back to **Comment** after `g` to Files, so
**Finish review** there sent a comment. The summary and the comments survived the switch: they are
the page's draft (`useReview`). The verdict was the tab's own state (`ReviewTab.tsx`), and each
page draws its own tab, so the switch dropped it.

**Decided**: the verdict is the page's, beside the draft in `useReview`, and back to Comment for
a new graph and once a review is posted or finished. It is not saved with the draft: a verdict is
given to the head shown, and under `symbiote pr` a saved draft is carried to a later push.

**Verification**: an e2e test first (`reviews.spec.ts`): Request changes and a summary on the
Graph page, `g` to Files and back twice, Finish review; the review file's verdict is
`request-changes` with the summary, and the next review starts at Comment. Red on the build
before the fix (the radio unchecked after `g`, the summary kept), green after. `reviews.spec.ts`
passes whole.
