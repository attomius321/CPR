# Journal: Fix — Hive's runner, three flaws

[Index](../JOURNAL.md)

## Fix — Hive's runner, three flaws (2026-11-01, branch `fix/hive-runner-flaws`)

Three flaws in Hive's runner, each in real records on 2026-10-31: a message at landing checked
the same commit again; a check's failure went to a branch the merge queue was landing; a turn Hive
never saw left a workspace at `writing` with no sign. Plan, decisions 716–721 and results in
[HV2's plan](../plan/hv2-hive-runner.md#fix-hives-runner-three-flaws-fixhive-runner-flaws).

**Learned**:
- **The honeycomb workspace's unseen turn was a copy of its session, not a hook gone.** Hive's
  reply stopped the idle session `6f914615` (its end recorded at 17:00:13.144) and resumed it at
  once; Claude Code started a copy, `337836a3` (its transcript's first line at 17:00:14.647),
  without the session's `--settings`. The copy did the round's work and committed `092548c`; it
  has 0 entries in the thread and in Activity. `reply` answered `copy: "337836a3"`, and Hive
  wrote `sent`. `claude-settings.json` had last been written at 10:38 and named the main
  checkout's build, which exists. The next day's message resumed the copy (the newest session)
  and was not recorded either: a copy stays unseen for its whole life.
- **`claude stop` answers before the session is gone, and a resume meanwhile starts a copy.**
  Measured with Claude Code 2.1.316 (`scripts/hive/resume-race.mjs`, Haiku, 20 rounds on one
  session in a trusted scratch folder):

  | The resume | Copies | Of them, recorded nothing |
  |---|---|---|
  | As soon as `claude stop` answered (Symbiote's reply before the fix) | 3 of 4 | 2 |
  | Once `claude agents` lists no process (158–202 ms later) | 0 of 4 | |
  | As soon as the stop answered, a `claude attach` client on the session | 4 of 4 | 4 |
  | Once no process is listed (155–164 ms), the client on it | 3 of 4 | 3 |
  | Once no process is listed and the client has ended (800–879 ms) | 0 of 4 | |

  One copy recorded its prompt under the original's session ID; why is not known. The V18c spike
  saw the copy only for a live session; the time between the stop's answer and the process's end
  is what Symbiote's reply never waited for.
- **A `claude attach` client outlives the stop by about a second**, and a resume while it runs is
  taken as a resume of a running session. Measured once: the stop answered at 3.62 s, the process
  left the list at 3.78 s, the client exited at 4.57 s; the resume after it woke the session. The
  person's terminal was attached at 17:00 (Symbiote's log: "terminal ended" at 17:00:14.201). The
  reply now waits for the end of every terminal it opened on the session. `close` was not used:
  it drops a terminal from the list before its process ends.
- **"Merged" was too late a test for the second flaw.** The merge queue made HV3's merge commit
  at 14:12:29, ran its own check, and moved `main` at 14:22:42 (its reflog); Hive's failure went
  out at 14:19:23. A branch in the queue is being landed. The queue's check and Hive's check of
  the same commit also ran at once, two e2e suites on one machine: the likely cause of the flaky
  failure.
- **The merger's `list` starts merges**: it kicks the queue when it finds one queued. The runner
  reads the queue's file (`mergeQueue(...).read()`) and nothing else.
- **A rule for unseen turns must not hide a card's better words**: an agent that never started,
  failed or was stopped has no session whose turn Hive waits for, and its card says why. Only an
  agent working, waiting or done with a turn can be "unseen".
- **The tests' clock moves a second each time it is read**: in a step where the runner reads no
  time, ticks do not move it, so the test of that step moves it by hand.

**Verification**: tests first, each red for the right reason before the fix:
- `hive-runner.test.ts`, 14 new: no second check on an unchanged commit after a message at
  landing (red: 2 runs of the check, not 1), nor after a review round with no commit (2 checks
  recorded); a failed check runs again (a guard, green before and after); merged while checking
  (red: the check not stopped in 10 s), queued while reviewing (red: not stopped), a check that
  fails after the merge (red: `writing`, `hive.check` sent), a review that proves defects after
  the queue took the branch (red: sent), a message not sent to a queued branch (red: sent); a
  stop that lingers (red: 2 sessions, a copy), one that never ends (red: a copy), hooks silent
  after Hive's message (red: no `taken`, `sent` written), a copy reported (red: `writing`), a
  first turn with silent hooks (written after the guard: stuck only once the session works), an
  older runner's `sent` with no prompt (red: `writing`).
- `workspaces.test.ts`: a reply with the agent's terminal open resumes after that terminal ended
  (red: resumed at once).
- `agent-hook-copy.test.ts`, 3: the files copied are the hook's whole import closure; the copy
  records a prompt in the thread after the build it came from is deleted; one folder a content
  (red: the module missing).
- `e2e/hive-loop.spec.ts`: Claude Code takes Hive's message into a copy; the card says "Hive
  stopped: the writer's turn cannot be seen" with the copy's ID, and the settings name the hook's
  copy in the cache. Red with `main`'s runner transpiled into `dist` (the record stayed at
  `writing`), green with the fix.
- The real measurement above (20 rounds, every session removed after; the scratch folder deleted).
- `pnpm check`: 2,685 tests. `pnpm build`. e2e: 374 viewer and 20 nexus tests, all passed.

Not verified: a real Hive round end to end through Symbiote's own terminal with real Claude Code
(a workspace's worktree is a folder Claude Code does not trust yet, so `--bg` refuses it there);
the waits were measured with the script, which does what the reply does. A `claude attach` the
person runs in their own shell cannot be waited for: a copy then is noticed (decision 719), not
prevented. The Haiku sessions' transcripts stay in Claude Code's own folder
(`~/.claude/projects/-home-anton-projects-cpr-spike-v18c/`).

Merged into main (2026-11-01).
