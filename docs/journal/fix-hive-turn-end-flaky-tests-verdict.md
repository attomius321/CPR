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
